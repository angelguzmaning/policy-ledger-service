// Zod schemas + the strip. See docs/spec/api-contract.md §2. `events.json`
// objects are POST-able unchanged: `type` and `policy_id` are accepted,
// validated, and then stripped before the command reaches the service --
// the strip keeps the idempotency fingerprint stable across a retry that
// omits a decorative field.

import { z } from 'zod'
import {
  InvalidRequestError,
  PolicyIdMismatchError,
  type InvalidRequestIssue,
} from '@/server/errors'

// Same shapes are duplicated as SQL `CHECK`s in migrations/0001-0002 -- that duplication stays
// (the migrations are the independent DB-side guard), but any future change to a shape here
// belongs there too.
const Identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const IsoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

export const PolicyParams = z.strictObject({
  policyId: Identifier,
})

export const EndorsementBody = z.strictObject({
  type: z.literal('endorsement.requested').optional(),
  policy_id: z.string().optional(),
  idempotency_key: Identifier,
  effective_date: IsoDate,
  new_annual_premium_cents: z.int().positive(),
  reason: z.string().min(1).max(500).optional(),
})

export const PaymentBody = z.strictObject({
  type: z.literal('payment.received').optional(),
  policy_id: z.string().optional(),
  idempotency_key: Identifier,
  external_payment_id: Identifier,
  amount_cents: z.int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  received_at: IsoInstant,
})

export type EndorsementCommand = Omit<z.infer<typeof EndorsementBody>, 'type' | 'policy_id'>
export type PaymentCommand = Omit<z.infer<typeof PaymentBody>, 'type' | 'policy_id'>

interface ZodLikeIssue {
  path: PropertyKey[]
  message: string
  code?: string
  keys?: string[]
}

// `strictObject`'s "unrecognized_keys" issue reports an empty `path` with
// the offending keys on `issue.keys` -- expanded here to one detail per key
// so `details[0].path` names the field, matching the rest of the table.
function zodIssuesToDetails(issues: readonly ZodLikeIssue[]): InvalidRequestIssue[] {
  return issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys' && issue.keys) {
      return issue.keys.map((key) => ({ path: key, message: issue.message }))
    }
    return [{ path: issue.path.join('.'), message: issue.message }]
  })
}

export function parsePolicyParams(raw: unknown): { policyId: string } {
  const parsed = PolicyParams.safeParse(raw)
  if (!parsed.success) {
    throw new InvalidRequestError(
      'Request path failed validation.',
      zodIssuesToDetails(parsed.error.issues),
    )
  }
  return parsed.data
}

export function parseEndorsement(policyId: string, raw: unknown): EndorsementCommand {
  const parsed = EndorsementBody.safeParse(raw)
  if (!parsed.success) {
    throw new InvalidRequestError(
      'Request body failed validation.',
      zodIssuesToDetails(parsed.error.issues),
    )
  }
  if (parsed.data.policy_id !== undefined && parsed.data.policy_id !== policyId) {
    throw new PolicyIdMismatchError(policyId, parsed.data.policy_id)
  }
  const { type: _type, policy_id: _policyId, ...command } = parsed.data
  return command
}

export function parsePayment(policyId: string, raw: unknown): PaymentCommand {
  const parsed = PaymentBody.safeParse(raw)
  if (!parsed.success) {
    throw new InvalidRequestError(
      'Request body failed validation.',
      zodIssuesToDetails(parsed.error.issues),
    )
  }
  if (parsed.data.policy_id !== undefined && parsed.data.policy_id !== policyId) {
    throw new PolicyIdMismatchError(policyId, parsed.data.policy_id)
  }
  const { type: _type, policy_id: _policyId, ...command } = parsed.data
  return command
}
