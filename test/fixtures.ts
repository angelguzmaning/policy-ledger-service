import type { Pool } from 'pg'
import { appendPolicyEvent } from '@/server/service/shared'

export interface PolicySeed {
  policy_id: string
  homeowner_id: string
  status: 'active' | 'cancelled' | 'expired'
  term_start: string
  term_end: string
  annual_premium_cents: number
  currency: string
}

const DEFAULT_POLICY: PolicySeed = {
  policy_id: 'POL-1001',
  homeowner_id: 'HOME-204',
  status: 'active',
  term_start: '2026-01-01',
  term_end: '2027-01-01',
  annual_premium_cents: 120_000,
  currency: 'USD',
}

/** A `POL-1001`-shaped active policy, with a genesis `policy_created` event -- every chain needs one. */
export async function seedPolicy(
  db: Pool,
  overrides: Partial<PolicySeed> = {},
): Promise<PolicySeed> {
  const policy = { ...DEFAULT_POLICY, ...overrides }

  await db.query(
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

  await appendPolicyEvent(db, {
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

  return policy
}

export async function countAllTables(db: Pool): Promise<Record<string, number>> {
  const { rows } = await db.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> 'schema_migrations'
  `)
  const counts: Record<string, number> = {}
  for (const { table_name } of rows) {
    const {
      rows: [row],
    } = await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "${table_name}"`)
    counts[table_name] = Number(row?.n ?? 0)
  }
  return counts
}
