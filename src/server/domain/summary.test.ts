import { describe, expect, it } from 'vitest'
import { buildExplanation, suggestedAction, type SummaryFacts } from '@/server/domain/summary'

const base: SummaryFacts = {
  policyId: 'POL-1001',
  status: 'active',
  annualPremiumCents: 144_000,
  currency: 'USD',
  termStart: '2026-01-01',
  termEnd: '2027-01-01',
  endorsementCount: 1,
  latestEndorsement: {
    id: 'END-2001',
    effectiveDate: '2026-07-01',
    deltaCents: 12_099,
    annualPremiumDeltaCents: 24_000,
  },
  balanceCents: 0,
  openDocumentCount: 0,
  history: { valid: true, eventCount: 3, verifiedThroughSeq: 3 },
  rejectedEvents: [],
}

describe('buildExplanation -- clause 1 (policy), always present', () => {
  it('states id, status, premium, term', () => {
    expect(buildExplanation(base)).toContain(
      'Policy POL-1001 is active with an annual premium of $1,440.00 USD for the term 2026-01-01 to 2027-01-01.',
    )
  })
})

describe('buildExplanation -- clause 2 (endorsement)', () => {
  it('raised, >=1 applied -- the full annual delta and the pro-rata billed amount are distinct figures', () => {
    expect(buildExplanation(base)).toContain(
      'most recently END-2001 effective 2026-07-01, which raised the annual premium by $240.00 USD and billed $120.99 USD pro-rata.',
    )
  })

  it('lowered, ≥1 applied', () => {
    const facts: SummaryFacts = {
      ...base,
      latestEndorsement: {
        id: 'END-2002',
        effectiveDate: '2026-08-01',
        deltaCents: -500,
        annualPremiumDeltaCents: -1_000,
      },
    }
    expect(buildExplanation(facts)).toContain(
      'which lowered the annual premium by $10.00 USD and billed $5.00 USD pro-rata',
    )
  })

  it('zero-delta latest', () => {
    const facts: SummaryFacts = {
      ...base,
      latestEndorsement: {
        id: 'END-2003',
        effectiveDate: '2026-09-01',
        deltaCents: 0,
        annualPremiumDeltaCents: 0,
      },
    }
    expect(buildExplanation(facts)).toContain(
      'most recently END-2003 effective 2026-09-01, which left the annual premium unchanged and produced no billing document.',
    )
  })

  it('omitted entirely when zero endorsements applied -- not rendered as "0 endorsements"', () => {
    const facts: SummaryFacts = { ...base, endorsementCount: 0, latestEndorsement: null }
    expect(buildExplanation(facts)).not.toContain('endorsement')
  })
})

describe('buildExplanation -- clause 3 (balance)', () => {
  it('positive', () => {
    const facts: SummaryFacts = { ...base, balanceCents: 12_099, openDocumentCount: 1 }
    expect(buildExplanation(facts)).toContain(
      '$120.99 USD is currently outstanding across 1 open billing document(s).',
    )
  })

  it('zero', () => {
    expect(buildExplanation(base)).toContain(
      'The account is fully paid; there is no outstanding balance.',
    )
  })

  it('negative', () => {
    const facts: SummaryFacts = { ...base, balanceCents: -500 }
    expect(buildExplanation(facts)).toContain(
      'The account holds a credit of $5.00 USD, which will offset future charges. No refund is issued by this system.',
    )
  })
})

describe('buildExplanation -- clause 4 (history)', () => {
  it('valid', () => {
    expect(buildExplanation(base)).toContain(
      'The policy history chain of 3 events verifies intact.',
    )
  })

  it('broken', () => {
    const facts: SummaryFacts = {
      ...base,
      history: {
        valid: false,
        eventCount: 3,
        verifiedThroughSeq: 1,
        breakSeq: 2,
        breakReason: 'event_hash_mismatch',
      },
    }
    expect(buildExplanation(facts)).toContain(
      'History verification FAILED at event 2 (event_hash_mismatch); events 1 to 1 remain provably intact.',
    )
  })
})

describe('buildExplanation -- clause 5 (rejected)', () => {
  it('≥1 rejection', () => {
    const facts: SummaryFacts = {
      ...base,
      rejectedEvents: [{ id: 'PAY-9002', reason: 'currency mismatch' }],
    }
    expect(buildExplanation(facts)).toContain(
      '1 inbound request(s) were rejected: PAY-9002 (currency mismatch).',
    )
  })

  it('none: clause omitted', () => {
    expect(buildExplanation(base)).not.toContain('rejected')
  })
})

describe('suggestedAction -- the ladder, first match wins', () => {
  it('rung 1: history invalid', () => {
    const facts: SummaryFacts = {
      ...base,
      balanceCents: 500, // would otherwise hit rung 2
      history: {
        valid: false,
        eventCount: 3,
        verifiedThroughSeq: 1,
        breakSeq: 2,
        breakReason: 'event_hash_mismatch',
      },
    }
    expect(suggestedAction(facts)).toBe(
      'Investigate history integrity: verification failed at event 2 (event_hash_mismatch). Do not rely on derived balances until this is resolved.',
    )
  })

  it('rung 2: balance > 0', () => {
    const facts: SummaryFacts = { ...base, balanceCents: 12_099 }
    expect(suggestedAction(facts)).toBe('Collect the outstanding balance of $120.99 USD.')
  })

  it('rung 3: balance < 0', () => {
    const facts: SummaryFacts = { ...base, balanceCents: -500 }
    expect(suggestedAction(facts)).toBe(
      'Review the credit balance of $5.00 USD with the insured; no refund is issued by this system.',
    )
  })

  it('rung 4: status != active', () => {
    const facts: SummaryFacts = { ...base, status: 'cancelled' }
    expect(suggestedAction(facts)).toBe(
      'Policy is cancelled; no further endorsements can be applied.',
    )
  })

  it('rung 5: otherwise -- No action required', () => {
    expect(suggestedAction(base)).toBe('No action required')
  })

  it("the brief's sample state: rejections present, balance 0, chain valid -- No action required", () => {
    const facts: SummaryFacts = {
      ...base,
      rejectedEvents: [{ id: 'PAY-9002', reason: 'currency mismatch' }],
    }
    expect(suggestedAction(facts)).toBe('No action required')
  })

  it('chain broken and balance positive: the history rung wins because it is first', () => {
    const facts: SummaryFacts = {
      ...base,
      balanceCents: 12_099,
      history: {
        valid: false,
        eventCount: 3,
        verifiedThroughSeq: 1,
        breakSeq: 2,
        breakReason: 'event_hash_mismatch',
      },
    }
    expect(suggestedAction(facts)).toContain('Investigate history integrity')
  })
})
