import type { Db, Tx } from '@/server/db/withTransaction'
import {
  verifyChain,
  type PolicyEventType,
  type StoredPolicyEvent,
} from '@/server/domain/hashChain'
import { PolicyNotFoundError } from '@/server/errors'

interface PolicyEventRow {
  seq: number
  hash_version: number
  event_type: PolicyEventType
  recorded_at: string
  payload: string
  previous_hash: string | null
  event_hash: string
}

export async function loadPolicyEvents(
  db: Db | Tx,
  policyId: string,
): Promise<StoredPolicyEvent[]> {
  const { rows } = await db.query<PolicyEventRow>(
    'SELECT seq, hash_version, event_type, recorded_at, payload, previous_hash, event_hash FROM policy_events WHERE policy_id = $1 ORDER BY seq',
    [policyId],
  )
  return rows.map((row) => ({
    hashVersion: row.hash_version,
    policyId,
    seq: row.seq,
    eventType: row.event_type,
    recordedAt: row.recorded_at,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
  }))
}

export async function verifyPolicyHistory(db: Db, policyId: string) {
  const { rowCount } = await db.query('SELECT 1 FROM policies WHERE policy_id = $1', [policyId])
  if (rowCount === 0) throw new PolicyNotFoundError(policyId)

  const events = await loadPolicyEvents(db, policyId)
  return verifyChain(events)
}

export type HistoryVerificationView =
  | { valid: true; event_count: number; events: string[]; head_hash: string | null }
  | {
      valid: false
      event_count: number
      verified_through_seq: number
      break: {
        seq: number
        reason: string
        expected_event_hash?: string
        stored_event_hash?: string
      }
    }

export async function loadHistoryVerificationView(
  db: Db,
  policyId: string,
): Promise<HistoryVerificationView> {
  const { rowCount } = await db.query('SELECT 1 FROM policies WHERE policy_id = $1', [policyId])
  if (rowCount === 0) throw new PolicyNotFoundError(policyId)

  const events = await loadPolicyEvents(db, policyId)
  const result = verifyChain(events)

  if (result.valid) {
    return {
      valid: true,
      event_count: result.eventCount,
      events: events.map((e) => e.eventType),
      head_hash: result.headHash,
    }
  }
  return {
    valid: false,
    event_count: result.eventCount,
    verified_through_seq: result.verifiedThroughSeq,
    break: {
      seq: result.break.seq,
      reason: result.break.reason,
      ...(result.break.expectedEventHash !== undefined && {
        expected_event_hash: result.break.expectedEventHash,
      }),
      ...(result.break.storedEventHash !== undefined && {
        stored_event_hash: result.break.storedEventHash,
      }),
    },
  }
}
