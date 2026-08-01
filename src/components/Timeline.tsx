'use client'

import type { PolicyView } from '@/lib/api'
import { Badge, Card } from '@/components/ui'

function statusTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'paid' || status === 'applied') return 'success'
  if (status === 'partially_paid' || status === 'partially_applied') return 'warning'
  return 'neutral'
}

export function Timeline({ policy }: { policy: PolicyView }) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">Timeline</h2>
      <div className="flex flex-col gap-2 text-sm">
        {policy.endorsements.length === 0 && policy.payments.length === 0 && (
          <p className="text-zinc-500">No endorsements or payments yet.</p>
        )}

        {policy.endorsements.map((e) => (
          <div key={e.id} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">Endorsement {e.id}</span>
              <Badge>{e.idempotency_result}</Badge>
            </div>
            <div className="text-zinc-600 dark:text-zinc-400">
              effective {e.effective_date}, delta {(e.delta_cents / 100).toFixed(2)}
            </div>
            {e.billing_document && (
              <div className="mt-1 flex items-center gap-2">
                <span>
                  {e.billing_document.id} ({e.billing_document.type})
                </span>
                <Badge tone={statusTone(e.billing_document.status)}>
                  {e.billing_document.status}
                </Badge>
              </div>
            )}
          </div>
        ))}

        {policy.payments.map((p) => (
          <div
            key={p.external_payment_id}
            className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">Payment {p.external_payment_id}</span>
              <Badge>{p.idempotency_result}</Badge>
            </div>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <span>{(p.amount_cents / 100).toFixed(2)}</span>
              <Badge tone={statusTone(p.status)}>{p.status}</Badge>
            </div>
          </div>
        ))}

        {policy.rejected_events.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
            <span className="font-medium">Rejected requests</span>
            <ul className="list-inside list-disc">
              {policy.rejected_events.map((r) => (
                <li key={r.id}>
                  {r.id}: {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
