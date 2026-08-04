import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { seedPolicy } from '../../../test/fixtures'
import { applyEndorsement } from '@/server/service/applyEndorsement'
import { recordPayment } from '@/server/service/recordPayment'
import { loadLedger } from '@/server/service/loadLedger'
import { getOpenBalanceCents } from '@/server/service/shared'

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

describe('balanced ledger writes', () => {
  it('C1 -- after an endorsement and a payment: every entry sums to zero, every transaction has >= 2 legs', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    await recordPayment(pool, 'POL-1001', paymentCommand)

    const { rows } = await pool.query<{ sum: string }>(
      'SELECT SUM(amount_cents) AS sum FROM ledger_entries',
    )
    expect(Number(rows[0]?.sum)).toBe(0)

    const { rows: legCounts } = await pool.query<{ legs: string }>(
      'SELECT COUNT(*) AS legs FROM ledger_entries GROUP BY ledger_transaction_id',
    )
    for (const row of legCounts) expect(Number(row.legs)).toBeGreaterThanOrEqual(2)
  })

  it('C2 -- GROUP BY ledger_transaction_id HAVING SUM <> 0 is empty', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    await recordPayment(pool, 'POL-1001', paymentCommand)

    const { rows } = await pool.query(
      'SELECT ledger_transaction_id FROM ledger_entries GROUP BY ledger_transaction_id HAVING SUM(amount_cents) <> 0',
    )
    expect(rows).toHaveLength(0)
  })

  it('C3 -- negative-delta endorsement: balanced, premium_credit document, amount_cents > 0 intact', async () => {
    await seedPolicy(pool, { annual_premium_cents: 144_000 })
    const result = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-3001',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 120_000,
    })
    expect(result.billing_document?.type).toBe('premium_credit')
    expect(result.billing_document?.amount_cents).toBeGreaterThan(0)
    expect(result.delta_cents).toBeLessThan(0)

    const { rows } = await pool.query<{ sum: string }>(
      'SELECT SUM(amount_cents) AS sum FROM ledger_entries',
    )
    expect(Number(rows[0]?.sum)).toBe(0)
  })

  it('C4 -- zero-delta endorsement: a policy_events row and no ledger transaction, no billing document', async () => {
    await seedPolicy(pool, { annual_premium_cents: 120_000 })
    const result = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-4001',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 120_000,
    })
    expect(result.delta_cents).toBe(0)
    expect(result.billing_document).toBeNull()
    expect(result.ledger_transaction_ids).toEqual([])

    const { rows } = await pool.query<{ n: string }>(
      "SELECT COUNT(*) AS n FROM policy_events WHERE event_type = 'endorsement_applied'",
    )
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('C5 -- a deliberately unbalanced raw-SQL insert inside a transaction: COMMIT raises', async () => {
    await seedPolicy(pool)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (policy_id, source_type, source_id, description)
         VALUES ('POL-1001', 'endorsement', 'END-UNBALANCED', 'test')
         RETURNING ledger_transaction_id AS id`,
      )
      const id = rows[0]?.id
      await client.query(
        `INSERT INTO ledger_entries (ledger_transaction_id, account_code, amount_cents, currency)
         VALUES ($1, 'cash', 100, 'USD')`,
        [id],
      )
      // Deliberately unbalanced: no offsetting leg.
      await expect(client.query('COMMIT')).rejects.toThrow()
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
  })

  it('C6 -- open_balance_cents after a full payment: 0, equals the premium_receivable balance', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    await recordPayment(pool, 'POL-1001', paymentCommand)

    const balance = await getOpenBalanceCents(pool, 'POL-1001')
    expect(balance).toBe(0)

    const ledger = await loadLedger(pool, 'POL-1001')
    expect(ledger.account_balances.premium_receivable).toBe(0)
  })

  it('C7 -- overpayment: open_balance_cents negative, cash still posted', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    await recordPayment(pool, 'POL-1001', { ...paymentCommand, amount_cents: 20_000 })

    const balance = await getOpenBalanceCents(pool, 'POL-1001')
    expect(balance).toBeLessThan(0)

    const ledger = await loadLedger(pool, 'POL-1001')
    expect(ledger.account_balances.cash).toBe(20_000)
  })

  it('C8 -- UPDATE on ledger_entries raises restrict_violation -- append-only enforced by the database', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    const { rows } = await pool.query<{ id: string }>(
      'SELECT ledger_entry_id AS id FROM ledger_entries LIMIT 1',
    )
    const id = rows[0]?.id

    await expect(
      pool.query('UPDATE ledger_entries SET amount_cents = 1 WHERE ledger_entry_id = $1', [id]),
    ).rejects.toThrow()
  })
})
