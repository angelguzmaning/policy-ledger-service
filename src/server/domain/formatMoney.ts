// BigInt division, not float, so the no-floats-in-financial-logic rule needs
// no carve-out for the presentation layer.
export function formatMoney(cents: number, currency: string): string {
  // Not `Number.isSafeInteger`: a value above MAX_SAFE_INTEGER can still be
  // an exact integer-valued double, and `BigInt()` converts it losslessly.
  if (!Number.isInteger(cents)) throw new Error(`cents is not an integer: ${cents}`)
  const negative = cents < 0
  const abs = BigInt(negative ? -cents : cents)
  const major = (abs / 100n).toLocaleString('en-US')
  const minor = String(abs % 100n).padStart(2, '0')
  return `${negative ? '-' : ''}$${major}.${minor} ${currency}`
}
