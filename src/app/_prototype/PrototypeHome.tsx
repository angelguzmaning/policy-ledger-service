// PROTOTYPE — throwaway. Mounts the variant switcher on the real `/` route (ticket #12
// decided this is the operator UI's permanent home — single page, no policy picker).
'use client'

import { PrototypeSwitcher, type VariantKey } from './PrototypeSwitcher'
import { VariantA } from './VariantA'
import { VariantB } from './VariantB'
import { VariantC } from './VariantC'

export function PrototypeHome({ variant }: { variant: VariantKey }) {
  return (
    <div className="flex flex-1 flex-col">
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      <PrototypeSwitcher current={variant} />
    </div>
  )
}
