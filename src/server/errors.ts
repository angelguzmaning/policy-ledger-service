// Typed domain errors. They carry the data their message needs and know
// nothing about HTTP status codes -- `toHttpResponse` is the single place a
// domain error becomes a status. See docs/spec/api-contract.md §3.

export abstract class DomainError extends Error {
  abstract readonly code: string
}

export interface InvalidRequestIssue {
  path: string
  message: string
}

export class InvalidRequestError extends DomainError {
  readonly code = 'InvalidRequest'
  readonly details: InvalidRequestIssue[]

  constructor(message: string, details: InvalidRequestIssue[] = []) {
    super(message)
    this.details = details
  }
}

export class PolicyIdMismatchError extends DomainError {
  readonly code = 'PolicyIdMismatch'

  constructor(pathPolicyId: string, bodyPolicyId: string) {
    super(`Path policy id ${pathPolicyId} does not match body policy_id ${bodyPolicyId}.`)
  }
}

export class PolicyNotFoundError extends DomainError {
  readonly code = 'PolicyNotFound'

  constructor(policyId: string) {
    super(`No policy found for id ${policyId}.`)
  }
}

export class IdempotencyKeyConflictError extends DomainError {
  readonly code = 'IdempotencyKeyConflict'

  constructor(key: string) {
    super(`Idempotency key ${key} was already used with a different payload.`)
  }
}

export class ExternalPaymentIdConflictError extends DomainError {
  readonly code = 'ExternalPaymentIdConflict'

  constructor(externalPaymentId: string) {
    super(
      `external_payment_id ${externalPaymentId} is already recorded under a different payment_id.`,
    )
  }
}

export class PolicyNotActiveError extends DomainError {
  readonly code = 'PolicyNotActive'

  constructor(policyId: string, status: string) {
    super(`Policy ${policyId} is ${status}, not active; endorsements cannot be applied.`)
  }
}

export class OutOfTermError extends DomainError {
  readonly code = 'OutOfTerm'

  constructor(effectiveDate: string, termStart: string, termEnd: string) {
    super(`effective_date ${effectiveDate} is outside the policy term ${termStart} to ${termEnd}.`)
  }
}

export class OutOfOrderEndorsementError extends DomainError {
  readonly code = 'OutOfOrderEndorsement'

  constructor(effectiveDate: string, latestEffectiveDate: string) {
    super(
      `effective_date ${effectiveDate} precedes the latest applied endorsement's effective date ${latestEffectiveDate}.`,
    )
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CurrencyMismatch'

  constructor(
    policyId: string,
    policyCurrency: string,
    paymentId: string,
    paymentCurrency: string,
  ) {
    super(
      `Policy ${policyId} is denominated in ${policyCurrency}; payment ${paymentId} is in ${paymentCurrency}.`,
    )
  }
}

export class InternalErrorWrapped extends DomainError {
  readonly code = 'InternalError'
  readonly requestId: string
  override readonly cause: unknown

  constructor(requestId: string, cause: unknown) {
    super('An unexpected error occurred.')
    this.requestId = requestId
    this.cause = cause
  }
}
