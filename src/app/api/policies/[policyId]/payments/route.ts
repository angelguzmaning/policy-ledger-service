import { parsePayment } from '@/server/api/schemas'
import { createWriteHandler } from '@/server/api/writeHandler'
import { getPool } from '@/server/db/pool'
import { recordPayment } from '@/server/service/recordPayment'

const handle = createWriteHandler({
  requestKind: 'payment',
  parseCommand: parsePayment,
  run: (policyId, command) => recordPayment(getPool(), policyId, command),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ policyId: string }> },
): Promise<Response> {
  const { policyId } = await params
  return handle(request, policyId)
}
