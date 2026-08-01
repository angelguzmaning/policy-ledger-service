// `pnpm db:seed` -- inserts only `data/policy.json` as a straight INSERT (+
// its genesis `policy_created` event). `data/events.json` is deliberately
// NOT touched here: those records are fixture input for `scripts/replay.ts`,
// POSTed through the real API so the demonstration is honest. See
// docs/spec/seed-replay-and-deliverables.md.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool, types } from 'pg'
import { appendPolicyEvent } from '@/server/service/shared'

types.setTypeParser(1082, (value: string) => value)

const ADMIN_URL =
  process.env.POSTGRES_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const DATABASE_NAME = process.env.DATABASE_NAME ?? 'policy_ledger'

interface PolicySeed {
  policy_id: string
  homeowner_id: string
  status: string
  term_start: string
  term_end: string
  annual_premium_cents: number
  currency: string
}

async function main(): Promise<void> {
  const policy = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'policy.json'), 'utf8'),
  ) as PolicySeed

  const url = new URL(ADMIN_URL)
  url.pathname = `/${DATABASE_NAME}`
  const pool = new Pool({ connectionString: url.toString() })

  try {
    const { rowCount } = await pool.query('SELECT 1 FROM policies WHERE policy_id = $1', [
      policy.policy_id,
    ])
    if (rowCount && rowCount > 0) {
      console.log(`Policy ${policy.policy_id} already seeded; nothing to do.`)
      return
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

    console.log(`Seeded policy ${policy.policy_id}.`)
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
