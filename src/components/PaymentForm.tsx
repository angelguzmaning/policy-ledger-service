'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postPayment } from '@/lib/api'
import { Button, Card, Input, Label } from '@/components/ui'
import { ErrorBanner } from '@/components/ErrorBanner'

export function PaymentForm({ policyId }: { policyId: string }) {
  // Minted at mount, not on submit -- a double-click must reuse the same key,
  // or idempotency protects nothing. Rotated only once a submit has actually
  // succeeded, so the next payment is a new payment. See docs/spec/frontend-ui.md §3.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [amountCents, setAmountCents] = useState('12099')
  const [currency, setCurrency] = useState('USD')
  const [receivedAt, setReceivedAt] = useState('2026-07-03T18:30:00Z')

  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      postPayment(policyId, {
        idempotency_key: idempotencyKey,
        external_payment_id: idempotencyKey,
        amount_cents: Number(amountCents),
        currency,
        received_at: receivedAt,
      }),
    onSuccess: () => {
      setIdempotencyKey(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
      void queryClient.invalidateQueries({ queryKey: ['ledger', policyId] })
    },
  })

  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold">Record Received Payment</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
      >
        <div>
          <Label htmlFor="amount_cents">Amount (cents)</Label>
          <Input
            id="amount_cents"
            type="number"
            min={1}
            value={amountCents}
            onChange={(e) => setAmountCents(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div>
          <Label htmlFor="received_at">Received at (UTC, e.g. 2026-07-03T18:30:00Z)</Label>
          <Input
            id="received_at"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            required
          />
        </div>
        <p className="text-xs text-zinc-500">
          idempotency_key / external_payment_id: {idempotencyKey}
        </p>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Submitting…' : 'Submit'}
        </Button>
        {mutation.isError && <ErrorBanner error={mutation.error} />}
        {mutation.isSuccess && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Recorded.</p>
        )}
      </form>
    </Card>
  )
}
