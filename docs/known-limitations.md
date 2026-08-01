# Known limitations

One line per limitation, pointing at the decision document that states it in full — what the decision does _not_
protect, how you would notice, and what you would do if it mattered later.

Named for the negative case deliberately. The neutral "Consequences" heading is the one people fill with restated
benefits.

## API contract and error model

Source: [`docs/spec/api-contract.md`](spec/api-contract.md#known-limitations) ([#10](https://github.com/angelguzmaning/policy-ledger-service/issues/10))

- **Rejections are reported but never actioned** — `suggested_action` reads policy state only; upstream health belongs on the `inbound_requests` rollup, not on a per-policy field.
- **No pagination on `GET /policies/:id` or `/ledger`** — both return the policy's full history; unbounded as a policy ages.
- **`ledger.balanced` is a computed claim, not a proof** — it exists because the Required Output Fields names it; `/ledger` remains the evidence.
- **Explanation templates are English-only** — fixed-order clause concatenation does not survive translation.
- **No rate limiting or payload size cap** — an oversized body reaches Zod before rejection.

<!--
Rows for #5 (proration), #6 (ledger), #7 (idempotency) and #8 (hash chain) land when their ADRs are authored
under docs/adr/ — see #17.
-->
