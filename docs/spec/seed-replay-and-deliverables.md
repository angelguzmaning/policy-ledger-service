# Seed/replay path, README, on-call note, and video outline

Resolves [#13](https://github.com/angelguzmaning/policy-ledger-service/issues/13) on the
[build-ready spec map](https://github.com/angelguzmaning/policy-ledger-service/issues/1).

## Seeding

`pnpm db:seed` inserts **only the policy** (`POL-1001`, from the brief's `policy.json`) as a
straight `INSERT`, no HTTP round trip — there is no `POST /policies` in scope, and #9 already
places this data in `scripts/seed.ts`, outside `migrations/`.

The brief's `events.json` (the duplicate `END-2001` endorsement, the duplicate `PAY-9001`
payment, and the `PAY-9002` EUR payment) is **not** touched by seeding at all. Those four
records exist purely as fixture input for the replay script below — they are shaped exactly
like the two endpoints' request bodies, so the honest demonstration is submitting them through
the real API, not writing them straight into the tables.

## Replay path

`scripts/replay.ts` — a plain Node/`tsx` script, no test framework, no Next boot (consistent
with [#11](https://github.com/angelguzmaning/policy-ledger-service/issues/11)'s "no test boots
Next" rule, which this script isn't a test but still honors):

1. Assumes `pnpm dev` (or the built app) is already running against the seeded DB.
2. `POST`s the four `events.json` entries in order through the real HTTP endpoints
   (`/endorsements`, then `/payments` × 3).
3. `GET`s `/api/policies/POL-1001` and `/api/policies/POL-1001/history/verify`.
4. Prints a summary shaped like the brief's Expected Output, including `rejected_events`.

**Not asserted in CI** — this mirrors #11's declined golden-file diff ("replay stays a script
for #13, which supersedes case 19 of #10's test table"); reopening that as a CI-gated assertion
would relitigate a timebox call already made. It **is** a manual/video artifact:
`pnpm db:seed && pnpm dev`, then `pnpm replay` in a second shell.

**Minimal self-check, not a golden-file diff:** the script exits non-zero if the printed
`ledger.balanced` is `false` or `history.valid` is `false` — the two properties that actually
matter, checked structurally rather than by comparing the whole payload byte-for-byte against
the brief's example.

## README structure

Order, each diagram lifted from the spec doc that owns it (per the map's locked convention —
inline where decided, key ones lifted into `README.md`):

1. **What this is** — scenario + scope boundary, links to Out of Scope.
2. **How to run it** — `docker-compose up`, migrate, seed, dev, replay: exact copy-pasteable
   commands.
3. **API design** — the six endpoints, error-model summary, link to
   [`docs/spec/api-contract.md`](api-contract.md); lift the guard-order diagram from #10.
4. **SQL schema** — ERD lifted from [`docs/spec/schema-and-transactions.md`](schema-and-transactions.md),
   the ID-strategy rule stated in one paragraph.
5. **Business rules** — proration/rounding (#5), ledger posting rules with the T-account
   diagram (#6), idempotency contract gist (#7).
6. **Policy history / hash chain** — the hash-chain visual from #8, one paragraph on what
   `verify` returns.
7. **Frontend** — what it shows, screenshot or GIF, link to
   [`docs/spec/frontend-ui.md`](frontend-ui.md).
8. **Tests & CI** — what's covered, the coverage caveat from #11 (measured, never gated), link
   to [`docs/spec/test-plan-and-ci.md`](test-plan-and-ci.md).
9. **On-call: monitor & recover** — inline section (below), not a separate doc.
10. **Where AI was used** — the AI-usage note (below).
11. **What I'd improve with more time** (below).
12. **Known limitations** — link to `docs/known-limitations.md` rather than restating it.

## AI-usage note (README content)

Generic framing — no specific tool or workflow named:

> I used an AI coding assistant to explore the design space (schema shape, idempotency
> contract, hash-chain canonicalization, ledger balance enforcement) and to generate the first
> draft of each layer — migrations, service layer, tests, UI — from the agreed design.
>
> What I verified manually: every migration, run and inspected; every test, read and run green
> locally; the hash-chain canonicalization, hand-checked against `sha256sum` on a real row; the
> replay script, run end-to-end against the seeded database with its output compared to the
> brief's example by eye; the rounding rule's edge cases (negative-exact-half, leap-year term),
> traced by hand.

Stated as a deliberate workflow, not an apology — the brief explicitly allows and expects AI use.

## On-call note (README content)

**Watch / alert on:**

1. `unbalanced_transactions` non-empty (the probe `GET /ledger` exposes, #6) — structurally
   impossible given the deferred DB trigger, so any hit means the trigger was bypassed or
   disabled. **Page immediately.**
2. Any `history/verify` returning `valid: false` — #8 localizes the first break (`seq`, reason,
   expected vs. stored). **Page**, with the returned break point attached.
3. `inbound_requests` rejection rate (payment/endorsement 4xx spike) — most rejections are
   expected (e.g. EUR mismatch), so this is a **rate/trend alert**, not page-on-first-occurrence:
   a sudden spike suggests an upstream integration bug.
4. Any `500` from the API — per #9's error-translation rule, a 500 here specifically means an
   application bug (a `23514`/balance-trigger failure at commit), never expected in normal
   operation. **Page.**
5. `IdempotencyKeyConflict` (409) rate — a spike suggests a caller reusing keys across
   different payloads; worth investigating, not paging on.

**Recovery, given append-only / no in-place edits:**

- A bad ledger/policy-event write can't be edited — recovery is **appending a correcting
  event/transaction** (e.g. a reversing ledger transaction with an explicit note in its
  payload), never `UPDATE`/`DELETE` (blocked by the append-only trigger regardless).
- A broken hash chain (tamper or corruption) is **not auto-repairable**: identify the break
  point via `verify`, treat rows from that point on as untrusted, restore the affected range
  from backup/WAL if it's corruption, or escalate as a security incident if it's tampering.
  Either way, the incident's resolution becomes a new recorded event once resolved, never a
  silent fix.
- No automatic rollback/retry logic exists (#9: no retry loop), so recovery is always a
  **human-initiated, explicit follow-up action** — consistent with the append-only philosophy
  rather than a workaround for it.

## What I'd improve with more time (README content)

1. **Two-client contention test** (#11) — the lock's shape is proven deterministically
   elsewhere; a real concurrent-request test would close the gap entirely.
2. **Frontend test coverage** (#16) — zero today; `coverage.include` is scoped to
   `src/server/**` deliberately, stated honestly rather than padded.
3. **Richer payment allocation** (#6) — oldest-open-first waterfall is the stated default;
   remittance-advice-style payments targeting a specific billing document, or a configurable
   allocation policy, is real-world work the brief's payload shape doesn't ask for.
4. **CI fan-out / faster pipeline** (#11) — a single cheapest-first job is right-sized for a
   6-hour build; a longer-lived project would split lint/test/build once the suite grows.
5. **`pnpm audit` high-severity noise** (#4) — currently all `next`'s own pinned build-time
   deps, non-blocking by necessity; a longer-lived project would track and bump `next` on a
   cadence to keep that list actually zero.

## Video beat sheet

~8 minutes, within the brief's 5–10 minute window. Chosen failure-path demo: **tamper +
verify**, not the EUR rejection — this resolves the map's "Failure-path demo choice" fog item.
The tamper demo is the more differentiating, hardest-earned piece of this build (#8) and hits
the brief's "traceable and safe" evaluation line directly; the EUR rejection is still shown
on-screen (in the replay script's `rejected_events` output) but isn't the dedicated beat.

| Time      | Beat                                           | On-screen                                                                                                      |
| --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | What I built, how to run it                    | `docker-compose up`, `pnpm migrate && pnpm db:seed && pnpm dev`                                                |
| 0:30–1:30 | SQL schema, invariants, transaction boundaries | ERD (#9), `withTransaction`, append-only + balance triggers                                                    |
| 1:30–2:30 | Proration & rounding rule                      | `business-rules.txt` vs. code, epoch-days, `premium_credit` case                                               |
| 2:30–3:30 | Duplicate endorsements & payments              | idempotency sequence diagram (#7), replay script showing `duplicate ignored` + the EUR `rejected_events` entry |
| 3:30–4:30 | Double-entry ledger balance                    | T-account diagram (#6), `GET /ledger`, `unbalanced_transactions` always-empty probe                            |
| 4:30–5:30 | Frontend consuming the API                     | split-console UI, apply endorsement + invalidate/refetch                                                       |
| 5:30–7:00 | **Failure-path demo: tamper + verify**         | `psql` `UPDATE` on a historical event, `GET /history/verify` catching it, break-point localization             |
| 7:00–7:45 | AI usage + what I'd improve                    | —                                                                                                              |
| 7:45–8:00 | Close                                          | —                                                                                                              |

## Known limitations

- **Replay output is eyeballed against the brief's example, not diffed** — #11 declined a
  golden-file CI assertion on timebox; the script's only automated check is
  `ledger.balanced`/`history.valid`, not full-payload equivalence.
- **On-call alerting is a design, not a wired integration** — no actual paging/alerting system
  is configured; the note states what a real on-call setup would watch, not a running one.
- **The failure-path video demo requires manually dropping the append-only trigger** — a step a
  reviewer must trust was staged correctly rather than something the test suite re-verifies
  live.
