# 0001: Epoch-day dates, `setTypeParser(1082)`, and "hash the bytes you stored"

## Status

Accepted. Source: [#5](https://github.com/angelguzmaning/policy-ledger-service/issues/5) (proration and
money arithmetic), generalized by [#8](https://github.com/angelguzmaning/policy-ledger-service/issues/8)
(hash chain).

## Context

The domain core (proration, hashing, canonicalization) must be deterministic: the same inputs must produce
the same outputs on every run, on every machine, forever — replay depends on it, and the hash chain's
`event_hash` depends on it even more strongly. Two independent problems threatened that:

1. **Dates.** `pg`'s default type parser turns a Postgres `DATE` (OID 1082) into a JS `Date` object at
   **local midnight**. A domain core that touches `Date` inherits the machine's timezone, `Date.now()`,
   and DST — none of which belong in a proration calculation that must be reproducible from a seed file
   years later on a different machine.
2. **Timestamps that feed the hash chain.** `recorded_at` on a `policy_events` row is part of the
   `event_hash` preimage. If the stored value can be *re-rendered* differently depending on session state,
   the hash becomes unstable even though nothing about the event changed.

## Decision

**Dates are Postgres `DATE`, parsed by a strict regex into integer epoch-days, and nothing else ever
touches a JS `Date` inside the domain core.** `pg.types.setTypeParser(1082, (v) => v)` is set globally and
is **load-bearing** — without it, `pg` silently reverts to local-midnight `Date` objects and the whole
design is undone invisibly. No wall clock and no `Date` object enters `src/server`'s pure functions;
backdated endorsements are legal specifically because nothing reads `Date.now()`, and every test is
deterministic because there is no clock to freeze.

Proration itself runs the arithmetic in `BigInt` (`(2n*magnitude + termDays) / (2n*termDays)`, sign split
off first) with `number` only at the two edges (input premium, output cents) — overflow is answered
unconditionally rather than hoped away, and `Math.round` never appears (`Math.round(-0.5)` is `-0`, which
would produce a wrong sign on an exact-half negative delta).

`#8` generalized the same lesson to hash-covered timestamps: **`recorded_at` on `policy_events` is `TEXT`
in strict ISO-8601 UTC milliseconds, checked by regex, never `timestamptz`.** The general rule, stated once
so it applies to every future hash-covered column:

> **Hash the bytes you stored, never a re-rendering of a parsed value.**

`timestamptz` fails this in three independent ways: `pg` parses OID 1184 into a JS `Date` (millisecond
precision against Postgres's microseconds — lossy immediately); neutralizing that with
`setTypeParser(1184, ...)` returns Postgres's **rendering**, which depends on the session `TimeZone` GUC —
same instant, different bytes under `UTC` vs. `America/New_York`; and Postgres renders trailing sub-second
zeros variably. Any one of the three is a config change away from invalidating every hash in the table.
`recorded_at` is generated at the service edge from an **injected clock**, keeping the domain core pure and
making replay byte-reproducible.

The rule's scope is explicit: it applies only to columns inside a hash preimage. `ledger_transactions
.posted_at` is untouched `timestamptz` — not hashed, no byte-identity requirement, keeps normal typing and
indexing.

## Rejected alternatives

- **Let `pg` parse `DATE` into a JS `Date` and normalize with `.toISOString()` at the boundary.**
  Rejected because normalization happens *after* the local-midnight conversion has already run — a date
  near a DST boundary or a UTC offset can shift by a day before the normalization code ever sees it. The
  bug is upstream of anywhere a fix could be applied.
- **Store `recorded_at` as `timestamptz` and pin the session `TimeZone` to `UTC` everywhere (app, tests,
  CI, migrations).** Rejected because it is a distributed invariant across every process that ever opens a
  connection to this database, rather than a fact checkable by reading one column definition — one
  forgotten `SET TIME ZONE` and every hash computed under it is silently wrong, discovered only when
  `verify` disagrees with a byte-identical row computed elsewhere.
- **Round with `Math.round`.** Rejected outright: `Math.round(-0.5) === -0`, which flips the sign of an
  exact-half negative proration result.

## Known limitations

**What this does not protect:** if a future migration or admin tool re-derives `recorded_at` from a parsed
`timestamptz` column instead of carrying the original string forward, every hash computed from that point
is silently wrong even though the rule that would have caught it is documented, not enforced by any test
outside this table's own rows.

**How you would notice:** `GET /policies/:id/history/verify` starts returning `valid: false` for policies
untouched by any legitimate operation, with breaks clustered around the migration's run time rather than
around any real tampering event.

**What you would do:** treat it as a data-integrity incident per the on-call note (README) — identify the
break point, confirm via `git blame`/deploy history that a migration ran in the window, and restore
`recorded_at` from a pre-migration backup rather than attempting to "fix" the hash forward. The
`hash_version` column (ADR-0005) exists precisely so a genuine scheme change can be versioned instead of
silently rewriting history.
