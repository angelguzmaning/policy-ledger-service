import { describe, expect, it } from 'vitest'
import { canonicalJson } from '@/server/domain/canonicalJson'

describe('canonicalJson', () => {
  it('case 1 -- emits keys in sorted order regardless of insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}')
  })

  it('case 2 -- sorts nested objects recursively, not just shallowly', () => {
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 1 })).toBe('{"a":1,"z":{"c":2,"d":1}}')
  })

  it('case 3 -- preserves array order: position is meaning in an array', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('case 4 -- no whitespace anywhere', () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).not.toMatch(/\s/)
  })

  it('case 5 -- string escaping matches JSON.stringify', () => {
    const value = 'quote " backslash \\ tab \t emoji 🎉 ñ'
    expect(canonicalJson(value)).toBe(JSON.stringify(value))
  })

  it('case 6 -- throws on a float', () => {
    expect(() => canonicalJson(1.5)).toThrow()
  })

  it('case 7 -- throws on NaN, Infinity, and -0 individually', () => {
    expect(() => canonicalJson(NaN)).toThrow()
    expect(() => canonicalJson(Infinity)).toThrow()
    expect(() => canonicalJson(-Infinity)).toThrow()
    expect(() => canonicalJson(-0)).toThrow()
  })

  it('case 8 -- throws on undefined, a Date, and a class instance', () => {
    expect(() => canonicalJson(undefined)).toThrow()
    expect(() => canonicalJson(new Date())).toThrow()
    class Foo {}
    expect(() => canonicalJson(new Foo())).toThrow()
  })

  it('case 9 -- throws on an integer beyond Number.MAX_SAFE_INTEGER', () => {
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER)).not.toThrow()
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 2)).toThrow()
  })

  it('accepts the six legal types, including null and booleans', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(false)).toBe('false')
    expect(canonicalJson(0)).toBe('0')
    expect(canonicalJson('x')).toBe('"x"')
    expect(canonicalJson([])).toBe('[]')
    expect(canonicalJson({})).toBe('{}')
  })
})
