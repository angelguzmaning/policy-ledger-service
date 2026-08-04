import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { countAllTables, seedPolicy } from '../../../test/fixtures'
import { recordPayment } from '@/server/service/recordPayment'
import { recordInboundRequest } from '@/server/service/inboundRequests'
import { CurrencyMismatchError } from '@/server/errors'

const eurPayment = {
  idempotency_key: 'PAY-9002',
  external_payment_id: 'PAY-9002',
  amount_cents: 5_000,
  currency: 'EUR',
  received_at: '2026-07-04T10:00:00Z',
}

describe('wrong-currency failure -- the atomicity proof', () => {
  it('B1 -- PAY-9002 in EUR: CurrencyMismatch, whole-database count snapshot unchanged except inbound_requests +1', async () => {
    await seedPolicy(pool)
    const before = await countAllTables(pool)

    let caught: unknown
    try {
      await recordPayment(pool, 'POL-1001', eurPayment)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CurrencyMismatchError)

    // The receipt is written by the route handler on a separate connection,
    // not by the service itself -- simulate that here since this test calls
    // the service directly (per #11's "no test boots Next" rule).
    await recordInboundRequest(pool, {
      policyId: 'POL-1001',
      requestKind: 'payment',
      businessId: eurPayment.idempotency_key,
      outcome: 'rejected',
      statusCode: 422,
      errorCode: 'CurrencyMismatch',
      requestBody: JSON.stringify(eurPayment),
    })

    const after = await countAllTables(pool)
    expect(after).toEqual({ ...before, inbound_requests: (before.inbound_requests ?? 0) + 1 })
  })

  it('B2 -- PAY-9002 resubmitted in USD: applied -- the rejected request never consumed its key', async () => {
    await seedPolicy(pool)
    await expect(recordPayment(pool, 'POL-1001', eurPayment)).rejects.toThrow(CurrencyMismatchError)

    const result = await recordPayment(pool, 'POL-1001', { ...eurPayment, currency: 'USD' })
    expect(result.idempotency_result).toBe('applied')
  })

  it('B3 -- the inbound_requests row from B1: outcome rejected, error_code CurrencyMismatch, body stored verbatim', async () => {
    await seedPolicy(pool)
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

    const { rows } = await pool.query<{
      outcome: string
      error_code: string
      request_body: string
    }>(
      'SELECT outcome, error_code, request_body FROM inbound_requests ORDER BY inbound_request_id DESC LIMIT 1',
    )
    expect(rows[0]?.outcome).toBe('rejected')
    expect(rows[0]?.error_code).toBe('CurrencyMismatch')
    expect(rows[0]?.request_body).toBe(JSON.stringify(eurPayment))
  })

  it('B4 -- a 404 on an unknown policy still writes an inbound_requests row -- the missing FK is what allows it', async () => {
    await recordInboundRequest(pool, {
      policyId: 'POL-9999',
      requestKind: 'payment',
      businessId: 'PAY-0001',
      outcome: 'rejected',
      statusCode: 404,
      errorCode: 'PolicyNotFound',
      requestBody: '{}',
    })

    const { rows } = await pool.query<{ policy_id: string }>(
      "SELECT policy_id FROM inbound_requests WHERE policy_id = 'POL-9999'",
    )
    expect(rows).toHaveLength(1)
  })
})
