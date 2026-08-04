'use client'

import type { PolicyView } from '@/lib/api'
import { Badge, Card } from '@/components/ui'

function formatCents(cents: number, currency: string): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  return `${negative ? '-' : ''}$${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`
}

export function StatusBar({ policy }: { policy: PolicyView }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">
            {policy.policy_id}{' '}
            <span className="font-normal text-zinc-500">({policy.homeowner_id})</span>
          </h1>
          <Badge tone={policy.status === 'active' ? 'success' : 'warning'}>{policy.status}</Badge>
        </div>
        <Badge tone={policy.history.valid ? 'success' : 'danger'}>
          history: {policy.history.valid ? 'OK' : 'BROKEN'}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <span>Premium: {formatCents(policy.annual_premium_cents, policy.currency)}</span>
        <span>
          Term: {policy.term_start} to {policy.term_end}
        </span>
        <span>
          Open balance:{' '}
          <span
            className={
              policy.open_balance_cents !== 0
                ? 'font-medium text-amber-700 dark:text-amber-400'
                : ''
            }
          >
            {formatCents(policy.open_balance_cents, policy.currency)}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {policy.explanation_clauses.map((clause) => (
          <p key={clause} className="text-sm text-zinc-800 dark:text-zinc-200">
            {clause}
          </p>
        ))}
      </div>
      <p className="text-sm font-medium">{policy.suggested_action}</p>
    </Card>
  )
}
