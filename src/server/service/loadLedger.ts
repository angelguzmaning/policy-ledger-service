import type { Db } from '@/server/db/withTransaction'
import { PolicyNotFoundError } from '@/server/errors'

export interface LedgerEntryView {
  account: string
  amount_cents: number
  direction: 'debit' | 'credit'
}

export interface LedgerTransactionView {
  id: string
  source_type: string
  source_id: string
  description: string
  posted_at: string
  entries: LedgerEntryView[]
}

export interface LedgerView {
  policy_id: string
  currency: string
  transactions: LedgerTransactionView[]
  account_balances: Record<string, number>
  sum_all_entries: number
  unbalanced_transactions: { id: string; sum_cents: number }[]
}

interface PolicyRow {
  currency: string
}

interface TransactionRow {
  ledger_transaction_id: string
  source_type: string
  source_id: string
  description: string
  posted_at: string
}

interface EntryRow {
  ledger_transaction_id: string
  account_code: string
  amount_cents: string
}

export async function loadLedger(db: Db, policyId: string): Promise<LedgerView> {
  const { rows: policyRows } = await db.query<PolicyRow>(
    'SELECT currency FROM policies WHERE policy_id = $1',
    [policyId],
  )
  const policy = policyRows[0]
  if (!policy) throw new PolicyNotFoundError(policyId)

  const { rows: txRows } = await db.query<TransactionRow>(
    `SELECT ledger_transaction_id, source_type, source_id, description, posted_at::text AS posted_at
       FROM ledger_transactions
      WHERE policy_id = $1
      ORDER BY posted_at, ledger_transaction_id`,
    [policyId],
  )

  const { rows: entryRows } = await db.query<EntryRow>(
    `SELECT le.ledger_transaction_id, le.account_code, le.amount_cents
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.ledger_transaction_id = le.ledger_transaction_id
      WHERE lt.policy_id = $1
      ORDER BY le.ledger_entry_id`,
    [policyId],
  )

  const entriesByTransaction = new Map<string, LedgerEntryView[]>()
  const accountBalances: Record<string, number> = {}
  let sumAllEntries = 0
  const sumByTransaction = new Map<string, number>()

  for (const row of entryRows) {
    const amount = Number(row.amount_cents)
    const view: LedgerEntryView = {
      account: row.account_code,
      amount_cents: amount,
      direction: amount > 0 ? 'debit' : 'credit',
    }
    const list = entriesByTransaction.get(row.ledger_transaction_id) ?? []
    list.push(view)
    entriesByTransaction.set(row.ledger_transaction_id, list)

    accountBalances[row.account_code] = (accountBalances[row.account_code] ?? 0) + amount
    sumAllEntries += amount
    sumByTransaction.set(
      row.ledger_transaction_id,
      (sumByTransaction.get(row.ledger_transaction_id) ?? 0) + amount,
    )
  }

  const transactions: LedgerTransactionView[] = txRows.map((row) => ({
    id: row.ledger_transaction_id,
    source_type: row.source_type,
    source_id: row.source_id,
    description: row.description,
    posted_at: row.posted_at,
    entries: entriesByTransaction.get(row.ledger_transaction_id) ?? [],
  }))

  const unbalancedTransactions = [...sumByTransaction.entries()]
    .filter(([, sum]) => sum !== 0)
    .map(([id, sum]) => ({ id, sum_cents: sum }))

  return {
    policy_id: policyId,
    currency: policy.currency,
    transactions,
    account_balances: accountBalances,
    sum_all_entries: sumAllEntries,
    unbalanced_transactions: unbalancedTransactions,
  }
}
