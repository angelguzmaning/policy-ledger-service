// Epoch-days, computed with pure integer arithmetic -- no `Date`, no clock, no
// timezone. See ADR-0001: a domain core that touches `Date` inherits the
// machine's timezone and DST, which breaks reproducibility of a proration
// computed years later on a different machine.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return lengths[month - 1]!
}

// Howard Hinnant's `days_from_civil` (public domain): converts a proleptic
// Gregorian calendar date to a day count relative to 1970-01-01, using only
// integer division and modulo -- no floating point, no `Date`.
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor((y >= 0 ? y : y - 399) / 400)
  const yoe = y - era * 400 // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1 // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy // [0, 146096]
  return era * 146097 + doe - 719468
}

/**
 * Parses a strict `YYYY-MM-DD` string into an integer epoch-day count.
 * Rejects malformed shapes, out-of-range months/days, and non-existent
 * calendar dates (`2026-02-30`). Never constructs a `Date`.
 */
export function parseDate(value: string): number {
  const match = DATE_RE.exec(value)
  if (!match) throw new Error(`not a valid YYYY-MM-DD date: ${value}`)
  const year = Number(match[1]!)
  const month = Number(match[2]!)
  const day = Number(match[3]!)

  if (month < 1 || month > 12) throw new Error(`month out of range: ${value}`)
  if (day < 1 || day > daysInMonth(year, month)) throw new Error(`day out of range: ${value}`)

  return daysFromCivil(year, month, day)
}
