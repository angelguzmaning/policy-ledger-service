import { describe, expect, it } from 'vitest'
import { parseEndorsement, parsePayment, parsePolicyParams } from '@/server/api/schemas'
import { InvalidRequestError, PolicyIdMismatchError } from '@/server/errors'

const endorsementSample = {
  type: 'endorsement.requested',
  idempotency_key: 'END-2001',
  policy_id: 'POL-1001',
  effective_date: '2026-07-01',
  new_annual_premium_cents: 144_000,
  reason: 'Water-shutoff discount removed',
}

const paymentSample = {
  type: 'payment.received',
  idempotency_key: 'PAY-9001',
  policy_id: 'POL-1001',
  external_payment_id: 'PAY-9001',
  amount_cents: 12_099,
  currency: 'USD',
  received_at: '2026-07-03T18:30:00Z',
}

describe('parseEndorsement', () => {
  it('case 1 -- events.json object POSTed verbatim parses; type and policy_id accepted', () => {
    const command = parseEndorsement('POL-1001', endorsementSample)
    expect(command).toEqual({
      idempotency_key: 'END-2001',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 144_000,
      reason: 'Water-shutoff discount removed',
    })
  })

  it('case 2 -- the strip: same object with type omitted produces an identical command', () => {
    const { type: _type, ...withoutType } = endorsementSample
    const withType = parseEndorsement('POL-1001', endorsementSample)
    const withoutTypeParsed = parseEndorsement('POL-1001', withoutType)
    expect(withoutTypeParsed).toEqual(withType)
  })

  it('case 3 -- unknown body key fails with the offending path', () => {
    try {
      parseEndorsement('POL-1001', { ...endorsementSample, foo: 1 })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError)
      expect((error as InvalidRequestError).details[0]?.path).toBe('foo')
    }
  })

  it('fails on a non-integer new_annual_premium_cents', () => {
    expect(() =>
      parseEndorsement('POL-1001', { ...endorsementSample, new_annual_premium_cents: 120.5 }),
    ).toThrow(InvalidRequestError)
  })

  it('case 7 -- PolicyIdMismatch when body policy_id disagrees with the path', () => {
    expect(() => parseEndorsement('POL-9999', endorsementSample)).toThrow(PolicyIdMismatchError)
  })
})

describe('parsePayment', () => {
  it('case 1 -- events.json object POSTed verbatim parses', () => {
    const command = parsePayment('POL-1001', paymentSample)
    expect(command).toEqual({
      idempotency_key: 'PAY-9001',
      external_payment_id: 'PAY-9001',
      amount_cents: 12_099,
      currency: 'USD',
      received_at: '2026-07-03T18:30:00Z',
    })
  })

  it('case 4 -- amount_cents 120.5 fails on amount_cents', () => {
    try {
      parsePayment('POL-1001', { ...paymentSample, amount_cents: 120.5 })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRequestError)
      expect((error as InvalidRequestError).details[0]?.path).toBe('amount_cents')
    }
  })

  it('case 5 -- received_at with milliseconds fails: one legal rendering only', () => {
    expect(() =>
      parsePayment('POL-1001', { ...paymentSample, received_at: '2026-07-03T18:30:00.000Z' }),
    ).toThrow(InvalidRequestError)
  })

  it('case 6 -- currency EUR parses -- shape only, never z.literal("USD")', () => {
    expect(() => parsePayment('POL-1001', { ...paymentSample, currency: 'EUR' })).not.toThrow()
  })
})

describe('parsePolicyParams', () => {
  it('case 8 -- a 65-char path segment fails', () => {
    expect(() => parsePolicyParams({ policyId: 'x'.repeat(65) })).toThrow(InvalidRequestError)
  })

  it('an ordinary id passes', () => {
    expect(parsePolicyParams({ policyId: 'POL-1001' })).toEqual({ policyId: 'POL-1001' })
  })

  it('case 9 -- a path segment like "hello" parses: 404-dominant, not 400', () => {
    expect(() => parsePolicyParams({ policyId: 'hello' })).not.toThrow()
  })
})
