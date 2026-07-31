# Research: `pg` in Next.js 16 route handlers + raw-SQL migration runner

Issue: [#2](https://github.com/angelguzmaning/policy-ledger-service/issues/2) · Map: [#1](https://github.com/angelguzmaning/policy-ledger-service/issues/1)
Date: 2026-07-31 · Pinned versions in this repo: `next@16.2.12`, `react@19.2.4`

Locked upstream, not revisited here: Postgres via docker-compose + `pg`, raw SQL, no ORM, one Next.js app with thin route handlers over a framework-free `src/server/` service layer, boring beats clever.

---

## Q1 — Creating and sharing a `pg` Pool in Next 16

### TL;DR recommendation

Create **one lazily-initialised `Pool`, pinned on `globalThis`**, in a single module under `src/server/db/`. Do **not** set `serverExternalPackages` (`pg` is already on Next's built-in externals list), do **not** export `runtime` from route files (`'nodejs'` is the default and `'edge'` is deprecated for Route Handlers), and do **not** wire a shutdown hook into the Next app — call `pool.end()` only in the standalone scripts and tests that own their own process.

### 1.1 `pg` needs no bundler configuration

`serverExternalPackages` opts a package out of Server Component / Route Handler bundling so it resolves via native Node `require`.

> "Dependencies used inside Server Components and Route Handlers will automatically be bundled by Next.js. If a dependency is using Node.js specific features, you can choose to opt-out specific dependencies from the Server Components bundling and use native Node.js `require`."
> — [nextjs.org/docs/.../serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) (page reports `version: 16.2.12`)

That same page publishes the built-in auto-externalised list, and **`pg` is on it**. Verified directly against the source of record for the exact tag we depend on:

- [`packages/next/src/lib/server-external-packages.jsonc` @ `v16.2.12`](https://raw.githubusercontent.com/vercel/next.js/v16.2.12/packages/next/src/lib/server-external-packages.jsonc) — contains `"pg"` between `"oslo"` and `"pino"`.

**Consequence:** `next.config.ts` needs no change for `pg`. If a reviewer asks "shouldn't you add `serverExternalPackages: ['pg']`?", the defensible answer is: it is already externalised by default, adding it is a harmless no-op, and we prefer not to carry config that does nothing. (`pg-native` is *not* on the list — we are not using it, and it is an optional native dep of `pg` that `pg` only loads if you explicitly require `pg/native`.)

Version note for older blog posts: the option was `experimental.serverComponentsExternalPackages` before v15 and was renamed + stabilised to top-level `serverExternalPackages` in **v15.0.0** ([version-15 upgrade guide](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/upgrading/version-15.mdx), and the version-history table on the `serverExternalPackages` reference page). Anything telling you to put it under `experimental` is stale.

### 1.2 `runtime` — leave it alone

Route segment config reference for 16.2:

> "Configure the JavaScript runtime for a route segment by exporting a `runtime` constant. Choose between `'nodejs'` (default) or `'edge'`."
> — [`route-segment-config/runtime.mdx` @ v16.2.9](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.mdx)

And from the TypeScript-plugin option descriptions in the Next source, which is blunter:

> `runtime`: `"nodejs"` — Prefer the Node.js runtime. `"edge"` — **@deprecated** The Edge Runtime is deprecated. Use `"nodejs"` instead.
> "No export is needed for Node.js."
> — [`packages/next/src/server/typescript/rules/config.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/typescript/rules/config.ts)

**Consequence:** `export const runtime = 'nodejs'` in every route file is noise. Skip it. (Blog posts from the Next 13/14 era pushed it because Edge was being marketed; in 16 it is the default and Edge is deprecated for Route Handlers.)

Also relevant and frequently mis-stated: `GET` Route Handlers have been **dynamic by default since v15.0.0-RC** ("The default caching for `GET` handlers was changed from static to dynamic" — version history table on [`route.js`](https://nextjs.org/docs/app/api-reference/file-conventions/route)). So we do not need `export const dynamic = 'force-dynamic'` to stop a DB-reading `GET` being frozen at build time. That guard was a real Next 13/14 requirement and is now obsolete.

### 1.3 Why the module-level `Pool` leaks in dev, and what actually fixes it

`pg`'s own guidance is one pool per application:

> "Creating an unbounded number of pools defeats the purpose of pooling at all."
> — [node-postgres.com/features/pooling](https://node-postgres.com/features/pooling)

The dev-time hazard is that a plain module-level `const pool = new Pool()` is **not** one pool per application, because Next's dev server re-evaluates changed server modules in the same process. Evidence from the Next 16.2 Turbopack release post:

> "We've reworked how server-side code is reloaded during development. **The previous system cleared the `require.cache` for the changed module and all other modules in its import chain.** … The new system brings the same Fast Refresh approach used in the browser to your server code … only the module that actually changed is reloaded."
> — [Turbopack: What's New in Next.js 16.2](https://nextjs.org/blog/next-16-2-turbopack#server-fast-refresh)

Critically, in the same paragraph:

> "Today we're enabling this feature for all developers, by default. **Proxy and Route Handlers will use the existing system today**, but support for those is arriving in a future release."

This is the single biggest Next-16-specific fact for our case: **Server Fast Refresh does not yet cover Route Handlers in 16.2**, so our API modules still go through the old clear-the-`require.cache` path on every edit. Corroborated in the shipped code — `hot-reloader-turbopack.js` computes `usesServerHmr` and, when false, pushes the emitted server chunk onto `filesToDelete` (cache eviction), and the webpack path's `NextJsRequireCacheHotReloader` calls `deleteCache([targetPath])` on `assetEmitted`:

- `node_modules/next/dist/server/dev/hot-reloader-turbopack.js` (~L443–460, `usesServerHmr`, `clearModuleContext`, `filesToDelete`)
- `node_modules/next/dist/build/webpack/plugins/nextjs-require-cache-hot-reloader.js` (`deleteCache`)

Module re-evaluation ⇒ `new Pool()` runs again ⇒ the previous pool's sockets and its `idleTimeoutMillis` timer are still open with nothing referencing them. Ten edits, ten pools. This is exactly the failure Prisma documents for the same reason:

> "if the framework refreshes the module responsible for exporting `PrismaClient`, this can result in **additional, unwanted instances** … you can store `PrismaClient` as a global variable in development environments only, as global variables are not reloaded"
> — [Prisma docs, "Prevent hot reloading from creating new instances"](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections#prevent-hot-reloading-from-creating-new-instances-of-prismaclient)

`globalThis` is per-process, and `next dev` does not restart the process on an edit — so a pool pinned there survives every HMR cycle. It also stays correct once Route Handlers *do* move onto Server Fast Refresh, and it is a no-op in production where modules are evaluated once.

### 1.4 Minimal sketch

```ts
// src/server/db/pool.ts
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __policyLedgerPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  return new Pool({
    connectionString,
    max: 10,                      // pg's own documented default; see pool-sizing guide
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  // Pinned on globalThis so `next dev` HMR (which re-evaluates route-handler
  // modules) reuses one pool instead of leaking a new one per edit.
  globalThis.__policyLedgerPool ??= createPool();
  return globalThis.__policyLedgerPool;
}
```

```ts
// src/server/db/tx.ts — checkout/commit/rollback/release, the one place we hold a client
import type { PoolClient } from 'pg';
import { getPool } from './pool';

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // "you must always return the client to the pool"
  }
}
```

```ts
// src/app/api/policies/[policyId]/endorsements/route.ts — thin, no runtime export, no pool here
import { getPool } from '@/server/db/pool';
import { createEndorsement } from '@/server/endorsements/service';

export async function POST(req: Request, ctx: RouteContext<'/api/policies/[policyId]/endorsements'>) {
  const { policyId } = await ctx.params;   // params is a Promise since v15
  const body = await req.json();
  const result = await createEndorsement(getPool(), policyId, body);
  return Response.json(result, { status: 201 });
}
```

Two Next-16 API details baked into that sketch, both from the [`route.js` reference](https://nextjs.org/docs/app/api-reference/file-conventions/route):

- `context.params` **is a Promise** as of `v15.0.0-RC` — must be `await`ed. Older examples destructure it synchronously.
- `RouteContext<'/api/...'>` is a globally available generated helper ("Types are generated during `next dev`, `next build` or `next typegen`… doesn't need to be imported"). Free type safety on `params`, no import.

The service layer takes `Pool | PoolClient` as its first argument — which is what makes the `src/server/` layer framework-free and directly testable, per the locked topology.

### 1.5 Shutdown: the honest answer is "don't"

`pool.end()` is the documented drain:

> "Demonstrates how to shut down a connection pool by calling `pool.end()`, which waits for checked-out clients to be returned before closing all clients and timers."
> — [node-postgres.com/features/pooling](https://node-postgres.com/features/pooling)

But wiring it into the Next server is a bad trade, for a reason we can cite:

Next.js already installs its own signal handlers and **calls `process.exit()` itself**:

```ts
// packages/next/src/server/lib/start-server.ts
if (!process.env.NEXT_MANUAL_SIG_HANDLE) {
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
```
…where `cleanup` closes the HTTP server, awaits `nextServer.close()` and the registered cleanup listeners, then `process.exit(130 | 143)`.
— [`start-server.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/lib/start-server.ts)

A user `process.on('SIGTERM', () => pool.end())` registered from `instrumentation.ts` races that `process.exit()`. You *can* register side effects at startup — `instrumentation.ts`'s `register` "is called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests" ([instrumentation reference](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)) — but the payoff is nil: on Ctrl-C the process dies, the TCP sockets close, and Postgres reaps the backends. There is no connection leak that outlives the process.

So the defensible position, and the one to say out loud in the interview:

- **Next app:** no shutdown hook. Draining a pool milliseconds before the process exits buys nothing, and racing the framework's own `process.exit` is worse than doing nothing. (If we ever *did* need it, the documented lever is `NEXT_MANUAL_SIG_HANDLE=1` plus our own handlers — noted, not used.)
- **Scripts** (migrate, seed/replay) and **Vitest integration tests:** `pool.end()` is mandatory, because without it the pool's idle sockets keep the Node event loop alive and the process hangs. `pg` also offers `allowExitOnIdle: true` for exactly this ("handy in scripts & tests where you don't want to wait for your clients to go idle before your process exits" — [Pool config type definition](https://node-postgres.com/apis/pool)). Use `await pool.end()` in a `finally` / `afterAll`; it is more explicit than the flag.

### 1.6 Pool sizing

Leave `max` at the default.

> "mostly I'd just leave the pool size to the default of `10` until you run into troubles."
> — [node-postgres.com/guides/pool-sizing](https://node-postgres.com/guides/pool-sizing)

We are a single local process against a single docker-compose Postgres. Stating `max: 10` explicitly (rather than relying on the implicit default) makes it a visible, defendable number.

### 1.7 What older posts get wrong — checklist for the interview

| Stale advice | Reality in Next 16.2 |
| --- | --- |
| `experimental.serverComponentsExternalPackages: ['pg']` | Renamed/stabilised to top-level `serverExternalPackages` in v15 — and `pg` is auto-externalised anyway |
| `export const runtime = 'nodejs'` in every route | It is the default; `'edge'` is deprecated for Route Handlers |
| `export const dynamic = 'force-dynamic'` so the DB `GET` isn't cached | `GET` handlers are dynamic by default since v15.0.0-RC |
| `{ params }: { params: { id: string } }` | `params` is a `Promise` since v15.0.0-RC; use `await` (and `RouteContext<'/route/[id]'>`) |
| "HMR doesn't reload server modules, a module-level pool is fine" | Route Handlers are explicitly **not** on Server Fast Refresh in 16.2; the old `require.cache`-clearing path still applies |
| `next dev --turbopack` | Turbopack is the default for `dev` **and** `build` in 16; the flag is unnecessary |

---

## Q2 — Raw-SQL migration runner

### TL;DR recommendation

**Hand-rolled runner.** A `migrations/` directory of plain, numbered `.sql` files plus a ~40-line TS script that tracks applied filenames in `schema_migrations`, run inside a single transaction, run identically locally and in CI via `pnpm db:migrate`. It is the only option where the reviewer's "what runs my SQL?" question is answered by a file they can read in 60 seconds, and it adds **zero** dependencies and zero install steps to a 6-hour build.

Fallback if we wanted a library: **`node-pg-migrate`**, because it is an npm devDependency that already speaks `pg` and reads plain `.sql` files by default. `dbmate` is genuinely the nicest tool of the three but is a Go binary the reviewer must install, and its default schema dump shells out to `pg_dump` — that is reviewer-setup friction we would have to earn, and we can't.

### 2.1 Scorecard

| | Hand-rolled | `node-pg-migrate` | `dbmate` |
| --- | --- | --- | --- |
| **Migrations are plain readable `.sql`** | Yes, by construction — the file is exactly what runs | Yes. `.sql` is a supported `--migration-file-language`, and if `migrationLoaderStrategies` is unset "`.sql` files use the legacy SQL loader (`legacySql`)". Optional `-- Up Migration` / `-- Down Migration` markers | Yes, but every file **must** carry `-- migrate:up` / `-- migrate:down` directives |
| **Install / reviewer setup** | Nothing. `pg` is already a dependency | `npm add --save-dev node-pg-migrate` (also requires Node 22+, Postgres 14+) | npm / brew / scoop / curl-a-binary / Docker. Cross-platform, but it is a **binary**, not a library |
| **Extra runtime deps** | 0 | 1 devDependency | 1 platform binary; `dbmate dump` additionally needs `pg_dump` **in PATH** ("this command relies on the respective `pg_dump` … commands being available in your PATH") |
| **CI vs `services: postgres`** | `DATABASE_URL=postgres://…@localhost:5432/…` then `pnpm db:migrate`. Nothing extra | Same, one npm script | Same, plus install the binary; upstream CI recipe also uses `dbmate --wait --wait-timeout 30s wait` |
| **Tracking table** | Ours: `schema_migrations(version text primary key, applied_at timestamptz)` | `pgmigrations(id serial, name varchar(255), run_on timestamp)` — `name` = filename basename without extension | `schema_migrations(version)` |
| **Transactions** | Whatever we write — one `BEGIN`/`COMMIT` around the batch | `--single-transaction` **default true**: "Combines all pending migrations into a single transaction so that if any migration fails, all will be rolled back". Also `--no-lock`, `--advisory-lock-mode`, `--check-order` | In a transaction by default; per-block `transaction:false` escape hatch |
| **Line-by-line defensibility** | Total. Every line is ours and we chose it | We must explain someone else's advisory-lock + ordering semantics if pressed | We must explain a Go binary's behaviour we cannot read in the repo |
| **Setup cost in a 6h budget** | ~30–40 min including the script and the first migration | ~20 min, but a new dep to justify | ~20 min + install docs in the README + a `pg_dump`/`--no-dump-schema` decision |

Sources for the above: [node-pg-migrate README](https://salsita.github.io/node-pg-migrate/) · [node-pg-migrate CLI docs](https://salsita.github.io/node-pg-migrate/cli) · [migration-loading-strategies](https://github.com/salsita/node-pg-migrate/blob/main/docs/src/migration-loading-strategies.md) · [`src/runner.ts` (table columns `id`/`name`/`run_on`)](https://github.com/salsita/node-pg-migrate/blob/main/src/runner.ts) · [`src/sqlMigration.ts` (plain `.sql` ⇒ whole file is `up`, `down` is `false`)](https://github.com/salsita/node-pg-migrate/blob/main/src/sqlMigration.ts) · [dbmate README](https://github.com/amacneil/dbmate) · [dbmate migration-api](https://github.com/amacneil/dbmate/blob/main/_autodocs/migration-api.md) · [dbmate CI example](https://github.com/amacneil/dbmate/blob/main/_autodocs/quick-start-examples.md)

### 2.2 The decisive arguments

1. **The brief's scoring is "can you explain this?", not "did you pick a tool?"** The map's standing constraint is that every decision survives a line-by-line live defence. A 40-line script we wrote is the *maximally* defensible artefact; a library forces us to defend semantics we did not choose (node-pg-migrate's advisory-lock mode, its `--check-order` behaviour, dbmate's directive parser).
2. **A down-migration story we would not use anyway.** node-pg-migrate's plain-`.sql` loader sets `down` to `false` when there are no marker comments — so out of the box a plain file is *not* reversible. dbmate makes `-- migrate:down` mandatory boilerplate. For a 6-hour take-home whose recovery story is "drop the volume and re-run", forward-only is the honest design, and hand-rolling lets us say so explicitly instead of leaving half-configured down-migrations lying around.
3. **Reviewer friction is the tiebreaker against dbmate.** The map says anything costing reviewer setup friction must earn it. `dbmate` is a binary install plus (by default) a `pg_dump` dependency for the schema dump. Nothing in this take-home needs what dbmate buys over 40 lines.
4. **CI is trivial for all three** — the only real difference is whether a step installs a binary. Given the postgres service container already works the same way for every option, this dimension does not rescue dbmate.

**Honest counter-argument to keep in your pocket:** "hand-rolled" is not free — the ~40 lines must be correct about advisory locking, ordering, and transaction boundaries, and a library has already been correct about those for years. The rebuttal is scope: single developer, single migration process, no concurrent deployers. We take an advisory lock anyway (one line) so the answer to "what if two processes race?" is "they don't, and here's the lock".

### 2.3 Minimal sketch — hand-rolled runner

```
migrations/
  0001_policy_core.sql
  0002_ledger.sql
  0003_policy_events.sql
```

Files are plain SQL, forward-only, no directives, no markers:

```sql
-- migrations/0001_policy_core.sql
create table policies (
  id            text primary key,
  ...
);
```

```ts
// scripts/migrate.ts  — run with: pnpm db:migrate
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    // One advisory lock for the whole run: two concurrent migrators can't interleave.
    await client.query('select pg_advisory_lock($1)', [727_2026]);
    await client.query(`
      create table if not exists schema_migrations (
        version     text primary key,
        applied_at  timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (await client.query<{ version: string }>('select version from schema_migrations'))
        .rows.map((r) => r.version),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);                       // whole file, one statement batch
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration failed: ${file}`, { cause: err });
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [727_2026]).catch(() => {});
    client.release();
    await pool.end();   // required, or the process hangs on idle sockets
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Notes we should be able to say aloud:
- **Version key is the filename**, not a hash — a reviewer can `select * from schema_migrations` and immediately match rows to files. (This mirrors what node-pg-migrate stores in `pgmigrations.name`.)
- **One transaction per file**, not one per run. A failed migration leaves every earlier file applied and recorded; re-running resumes. (node-pg-migrate defaults the other way, `--single-transaction` across the batch — a legitimate alternative; per-file is easier to reason about when you're re-running by hand.)
- **`pg_advisory_lock`** is the boring answer to "what if CI and your laptop migrate at once?".
- **`client.query(sql)`** on the whole file uses the simple query protocol, which permits multiple statements — that is why migrations may contain several DDL statements, and why we must not parameterise inside a migration file.

`package.json`:

```json
{
  "scripts": {
    "db:migrate": "tsx scripts/migrate.ts",
    "db:seed": "tsx scripts/seed.ts"
  }
}
```

### 2.4 Minimal sketch — CI

Straight from GitHub's own PostgreSQL service-container doc (job on the runner, service ports mapped to the host, `pg_isready` health gate):

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:migrate
      - run: pnpm test
```

The two load-bearing facts from [GitHub's docs](https://docs.github.com/en/actions/using-containerized-services/creating-postgresql-service-containers):

> "When you run a job directly on the runner machine, you'll need to map the ports on the service container to ports on the Docker host. You can access service containers from the Docker host using **localhost** and the Docker host port number."

and the health options above are GitHub's own recommended block — with `--health-cmd pg_isready` the job does not start until Postgres accepts connections, so **no `sleep`, no wait-for-it script, no `dbmate wait`** is needed. (`services` are Linux-runner only.)

Note this CI shape is identical for all three candidate tools; only the presence/absence of an install step differs. That is precisely why the tool choice should be decided on explainability, not CI behaviour.

---

## Open items this research does *not* settle

- Whether `schema_migrations` should also store a checksum of each file (catches an edited-after-apply migration). Cheap to add, one more thing to defend; leaning **no** for a 6-hour build, and saying why.
- Whether `docker-compose` should run migrations on startup or leave it to `pnpm db:migrate`. Leaning explicit, because a reviewer running one command should see the migration output.
- Test-database strategy (migrate-once + truncate between tests vs. transaction-per-test rollback). Belongs to the testing ticket, but note that the transaction-per-test pattern conflicts with a service layer that opens its own `BEGIN` via `withTransaction`.

## Sources

**Next.js (primary, version-pinned)**
- [`serverExternalPackages` reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — v16.2.12
- [`server-external-packages.jsonc` @ v16.2.12](https://raw.githubusercontent.com/vercel/next.js/v16.2.12/packages/next/src/lib/server-external-packages.jsonc) — `pg` present
- [`route.js` reference](https://nextjs.org/docs/app/api-reference/file-conventions/route) — v16.2.12, version-history table
- [`route-segment-config/runtime` @ v16.2.9](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.mdx)
- [`typescript/rules/config.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/typescript/rules/config.ts) — Edge deprecation for Route Handlers
- [`instrumentation.js` reference](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [`start-server.ts`](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/lib/start-server.ts) — SIGINT/SIGTERM + `NEXT_MANUAL_SIG_HANDLE`
- [Next.js 16.2 release post](https://nextjs.org/blog/next-16-2) and [Turbopack 16.2 deep-dive](https://nextjs.org/blog/next-16-2-turbopack) — Server Fast Refresh, Route Handlers excluded
- [v15 upgrade guide](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/upgrading/version-15.mdx) and [v16 upgrade guide](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/upgrading/version-16.mdx)
- Locally installed `next@16.2.12`: `dist/server/dev/hot-reloader-turbopack.js`, `dist/build/webpack/plugins/nextjs-require-cache-hot-reloader.js`, `dist/server/lib/render-server.js`

**node-postgres**
- [Pooling](https://node-postgres.com/features/pooling) · [Pool API + config type](https://node-postgres.com/apis/pool) · [Pool sizing](https://node-postgres.com/guides/pool-sizing)

**Migration tools**
- [node-pg-migrate README](https://salsita.github.io/node-pg-migrate/) · [CLI options](https://salsita.github.io/node-pg-migrate/cli) · [migration loading strategies](https://github.com/salsita/node-pg-migrate/blob/main/docs/src/migration-loading-strategies.md) · [`src/runner.ts`](https://github.com/salsita/node-pg-migrate/blob/main/src/runner.ts) · [`src/sqlMigration.ts`](https://github.com/salsita/node-pg-migrate/blob/main/src/sqlMigration.ts)
- [dbmate README](https://github.com/amacneil/dbmate) · [migration API](https://github.com/amacneil/dbmate/blob/main/_autodocs/migration-api.md) · [quick-start / CI](https://github.com/amacneil/dbmate/blob/main/_autodocs/quick-start-examples.md)

**Secondary, used only for the HMR-pattern precedent**
- [Prisma: prevent hot reloading from creating new instances](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections#prevent-hot-reloading-from-creating-new-instances-of-prismaclient)

**CI**
- [GitHub Actions: Creating PostgreSQL service containers](https://docs.github.com/en/actions/using-containerized-services/creating-postgresql-service-containers)
