// PROTOTYPE — throwaway. Variant A: split console. One status bar, a chronological
// left-hand timeline merging events/billing/payments/ledger, forms stacked on the right.
'use client'

import { formatMoney, type EndorsementInput, type PaymentInput } from './mock-api'
import type { MutationState } from './usePolicyDemo'
import { usePolicyDemo } from './usePolicyDemo'
import { useEndorsementForm, usePaymentForm } from './useDemoForms'

function MutationBanner({ state }: { state: MutationState }) {
  if (state.status === 'idle' || state.status === 'pending') return null
  if (state.status === 'error') {
    return (
      <p className="mt-2 rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
        {state.status_code} {state.error.code} — {state.error.message}
      </p>
    )
  }
  return (
    <p className="mt-2 rounded border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
      {state.message}
    </p>
  )
}

export function VariantA() {
  const {
    policy,
    endorsementState,
    paymentState,
    submitEndorsement,
    submitPayment,
    simulateTamper,
    reset,
  } = usePolicyDemo()
  const endorsementForm = useEndorsementForm((input: EndorsementInput) => submitEndorsement(input))
  const paymentForm = usePaymentForm((input: PaymentInput) => submitPayment(input))

  type TimelineRow = { key: string; when: string; label: string }
  const timeline: TimelineRow[] = [
    { key: 'created', when: policy.term_start, label: 'policy_created — policy opened' },
    ...policy.endorsements.map((e) => ({
      key: e.id,
      when: e.effective_date,
      label: `${e.id} — premium delta ${formatMoney(e.delta_cents, policy.currency)}${e.billing_document ? ` → ${e.billing_document.id} (${e.billing_document.status})` : ' (no billing doc)'}`,
    })),
    ...policy.payments.map((p) => ({
      key: p.external_payment_id,
      when: '—',
      label: `${p.external_payment_id} — ${formatMoney(p.amount_cents, policy.currency)} received, ${p.status}`,
    })),
  ]

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">
            {policy.policy_id}{' '}
            <span className="text-sm font-normal text-zinc-500">({policy.homeowner_id})</span>
          </h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              policy.history.valid
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
            }`}
          >
            history {policy.history.valid ? 'verified' : 'BROKEN'}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">status</dt>
            <dd>{policy.status}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">annual premium</dt>
            <dd>{formatMoney(policy.annual_premium_cents, policy.currency)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">term</dt>
            <dd>
              {policy.term_start} → {policy.term_end}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">open balance</dt>
            <dd
              className={
                policy.open_balance_cents > 0
                  ? 'font-semibold text-amber-700 dark:text-amber-400'
                  : ''
              }
            >
              {formatMoney(policy.open_balance_cents, policy.currency)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{policy.explanation}</p>
        <p className="mt-1 text-sm font-medium">{policy.suggested_action}</p>
        <div className="mt-2 flex gap-2 text-xs">
          <button
            type="button"
            onClick={simulateTamper}
            className="rounded border border-dashed border-zinc-400 px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            corrupt history (demo)
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-dashed border-zinc-400 px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            reset demo
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase">Timeline</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {timeline.map((row) => (
              <li key={row.key} className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-700">
                <span className="text-zinc-400">{row.when}</span> — {row.label}
              </li>
            ))}
          </ol>
          {policy.rejected_events.length > 0 && (
            <div className="mt-3 border-t border-zinc-200 pt-2 text-sm text-red-700 dark:border-zinc-800 dark:text-red-400">
              rejected: {policy.rejected_events.map((r) => `${r.id} (${r.reason})`).join(', ')}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <form
            onSubmit={endorsementForm.submit}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">Apply Endorsement</h2>
            <p className="mt-1 font-mono text-xs text-zinc-400">
              idempotency_key: {endorsementForm.idempotencyKey}
            </p>
            <label className="mt-2 block text-sm">
              effective_date
              <input
                type="date"
                value={endorsementForm.effectiveDate}
                onChange={(e) => endorsementForm.setEffectiveDate(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="mt-2 block text-sm">
              new annual premium (cents)
              <input
                type="number"
                value={endorsementForm.newAnnualPremiumCents}
                onChange={(e) => endorsementForm.setNewAnnualPremiumCents(Number(e.target.value))}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <button
              type="submit"
              disabled={endorsementState.status === 'pending'}
              className="mt-3 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {endorsementState.status === 'pending' ? 'Submitting…' : 'Submit endorsement'}
            </button>
            <MutationBanner state={endorsementState} />
          </form>

          <form
            onSubmit={paymentForm.submit}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2 className="text-sm font-semibold text-zinc-500 uppercase">
              Record Received Payment
            </h2>
            <p className="mt-1 font-mono text-xs text-zinc-400">
              idempotency_key: {paymentForm.idempotencyKey}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-sm">
                amount (cents)
                <input
                  type="number"
                  value={paymentForm.amountCents}
                  onChange={(e) => paymentForm.setAmountCents(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="text-sm">
                currency
                <input
                  value={paymentForm.currency}
                  onChange={(e) => paymentForm.setCurrency(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={paymentState.status === 'pending'}
              className="mt-3 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {paymentState.status === 'pending' ? 'Submitting…' : 'Record payment'}
            </button>
            <MutationBanner state={paymentState} />
          </form>
        </div>
      </div>
    </div>
  )
}
