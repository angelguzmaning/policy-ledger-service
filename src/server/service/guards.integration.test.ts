import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { seedPolicy } from '../../../test/fixtures'
import { applyEndorsement } from '@/server/service/applyEndorsement'
import { recordPayment } from '@/server/service/recordPayment'
import {
  OutOfOrderEndorsementError,
  OutOfTermError,
  PolicyNotActiveError,
  PolicyNotFoundError,
} from '@/server/errors'

describe('service-layer guards', () => {
  it('PolicyNotFound on an unknown policy', async () => {
    await expect(
      applyEndorsement(pool, 'POL-9999', {
        idempotency_key: 'END-1',
        effective_date: '2026-07-01',
        new_annual_premium_cents: 100,
      }),
    ).rejects.toThrow(PolicyNotFoundError)
  })

  it('PolicyNotActive on an endorsement against a cancelled policy', async () => {
    await seedPolicy(pool, { status: 'cancelled' })
    await expect(
      applyEndorsement(pool, 'POL-1001', {
        idempotency_key: 'END-1',
        effective_date: '2026-07-01',
        new_annual_premium_cents: 144_000,
      }),
    ).rejects.toThrow(PolicyNotActiveError)
  })

  it('a payment against a cancelled policy is still recorded -- no PolicyNotActive guard on payments', async () => {
    await seedPolicy(pool, { status: 'cancelled' })
    const result = await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-1',
      external_payment_id: 'PAY-1',
      amount_cents: 100,
      currency: 'USD',
      received_at: '2026-07-01T00:00:00Z',
    })
    expect(result.idempotency_result).toBe('applied')
  })

  it('OutOfTerm at the lower inclusive boundary is accepted; one day earlier is rejected', async () => {
    await seedPolicy(pool)
    await expect(
      applyEndorsement(pool, 'POL-1001', {
        idempotency_key: 'END-1',
        effective_date: '2026-01-01',
        new_annual_premium_cents: 144_000,
      }),
    ).resolves.toBeDefined()

    await expect(
      applyEndorsement(pool, 'POL-1001', {
        idempotency_key: 'END-2',
        effective_date: '2025-12-31',
        new_annual_premium_cents: 144_000,
      }),
    ).rejects.toThrow(OutOfTermError)
  })

  it('OutOfTerm at the upper inclusive boundary is accepted; one day later is rejected', async () => {
    await seedPolicy(pool)
    await expect(
      applyEndorsement(pool, 'POL-1001', {
        idempotency_key: 'END-1',
        effective_date: '2027-01-01',
        new_annual_premium_cents: 144_000,
      }),
    ).resolves.toBeDefined()

    await expect(
      applyEndorsement(pool, 'POL-1001', {
        idempotency_key: 'END-2',
        effective_date: '2027-01-02',
        new_annual_premium_cents: 144_000,
      }),
    ).rejects.toThrow(OutOfTermError)
  })

  it('OutOfOrderEndorsement when effective_date precedes the latest applied endorsement', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-1',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 144_000,
    })

    await expect(
      applyEndorsement(pool, 'POL-1001', {
        idempotency_key: 'END-2',
        effective_date: '2026-06-01',
        new_annual_premium_cents: 150_000,
      }),
    ).rejects.toThrow(OutOfOrderEndorsementError)
  })

  it('guard order: the idempotency lookup runs before the 422 domain checks -- a replay never re-evaluates them', async () => {
    await seedPolicy(pool)
    const command = {
      idempotency_key: 'END-1',
      effective_date: '2026-07-01', // in-term when first applied
      new_annual_premium_cents: 144_000,
    }

    const applied = await applyEndorsement(pool, 'POL-1001', command)
    expect(applied.idempotency_result).toBe('applied')

    // Cancel the policy -- if the replay re-ran domain checks it would now
    // hit PolicyNotActive instead of returning the duplicate.
    await pool.query("UPDATE policies SET status = 'cancelled' WHERE policy_id = 'POL-1001'")

    const replay = await applyEndorsement(pool, 'POL-1001', command)
    expect(replay.idempotency_result).toBe('duplicate ignored')
  })
})
