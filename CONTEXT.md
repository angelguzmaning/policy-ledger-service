# CONTEXT

Domain glossary for the Base Labs PAS take-home, per `docs/agents/domain.md`. Terms are defined as this
project uses them — where a term is contested, `docs/adr/` carries the reasoning; this file states the
vocabulary, not the argument.

## Policy

A homeowners insurance contract: `policy_id` (caller-supplied natural key, e.g. `POL-1001`),
`homeowner_id`, `status` (`active` / `cancelled` / `expired`), a term (`term_start` .. `term_end`,
inclusive), `annual_premium_cents`, `currency` (constrained to `USD`). `annual_premium_cents` is the
**current** premium and is the one mutable field on the row — each accepted endorsement rewrites it. The
policy row is not the source of truth for history; `policy_events` is.

## Endorsement

A mid-term change to a policy's annual premium, submitted as `POST /policies/:id/endorsements` with an
`effective_date` and a `new_annual_premium_cents`. Applying one:

1. Prorates the premium delta for the remaining term (see **Proration**).
2. Writes an `endorsements` row (`endorsement_id` is both the primary key and the idempotency key).
3. Writes a **billing document** if the delta is non-zero.
4. Posts a **ledger transaction** if the delta is non-zero.
5. Appends an `endorsement_applied` **policy event** to the hash chain, always — even at zero delta.

`effective_date` must fall within `[term_start, term_end]` (`422 OutOfTerm` otherwise) and must not
precede the latest applied endorsement's effective date (`422 OutOfOrderEndorsement` — no retroactive
re-rating).

## Proration

The pure function that turns an annual premium delta into the dollar amount owed for the remainder of the
term. Dates enter as integer **epoch-days**, never a JS `Date`; the arithmetic runs in `BigInt` so a large
premium cannot silently overflow `number`, and rounding is half-up-away-from-zero
(`(2n*magnitude + termDays) / (2n*termDays)`, sign split off first) — never `Math.round`, which produces
`-0` on an exact negative half. See ADR-0001 for why dates are epoch-days at all.

A **positive** delta produces an `endorsement_adjustment` billing document. A **negative** delta produces
a distinct **premium credit** document instead of a negative charge, with the ledger posting reversed
(DR Written Premium / CR Premium Receivable) — see ADR-0002. A **zero** delta writes the policy event and
nothing else: no document, no ledger transaction.

## Billing document

A charge or credit raised against a policy, identified by a server-minted natural key
(`BILL-` + a sequence starting at 3001, reproducing the brief's `BILL-3001` from a fresh seed).
`document_type` is `endorsement_adjustment` or `premium_credit`; `amount_cents` is always positive — sign
is carried by `document_type`, not by the number. **There is no stored `status` column.** A document's
status (`open` / `partially_paid` / `paid`) is derived from its `payment_applications` at read time, which
is what lets a billing document be genuinely append-only: nothing ever `UPDATE`s one.

## Premium credit

The billing document written when an endorsement's delta is negative (a reduction in coverage or premium
mid-term). Modeled as its own `document_type` rather than a negative amount so the schema-level
`CHECK (amount_cents > 0)` survives unconditionally, and posted by mirroring the same two ledger accounts
with the debit/credit sides swapped — one code path handles both signs. Written premium is therefore held
**net** rather than routed through a separate contra-revenue account (see ADR-0002's rejected alternative).
Balances may go negative; **no refund is issued** by this system (payment-provider integration is out of
scope).

## Ledger transaction / ledger entry

The double-entry record of money movement. A `ledger_transactions` row is a **header** — `policy_id`,
`source_type` (`endorsement` | `payment`), `source_id` — with one or more `ledger_entries` legs. Direction
is the **sign** of `amount_cents` (debits positive, credits negative); the invariant is
`SUM(amount_cents) = 0` per transaction, enforced by the database at `COMMIT` via a
`DEFERRABLE INITIALLY DEFERRED` constraint trigger, never by application code alone. See ADR-0002.
`open_balance_cents` for a policy is **ledger-derived** — the `premium_receivable` account's running
balance — never a stored column, so billing documents cannot drift from the ledger that backs them.

## Payment application

A row in `payment_applications` recording that some or all of a `payments` row was applied to settle a
specific `billing_documents` row. Payments carry no document reference of their own, so application follows
a deterministic **oldest-open-first waterfall** (`ORDER BY due_date, issued_at, billing_document_id`) —
see ADR-0004. A payment can partially settle one document and spill into the next; any amount left over
after every open document is settled is `unapplied_cents` and is not an error (it simply leaves
`open_balance_cents` negative).

## Policy event

An immutable, append-only row in `policy_events` recording one accepted command against a policy:
`policy_created` (seq 1, always), `endorsement_applied`, or `payment_recorded`. Granularity is the
**accepted command**, not each side-effect row — one endorsement is one event, carrying the endorsement id,
billing document id, and ledger transaction id in its `payload`. The chain records *decisions*; the ledger
records their *arithmetic*. See **Hash chain**.

## Hash chain

The tamper-evidence mechanism over `policy_events`. Each row's `event_hash` is the SHA-256 of a
**canonical** serialization of every column on the row except `event_hash` itself, including
`previous_hash` (the prior row's `event_hash`, or `NULL` at genesis). One chain per policy — verification
of `POL-1001` never reads another policy's rows. `seq` is **computed** under the same per-policy lock that
guards idempotency, never a database sequence, because a sequence is not transactional and a gap it leaves
behind is indistinguishable from a deleted row. `GET /policies/:id/history/verify` rehashes every row
through the same code path that wrote it and reports `valid: true`, or `valid: false` with the first break
localized (`seq`, one of four reasons, expected vs. stored hash). See ADR-0005.

## Idempotency key

The mechanism that makes a retried `POST` safe. **The business id is the idempotency key** — `END-2001`,
`PAY-9001` — arriving in the request body, never a separate `Idempotency-Key` header, and never
server-generated. It is the row's own primary key, so uniqueness is enforced by the database `UNIQUE`
constraint the primary key already gives you. Whether a redelivery is the *same* request or a *conflicting*
one is decided by comparing a stored `request_fingerprint` (SHA-256 of the canonicalized, validated
request) against a freshly computed one: match → `200 duplicate ignored`; mismatch → `409
IdempotencyKeyConflict`. A rejected request (any `4xx`) rolls back and **never consumes its key** — the
same id can be resubmitted with corrected data. See ADR-0003.

## Inbound request (receipt log)

A record in `inbound_requests` of every endorsement/payment `POST` that reached the service, written on a
**separate database connection outside the business transaction**, so a rolled-back write still leaves a
receipt. Carries `outcome` (`accepted` / `rejected`), the HTTP status, the error code if any, and the
request body verbatim. This is what lets a wrong-currency 3am payment be *discoverable* rather than
silently vanish, and what lets `GET /policies/:id` report `rejected_events` and per-item
`idempotency_result` without treating a refusal as part of the policy's own history. It carries no foreign
key to `policies`, deliberately — a request naming a policy that doesn't exist is exactly the kind that
must still be logged.
