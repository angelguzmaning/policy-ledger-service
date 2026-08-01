// PROTOTYPE — throwaway. Variant B: card dashboard. Three summary cards up top (policy /
// balance / history), a tab bar switching between data views, actions tucked behind
// toggleable action cards instead of always-visible forms.
'use client'

import { useState } from 'react'
import { formatMoney, type EndorsementInput, type PaymentInput } from './mock-api'
import type { MutationState } from './usePolicyDemo'
import { usePolicyDemo } from './usePolicyDemo'
import { useEndorsementForm, usePaymentForm } from './useDemoForms'

type Tab = 'endorsements' | 'payments' | 'ledger'

function Card({
  title,
  children,
  tone,
}: {
  title: string
  children: React.ReactNode
  tone?: 'ok' | 'bad' | 'warn' | undefined
}) {
  const toneClass =
    tone === 'bad'
      ? 'border-red-400 bg-red-50 dark:bg-red-950'
      : tone === 'warn'
        ? 'border-amber-400 bg-amber-50 dark:bg-amber-950'
        : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function MutationLine({ state }: { state: MutationState }) {
  if (state.status === 'idle' || state.status === 'pending') return null
  return (
    <p
      className={`mt-2 text-sm ${state.status === 'error' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}
    >
      {state.status === 'error'
        ? `${state.status_code} ${state.error.code}: ${state.error.message}`
        : state.message}
    </p>
  )
}

export function VariantB() {
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
  const [tab, setTab] = useState<Tab>('endorsements')
  const [openForm, setOpenForm] = useState<'endorsement' | 'payment' | null>(null)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card title="Policy">
          <p className="text-lg font-semibold">{policy.policy_id}</p>
          <p className="text-sm text-zinc-500">{policy.homeowner_id}</p>
          <p className="mt-2 text-sm">
            {policy.status} · {formatMoney(policy.annual_premium_cents, policy.currency)}
          </p>
          <p className="text-xs text-zinc-500">
            {policy.term_start} → {policy.term_end}
          </p>
        </Card>
        <Card title="Balance" tone={policy.open_balance_cents > 0 ? 'warn' : undefined}>
          <p className="text-lg font-semibold">
            {formatMoney(policy.open_balance_cents, policy.currency)}
          </p>
          <p className="text-sm text-zinc-500">
            ledger balanced: {policy.ledger.balanced ? 'yes' : 'no'}
          </p>
        </Card>
        <Card title="History" tone={policy.history.valid ? undefined : 'bad'}>
          <p className="text-lg font-semibold">{policy.history.valid ? 'Verified' : 'BROKEN'}</p>
          <p className="text-sm text-zinc-500">
            {policy.history.valid
              ? `${policy.history.event_count} events`
              : `first break at seq ${policy.history.break.seq}`}
          </p>
          <button
            type="button"
            onClick={simulateTamper}
            className="mt-2 text-xs text-zinc-400 underline decoration-dotted"
          >
            corrupt history (demo)
          </button>
        </Card>
      </div>

      <Card title="Summary">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{policy.explanation}</p>
        <p className="mt-1 text-sm font-medium">{policy.suggested_action}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 text-xs text-zinc-400 underline decoration-dotted"
        >
          reset demo
        </button>
      </Card>

      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {(['endorsements', 'payments', 'ledger'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-zinc-900 font-medium dark:border-white' : 'text-zinc-500'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {tab === 'endorsements' &&
          (policy.endorsements.length === 0 ? (
            <p className="text-sm text-zinc-500">No endorsements yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {policy.endorsements.map((e) => (
                <li key={e.id}>
                  {e.id} · {e.effective_date} · {formatMoney(e.delta_cents, policy.currency)}
                  {e.billing_document
                    ? ` · ${e.billing_document.id} (${e.billing_document.status})`
                    : ' · no billing doc'}
                </li>
              ))}
            </ul>
          ))}
        {tab === 'payments' &&
          (policy.payments.length === 0 ? (
            <p className="text-sm text-zinc-500">No payments yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {policy.payments.map((p) => (
                <li key={p.external_payment_id}>
                  {p.external_payment_id} · {formatMoney(p.amount_cents, policy.currency)} ·{' '}
                  {p.status}
                </li>
              ))}
            </ul>
          ))}
        {tab === 'ledger' &&
          (policy.ledger.transactions.length === 0 ? (
            <p className="text-sm text-zinc-500">No ledger transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500">
                <tr>
                  <th className="pb-1">source</th>
                  <th className="pb-1">debits</th>
                  <th className="pb-1">credits</th>
                </tr>
              </thead>
              <tbody>
                {policy.ledger.transactions.map((tx) => (
                  <tr key={tx.source} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1">{tx.source}</td>
                    <td className="py-1">{formatMoney(tx.debits_cents, policy.currency)}</td>
                    <td className="py-1">{formatMoney(tx.credits_cents, policy.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpenForm(openForm === 'endorsement' ? null : 'endorsement')}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
        >
          Apply Endorsement
        </button>
        <button
          type="button"
          onClick={() => setOpenForm(openForm === 'payment' ? null : 'payment')}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          Record Payment
        </button>
      </div>

      {openForm === 'endorsement' && (
        <form
          onSubmit={endorsementForm.submit}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-mono text-xs text-zinc-400">
            idempotency_key: {endorsementForm.idempotencyKey}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-sm">
              effective_date
              <input
                type="date"
                value={endorsementForm.effectiveDate}
                onChange={(e) => endorsementForm.setEffectiveDate(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm">
              new annual premium (cents)
              <input
                type="number"
                value={endorsementForm.newAnnualPremiumCents}
                onChange={(e) => endorsementForm.setNewAnnualPremiumCents(Number(e.target.value))}
                className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={endorsementState.status === 'pending'}
            className="mt-3 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {endorsementState.status === 'pending' ? 'Submitting…' : 'Submit'}
          </button>
          <MutationLine state={endorsementState} />
        </form>
      )}

      {openForm === 'payment' && (
        <form
          onSubmit={paymentForm.submit}
          className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <p className="font-mono text-xs text-zinc-400">
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
            {paymentState.status === 'pending' ? 'Submitting…' : 'Submit'}
          </button>
          <MutationLine state={paymentState} />
        </form>
      )}
    </div>
  )
}
