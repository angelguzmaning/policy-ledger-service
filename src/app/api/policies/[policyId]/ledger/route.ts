import { jsonResponse, NO_STORE } from '@/server/api/http'
import { parsePolicyParams } from '@/server/api/schemas'
import { toHttpResponse } from '@/server/api/toHttpResponse'
import { getPool } from '@/server/db/pool'
import { loadLedger } from '@/server/service/loadLedger'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ policyId: string }> },
): Promise<Response> {
  const { policyId: rawPolicyId } = await params
  try {
    const { policyId } = parsePolicyParams({ policyId: rawPolicyId })
    const result = await loadLedger(getPool(), policyId)
    return jsonResponse(result, 200, NO_STORE)
  } catch (error) {
    const { status, body } = toHttpResponse(error)
    return jsonResponse(body, status, NO_STORE)
  }
}
