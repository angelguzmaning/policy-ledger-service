'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postEndorsement } from '@/lib/api'
import { Button, Card, Input, Label } from '@/components/ui'
import { ErrorBanner } from '@/components/ErrorBanner'

export function EndorsementForm({ policyId }: { policyId: string }) {
  // Minted at mount, not on submit -- a double-click must reuse the same key,
  // or idempotency protects nothing. Rotated only once a submit has actually
  // succeeded, so the next endorsement is a new endorsement. See docs/spec/frontend-ui.md §3.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [effectiveDate, setEffectiveDate] = useState('2026-07-01')
  const [newPremiumCents, setNewPremiumCents] = useState('144000')
  const [reason, setReason] = useState('Water-shutoff discount removed')

  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      postEndorsement(policyId, {
        idempotency_key: idempotencyKey,
        effective_date: effectiveDate,
        new_annual_premium_cents: Number(newPremiumCents),
        ...(reason ? { reason } : {}),
      }),
    onSuccess: () => {
      setIdempotencyKey(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
      void queryClient.invalidateQueries({ queryKey: ['ledger', policyId] })
    },
  })

  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">Apply Endorsement</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
      >
        <div>
          <Label htmlFor="effective_date">Effective date</Label>
          <Input
            id="effective_date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="new_annual_premium_cents">New annual premium (cents)</Label>
          <Input
            id="new_annual_premium_cents"
            type="number"
            min={1}
            value={newPremiumCents}
            onChange={(e) => setNewPremiumCents(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="reason">Reason</Label>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <p className="text-xs text-zinc-500">idempotency_key: {idempotencyKey}</p>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Submitting…' : 'Submit'}
        </Button>
        {mutation.isError && <ErrorBanner error={mutation.error} />}
        {mutation.isSuccess && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Applied.</p>
        )}
      </form>
    </Card>
  )
}
