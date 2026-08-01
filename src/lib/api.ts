// A thin fetch client against the six route handlers. Deliberately no
// server-prefetch, no server actions -- `useQuery`/`useMutation` call these
// directly from the client so the reviewer's network tab shows the real
// request. See docs/spec/frontend-ui.md.

export const DEMO_POLICY_ID = process.env.NEXT_PUBLIC_DEMO_POLICY_ID ?? 'POL-1001'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: { path: string; message: string }[]
    request_id?: string
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: { path: string; message: string }[] | undefined

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message)
    this.status = status
    this.code = body.error.code
    this.details = body.error.details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = (await response.json()) as unknown
  if (!response.ok) throw new ApiError(response.status, body as ApiErrorBody)
  return body as T
}

export interface BillingDocumentView {
  id: string
  type: 'endorsement_adjustment' | 'premium_credit'
  amount_cents: number
  status: 'open' | 'partially_paid' | 'paid'
}

export interface PolicyView {
  policy_id: string
  homeowner_id: string
  status: string
  currency: string
  term_start: string
  term_end: string
  annual_premium_cents: number
  endorsements: {
    id: string
    effective_date: string
    delta_cents: number
    billing_document: BillingDocumentView | null
    idempotency_result: string
  }[]
  payments: {
    external_payment_id: string
    amount_cents: number
    status: string
    idempotency_result: string
  }[]
  open_balance_cents: number
  ledger: {
    balanced: boolean
    transactions: { source: string; debits_cents: number; credits_cents: number }[]
  }
  history: { valid: boolean; event_count: number; events: string[] }
  rejected_events: { id: string; reason: string }[]
  explanation: string
  suggested_action: string
}

export interface LedgerView {
  policy_id: string
  currency: string
  transactions: {
    id: string
    source_type: string
    source_id: string
    description: string
    posted_at: string
    entries: { account: string; amount_cents: number; direction: 'debit' | 'credit' }[]
  }[]
  account_balances: Record<string, number>
  sum_all_entries: number
  unbalanced_transactions: { id: string; sum_cents: number }[]
}

export interface HistoryVerifyView {
  valid: boolean
  event_count: number
  events?: string[]
  head_hash?: string | null
  verified_through_seq?: number
  break?: { seq: number; reason: string }
}

export interface EndorsementCommand {
  idempotency_key: string
  effective_date: string
  new_annual_premium_cents: number
  reason?: string
}

export interface PaymentCommand {
  idempotency_key: string
  external_payment_id: string
  amount_cents: number
  currency: string
  received_at: string
}

export function fetchPolicy(policyId: string): Promise<PolicyView> {
  return request(`/policies/${policyId}`)
}

export function fetchLedger(policyId: string): Promise<LedgerView> {
  return request(`/policies/${policyId}/ledger`)
}

export function fetchVerify(policyId: string): Promise<HistoryVerifyView> {
  return request(`/policies/${policyId}/history/verify`)
}

export function postEndorsement(policyId: string, command: EndorsementCommand): Promise<unknown> {
  return request(`/policies/${policyId}/endorsements`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
}

export function postPayment(policyId: string, command: PaymentCommand): Promise<unknown> {
  return request(`/policies/${policyId}/payments`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
}
