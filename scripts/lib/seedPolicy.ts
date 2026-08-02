// The seed itself, as a function so both `scripts/seed.ts` and
// `scripts/reset-db.ts` share one definition of "a freshly seeded database".
//
// Only `data/policy.json` is inserted (+ its genesis `policy_created` event).
// `data/events.json` is deliberately NOT touched here: those records are
// fixture input for `scripts/replay.ts`, POSTed through the real API so the
// demonstration is honest. See docs/spec/seed-replay-and-deliverables.md.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { appendPolicyEvent } from '@/server/service/shared'

interface PolicySeed {
  policy_id: string
  homeowner_id: string
  status: string
  term_start: string
  term_end: string
  annual_premium_cents: number
  currency: string
}

export interface SeedResult {
  policyId: string
  alreadySeeded: boolean
}

export async function seedPolicy(pool: Pool): Promise<SeedResult> {
  const policy = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'policy.json'), 'utf8'),
  ) as PolicySeed

  const { rowCount } = await pool.query('SELECT 1 FROM policies WHERE policy_id = $1', [
    policy.policy_id,
  ])
  if (rowCount && rowCount > 0) {
    return { policyId: policy.policy_id, alreadySeeded: true }
  }

  await pool.query(
    `INSERT INTO policies (policy_id, homeowner_id, status, term_start, term_end, annual_premium_cents, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      policy.policy_id,
      policy.homeowner_id,
      policy.status,
      policy.term_start,
      policy.term_end,
      policy.annual_premium_cents,
      policy.currency,
    ],
  )

  await appendPolicyEvent(pool, {
    policyId: policy.policy_id,
    eventType: 'policy_created',
    recordedAt: `${policy.term_start}T00:00:00.000Z`,
    payload: {
      policy_id: policy.policy_id,
      homeowner_id: policy.homeowner_id,
      term_start: policy.term_start,
      term_end: policy.term_end,
      annual_premium_cents: policy.annual_premium_cents,
      currency: policy.currency,
    },
  })

  return { policyId: policy.policy_id, alreadySeeded: false }
}
