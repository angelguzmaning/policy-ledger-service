// `pnpm db:seed` -- inserts `data/policy.json` into an already-migrated
// database. Idempotent: a second run is a no-op, not an error.

import { Pool, types } from 'pg'
import { databaseUrl } from './lib/database'
import { seedPolicy } from './lib/seedPolicy'

types.setTypeParser(1082, (value: string) => value)

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl() })
  try {
    const { policyId, alreadySeeded } = await seedPolicy(pool)
    console.log(
      alreadySeeded ? `Policy ${policyId} already seeded; nothing to do.` : `Seeded ${policyId}.`,
    )
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
