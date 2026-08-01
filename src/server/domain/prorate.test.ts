import { describe, expect, it } from 'vitest'
import { parseDate } from '@/server/domain/dates'
import { prorate } from '@/server/domain/prorate'

describe('prorate', () => {
  it("case 1 -- the brief's canonical example: +24000/yr, 2026-07-01, 365-day term", () => {
    const result = prorate({
      previousAnnualPremiumCents: 120_000,
      newAnnualPremiumCents: 144_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2026-07-01'),
    })
    expect(result).toBe(12_099)
  })

  it('case 2 -- effective on term_start: full delta, no proration loss', () => {
    const result = prorate({
      previousAnnualPremiumCents: 120_000,
      newAnnualPremiumCents: 144_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2026-01-01'),
    })
    expect(result).toBe(24_000)
  })

  it('case 3 -- effective one day before term_end: a small positive amount, never zero or negative', () => {
    const result = prorate({
      previousAnnualPremiumCents: 120_000,
      newAnnualPremiumCents: 144_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2026-12-31'),
    })
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(200)
  })

  it('case 3b -- effective exactly on term_end: zero remaining days, zero delta, never negative', () => {
    const result = prorate({
      previousAnnualPremiumCents: 120_000,
      newAnnualPremiumCents: 144_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2027-01-01'),
    })
    expect(result).toBe(0)
  })

  it('case 4 -- negative delta: negative result, magnitude rounded identically to the positive case', () => {
    const positive = prorate({
      previousAnnualPremiumCents: 120_000,
      newAnnualPremiumCents: 144_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2026-07-01'),
    })
    const negative = prorate({
      previousAnnualPremiumCents: 144_000,
      newAnnualPremiumCents: 120_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2026-07-01'),
    })
    expect(negative).toBe(-positive)
  })

  it('case 5 -- exact-half rounding, positive: rounds away from zero', () => {
    const result = prorate({
      previousAnnualPremiumCents: 0,
      newAnnualPremiumCents: 1,
      termStartDays: parseDate('2024-01-01'), // 2024 is a leap year -> 366-day term
      termEndDays: parseDate('2025-01-01'),
      effectiveDateDays: parseDate('2024-07-02'), // remaining_days = 183 = term_days / 2
    })
    expect(result).toBe(1)
  })

  it('case 6 -- exact-half rounding, negative, 366-day leap term: rounds away from zero, never -0', () => {
    const result = prorate({
      previousAnnualPremiumCents: 1,
      newAnnualPremiumCents: 0,
      termStartDays: parseDate('2024-01-01'),
      termEndDays: parseDate('2025-01-01'),
      effectiveDateDays: parseDate('2024-07-02'),
    })
    expect(result).toBe(-1)
    expect(Object.is(result, -0)).toBe(false)
  })

  it('case 7 -- zero delta: 0', () => {
    const result = prorate({
      previousAnnualPremiumCents: 120_000,
      newAnnualPremiumCents: 120_000,
      termStartDays: parseDate('2026-01-01'),
      termEndDays: parseDate('2027-01-01'),
      effectiveDateDays: parseDate('2026-07-01'),
    })
    expect(result).toBe(0)
  })

  it('case 8 -- premium large enough to overflow number mid-multiply: BigInt keeps it exact', () => {
    const previousAnnualPremiumCents = 0
    const newAnnualPremiumCents = 8_000_000_000_000_000 // under Number.MAX_SAFE_INTEGER itself
    const remainingDays = 300
    const termDays = 365

    const result = prorate({
      previousAnnualPremiumCents,
      newAnnualPremiumCents,
      termStartDays: 0,
      termEndDays: termDays,
      effectiveDateDays: termDays - remainingDays,
    })

    const expected = Number(
      (2n * BigInt(newAnnualPremiumCents) * BigInt(remainingDays) + BigInt(termDays)) /
        (2n * BigInt(termDays)),
    )
    expect(result).toBe(expected)
    expect(Number.isSafeInteger(result)).toBe(true)
  })

  it('case 9 -- single-day term: no division by zero', () => {
    const result = prorate({
      previousAnnualPremiumCents: 0,
      newAnnualPremiumCents: 100,
      termStartDays: 0,
      termEndDays: 1,
      effectiveDateDays: 0,
    })
    expect(result).toBe(100)
  })

  it('case 10 -- every result above is a safe integer', () => {
    const cases: number[] = [
      prorate({
        previousAnnualPremiumCents: 120_000,
        newAnnualPremiumCents: 144_000,
        termStartDays: parseDate('2026-01-01'),
        termEndDays: parseDate('2027-01-01'),
        effectiveDateDays: parseDate('2026-07-01'),
      }),
      prorate({
        previousAnnualPremiumCents: 144_000,
        newAnnualPremiumCents: 120_000,
        termStartDays: parseDate('2026-01-01'),
        termEndDays: parseDate('2027-01-01'),
        effectiveDateDays: parseDate('2026-07-01'),
      }),
    ]
    for (const value of cases) expect(Number.isSafeInteger(value)).toBe(true)
  })

  it('rejects a term where term_end is not after term_start', () => {
    expect(() =>
      prorate({
        previousAnnualPremiumCents: 0,
        newAnnualPremiumCents: 100,
        termStartDays: 10,
        termEndDays: 10,
        effectiveDateDays: 10,
      }),
    ).toThrow()
  })
})
