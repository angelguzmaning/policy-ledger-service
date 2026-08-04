import { describe, expect, it } from 'vitest'
import { buildAccountStatements } from '@/lib/accountStatements'
import type { LedgerView } from '@/lib/api'

/** The screenshot's state: one +120.99 endorsement, then a 100.00 payment. */
function ledger(): LedgerView {
  return {
    policy_id: 'POL-1001',
    currency: 'USD',
    transactions: [
      {
        id: 'tx-1',
        source_type: 'endorsement',
        source_id: 'END-2001',
        description: 'endorsement END-2001',
        posted_at: '2026-07-01 09:00:00+00',
        entries: [
          { account: 'premium_receivable', amount_cents: 12_099, direction: 'debit' },
          { account: 'written_premium', amount_cents: -12_099, direction: 'credit' },
        ],
      },
      {
        id: 'tx-2',
        source_type: 'payment',
        source_id: 'PAY-9001',
        description: 'payment PAY-9001',
        posted_at: '2026-07-14 12:30:00+00',
        entries: [
          { account: 'cash', amount_cents: 10_000, direction: 'debit' },
          { account: 'premium_receivable', amount_cents: -10_000, direction: 'credit' },
        ],
      },
    ],
    account_balances: { premium_receivable: 2_099, written_premium: -12_099, cash: 10_000 },
    sum_all_entries: 0,
    unbalanced_transactions: [],
  }
}

function statementFor(view: LedgerView, account: string) {
  const statement = buildAccountStatements(view).find((s) => s.account === account)
  if (!statement) throw new Error(`no statement for ${account}`)
  return statement
}

describe('buildAccountStatements', () => {
  it('reconciles: every closing balance equals the endpoint own account_balances', () => {
    const view = ledger()
    for (const statement of buildAccountStatements(view)) {
      expect(statement.closingBalanceCents).toBe(view.account_balances[statement.account])
    }
  })

  it('accumulates the running balance oldest-first, in row order', () => {
    const rows = statementFor(ledger(), 'premium_receivable').rows
    expect(rows.map((r) => r.balanceCents)).toEqual([12_099, 2_099])
    expect(rows.map((r) => r.date)).toEqual(['2026-07-01', '2026-07-14'])
  })

  it('splits Dr/Cr by direction and makes amounts unsigned', () => {
    const [debitRow, creditRow] = statementFor(ledger(), 'premium_receivable').rows
    expect(debitRow).toMatchObject({ debitCents: 12_099, creditCents: 0 })
    expect(creditRow).toMatchObject({ debitCents: 0, creditCents: 10_000 })
  })

  it('leaves a credit-normal account signed negative -- the sign convention is not flipped', () => {
    const statement = statementFor(ledger(), 'written_premium')
    expect(statement.closingBalanceCents).toBe(-12_099)
    expect(statement.rows[0]).toMatchObject({ debitCents: 0, creditCents: 12_099 })
  })

  it('omits accounts with no movements rather than showing them at zero', () => {
    const view = ledger()
    view.transactions = view.transactions.slice(0, 1) // endorsement only, no payment
    expect(buildAccountStatements(view).map((s) => s.account)).toEqual([
      'premium_receivable',
      'written_premium',
    ])
  })

  it('returns nothing for a policy with no ledger transactions', () => {
    const view = ledger()
    view.transactions = []
    expect(buildAccountStatements(view)).toEqual([])
  })

  it('carries source provenance onto every row', () => {
    expect(statementFor(ledger(), 'cash').rows[0]).toMatchObject({
      sourceType: 'payment',
      sourceId: 'PAY-9001',
      description: 'payment PAY-9001',
    })
  })
})
