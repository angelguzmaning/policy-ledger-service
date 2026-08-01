import { PrototypeHome } from './_prototype/PrototypeHome'
import type { VariantKey } from './_prototype/PrototypeSwitcher'

function isVariantKey(value: string | undefined): value is VariantKey {
  return value === 'A' || value === 'B' || value === 'C'
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.variant
  const value = Array.isArray(raw) ? raw[0] : raw
  const variant: VariantKey = isVariantKey(value) ? value : 'A'
  return <PrototypeHome variant={variant} />
}
