import { describe, expect, it } from 'vitest'
import { allocate, postEndorsement, postPayment, sweepRemainders } from '@/server/domain/ledger'

function sum(entries: { amountCents: number }[]): number {
  return entries.reduce((acc, e) => acc + e.amountCents, 0)
}

describe('postEndorsement', () => {
  it('case 1 -- positive delta: DR premium_receivable / CR written_premium, sum 0, 2 legs', () => {
    const entries = postEndorsement(12_099)
    expect(entries).toHaveLength(2)
    expect(sum(entries)).toBe(0)
    const receivable = entries.find((e) => e.account === 'premium_receivable')
    const written = entries.find((e) => e.account === 'written_premium')
    expect(receivable?.amountCents).toBe(12_099)
    expect(written?.amountCents).toBe(-12_099)
  })

  it('case 2 -- negative delta: same two accounts, signs reversed -- one code path, both signs', () => {
    const entries = postEndorsement(-12_099)
    expect(sum(entries)).toBe(0)
    const receivable = entries.find((e) => e.account === 'premium_receivable')
    const written = entries.find((e) => e.account === 'written_premium')
    expect(receivable?.amountCents).toBe(-12_099) // credit
    expect(written?.amountCents).toBe(12_099) // debit
  })

  it('case 5 -- no entry has amount_cents 0; zero delta is rejected outright', () => {
    expect(() => postEndorsement(0)).toThrow()
  })
})

describe('postPayment', () => {
  it('case 3 -- DR cash / CR premium_receivable', () => {
    const entries = postPayment(12_099)
    expect(sum(entries)).toBe(0)
    const cash = entries.find((e) => e.account === 'cash')
    const receivable = entries.find((e) => e.account === 'premium_receivable')
    expect(cash?.amountCents).toBe(12_099)
    expect(receivable?.amountCents).toBe(-12_099)
  })

  it('case 5 -- rejects a non-positive amount', () => {
    expect(() => postPayment(0)).toThrow()
    expect(() => postPayment(-1)).toThrow()
  })
})

describe('case 4 -- every builder output sums to zero with at least 2 legs', () => {
  it.each([[postEndorsement(12_099)], [postEndorsement(-500)], [postPayment(1)]])(
    'balances',
    (entries) => {
      expect(sum(entries)).toBe(0)
      expect(entries.length).toBeGreaterThanOrEqual(2)
    },
  )
})

describe('allocate', () => {
  it('case 1 -- exact settlement of one document', () => {
    const result = allocate(
      [
        {
          billingDocumentId: 'BILL-3001',
          dueDate: '2026-07-01',
          issuedAt: '2026-07-01T00:00:00Z',
          openAmountCents: 12_099,
        },
      ],
      12_099,
    )
    expect(result.applications).toEqual([{ billingDocumentId: 'BILL-3001', amountCents: 12_099 }])
    expect(result.unappliedCents).toBe(0)
  })

  it('case 2 -- partial payment: one application for the full payment, document stays open', () => {
    const result = allocate(
      [
        {
          billingDocumentId: 'BILL-3001',
          dueDate: '2026-07-01',
          issuedAt: '2026-07-01T00:00:00Z',
          openAmountCents: 12_099,
        },
      ],
      5_000,
    )
    expect(result.applications).toEqual([{ billingDocumentId: 'BILL-3001', amountCents: 5_000 }])
    expect(result.unappliedCents).toBe(0)
  })

  it('case 3 -- overpayment across two documents settled in due_date order, remainder unapplied', () => {
    const result = allocate(
      [
        {
          billingDocumentId: 'BILL-3002',
          dueDate: '2026-08-01',
          issuedAt: '2026-08-01T00:00:00Z',
          openAmountCents: 5_000,
        },
        {
          billingDocumentId: 'BILL-3001',
          dueDate: '2026-07-01',
          issuedAt: '2026-07-01T00:00:00Z',
          openAmountCents: 12_099,
        },
      ],
      20_000,
    )
    expect(result.applications).toEqual([
      { billingDocumentId: 'BILL-3001', amountCents: 12_099 },
      { billingDocumentId: 'BILL-3002', amountCents: 5_000 },
    ])
    expect(result.unappliedCents).toBe(20_000 - 12_099 - 5_000)
  })

  it('case 4 -- no open documents: zero applications, all unapplied', () => {
    const result = allocate([], 1_000)
    expect(result.applications).toEqual([])
    expect(result.unappliedCents).toBe(1_000)
  })

  it('case 5 -- ties on due_date broken by issued_at then id, deterministically', () => {
    const result = allocate(
      [
        {
          billingDocumentId: 'BILL-3003',
          dueDate: '2026-07-01',
          issuedAt: '2026-07-01T00:00:00Z',
          openAmountCents: 100,
        },
        {
          billingDocumentId: 'BILL-3001',
          dueDate: '2026-07-01',
          issuedAt: '2026-07-01T00:00:00Z',
          openAmountCents: 100,
        },
        {
          billingDocumentId: 'BILL-3002',
          dueDate: '2026-07-01',
          issuedAt: '2026-06-30T00:00:00Z',
          openAmountCents: 100,
        },
      ],
      250,
    )
    // issued_at 06-30 first (BILL-3002), then tie on issued_at 07-01 broken by id: 3001 before 3003
    expect(result.applications.map((a) => a.billingDocumentId)).toEqual([
      'BILL-3002',
      'BILL-3001',
      'BILL-3003',
    ])
    expect(result.applications[2]?.amountCents).toBe(50)
  })

  it('case 6 -- sum of applications never exceeds the payment', () => {
    const result = allocate(
      [
        {
          billingDocumentId: 'BILL-3001',
          dueDate: '2026-07-01',
          issuedAt: '2026-07-01T00:00:00Z',
          openAmountCents: 100,
        },
        {
          billingDocumentId: 'BILL-3002',
          dueDate: '2026-07-02',
          issuedAt: '2026-07-02T00:00:00Z',
          openAmountCents: 100,
        },
      ],
      1_000_000,
    )
    const applied = result.applications.reduce((acc, a) => acc + a.amountCents, 0)
    expect(applied).toBeLessThanOrEqual(1_000_000)
    expect(applied).toBe(200)
    expect(result.unappliedCents).toBe(1_000_000 - 200)
  })
})

describe('sweepRemainders', () => {
  it('case 1 -- one remainder exactly settles the new charge', () => {
    const result = sweepRemainders(5_000, [{ paymentId: 'PAY-1', remainderCents: 5_000 }])
    expect(result.applications).toEqual([{ paymentId: 'PAY-1', amountCents: 5_000 }])
    expect(result.remainingOpenCents).toBe(0)
  })

  it('case 2 -- remainder smaller than the charge: applies in full, charge stays open', () => {
    const result = sweepRemainders(5_000, [{ paymentId: 'PAY-1', remainderCents: 2_000 }])
    expect(result.applications).toEqual([{ paymentId: 'PAY-1', amountCents: 2_000 }])
    expect(result.remainingOpenCents).toBe(3_000)
  })

  it("case 3 -- two remainders draw down in the order given (receipt order is the caller's job)", () => {
    const result = sweepRemainders(3_000, [
      { paymentId: 'PAY-EARLY', remainderCents: 2_000 },
      { paymentId: 'PAY-LATE', remainderCents: 5_000 },
    ])
    expect(result.applications).toEqual([
      { paymentId: 'PAY-EARLY', amountCents: 2_000 },
      { paymentId: 'PAY-LATE', amountCents: 1_000 },
    ])
    expect(result.remainingOpenCents).toBe(0)
  })

  it('case 4 -- no remainders: nothing applied, charge stays fully open', () => {
    const result = sweepRemainders(5_000, [])
    expect(result.applications).toEqual([])
    expect(result.remainingOpenCents).toBe(5_000)
  })

  it('case 5 -- zero-remainder entries are skipped', () => {
    const result = sweepRemainders(1_000, [
      { paymentId: 'PAY-EMPTY', remainderCents: 0 },
      { paymentId: 'PAY-1', remainderCents: 1_000 },
    ])
    expect(result.applications).toEqual([{ paymentId: 'PAY-1', amountCents: 1_000 }])
    expect(result.remainingOpenCents).toBe(0)
  })

  it('case 6 -- rejects a non-positive open amount', () => {
    expect(() => sweepRemainders(0, [])).toThrow()
    expect(() => sweepRemainders(-1, [])).toThrow()
  })
})
