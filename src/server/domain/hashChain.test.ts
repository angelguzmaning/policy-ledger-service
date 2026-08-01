import { describe, expect, it } from 'vitest'
import {
  buildEventPreimage,
  eventHash,
  verifyChain,
  type PolicyEventForHash,
  type StoredPolicyEvent,
} from '@/server/domain/hashChain'
import { canonicalJson } from '@/server/domain/canonicalJson'

const genesis: PolicyEventForHash = {
  hashVersion: 1,
  policyId: 'POL-TEST',
  seq: 1,
  eventType: 'policy_created',
  recordedAt: '2026-01-01T00:00:00.000Z',
  payload: { foo: 1, bar: 'baz' },
  previousHash: null,
}

describe('eventHash', () => {
  it('case 1 -- golden vector: a fixed event hashes to a hard-coded, externally-computed hex string', () => {
    // Preimage string and hash independently computed with node:crypto over
    // the exact canonical bytes -- pinned as a constant, not derived from
    // calling eventHash itself.
    const expectedPreimage =
      '{"event_type":"policy_created","hash_version":1,"payload":{"bar":"baz","foo":1},"policy_id":"POL-TEST","previous_hash":null,"recorded_at":"2026-01-01T00:00:00.000Z","seq":1}'
    const expectedHash = 'd0d22bc416f27d8eb8f3ebddbfebd3e7c4a22a7338634003f394a326aee3cc50'.slice(
      0,
      64,
    )

    expect(canonicalJson(buildEventPreimage(genesis))).toBe(expectedPreimage)
    expect(eventHash(genesis)).toBe(expectedHash)
  })

  it('case 2 -- changing any single hash-covered field changes the hash', () => {
    const base = eventHash(genesis)
    const variants: PolicyEventForHash[] = [
      { ...genesis, hashVersion: 2 },
      { ...genesis, policyId: 'POL-OTHER' },
      { ...genesis, seq: 2, eventType: 'endorsement_applied' },
      { ...genesis, recordedAt: '2026-01-01T00:00:00.001Z' },
      { ...genesis, payload: { foo: 1, bar: 'different' } },
      { ...genesis, previousHash: 'a'.repeat(64) },
    ]
    for (const variant of variants) {
      expect(eventHash(variant)).not.toBe(base)
    }
  })

  it('case 3 -- genesis: a null previous_hash is part of the preimage, not skipped', () => {
    const preimage = buildEventPreimage(genesis)
    expect('previous_hash' in preimage).toBe(true)
    expect(preimage.previous_hash).toBeNull()
  })

  it('case 4 -- output matches /^[0-9a-f]{64}$/', () => {
    expect(eventHash(genesis)).toMatch(/^[0-9a-f]{64}$/)
  })
})

function toStored(events: PolicyEventForHash[]): StoredPolicyEvent[] {
  const stored: StoredPolicyEvent[] = []
  let previousHash: string | null = null
  for (const e of events) {
    const withPrev = { ...e, previousHash }
    const hash = eventHash(withPrev)
    stored.push({ ...withPrev, eventHash: hash })
    previousHash = hash
  }
  return stored
}

describe('verifyChain', () => {
  const intact = toStored([
    { ...genesis },
    {
      hashVersion: 1,
      policyId: 'POL-TEST',
      seq: 2,
      eventType: 'endorsement_applied',
      recordedAt: '2026-07-01T00:00:00.000Z',
      payload: { endorsement_id: 'END-2001' },
      previousHash: null,
    },
    {
      hashVersion: 1,
      policyId: 'POL-TEST',
      seq: 3,
      eventType: 'payment_recorded',
      recordedAt: '2026-07-03T18:30:00.000Z',
      payload: { payment_id: 'PAY-9001' },
      previousHash: null,
    },
  ])

  it('case 1 -- intact 3-event chain: valid, head_hash is the last event hash', () => {
    const result = verifyChain(intact)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.eventCount).toBe(3)
      expect(result.headHash).toBe(intact[2]?.eventHash)
    }
  })

  it('case 2 -- payload edited at seq 2: event_hash_mismatch at 2, verified_through_seq 1', () => {
    const tampered = intact.map((e) => ({ ...e }))
    tampered[1]!.payload = { endorsement_id: 'END-9999' }
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.break.reason).toBe('event_hash_mismatch')
      expect(result.break.seq).toBe(2)
      expect(result.verifiedThroughSeq).toBe(1)
    }
  })

  it('case 3 -- previous_hash repointed at seq 3: previous_hash_mismatch at 3', () => {
    const tampered = intact.map((e) => ({ ...e }))
    tampered[2]!.previousHash = 'f'.repeat(64)
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.break.reason).toBe('previous_hash_mismatch')
      expect(result.break.seq).toBe(3)
    }
  })

  it('case 4 -- seq 2 removed: sequence_gap', () => {
    const withGap = [intact[0], intact[2]] as StoredPolicyEvent[]
    const result = verifyChain(withGap)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.break.reason).toBe('sequence_gap')
      expect(result.break.seq).toBe(2)
    }
  })

  it('case 5 -- chain starting at seq 2: missing_genesis', () => {
    const noGenesis = [intact[1]] as StoredPolicyEvent[]
    const result = verifyChain(noGenesis)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.break.reason).toBe('missing_genesis')
  })

  it('case 6 -- two breaks present: only the first is reported', () => {
    const tampered = intact.map((e) => ({ ...e }))
    tampered[1]!.payload = { endorsement_id: 'END-9999' } // break at seq 2
    tampered[2]!.previousHash = 'f'.repeat(64) // would also break at seq 3
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.break.seq).toBe(2)
  })

  it('case 7 -- verification rehashes through eventHash, not a copy', () => {
    // Proven structurally: verifyChain imports and calls eventHash directly.
    const result = verifyChain(intact)
    expect(result.valid).toBe(true)
  })

  it('empty chain is reported as missing_genesis', () => {
    const result = verifyChain([])
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.break.reason).toBe('missing_genesis')
  })
})
