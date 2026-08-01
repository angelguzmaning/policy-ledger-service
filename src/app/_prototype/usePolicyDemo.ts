// PROTOTYPE — throwaway. Shared demo "backend" state so all three layout variants react
// to the same simulated mutations; only the rendering differs between variants.
'use client'

import { useCallback, useState } from 'react'
import {
  applyEndorsement,
  applyEndorsementToPolicy,
  applyPaymentToPolicy,
  corruptHistory,
  recordPayment,
  seedPolicy,
  type ApiError,
  type EndorsementInput,
  type PaymentInput,
  type PolicySummary,
} from './mock-api'

export type MutationState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; error: ApiError; status_code: number }
  | { status: 'success'; message: string }

const SIMULATED_LATENCY_MS = 500

export function usePolicyDemo() {
  const [policy, setPolicy] = useState<PolicySummary>(() => seedPolicy())
  const [endorsementState, setEndorsementState] = useState<MutationState>({ status: 'idle' })
  const [paymentState, setPaymentState] = useState<MutationState>({ status: 'idle' })

  const submitEndorsement = useCallback(
    (input: EndorsementInput) => {
      setEndorsementState({ status: 'pending' })
      setTimeout(() => {
        const result = applyEndorsement(policy, input)
        if (!result.ok) {
          setEndorsementState({ status: 'error', error: result.error, status_code: result.status })
          return
        }
        setPolicy((current) => applyEndorsementToPolicy(current, result.data))
        setEndorsementState({
          status: 'success',
          message:
            result.data.idempotency_result === 'duplicate ignored'
              ? 'Duplicate ignored (replay)'
              : 'Endorsement applied',
        })
      }, SIMULATED_LATENCY_MS)
    },
    [policy],
  )

  const submitPayment = useCallback(
    (input: PaymentInput) => {
      setPaymentState({ status: 'pending' })
      setTimeout(() => {
        const result = recordPayment(policy, input)
        if (!result.ok) {
          setPaymentState({ status: 'error', error: result.error, status_code: result.status })
          return
        }
        setPolicy((current) => applyPaymentToPolicy(current, result.data))
        setPaymentState({
          status: 'success',
          message:
            result.data.idempotency_result === 'duplicate ignored'
              ? 'Duplicate ignored (replay)'
              : `Payment ${result.data.status}`,
        })
      }, SIMULATED_LATENCY_MS)
    },
    [policy],
  )

  const simulateTamper = useCallback(() => {
    setPolicy((current) => corruptHistory(current))
  }, [])

  const reset = useCallback(() => {
    setPolicy(seedPolicy())
    setEndorsementState({ status: 'idle' })
    setPaymentState({ status: 'idle' })
  }, [])

  return {
    policy,
    endorsementState,
    paymentState,
    submitEndorsement,
    submitPayment,
    simulateTamper,
    reset,
  }
}
