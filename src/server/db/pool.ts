// Lazily-initialised pool: nothing here connects at import time, which is
// what lets `next build` succeed without DATABASE_URL set (see
// docs/spec/test-plan-and-ci.md's note on the CI job deliberately not
// setting DATABASE_URL). `setTypeParser(1082, ...)` is load-bearing --
// without it, `pg` silently reverts `DATE` columns to local-midnight `Date`
// objects and the epoch-days design (ADR-0001) is undone invisibly.

import { Pool, types } from 'pg'

// OID 1082 = DATE. Returning the raw string keeps parseDate (@/server/domain/dates)
// as the only thing that ever turns it into a number, with no local timezone in between.
types.setTypeParser(1082, (value: string) => value)

let pool: Pool | undefined

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }
    pool = new Pool({ connectionString })
  }
  return pool
}
