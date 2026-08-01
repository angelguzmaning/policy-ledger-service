import { describe, expect, it } from 'vitest'
import { formatMoney } from '@/server/domain/formatMoney'

describe('formatMoney', () => {
  it('formats zero', () => {
    expect(formatMoney(0, 'USD')).toBe('$0.00 USD')
  })

  it('formats a sub-dollar amount', () => {
    expect(formatMoney(5, 'USD')).toBe('$0.05 USD')
  })

  it('formats an exact dollar amount', () => {
    expect(formatMoney(100, 'USD')).toBe('$1.00 USD')
  })

  it('inserts a thousands separator', () => {
    expect(formatMoney(144_000, 'USD')).toBe('$1,440.00 USD')
  })

  it('formats a negative amount', () => {
    expect(formatMoney(-7901, 'USD')).toBe('-$79.01 USD')
  })

  it('formats a value above MAX_SAFE_INTEGER cents without precision loss in the sign/major split', () => {
    const cents = Number.MAX_SAFE_INTEGER + 100 // still an exact integer-valued double
    expect(formatMoney(cents, 'USD')).toBe(
      `$${(BigInt(cents) / 100n).toLocaleString('en-US')}.${String(BigInt(cents) % 100n).padStart(2, '0')} USD`,
    )
  })

  it('rejects a non-integer', () => {
    expect(() => formatMoney(1.5, 'USD')).toThrow()
  })
})
