// Shared shape for the two write endpoints: parse path + body, call the
// service, map the outcome, and -- on every outcome -- write the
// `inbound_requests` receipt on a separate connection. See
// docs/spec/api-contract.md and ADR-0005.

import { getPool } from '@/server/db/pool'
import { jsonResponse, NO_STORE } from '@/server/api/http'
import { parsePolicyParams } from '@/server/api/schemas'
import { toHttpResponse } from '@/server/api/toHttpResponse'
import { InvalidRequestError } from '@/server/errors'
import { recordInboundRequest } from '@/server/service/inboundRequests'
import type { EndorsementResult, PaymentResult } from '@/server/service/types'

interface WriteHandlerConfig<TCommand extends { idempotency_key: string }, TResult> {
  requestKind: 'endorsement' | 'payment'
  parseCommand: (policyId: string, raw: unknown) => TCommand
  run: (policyId: string, command: TCommand) => Promise<TResult>
}

function resultStatus(result: EndorsementResult | PaymentResult): number {
  return result.idempotency_result === 'applied' ? 201 : 200
}

export function createWriteHandler<
  TCommand extends { idempotency_key: string },
  TResult extends EndorsementResult | PaymentResult,
>(config: WriteHandlerConfig<TCommand, TResult>) {
  return async function handle(request: Request, rawPolicyId: string): Promise<Response> {
    let requestBody = ''
    let businessId: string | null = null

    try {
      const { policyId } = parsePolicyParams({ policyId: rawPolicyId })

      try {
        requestBody = await request.text()
      } catch {
        throw new InvalidRequestError('Request body is not valid JSON.')
      }
      let parsedJson: unknown
      try {
        parsedJson = requestBody.length > 0 ? JSON.parse(requestBody) : undefined
      } catch {
        throw new InvalidRequestError('Request body is not valid JSON.')
      }

      const command = config.parseCommand(policyId, parsedJson)
      businessId = command.idempotency_key

      const result = await config.run(policyId, command)
      const status = resultStatus(result)

      await recordInboundRequest(getPool(), {
        policyId,
        requestKind: config.requestKind,
        businessId,
        outcome: 'accepted',
        statusCode: status,
        errorCode: null,
        requestBody,
      }).catch(() => {})

      return jsonResponse(result, status, NO_STORE)
    } catch (error) {
      const { status, body } = toHttpResponse(error)

      await recordInboundRequest(getPool(), {
        policyId: rawPolicyId,
        requestKind: config.requestKind,
        businessId,
        outcome: 'rejected',
        statusCode: status,
        errorCode: body.error.code,
        requestBody,
      }).catch(() => {})

      return jsonResponse(body, status, NO_STORE)
    }
  }
}
