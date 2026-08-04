// `pnpm db:reset` -- DROP, recreate, migrate, seed. Destructive by design and
// development-only.
//
// It exists because `pnpm replay` is not idempotent: it POSTs data/events.json
// through the real API, so running it twice against the same database produces
// two endorsements and two rejections and no longer matches the brief's
// Expected Output. Reset first, then replay, and the output is reproducible.
//
// The test suite does NOT use this -- test/global-setup.ts owns its own
// throwaway `policy_ledger_test` database and never touches this one.

import { Pool, types } from 'pg'
import {
  DATABASE_NAME,
  databaseUrl,
  dropDatabase,
  ensureDatabaseExists,
  migrate,
} from './lib/database'
import { seedPolicy } from './lib/seedPolicy'

types.setTypeParser(1082, (value: string) => value)

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset refuses to run with NODE_ENV=production.')
  }

  const target = new URL(databaseUrl())
  console.log(`Resetting "${DATABASE_NAME}" on ${target.host} -- all data will be lost.`)

  await dropDatabase()
  await ensureDatabaseExists()

  const applied = await migrate()
  console.log(`Applied ${applied.length} migration(s).`)

  const pool = new Pool({ connectionString: databaseUrl() })
  try {
    const { policyId } = await seedPolicy(pool)
    console.log(`Seeded ${policyId}.`)
  } finally {
    await pool.end()
  }

  console.log('Done. Run `pnpm replay` against a running `pnpm dev` for a clean Expected Output.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
