import { parseEndorsement } from '@/server/api/schemas'
import { createWriteHandler } from '@/server/api/writeHandler'
import { getPool } from '@/server/db/pool'
import { applyEndorsement } from '@/server/service/applyEndorsement'

const handle = createWriteHandler({
  requestKind: 'endorsement',
  parseCommand: parseEndorsement,
  run: (policyId, command) => applyEndorsement(getPool(), policyId, command),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ policyId: string }> },
): Promise<Response> {
  const { policyId } = await params
  return handle(request, policyId)
}
