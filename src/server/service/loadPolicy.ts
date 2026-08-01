import type { Db } from '@/server/db/withTransaction'
import { buildExplanation, suggestedAction } from '@/server/domain/summary'
import { PolicyNotFoundError } from '@/server/errors'
import {
  deriveDocumentStatus,
  derivePaymentStatus,
  getOpenBalanceCents,
  humanizeErrorCode,
  toApiBillingDocumentType,
  type PaymentStatus,
} from '@/server/service/shared'
import { loadPolicyEvents } from '@/server/service/verifyHistory'
import { verifyChain } from '@/server/domain/hashChain'
import type { BillingDocumentSummary, IdempotencyResult } from '@/server/service/types'

interface PolicyRow {
  policy_id: string
  homeowner_id: string
  status: 'active' | 'cancelled' | 'expired'
  term_start: string
  term_end: string
  annual_premium_cents: string
  currency: string
}

interface EndorsementRow {
  endorsement_id: string
  effective_date: string
  delta_cents: string
  previous_annual_premium_cents: string
  new_annual_premium_cents: string
  policy_seq: number
  billing_document_id: string | null
  document_type: 'endorsement_adjustment' | 'premium_credit' | null
  bd_amount_cents: string | null
  paid_cents: string | null
}

interface PaymentRow {
  payment_id: string
  external_payment_id: string
  amount_cents: string
  applied_cents: string | null
}

export interface PolicyEndorsementView {
  id: string
  effective_date: string
  delta_cents: number
  billing_document: BillingDocumentSummary | null
  idempotency_result: IdempotencyResult
}

export interface PolicyPaymentView {
  external_payment_id: string
  amount_cents: number
  status: PaymentStatus
  idempotency_result: IdempotencyResult
}

export interface PolicyView {
  policy_id: string
  homeowner_id: string
  status: string
  currency: string
  term_start: string
  term_end: string
  annual_premium_cents: number
  endorsements: PolicyEndorsementView[]
  payments: PolicyPaymentView[]
  open_balance_cents: number
  ledger: {
    balanced: boolean
    transactions: { source: string; debits_cents: number; credits_cents: number }[]
  }
  history: { valid: boolean; event_count: number; events: string[] }
  rejected_events: { id: string; reason: string }[]
  explanation: string
  suggested_action: string
}

async function idempotencyResultsByBusinessId(
  db: Db,
  policyId: string,
): Promise<Map<string, IdempotencyResult>> {
  const { rows } = await db.query<{ business_id: string; accepted_count: string }>(
    `SELECT business_id, COUNT(*) FILTER (WHERE outcome = 'accepted') AS accepted_count
       FROM inbound_requests
      WHERE policy_id = $1 AND business_id IS NOT NULL
      GROUP BY business_id`,
    [policyId],
  )
  const map = new Map<string, IdempotencyResult>()
  for (const row of rows) {
    map.set(row.business_id, Number(row.accepted_count) > 1 ? 'duplicate ignored' : 'applied')
  }
  return map
}

export async function loadPolicy(db: Db, policyId: string): Promise<PolicyView> {
  const { rows: policyRows } = await db.query<PolicyRow>(
    'SELECT * FROM policies WHERE policy_id = $1',
    [policyId],
  )
  const policy = policyRows[0]
  if (!policy) throw new PolicyNotFoundError(policyId)

  const idempotencyResults = await idempotencyResultsByBusinessId(db, policyId)

  const { rows: endorsementRows } = await db.query<EndorsementRow>(
    `SELECT e.endorsement_id, e.effective_date, e.delta_cents,
            e.previous_annual_premium_cents, e.new_annual_premium_cents, e.policy_seq,
            bd.billing_document_id, bd.document_type, bd.amount_cents AS bd_amount_cents,
            (SELECT COALESCE(SUM(pa.amount_cents), 0) FROM payment_applications pa
              WHERE pa.billing_document_id = bd.billing_document_id) AS paid_cents
       FROM endorsements e
       LEFT JOIN billing_documents bd ON bd.endorsement_id = e.endorsement_id
      WHERE e.policy_id = $1
      ORDER BY e.policy_seq`,
    [policyId],
  )

  const endorsements: PolicyEndorsementView[] = endorsementRows.map((row) => ({
    id: row.endorsement_id,
    effective_date: row.effective_date,
    delta_cents: Number(row.delta_cents),
    billing_document:
      row.billing_document_id && row.document_type && row.bd_amount_cents !== null
        ? {
            id: row.billing_document_id,
            type: toApiBillingDocumentType(row.document_type),
            amount_cents: Number(row.bd_amount_cents),
            status: deriveDocumentStatus(Number(row.bd_amount_cents), Number(row.paid_cents ?? 0)),
          }
        : null,
    idempotency_result: idempotencyResults.get(row.endorsement_id) ?? 'applied',
  }))

  // Not part of the public view -- only feeds the explanation's "raised/lowered
  // by" clause, which reports the full annual delta, distinct from the
  // prorated `delta_cents` billed (see docs/spec/api-contract.md §4/§9).
  const annualPremiumDeltaByEndorsementId = new Map(
    endorsementRows.map((row) => [
      row.endorsement_id,
      Number(row.new_annual_premium_cents) - Number(row.previous_annual_premium_cents),
    ]),
  )

  const { rows: paymentRows } = await db.query<PaymentRow>(
    `SELECT p.payment_id, p.external_payment_id, p.amount_cents,
            (SELECT COALESCE(SUM(pa.amount_cents), 0) FROM payment_applications pa
              WHERE pa.payment_id = p.payment_id) AS applied_cents
       FROM payments p
      WHERE p.policy_id = $1
      ORDER BY p.policy_seq`,
    [policyId],
  )

  const payments: PolicyPaymentView[] = paymentRows.map((row) => ({
    external_payment_id: row.external_payment_id,
    amount_cents: Number(row.amount_cents),
    status: derivePaymentStatus(Number(row.amount_cents), Number(row.applied_cents ?? 0)),
    idempotency_result: idempotencyResults.get(row.payment_id) ?? 'applied',
  }))

  const openBalanceCents = await getOpenBalanceCents(db, policyId)

  // Direction is read off the sign of amount_cents in application code, once
  // -- no CASE expression anywhere in schema, service or API (ADR-0002).
  const { rows: ledgerRows } = await db.query<{
    ledger_transaction_id: string
    source_id: string
    posted_at: string
    amount_cents: string
  }>(
    `SELECT lt.ledger_transaction_id, lt.source_id, lt.posted_at::text AS posted_at, le.amount_cents
       FROM ledger_transactions lt
       JOIN ledger_entries le ON le.ledger_transaction_id = lt.ledger_transaction_id
      WHERE lt.policy_id = $1
      ORDER BY lt.posted_at, lt.ledger_transaction_id`,
    [policyId],
  )
  const ledgerByTransaction = new Map<
    string,
    { source: string; debits_cents: number; credits_cents: number }
  >()
  for (const row of ledgerRows) {
    const amount = Number(row.amount_cents)
    const entry = ledgerByTransaction.get(row.ledger_transaction_id) ?? {
      source: row.source_id,
      debits_cents: 0,
      credits_cents: 0,
    }
    if (amount > 0) entry.debits_cents += amount
    else entry.credits_cents += -amount
    ledgerByTransaction.set(row.ledger_transaction_id, entry)
  }
  const ledgerTransactions = [...ledgerByTransaction.values()]
  const ledgerBalanced = ledgerTransactions.every((t) => t.debits_cents === t.credits_cents)

  const events = await loadPolicyEvents(db, policyId)
  const chainResult = verifyChain(events)

  const { rows: rejectedRows } = await db.query<{
    business_id: string | null
    error_code: string | null
  }>(
    `SELECT business_id, error_code FROM inbound_requests
      WHERE policy_id = $1 AND outcome = 'rejected'
      ORDER BY received_at`,
    [policyId],
  )
  const rejectedEvents = rejectedRows.map((row) => ({
    id: row.business_id ?? 'unknown',
    reason: humanizeErrorCode(row.error_code ?? 'InternalError'),
  }))

  const annualPremiumCents = Number(policy.annual_premium_cents)
  const latestEndorsement =
    endorsements.length > 0 ? endorsements[endorsements.length - 1] : undefined
  const openDocumentCount = endorsements.filter(
    (e) => e.billing_document && e.billing_document.status !== 'paid',
  ).length

  const historyFacts = chainResult.valid
    ? {
        valid: true,
        eventCount: chainResult.eventCount,
        verifiedThroughSeq: chainResult.eventCount,
      }
    : {
        valid: false,
        eventCount: chainResult.eventCount,
        verifiedThroughSeq: chainResult.verifiedThroughSeq,
        breakSeq: chainResult.break.seq,
        breakReason: chainResult.break.reason,
      }

  const summaryFacts = {
    policyId: policy.policy_id,
    status: policy.status,
    annualPremiumCents,
    currency: policy.currency,
    termStart: policy.term_start,
    termEnd: policy.term_end,
    endorsementCount: endorsements.length,
    latestEndorsement: latestEndorsement
      ? {
          id: latestEndorsement.id,
          effectiveDate: latestEndorsement.effective_date,
          deltaCents: latestEndorsement.delta_cents,
          annualPremiumDeltaCents: annualPremiumDeltaByEndorsementId.get(latestEndorsement.id) ?? 0,
        }
      : null,
    balanceCents: openBalanceCents,
    openDocumentCount,
    history: historyFacts,
    rejectedEvents,
  }

  return {
    policy_id: policy.policy_id,
    homeowner_id: policy.homeowner_id,
    status: policy.status,
    currency: policy.currency,
    term_start: policy.term_start,
    term_end: policy.term_end,
    annual_premium_cents: annualPremiumCents,
    endorsements,
    payments,
    open_balance_cents: openBalanceCents,
    ledger: { balanced: ledgerBalanced, transactions: ledgerTransactions },
    history: {
      valid: chainResult.valid,
      event_count: chainResult.eventCount,
      events: events.map((e) => e.eventType),
    },
    rejected_events: rejectedEvents,
    explanation: buildExplanation(summaryFacts),
    suggested_action: suggestedAction(summaryFacts),
  }
}
