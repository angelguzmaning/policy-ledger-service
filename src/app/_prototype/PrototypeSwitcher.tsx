// PROTOTYPE — throwaway. Floating variant switcher. Hidden outside development builds.
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

export type VariantKey = 'A' | 'B' | 'C'

const VARIANTS: { key: VariantKey; name: string }[] = [
  { key: 'A', name: 'Split console' },
  { key: 'B', name: 'Card dashboard' },
  { key: 'C', name: 'Raw log / terminal' },
]

export function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const index = VARIANTS.findIndex((v) => v.key === current)
  const active = VARIANTS[index] ?? VARIANTS[0]!

  function go(nextIndex: number) {
    const wrapped = (nextIndex + VARIANTS.length) % VARIANTS.length
    const next = VARIANTS[wrapped]!
    const params = new URLSearchParams(searchParams.toString())
    params.set('variant', next.key)
    router.replace(`/?${params.toString()}`)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  if (process.env.NODE_ENV === 'production') return null

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-fuchsia-400 bg-black px-4 py-2 text-sm text-white shadow-lg shadow-fuchsia-500/30">
        <button
          type="button"
          onClick={() => go(index - 1)}
          className="rounded-full px-2 py-1 hover:bg-white/10"
          aria-label="Previous variant"
        >
          ←
        </button>
        <span className="font-mono">
          {active.key} — {active.name}
        </span>
        <button
          type="button"
          onClick={() => go(index + 1)}
          className="rounded-full px-2 py-1 hover:bg-white/10"
          aria-label="Next variant"
        >
          →
        </button>
      </div>
    </div>
  )
}
