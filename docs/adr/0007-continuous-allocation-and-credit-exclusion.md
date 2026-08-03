# 0007: Continuous allocation via remainder sweep; premium credits leave the waterfall

## Status

Accepted. Source: [#19](https://github.com/angelguzmaning/policy-ledger-service/issues/19). Extends
[ADR-0004](0004-derived-document-status-and-payment-waterfall.md), which is unchanged in every other respect —
that ADR's waterfall still governs how a payment allocates against whatever is open _at the instant it is
recorded_. This ADR answers what happens to the part of a payment that finds nothing open to settle.

## Context

ADR-0004's waterfall runs once, inside the payment write, against whatever documents happen to be open at
that instant. Nothing ever revisits it afterward. Two consequences followed from that, both symptoms of the
same gap:

1. A payment that overshoots every open document stays `partially_applied` forever, and its remainder —
   `unapplied_cents` — is stranded. When a later endorsement raises a new charge, that new charge starts
   `open` even though cash sufficient to cover it is already sitting on the policy. The document view (open)
   and the ledger (which never depended on allocation and already shows the credit) then disagree in the same
   response body.
2. The waterfall's original query carried no `document_type` filter, so a payment could settle a
   `premium_credit` — money the insurer owes the insured — as if it were a charge. A credit note would then
   report itself being paid down while `open_balance_cents` moved the opposite direction.

Both are the same defect wearing two faces: nothing distinguished "payable" from "not payable," and nothing
ever looked again at cash that had nowhere to go the first time.

## Decision

### Payment applications stay append-only; a sweep is additional rows, not a revisit

A payment application remains a record of **live allocation state**. Nothing already applied is ever
`UPDATE`d or reversed — the shared append-only trigger across the financial tables needs no exemption. What
changes is that a _new_ application can be written later, against a _different_ billing document, by an
event other than the payment's own write. The set of applications for a payment simply grows over time as
charges arrive for it to settle.

### Remainders sweep inside the endorsement's own transaction

When an endorsement raises a new charge (`document_type = 'endorsement_adjustment'`), the same transaction
that writes the billing document also sweeps any payments still holding an unapplied remainder onto it,
under the policy lock the endorsement already holds — no separate job, no eventual consistency window. The
endorsement's HTTP response therefore reports the **post-sweep** status of the document it just raised, not
the pre-sweep one; a charge fully covered by an existing remainder comes back `paid` in the same response
that created it.

### Remainders draw down in receipt order

When several payments hold remainders, they draw down **`received_at`, tiebroken on `payment_id`** — the
same total order ADR-0004 introduced for _display_, now load-bearing for _allocation_ too, for a second
reason: sweep order must be reproducible under replay exactly like the original waterfall. Draining
oldest-received-first (rather than, say, largest-first or oldest-recorded-first) is the natural reading of
"first in, first applied" for money that already arrived — recording order was never a fact about the money,
only about when someone happened to key it in.

### Only charges are payable; premium credits report a distinct status

`loadOpenChargeDocuments` and `loadUnappliedPaymentRemainders` (`src/server/service/shared.ts`) both filter
to `document_type = 'endorsement_adjustment'`. A `premium_credit` is excluded from both the original
waterfall and the sweep — cash never settles it, by construction, not by convention. Reporting it as `open`
would read to an operator as "awaiting payment," which is backwards: nothing will ever apply to it, and the
insurer owes the insured, not the reverse. It reports **`issued`** instead — a fourth value on the billing
document status the API contract otherwise fixes at three (`open` / `partially_paid` / `paid`;
`docs/spec/api-contract.md` §6). `deriveDocumentStatus` (`shared.ts`) now takes the document's type as its
first argument and returns `issued` unconditionally for a credit, before ever looking at amounts. Credits are
also excluded from `openDocumentCount` (`loadPolicy.ts`), which drives the explanation's "N open billing
document(s)" clause and the suggested action — a credit must not inflate a count that exists to tell an
operator how much is still awaited.

### A sweep posts no ledger transaction

Cash is debited and premium receivable credited in full at the moment the payment is recorded
(`postPayment`), regardless of how much of it later gets swept onto which document. A sweep only writes
`payment_applications` rows; it moves no money and posts nothing to `ledger_entries` or
`ledger_transactions`. This is why the open balance in the reported bug was already correct while the
documents were wrong — the ledger side of this system was never broken, only the document side that reads
off it.

### The hash chain is unaffected

Event granularity is the accepted command, not each side-effect row (ADR-0004, ADR-0005): one endorsement is
one `endorsement_applied` event whether or not it happens to trigger a sweep, exactly as it is one event
whether or not it happens to produce a billing document. A sweep is a consequence of the endorsement command,
not a new kind of command, so it introduces no new event type and no payload change. `event_count`,
event hashes, and `pnpm replay`'s reproduction of the brief's Expected Output are unchanged.

## Rejected alternatives

- **Reversing and re-cutting prior applications when a back-dated or reallocating event arrives.** Not
  applicable here — a sweep never touches an existing application row, only adds new ones — but worth
  naming because it is the alternative ADR-0004 already rejected for the adjacent back-dated-payment problem,
  for the identical reason: the append-only rule has no reversal concept, and inventing one is a larger
  schema change than this ticket's data shape calls for.
- **Rejecting a payment that overshoots every open document, instead of letting the remainder sit
  unapplied.** Rejected for the same reason ADR-0004 rejected it originally: the payment already happened in
  another system, and declining a genuine receipt destroys a fact rather than protecting one. This ADR does
  not revisit that call — it makes the _eventual_ use of the remainder work, not the acceptance of it.
- **A background job or read-time reconciliation pass that sweeps remainders independently of any specific
  endorsement.** Rejected because it introduces an eventual-consistency window (a client polling right after
  an endorsement could observe the pre-sweep state) and a second write path into `payment_applications`
  outside any policy-locked transaction, which is exactly the kind of second source of truth ADR-0004 already
  argued against for stored status columns. Doing it inside the endorsement's own transaction costs nothing
  extra: the policy lock is already held, and the new charge is the only thing that could possibly have
  become newly open.
- **Letting a premium credit settle against future charges by netting, rather than reporting `issued` and
  leaving both sides open.** The brief's scope has no refund or credit-netting concept, and `open_balance_cents`
  already nets the credit's ledger effect into the single balance figure every reader (explanation, suggested
  action, ledger view) already consults — a second netting mechanism at the document level would be a
  parallel, and possibly divergent, representation of the same fact.

## Known limitations

**A sweep only fires when a new charge is raised by an endorsement.** If every open charge is fully paid and
a remainder is left stranded, and no further endorsement ever arrives, the remainder sits in
`unapplied_cents` indefinitely — there is no scheduled or triggered re-sweep of existing charges. This is
consistent with the reported defect (the charge in question did not exist yet) and does not currently arise
any other way, since every open charge is swept either at payment time (ADR-0004's waterfall) or at the
charge's own creation time (this ADR). _How you would notice:_ a manual correction to an existing document's
`amount_cents` was possible outside the append-only rule. _What you would do:_ that correction is not
possible today (documents are append-only), so this limitation has no current trigger; if a future change
introduced document amendment, it would need to re-run the sweep as part of that write, the same way this
ADR runs it as part of endorsement write.

**Two remainders sweeping onto the same new charge are still visible to a concurrent reader only after
commit**, same as every other write in this system — no new isolation concern, just re-stated for this ADR's
scope.
