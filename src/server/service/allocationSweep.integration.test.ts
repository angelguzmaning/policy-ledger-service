import { describe, expect, it } from 'vitest'
import { pool } from '../../../test/db'
import { seedPolicy } from '../../../test/fixtures'
import { applyEndorsement } from '@/server/service/applyEndorsement'
import { recordPayment } from '@/server/service/recordPayment'
import { getOpenBalanceCents } from '@/server/service/shared'
import { parseDate } from '@/server/domain/dates'
import { prorate } from '@/server/domain/prorate'

const TERM_START = '2026-01-01'
const TERM_END = '2027-01-01'
const termStartDays = parseDate(TERM_START)
const termEndDays = parseDate(TERM_END)

function chargeFor(previous: number, next: number, effectiveDate: string): number {
  return prorate({
    previousAnnualPremiumCents: previous,
    newAnnualPremiumCents: next,
    termStartDays,
    termEndDays,
    effectiveDateDays: parseDate(effectiveDate),
  })
}

describe('continuous allocation: remainders sweep onto later charges (ADR-0007)', () => {
  it('D1 -- a remainder left over from an earlier payment settles a charge raised by a later endorsement', async () => {
    await seedPolicy(pool, {
      annual_premium_cents: 120_000,
      term_start: TERM_START,
      term_end: TERM_END,
    })

    const charge1 = chargeFor(120_000, 240_000, '2026-07-01')
    const end1 = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-B1',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 240_000,
    })
    expect(end1.billing_document?.amount_cents).toBe(charge1)
    expect(end1.billing_document?.status).toBe('open')

    const paymentAmount = charge1 + 40_000
    const payment = await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B1',
      external_payment_id: 'PAY-B1',
      amount_cents: paymentAmount,
      currency: 'USD',
      received_at: '2026-07-05T00:00:00Z',
    })
    expect(payment.status).toBe('partially_applied')
    const remainder = payment.unapplied_cents
    expect(remainder).toBe(40_000)

    const charge2 = chargeFor(240_000, 300_000, '2026-08-01')
    expect(charge2).toBeLessThan(remainder) // this reproduction settles the new charge in full

    const end2 = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-B2',
      effective_date: '2026-08-01',
      new_annual_premium_cents: 300_000,
    })
    // The document is not left `open` while the balance shows a credit -- the endorsement
    // response reports the post-sweep status, not the pre-sweep one.
    expect(end2.billing_document?.amount_cents).toBe(charge2)
    expect(end2.billing_document?.status).toBe('paid')

    const { rows } = await pool.query<{ payment_id: string; amount_cents: string }>(
      `SELECT payment_id, amount_cents FROM payment_applications WHERE billing_document_id = $1`,
      [end2.billing_document!.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payment_id).toBe('PAY-B1')
    expect(Number(rows[0]?.amount_cents)).toBe(charge2)

    // No ledger transaction is written for the sweep -- only the original payment transaction.
    const { rows: txRows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ledger_transactions WHERE source_type = 'payment'`,
    )
    expect(Number(txRows[0]?.n)).toBe(1)

    const openBalanceCents = await getOpenBalanceCents(pool, 'POL-1001')
    expect(openBalanceCents).toBe(-(remainder - charge2))
  })

  it('D2 -- a remainder fully consumed by a later charge reports the payment as applied, not partially_applied', async () => {
    await seedPolicy(pool, {
      annual_premium_cents: 120_000,
      term_start: TERM_START,
      term_end: TERM_END,
    })

    const charge1 = chargeFor(120_000, 200_000, '2026-07-01')
    await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-C1',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 200_000,
    })

    const payment = await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-C1',
      external_payment_id: 'PAY-C1',
      amount_cents: charge1 + 1_000,
      currency: 'USD',
      received_at: '2026-07-05T00:00:00Z',
    })
    expect(payment.status).toBe('partially_applied')
    expect(payment.unapplied_cents).toBe(1_000)

    const charge2 = chargeFor(200_000, 900_000, '2026-07-10')
    expect(charge2).toBeGreaterThan(1_000)
    await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-C2',
      effective_date: '2026-07-10',
      new_annual_premium_cents: 900_000,
    })

    const { rows } = await pool.query<{ amount_cents: string; applied_cents: string }>(
      `SELECT p.amount_cents,
              (SELECT COALESCE(SUM(pa.amount_cents), 0) FROM payment_applications pa
                WHERE pa.payment_id = p.payment_id) AS applied_cents
         FROM payments p WHERE p.payment_id = 'PAY-C1'`,
    )
    const row = rows[0]!
    expect(Number(row.applied_cents)).toBe(Number(row.amount_cents))
  })

  it('D3 -- two remainders sweep in receipt order, regardless of which payment was recorded first', async () => {
    await seedPolicy(pool, {
      annual_premium_cents: 120_000,
      term_start: TERM_START,
      term_end: TERM_END,
    })

    // PAY-B2 is recorded first but received later; PAY-B3 is recorded second but received
    // earlier. With no open charge at recording time, both leave a full remainder.
    const payB2 = await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B2',
      external_payment_id: 'PAY-B2',
      amount_cents: 10_000,
      currency: 'USD',
      received_at: '2026-09-15T00:00:00Z',
    })
    expect(payB2.status).toBe('unapplied')

    const payB3 = await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-B3',
      external_payment_id: 'PAY-B3',
      amount_cents: 20_000,
      currency: 'USD',
      received_at: '2026-08-02T00:00:00Z',
    })
    expect(payB3.status).toBe('unapplied')

    const charge = chargeFor(120_000, 220_000, '2026-10-01')
    expect(charge).toBeGreaterThan(20_000)
    expect(charge).toBeLessThan(30_000)

    const result = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-D1',
      effective_date: '2026-10-01',
      new_annual_premium_cents: 220_000,
    })
    expect(result.billing_document?.amount_cents).toBe(charge)
    expect(result.billing_document?.status).toBe('paid') // fully covered by the two remainders combined

    const { rows } = await pool.query<{ payment_id: string; amount_cents: string }>(
      `SELECT payment_id, amount_cents FROM payment_applications
        WHERE billing_document_id = $1 ORDER BY applied_at`,
      [result.billing_document!.id],
    )
    // PAY-B3 (received 2026-08-02, earlier) is drawn down first and in full; the remainder of
    // the charge then draws down PAY-B2 (received 2026-09-15, later).
    expect(rows).toHaveLength(2)
    expect(rows[0]?.payment_id).toBe('PAY-B3')
    expect(Number(rows[0]?.amount_cents)).toBe(20_000)
    expect(rows[1]?.payment_id).toBe('PAY-B2')
    expect(Number(rows[1]?.amount_cents)).toBe(charge - 20_000)
  })

  it('D4 -- a cash remainder never settles a premium credit note', async () => {
    await seedPolicy(pool, {
      annual_premium_cents: 300_000,
      term_start: TERM_START,
      term_end: TERM_END,
    })

    await recordPayment(pool, 'POL-1001', {
      idempotency_key: 'PAY-E1',
      external_payment_id: 'PAY-E1',
      amount_cents: 500_000,
      currency: 'USD',
      received_at: '2026-07-01T00:00:00Z',
    })

    const result = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-E1',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 150_000,
    })
    expect(result.delta_cents).toBeLessThan(0)
    expect(result.billing_document?.type).toBe('premium_credit')
    expect(result.billing_document?.status).toBe('issued')

    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM payment_applications WHERE billing_document_id = $1`,
      [result.billing_document!.id],
    )
    expect(Number(rows[0]?.n)).toBe(0)
  })

  it('D5 -- a premium credit note is never counted toward the open-document count driving the explanation', async () => {
    await seedPolicy(pool, {
      annual_premium_cents: 300_000,
      term_start: TERM_START,
      term_end: TERM_END,
    })

    // One unpaid charge and one credit note both exist; only the charge counts as "open".
    await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-F1',
      effective_date: '2026-06-01',
      new_annual_premium_cents: 400_000,
    })
    const credit = await applyEndorsement(pool, 'POL-1001', {
      idempotency_key: 'END-F2',
      effective_date: '2026-07-01',
      new_annual_premium_cents: 350_000,
    })
    expect(credit.billing_document?.type).toBe('premium_credit')
    expect(credit.open_balance_cents).toBeGreaterThan(0)

    const { loadPolicy } = await import('@/server/service/loadPolicy')
    const view = await loadPolicy(pool, 'POL-1001')
    expect(view.explanation).toContain('across 1 open billing document(s)')
  })
})
