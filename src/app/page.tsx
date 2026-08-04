'use client'

import { useQuery } from '@tanstack/react-query'
import { DEMO_POLICY_ID, fetchLedger, fetchPolicy } from '@/lib/api'
import { StatusBar } from '@/components/StatusBar'
import { Timeline } from '@/components/Timeline'
import { LedgerPanel } from '@/components/LedgerPanel'
import { AccountStatements } from '@/components/AccountStatements'
import { EndorsementForm } from '@/components/EndorsementForm'
import { PaymentForm } from '@/components/PaymentForm'
import { ErrorBanner } from '@/components/ErrorBanner'

export default function Home() {
  const policyId = DEMO_POLICY_ID

  const policyQuery = useQuery({
    queryKey: ['policy', policyId],
    queryFn: () => fetchPolicy(policyId),
  })
  const ledgerQuery = useQuery({
    queryKey: ['ledger', policyId],
    queryFn: () => fetchLedger(policyId),
    enabled: policyQuery.isSuccess,
  })

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <h1 className="sr-only">Policy Ledger Operator Console</h1>

      {policyQuery.isLoading && <p className="text-sm text-zinc-500">Loading policy…</p>}
      {policyQuery.isError && <ErrorBanner error={policyQuery.error} />}

      {policyQuery.data && (
        <>
          <StatusBar policy={policyQuery.data} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Timeline policy={policyQuery.data} />
              <LedgerPanel policyId={policyId} ledger={ledgerQuery.data} />
            </div>
            <div className="flex flex-col gap-4">
              <EndorsementForm policyId={policyId} />
              <PaymentForm policyId={policyId} />
            </div>
          </div>

          {/* Full-width, below the split console rather than inside the ledger
              panel: the drill-down is a second reading of the same numbers, not
              part of the one-screen demo flow. */}
          <hr className="mt-2 border-zinc-200 dark:border-zinc-800" />
          <AccountStatements ledger={ledgerQuery.data} />
        </>
      )}
    </main>
  )
}
