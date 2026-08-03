import type { EndorsementCommand } from '@/server/api/schemas'
import type { Db, Tx } from '@/server/db/withTransaction'
import { withTransaction } from '@/server/db/withTransaction'
import { parseDate } from '@/server/domain/dates'
import { postEndorsement, sweepRemainders } from '@/server/domain/ledger'
import { prorate } from '@/server/domain/prorate'
import {
  IdempotencyKeyConflictError,
  OutOfOrderEndorsementError,
  OutOfTermError,
  PolicyNotActiveError,
  PolicyNotFoundError,
} from '@/server/errors'
import {
  appendPolicyEvent,
  computeFingerprint,
  deriveDocumentStatus,
  getOpenBalanceCents,
  insertPaymentApplications,
  loadUnappliedPaymentRemainders,
  selectPolicyForUpdate,
  systemClock,
  toApiBillingDocumentType,
  type Clock,
} from '@/server/service/shared'
import type { BillingDocumentSummary, EndorsementResult } from '@/server/service/types'

interface EndorsementRow {
  endorsement_id: string
  policy_id: string
  effective_date: string
  previous_annual_premium_cents: string
  new_annual_premium_cents: string
  delta_cents: string
  request_fingerprint: string
  policy_seq: number
}

async function loadEndorsementResult(
  tx: Tx,
  endorsementId: string,
  idempotencyResult: EndorsementResult['idempotency_result'],
): Promise<EndorsementResult> {
  const { rows } = await tx.query<EndorsementRow>(
    'SELECT * FROM endorsements WHERE endorsement_id = $1',
    [endorsementId],
  )
  const endorsement = rows[0]
  if (!endorsement)
    throw new Error(`endorsement ${endorsementId} vanished inside its own transaction`)

  const { rows: eventRows } = await tx.query<{
    seq: number
    event_type: string
    event_hash: string
  }>('SELECT seq, event_type, event_hash FROM policy_events WHERE policy_id = $1 AND seq = $2', [
    endorsement.policy_id,
    endorsement.policy_seq,
  ])
  const event = eventRows[0]
  if (!event) throw new Error(`policy event for endorsement ${endorsementId} vanished`)

  const { rows: billingRows } = await tx.query<{
    billing_document_id: string
    document_type: 'endorsement_adjustment' | 'premium_credit'
    amount_cents: string
    paid_cents: string | null
  }>(
    `SELECT bd.billing_document_id, bd.document_type, bd.amount_cents,
            SUM(pa.amount_cents) AS paid_cents
       FROM billing_documents bd
       LEFT JOIN payment_applications pa ON pa.billing_document_id = bd.billing_document_id
      WHERE bd.endorsement_id = $1
      GROUP BY bd.billing_document_id, bd.document_type, bd.amount_cents`,
    [endorsementId],
  )
  const billingRow = billingRows[0]
  const billingDocument: BillingDocumentSummary | null = billingRow
    ? {
        id: billingRow.billing_document_id,
        type: toApiBillingDocumentType(billingRow.document_type),
        amount_cents: Number(billingRow.amount_cents),
        status: deriveDocumentStatus(
          billingRow.document_type,
          Number(billingRow.amount_cents),
          Number(billingRow.paid_cents ?? 0),
        ),
      }
    : null

  const { rows: ledgerRows } = await tx.query<{ ledger_transaction_id: string }>(
    "SELECT ledger_transaction_id FROM ledger_transactions WHERE source_type = 'endorsement' AND source_id = $1",
    [endorsementId],
  )

  const openBalanceCents = await getOpenBalanceCents(tx, endorsement.policy_id)

  return {
    endorsement_id: endorsement.endorsement_id,
    policy_id: endorsement.policy_id,
    effective_date: endorsement.effective_date,
    previous_annual_premium_cents: Number(endorsement.previous_annual_premium_cents),
    new_annual_premium_cents: Number(endorsement.new_annual_premium_cents),
    delta_cents: Number(endorsement.delta_cents),
    billing_document: billingDocument,
    ledger_transaction_ids: ledgerRows.map((r) => r.ledger_transaction_id),
    open_balance_cents: openBalanceCents,
    policy_event: { seq: event.seq, event_type: event.event_type, event_hash: event.event_hash },
    idempotency_result: idempotencyResult,
  }
}

export async function applyEndorsement(
  db: Db,
  policyId: string,
  command: EndorsementCommand,
  clock: Clock = systemClock,
): Promise<EndorsementResult> {
  return withTransaction(db, async (tx) => {
    const policy = await selectPolicyForUpdate(tx, policyId)
    if (!policy) throw new PolicyNotFoundError(policyId)

    const fingerprint = computeFingerprint(policyId, command)

    const { rows: existingRows } = await tx.query<EndorsementRow>(
      'SELECT * FROM endorsements WHERE endorsement_id = $1',
      [command.idempotency_key],
    )
    const existing = existingRows[0]

    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        throw new IdempotencyKeyConflictError(command.idempotency_key)
      }
      return loadEndorsementResult(tx, command.idempotency_key, 'duplicate ignored')
    }

    if (policy.status !== 'active') {
      throw new PolicyNotActiveError(policyId, policy.status)
    }

    const termStartDays = parseDate(policy.term_start)
    const termEndDays = parseDate(policy.term_end)
    const effectiveDateDays = parseDate(command.effective_date)

    if (effectiveDateDays < termStartDays || effectiveDateDays > termEndDays) {
      throw new OutOfTermError(command.effective_date, policy.term_start, policy.term_end)
    }

    const { rows: latestRows } = await tx.query<{ effective_date: string }>(
      'SELECT effective_date FROM endorsements WHERE policy_id = $1 ORDER BY policy_seq DESC LIMIT 1',
      [policyId],
    )
    const latest = latestRows[0]
    if (latest && effectiveDateDays < parseDate(latest.effective_date)) {
      throw new OutOfOrderEndorsementError(command.effective_date, latest.effective_date)
    }

    const previousAnnualPremiumCents = Number(policy.annual_premium_cents)
    const deltaCents = prorate({
      previousAnnualPremiumCents,
      newAnnualPremiumCents: command.new_annual_premium_cents,
      termStartDays,
      termEndDays,
      effectiveDateDays,
    })

    const recordedAt = clock()
    const { seq } = await appendPolicyEvent(tx, {
      policyId,
      eventType: 'endorsement_applied',
      recordedAt,
      payload: {
        endorsement_id: command.idempotency_key,
        effective_date: command.effective_date,
        previous_annual_premium_cents: previousAnnualPremiumCents,
        new_annual_premium_cents: command.new_annual_premium_cents,
        delta_cents: deltaCents,
      },
    })

    await tx.query('UPDATE policies SET annual_premium_cents = $1 WHERE policy_id = $2', [
      command.new_annual_premium_cents,
      policyId,
    ])

    await tx.query(
      `INSERT INTO endorsements
         (endorsement_id, policy_id, effective_date, previous_annual_premium_cents,
          new_annual_premium_cents, delta_cents, reason, request_fingerprint, policy_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        command.idempotency_key,
        policyId,
        command.effective_date,
        previousAnnualPremiumCents,
        command.new_annual_premium_cents,
        deltaCents,
        command.reason ?? null,
        fingerprint,
        seq,
      ],
    )

    if (deltaCents !== 0) {
      const documentType = deltaCents > 0 ? 'endorsement_adjustment' : 'premium_credit'
      const amountCents = Math.abs(deltaCents)

      const { rows: billingDocRows } = await tx.query<{ billing_document_id: string }>(
        `INSERT INTO billing_documents
           (policy_id, endorsement_id, document_type, amount_cents, currency, due_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING billing_document_id`,
        [
          policyId,
          command.idempotency_key,
          documentType,
          amountCents,
          policy.currency,
          command.effective_date,
        ],
      )
      const billingDocumentId = billingDocRows[0]?.billing_document_id
      if (!billingDocumentId) throw new Error('billing_documents insert returned no id')

      // Only charges are payable (ADR-0007) -- a premium credit stays out of the sweep entirely,
      // and cash never settles it.
      if (documentType === 'endorsement_adjustment') {
        const remainders = await loadUnappliedPaymentRemainders(tx, policyId)
        const { applications } = sweepRemainders(
          amountCents,
          remainders.map((r) => ({
            paymentId: r.payment_id,
            remainderCents: Number(r.remainder_cents),
          })),
        )
        await insertPaymentApplications(
          tx,
          applications.map((a) => ({
            paymentId: a.paymentId,
            billingDocumentId,
            amountCents: a.amountCents,
          })),
        )
      }

      const { rows: txRows } = await tx.query<{ ledger_transaction_id: string }>(
        `INSERT INTO ledger_transactions (policy_id, source_type, source_id, description)
         VALUES ($1, 'endorsement', $2, $3)
         RETURNING ledger_transaction_id`,
        [
          policyId,
          command.idempotency_key,
          `Premium delta for endorsement ${command.idempotency_key}`,
        ],
      )
      const ledgerTransactionId = txRows[0]?.ledger_transaction_id
      if (!ledgerTransactionId) throw new Error('ledger_transactions insert returned no id')

      for (const entry of postEndorsement(deltaCents)) {
        await tx.query(
          'INSERT INTO ledger_entries (ledger_transaction_id, account_code, amount_cents, currency) VALUES ($1, $2, $3, $4)',
          [ledgerTransactionId, entry.account, entry.amountCents, policy.currency],
        )
      }
    }

    return loadEndorsementResult(tx, command.idempotency_key, 'applied')
  })
}
