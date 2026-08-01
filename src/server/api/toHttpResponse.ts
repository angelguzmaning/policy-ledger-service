// The single place a domain error becomes an HTTP status + envelope. See
// docs/spec/api-contract.md §3's code table.

import { randomUUID } from 'node:crypto'
import {
  CurrencyMismatchError,
  DomainError,
  ExternalPaymentIdConflictError,
  IdempotencyKeyConflictError,
  InternalErrorWrapped,
  InvalidRequestError,
  OutOfOrderEndorsementError,
  OutOfTermError,
  PolicyIdMismatchError,
  PolicyNotActiveError,
  PolicyNotFoundError,
} from '@/server/errors'

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    details?: { path: string; message: string }[]
    request_id?: string
  }
}

export interface HttpErrorResponse {
  status: number
  body: ErrorEnvelope
}

const STATUS_BY_CODE: Record<string, number> = {
  InvalidRequest: 400,
  PolicyIdMismatch: 400,
  PolicyNotFound: 404,
  IdempotencyKeyConflict: 409,
  ExternalPaymentIdConflict: 409,
  PolicyNotActive: 422,
  OutOfTerm: 422,
  OutOfOrderEndorsement: 422,
  CurrencyMismatch: 422,
  InternalError: 500,
}

/**
 * Maps a caught error to an HTTP status + envelope. An error that is not one
 * of our typed `DomainError`s is wrapped as `InternalError`: a generated
 * `request_id` is returned, the cause is logged against that id, and no
 * Postgres (or other internal) message ever reaches the response body.
 */
export function toHttpResponse(error: unknown): HttpErrorResponse {
  if (
    error instanceof InvalidRequestError ||
    error instanceof PolicyIdMismatchError ||
    error instanceof PolicyNotFoundError ||
    error instanceof IdempotencyKeyConflictError ||
    error instanceof ExternalPaymentIdConflictError ||
    error instanceof PolicyNotActiveError ||
    error instanceof OutOfTermError ||
    error instanceof OutOfOrderEndorsementError ||
    error instanceof CurrencyMismatchError
  ) {
    const status = STATUS_BY_CODE[error.code] ?? 500
    const body: ErrorEnvelope = { error: { code: error.code, message: error.message } }
    if (error instanceof InvalidRequestError && error.details.length > 0) {
      body.error.details = error.details
    }
    return { status, body }
  }

  const wrapped =
    error instanceof InternalErrorWrapped ? error : new InternalErrorWrapped(randomUUID(), error)

  console.error(`[${wrapped.requestId}]`, wrapped.cause ?? error)

  return {
    status: 500,
    body: {
      error: {
        code: 'InternalError',
        message: 'An unexpected error occurred.',
        request_id: wrapped.requestId,
      },
    },
  }
}

// Re-exported so callers only need one import for the "is this a DomainError" check.
export { DomainError }
