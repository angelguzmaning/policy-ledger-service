// Shared plumbing for the `scripts/` entry points. Every script reaches the
// server through POSTGRES_ADMIN_URL (an admin connection to `postgres`) and
// derives the app database from it, so a single env var moves the whole
// toolchain to another host or port. Loaded from `.env.local` by dotenvx --
// see the `dotenv` prefix on the package.json scripts.

import { Client } from 'pg'
import { runMigrations } from '@/server/db/migrate'

export const ADMIN_URL =
  process.env.POSTGRES_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
export const DATABASE_NAME = process.env.DATABASE_NAME ?? 'policy_ledger'

/** The admin URL with its path swapped to the app database. */
export function databaseUrl(): string {
  const url = new URL(ADMIN_URL)
  url.pathname = `/${DATABASE_NAME}`
  return url.toString()
}

async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  try {
    return await fn(admin)
  } finally {
    await admin.end()
  }
}

/** Creates the app database if it does not exist. Returns true if it created one. */
export function ensureDatabaseExists(): Promise<boolean> {
  return withAdminClient(async (admin) => {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DATABASE_NAME,
    ])
    if (rowCount !== 0) return false
    await admin.query(`CREATE DATABASE "${DATABASE_NAME}"`)
    return true
  })
}

/**
 * Drops the app database, disconnecting anyone still attached to it (FORCE) --
 * `pnpm dev`'s pool holds an open connection and would otherwise block this.
 * Development only; there is no production caller.
 */
export function dropDatabase(): Promise<void> {
  return withAdminClient(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`)
  })
}

/** Runs pending migrations against the app database. Returns the filenames applied. */
export async function migrate(): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl() })
  await client.connect()
  try {
    return await runMigrations(client)
  } finally {
    await client.end()
  }
}
