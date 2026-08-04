// The migration runner. Callable as a plain function against a `pg.Client`
// so both `scripts/migrate.ts` (production/dev) and the Vitest integration
// project's `global-setup.ts` invoke the exact same code path. One
// transaction per file, a `schema_migrations` ledger, `pg_advisory_lock`
// around the run. See docs/spec/schema-and-transactions.md.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Client, PoolClient } from 'pg'

const MIGRATIONS_DIR = join(process.cwd(), 'migrations')
// Arbitrary fixed key for the advisory lock guarding a migration run.
const ADVISORY_LOCK_KEY = 727_301

export async function runMigrations(client: Client | PoolClient): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY])
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `)

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    )
    const applied = new Set(rows.map((r) => r.filename))
    const newlyApplied: string[] = []

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        newlyApplied.push(file)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    return newlyApplied
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
  }
}
