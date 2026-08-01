// The hash chain: canonicalization, hashing, and pure verification over an
// array of rows. See ADR-0005. `payload` is a plain JSON-safe object here;
// the caller (service layer) is responsible for storing `canonicalJson(payload)`
// verbatim as the `payload` TEXT column so the hash covers the bytes stored.

import { createHash } from 'node:crypto'
import { canonicalJson } from '@/server/domain/canonicalJson'

export type PolicyEventType = 'policy_created' | 'endorsement_applied' | 'payment_recorded'

export interface PolicyEventForHash {
  hashVersion: number
  policyId: string
  seq: number
  eventType: PolicyEventType
  recordedAt: string
  payload: Record<string, unknown>
  previousHash: string | null
}

/** Every column except `event_hash` itself -- see ADR-0005. */
export function buildEventPreimage(event: PolicyEventForHash): Record<string, unknown> {
  return {
    hash_version: event.hashVersion,
    policy_id: event.policyId,
    seq: event.seq,
    event_type: event.eventType,
    recorded_at: event.recordedAt,
    payload: event.payload,
    previous_hash: event.previousHash,
  }
}

/** `sha256(utf8(canonicalJson(preimage)))`, lowercase hex. */
export function eventHash(event: PolicyEventForHash): string {
  const preimage = canonicalJson(buildEventPreimage(event))
  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

export interface StoredPolicyEvent extends PolicyEventForHash {
  eventHash: string
}

export type ChainBreakReason =
  'event_hash_mismatch' | 'previous_hash_mismatch' | 'sequence_gap' | 'missing_genesis'

export interface ChainBreak {
  seq: number
  reason: ChainBreakReason
  expectedEventHash?: string
  storedEventHash?: string
}

export type VerifyChainResult =
  | { valid: true; eventCount: number; headHash: string | null }
  | { valid: false; eventCount: number; verifiedThroughSeq: number; break: ChainBreak }

/**
 * Verifies a policy's event chain, rows already ordered by `seq` ascending.
 * Pure: takes rows, returns a verdict. Rehashes through `eventHash`, the
 * same function the writer uses, so write and verify cannot drift apart.
 * Only the first break is reported.
 */
export function verifyChain(events: readonly StoredPolicyEvent[]): VerifyChainResult {
  const eventCount = events.length

  if (eventCount === 0 || events[0]?.seq !== 1) {
    return {
      valid: false,
      eventCount,
      verifiedThroughSeq: 0,
      break: { seq: eventCount === 0 ? 1 : (events[0]?.seq ?? 1), reason: 'missing_genesis' },
    }
  }

  let previousHash: string | null = null
  let lastHash: string | null = null

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    const expectedSeq = i + 1

    if (event.seq !== expectedSeq) {
      return {
        valid: false,
        eventCount,
        verifiedThroughSeq: i,
        break: { seq: expectedSeq, reason: 'sequence_gap' },
      }
    }

    if (event.previousHash !== previousHash) {
      return {
        valid: false,
        eventCount,
        verifiedThroughSeq: i,
        break: { seq: event.seq, reason: 'previous_hash_mismatch' },
      }
    }

    const expected = eventHash(event)
    if (expected !== event.eventHash) {
      return {
        valid: false,
        eventCount,
        verifiedThroughSeq: i,
        break: {
          seq: event.seq,
          reason: 'event_hash_mismatch',
          expectedEventHash: expected,
          storedEventHash: event.eventHash,
        },
      }
    }

    previousHash = event.eventHash
    lastHash = event.eventHash
  }

  return { valid: true, eventCount, headHash: lastHash }
}
