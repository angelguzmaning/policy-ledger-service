// `pnpm db:migrate` -- creates the app database off the admin connection if
// it doesn't exist yet, then runs the same migration runner the Vitest
// integration project's global-setup uses.

import { Client } from 'pg'
import { runMigrations } from '@/server/db/migrate'

const ADMIN_URL =
  process.env.POSTGRES_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const DATABASE_NAME = process.env.DATABASE_NAME ?? 'policy_ledger'

async function ensureDatabaseExists(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DATABASE_NAME,
    ])
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${DATABASE_NAME}"`)
      console.log(`Created database "${DATABASE_NAME}".`)
    }
  } finally {
    await admin.end()
  }
}

async function main(): Promise<void> {
  await ensureDatabaseExists()

  const url = new URL(ADMIN_URL)
  url.pathname = `/${DATABASE_NAME}`

  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  try {
    const applied = await runMigrations(client)
    if (applied.length === 0) {
      console.log('No new migrations to apply.')
    } else {
      console.log(`Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`)
    }
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
