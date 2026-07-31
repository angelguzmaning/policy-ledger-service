import { describe, expect, it } from 'vitest'
import { addCents } from '@/server/smoke'

// Placeholder proving the runner, the TS transform and the `@/` path alias all
// work. Delete it, and smoke.ts, once the first real domain test lands.
describe('toolchain', () => {
  it('runs a TypeScript test through the @/ alias', () => {
    expect(addCents(1_00, 2_50)).toBe(350)
  })
})
