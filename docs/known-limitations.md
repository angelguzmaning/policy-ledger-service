# Known limitations

One line per limitation, pointing at the decision document that states it in full — what the decision does _not_
protect, how you would notice, and what you would do if it mattered later.

Named for the negative case deliberately. The neutral "Consequences" heading is the one people fill with restated
benefits.

## Proration and money arithmetic

Source: [`docs/adr/0001-epoch-day-dates-and-hash-the-bytes-you-stored.md`](adr/0001-epoch-day-dates-and-hash-the-bytes-you-stored.md#known-limitations) ([#5](https://github.com/angelguzmaning/policy-ledger-service/issues/5))

- **A future migration that re-derives `recorded_at` from a parsed `timestamptz` instead of carrying the original string forward silently invalidates every hash from that point on.**

## Ledger model and chart of accounts

Source: [`docs/adr/0002-ledger-signed-amounts-and-db-enforced-balance.md`](adr/0002-ledger-signed-amounts-and-db-enforced-balance.md#known-limitations) ([#6](https://github.com/angelguzmaning/policy-ledger-service/issues/6))

- **Written premium is held net rather than as contra-revenue `return_premium`** — a gross written-vs-returns reporting requirement would find only the net figure.
- **The deferred balance trigger is droppable by the table owner**, and migrations run as owner — same risk shape as the append-only trigger below.

## Idempotency contract

Source: [`docs/adr/0003-business-id-as-idempotency-key.md`](adr/0003-business-id-as-idempotency-key.md#known-limitations) ([#7](https://github.com/angelguzmaning/policy-ledger-service/issues/7))

- **Idempotency-key uniqueness is global, not scoped per policy** — two unrelated systems minting the same business id collide as a `409` rather than being accepted as coincidence.
- **The opaque key format accepts any caller-chosen scheme**, including one designed to collide with a future id; no auth-scoping exists to prevent it.

## Billing document status and payment allocation

Source: [`docs/adr/0004-derived-document-status-and-payment-waterfall.md`](adr/0004-derived-document-status-and-payment-waterfall.md#known-limitations) ([#6](https://github.com/angelguzmaning/policy-ledger-service/issues/6), [#7](https://github.com/angelguzmaning/policy-ledger-service/issues/7))

- **Oldest-open-first payment allocation is a stated default, not a configurable policy** — remittance-advice-style targeted payments are out of scope.
- **Document status and open balance are computed on every read, not cached** — fine at take-home scale; would need materialization at policy-history scale.

## Policy event hash chain and history verification

Source: [`docs/adr/0005-hash-chain-design.md`](adr/0005-hash-chain-design.md#known-limitations) ([#8](https://github.com/angelguzmaning/policy-ledger-service/issues/8))

- **Per-policy chains cannot detect wholesale deletion of a policy's events, nor tail truncation** — what remains verifies clean.
- **Append-only triggers are droppable by the table owner, and migrations run as owner** — a well-meaning backfill can rewrite history.
- **No `TRUNCATE` guard** — the trigger is row-level and `TRUNCATE` bypasses it; the test harness depends on `TRUNCATE`.
- **The chain protects recorded events, not the mutable `policies` row** — `policy_created` replay is the mitigation, not a guarantee.
- **`hash_version` exists so the scheme can rotate** — a migration that rewrites historical hashes instead of versioning them silently destroys the evidence.
- **Full-chain verification runs on every request** — a long-lived policy would need checkpointing.

## API contract and error model

Source: [`docs/spec/api-contract.md`](spec/api-contract.md#known-limitations), [`docs/adr/0006-api-error-model-and-payment-identifiers.md`](adr/0006-api-error-model-and-payment-identifiers.md#known-limitations) ([#10](https://github.com/angelguzmaning/policy-ledger-service/issues/10))

- **Rejections are reported but never actioned** — `suggested_action` reads policy state only; upstream health belongs on the `inbound_requests` rollup, not on a per-policy field.
- **No pagination on `GET /policies/:id` or `/ledger`** — both return the policy's full history; unbounded as a policy ages.
- **`ledger.balanced` is a computed claim, not a proof** — it exists because the Required Output Fields names it; `/ledger` remains the evidence.
- **Explanation templates are English-only** — fixed-order clause concatenation does not survive translation.
- **No rate limiting or payload size cap** — an oversized body reaches Zod before rejection.
- **The 400/422 split is a two-way rule; a future endpoint may need a third bucket** the rule doesn't currently name.
- **`external_payment_id` uniqueness is global, not scoped per policy** — same risk shape as the idempotency-key scope limitation above.

## Schema and transaction boundaries

Source: [`docs/spec/schema-and-transactions.md`](spec/schema-and-transactions.md#known-limitations) ([#9](https://github.com/angelguzmaning/policy-ledger-service/issues/9))

- **`BILL-` numbers have gaps** — `nextval` is non-transactional; nothing reads billing numbers in order.
- **Single-currency by constraint** — `CHECK (currency IN ('USD'))` on four tables; a multi-currency requirement needs a migration.
- **`READ COMMITTED` protects only because every writer takes the policy lock first** — a new mutation not going through `withTransaction` would race silently.
- **Whole-table `COUNT(*)` in the atomicity-proof fixture scans every table** — fine at test scale, never production code.
- **`inbound_requests` grows without bound and has no retention policy.**
- **A rejected request's body is stored verbatim in `inbound_requests`** — no PII beyond ids in the brief's payloads today, but a production version would need to redact.

## Test plan and CI

Source: [`docs/spec/test-plan-and-ci.md`](spec/test-plan-and-ci.md#7-known-limitations) ([#11](https://github.com/angelguzmaning/policy-ledger-service/issues/11))

- **The policy lock's behaviour under contention is argued, not tested** — no test drives two concurrent writers; a regression surfaces as duplicate rows under load, not as a red test.
- **No coverage threshold** — coverage is measured every run and gated by nothing, so it can regress silently.
- **`pnpm audit --audit-level=high` is advisory** — the four known `next`-pinned build-time advisories keep the gate at `critical`.
- **The seed's reproduction of the brief's Expected Output is not gated** — it is demonstrated by script, not asserted in CI.
- **Route handlers are not executed by the suite** — no test boots Next; they are held to three statements each so the untested surface stays reviewable.
- **`fileParallelism: false`** — integration runtime grows linearly with test files.
- **The tamper demo requires dropping the append-only trigger inside the test** — you have to disable a control to break the chain, which is the point.

## Frontend UI

Source: [`docs/spec/frontend-ui.md`](spec/frontend-ui.md#known-limitations) ([#12](https://github.com/angelguzmaning/policy-ledger-service/issues/12))

- **The prototype's proration math is a simplified stand-in**, not the real `BigInt` rounding rule — the shipped route handler calls the actual `src/server` function; a prototype discrepancy is only ever a display bug in code that never merges.
- **No frontend tests** — `vitest.config.mts` doesn't collect `.tsx` today and `coverage.include` is `src/server/**` only; a stated position, not a silent gap.
- **The "corrupt history" demo affordance is deliberately not built for real** — no legitimate API call produces a broken chain; a tampered-chain demo requires editing the seeded database directly before recording.

## Seed/replay path and deliverables

Source: [`docs/spec/seed-replay-and-deliverables.md`](spec/seed-replay-and-deliverables.md#known-limitations) ([#13](https://github.com/angelguzmaning/policy-ledger-service/issues/13))

- **Replay output is eyeballed against the brief's example, not diffed** — the script's only automated check is `ledger.balanced`/`history.valid`, not full-payload equivalence.
- **On-call alerting is a design, not a wired integration** — no actual paging/alerting system is configured.
- **The failure-path video demo requires manually dropping the append-only trigger** — a step a reviewer must trust was staged correctly rather than something the test suite re-verifies live.
