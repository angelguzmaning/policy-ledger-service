import type { PaymentCommand } from '@/server/api/schemas'
import type { Db, Tx } from '@/server/db/withTransaction'
import { withTransaction } from '@/server/db/withTransaction'
import { allocate, postPayment, type OpenBillingDocument } from '@/server/domain/ledger'
import {
  CurrencyMismatchError,
  ExternalPaymentIdConflictError,
  IdempotencyKeyConflictError,
  PolicyNotFoundError,
} from '@/server/errors'
import {
  appendPolicyEvent,
  computeFingerprint,
  deriveDocumentStatus,
  derivePaymentStatus,
  getOpenBalanceCents,
  selectPolicyForUpdate,
  systemClock,
  type Clock,
} from '@/server/service/shared'
import type { PaymentResult } from '@/server/service/types'

interface PaymentRow {
  payment_id: string
  policy_id: string
  external_payment_id: string
  amount_cents: string
  currency: string
  received_at: string
  request_fingerprint: string
  policy_seq: number
}

async function loadPaymentResult(
  tx: Tx,
  paymentId: string,
  idempotencyResult: PaymentResult['idempotency_result'],
): Promise<PaymentResult> {
  const { rows } = await tx.query<PaymentRow>('SELECT * FROM payments WHERE payment_id = $1', [
    paymentId,
  ])
  const payment = rows[0]
  if (!payment) throw new Error(`payment ${paymentId} vanished inside its own transaction`)

  const { rows: eventRows } = await tx.query<{
    seq: number
    event_type: string
    event_hash: string
  }>('SELECT seq, event_type, event_hash FROM policy_events WHERE policy_id = $1 AND seq = $2', [
    payment.policy_id,
    payment.policy_seq,
  ])
  const event = eventRows[0]
  if (!event) throw new Error(`policy event for payment ${paymentId} vanished`)

  const { rows: applicationRows } = await tx.query<{
    billing_document_id: string
    amount_cents: string
    document_amount_cents: string
    paid_cents: string
  }>(
    `SELECT pa.billing_document_id, pa.amount_cents, bd.amount_cents AS document_amount_cents,
            (SELECT COALESCE(SUM(pa2.amount_cents), 0) FROM payment_applications pa2
              WHERE pa2.billing_document_id = pa.billing_document_id) AS paid_cents
       FROM payment_applications pa
       JOIN billing_documents bd ON bd.billing_document_id = pa.billing_document_id
      WHERE pa.payment_id = $1
      ORDER BY pa.applied_at`,
    [paymentId],
  )

  const applications = applicationRows.map((row) => ({
    billing_document_id: row.billing_document_id,
    amount_cents: Number(row.amount_cents),
    document_status_after: deriveDocumentStatus(
      Number(row.document_amount_cents),
      Number(row.paid_cents),
    ),
  }))
  const appliedCents = applications.reduce((acc, a) => acc + a.amount_cents, 0)
  const amountCents = Number(payment.amount_cents)

  const { rows: ledgerRows } = await tx.query<{ ledger_transaction_id: string }>(
    "SELECT ledger_transaction_id FROM ledger_transactions WHERE source_type = 'payment' AND source_id = $1",
    [paymentId],
  )

  const openBalanceCents = await getOpenBalanceCents(tx, payment.policy_id)

  return {
    payment_id: payment.payment_id,
    external_payment_id: payment.external_payment_id,
    policy_id: payment.policy_id,
    amount_cents: amountCents,
    currency: payment.currency,
    received_at: payment.received_at,
    status: derivePaymentStatus(amountCents, appliedCents),
    applications,
    unapplied_cents: amountCents - appliedCents,
    ledger_transaction_ids: ledgerRows.map((r) => r.ledger_transaction_id),
    open_balance_cents: openBalanceCents,
    policy_event: { seq: event.seq, event_type: event.event_type, event_hash: event.event_hash },
    idempotency_result: idempotencyResult,
  }
}

export async function recordPayment(
  db: Db,
  policyId: string,
  command: PaymentCommand,
  clock: Clock = systemClock,
): Promise<PaymentResult> {
  return withTransaction(db, async (tx) => {
    const policy = await selectPolicyForUpdate(tx, policyId)
    if (!policy) throw new PolicyNotFoundError(policyId)

    const fingerprint = computeFingerprint(policyId, command)

    const { rows: existingRows } = await tx.query<PaymentRow>(
      'SELECT * FROM payments WHERE payment_id = $1',
      [command.idempotency_key],
    )
    const existing = existingRows[0]

    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        throw new IdempotencyKeyConflictError(command.idempotency_key)
      }
      return loadPaymentResult(tx, command.idempotency_key, 'duplicate ignored')
    }

    const { rows: externalRows } = await tx.query<{ payment_id: string }>(
      'SELECT payment_id FROM payments WHERE external_payment_id = $1',
      [command.external_payment_id],
    )
    if (externalRows[0]) {
      throw new ExternalPaymentIdConflictError(command.external_payment_id)
    }

    if (command.currency !== policy.currency) {
      throw new CurrencyMismatchError(
        policyId,
        policy.currency,
        command.idempotency_key,
        command.currency,
      )
    }

    const recordedAt = clock()
    const { seq } = await appendPolicyEvent(tx, {
      policyId,
      eventType: 'payment_recorded',
      recordedAt,
      payload: {
        payment_id: command.idempotency_key,
        external_payment_id: command.external_payment_id,
        amount_cents: command.amount_cents,
        currency: command.currency,
        received_at: command.received_at,
      },
    })

    await tx.query(
      `INSERT INTO payments
         (payment_id, policy_id, external_payment_id, amount_cents, currency, received_at,
          request_fingerprint, policy_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        command.idempotency_key,
        policyId,
        command.external_payment_id,
        command.amount_cents,
        command.currency,
        command.received_at,
        fingerprint,
        seq,
      ],
    )

    const { rows: openDocRows } = await tx.query<{
      billing_document_id: string
      due_date: string
      issued_at: string
      open_amount_cents: string
    }>(
      `SELECT bd.billing_document_id, bd.due_date::text AS due_date, bd.issued_at::text AS issued_at,
              bd.amount_cents - COALESCE(SUM(pa.amount_cents), 0) AS open_amount_cents
         FROM billing_documents bd
         LEFT JOIN payment_applications pa ON pa.billing_document_id = bd.billing_document_id
        WHERE bd.policy_id = $1
        GROUP BY bd.billing_document_id, bd.due_date, bd.issued_at
       HAVING bd.amount_cents - COALESCE(SUM(pa.amount_cents), 0) > 0`,
      [policyId],
    )
    const openDocuments: OpenBillingDocument[] = openDocRows.map((row) => ({
      billingDocumentId: row.billing_document_id,
      dueDate: row.due_date,
      issuedAt: row.issued_at,
      openAmountCents: Number(row.open_amount_cents),
    }))

    const { applications } = allocate(openDocuments, command.amount_cents)
    for (const application of applications) {
      await tx.query(
        'INSERT INTO payment_applications (payment_id, billing_document_id, amount_cents) VALUES ($1, $2, $3)',
        [command.idempotency_key, application.billingDocumentId, application.amountCents],
      )
    }

    const { rows: txRows } = await tx.query<{ ledger_transaction_id: string }>(
      `INSERT INTO ledger_transactions (policy_id, source_type, source_id, description)
       VALUES ($1, 'payment', $2, $3)
       RETURNING ledger_transaction_id`,
      [policyId, command.idempotency_key, `Payment ${command.idempotency_key} received`],
    )
    const ledgerTransactionId = txRows[0]?.ledger_transaction_id
    if (!ledgerTransactionId) throw new Error('ledger_transactions insert returned no id')

    for (const entry of postPayment(command.amount_cents)) {
      await tx.query(
        'INSERT INTO ledger_entries (ledger_transaction_id, account_code, amount_cents, currency) VALUES ($1, $2, $3, $4)',
        [ledgerTransactionId, entry.account, entry.amountCents, command.currency],
      )
    }

    return loadPaymentResult(tx, command.idempotency_key, 'applied')
  })
}
