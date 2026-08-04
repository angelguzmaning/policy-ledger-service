// Per-file DB harness (`setupFiles`). One `pg.Pool` per test file, truncated
// before each test -- before, not after, so a failing test leaves its rows
// in place for post-mortem. `ledger_accounts` is excluded: it is migration
// 0005's chart of accounts (structure, not data) and every financial write
// after a CASCADE-truncated chart would fail.

import { Pool, types } from 'pg'
import { afterAll, beforeEach, inject } from 'vitest'

// Load-bearing: see src/server/db/pool.ts.
types.setTypeParser(1082, (value: string) => value)

export const pool = new Pool({ connectionString: inject('databaseUrl'), max: 5 })

const TRUNCATE_SQL = `
  DO $$
  DECLARE stmt text;
  BEGIN
    SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ')
           || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'ledger_accounts');
    IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
  END $$;
`

beforeEach(async () => {
  await pool.query(TRUNCATE_SQL)
})

afterAll(async () => {
  await pool.end()
})
