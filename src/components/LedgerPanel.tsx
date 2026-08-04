'use client'

import { useMutation } from '@tanstack/react-query'
import { fetchVerify, type HistoryVerifyView, type LedgerView } from '@/lib/api'
import { Badge, Button, Card } from '@/components/ui'
import { ErrorBanner } from '@/components/ErrorBanner'

export function LedgerPanel({
  policyId,
  ledger,
}: {
  policyId: string
  ledger: LedgerView | undefined
}) {
  const verify = useMutation<HistoryVerifyView, unknown>({
    mutationFn: () => fetchVerify(policyId),
  })

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ledger</h2>
        <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? 'Verifying…' : 'Verify History'}
        </Button>
      </div>

      {!ledger ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          {Object.entries(ledger.account_balances).map(([account, balance]) => (
            <div key={account} className="flex justify-between">
              <span className="text-zinc-600 dark:text-zinc-400">{account}</span>
              <span className="font-mono">{(balance / 100).toFixed(2)}</span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-zinc-200 pt-1 dark:border-zinc-800">
            <span className="text-zinc-600 dark:text-zinc-400">unbalanced_transactions</span>
            <Badge tone={ledger.unbalanced_transactions.length === 0 ? 'success' : 'danger'}>
              {ledger.unbalanced_transactions.length === 0
                ? 'none'
                : ledger.unbalanced_transactions.length}
            </Badge>
          </div>
        </div>
      )}

      {verify.isError && (
        <div className="mt-2">
          <ErrorBanner error={verify.error} />
        </div>
      )}
      {verify.isSuccess && (
        <div className="mt-2 text-sm">
          <Badge tone={verify.data.valid ? 'success' : 'danger'}>
            {verify.data.valid ? `valid -- ${verify.data.event_count} events` : 'INVALID'}
          </Badge>
        </div>
      )}
    </Card>
  )
}
