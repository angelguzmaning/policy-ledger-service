import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { seedPolicy } from '../../../test/fixtures'
import { applyEndorsement } from '@/server/service/applyEndorsement'
import { recordPayment } from '@/server/service/recordPayment'
import { loadPolicy } from '@/server/service/loadPolicy'
import { loadHistoryVerificationView } from '@/server/service/verifyHistory'
import { recordInboundRequest } from '@/server/service/inboundRequests'
import { CurrencyMismatchError, PolicyNotFoundError } from '@/server/errors'

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

const eurPayment = {
  idempotency_key: 'PAY-9002',
  external_payment_id: 'PAY-9002',
  amount_cents: 5_000,
  currency: 'EUR',
  received_at: '2026-07-04T10:00:00Z',
}

describe("GET /policies/:policyId view -- reproduces the brief's sample state", () => {
  it('matches the Expected Output example modulo the three documented deviations', async () => {
    await seedPolicy(pool)

    // idempotency_result on GET comes from the inbound_requests receipt log
    // (written by the route handler, not the service) -- mirror that here
    // since this test calls the service layer directly, per #11's convention.
    for (let i = 0; i < 2; i++) {
      await applyEndorsement(pool, 'POL-1001', endorsementCommand)
      await recordInboundRequest(pool, {
        policyId: 'POL-1001',
        requestKind: 'endorsement',
        businessId: endorsementCommand.idempotency_key,
        outcome: 'accepted',
        statusCode: i === 0 ? 201 : 200,
        errorCode: null,
        requestBody: JSON.stringify(endorsementCommand),
      })
    }

    for (let i = 0; i < 2; i++) {
      await recordPayment(pool, 'POL-1001', paymentCommand)
      await recordInboundRequest(pool, {
        policyId: 'POL-1001',
        requestKind: 'payment',
        businessId: paymentCommand.idempotency_key,
        outcome: 'accepted',
        statusCode: i === 0 ? 201 : 200,
        errorCode: null,
        requestBody: JSON.stringify(paymentCommand),
      })
    }

    await expect(recordPayment(pool, 'POL-1001', eurPayment)).rejects.toThrow(CurrencyMismatchError)
    await recordInboundRequest(pool, {
      policyId: 'POL-1001',
      requestKind: 'payment',
      businessId: eurPayment.idempotency_key,
      outcome: 'rejected',
      statusCode: 422,
      errorCode: 'CurrencyMismatch',
      requestBody: JSON.stringify(eurPayment),
    })

    const view = await loadPolicy(pool, 'POL-1001')

    expect(view.policy_id).toBe('POL-1001')
    expect(view.status).toBe('active')
    expect(view.annual_premium_cents).toBe(144_000)
    expect(view.open_balance_cents).toBe(0)
    expect(view.ledger.balanced).toBe(true)
    expect(view.ledger.transactions).toEqual([
      { source: 'END-2001', debits_cents: 12_099, credits_cents: 12_099 },
      { source: 'PAY-9001', debits_cents: 12_099, credits_cents: 12_099 },
    ])
    expect(view.history).toEqual({
      valid: true,
      event_count: 3, // deviation: policy_created is chain-covered (ADR-0005)
      events: ['policy_created', 'endorsement_applied', 'payment_recorded'],
    })
    expect(view.endorsements).toHaveLength(1)
    expect(view.endorsements[0]).toMatchObject({
      id: 'END-2001',
      effective_date: '2026-07-01',
      delta_cents: 12_099,
      billing_document: {
        type: 'premium_charge', // API-facing type; DB keeps `endorsement_adjustment` (ADR-0005 deviation)
        amount_cents: 12_099,
        status: 'paid',
      },
      idempotency_result: 'duplicate ignored',
    })
    // The BILL- sequence is global and non-transactional (documented limitation),
    // so only its shape is pinned here -- BILL-3001 is what a *fresh* seed reproduces.
    expect(view.endorsements[0]?.billing_document?.id).toMatch(/^BILL-\d+$/)
    expect(view.payments).toEqual([
      {
        external_payment_id: 'PAY-9001',
        amount_cents: 12_099,
        status: 'applied',
        idempotency_result: 'duplicate ignored',
        received_at: '2026-07-03T18:30:00Z',
      },
    ])
    expect(view.rejected_events).toEqual([{ id: 'PAY-9002', reason: 'currency mismatch' }])
    expect(view.suggested_action).toBe('No action required')
    expect(view.explanation).toContain('Policy POL-1001 is active')
  })

  it('PolicyNotFound on an unknown policy', async () => {
    await expect(loadPolicy(pool, 'POL-9999')).rejects.toThrow(PolicyNotFoundError)
  })

  it('orders payments by receipt date, earliest first, regardless of recording order', async () => {
    await seedPolicy(pool)

    // Recorded in reverse of their receipt order: PAY-B2 (later receipt) first,
    // PAY-B3 (earlier receipt) second -- the view must still list PAY-B3 first.
    await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B2',
      external_payment_id: 'PAY-B2',
      amount_cents: 10_000,
      currency: 'USD',
      received_at: '2026-09-15T00:00:00Z',
    })
    await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B3',
      external_payment_id: 'PAY-B3',
      amount_cents: 20_000,
      currency: 'USD',
      received_at: '2026-08-02T00:00:00Z',
    })

    const view = await loadPolicy(pool, 'POL-1001')
    expect(view.payments.map((p) => p.external_payment_id)).toEqual(['PAY-B3', 'PAY-B2'])
    expect(view.payments.map((p) => p.received_at)).toEqual([
      '2026-08-02T00:00:00Z',
      '2026-09-15T00:00:00Z',
    ])
  })

  it('breaks a receipt-date tie deterministically by payment id', async () => {
    await seedPolicy(pool)

    // Recorded in reverse of id order, same instant -- the tiebreak must sort by id, not recording order.
    await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B2',
      external_payment_id: 'PAY-B2',
      amount_cents: 10_000,
      currency: 'USD',
      received_at: '2026-08-02T00:00:00Z',
    })
    await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B1',
      external_payment_id: 'PAY-B1',
      amount_cents: 20_000,
      currency: 'USD',
      received_at: '2026-08-02T00:00:00Z',
    })

    const view = await loadPolicy(pool, 'POL-1001')
    expect(view.payments.map((p) => p.external_payment_id)).toEqual(['PAY-B1', 'PAY-B2'])
  })

  it('zero endorsements/payments: empty lists, "No action required"', async () => {
    await seedPolicy(pool)
    const view = await loadPolicy(pool, 'POL-1001')
    expect(view.endorsements).toEqual([])
    expect(view.payments).toEqual([])
    expect(view.suggested_action).toBe('No action required')
    expect(view.explanation).not.toContain('endorsement')
  })

  it('a broken chain flips suggested_action to the history rung, even with balance 0', async () => {
    await seedPolicy(pool)
    await pool.query('ALTER TABLE policy_events DISABLE TRIGGER policy_events_append_only')
    try {
      await pool.query('UPDATE policy_events SET payload = \'{"tampered":true}\' WHERE seq = 1')
    } finally {
      await pool.query('ALTER TABLE policy_events ENABLE TRIGGER policy_events_append_only')
    }

    const view = await loadPolicy(pool, 'POL-1001')
    expect(view.history.valid).toBe(false)
    expect(view.suggested_action).toContain('Investigate history integrity')
  })
})

describe('loadHistoryVerificationView', () => {
  it('valid chain: includes events in order and a head_hash', async () => {
    await seedPolicy(pool)
    await applyEndorsement(pool, 'POL-1001', endorsementCommand)

    const view = await loadHistoryVerificationView(pool, 'POL-1001')
    expect(view.valid).toBe(true)
    if (view.valid) {
      expect(view.events).toEqual(['policy_created', 'endorsement_applied'])
      expect(view.head_hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('PolicyNotFound on an unknown policy', async () => {
    await expect(loadHistoryVerificationView(pool, 'POL-9999')).rejects.toThrow(PolicyNotFoundError)
  })
})
