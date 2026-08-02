'use client'

import { buildAccountStatements, type StatementRow } from '@/lib/accountStatements'
import type { LedgerView } from '@/lib/api'
import { Card } from '@/components/ui'

// Hardcoded because `ledger_accounts.normal_balance` is not exposed by the API
// (see docs/spec/frontend-ui.md §2): a label, never arithmetic -- the Dr/Cr
// split below is driven by the entry's own direction, not by this table.
const ACCOUNT_KIND: Record<string, string> = {
  cash: 'asset · debit-normal',
  premium_receivable: 'asset · debit-normal',
  written_premium: 'revenue · credit-normal',
}

function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** Balances carry their side as a label rather than a minus sign (ADR-0002's signs stay in the data). */
function balanceLabel(cents: number): string {
  if (cents === 0) return '0.00'
  return `${money(Math.abs(cents))} ${cents > 0 ? 'Dr' : 'Cr'}`
}

function StatementRows({ rows }: { rows: StatementRow[] }) {
  return (
    <tbody>
      {rows.map((row, i) => (
        <tr
          // Two legs of one transaction never share an account here, but index
          // keeps the key stable if a future multi-leg posting makes them.
          key={`${row.transactionId}-${i}`}
          className="border-t border-zinc-100 dark:border-zinc-900"
        >
          <td className="py-1 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
            {row.date}
          </td>
          <td className="py-1 pr-3 whitespace-nowrap font-medium">{row.sourceId}</td>
          <td className="py-1 pr-3 text-zinc-600 dark:text-zinc-400">{row.description}</td>
          <td className="py-1 pl-3 text-right font-mono">
            {row.debitCents === 0 ? '' : money(row.debitCents)}
          </td>
          <td className="py-1 pl-3 text-right font-mono">
            {row.creditCents === 0 ? '' : money(row.creditCents)}
          </td>
          <td className="py-1 pl-3 text-right font-mono whitespace-nowrap">
            {balanceLabel(row.balanceCents)}
          </td>
        </tr>
      ))}
    </tbody>
  )
}

export function AccountStatements({ ledger }: { ledger: LedgerView | undefined }) {
  if (!ledger) return null

  const statements = buildAccountStatements(ledger)
  if (statements.length === 0) return null

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold">Account statements</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Every movement behind each ledger balance, oldest first. Each account&rsquo;s closing
        balance is the balance shown in the Ledger panel above.
      </p>

      <div className="flex flex-col gap-5">
        {statements.map((statement) => (
          <section key={statement.account}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-mono text-sm font-semibold">{statement.account}</h3>
              <span className="text-xs text-zinc-500">{ACCOUNT_KIND[statement.account] ?? ''}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="mt-1 w-full text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500">
                    <th className="py-1 pr-3 text-left font-medium">date</th>
                    <th className="py-1 pr-3 text-left font-medium">source</th>
                    <th className="py-1 pr-3 text-left font-medium">description</th>
                    <th className="py-1 pl-3 text-right font-medium">debit</th>
                    <th className="py-1 pl-3 text-right font-medium">credit</th>
                    <th className="py-1 pl-3 text-right font-medium">balance</th>
                  </tr>
                </thead>
                <StatementRows rows={statement.rows} />
                <tfoot>
                  <tr className="border-t border-zinc-300 dark:border-zinc-700">
                    <td className="py-1 pr-3 text-zinc-600 dark:text-zinc-400" colSpan={5}>
                      closing balance
                    </td>
                    <td className="py-1 pl-3 text-right font-mono font-semibold whitespace-nowrap">
                      {balanceLabel(statement.closingBalanceCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ))}
      </div>
    </Card>
  )
}
