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

export type BillingDocumentStatus = 'open' | 'partially_paid' | 'paid'

export function deriveDocumentStatus(
  amountCents: number,
  paidCents: number,
): BillingDocumentStatus {
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
