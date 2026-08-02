# Frontend: operator UI scope

Resolves [#12](https://github.com/angelguzmaning/policy-ledger-service/issues/12). Inherits the client-stack
decision in the map's **Client stack** locked-decision note and its costing in
[#16](https://github.com/angelguzmaning/policy-ledger-service/issues/16), the idempotency-key-at-mount rule from
[#7](https://github.com/angelguzmaning/policy-ledger-service/issues/7), and the error envelope / response shapes
from [#10](https://github.com/angelguzmaning/policy-ledger-service/issues/10).

Decided against a working prototype (three structurally different layouts, one shared in-memory mock of the API
contract) rather than in the abstract. The prototype lives on `prototype/operator-ui` (not merged — implementation
is out of scope for this map); this doc is the locked answer it produced.

---

## 1. Shape — single page, no picker

One route (`/`), no policy picker, no dynamic segment. There is effectively one policy in the demo (`POL-1001`),
so a picker would be a screen the reviewer clicks through for nothing. The policy id is a build-time constant
(`NEXT_PUBLIC_DEMO_POLICY_ID`, defaulting to `POL-1001`), not a route param — if the effort is ever redrawn for
multiple policies, that's a fresh routing decision, not a hidden constraint this one is quietly carrying.

## 2. Layout — "split console" (prototype variant A)

Rejected two structural alternatives, both prototyped:

- **Card dashboard + tabs** (variant B) — summary cards, a tab bar switching between Endorsements / Payments /
  Ledger, forms behind toggle buttons. More screens for the same information; the tab bar hides the ledger and
  payments behind clicks the reviewer has to know to make, and the video is a _single continuous flow_, not a
  browse session.
- **Raw log / terminal** (variant C) — every request/response shown as literal JSON in a scrolling log. Genuinely
  tested "is showing the JSON verbatim actually persuasive" (ticket item 3) and the answer is _partially_: raw
  JSON is the right instinct for the response envelope (see §4), but as the _entire_ UI it stops being an operator
  view and becomes a network tab with extra steps — it fails the brief's "make the backend workflow understandable
  to an operator" test.

**Locked layout**, one screen, no scrolling between sections during the demo:

```
┌───────────────────────────────────────────────────┐
│ POL-1001 (HOME-204)                [history: OK]  │  status bar: status, premium,
│ status · premium · term · open balance             │  term, balance, verify pill
│ explanation sentence                                │  #10's rule-based summary
│ suggested_action sentence                           │
├───────────────────────┬─────────────────────────────┤
│ Timeline               │ Apply Endorsement            │
│ (events + billing docs │  effective_date               │
│  + payments, merged,   │  new_annual_premium_cents      │
│  chronological)         │  [Submit]                     │
│                         ├─────────────────────────────┤
│ Ledger (account         │ Record Received Payment       │
│  balances +             │  amount_cents / currency       │
│  unbalanced probe)      │  [Submit]                      │
├───────────────────────┴─────────────────────────────┤
│ ─────────────────── separator ───────────────────────  │
│ Account statements (full width)                         │
│  one table per account with movements:                  │
│  date · source · description · debit · credit · balance │
└───────────────────────────────────────────────────┘
```

Additions versus the prototyped variant A. The first and third were made while writing this doc rather than
deferred to implementation; the account statements section was added after the build, on the observation that the
Ledger panel asserts balances the reviewer cannot then take apart:

- **A Ledger panel**, under the timeline, rendering `GET /ledger`'s `account_balances` and the
  `unbalanced_transactions` probe verbatim (always empty, by construction — the on-call note's first query). The
  prototype folded ledger correctness into the summary's `open_balance_cents`; the brief separately asks for a
  "ledger summary," and #6/#10 built a whole endpoint whose entire point is to _prove_ balance rather than assert
  it. Not showing it wastes the strongest artifact this backend has.
- **An account statements section**, full width, below the split console and separated from it by a rule. The
  Ledger panel above answers "what are the balances"; this answers "how did each balance get there" — one table
  per account **that has movements**, oldest first, with `date · source · description · debit · credit` columns
  and a running balance closing on the exact figure the panel shows. It is a pure client-side regrouping of the
  `transactions[]` `GET /ledger` already returns (`src/lib/accountStatements.ts`) — no query, endpoint, or schema
  change, and the entries were previously fetched and discarded.
- **An explicit "Verify History" action**, calling `GET /history/verify` rather than only reading the `history`
  block embedded in `GET /policies/:id`. The embedded block is enough for the status pill at rest, but the demo
  path (§5) needs a discrete, clickable moment that exercises the dedicated endpoint — otherwise one of the six
  required endpoints is never visibly called during the walkthrough.

### Rejected alternatives for the statements section

- **An accordion inside the Ledger panel** — click an account row, its movements unfold beneath it. Rejected
  because it hides information behind a click the reviewer has to know to make, which is the same criticism §2
  levels at the rejected card-dashboard-plus-tabs variant. A section that is simply _there_, below the fold,
  costs the one-screen demo flow nothing: the console above is unchanged at rest.
- **Always-expanded movements inside the Ledger panel** — same information, no interaction, but it roughly
  triples that panel's height and breaks the no-scrolling-between-sections property the layout is built on.
- **Signed amounts in a single column** (`-120.99` for `written_premium`, matching the wire format verbatim).
  Rejected on the running balance: a credit-normal account's total marches _downward_ as the business writes
  premium, which reads as a bug on screen. Debit/credit columns are the convention an actual statement uses and
  make the question disappear. The split is presentational only — `direction` is read from the response, never
  recomputed, so ADR-0002's "no `CASE` anywhere" property holds all the way to the component.
- **Normal-balance-aware display** (flip credit-normal accounts to read positive). Rejected as the one option
  that _would_ reintroduce a sign inversion keyed on account metadata — precisely the site ADR-0002 set out to
  eliminate — and the only one requiring `ledger_accounts.normal_balance` to be exposed by the API. The account
  kind is shown as a label instead, hardcoded in the component, never used in arithmetic.
- **Annotating rows with the billing documents a payment settled** (`PAY-9002 → BILL-3001 60.00, …`). Rejected as
  a category error: the general ledger and the subsidiary billing ledger are different books, meant to reconcile
  rather than merge (ADR-0004). `payment_applications` is exposed by no endpoint, so this was also the only
  option requiring new server work; the Timeline panel is where the document story belongs.

## 3. Data fetching and mutations

- **`'use client'` at the page root.** No server-component prefetch, no hydration boundary — `#16` already ruled
  this out ("a second data path for ~0 latency on localhost"). The page calls `useQuery` directly, so the
  reviewer's network tab shows the real request the moment the page loads; that visibility is the entire reason
  TanStack Query is in this build, and a server-prefetched cache would hide the first fetch that proves it.
- **`useMutation` against the route handlers via `fetch`, not server actions** — confirmed from the ticket's
  amendment. A server action would hide the HTTP call the brief explicitly wants demonstrated; `useMutation`'s
  `mutate`/`isPending`/`error` states map directly onto the four basic states the brief requires (loading, success,
  validation error, server error).
- **Invalidate-and-refetch on mutation success** (`queryClient.invalidateQueries(['policy', policyId])`) is the
  single most legible "this UI consumes the API" moment: submit the endorsement form, watch the status bar,
  timeline, and ledger panel all re-render from a fresh `GET`, not from the mutation's own response body.
  `POST` responses are deliberately narrow (`#10`: "the effects of this request only") specifically so this
  refetch is load-bearing rather than redundant.
- **Query defaults, per `#16`**: `retry: false` (a `retry: 3` default would make the deliberate `422
CurrencyMismatch` demo hang through three silent retries before rendering), `staleTime: 30_000`,
  `refetchOnWindowFocus: false`.
- **The idempotency key is minted at form mount**, `useState(() => crypto.randomUUID())`, per `#7` — verified in
  the prototype's `useDemoForms` hook and carried forward unchanged. Minting on submit instead would mean a
  double-click mints two keys and the idempotency guarantee protects nothing; this is a correctness rule, not a
  style choice.

## 4. Error rendering

One rule: the API's error envelope (`{ error: { code, message, details? } }`, `#10`) is rendered close to literally,
not translated into bespoke copy per code. The prototype's inline banner —status code, `code`, `message`— proved
sufficient for every error the demo path triggers, including `409 IdempotencyKeyConflict` and
`422 CurrencyMismatch`. Field-level detail (`InvalidRequest`'s `details[]`) maps each `{ path, message }` onto the
matching form field; there's exactly one endpoint shape (`400 InvalidRequest`) that produces it, so this is a single
small formatter, not a per-form concern.

The banner lives inside the form it belongs to (`useMutation`'s `error` state), not as a global toast — the
reviewer needs to see the failed request next to the fields that produced it, especially for the currency-mismatch
demo where the field (`currency=EUR`) and the rejection need to be in the same glance.

## 5. Demo path

Validated by clicking through the prototype end to end:

1. **Load** — page mounts, `GET /policies/POL-1001` fires, status bar renders (`active`, premium, `$0.00` balance,
   history verified, "No action required").
2. **Apply Endorsement** — `effective_date=2026-07-01`, `new_annual_premium_cents=144000`, submit. `201`
   arrives, the mutation invalidates the policy query; timeline gains `END-2001` with its billing document, ledger
   panel gains the offsetting entries, status bar's balance goes to the delta.
3. **Record Payment** — `amount_cents` equal to the open balance, `currency=USD`, submit. `201 applied`; balance
   returns to `$0.00`, the billing document flips to `paid` in the timeline, ledger panel updates.
4. **Verify History** — click triggers `GET /history/verify`; `valid: true`, pill stays green. (The "corrupt
   history" affordance from the prototype is dropped for the real build — there's no code path that produces a
   broken chain outside of directly mutating the database, which isn't a control worth wiring for a demo.)
5. **Trigger the EUR rejection** — a second payment form submission with `currency=EUR`. `422 CurrencyMismatch`
   renders inline in the payment form; nothing else on the page changes, which is itself the point — a rejected
   request has no side effects (`#8`'s `inbound_requests` receipt aside).

This is the only path the UI needs to support well; nothing outside it earns styling or state-handling effort.

## 6. Styling budget — five shadcn components

`Card`, `Badge` (the history-verified pill and billing-document status), `Button`, `Input`, `Label`. No `Tabs`, no
`Dialog` — both belonged to the rejected card-dashboard variant. This is a smaller footprint than `#16`'s costed
stack implied was likely, because the winning layout has no tabbed navigation and no modal forms to justify them.
Everything else is Tailwind utility classes on plain semantic HTML, consistent with `#16`'s "minimum viable subset"
finding that TanStack Query, not the component library, is what does the demonstrating.

## 7. Client state — Zustand dropped

This ticket owned the final call per the map's client-stack note. Verdict: **no Zustand.** Server state is entirely
TanStack Query's; the only client state is per-form field values (`useState`, scoped to each form component) and
the idempotency key minted at mount. Nothing outlives a single component — the prototype's `usePolicyDemo` hook
(the closest thing to "shared state" in the build) exists only because the prototype fakes a backend in memory; the
real page has no equivalent; each mutation talks to a real endpoint and state is invalidated back from the server.
Confirms `#16`'s prediction that TanStack Query owning server state would leave "very little" client state, and
closes the provisional flag on that dependency.

## Known limitations

- **The prototype's proration math is a simplified stand-in**, not `#5`'s exact `BigInt` half-up-away-from-zero
  rounding rule — it was built to make the demo path visually correct, not to be the source of truth. The real
  route handler must call the actual `src/server` proration function; a discrepancy here would only ever surface
  as a display bug in the prototype, not in the shipped system, since the prototype is never merged.
- **No frontend tests.** Ratified by `#16`: `vitest.config.mts` doesn't collect `.tsx` today and
  `coverage.include` is `src/server/**` only, so frontend tests can't raise the scored coverage number and
  widening it would lower it. This is a stated position for the README, not a silent gap — noticed here again
  because the UI is now locked enough that "we could test this" stops being hypothetical.
- **The "corrupt history" demo affordance is deliberately not built for real.** There is no legitimate API call
  that produces a broken chain; simulating one client-side (as the prototype does) would mean shipping fake data
  in the operator UI, which is worse than not demoing the failure path at all. If a tampered-chain demo is wanted
  for the video, it has to come from directly editing a row in the seeded database before the recording, not from
  a UI control.
