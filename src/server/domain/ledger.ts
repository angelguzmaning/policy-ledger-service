// Pure builders. See ADR-0002: direction is the sign of amount_cents (debits
// positive, credits negative); a negative endorsement delta posts through the
// identical formula as a positive one, signs falling out naturally -- one
// code path, both signs.

export type LedgerAccountCode = 'cash' | 'premium_receivable' | 'written_premium'

export interface LedgerEntryDraft {
  account: LedgerAccountCode
  amountCents: number
}

/** DR premium_receivable / CR written_premium for a positive delta; mirrored for a negative one. */
export function postEndorsement(deltaCents: number): LedgerEntryDraft[] {
  if (deltaCents === 0) throw new Error('postEndorsement must not be called for a zero delta')
  return [
    { account: 'premium_receivable', amountCents: deltaCents },
    { account: 'written_premium', amountCents: -deltaCents },
  ]
}

/** DR cash / CR premium_receivable. */
export function postPayment(amountCents: number): LedgerEntryDraft[] {
  if (amountCents <= 0) throw new Error('postPayment amountCents must be positive')
  return [
    { account: 'cash', amountCents },
    { account: 'premium_receivable', amountCents: -amountCents },
  ]
}

// --- The oldest-open-first payment waterfall (ADR-0004) ---

export interface OpenBillingDocument {
  billingDocumentId: string
  dueDate: string
  issuedAt: string
  openAmountCents: number
}

export interface PaymentApplicationDraft {
  billingDocumentId: string
  amountCents: number
}

export interface AllocationResult {
  applications: PaymentApplicationDraft[]
  unappliedCents: number
}

/**
 * Applies `amountCents` against `openDocuments`, oldest-open-first:
 * `ORDER BY due_date, issued_at, billing_document_id` -- deterministic even
 * when documents share a due date and issued-at instant.
 */
export function allocate(
  openDocuments: readonly OpenBillingDocument[],
  amountCents: number,
): AllocationResult {
  if (amountCents <= 0) throw new Error('allocate amountCents must be positive')

  const sorted = [...openDocuments].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.issuedAt.localeCompare(b.issuedAt) ||
      a.billingDocumentId.localeCompare(b.billingDocumentId),
  )

  let remaining = amountCents
  const applications: PaymentApplicationDraft[] = []

  for (const doc of sorted) {
    if (remaining <= 0) break
    if (doc.openAmountCents <= 0) continue
    const applied = Math.min(remaining, doc.openAmountCents)
    applications.push({ billingDocumentId: doc.billingDocumentId, amountCents: applied })
    remaining -= applied
  }

  return { applications, unappliedCents: remaining }
}
