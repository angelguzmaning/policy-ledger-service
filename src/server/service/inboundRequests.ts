// Written on a connection separate from the business transaction, on every
// outcome, so a rolled-back write still leaves a receipt. `db.query(...)`
// (rather than a client pulled from the same `withTransaction` call) is what
// gives it its own connection -- see ADR-0005.

import type { Db } from '@/server/db/withTransaction'

export interface InboundRequestRecord {
  policyId: string
  requestKind: 'endorsement' | 'payment'
  businessId: string | null
  outcome: 'accepted' | 'rejected'
  statusCode: number
  errorCode: string | null
  requestBody: string
}

export async function recordInboundRequest(db: Db, record: InboundRequestRecord): Promise<void> {
  await db.query(
    `INSERT INTO inbound_requests
       (policy_id, request_kind, business_id, outcome, status_code, error_code, request_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      record.policyId,
      record.requestKind,
      record.businessId,
      record.outcome,
      record.statusCode,
      record.errorCode,
      record.requestBody,
    ],
  )
}
