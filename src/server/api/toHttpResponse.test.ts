import { describe, expect, it, vi } from 'vitest'
import { toHttpResponse } from '@/server/api/toHttpResponse'
import {
  CurrencyMismatchError,
  ExternalPaymentIdConflictError,
  IdempotencyKeyConflictError,
  InvalidRequestError,
  OutOfOrderEndorsementError,
  OutOfTermError,
  PolicyIdMismatchError,
  PolicyNotActiveError,
  PolicyNotFoundError,
} from '@/server/errors'

describe('toHttpResponse', () => {
  const cases: [string, unknown, number][] = [
    ['InvalidRequest', new InvalidRequestError('bad', [{ path: 'x', message: 'bad' }]), 400],
    ['PolicyIdMismatch', new PolicyIdMismatchError('POL-1001', 'POL-9999'), 400],
    ['PolicyNotFound', new PolicyNotFoundError('POL-9999'), 404],
    ['IdempotencyKeyConflict', new IdempotencyKeyConflictError('END-2001'), 409],
    ['ExternalPaymentIdConflict', new ExternalPaymentIdConflictError('PAY-9001'), 409],
    ['PolicyNotActive', new PolicyNotActiveError('POL-1001', 'cancelled'), 422],
    ['OutOfTerm', new OutOfTermError('2025-12-31', '2026-01-01', '2027-01-01'), 422],
    ['OutOfOrderEndorsement', new OutOfOrderEndorsementError('2026-06-01', '2026-07-01'), 422],
    ['CurrencyMismatch', new CurrencyMismatchError('POL-1001', 'USD', 'PAY-9002', 'EUR'), 422],
  ]

  it.each(cases)('%s maps to the correct status and carries error.code', (code, error, status) => {
    const response = toHttpResponse(error)
    expect(response.status).toBe(status)
    expect(response.body.error.code).toBe(code)
    expect(typeof response.body.error.message).toBe('string')
  })

  it('details is present only for InvalidRequest', () => {
    const withDetails = toHttpResponse(
      new InvalidRequestError('bad', [{ path: 'x', message: 'bad' }]),
    )
    expect(withDetails.body.error.details).toEqual([{ path: 'x', message: 'bad' }])

    const other = toHttpResponse(new PolicyNotFoundError('POL-9999'))
    expect(other.body.error.details).toBeUndefined()
  })

  it('an unhandled error becomes 500 InternalError, carries request_id, and leaks no internal text', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = toHttpResponse(new Error('relation "policies" does not exist, pg internals'))
    spy.mockRestore()

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('InternalError')
    expect(response.body.error.request_id).toBeTruthy()
    expect(response.body.error.message).toBe('An unexpected error occurred.')
    expect(response.body.error.message).not.toContain('relation')
    expect(response.body.error.message).not.toContain('pg internals')
  })

  it("CurrencyMismatch message matches the brief's PAY-9002 example", () => {
    const response = toHttpResponse(new CurrencyMismatchError('POL-1001', 'USD', 'PAY-9002', 'EUR'))
    expect(response.body.error.message).toBe(
      'Policy POL-1001 is denominated in USD; payment PAY-9002 is in EUR.',
    )
  })

  it('OutOfTerm message matches the example shape', () => {
    const response = toHttpResponse(new OutOfTermError('2025-12-31', '2026-01-01', '2027-01-01'))
    expect(response.body.error.message).toBe(
      'effective_date 2025-12-31 is outside the policy term 2026-01-01 to 2027-01-01.',
    )
  })
})
