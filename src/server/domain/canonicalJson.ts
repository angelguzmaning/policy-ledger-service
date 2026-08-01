// Shared canonicalizer -- one primitive, two jobs: the hash-chain preimage
// (ADR-0005) and the idempotency request fingerprint (ADR-0003). Sorted keys,
// no whitespace, bare integers, `JSON.stringify` string escaping. The throw
// is the guarantee: a float, NaN, Infinity, -0, or any unsupported type
// cannot be hashed -- not "we hope it doesn't happen."
//
// Accepts: string | safe-integer number | boolean | null | plain object | array.

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Object.is(value, -0)) throw new Error('unserializable value in canonical payload: -0')
    if (!Number.isSafeInteger(value)) {
      throw new Error(`unserializable value in canonical payload: ${String(value)}`)
    }
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  throw new Error('unserializable value in canonical payload')
}
