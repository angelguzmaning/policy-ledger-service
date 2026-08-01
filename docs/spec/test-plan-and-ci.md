# Test plan and CI

Resolves [#11](https://github.com/angelguzmaning/policy-ledger-service/issues/11). Applies the harness
concluded by [research 0003](../research/0003-pg-test-isolation-and-vitest-config.md)
([#3](https://github.com/angelguzmaning/policy-ledger-service/issues/3)), the toolchain shipped by
[#4](https://github.com/angelguzmaning/policy-ledger-service/issues/4), the schema and transaction boundaries of
[#9](https://github.com/angelguzmaning/policy-ledger-service/issues/9), and the contract of
[#10](https://github.com/angelguzmaning/policy-ledger-service/issues/10).

---

## 1. The rule that sizes the suite

> **A test costs the database only when the brief requires it to.**

The brief names five test areas. Exactly one of them — proration — is pure. The other four are DB-backed by
construction: duplicate delivery needs a real `UNIQUE` violation, wrong-currency needs a real `ROLLBACK`, balanced
writes need the deferred constraint trigger to fire at `COMMIT`, and history verification needs stored rows to
rehash. Those four define the entire integration surface.

Everything else is pushed down a level rather than dropped. This is affordable only because of a decision the map
locked at the very start: business logic lives in a framework-free `src/server/` service layer that takes a DB
client. So:

| Concern                                               | Where it is tested                       | Costs a database? |
| ----------------------------------------------------- | ---------------------------------------- | ----------------- |
| Proration, rounding, money formatting                 | pure unit                                | no                |
| Canonical serialization, hashing, chain verification  | pure unit + golden vector                | no                |
| Ledger posting shape, waterfall allocation            | pure unit                                | no                |
| Zod schemas, the strip, `PolicyIdMismatch`            | pure unit                                | no                |
| Domain error → HTTP status and envelope               | pure unit on `toHttpResponse`            | no                |
| Explanation clauses and the `suggested_action` ladder | pure unit                                | no                |
| The four required areas                               | integration, **service called directly** | yes               |
| Service-layer guards needing policy state (`422`s)    | integration, service called directly     | yes               |

### No test boots Next

There are no HTTP-level tests. A route handler is three statements — parse, call the service, map the outcome —
and each of the three is covered elsewhere: the parse by the Zod unit tests, the call by the integration tests,
the map by `toHttpResponse`. Booting a Next server to reassemble three tested parts buys coverage of the assembly
only, at the price of the slowest and most brittle tests in the suite.

The consequence is stated rather than hidden: **the route handlers themselves are not executed by the suite.** It
is in the limitations table, and it is why they are held to three statements.

### What was deliberately left out

Two candidate tests were considered and declined, both for the same reason — impressive, not required, and
expensive inside a six-hour timebox.

- **The contention test.** Two hand-interleaved clients plus a `pg_locks` poll, proving `SELECT … FOR UPDATE`
  serializes two simultaneous identical endorsements. It is the most impressive test the suite could contain and
  the deterministic shape does work (the second client's `BEGIN` blocks in Postgres; the test never races). It is
  declined because the lock is not left unexercised by its absence — duplicate delivery already drives the
  idempotency re-read path, just without contention — and the honest gap is one row in the limitations table.
- **A golden-file diff of the seeded `GET /api/policies/POL-1001` against the brief's Expected Output.** The
  replay stays a script ([#13](https://github.com/angelguzmaning/policy-ledger-service/issues/13)), demonstrated
  in the walkthrough, not gated in CI. This supersedes case 19 of the
  [API contract test table](api-contract.md#11-test-table).

---

## 2. Unit tests — the TDD surface

Red-green-refactor, in this order. The order is dependency order: each module is written against a test that can
only be written once the module below it exists.

### 1. `prorate` — proration and rounding

The heart of the brief, and the one required area that is pure. Epoch-days in, `BigInt` inside, `number` out
([#5](https://github.com/angelguzmaning/policy-ledger-service/issues/5)).

| #   | Case                                                   | Asserts                                                    |
| --- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | Brief's case: +24000/yr, 2026-07-01, 365-day term      | `12099` — the number in the Expected Output                |
| 2   | Effective on `term_start`                              | full delta, no proration loss                              |
| 3   | Effective on `term_end`                                | one day's worth, not zero and not negative                 |
| 4   | Negative delta                                         | negative result, magnitude rounded identically to positive |
| 5   | Exact-half rounding, positive                          | rounds away from zero                                      |
| 6   | Exact-half rounding, negative, **366-day leap term**   | rounds away from zero — `-0` is never produced             |
| 7   | Zero delta                                             | `0`                                                        |
| 8   | Premium large enough to overflow `number` mid-multiply | correct — this is what `BigInt` is for                     |
| 9   | Single-day term                                        | no division by zero                                        |
| 10  | Result is always a safe integer                        | property-style assertion over the table                    |

Case 6 requires a 366-day term because no exact half is reachable on 365 days. `Math.round` appears nowhere:
`Math.round(-0.5)` is `-0`.

### 2. `parseDate` — strict date parsing to epoch-days

Regex-validated `YYYY-MM-DD` to an integer. Rejects `2026-13-01`, `2026-02-30`, `2026-7-1`, and anything with a
time component. **No `Date` object and no clock enters the domain core**, which is what makes backdated
endorsements legal and every test deterministic.

### 3. `canonicalJson` — the shared canonicalizer

One primitive, two jobs: the hash chain preimage
([#8](https://github.com/angelguzmaning/policy-ledger-service/issues/8)) and the idempotency fingerprint
([#7](https://github.com/angelguzmaning/policy-ledger-service/issues/7)).

| #   | Case                                                  | Asserts                                                  |
| --- | ----------------------------------------------------- | -------------------------------------------------------- |
| 1   | Keys emitted in sorted order regardless of insertion  | `{b:1,a:2}` and `{a:2,b:1}` produce identical bytes      |
| 2   | Nested objects sorted recursively                     | ordering is not shallow                                  |
| 3   | Arrays preserve order                                 | position is meaning in an array, unlike an object        |
| 4   | No whitespace anywhere                                | byte-exact output                                        |
| 5   | String escaping matches `JSON.stringify`              | quotes, backslashes, control chars, non-ASCII            |
| 6   | **Throws** on a float                                 | `1.5` is unhashable — the no-floats rule made structural |
| 7   | **Throws** on `NaN`, `Infinity`, `-0`                 | each individually                                        |
| 8   | **Throws** on `undefined`, a `Date`, a class instance | only the six legal types survive                         |
| 9   | Integer beyond `Number.MAX_SAFE_INTEGER` throws       | safe-integer, not merely integer                         |

Test 6 is the load-bearing one: it is what lets the spec claim a float _cannot_ reach a hash.

### 4. `eventHash` — the preimage, pinned to an external constant

Every column except `event_hash` itself, canonicalized, SHA-256, lowercase hex.

| #   | Case                                                        | Asserts                                                                       |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | **Golden vector** — a fixed event → a hard-coded hex string | pinned against a constant produced by `sha256sum`, not against our own output |
| 2   | Changing any single field changes the hash                  | one case per hash-covered column, table-driven                                |
| 3   | Genesis: `previous_hash` null is part of the preimage       | not skipped                                                                   |
| 4   | Output matches `/^[0-9a-f]{64}$/`                           | the column CHECK is not the only guard                                        |

Case 1 is the guarantee that a reviewer can reproduce a stored `event_hash` by hand. A test that hashes with the
same function it is testing proves only self-consistency; the constant is what makes it a test.

### 5. `verifyChain` — pure, over an array of events

Verification takes rows and returns a verdict; reading the rows is someone else's job. That is what makes the four
break reasons unit-testable.

| #   | Case                                     | Asserts                                               |
| --- | ---------------------------------------- | ----------------------------------------------------- |
| 1   | Intact 3-event chain                     | `valid: true`, `head_hash` is the last event's hash   |
| 2   | Payload edited at `seq` 2                | `event_hash_mismatch` at 2, `verified_through_seq: 1` |
| 3   | `previous_hash` repointed at `seq` 3     | `previous_hash_mismatch` at 3                         |
| 4   | `seq` 2 removed                          | `sequence_gap`                                        |
| 5   | Chain starting at `seq` 2                | `missing_genesis`                                     |
| 6   | Two breaks present                       | only the **first** is reported                        |
| 7   | Verification uses the writer's code path | rehash goes through `eventHash`, not a copy           |

### 6. `postEndorsement` / `postPayment` — ledger entry construction

Pure builders returning entry arrays ([#6](https://github.com/angelguzmaning/policy-ledger-service/issues/6)).

| #   | Case                          | Asserts                                                           |
| --- | ----------------------------- | ----------------------------------------------------------------- |
| 1   | Positive delta                | DR `premium_receivable` / CR `written_premium`, sum `0`, 2 legs   |
| 2   | Negative delta                | the same two accounts, signs reversed — one code path, both signs |
| 3   | Payment                       | DR `cash` / CR `premium_receivable`                               |
| 4   | Every builder output          | `SUM(amount_cents) === 0` and `length >= 2`                       |
| 5   | No entry has `amount_cents` 0 | the column CHECK restated where it can be caught earlier          |

### 7. `allocate` — the oldest-open-first waterfall

Pure over `(openDocuments, amountCents)`.

| #   | Case                                          | Asserts                                                   |
| --- | --------------------------------------------- | --------------------------------------------------------- |
| 1   | Exact settlement of one document              | one application, `unapplied: 0`, status `applied`         |
| 2   | Partial payment                               | one application for the full payment, document stays open |
| 3   | Overpayment across two documents              | both settled in `due_date` order, remainder unapplied     |
| 4   | No open documents                             | zero applications, status `unapplied`                     |
| 5   | Ties on `due_date`                            | broken by `issued_at` then id — **deterministic**         |
| 6   | Sum of applications never exceeds the payment | property assertion                                        |

Case 5 is not pedantry: replay reproducibility depends on the order being total.

### 8. `formatMoney`

`BigInt` division, so the no-floats rule needs no carve-out for presentation. Cases: zero, sub-dollar, exact
dollar, thousands separator, negative, and a value above `MAX_SAFE_INTEGER` cents.

### 9. `buildExplanation` and `suggestedAction`

Table-driven against §9 of the [API contract](api-contract.md#9-the-readable-summary--rule-based-no-llm). One test
per clause condition (11 rows) and one per ladder rung (5 rows), plus:

- rejections present, balance `0`, chain valid → `"No action required"` — the brief's sample state, for a stated
  reason rather than by coincidence;
- chain broken **and** balance positive → the history rung wins, because it is first;
- zero endorsements → clause 2 omitted entirely, not rendered as "0 endorsements".

### 10. Zod schemas and the strip

| #   | Case                                      | Expected                                             |
| --- | ----------------------------------------- | ---------------------------------------------------- |
| 1   | `events.json` endorsement object verbatim | parses; `type` and `policy_id` accepted              |
| 2   | Same object with `type` omitted           | **strips to the identical command object** as case 1 |
| 3   | Unknown key `foo`                         | fails, `issues[0].path === ['foo']`                  |
| 4   | `amount_cents: 120.5`                     | fails on `amount_cents`                              |
| 5   | `received_at: "…T18:30:00.000Z"`          | fails — one legal rendering only                     |
| 6   | `currency: "EUR"`                         | **parses** — shape only, never `z.literal('USD')`    |
| 7   | Body `policy_id` ≠ path                   | `PolicyIdMismatch`                                   |
| 8   | Path segment of 65 chars                  | fails                                                |
| 9   | Path segment `hello`                      | **parses** — 404-dominant, not 400                   |

Case 2 is the one that matters: it asserts the strip directly, and the strip is what keeps a retry omitting a
decorative field from becoming a `409`. Case 6 is the reason the brief's currency-mismatch path still exists.

### 11. `toHttpResponse`

One case per code in the ten-row table: correct status, `error.code` present, `details` present **iff**
`InvalidRequest`, `request_id` present iff `InternalError`, and no Postgres text in any message.

---

## 3. Integration tests — the four required areas

All four call the service layer directly with a `Pool`. None boots Next.

### A. Duplicate delivery

| #   | Case                                                                | Asserts                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `END-2001` applied, then redelivered identically                    | `200 duplicate ignored`, response **deep-equals** the first modulo `idempotency_result`; exactly one `endorsements` row, one `policy_events` row, one `billing_documents` row, one `ledger_transactions` row |
| A2  | `PAY-9001` applied, then redelivered identically                    | same shape; `cash` balance debited **once**                                                                                                                                                                  |
| A3  | `END-2001` redelivered with a changed `new_annual_premium_cents`    | `IdempotencyKeyConflict`; no new rows anywhere                                                                                                                                                               |
| A4  | `END-2001` redelivered with a changed `reason`                      | `IdempotencyKeyConflict` — `reason` is inside the fingerprint                                                                                                                                                |
| A5  | `END-2001` redelivered to a **different** policy                    | `IdempotencyKeyConflict`, not a second endorsement — the `UNIQUE` is on the key alone                                                                                                                        |
| A6  | Same real payment under a fresh key (`PAY-9003`)                    | `ExternalPaymentIdConflict`; `cash` debited once                                                                                                                                                             |
| A7  | Replay of an endorsement applied while active, policy now cancelled | `200 duplicate ignored` — the original result does not expire                                                                                                                                                |

A1 and A2 are the deep-equality assertions that make "replay is a projection, not a snapshot" checkable rather
than asserted. A5 is the one a `(policy_id, key)` composite would have silently passed.

### B. Wrong-currency failure — the atomicity proof

| #   | Case                               | Asserts                                                                                      |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| B1  | `PAY-9002` in EUR                  | `CurrencyMismatch`; **whole-database count snapshot unchanged except `inbound_requests` +1** |
| B2  | `PAY-9002` resubmitted in USD      | applied — the rejected request never consumed its key                                        |
| B3  | The `inbound_requests` row from B1 | `outcome: 'rejected'`, `error_code: 'CurrencyMismatch'`, body stored verbatim                |
| B4  | A `404` on an unknown policy       | still writes an `inbound_requests` row — the missing FK is what allows it                    |

B1 uses `countAllTables`, reading the table list from `information_schema` so a table added by a later migration is
covered without touching the test. It proves nothing exists _anywhere_, not that nothing exists in the three tables
the author remembered. `countAllTables` lives in the shared fixtures.

### C. Balanced ledger writes

| #   | Case                                                          | Asserts                                                                      |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| C1  | After an endorsement and a payment                            | `SUM(amount_cents) = 0` over every entry; every transaction has `>= 2` legs  |
| C2  | `GROUP BY ledger_transaction_id HAVING SUM <> 0`              | **empty** — the same probe `/ledger` exposes                                 |
| C3  | Negative-delta endorsement                                    | balanced, `premium_credit` document, `amount_cents > 0` intact               |
| C4  | Zero-delta endorsement                                        | a `policy_events` row and **no** ledger transaction, **no** billing document |
| C5  | Deliberately unbalanced insert, raw SQL, inside a transaction | `COMMIT` **raises** — the deferred trigger is real, not decorative           |
| C6  | `open_balance_cents` after a full payment                     | `0`, and equals the `premium_receivable` balance — the ledger is the source  |
| C7  | Overpayment                                                   | `open_balance_cents` negative; cash still posted                             |
| C8  | `UPDATE` on `ledger_entries`                                  | raises `restrict_violation` — append-only enforced by the database           |

C5 is the test that earns the constraint trigger. Without it, the trigger is a claim; with it, the suite
demonstrates that a sign error cannot commit. Note it must bypass the service layer deliberately — it is testing
the database, not the code.

### D. History verification

| #   | Case                                                  | Asserts                                                                             |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D1  | Seeded policy, endorsement, payment                   | `valid: true`, `event_count: 3`, event types in order                               |
| D2  | Payload tampered by raw `UPDATE`                      | **the `UPDATE` itself raises** — append-only fires first                            |
| D3  | Tamper applied with the trigger dropped in-test       | `valid: false`, `event_hash_mismatch` at the right `seq`                            |
| D4  | Row deleted from the middle, trigger dropped          | `sequence_gap`                                                                      |
| D5  | Genesis insert with a non-null `previous_hash`        | rejected by the biconditional CHECK, not merely unverifiable                        |
| D6  | Second event claiming an existing `previous_hash`     | rejected by `UNIQUE (policy_id, previous_hash)` — a fork is structurally impossible |
| D7  | `seq` 1 with `event_type` other than `policy_created` | rejected by the second biconditional CHECK                                          |

D2 is worth its place precisely because it _fails to tamper_: the demonstration is that you have to disable a
control to break the chain. D3 then restores the tamper demo for the walkthrough by dropping the trigger inside
the test, which is honest and visible.

### Service-layer guards (DB-backed, same project)

`PolicyNotFound`, `PolicyNotActive` on endorsements, **absence** of `PolicyNotActive` on payments (a receipt
against a cancelled policy is recorded), `OutOfTerm` at both inclusive boundaries, `OutOfOrderEndorsement`, and
guard **order** — an out-of-term endorsement carrying an already-used key returns the duplicate, not the `422`.

---

## 4. Harness

Per [research 0003](../research/0003-pg-test-isolation-and-vitest-config.md), unchanged, with one binding
correction from [#9](https://github.com/angelguzmaning/policy-ledger-service/issues/9).

- **`globalSetup`** connects to the admin database, `DROP DATABASE IF EXISTS policy_ledger_test WITH (FORCE)`,
  `CREATE DATABASE`, then runs **the same migration runner production uses** — so every run exercises the
  migrations. The URL crosses into workers via `provide`/`inject`.
- **`setupFiles`** opens one `pg.Pool` per file and truncates in `beforeEach` — **before**, not after, so a failing
  test leaves its rows for post-mortem.
- **`fileParallelism: false`** on the integration project. The unit project stays fully parallel.

### The truncate list must exclude `ledger_accounts`

```sql
SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ')
       || ' RESTART IDENTITY CASCADE'
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename NOT IN ('schema_migrations', 'ledger_accounts');
```

The chart of accounts is migration `0005` — structure, not data. Naming it with `CASCADE` would wipe the FK target
and every financial write after it would fail. Derived from the catalog otherwise, so it cannot drift behind a new
migration.

### Fixtures

`test/fixtures.ts`: `seedPolicy(tx, overrides)` returning a `POL-1001`-shaped active policy, `seedEndorsement`,
`seedPayment`, and `countAllTables(db)`. Overrides exist so the cancelled-policy and leap-term cases are one line.

### Config additions

```ts
{
  name: 'integration',
  environment: 'node',
  include: ['src/**/*.integration.test.ts'],
  globalSetup: ['./test/global-setup.ts'],
  setupFiles: ['./test/db.ts'],
  fileParallelism: false,
  sequence: { concurrent: false },   // already the default; stated for the reader
  testTimeout: 20_000,
  hookTimeout: 30_000,
}
```

`resolve: { tsconfigPaths: true }` goes on **this project too** — a root config declaring `projects` does not
inherit it ([#4](https://github.com/angelguzmaning/policy-ledger-service/issues/4)).

Scripts to add: `"test:unit": "vitest run --project unit"`, `"test:integration": "vitest run --project integration"`.

---

## 5. Coverage — measured, not gated

**No thresholds.** `coverage.include` stays `['src/server/**']` and the README states the number the suite actually
achieves.

The reasoning is the point. A threshold is a number someone invented, and in a six-hour build the only thing a
failing threshold produces is a commit that lowers the threshold. `include: ['src/server/**']` is the stronger
claim and the one that survives a live defense: **coverage of the domain core is what counts, and the UI is
deliberately not in the denominator.** [#16](https://github.com/angelguzmaning/policy-ledger-service/issues/16)
already established there are no frontend tests and that widening `include` would _lower_ the number — so the
narrow denominator is honest, not flattering.

CI runs `pnpm test:coverage` every push, so the number is in the log whether or not anyone looks.

---

## 6. The workflow

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
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

    env:
      POSTGRES_ADMIN_URL: postgres://postgres:postgres@localhost:5432/postgres

    steps:
      - uses: actions/checkout@v5

      # Reads packageManager from package.json — the version lives in the repo, not here.
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - run: pnpm build

      # Blocking. Clean today, and a critical advisory should stop the line.
      - run: pnpm audit --audit-level=critical

      # Advisory. The four known next-pinned build-time advisories live here,
      # visibly, rather than being silently absent from the pipeline. See #4.
      - name: Audit (high, advisory)
        run: pnpm audit --audit-level=high
        continue-on-error: true
```

### One job, cheapest-first

A fan-out would pay `pnpm install` once per job — the dominant cost — so at this size it is _slower_ in wall-clock
and four times the minutes, and it forces either the Postgres service onto every job or a split between jobs that
need it and jobs that do not. One job is also one linear log a reviewer reads top to bottom.

The cost is fail-fast: a `format:check` failure hides the test result. At this size that is acceptable — the fix is
90 seconds — and it is why the order is cheapest-first.

### Toolchain pinned in the repo, not in the YAML

Three additions, so local and CI cannot drift:

- `"packageManager": "pnpm@11.8.0"` in `package.json` — read by `pnpm/action-setup`;
- `.nvmrc` containing `24` — read by `setup-node` via `node-version-file`;
- `@types/node` bumped `^20` → `^24`, because the repo currently type-checks against Node 20 typings while running
  on Node 24.

### `POSTGRES_ADMIN_URL`, and the absence of `DATABASE_URL`

The job sets only the **admin** URL, which is the variable `globalSetup` actually reads and is identical to the
docker-compose value — nothing in the code branches on CI. Tests never read it directly; they `inject('databaseUrl')`.

`DATABASE_URL` is deliberately **not** set. `next build` runs in this job and must complete without it, which is
the check that the lazily-initialised pool ([#2](https://github.com/angelguzmaning/policy-ledger-service/issues/2))
never connects at build time. If a future import connects eagerly, the build breaks here rather than in production.

### No CD

Nothing in the workflow deploys, publishes, pushes an image, or touches a cloud credential. The brief requires no
deployment. `next build` runs to prove the app compiles, and its output is discarded.

### The badge and the claim

One workflow-status badge at the top of the README.

What it truthfully supports: _every push runs format, lint, type-check, the full suite against a real Postgres,
and a production build, from a cold `pnpm install --frozen-lockfile` on a machine that has never seen this repo._

What it does **not** support, and the README should not imply: that coverage is enforced, that the suite covers the
HTTP layer, or that the seed reproduces the brief's expected output — that last is demonstrated live, by script.

---

## 7. Known limitations

| Limitation                                                                                                    | How you would notice                                                                  | What you would do                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **The policy lock's behaviour under contention is argued, not tested.** No test drives two concurrent writers | A regression would surface as duplicate rows under production load, not as a red test | Add the two-client `pg_locks` test; the shape is specified in §1 and the harness already supports two clients on one pool |
| **No coverage threshold** — coverage can regress silently                                                     | The number in the CI log drifts down; nothing fails                                   | Set a ratchet to the achieved figure once the build is green, rounded down                                                |
| **`pnpm audit --audit-level=high` is advisory** — a new high advisory will not fail CI                        | A yellow step in an otherwise green run                                               | Fix the four `next`-pinned advisories at the next major, then promote the gate to `high`                                  |
| **The seed's reproduction of the brief's Expected Output is not gated**                                       | Only by running the script; drift would ship unnoticed                                | The golden-file diff specified in §1 — declined here on timebox, not on merit                                             |
| **Route handlers are not executed by the suite**                                                              | A wiring mistake — wrong service called, response not awaited — passes CI             | They are held to three statements each so the untested surface stays trivially reviewable                                 |
| **`fileParallelism: false`** — integration runtime grows linearly with files                                  | CI wall-clock creeping up                                                             | The per-worker `CREATE DATABASE … TEMPLATE` escape hatch documented in research 0003                                      |
| **The tamper demo requires dropping the append-only trigger inside the test**                                 | Visible in the test body                                                              | Nothing — it is the correct shape; a chain you can tamper with without disabling a control is worse                       |
