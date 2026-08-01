// PROTOTYPE — throwaway. Simulates the locked API contract (docs/spec/api-contract.md,
// spec/api-contract branch) in memory so the UI-shape prototype has something real to
// react to without a running backend. Not the real service layer.

export type BillingDocument = {
  id: string
  type: 'premium_charge' | 'premium_credit'
  amount_cents: number
  status: 'open' | 'paid'
}

export type Endorsement = {
  id: string
  effective_date: string
  delta_cents: number
  billing_document: BillingDocument | null
  idempotency_result: 'applied' | 'duplicate ignored'
}

export type Payment = {
  external_payment_id: string
  amount_cents: number
  status: 'applied' | 'partially_applied' | 'unapplied'
  idempotency_result: 'applied' | 'duplicate ignored'
}

export type PolicyEventType = 'policy_created' | 'endorsement_applied' | 'payment_recorded'

export type LedgerTransaction = { source: string; debits_cents: number; credits_cents: number }

export type HistoryBreakReason =
  'event_hash_mismatch' | 'previous_hash_mismatch' | 'sequence_gap' | 'missing_genesis'

export type HistoryState =
  | { valid: true; event_count: number; events: PolicyEventType[] }
  | {
      valid: false
      event_count: number
      verified_through_seq: number
      break: { seq: number; reason: HistoryBreakReason }
    }

export type PolicySummary = {
  policy_id: string
  homeowner_id: string
  status: 'active' | 'cancelled' | 'expired'
  currency: string
  term_start: string
  term_end: string
  annual_premium_cents: number
  endorsements: Endorsement[]
  payments: Payment[]
  open_balance_cents: number
  ledger: { balanced: boolean; transactions: LedgerTransaction[] }
  history: HistoryState
  rejected_events: { id: string; reason: string }[]
  explanation: string
  suggested_action: string
}

export type ApiError = { code: string; message: string }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError }

export function formatMoney(cents: number, currency: string): string {
  const negative = cents < 0
  const abs = BigInt(negative ? -cents : cents)
  const hundred = BigInt(100)
  const major = (abs / hundred).toLocaleString('en-US')
  const minor = String(abs % hundred).padStart(2, '0')
  return `${negative ? '-' : ''}$${major}.${minor} ${currency}`
}

const DAY_MS = 86_400_000

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)
}

function prorate(
  delta_cents: number,
  effectiveDate: string,
  termStart: string,
  termEnd: string,
): number {
  const termDays = daysBetween(termStart, termEnd)
  const remainingDays = daysBetween(effectiveDate, termEnd)
  if (termDays <= 0) return 0
  const sign = delta_cents < 0 ? -1 : 1
  const magnitude = Math.abs(delta_cents) * remainingDays
  const rounded = Math.floor((2 * magnitude + termDays) / (2 * termDays))
  return sign * rounded
}

function explain(policy: Omit<PolicySummary, 'explanation' | 'suggested_action'>): {
  explanation: string
  suggested_action: string
} {
  const premium = formatMoney(policy.annual_premium_cents, policy.currency)
  const parts = [
    `Policy ${policy.policy_id} is ${policy.status} with an annual premium of ${premium} for the term ${policy.term_start} to ${policy.term_end}.`,
  ]

  const latest = policy.endorsements.at(-1)
  if (latest) {
    if (latest.delta_cents === 0) {
      parts.push(
        `${policy.endorsements.length} endorsement(s) have been applied, most recently ${latest.id} effective ${latest.effective_date}, which left the annual premium unchanged and produced no billing document.`,
      )
    } else {
      const direction = latest.delta_cents > 0 ? 'raised' : 'lowered'
      parts.push(
        `${policy.endorsements.length} endorsement(s) have been applied, most recently ${latest.id} effective ${latest.effective_date}, which ${direction} the annual premium by ${formatMoney(Math.abs(latest.delta_cents), policy.currency)} and billed ${formatMoney(Math.abs(latest.delta_cents), policy.currency)} pro-rata.`,
      )
    }
  }

  if (policy.open_balance_cents > 0) {
    const openDocs = policy.endorsements.filter((e) => e.billing_document?.status === 'open').length
    parts.push(
      `${formatMoney(policy.open_balance_cents, policy.currency)} is currently outstanding across ${openDocs} open billing document(s).`,
    )
  } else if (policy.open_balance_cents === 0) {
    parts.push('The account is fully paid; there is no outstanding balance.')
  } else {
    parts.push(
      `The account holds a credit of ${formatMoney(Math.abs(policy.open_balance_cents), policy.currency)}, which will offset future charges. No refund is issued by this system.`,
    )
  }

  if (policy.history.valid) {
    parts.push(`The policy history chain of ${policy.history.event_count} events verifies intact.`)
  } else {
    parts.push(
      `History verification FAILED at event ${policy.history.break.seq} (${policy.history.break.reason}); events 1 to ${policy.history.verified_through_seq} remain provably intact.`,
    )
  }

  if (policy.rejected_events.length > 0) {
    const ids = policy.rejected_events.map((r) => `${r.id} (${r.reason})`).join(', ')
    parts.push(`${policy.rejected_events.length} inbound request(s) were rejected: ${ids}.`)
  }

  let suggested_action = 'No action required'
  if (!policy.history.valid) {
    suggested_action = `Investigate history integrity: verification failed at event ${policy.history.break.seq} (${policy.history.break.reason}). Do not rely on derived balances until this is resolved.`
  } else if (policy.open_balance_cents > 0) {
    suggested_action = `Collect the outstanding balance of ${formatMoney(policy.open_balance_cents, policy.currency)}.`
  } else if (policy.open_balance_cents < 0) {
    suggested_action = `Review the credit balance of ${formatMoney(Math.abs(policy.open_balance_cents), policy.currency)} with the insured; no refund is issued by this system.`
  } else if (policy.status !== 'active') {
    suggested_action = `Policy is ${policy.status}; no further endorsements can be applied.`
  }

  return { explanation: parts.join(' '), suggested_action }
}

export function seedPolicy(): PolicySummary {
  const base: Omit<PolicySummary, 'explanation' | 'suggested_action'> = {
    policy_id: 'POL-1001',
    homeowner_id: 'HOME-204',
    status: 'active',
    currency: 'USD',
    term_start: '2026-01-01',
    term_end: '2027-01-01',
    annual_premium_cents: 120_000,
    endorsements: [],
    payments: [],
    open_balance_cents: 0,
    ledger: { balanced: true, transactions: [] },
    history: { valid: true, event_count: 1, events: ['policy_created'] },
    rejected_events: [],
  }
  return { ...base, ...explain(base) }
}

type SeenRequest = { fingerprint: string; response: unknown }
const seenKeys = new Map<string, SeenRequest>()

function fingerprint(payload: unknown): string {
  return JSON.stringify(payload)
}

export type EndorsementInput = {
  idempotency_key: string
  effective_date: string
  new_annual_premium_cents: number
  reason?: string
}

export type EndorsementResult = {
  endorsement_id: string
  policy_id: string
  effective_date: string
  previous_annual_premium_cents: number
  new_annual_premium_cents: number
  delta_cents: number
  billing_document: BillingDocument | null
  ledger_transaction_ids: string[]
  open_balance_cents: number
  policy_event: { seq: number; event_type: PolicyEventType; event_hash: string }
  idempotency_result: 'applied' | 'duplicate ignored'
}

export function applyEndorsement(
  policy: PolicySummary,
  input: EndorsementInput,
): ApiResult<EndorsementResult> {
  const fp = fingerprint({ policy_id: policy.policy_id, ...input })
  const seen = seenKeys.get(input.idempotency_key)
  if (seen) {
    if (seen.fingerprint !== fp) {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'IdempotencyKeyConflict',
          message: `Idempotency key ${input.idempotency_key} was already used with a different payload.`,
        },
      }
    }
    return {
      ok: true,
      data: { ...(seen.response as EndorsementResult), idempotency_result: 'duplicate ignored' },
    }
  }

  if (policy.status !== 'active') {
    return {
      ok: false,
      status: 422,
      error: {
        code: 'PolicyNotActive',
        message: `Policy ${policy.policy_id} is ${policy.status}; endorsements require an active policy.`,
      },
    }
  }
  if (input.effective_date < policy.term_start || input.effective_date > policy.term_end) {
    return {
      ok: false,
      status: 422,
      error: {
        code: 'OutOfTerm',
        message: `effective_date ${input.effective_date} is outside the policy term ${policy.term_start} to ${policy.term_end}.`,
      },
    }
  }
  const lastEffective = policy.endorsements.at(-1)?.effective_date
  if (lastEffective && input.effective_date < lastEffective) {
    return {
      ok: false,
      status: 422,
      error: {
        code: 'OutOfOrderEndorsement',
        message: `effective_date ${input.effective_date} precedes the latest applied endorsement (${lastEffective}).`,
      },
    }
  }

  const previous = policy.annual_premium_cents
  const rawDelta = input.new_annual_premium_cents - previous
  const delta_cents = prorate(rawDelta, input.effective_date, policy.term_start, policy.term_end)
  const endorsementId = `END-${2000 + policy.endorsements.length + 1}`
  const billingDocument: BillingDocument | null =
    delta_cents === 0
      ? null
      : {
          id: `BILL-${3000 + policy.endorsements.length + 1}`,
          type: delta_cents > 0 ? 'premium_charge' : 'premium_credit',
          amount_cents: Math.abs(delta_cents),
          status: 'open',
        }

  const seq = policy.history.event_count + 1
  const data: EndorsementResult = {
    endorsement_id: endorsementId,
    policy_id: policy.policy_id,
    effective_date: input.effective_date,
    previous_annual_premium_cents: previous,
    new_annual_premium_cents: input.new_annual_premium_cents,
    delta_cents,
    billing_document: billingDocument,
    ledger_transaction_ids: billingDocument ? [`ltx-${endorsementId}`] : [],
    open_balance_cents:
      policy.open_balance_cents + Math.abs(delta_cents) * (delta_cents >= 0 ? 1 : -1),
    policy_event: {
      seq,
      event_type: 'endorsement_applied',
      event_hash: `${endorsementId.toLowerCase()}-hash`,
    },
    idempotency_result: 'applied',
  }
  seenKeys.set(input.idempotency_key, { fingerprint: fp, response: data })
  return { ok: true, data }
}

export type PaymentInput = {
  idempotency_key: string
  external_payment_id: string
  amount_cents: number
  currency: string
  received_at: string
}

export type PaymentResult = {
  payment_id: string
  external_payment_id: string
  policy_id: string
  amount_cents: number
  currency: string
  received_at: string
  status: 'applied' | 'partially_applied' | 'unapplied'
  applications: {
    billing_document_id: string
    amount_cents: number
    document_status_after: 'open' | 'paid'
  }[]
  unapplied_cents: number
  ledger_transaction_ids: string[]
  open_balance_cents: number
  policy_event: { seq: number; event_type: PolicyEventType; event_hash: string }
  idempotency_result: 'applied' | 'duplicate ignored'
}

const seenExternalPaymentIds = new Set<string>()

export function recordPayment(
  policy: PolicySummary,
  input: PaymentInput,
): ApiResult<PaymentResult> {
  const fp = fingerprint({ policy_id: policy.policy_id, ...input })
  const seen = seenKeys.get(input.idempotency_key)
  if (seen) {
    if (seen.fingerprint !== fp) {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'IdempotencyKeyConflict',
          message: `Idempotency key ${input.idempotency_key} was already used with a different payload.`,
        },
      }
    }
    return {
      ok: true,
      data: { ...(seen.response as PaymentResult), idempotency_result: 'duplicate ignored' },
    }
  }
  if (seenExternalPaymentIds.has(input.external_payment_id)) {
    return {
      ok: false,
      status: 409,
      error: {
        code: 'ExternalPaymentIdConflict',
        message: `external_payment_id ${input.external_payment_id} has already been recorded under a different idempotency key.`,
      },
    }
  }
  if (input.currency !== policy.currency) {
    return {
      ok: false,
      status: 422,
      error: {
        code: 'CurrencyMismatch',
        message: `Policy ${policy.policy_id} is denominated in ${policy.currency}; payment ${input.external_payment_id} is in ${input.currency}.`,
      },
    }
  }

  const openDocs = policy.endorsements
    .map((e) => e.billing_document)
    .filter((d): d is BillingDocument => d !== null && d.status === 'open')

  let remaining = input.amount_cents
  const applications: PaymentResult['applications'] = []
  for (const doc of openDocs) {
    if (remaining <= 0) break
    const applied = Math.min(remaining, doc.amount_cents)
    remaining -= applied
    applications.push({
      billing_document_id: doc.id,
      amount_cents: applied,
      document_status_after: applied === doc.amount_cents ? 'paid' : 'open',
    })
  }
  const appliedTotal = input.amount_cents - remaining
  const status: PaymentResult['status'] =
    appliedTotal === 0
      ? 'unapplied'
      : appliedTotal < input.amount_cents
        ? 'partially_applied'
        : 'applied'

  const seq = policy.history.event_count + 1
  const data: PaymentResult = {
    payment_id: input.idempotency_key,
    external_payment_id: input.external_payment_id,
    policy_id: policy.policy_id,
    amount_cents: input.amount_cents,
    currency: input.currency,
    received_at: input.received_at,
    status,
    applications,
    unapplied_cents: remaining,
    ledger_transaction_ids: [`ltx-${input.external_payment_id}`],
    open_balance_cents: policy.open_balance_cents - appliedTotal + remaining * 0,
    policy_event: {
      seq,
      event_type: 'payment_recorded',
      event_hash: `${input.external_payment_id.toLowerCase()}-hash`,
    },
    idempotency_result: 'applied',
  }
  seenKeys.set(input.idempotency_key, { fingerprint: fp, response: data })
  seenExternalPaymentIds.add(input.external_payment_id)
  return { ok: true, data }
}

export function applyEndorsementToPolicy(
  policy: PolicySummary,
  result: EndorsementResult,
): PolicySummary {
  const endorsement: Endorsement = {
    id: result.endorsement_id,
    effective_date: result.effective_date,
    delta_cents: result.delta_cents,
    billing_document: result.billing_document,
    idempotency_result: result.idempotency_result,
  }
  const next: Omit<PolicySummary, 'explanation' | 'suggested_action'> = {
    ...policy,
    annual_premium_cents: result.new_annual_premium_cents,
    endorsements: [...policy.endorsements, endorsement],
    open_balance_cents: result.open_balance_cents,
    ledger:
      result.billing_document === null
        ? policy.ledger
        : {
            balanced: true,
            transactions: [
              ...policy.ledger.transactions,
              {
                source: result.endorsement_id,
                debits_cents: result.billing_document.amount_cents,
                credits_cents: result.billing_document.amount_cents,
              },
            ],
          },
    history: policy.history.valid
      ? {
          valid: true,
          event_count: result.policy_event.seq,
          events: [...policy.history.events, result.policy_event.event_type],
        }
      : policy.history,
  }
  return { ...next, ...explain(next) }
}

export function applyPaymentToPolicy(policy: PolicySummary, result: PaymentResult): PolicySummary {
  const payment: Payment = {
    external_payment_id: result.external_payment_id,
    amount_cents: result.amount_cents,
    status: result.status,
    idempotency_result: result.idempotency_result,
  }
  const paidIds = new Set(
    result.applications
      .filter((a) => a.document_status_after === 'paid')
      .map((a) => a.billing_document_id),
  )
  const next: Omit<PolicySummary, 'explanation' | 'suggested_action'> = {
    ...policy,
    payments: [...policy.payments, payment],
    open_balance_cents: result.open_balance_cents,
    endorsements: policy.endorsements.map((e) =>
      e.billing_document && paidIds.has(e.billing_document.id)
        ? { ...e, billing_document: { ...e.billing_document, status: 'paid' } }
        : e,
    ),
    ledger: {
      balanced: true,
      transactions: [
        ...policy.ledger.transactions,
        {
          source: result.external_payment_id,
          debits_cents: result.amount_cents,
          credits_cents: result.amount_cents,
        },
      ],
    },
    history: policy.history.valid
      ? {
          valid: true,
          event_count: result.policy_event.seq,
          events: [...policy.history.events, result.policy_event.event_type],
        }
      : policy.history,
  }
  return { ...next, ...explain(next) }
}

// PROTOTYPE-ONLY: lets the demo path show a broken chain without a real hash chain.
export function corruptHistory(policy: PolicySummary): PolicySummary {
  if (!policy.history.valid) return policy
  const seq = Math.max(2, Math.floor(policy.history.event_count / 2))
  const next: Omit<PolicySummary, 'explanation' | 'suggested_action'> = {
    ...policy,
    history: {
      valid: false,
      event_count: policy.history.event_count,
      verified_through_seq: seq - 1,
      break: { seq, reason: 'event_hash_mismatch' },
    },
  }
  return { ...next, ...explain(next) }
}
