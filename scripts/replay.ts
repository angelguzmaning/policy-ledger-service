// `pnpm replay` -- assumes `pnpm dev` (or the built app) is already running
// against a seeded database. POSTs `data/events.json` in order through the
// real HTTP endpoints, then GETs the policy view and history/verify, and
// prints a summary shaped like the brief's Expected Output. Not asserted in
// CI (see docs/spec/seed-replay-and-deliverables.md) -- its only automated
// check is that `ledger.balanced` and `history.valid` come back true.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const POLICY_ID = process.env.DEMO_POLICY_ID ?? 'POL-1001'

interface RawEvent {
  type: 'endorsement.requested' | 'payment.received'
  policy_id: string
  [key: string]: unknown
}

async function postEvent(event: RawEvent): Promise<void> {
  const path = event.type === 'endorsement.requested' ? 'endorsements' : 'payments'
  const url = `${BASE_URL}/api/policies/${event.policy_id}/${path}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  const body = (await response.json()) as unknown
  console.log(
    `POST ${path} ${(body as { idempotency_key?: string }).idempotency_key ?? ''} -> ${response.status}`,
  )
  console.log(JSON.stringify(body, null, 2))
}

async function main(): Promise<void> {
  const events = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'events.json'), 'utf8'),
  ) as RawEvent[]

  for (const event of events) {
    await postEvent(event)
  }

  const policyResponse = await fetch(`${BASE_URL}/api/policies/${POLICY_ID}`)
  const policy = (await policyResponse.json()) as {
    ledger?: { balanced?: boolean }
    history?: { valid?: boolean }
  }
  console.log('\n=== GET /api/policies/%s ===', POLICY_ID)
  console.log(JSON.stringify(policy, null, 2))

  const verifyResponse = await fetch(`${BASE_URL}/api/policies/${POLICY_ID}/history/verify`)
  const verify = (await verifyResponse.json()) as { valid?: boolean }
  console.log('\n=== GET /api/policies/%s/history/verify ===', POLICY_ID)
  console.log(JSON.stringify(verify, null, 2))

  const balanced = policy.ledger?.balanced === true
  const historyValid = verify.valid === true

  if (!balanced || !historyValid) {
    console.error(`\nFAILED self-check: ledger.balanced=${balanced} history.valid=${historyValid}`)
    process.exit(1)
  }

  console.log('\nOK: ledger.balanced=true, history.valid=true')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
