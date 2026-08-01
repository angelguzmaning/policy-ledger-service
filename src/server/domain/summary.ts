// The readable summary: `explanation` and `suggested_action` are a pure
// function of policy state -- no model call, no non-determinism. See
// docs/spec/api-contract.md §9.

import { formatMoney } from '@/server/domain/formatMoney'

export interface LatestEndorsementFacts {
  id: string
  effectiveDate: string
  /** The prorated amount billed (or credited) -- zero iff no billing document was produced. */
  deltaCents: number
  /** The full annual-premium change (new - previous) -- what "raised/lowered by" reports, distinct from the prorated `deltaCents` billed. */
  annualPremiumDeltaCents: number
}

export interface HistoryFacts {
  valid: boolean
  eventCount: number
  verifiedThroughSeq: number
  breakSeq?: number
  breakReason?: string
}

export interface RejectedEventFacts {
  id: string
  reason: string
}

export interface SummaryFacts {
  policyId: string
  status: 'active' | 'cancelled' | 'expired'
  annualPremiumCents: number
  currency: string
  termStart: string
  termEnd: string
  endorsementCount: number
  latestEndorsement: LatestEndorsementFacts | null
  balanceCents: number
  openDocumentCount: number
  history: HistoryFacts
  rejectedEvents: RejectedEventFacts[]
}

function policyClause(facts: SummaryFacts): string {
  return `Policy ${facts.policyId} is ${facts.status} with an annual premium of ${formatMoney(facts.annualPremiumCents, facts.currency)} for the term ${facts.termStart} to ${facts.termEnd}.`
}

function endorsementClause(facts: SummaryFacts): string | null {
  if (facts.endorsementCount === 0 || !facts.latestEndorsement) return null
  const { id, effectiveDate, deltaCents, annualPremiumDeltaCents } = facts.latestEndorsement
  const n = facts.endorsementCount

  if (deltaCents === 0) {
    return `${n} endorsement(s) have been applied, most recently ${id} effective ${effectiveDate}, which left the annual premium unchanged and produced no billing document.`
  }

  const direction = annualPremiumDeltaCents >= 0 ? 'raised' : 'lowered'
  const annualDelta = formatMoney(Math.abs(annualPremiumDeltaCents), facts.currency)
  const billed = formatMoney(Math.abs(deltaCents), facts.currency)
  return `${n} endorsement(s) have been applied, most recently ${id} effective ${effectiveDate}, which ${direction} the annual premium by ${annualDelta} and billed ${billed} pro-rata.`
}

function balanceClause(facts: SummaryFacts): string {
  const { balanceCents, currency } = facts
  if (balanceCents > 0) {
    return `${formatMoney(balanceCents, currency)} is currently outstanding across ${facts.openDocumentCount} open billing document(s).`
  }
  if (balanceCents < 0) {
    return `The account holds a credit of ${formatMoney(Math.abs(balanceCents), currency)}, which will offset future charges. No refund is issued by this system.`
  }
  return 'The account is fully paid; there is no outstanding balance.'
}

function historyClause(facts: SummaryFacts): string {
  if (facts.history.valid) {
    return `The policy history chain of ${facts.history.eventCount} events verifies intact.`
  }
  return `History verification FAILED at event ${facts.history.breakSeq ?? 0} (${facts.history.breakReason ?? 'unknown'}); events 1 to ${facts.history.verifiedThroughSeq} remain provably intact.`
}

function rejectedClause(facts: SummaryFacts): string | null {
  if (facts.rejectedEvents.length === 0) return null
  const list = facts.rejectedEvents.map((r) => `${r.id} (${r.reason})`).join(', ')
  return `${facts.rejectedEvents.length} inbound request(s) were rejected: ${list}.`
}

export function buildExplanation(facts: SummaryFacts): string {
  const clauses: (string | null)[] = [
    policyClause(facts),
    endorsementClause(facts),
    balanceClause(facts),
    historyClause(facts),
    rejectedClause(facts),
  ]
  return clauses.filter((c): c is string => c !== null).join(' ')
}

export function suggestedAction(facts: SummaryFacts): string {
  if (!facts.history.valid) {
    return `Investigate history integrity: verification failed at event ${facts.history.breakSeq ?? 0} (${facts.history.breakReason ?? 'unknown'}). Do not rely on derived balances until this is resolved.`
  }
  if (facts.balanceCents > 0) {
    return `Collect the outstanding balance of ${formatMoney(facts.balanceCents, facts.currency)}.`
  }
  if (facts.balanceCents < 0) {
    return `Review the credit balance of ${formatMoney(Math.abs(facts.balanceCents), facts.currency)} with the insured; no refund is issued by this system.`
  }
  if (facts.status !== 'active') {
    return `Policy is ${facts.status}; no further endorsements can be applied.`
  }
  return 'No action required'
}
