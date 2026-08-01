// PROTOTYPE — throwaway. Form state shared across variants so each variant is free to
// render different markup while keeping the one load-bearing rule identical everywhere:
// the idempotency key is minted at form mount (#7), not at submit.
'use client'

import { useState } from 'react'
import type { EndorsementInput, PaymentInput } from './mock-api'

export function useEndorsementForm(onSubmit: (input: EndorsementInput) => void) {
  const [idempotencyKey] = useState(() => `END-${crypto.randomUUID().slice(0, 8)}`)
  const [effectiveDate, setEffectiveDate] = useState('2026-07-01')
  const [newAnnualPremiumCents, setNewAnnualPremiumCents] = useState(144_000)
  const [reason, setReason] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const input: EndorsementInput =
      reason.trim().length > 0
        ? {
            idempotency_key: idempotencyKey,
            effective_date: effectiveDate,
            new_annual_premium_cents: newAnnualPremiumCents,
            reason: reason.trim(),
          }
        : {
            idempotency_key: idempotencyKey,
            effective_date: effectiveDate,
            new_annual_premium_cents: newAnnualPremiumCents,
          }
    onSubmit(input)
  }

  return {
    idempotencyKey,
    effectiveDate,
    setEffectiveDate,
    newAnnualPremiumCents,
    setNewAnnualPremiumCents,
    reason,
    setReason,
    submit,
  }
}

export function usePaymentForm(onSubmit: (input: PaymentInput) => void) {
  const [idempotencyKey] = useState(() => `PAY-${crypto.randomUUID().slice(0, 8)}`)
  const [externalPaymentId, setExternalPaymentId] = useState(() => idempotencyKey)
  const [amountCents, setAmountCents] = useState(12_099)
  const [currency, setCurrency] = useState('USD')
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 19) + 'Z')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      idempotency_key: idempotencyKey,
      external_payment_id: externalPaymentId,
      amount_cents: amountCents,
      currency,
      received_at: receivedAt,
    })
  }

  return {
    idempotencyKey,
    externalPaymentId,
    setExternalPaymentId,
    amountCents,
    setAmountCents,
    currency,
    setCurrency,
    receivedAt,
    setReceivedAt,
    submit,
  }
}
