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

## Test plan and CI

Source: [`docs/spec/test-plan-and-ci.md`](spec/test-plan-and-ci.md#7-known-limitations) ([#11](https://github.com/angelguzmaning/policy-ledger-service/issues/11))

- **The policy lock's behaviour under contention is argued, not tested** — no test drives two concurrent writers; a regression surfaces as duplicate rows under load, not as a red test.
- **No coverage threshold** — coverage is measured every run and gated by nothing, so it can regress silently.
- **`pnpm audit --audit-level=high` is advisory** — the four known `next`-pinned build-time advisories keep the gate at `critical`.
- **The seed's reproduction of the brief's Expected Output is not gated** — it is demonstrated by script, not asserted in CI.
- **Route handlers are not executed by the suite** — no test boots Next; they are held to three statements each so the untested surface stays reviewable.
- **`fileParallelism: false`** — integration runtime grows linearly with test files.
- **The tamper demo requires dropping the append-only trigger inside the test** — you have to disable a control to break the chain, which is the point.

<!--
Rows for #5 (proration), #6 (ledger), #7 (idempotency) and #8 (hash chain) land when their ADRs are authored
under docs/adr/ — see #17.
-->
