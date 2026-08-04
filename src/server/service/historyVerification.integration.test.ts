import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { seedPolicy } from '../../../test/fixtures'
import { applyEndorsement } from '@/server/service/applyEndorsement'
import { recordPayment } from '@/server/service/recordPayment'
import { verifyPolicyHistory } from '@/server/service/verifyHistory'

const endorsementCommand = {
  idempotency_key: 'END-2001',
  effective_date: '2026-07-01',
  new_annual_premium_cents: 144_000,
}

const paymentCommand = {
  idempotency_key: 'PAY-9001',
  external_payment_id: 'PAY-9001',
  amount_cents: 12_099,
  currency: 'USD',
  received_at: '2026-07-03T18:30:00Z',
}

describe('history verification', () => {
  it('D1 -- seeded policy, endorsement, payment: valid, event_count 3, event types in order', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)
    await recordPayment(pool, 'POL-1001', paymentCommand)

    const result = await verifyPolicyHistory(pool, 'POL-1001')
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.eventCount).toBe(3)
  })

  it('D2 -- payload tampered by raw UPDATE: the UPDATE itself raises -- append-only fires first', async () => {
    await seedPolicy(pool)
    await expect(
      pool.query(
        "UPDATE policy_events SET payload = '{}' WHERE policy_id = 'POL-1001' AND seq = 1",
      ),
    ).rejects.toThrow()
  })

  it('D3 -- tamper applied with the trigger dropped in-test: valid false, event_hash_mismatch at the right seq', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    await pool.query('ALTER TABLE policy_events DISABLE TRIGGER policy_events_append_only')
    try {
      await pool.query(
        "UPDATE policy_events SET payload = '{\"tampered\":true}' WHERE policy_id = 'POL-1001' AND seq = 2",
      )
    } finally {
      await pool.query('ALTER TABLE policy_events ENABLE TRIGGER policy_events_append_only')
    }

    const result = await verifyPolicyHistory(pool, 'POL-1001')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.break.reason).toBe('event_hash_mismatch')
      expect(result.break.seq).toBe(2)
    }
  })

  it('D4 -- row deleted from the middle, trigger dropped: sequence_gap', async () => {
    await seedPolicy(pool)
    // Zero-delta so seq 2 has no billing_document/ledger_transaction FK to unwind.
    await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-ZERO',
      effective_date: '2026-06-01',
      new_annual_premium_cents: 120_000,
    })
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    await pool.query('ALTER TABLE policy_events DISABLE TRIGGER policy_events_append_only')
    try {
      // The endorsement row FK-references (policy_id, seq) -- it must go first.
      await pool.query("DELETE FROM endorsements WHERE policy_id = 'POL-1001' AND policy_seq = 2")
      await pool.query("DELETE FROM policy_events WHERE policy_id = 'POL-1001' AND seq = 2")
    } finally {
      await pool.query('ALTER TABLE policy_events ENABLE TRIGGER policy_events_append_only')
    }

    const result = await verifyPolicyHistory(pool, 'POL-1001')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.break.reason).toBe('sequence_gap')
  })

  it('D5 -- genesis insert with a non-null previous_hash: rejected by the biconditional CHECK', async () => {
    await seedPolicy(pool, { policy_id: 'POL-5001' })
    await expect(
      pool.query(
        `INSERT INTO policy_events (policy_id, seq, event_type, recorded_at, payload, previous_hash, event_hash)
         VALUES ('POL-5001', 5, 'policy_created', '2026-01-01T00:00:00.000Z', '{}', $1, $2)`,
        ['a'.repeat(64), 'b'.repeat(64)],
      ),
    ).rejects.toThrow()
  })

  it('D6 -- second event claiming an existing previous_hash: rejected by UNIQUE(policy_id, previous_hash)', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    const { rows } = await pool.query<{ event_hash: string }>(
      "SELECT event_hash FROM policy_events WHERE policy_id = 'POL-1001' AND seq = 1",
    )
    const genesisHash = rows[0]?.event_hash

    await expect(
      pool.query(
        `INSERT INTO policy_events (policy_id, seq, event_type, recorded_at, payload, previous_hash, event_hash)
         VALUES ('POL-1001', 3, 'payment_recorded', '2026-01-01T00:00:00.000Z', '{}', $1, $2)`,
        [genesisHash, 'c'.repeat(64)],
      ),
    ).rejects.toThrow()
  })

  it('D7 -- seq 1 with event_type other than policy_created: rejected by the second biconditional CHECK', async () => {
    await expect(
      pool.query(
        `INSERT INTO policies (policy_id, homeowner_id, status, term_start, term_end, annual_premium_cents, currency)
         VALUES ('POL-7001', 'HOME-1', 'active', '2026-01-01', '2027-01-01', 100000, 'USD')`,
      ),
    ).resolves.toBeDefined()

    await expect(
      pool.query(
        `INSERT INTO policy_events (policy_id, seq, event_type, recorded_at, payload, previous_hash, event_hash)
         VALUES ('POL-7001', 1, 'endorsement_applied', '2026-01-01T00:00:00.000Z', '{}', NULL, $1)`,
        ['d'.repeat(64)],
      ),
    ).rejects.toThrow()
  })
})
