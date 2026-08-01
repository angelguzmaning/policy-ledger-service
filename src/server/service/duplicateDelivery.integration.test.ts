import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { seedPolicy } from '../../../test/fixtures'
import { applyEndorsement } from '@/server/service/applyEndorsement'
import { recordPayment } from '@/server/service/recordPayment'
import { ExternalPaymentIdConflictError, IdempotencyKeyConflictError } from '@/server/errors'

const endorsementCommand = {
  idempotency_key: 'END-2001',
  effective_date: '2026-07-01',
  new_annual_premium_cents: 144_000,
  reason: 'Water-shutoff discount removed',
}

const paymentCommand = {
  idempotency_key: 'PAY-9001',
  external_payment_id: 'PAY-9001',
  amount_cents: 12_099,
  currency: 'USD',
  received_at: '2026-07-03T18:30:00Z',
}

async function count(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table}`)
  return Number(rows[0]?.n ?? 0)
}

describe('duplicate delivery', () => {
  it('A1 -- END-2001 applied, then redelivered identically: 200 duplicate ignored, no new rows', async () => {
    await seedPolicy(pool)
    const first = await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    const second = await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    expect(first.idempotency_result).toBe('applied')
    expect(second.idempotency_result).toBe('duplicate ignored')
    expect({ ...second, idempotency_result: undefined }).toEqual({
      ...first,
      idempotency_result: undefined,
    })

    expect(await count('endorsements')).toBe(1)
    expect(await count('policy_events')).toBe(2) // policy_created + endorsement_applied
    expect(await count('billing_documents')).toBe(1)
    expect(await count('ledger_transactions')).toBe(1)
  })

  it('A2 -- PAY-9001 applied, then redelivered identically: same shape, cash debited once', async () => {
    await seedPolicy(pool)
    const first = await recordPayment(pool, 'POL-1001', paymentCommand)
    const second = await recordPayment(pool, 'POL-1001', paymentCommand)

    expect(first.idempotency_result).toBe('applied')
    expect(second.idempotency_result).toBe('duplicate ignored')
    expect({ ...second, idempotency_result: undefined }).toEqual({
      ...first,
      idempotency_result: undefined,
    })

    const { rows } = await pool.query<{ balance: string }>(
      `SELECT SUM(amount_cents) AS balance FROM ledger_entries WHERE account_code = 'cash'`,
    )
    expect(Number(rows[0]?.balance)).toBe(12_099)
  })

  it('A3 -- END-2001 redelivered with a changed new_annual_premium_cents: IdempotencyKeyConflict, no new rows', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    const before = await count('endorsements')

    await expect(
      applyEndorsement(pool, 'POL-1001', {
        ...endorsementCommand,
        new_annual_premium_cents: 200_000,
      }),
    ).rejects.toThrow(IdempotencyKeyConflictError)

    expect(await count('endorsements')).toBe(before)
  })

  it('A4 -- END-2001 redelivered with a changed reason: IdempotencyKeyConflict -- reason is fingerprinted', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    await expect(
      applyEndorsement(pool, 'POL-1001', { ...endorsementCommand, reason: 'a different reason' }),
    ).rejects.toThrow(IdempotencyKeyConflictError)
  })

  it('A5 -- END-2001 redelivered to a different policy: IdempotencyKeyConflict, not a second endorsement', async () => {
    await seedPolicy(pool)
    await seedPolicy(pool, { policy_id: 'POL-2002', homeowner_id: 'HOME-999' })

    await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    await expect(applyEndorsement(pool, 'POL-2002', endorsementCommand)).rejects.toThrow(
      IdempotencyKeyConflictError,
    )
    expect(await count('endorsements')).toBe(1)
  })

  it('A6 -- same real payment under a fresh key: ExternalPaymentIdConflict, cash debited once', async () => {
    await seedPolicy(pool)
    await recordPayment(pool, 'POL-1001', paymentCommand)

    await expect(
      recordPayment(pool, 'POL-1001', { ...paymentCommand, idempotency_key: 'PAY-9003' }),
    ).rejects.toThrow(ExternalPaymentIdConflictError)

    const { rows } = await pool.query<{ balance: string }>(
      `SELECT SUM(amount_cents) AS balance FROM ledger_entries WHERE account_code = 'cash'`,
    )
    expect(Number(rows[0]?.balance)).toBe(12_099)
  })

  it('A7 -- replay of an endorsement applied while active, policy now cancelled: 200 duplicate ignored', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    await pool.query("UPDATE policies SET status = 'cancelled' WHERE policy_id = 'POL-1001'")

    const replay = await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    expect(replay.idempotency_result).toBe('duplicate ignored')
  })
})
