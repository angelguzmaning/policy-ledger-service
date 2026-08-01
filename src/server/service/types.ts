import type { BillingDocumentStatus, PaymentStatus } from '@/server/service/shared'

// The API-facing type differs from the DB's `document_type` enum
// (`endorsement_adjustment` / `premium_credit`) -- `premium_charge` reads
// better as a first-class name than "adjustment", and neither can be
// confused with the brief's own `endorsement_adjustment`, which cannot
// express a credit. See docs/spec/api-contract.md §6's deviations table;
// mapped once in @/server/service/shared's `toApiBillingDocumentType`.
export interface BillingDocumentSummary {
  id: string
  type: 'premium_charge' | 'premium_credit'
  amount_cents: number
  status: BillingDocumentStatus
}

export interface PolicyEventSummary {
  seq: number
  event_type: string
  event_hash: string
}

export type IdempotencyResult = 'applied' | 'duplicate ignored'

export interface EndorsementResult {
  endorsement_id: string
  policy_id: string
  effective_date: string
  previous_annual_premium_cents: number
  new_annual_premium_cents: number
  delta_cents: number
  billing_document: BillingDocumentSummary | null
  ledger_transaction_ids: string[]
  open_balance_cents: number
  policy_event: PolicyEventSummary
  idempotency_result: IdempotencyResult
}

export interface PaymentApplicationSummary {
  billing_document_id: string
  amount_cents: number
  document_status_after: BillingDocumentStatus
}

export interface PaymentResult {
  payment_id: string
  external_payment_id: string
  policy_id: string
  amount_cents: number
  currency: string
  received_at: string
  status: PaymentStatus
  applications: PaymentApplicationSummary[]
  unapplied_cents: number
  ledger_transaction_ids: string[]
  open_balance_cents: number
  policy_event: PolicyEventSummary
  idempotency_result: IdempotencyResult
}
