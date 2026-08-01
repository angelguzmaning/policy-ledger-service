import { describe, expect, it } from 'vitest'
import { parseDate } from '@/server/domain/dates'

describe('parseDate', () => {
  it('parses a valid date to a stable epoch-day integer', () => {
    expect(parseDate('1970-01-01')).toBe(0)
    expect(parseDate('1970-01-02')).toBe(1)
    expect(parseDate('1969-12-31')).toBe(-1)
  })

  it('is consistent across a full year, leap and non-leap', () => {
    expect(parseDate('2027-01-01') - parseDate('2026-01-01')).toBe(365) // 2026 not leap
    expect(parseDate('2025-01-01') - parseDate('2024-01-01')).toBe(366) // 2024 is leap
  })

  it('rejects malformed shapes', () => {
    expect(() => parseDate('2026-7-1')).toThrow()
    expect(() => parseDate('2026/07/01')).toThrow()
    expect(() => parseDate('2026-07-01T00:00:00Z')).toThrow()
    expect(() => parseDate('')).toThrow()
  })

  it('rejects out-of-range months', () => {
    expect(() => parseDate('2026-13-01')).toThrow()
    expect(() => parseDate('2026-00-01')).toThrow()
  })

  it('rejects non-existent calendar dates', () => {
    expect(() => parseDate('2026-02-30')).toThrow()
    expect(() => parseDate('2026-02-29')).toThrow() // 2026 not leap
    expect(() => parseDate('2024-02-29')).not.toThrow() // 2024 is leap
    expect(() => parseDate('2026-04-31')).toThrow()
  })
})
