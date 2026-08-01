// PROTOTYPE — throwaway. Variant C: raw log / terminal. Tests whether showing the API's
// JSON verbatim is actually persuasive for this audience — every mutation appends its
// exact request/response to a scrolling log instead of hiding it behind formatted UI.
'use client'

import { useState } from 'react'
import { formatMoney, type EndorsementInput, type PaymentInput } from './mock-api'
import { usePolicyDemo } from './usePolicyDemo'
import { useEndorsementForm, usePaymentForm } from './useDemoForms'

type LogLine = { id: string; command: string; request: unknown; response: unknown; ok: boolean }

export function VariantC() {
  const {
    policy,
    endorsementState,
    paymentState,
    submitEndorsement,
    submitPayment,
    simulateTamper,
    reset,
  } = usePolicyDemo()
  const [log, setLog] = useState<LogLine[]>([])

  const endorsementForm = useEndorsementForm((input: EndorsementInput) => {
    submitEndorsement(input)
    setLog((l) => [
      ...l,
      {
        id: input.idempotency_key,
        command: 'POST /endorsements',
        request: input,
        response: null,
        ok: true,
      },
    ])
  })
  const paymentForm = usePaymentForm((input: PaymentInput) => {
    submitPayment(input)
    setLog((l) => [
      ...l,
      {
        id: input.idempotency_key,
        command: 'POST /payments',
        request: input,
        response: null,
        ok: true,
      },
    ])
  })

  const lastState = endorsementState.status !== 'idle' ? endorsementState : paymentState

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 bg-black p-6 font-mono text-sm text-emerald-300">
      <div className="border border-emerald-800 p-3">
        <p className="text-emerald-500">GET /api/policies/{policy.policy_id}</p>
        <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-emerald-200">
          {JSON.stringify(
            {
              policy_id: policy.policy_id,
              status: policy.status,
              currency: policy.currency,
              annual_premium_cents: policy.annual_premium_cents,
              open_balance_cents: policy.open_balance_cents,
              history: policy.history,
              explanation: policy.explanation,
              suggested_action: policy.suggested_action,
            },
            null,
            2,
          )}
        </pre>
        <div className="mt-2 flex gap-3 text-xs text-emerald-600">
          <button
            type="button"
            onClick={simulateTamper}
            className="underline decoration-dotted hover:text-emerald-400"
          >
            $ corrupt-history --demo
          </button>
          <button
            type="button"
            onClick={reset}
            className="underline decoration-dotted hover:text-emerald-400"
          >
            $ reset --demo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <form onSubmit={endorsementForm.submit} className="border border-emerald-800 p-3">
          <p className="text-emerald-500">$ post /endorsements \</p>
          <p className="text-xs text-emerald-600">
            -d idempotency_key={endorsementForm.idempotencyKey}
          </p>
          <label className="mt-2 block text-xs">
            effective_date=
            <input
              type="date"
              value={endorsementForm.effectiveDate}
              onChange={(e) => endorsementForm.setEffectiveDate(e.target.value)}
              className="border border-emerald-800 bg-black px-1 text-emerald-200"
            />
          </label>
          <label className="mt-1 block text-xs">
            new_annual_premium_cents=
            <input
              type="number"
              value={endorsementForm.newAnnualPremiumCents}
              onChange={(e) => endorsementForm.setNewAnnualPremiumCents(Number(e.target.value))}
              className="w-28 border border-emerald-800 bg-black px-1 text-emerald-200"
            />
          </label>
          <button
            type="submit"
            className="mt-2 border border-emerald-500 px-2 py-1 text-emerald-300 hover:bg-emerald-900"
          >
            {endorsementState.status === 'pending' ? 'sending…' : 'send'}
          </button>
        </form>

        <form onSubmit={paymentForm.submit} className="border border-emerald-800 p-3">
          <p className="text-emerald-500">$ post /payments \</p>
          <p className="text-xs text-emerald-600">
            -d idempotency_key={paymentForm.idempotencyKey}
          </p>
          <label className="mt-2 block text-xs">
            amount_cents=
            <input
              type="number"
              value={paymentForm.amountCents}
              onChange={(e) => paymentForm.setAmountCents(Number(e.target.value))}
              className="w-24 border border-emerald-800 bg-black px-1 text-emerald-200"
            />
          </label>
          <label className="mt-1 block text-xs">
            currency=
            <input
              value={paymentForm.currency}
              onChange={(e) => paymentForm.setCurrency(e.target.value.toUpperCase())}
              className="w-16 border border-emerald-800 bg-black px-1 text-emerald-200"
            />
          </label>
          <button
            type="submit"
            className="mt-2 border border-emerald-500 px-2 py-1 text-emerald-300 hover:bg-emerald-900"
          >
            {paymentState.status === 'pending' ? 'sending…' : 'send'}
          </button>
        </form>
      </div>

      {lastState.status !== 'idle' && (
        <div className="border border-emerald-800 p-3">
          <p className={lastState.status === 'error' ? 'text-red-400' : 'text-emerald-500'}>
            {lastState.status === 'pending'
              ? '// awaiting response…'
              : lastState.status === 'error'
                ? `// ${lastState.status_code} ${lastState.error.code}`
                : `// 200/201 ${lastState.message}`}
          </p>
          {lastState.status === 'error' && (
            <pre className="mt-1 text-xs whitespace-pre-wrap text-red-300">
              {JSON.stringify({ error: lastState.error }, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto border border-emerald-900 p-3 text-xs">
        <p className="text-emerald-600">-- request log ({log.length}) --</p>
        {log
          .slice()
          .reverse()
          .map((line) => (
            <div
              key={`${line.command}-${line.id}`}
              className="mt-2 border-t border-emerald-900 pt-2"
            >
              <p className="text-emerald-500">{line.command}</p>
              <pre className="whitespace-pre-wrap text-emerald-300">
                {JSON.stringify(line.request, null, 2)}
              </pre>
            </div>
          ))}
      </div>

      <p className="text-emerald-700">
        balance {formatMoney(policy.open_balance_cents, policy.currency)} · endorsements{' '}
        {policy.endorsements.length} · payments {policy.payments.length}
      </p>
    </div>
  )
}
