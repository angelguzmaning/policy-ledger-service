// `Db` and `Tx` are distinct types so a function that must run inside a
// transaction (taking `Tx`) cannot compile if handed a bare pool. Read-only
// helpers take `Db | Tx`. `withTransaction` is called from exactly one
// layer -- the service functions invoked by route handlers -- so nesting is
// unreachable by construction. See docs/spec/schema-and-transactions.md.

import type { Pool, PoolClient } from 'pg'

export type Db = Pool
export type Tx = PoolClient & { readonly __tx: unique symbol }

export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client as unknown as Tx)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
