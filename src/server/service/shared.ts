// Shared helpers used by every write/read path in the service layer.

import { createHash } from 'node:crypto'
import type { Db, Tx } from '@/server/db/withTransaction'
import { canonicalJson } from '@/server/domain/canonicalJson'
import { eventHash, type PolicyEventType } from '@/server/domain/hashChain'

export type Clock = () => string

/** `new Date().toISOString()` already renders exactly `.SSSZ` millisecond precision. */
export const systemClock: Clock = () => new Date().toISOString()

/** Drops `undefined`-valued keys so an optional field absent from a request never reaches canonicalJson. */
function withoutUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) out[key] = val
  }
  return out
}

/** SHA-256 of the canonicalized path policy id + validated command body -- the idempotency fingerprint (ADR-0003). */
export function computeFingerprint(policyId: string, command: Record<string, unknown>): string {
  const preimage = canonicalJson(withoutUndefined({ policy_id: policyId, ...command }))
  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

export interface PolicyRow {
  policy_id: string
  homeowner_id: string
  status: 'active' | 'cancelled' | 'expired'
  term_start: string
  term_end: string
  annual_premium_cents: string // bigint comes back as string from `pg`
  currency: string
}

export async function selectPolicyForUpdate(tx: Tx, policyId: string): Promise<PolicyRow | null> {
  const { rows } = await tx.query<PolicyRow>(
    'SELECT * FROM policies WHERE policy_id = $1 FOR UPDATE',
    [policyId],
  )
  return rows[0] ?? null
}

export interface AppendPolicyEventInput {
  policyId: string
  eventType: PolicyEventType
  recordedAt: string
  payload: Record<string, unknown>
}

export interface AppendedPolicyEvent {
  seq: number
  eventHash: string
}

/**
 * Computes the next `seq` and links to the current tip under the caller's
 * already-held `SELECT ... FOR UPDATE` lock on the policy row, then inserts
 * the event row. One mechanism (the policy lock) serializes this against
 * every other writer for the same policy, so `seq` never collides and the
 * chain never forks -- see ADR-0005.
 *
 * Accepts `Db | Tx`: the write paths always pass a `Tx` under the lock, but
 * the seed script and test fixtures append a lone `policy_created` genesis
 * event outside any transaction, with no concurrent writer to race.
 */
export async function appendPolicyEvent(
  db: Db | Tx,
  input: AppendPolicyEventInput,
): Promise<AppendedPolicyEvent> {
  const { rows } = await db.query<{ seq: number; event_hash: string }>(
    'SELECT seq, event_hash FROM policy_events WHERE policy_id = $1 ORDER BY seq DESC LIMIT 1',
    [input.policyId],
  )
  const tip = rows[0]
  const seq = tip ? tip.seq + 1 : 1
  const previousHash = tip ? tip.event_hash : null

  const hash = eventHash({
    hashVersion: 1,
    policyId: input.policyId,
    seq,
    eventType: input.eventType,
    recordedAt: input.recordedAt,
    payload: input.payload,
    previousHash,
  })

  await db.query(
    `INSERT INTO policy_events (policy_id, seq, hash_version, event_type, recorded_at, payload, previous_hash, event_hash)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
    [
      input.policyId,
      seq,
      input.eventType,
      input.recordedAt,
      canonicalJson(input.payload),
      previousHash,
      hash,
    ],
  )

  return { seq, eventHash: hash }
}

export type DbDocumentType = 'endorsement_adjustment' | 'premium_credit'
export type ApiDocumentType = 'premium_charge' | 'premium_credit'

/** DB `document_type` -> the API-facing `type` (docs/spec/api-contract.md §6's deviations table). */
export function toApiBillingDocumentType(documentType: DbDocumentType): ApiDocumentType {
  return documentType === 'endorsement_adjustment' ? 'premium_charge' : 'premium_credit'
}

export type BillingDocumentStatus = 'open' | 'partially_paid' | 'paid' | 'issued'

/**
 * A `premium_credit` never enters the payment waterfall (ADR-0007) -- cash never settles it, so
 * `open`/`partially_paid`/`paid` would misreport it as awaiting collection. It reports the
 * distinct `issued` status instead: a fourth value on a status the API contract otherwise fixes
 * at three (docs/spec/api-contract.md §6, docs/deviations-from-the-brief.md).
 */
export function deriveDocumentStatus(
  documentType: DbDocumentType,
  amountCents: number,
  paidCents: number,
): BillingDocumentStatus {
  if (documentType === 'premium_credit') return 'issued'
  if (paidCents <= 0) return 'open'
  if (paidCents >= amountCents) return 'paid'
  return 'partially_paid'
}

export type PaymentStatus = 'applied' | 'partially_applied' | 'unapplied'

export function derivePaymentStatus(amountCents: number, appliedCents: number): PaymentStatus {
  if (appliedCents <= 0) return 'unapplied'
  if (appliedCents >= amountCents) return 'applied'
  return 'partially_applied'
}

/** `premium_receivable`'s running balance for the policy -- the ledger-derived open balance (ADR-0004). */
export async function getOpenBalanceCents(db: Db | Tx, policyId: string): Promise<number> {
  const { rows } = await db.query<{ balance: string | null }>(
    `SELECT SUM(le.amount_cents) AS balance
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.ledger_transaction_id = le.ledger_transaction_id
      WHERE lt.policy_id = $1 AND le.account_code = 'premium_receivable'`,
    [policyId],
  )
  return Number(rows[0]?.balance ?? 0)
}

export interface OpenChargeDocumentRow {
  billing_document_id: string
  due_date: string
  issued_at: string
  open_amount_cents: string
}

/**
 * This policy's open **charge** documents -- `document_type = 'endorsement_adjustment'` only.
 * Premium credit notes are excluded: only charges are payable (ADR-0007). Shared between the
 * initial payment waterfall and the post-endorsement remainder sweep so both draw from the same
 * definition of "open".
 */
export async function loadOpenChargeDocuments(
  tx: Tx,
  policyId: string,
): Promise<OpenChargeDocumentRow[]> {
  const { rows } = await tx.query<OpenChargeDocumentRow>(
    `SELECT bd.billing_document_id, bd.due_date::text AS due_date, bd.issued_at::text AS issued_at,
            bd.amount_cents - COALESCE(SUM(pa.amount_cents), 0) AS open_amount_cents
       FROM billing_documents bd
       LEFT JOIN payment_applications pa ON pa.billing_document_id = bd.billing_document_id
      WHERE bd.policy_id = $1 AND bd.document_type = 'endorsement_adjustment'
      GROUP BY bd.billing_document_id, bd.due_date, bd.issued_at
     HAVING bd.amount_cents - COALESCE(SUM(pa.amount_cents), 0) > 0`,
    [policyId],
  )
  return rows
}

export interface UnappliedPaymentRemainderRow {
  payment_id: string
  received_at: string
  remainder_cents: string
}

/**
 * Payments on this policy still holding an unapplied remainder, in **receipt order**
 * (`received_at`, tiebroken on `payment_id`) -- the order remainders sweep in (ADR-0007), distinct
 * from the display order used elsewhere.
 */
export async function loadUnappliedPaymentRemainders(
  tx: Tx,
  policyId: string,
): Promise<UnappliedPaymentRemainderRow[]> {
  const { rows } = await tx.query<UnappliedPaymentRemainderRow>(
    `SELECT p.payment_id, p.received_at,
            p.amount_cents - COALESCE(SUM(pa.amount_cents), 0) AS remainder_cents
       FROM payments p
       LEFT JOIN payment_applications pa ON pa.payment_id = p.payment_id
      WHERE p.policy_id = $1
      GROUP BY p.payment_id, p.received_at, p.amount_cents
     HAVING p.amount_cents - COALESCE(SUM(pa.amount_cents), 0) > 0
      ORDER BY p.received_at, p.payment_id`,
    [policyId],
  )
  return rows
}

export interface PaymentApplicationInsert {
  paymentId: string
  billingDocumentId: string
  amountCents: number
}

/** Writes one `payment_applications` row per draft -- shared by the initial waterfall and the sweep. */
export async function insertPaymentApplications(
  tx: Tx,
  applications: readonly PaymentApplicationInsert[],
): Promise<void> {
  for (const application of applications) {
    await tx.query(
      'INSERT INTO payment_applications (payment_id, billing_document_id, amount_cents) VALUES ($1, $2, $3)',
      [application.paymentId, application.billingDocumentId, application.amountCents],
    )
  }
}

const REJECTION_REASONS: Record<string, string> = {
  InvalidRequest: 'invalid request',
  PolicyIdMismatch: 'policy id mismatch',
  PolicyNotFound: 'policy not found',
  IdempotencyKeyConflict: 'idempotency key conflict',
  ExternalPaymentIdConflict: 'external payment id conflict',
  PolicyNotActive: 'policy not active',
  OutOfTerm: 'effective date outside policy term',
  OutOfOrderEndorsement: 'out-of-order endorsement',
  CurrencyMismatch: 'currency mismatch',
  InternalError: 'internal error',
}

export function humanizeErrorCode(code: string): string {
  return REJECTION_REASONS[code] ?? code
}
