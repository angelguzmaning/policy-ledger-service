// Per-account statements derived from `GET /ledger`'s transactions. Client-side
// and pure: the endpoint already returns every entry (`LedgerView.transactions[]
// .entries`), so this is a regrouping of data the page has, not a second fetch.
//
// The signed convention of ADR-0002 (debits positive, credits negative) stays
// canonical all the way in; the Dr/Cr split below is presentational only, which
// is why no `CASE`-shaped sign inversion exists here -- `direction` is read, not
// recomputed, and amounts are made unsigned only at the point of display.

import type { LedgerView } from '@/lib/api'

export interface StatementRow {
  transactionId: string
  /** `posted_at` reduced to its date part -- statements are read by day, not by instant. */
  date: string
  sourceType: string
  sourceId: string
  description: string
  /** Unsigned. Exactly one of `debitCents` / `creditCents` is non-zero. */
  debitCents: number
  creditCents: number
  /** Signed running total after this row, in the ledger's own convention. */
  balanceCents: number
}

export interface AccountStatement {
  account: string
  rows: StatementRow[]
  /** Signed closing balance -- equal to `LedgerView.account_balances[account]`. */
  closingBalanceCents: number
}

/** `2026-07-01 00:00:00+00` / `2026-07-01T00:00:00Z` -> `2026-07-01`. */
function toDate(postedAt: string): string {
  return postedAt.slice(0, 10)
}

/**
 * One statement per account that has movements, in the order the accounts first
 * appear. Accounts with no entries for this policy are absent rather than shown
 * at zero: the chart of accounts is a table, not a constant, and the API does
 * not enumerate it.
 *
 * Rows are oldest-first, following the transaction order the endpoint already
 * sorted by (`posted_at, ledger_transaction_id`), so the running balance
 * accumulates in the same order it renders.
 */
export function buildAccountStatements(ledger: LedgerView): AccountStatement[] {
  const statements = new Map<string, AccountStatement>()

  for (const transaction of ledger.transactions) {
    for (const entry of transaction.entries) {
      let statement = statements.get(entry.account)
      if (!statement) {
        statement = { account: entry.account, rows: [], closingBalanceCents: 0 }
        statements.set(entry.account, statement)
      }

      statement.closingBalanceCents += entry.amount_cents
      statement.rows.push({
        transactionId: transaction.id,
        date: toDate(transaction.posted_at),
        sourceType: transaction.source_type,
        sourceId: transaction.source_id,
        description: transaction.description,
        debitCents: entry.direction === 'debit' ? entry.amount_cents : 0,
        creditCents: entry.direction === 'credit' ? -entry.amount_cents : 0,
        balanceCents: statement.closingBalanceCents,
      })
    }
  }

  return [...statements.values()]
}
