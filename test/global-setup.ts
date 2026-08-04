// Vitest `globalSetup` for the `integration` project. Drops and recreates a
// dedicated `policy_ledger_test` database once per run, then runs the exact
// migration runner production uses. See docs/research/0003-pg-test-isolation-and-vitest-config.md.

import { Client } from 'pg'
import type { TestProject } from 'vitest/node'
import { runMigrations } from '@/server/db/migrate'

const ADMIN_URL =
  process.env.POSTGRES_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'policy_ledger_test'

export default async function setup(project: TestProject) {
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`)
    await admin.query(`CREATE DATABASE "${TEST_DB}"`)
  } finally {
    await admin.end()
  }

  const url = new URL(ADMIN_URL)
  url.pathname = `/${TEST_DB}`
  const databaseUrl = url.toString()

  const migrator = new Client({ connectionString: databaseUrl })
  await migrator.connect()
  try {
    await runMigrations(migrator)
  } finally {
    await migrator.end()
  }

  project.provide('databaseUrl', databaseUrl)

  return async () => {
    if (process.env.KEEP_TEST_DB) return
    const cleanup = new Client({ connectionString: ADMIN_URL })
    await cleanup.connect()
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`)
    } finally {
      await cleanup.end()
    }
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}
