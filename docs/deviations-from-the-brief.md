# Deviations from the brief

Where this implementation differs from a literal reading of the assessment brief, and why. One line per
deviation, each pointing at the decision document that argues it in full.

Distinct from [`known-limitations.md`](known-limitations.md), which answers a different question: what a
decision does _not_ protect. This file answers "where does this differ from what was asked, and was that
on purpose."

Everything below is deliberate. Nothing here changes a **required** behaviour: proration, integer-cent
money, idempotency (same key + same payload replays, different payload fails), wrong-currency atomic
rejection, balanced double-entry postings, and append-only hash-chained history all behave as specified.
`pnpm replay` reproduces the brief's Expected Output — the deviations below are visible in it as field
names and one count, not as different numbers.

## Response shape

Source: [`docs/spec/api-contract.md`](spec/api-contract.md#additions-and-the-four-deviations)

- **Billing document `type` is `premium_charge` / `premium_credit`, not the brief's `endorsement_adjustment`.**
  The brief's name cannot express a negative endorsement while `CHECK (amount_cents > 0)` holds — direction
  has to live somewhere, and carrying it in the type keeps every stored amount positive. The database column
  still uses the brief's `endorsement_adjustment`; the API maps it on the way out
  ([`shared.ts`](../src/server/service/shared.ts) `toApiDocumentType`).
- **`history.event_count` is 3 where the brief's sample shows 2** — see the hash-chain section below.
- **`ledger.balanced` appears on `GET /policies/:id` but not on `GET /policies/:id/ledger`.** The Required
  Output Fields ask for "balanced status"; a bare boolean was refused on the ledger endpoint itself. Split
  by role: the summary asserts, the ledger proves (it returns `sum_all_entries` and
  `unbalanced_transactions` as the evidence).
- **`billing_document.status` can be `issued`, a fourth value on a status the contract otherwise fixes at
  three.** A `premium_credit` is never payable, so reporting it `open` reads as "awaiting payment" — exactly
  backwards for money the insurer owes the insured. See
  [`docs/adr/0007-continuous-allocation-and-credit-exclusion.md`](adr/0007-continuous-allocation-and-credit-exclusion.md).

The policy view is otherwise a strict **superset** of the brief's example — every key name and nesting level
is preserved. Added fields (`homeowner_id`, `currency`, `term_start`/`term_end`, `effective_date`,
`delta_cents`, `history.events`) exist because the brief's own Frontend Requirement names them, or because
the proration result would otherwise be invisible without a second call.

## Hash chain

Source: [`docs/adr/0005-hash-chain-design.md`](adr/0005-hash-chain-design.md)

- **`policy_created` is included in the chain, against the brief's own sample** (which implies no genesis
  event, `event_count: 2`). Without it, `term_start`, `term_end`, and the original premium live only in the
  mutable `policies` row — the chain would protect every step of the proration arithmetic _except its
  starting point_, so editing `term_end` directly would leave every historical calculation wrong while
  `verify` still returned `valid: true`. Mitigated by returning the event-type list beside the count, so the
  difference explains itself on sight.
- **Rejected requests are logged to `inbound_requests`, not written to the chain.** The chain stays a record
  of what happened _to the policy_; a refused request did not affect it. The receipt is written on a separate
  connection outside the business transaction, so the rollback that protects the ledger cannot erase it.
  This is what lets `rejected_events` and per-item `idempotency_result` be reported literally, rather than
  requiring the interpretive bet that the brief's example output is "really" a replay report.

## Schema and model

Source: [`docs/adr/0004-derived-document-status-and-payment-waterfall.md`](adr/0004-derived-document-status-and-payment-waterfall.md),
[`docs/adr/0002-ledger-signed-amounts-and-db-enforced-balance.md`](adr/0002-ledger-signed-amounts-and-db-enforced-balance.md)

- **`billing_documents` has no `status` column** — the brief's example shows `"status": "paid"` on the
  document, and the API returns it, but it is computed at read time from that document's
  `payment_applications`. A stored column would have to be `UPDATE`d as payments settle, which collides
  head-on with the append-only rule bound across the financial tables.
- **`open_balance_cents` is ledger-derived**, never a stored column — it is the policy's
  `premium_receivable` account balance, so it cannot disagree with the ledger, because it _is_ the ledger.
- **Written premium is held net, not as a contra-revenue `return_premium` account.** A credit endorsement
  debits `written_premium` rather than crediting a separate returns account. Gross written-vs-returns
  reporting would find only the net figure; the brief's scope has no consumer for the distinction.

## Behaviour and interpretation

Source: [`docs/adr/0006-api-error-model-and-payment-identifiers.md`](adr/0006-api-error-model-and-payment-identifiers.md),
[`docs/adr/0003-business-id-as-idempotency-key.md`](adr/0003-business-id-as-idempotency-key.md)

- **Payments have no `PolicyNotActive` guard; endorsements do.** The brief states the payment already
  happened in another system, so the cash is a fact — refusing a genuine receipt against a lapsed policy
  would destroy that fact rather than protect anything. `PolicyNotActive` gates endorsements only, and sits
  _after_ the idempotency lookup, so a replay of an endorsement legitimately applied while the policy was
  active keeps replaying after cancellation.
- **A payment against a policy with no open documents is accepted, not rejected.** Cash is still posted, the
  remainder is reported as `unapplied_cents`, and `open_balance_cents` simply goes negative. Not an error
  and not a rejection — the brief names only wrong currency as a payment failure path.
- **Payments apply oldest-open-first** (`ORDER BY due_date, issued_at, billing_document_id`). The brief's
  payment events carry no billing-document reference, so some allocation rule is required; this one is a
  stated default responding to the data shape given, and is total so replay is reproducible.
- **A payment's unapplied remainder is not final at the moment it is recorded.** When a later endorsement
  raises a new charge, that charge's own transaction sweeps outstanding remainders onto it,
  oldest-received-first, so the document view stops disagreeing with the ledger once cash sufficient to
  cover the charge already exists. Only charges are swept — a `premium_credit` is excluded from allocation
  entirely. See [ADR-0007](adr/0007-continuous-allocation-and-credit-exclusion.md).
- **The idempotency key _is_ the business id** — no token table, no `Idempotency-Key` header. It arrives in
  the request body and is enforced by a plain `UNIQUE` constraint on the domain row. It matches the brief's
  data exactly (`END-2001`, `PAY-9001` are both), but note the visible consequence: a **UI-submitted
  endorsement is identified by the UUID the form mints**, which is why the operator timeline shows a UUID
  next to `END-2001`.
- **Idempotency-key uniqueness is global, not `(policy_id, key)`.** A retry misrouted to the wrong policy
  conflicts rather than silently creating a second endorsement under it.

## Additions beyond the brief

- **`external_payment_id` is a second `UNIQUE` identifier alongside the idempotency key**, with its own
  `409 ExternalPaymentIdConflict`. They coincide in the sample data but answer different questions, and the
  second constraint catches a case the first cannot: the same real-world payment redelivered under a fresh
  idempotency key would otherwise debit cash twice with nothing to notice.
  ([ADR-0006](adr/0006-api-error-model-and-payment-identifiers.md#two-identifiers-for-a-payment-both-unique))
- **Append-only and balance are enforced by database triggers, not only in application code** — `UPDATE`/
  `DELETE` on the financial tables raise, and an unbalanced transaction is refused by a deferred constraint
  trigger at commit. The brief asks for the guarantee; this puts it below the service layer.
  ([ADR-0002](adr/0002-ledger-signed-amounts-and-db-enforced-balance.md))
- **`inbound_requests` records every rejected delivery**, which is what makes `rejected_events` visible to
  the operator UI rather than discoverable only by grepping logs.
- **`explanation_clauses` accompanies `explanation`** — the identical text, split at the clause boundaries the
  contract already fixes, so the UI can render one paragraph per clause instead of re-splitting prose that
  contains decimal points. `explanation` itself is unchanged.
  ([api-contract §9](spec/api-contract.md))
