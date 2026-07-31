# Research 0003 — Postgres integration-test isolation + Vitest configuration

Resolves issue #3 (part of the map, #1). Sources are primary: PostgreSQL manual, Vitest
docs (repo `docs/` on `main`), node-postgres docs and test suite, Testcontainers for
Node.js docs, Next.js docs, GitHub Actions docs, Node.js API docs. Verified 2026-07-31.

Locked context not revisited: Postgres via docker-compose + `pg` (no ORM), Vitest +
coverage, CI is the only gate, TDD on the pure domain core with integration tests
alongside the endpoints, five required test areas (proration, duplicate delivery,
wrong-currency failure, balanced ledger writes, history verification).

---

## Recommendation in one paragraph

**Use a dedicated `policy_ledger_test` database, created and migrated once per run in
Vitest `globalSetup`, with `TRUNCATE ... RESTART IDENTITY CASCADE` between tests, and run
the integration project with `fileParallelism: false`.** Reject per-test transaction
rollback outright — our service layer issues its own `BEGIN`/`COMMIT`, and Postgres
explicitly ignores a nested `BEGIN`, so the wrapper would be defeated by the very code
under test. Reject Testcontainers as the primary mechanism because docker-compose is
already locked and Testcontainers adds a Docker-daemon dependency and container startup
per run without solving between-test cleanup. Keep `CREATE DATABASE ... TEMPLATE` as a
documented escape hatch for per-worker parallelism if the suite ever outgrows serial
execution.

---

## Part 1 — Test database strategy

### The decisive constraint: our code owns its transactions

The service layer opens transactions itself, because that is exactly what the brief wants
demonstrated (atomic endorsement write, `SELECT ... FOR UPDATE`, rollback on the
wrong-currency path). node-postgres has no transaction abstraction to hook:

> "To execute a transaction with node-postgres, you execute `BEGIN`, `COMMIT`, or
> `ROLLBACK` queries yourself through a client. node-postgres does not provide
> higher-level abstractions for transactions."
> — <https://github.com/brianc/node-postgres/blob/master/docs/pages/features/transactions.mdx>

> "You must use the same client instance for all statements within a transaction.
> PostgreSQL isolates a transaction to individual clients. Do not use transactions with
> the `pool.query` method, as it will lead to problems."
> — same page

And Postgres does not nest `BEGIN`:

> "Issuing `BEGIN` when already inside a transaction block will provoke a warning message.
> The state of the transaction is not affected. To nest transactions within a transaction
> block, use savepoints (see SAVEPOINT)."
> — <https://www.postgresql.org/docs/current/sql-begin.html> (Notes)

So if a test wraps the call in an outer `BEGIN`:

- the service's `BEGIN` is a **warning and a no-op**;
- the service's `COMMIT` **commits the test's outer transaction** — nothing is rolled back,
  data leaks into the next test, and the "isolation" is a fiction;
- the service's `ROLLBACK` on the wrong-currency path **rolls back the entire outer
  transaction**, destroying the test's own seed data;
- a 23505 on a duplicate idempotency key aborts the whole outer transaction, so every
  subsequent statement fails with `25P02 in_failed_sql_transaction` unless the test
  manages savepoints on the service's behalf.

Vitest's own recipe states the precondition plainly:

> "This requires database driver support for nested transactions or savepoints, which
> covers most modern databases."
> — <https://github.com/vitest-dev/vitest/blob/main/docs/guide/recipes/db-transaction.md>

`pg` has no such support. Emulating it means injecting a client wrapper that rewrites
`BEGIN` → `SAVEPOINT`, `COMMIT` → `RELEASE SAVEPOINT`, `ROLLBACK` → `ROLLBACK TO
SAVEPOINT`. That is test-induced production distortion applied to precisely the code path
the brief asks us to prove, and it is indefensible in a line-by-line walkthrough: the
committed-vs-rolled-back boundary would never actually be exercised.

There is a second, independent killer. `FOR UPDATE` locks are held to end of transaction:

> "`FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` and `FOR KEY SHARE` are *locking
> clauses*; they affect how `SELECT` locks rows as they are obtained from the table."
> — <https://www.postgresql.org/docs/current/sql-select.html> (The Locking Clause)

To observe contention you need **two** concurrent transactions on **two** connections. A
single wrapping transaction cannot express that. **Option (c) is ruled out.**

### The four options, judged

| | (a) Testcontainers per run | (b) `policy_ledger_test` from migrated template, recreated per run | (c) per-test transaction rollback | (d) truncate between tests |
|---|---|---|---|---|
| Speed | slowest: image pull (first run) + container start each run | fast: `CREATE DATABASE ... TEMPLATE` is a physical copy, once per run | fastest in theory | fast: `TRUNCATE` on ~7 small tables is sub-millisecond-to-low-ms |
| Isolation | strongest (fresh server) but only *between runs* — still needs per-test cleanup | strong per run / per worker | nominal only; broken here (see above) | good, if the truncate list is exhaustive |
| Unchanged against GH Actions `services: postgres` | **No** — bypasses the service container entirely; needs a Docker daemon in the job | Yes — one extra admin connection to the `postgres` database | Yes | Yes |
| Real `BEGIN`/`COMMIT` | Yes | Yes | **No** | Yes |
| `SELECT ... FOR UPDATE` contention | Yes | Yes | **No** | Yes |
| 23505 on duplicate idempotency key | Yes | Yes | Only with savepoint emulation | Yes |
| Atomic rollback on rejected request | Yes | Yes | **No** | Yes |
| Reviewer setup friction | needs Docker + a second orchestration story next to docker-compose | none beyond docker-compose | none | none |

Notes on each:

**(a) Testcontainers.** Real and well documented — `new PostgreSqlContainer().start()` then
`getConnectionUri()` (<https://github.com/testcontainers/testcontainers-node/blob/main/docs/modules/postgresql.md>),
installed as `@testcontainers/postgresql`. It requires a supported container runtime
(Docker "works out of the box"; Podman/Colima/Rancher need `DOCKER_HOST` and
`TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` —
<https://node.testcontainers.org/supported-container-runtimes/>). Container reuse is gated
by `withReuse()` **and** `TESTCONTAINERS_REUSE_ENABLE`; CI sets it to `"false"`
(`packages/testcontainers/src/generic-container/generic-container.ts`), so in CI you pay
full startup every run. Crucially, Testcontainers answers "where does Postgres come from",
which docker-compose already answers for us, and does **not** answer "how are tests
isolated from each other" — you still need (b), (c) or (d) inside it. It also makes the CI
workflow diverge from the locked `services: postgres` shape. Not worth its keep here.

**(b) Template clone.** Genuinely fast, and the right lever for parallelism — clone one
migrated template into `policy_ledger_test_w1..wN`, one per Vitest worker. But:

> "The principal limitation is that no other sessions can be connected to the template
> database while it is being copied. `CREATE DATABASE` will fail if any other connection
> exists when it starts."
> — <https://www.postgresql.org/docs/current/sql-createdatabase.html> (Notes)

That is a real footgun with a pool open, and it buys nothing until the suite is big enough
to want parallel workers. Document it; don't build it now.

**(d) Truncate.** Vitest's recipe calls truncation "slow" relative to rollback, but that
judgement is scoped to large suites; our integration surface is five test areas over a
handful of small tables. `TRUNCATE ... RESTART IDENTITY CASCADE` resets sequences and
follows FK references, and derived from `pg_tables` it cannot drift out of sync with new
migrations.

### Chosen strategy (b-lite + d)

1. `globalSetup` connects to the `postgres` admin database, `DROP DATABASE IF EXISTS
   policy_ledger_test WITH (FORCE)`, `CREATE DATABASE policy_ledger_test`, then runs the
   **same raw-SQL migration runner production uses** against it. Migrating once per run,
   not per file, is what `globalSetup` is for: "Setup runs before test workers are created
   (only if tests are queued)" (<https://vitest.dev/config/#globalsetup>).
   - `FORCE`: "Attempt to terminate all existing connections to the target database."
   - `DROP DATABASE` "cannot be executed inside a transaction block" and "cannot be
     executed while you are connected to the target database" — hence the admin
     connection. (<https://www.postgresql.org/docs/current/sql-dropdatabase.html>)
   - `WITH (FORCE)` requires PostgreSQL 13+; pin the docker-compose image accordingly.
2. `setupFiles` opens one `pg.Pool` per test file against that database and truncates all
   non-migration tables in `beforeEach`. Truncating **before** each test (not after) leaves
   the failing test's rows in place for post-mortem inspection.
3. Integration tests run with `fileParallelism: false`, so only one file touches the
   database at a time — Vitest's own guidance: "If your tests share an external resource
   like a database that can't handle concurrent access", disable parallelism via
   `fileParallelism: false` (<https://vitest.dev/guide/parallelism>).
4. Tests that need contention (`FOR UPDATE`) deliberately open **two** pool clients and
   interleave them by hand. That is possible only because we did not take option (c).

Assertions this preserves, with sources:

- **23505 on a duplicate idempotency key.** `pg` surfaces the SQLSTATE on the error object;
  node-postgres' own integration test asserts `err.code === '23505'` along with
  `err.table` and `err.constraint`
  (`packages/pg/test/integration/client/query-error-handling-tests.js`). Postgres defines
  `23505 unique_violation` (and `23503 foreign_key_violation`, `23514 check_violation`,
  `40001 serialization_failure`, `40P01 deadlock_detected`) —
  <https://www.postgresql.org/docs/current/errcodes-appendix.html>. Assert on the SQLSTATE,
  never on the message text.
- **Atomic rollback on the wrong-currency path.** The test calls the real service, expects
  the rejection, then queries the pool afterwards and asserts zero rows in
  `ledger_entries`, `payments`, and `policy_events`. Only meaningful because the service's
  own `ROLLBACK` really executed.
- **Balanced ledger writes / history verification.** Plain post-commit `SELECT`s; nothing
  strategy-specific.

### CI shape (unchanged code path)

Local docker-compose and GitHub Actions both expose Postgres on `localhost:5432`, so the
same `DATABASE_URL` works in both:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
```

The `ports` mapping "maps tcp port 5432 on service container to the Docker host", and the
hostname is `localhost` because the job runs on the runner itself
(<https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers>).
Nothing in `globalSetup` changes between local and CI.

---

## Part 2 — Vitest configuration

### Vitest over `node:test`: confirmed

`node:test` is stable since v20, and it does strip TypeScript types by default. But:

- **Coverage is Stability 1 – Experimental**, gated behind
  `--experimental-test-coverage` (<https://nodejs.org/api/test.html>). Coverage is a locked
  deliverable and a scored signal; shipping it on an experimental flag is a bad look in a
  walkthrough. Vitest's coverage provider defaults to `v8` with first-class `thresholds`
  (<https://vitest.dev/config/#coverage-provider>).
- **`node:test` does not read `tsconfig.json` `paths`.** Type stripping erases types; it
  does not resolve `@/*`. We'd rewrite imports or add a loader.
- **No project split, no `globalSetup` with typed `provide`/`inject`.** We need one command
  that runs the pure-domain unit project and the DB-backed integration project with
  different parallelism settings; Vitest's `projects` does this natively.
- Vitest shares the app's transformation pipeline: "a test runner that uses the same
  configuration as your app... sharing a common transformation pipeline during dev, build,
  and test time" (<https://vitest.dev/guide/why>).

Version to pin: `vitest@4` (latest `4.1.10` at time of writing). Note the v4 shape —
`poolOptions` has effectively vanished from the documented surface; the knobs are now
`pool` (default `'forks'`), `maxWorkers`/`minWorkers`, `fileParallelism`, and `isolate`
(<https://vitest.dev/config/#pool>, <https://vitest.dev/config/#maxworkers>,
<https://vitest.dev/config/#isolate>). Write the config against those, not against
`poolOptions.forks.singleFork`.

### `vite-tsconfig-paths`: yes, needed

Our `tsconfig.json` declares `"paths": { "@/*": ["./src/*"] }`. Vitest's own troubleshooting
page:

> "It's possible that you rely on `baseUrl` in your `tsconfig.json`. Vite doesn't take into
> account `tsconfig.json` by default, so you might need to install `vite-tsconfig-paths`."
> — <https://vitest.dev/guide/common-errors>

Next.js's own Vitest guide lists `vite-tsconfig-paths` as a TypeScript-only dev dependency
and puts it first in `plugins`
(<https://nextjs.org/docs/app/guides/testing/vitest>). The alternative — a hand-written
`resolve.alias` using `new URL('./src/', import.meta.url).pathname` (relative aliases are
resolved against the importing file, not the root) — works but drifts from `tsconfig.json`.
Take the plugin.

We do **not** need `@vitejs/plugin-react` or `jsdom`. Next's guide adds them for component
tests, and warns "Since `async` Server Components are new to the React ecosystem, Vitest
currently does not support them." Our tested surface is `src/server/**` — framework-free,
`environment: 'node'`. The operator UI is deliberately not unit-tested.

### Parallelism knobs, and which one does what

- `fileParallelism` — "Should all test files run in parallel. (Default: `true`)"; disabling
  it "automatically constrains `maxWorkers` to `1`". "This option doesn't affect tests
  running in the same file." (<https://vitest.dev/config/#fileparallelism>)
- Within a file, "tests execute sequentially by default"; they run concurrently only when
  marked `concurrent`, or globally via `sequence.concurrent: true` (default `false`)
  (<https://vitest.dev/guide/parallelism>, <https://vitest.dev/config/#sequence-concurrent>).
  So `sequence.concurrent: false` is already the default — set it explicitly in the
  integration project as documentation-in-code, and never mark a DB test `.concurrent`.
- `isolate` (default `true`) — leave it **on**. Turning it off is the optimisation the
  Vitest DB recipe pairs with worker-scoped connections, and it comes with a warning:
  "When workers are reused, files share module instances, allowing tests that modify
  top-level state (counters, caches, globals) to leak that state to subsequent files in the
  same worker." (<https://vitest.dev/guide/recipes/db-transaction>) Not worth it at our size.
- `pool` stays at the default `'forks'` (<https://vitest.dev/config/#pool>).

### Concrete `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/db.ts'],
          // One test file touches the database at a time.
          fileParallelism: false,
          // Explicit for the reader; false is already the default.
          sequence: { concurrent: false },
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
    // Coverage is a root-level option; it spans both projects.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/server/**'],
      exclude: ['src/server/**/*.test.ts', 'src/server/db/migrations/**'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
```

Notes: the unit project is the TDD surface (proration/rounding, canonical serialization +
hash chaining, ledger balancing) and stays fully parallel. The integration project carries
duplicate delivery, wrong-currency rollback, balanced writes and history verification. A
config that declares `projects` "doesn't run tests itself, it only provides the projects
that do" (<https://vitest.dev/config/#projects>), hence the plugin is repeated per project.
`lcov` is in the reporter list for CI upload; the documented default is
`['text', 'html', 'clover', 'json']` (<https://vitest.dev/config/#coverage-reporter>).

Scripts:

```json
{
  "test": "vitest run",
  "test:unit": "vitest run --project unit",
  "test:integration": "vitest run --project integration",
  "test:coverage": "vitest run --coverage"
}
```

### Global-setup sketch — `test/global-setup.ts`

```ts
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'
import { runMigrations } from '../src/server/db/migrate'

const ADMIN_URL =
  process.env.POSTGRES_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'policy_ledger_test'

export default async function setup(project: TestProject) {
  // DROP/CREATE DATABASE cannot run inside a transaction block and cannot run while
  // connected to the target database, so both go through the admin connection.
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  try {
    // WITH (FORCE) terminates leftover connections from an aborted previous run. PG13+.
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`)
    await admin.query(`CREATE DATABASE "${TEST_DB}"`)
  } finally {
    await admin.end()
  }

  const url = new URL(ADMIN_URL)
  url.pathname = `/${TEST_DB}`
  const databaseUrl = url.toString()

  // Same raw-SQL migration runner production uses — migrations are exercised every run.
  const migrator = new Client({ connectionString: databaseUrl })
  await migrator.connect()
  try {
    await runMigrations(migrator)
  } finally {
    await migrator.end()
  }

  project.provide('databaseUrl', databaseUrl)

  // Watch mode: re-migrate from scratch on rerun so schema edits are picked up.
  project.onTestsRerun(async () => {
    /* optionally re-run setup */
  })

  return async () => {
    // Teardown. Leave the DB in place when KEEP_TEST_DB is set, for post-mortem psql.
    if (process.env.KEEP_TEST_DB) return
    const cleanup = new Client({ connectionString: ADMIN_URL })
    await cleanup.connect()
    await cleanup.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`)
    await cleanup.end()
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}
```

`globalSetup` "is running in a different global scope before test workers are even
created, so your tests don't have access to global variables defined here" — data crosses
the boundary only via `provide()`/`inject()`, which is why `databaseUrl` is passed that way
and typed by augmenting `ProvidedContext`
(<https://vitest.dev/config/#globalsetup>, <https://vitest.dev/config/#provide>).
Teardown may be returned from the default export or exported as `teardown`.

### Per-file DB harness — `test/db.ts` (a `setupFiles` entry)

```ts
import { Pool } from 'pg'
import { afterAll, beforeEach, inject } from 'vitest'

export const pool = new Pool({ connectionString: inject('databaseUrl'), max: 5 })

// Derived from the catalog so it can never drift behind a new migration.
const TRUNCATE_SQL = `
  DO $$
  DECLARE stmt text;
  BEGIN
    SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ')
           || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'schema_migrations';
    IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
  END $$;
`

// Before, not after: a failing test leaves its rows behind for inspection.
beforeEach(async () => {
  await pool.query(TRUNCATE_SQL)
})

afterAll(async () => {
  await pool.end()
})
```

With `pool: 'forks'` and `isolate: true`, each test file runs in its own child process, so
one pool per file is correct and `afterAll` must close it or the run will not exit.

### Escape hatch, if the suite outgrows serial runs

Keep `fileParallelism: false` until it hurts. When it does: in `globalSetup`, migrate
`policy_ledger_template`, then `CREATE DATABASE policy_ledger_test_w<N> TEMPLATE
policy_ledger_template` once per worker and hand each worker its own URL. Constraint to
respect: "no other sessions can be connected to the template database while it is being
copied" — close every connection to the template before cloning
(<https://www.postgresql.org/docs/current/sql-createdatabase.html>).

---

## Feeds

- **#11 test plan and CI workflow** — the `services: postgres` block above, the four npm
  scripts, and `--coverage` in CI.
- **#9 persistence** — the migration runner must be callable as a plain function against a
  `pg.Client` (`runMigrations(client)`), not only as a CLI, so `globalSetup` can invoke it.
- **#7 idempotency** — assert on SQLSTATE `23505` plus `err.constraint`, never on message
  text.
- **#4 toolchain** — add `vitest`, `@vitest/coverage-v8`, `vite-tsconfig-paths` as dev
  dependencies. No `@vitejs/plugin-react`, no `jsdom`, no `@testcontainers/postgresql`.

## Sources

- PostgreSQL 17 manual: `BEGIN`, `SELECT` (locking clause), `CREATE DATABASE`,
  `DROP DATABASE`, Appendix A error codes — <https://www.postgresql.org/docs/current/>
- Vitest docs on `main`: `config/fileparallelism.md`, `config/globalsetup.md`,
  `config/isolate.md`, `config/maxworkers.md`, `config/pool.md`, `config/projects.md`,
  `config/coverage.md`, `config/alias.md`, `guide/parallelism.md`, `guide/why.md`,
  `guide/common-errors.md`, `guide/recipes/db-transaction.md` —
  <https://github.com/vitest-dev/vitest/tree/main/docs>
- node-postgres: `docs/pages/features/transactions.mdx`, `docs/pages/apis/pool.mdx`,
  `packages/pg/test/integration/client/query-error-handling-tests.js` —
  <https://github.com/brianc/node-postgres>
- Testcontainers for Node.js: `docs/modules/postgresql.md`,
  `docs/supported-container-runtimes.md`,
  `packages/testcontainers/src/generic-container/generic-container.ts` —
  <https://github.com/testcontainers/testcontainers-node>
- Next.js: "How to set up Vitest with Next.js" —
  <https://nextjs.org/docs/app/guides/testing/vitest>
- GitHub Actions: "Creating PostgreSQL service containers" —
  <https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers>
- Node.js: `node:test` API — <https://nodejs.org/api/test.html>
