# 0004: Derived document status over stored; oldest-open-first payment waterfall

## Status

Accepted. Source: [#6](https://github.com/angelguzmaning/policy-ledger-service/issues/6) (ledger model)
and [#7](https://github.com/angelguzmaning/policy-ledger-service/issues/7) (idempotency contract, for the
append-only consequence).

## Context

A billing document has a lifecycle — open, partially paid, paid — but the append-only rule (ADR-0005's
shared trigger, bound across `policy_events`, `ledger_transactions`, `ledger_entries`, and
`payment_applications`) means nothing on those tables is ever `UPDATE`d. The brief's payment events carry
only a policy id and an amount — no reference to which billing document they settle — so an incoming
payment must be routed to open documents by some rule, and that rule has to be deterministic for replay to
be reproducible.

## Decision

### Document status is derived, never stored

`billing_documents` has **no `status` column**. Status (`open` / `partially_paid` / `paid`) is computed at
read time from the sum of that document's `payment_applications` against its `amount_cents`. This is what
lets a billing document be genuinely append-only — there is no column a payment would otherwise need to
`UPDATE`, so the append-only rule never fights the billing model.

### Payments apply oldest-open-first

Because payments carry no document reference, application is a **waterfall**:
`ORDER BY due_date, issued_at, billing_document_id` over that policy's open documents, applying the payment
amount against each in order until the amount is exhausted or documents run out. Each application writes an
explicit `payment_applications` row (never a mutation of an existing one). The order is deterministic —
including the `billing_document_id` tiebreaker for documents sharing a `due_date` and `issued_at` — which
matters beyond tidiness: **replay reproducibility depends on the order being total.** A payment that
exceeds the sum of open documents leaves the remainder as `unapplied_cents`; a payment against a policy
with no open documents applies nothing and the payment's `status` is `unapplied` — not an error, and not
a rejection. Cash is still posted; `open_balance_cents` simply goes negative.

`open_balance_cents` itself is **ledger-derived** — the policy's `premium_receivable` account balance —
never a column on `billing_documents` or `policies`. Billing documents reconcile _to_ the ledger; a stored
balance column was rejected as denormalization that could drift from the entries that are supposed to back
it.

### Allocation order vs. display order

Allocation order is **arrival order** — the order payments were recorded, which is also the order they were
applied against whatever documents happened to be open at that instant (see above). It stays that way
regardless of when the money actually arrived: a back-dated payment settles whatever is open when it lands,
it does not reach back and re-cut allocations that already happened. Reversing a prior application isn't
available under the append-only rule — it would need a schema change relaxing the positive-amount check, an
exemption from the shared trigger, and a new reversal concept distinguishable from an application. Rejecting
back-dated payments outright was also considered and refused: the payment already happened in another
system, so declining a genuine receipt destroys a fact rather than protecting one.

**Display order is receipt order** — `received_at` (earliest first), tiebroken on `payment_id` for a total,
stable order. `GET /policies/:policyId`'s `payments[]` is sorted this way (`docs/spec/api-contract.md` §6),
and the operator timeline (`docs/spec/frontend-ui.md` §2) renders it in that order with the date visible on
each row, so an operator reading the timeline sees payments in the order the money arrived even though the
system settled them in the order they were keyed in. This is the first place `received_at` is load-bearing;
until this ADR it was validated on the way in, stored, and echoed on the write response, and used for
nothing else.

## Rejected alternatives

- **A stored `status` column on `billing_documents`, updated as payments arrive.** Rejected because it
  requires `UPDATE`ing an otherwise-immutable row every time a payment settles it, which collides directly
  with the append-only rule bound across the financial tables — either billing documents get an exception
  to that rule (weakening the guarantee everywhere else) or the column becomes a second source of truth
  that a bug could desynchronize from the payment applications underneath it.
- **A stored `open_balance_cents` column on `policies` or `billing_documents`.** Rejected on the same
  drift concern: a number that must be kept in sync by every write path is a number that will eventually
  be wrong on one of them. Deriving it from `SUM(ledger_entries.amount_cents)` for the `premium_receivable`
  account means it is definitionally correct — it cannot disagree with the ledger, because it _is_ the
  ledger.
- **Payments that name their own target billing document** (remittance-advice-style, carrying a
  `billing_document_id`), and a configurable allocation policy (proportional, newest-first,
  insured-directed). Ruled out of scope entirely: the brief's payment events carry only a policy id and an
  amount, so the waterfall is a stated default responding to the data shape given, not a hidden
  simplification of a richer requirement. `payment_applications` already has the shape (one row per
  application, `payment_id` + `billing_document_id` + `amount_cents`) to support the richer case without a
  schema change if the effort is ever extended.

## Known limitations

**Oldest-open-first allocation is a stated default, not a configurable policy.** A real insurer might want
proportional allocation across open documents, or let an upstream direct a payment at a specific document.
_How you would notice:_ a payment that "should" have settled a specific document (per an accompanying
remittance advice not modeled here) instead pays down whatever is oldest. _What you would do:_ extend the
payment request shape to optionally carry a target `billing_document_id`, and fall back to the waterfall
only when it's absent — `payment_applications`' shape does not need to change.

**Document status and open balance are computed on every read, not cached.** At take-home scale (a handful
of documents per policy) this is free. _How you would notice:_ p99 latency on `GET /policies/:id` climbing
as a policy accumulates years of billing history. _What you would do:_ this is the same limitation named in
`docs/spec/api-contract.md`'s pagination row — a materialized or incrementally-maintained balance would be
the fix, paired with pagination on the underlying lists.
