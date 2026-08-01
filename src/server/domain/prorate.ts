// Proration, per business-rules.txt and ADR-0001:
//   term_days = term_end - term_start
//   remaining_days = term_end - effective_date
//   delta_cents = round_half_away_from_0(premium_delta * remaining_days / term_days)
//
// Epoch-days in, BigInt inside, `number` out. `Math.round` never appears --
// `Math.round(-0.5) === -0`, which would flip the sign of an exact-half
// negative result.

export interface ProrateInput {
  previousAnnualPremiumCents: number
  newAnnualPremiumCents: number
  termStartDays: number
  termEndDays: number
  effectiveDateDays: number
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is not a safe integer: ${value}`)
}

/** Half-up-away-from-zero rounding of a non-negative rational `numerator / denominator`. */
function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator)
}

export function prorate(input: ProrateInput): number {
  const {
    previousAnnualPremiumCents,
    newAnnualPremiumCents,
    termStartDays,
    termEndDays,
    effectiveDateDays,
  } = input

  assertSafeInteger(previousAnnualPremiumCents, 'previousAnnualPremiumCents')
  assertSafeInteger(newAnnualPremiumCents, 'newAnnualPremiumCents')

  const termDays = termEndDays - termStartDays
  if (termDays <= 0) throw new Error('termEndDays must be after termStartDays')

  const remainingDays = termEndDays - effectiveDateDays
  if (remainingDays < 0) throw new Error('effectiveDateDays must not be after termEndDays')

  const deltaCents = BigInt(newAnnualPremiumCents) - BigInt(previousAnnualPremiumCents)
  if (deltaCents === 0n) return 0

  const sign = deltaCents < 0n ? -1n : 1n
  const magnitude = deltaCents < 0n ? -deltaCents : deltaCents

  const numerator = magnitude * BigInt(remainingDays)
  const denominator = BigInt(termDays)
  const roundedMagnitude = roundHalfAwayFromZero(numerator, denominator)

  const result = sign * roundedMagnitude
  const asNumber = Number(result)
  assertSafeInteger(asNumber, 'prorated delta_cents')
  return asNumber
}
