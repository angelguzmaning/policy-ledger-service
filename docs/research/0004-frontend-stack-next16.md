# Research 0004 — shadcn on Base UI + TanStack Query + Zustand in Next 16 / React 19 / Tailwind v4

Resolves issue #16 (part of the map, #1). Sources are primary: the shadcn/ui docs source
(`shadcn-ui/ui` on `main`) and its live registry JSON, the published `components.json`
JSON Schema, the npm registry metadata for every package named, Base UI's own docs, the
TanStack Query docs on `main`, the Zustand docs, the Vitest docs on `main`, the Next.js
docs on `canary`, and the generated `typescript-eslint` config source. Verified
2026-08-01.

Locked context not revisited: TanStack Query for server state, Zustand (**provisional**)
for cross-component client state, shadcn/ui on Base UI primitives, Tailwind v4 — all from
the map's **Client stack** note, with its own standing caution that each must earn its
install. Repo state this is costed against: `next@16.2.12`, `react@19.2.4`,
`react-dom@19.2.4`, `tailwindcss@^4` + `@tailwindcss/postcss@^4` with **no**
`tailwind.config`, `vitest@^4.1.10` with a **Node-environment project only**, strict
`tsconfig` + `typescript-eslint` `recommendedTypeChecked`, Prettier `semi: false`,
`singleQuote: true`, `printWidth: 100`.

---

## Recommendation in one paragraph

**Install two things: `@tanstack/react-query@5.101.4` and the shadcn/Base UI component
set. Do not install Zustand.** Base UI is now the *default* shadcn primitive library
(since 2026-07-02), so the "experimental path" premise in the ticket is out of date — it
is the cheap path, and Radix is the one that now costs an extra flag. Wire TanStack Query
as a client-only provider with **no** `HydrationBoundary` and **no** server prefetch: all
this UI's data comes from our own route handlers on localhost, so streaming hydration buys
nothing and costs a second data path. Override three TanStack defaults or the live demo
will misbehave on camera. Add **no** second Vitest project — the frontend is not
unit-tested here, and that is a defensible position we state in the README rather than
leave unsaid. Budget **~75–85 minutes** for the full wiring; the **minimum viable subset
is TanStack Query alone**, at ~25 minutes, with shadcn as the first thing cut if the
timebox bites.

---

## Part 1 — shadcn on Base UI

### It is not experimental. It is the default.

The ticket asks whether the Base UI registry is "a first-class, documented shadcn path
today, or still experimental". It is neither experimental nor merely first-class — it is
the default, as of five weeks ago:

> "Starting today, **Base UI is the default component library in shadcn/ui**."
> — `apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx`, dated 2026-07-02

> "**New projects default to Base UI.** Run `npx shadcn init` and Base UI is the default
> pick." … "**The docs default to Base UI.** Component pages open on the Base UI tab.
> Radix docs are one click away."
> — same file

> "**Base UI is stable.** It's at 1.6.0 with 6M+ weekly downloads."
> — same file

Radix is explicitly not deprecated ("**Radix is not being deprecated.** We still support
it, and every update and new component will ship for both libraries"), but it is now the
opt-out: `npx shadcn init -b radix`.

**This inverts the ticket's cost question.** Base UI is not a detour off the paved road;
it *is* the paved road, and choosing Radix would mean typing an extra flag to land on the
non-default path whose docs are one click further away. There is no scenario in which
Radix is materially cheaper here — see "Would Radix be cheaper?" below.

### Package name — the one real trap

There are two Base UI packages on npm and only one of them is current:

| package | latest | published |
|---|---|---|
| `@base-ui-components/react` | `1.0.0-rc.0` | 2025-12-04 |
| `@base-ui/react` | **`1.6.0`** | 2026-06-18 |

The project renamed itself at 1.0; `@base-ui-components/react` is frozen at the release
candidate. Any snippet — from a model, a blog post, or a stale Stack Overflow answer —
that installs `@base-ui-components/react` is installing a nine-month-old RC. The shadcn
base registry imports from the new name; the live registry item for `button` reads:

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button"
```

— `https://ui.shadcn.com/r/styles/base-nova/button.json`

Peer deps of `@base-ui/react@1.6.0`: `react: ^17 || ^18 || ^19`,
`react-dom: ^17 || ^18 || ^19`, `@types/react` (optional). **React 19.2.4 is in range.**
Its five runtime deps are `@babel/runtime`, `@floating-ui/react-dom`, `@floating-ui/utils`,
`use-sync-external-store`, `@base-ui/utils` — no native modules, no install scripts.

### The exact invocation

```bash
pnpm dlx shadcn@latest init      # shadcn CLI 4.16.1, published 2026-07-31
pnpm dlx shadcn@latest add button card table input label badge
```

`init` "installs dependencies, adds the `cn` util and configures CSS variables for the
project" (`apps/v4/content/docs/(root)/cli.mdx`). The relevant flags:

```
-t, --template <template>  the template to use. (next, vite, start, react-router, laravel, astro)
-b, --base <base>          the component library to use. (base, radix, aria)
-p, --preset [name]        use a preset configuration
-d, --defaults             use default configuration: --template=next --preset=nova
```

So the non-interactive form for this repo is `pnpm dlx shadcn@latest init -t next -b base
-p nova -y`, which is exactly what `-d, --defaults` plus the new Base-UI default produces.

### `components.json` for **this** repo

The published schema (`https://ui.shadcn.com/schema.json`) enumerates `style` as a
`<base>-<preset>` cross product — `base-vega|nova|maia|lyra|mira|luma|sera|rhea`,
`radix-*`, `aria-*`, plus legacy `default`/`new-york`. `nova` is the CLI's default preset.
The required keys are `style`, `tailwind`, `rsc`, `aliases`; `tailwind` requires
`config`, `css`, `baseColor`, `cssVariables`.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks",
    "utils": "@/lib/utils"
  },
  "iconLibrary": "lucide"
}
```

**Nothing requires a `tailwind.config`.** The docs are unambiguous:

> "Path to where your `tailwind.config.js` file is located. **For Tailwind CSS v4, leave
> this blank.**"
> — `apps/v4/content/docs/(root)/components-json.mdx`

`"config": ""` satisfies the schema's `required` while adding no file. The repo's
deliberate absence of `tailwind.config` survives untouched, and `postcss.config.mjs` needs
no change — Tailwind v4's PostCSS plugin already resolves package-path `@import`s, which is
how the existing `@import 'tailwindcss'` works.

The repo's `tsconfig.json` already declares `"paths": { "@/*": ["./src/*"] }`, which is
exactly Option A in the manual-install doc. No tsconfig change.

### Which peer deps land

`init` resolves the style index, which declares its own dependency set:

```
dependencies:         class-variance-authority, lucide-react, @base-ui/react
registryDependencies: utils   →  clsx, tailwind-merge
```
— `https://ui.shadcn.com/r/styles/base-nova/index.json` and `/utils.json`

and the manual-installation doc names the full list including the two the style index
does not carry:

```bash
npm install shadcn class-variance-authority clsx tailwind-merge lucide-react tw-animate-css
```
— `apps/v4/content/docs/installation/manual.mdx`

`shadcn` itself lands as a project dependency, not just a `dlx` invocation, because the
generated `globals.css` starts with `@import "shadcn/tailwind.css"` — the package exports
`"./tailwind.css": "./dist/tailwind.css"` (verified against `shadcn@4.16.1`'s
`package.json` and the file's contents).

**Seven packages**, with weights:

| package | version | unpacked |
|---|---|---|
| `@base-ui/react` | 1.6.0 | 9.28 MB |
| `lucide-react` | 1.28.0 | **31.01 MB** |
| `shadcn` | 4.16.1 | 0.80 MB (32 transitive deps: `ts-morph`, `@babel/core`, `recast`, `undici`, …) |
| `tailwind-merge` | 3.6.0 | 1.01 MB |
| `tw-animate-css` | 1.4.0 | 0.05 MB |
| `class-variance-authority` | 0.7.1 | 0.02 MB |
| `clsx` | 2.1.1 | 0.01 MB |

`lucide-react` is by far the heaviest thing in the whole proposal and we will use roughly
three icons from it. It is tree-shaken at build so the bundle is fine; it is `node_modules`
and `pnpm install` wall-clock that pay. If the UI ends up needing zero icons, dropping
`lucide-react` and `iconLibrary` is a legitimate saving — but `init` installs it
unconditionally, so this is a post-hoc removal, not an avoidance.

**`pnpm-workspace.yaml` `allowBuilds` gate: verified clear.** Per #4, an unanswered build
script makes every pnpm script exit 1. None of the seven packages declares an
`install`/`preinstall`/`postinstall`/`prepare` lifecycle script (`@base-ui/react` and
`zustand` publish an empty `scripts` object outright; the others publish only `build`/
`test` scripts, which npm does not run on install). So `shadcn init` will not trip the
gate. This is worth re-checking if any component pulls a new dep later — `sonner` and
`next-themes` come in with the `sonner` component, for instance.

### What breaks under the strict toolchain

**`verbatimModuleSyntax` — the ticket's premise is wrong.** It is not in this repo's
`tsconfig.json`. The strict flags actually set are `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and
`isolatedModules`. Worth correcting on the map so #12 does not inherit a phantom
constraint. It would not have mattered anyway: shadcn already writes inline type modifiers
(`import { cva, type VariantProps } from "class-variance-authority"`), which is exactly
what `verbatimModuleSyntax` wants.

**Empirical check, not speculation.** I pulled the actual generated source for ten
`base-nova` items (`button`, `card`, `table`, `input`, `label`, `badge`, `dialog`,
`alert`, `skeleton`, `field`) from the live registry and grepped them:

- zero `any`
- zero `@ts-ignore` / `@ts-expect-error`
- zero non-null assertions (`!`)
- zero array indexing (so `noUncheckedIndexedAccess` has nothing to bite)
- props are typed as `Primitive.Props & VariantProps<typeof xVariants>`; `cva`'s
  `VariantProps` already admits `| null | undefined`, so `exactOptionalPropertyTypes` has
  nothing to reject

`recommendedTypeChecked`'s dangerous members for third-party-shaped code are
`no-explicit-any`, `no-unsafe-*` and `no-non-null-assertion`-adjacent rules; on this
sample they have nothing to fire on. **Expect the generated components to lint and
typecheck clean.** Do not pre-emptively add an ESLint override for
`src/components/ui/**` — keep that in your pocket as the 30-second fix if one component
surprises you, and be able to say in the walkthrough that you did not need it.

**Prettier will fight, in exactly one way.** shadcn's registry output uses **double
quotes**, **no semicolons**, and Prettier's default `printWidth` of 80. This repo is
`singleQuote: true`, `semi: false`, `printWidth: 100`. Semicolons agree; quotes and wrap
width do not. Concretely: `pnpm format:check` fails the moment you run `shadcn add`, on
2–5 import lines per file plus reflowed `cva` class strings.

The fix is `pnpm format` and it takes seconds. **Do not** add `src/components/ui` to
`.prettierignore` — the repo has one formatting story and a reviewer reading a diff should
not find a second one. The cost is that the generated files are no longer byte-identical to
upstream, which matters for `shadcn diff` and does not matter at all for a take-home.

**`'use client'`.** With `rsc: true` the CLI marks client components. Of the ten sampled,
`table`, `label`, `dialog` and `sonner` carry `'use client'`; `button`, `card`, `input`,
`badge`, `alert`, `skeleton` do not, because they render Base UI primitives that ship their
own `'use client'` (verified: `@base-ui/react@1.6.0/button/Button.js` opens with
`'use client'`). Nothing for us to add.

**One layout change Base UI does require:**

> "Base UI requires adding `isolation: isolate;` to your application layout root element to
> ensure portaled components appear above page content."
> — <https://base-ui.com/react/overview/quick-start>

One CSS declaration in `globals.css` or on the root element in `src/app/layout.tsx`. Only
matters if we use a portaled component (dialog, popover, tooltip); add it anyway, it is
free.

**The globals.css merge is the real time sink.** `init` rewrites `src/app/globals.css` with
`@import "tailwindcss"; @import "tw-animate-css"; @import "shadcn/tailwind.css";`, a
`@custom-variant dark`, a ~45-line `@theme inline` block and two ~30-line `:root` / `.dark`
oklch token blocks. The repo's current `globals.css` has its own hand-written
`:root` / `@theme inline` / `prefers-color-scheme` block and a `body` rule with
`font-family: Arial`. These overlap and must be reconciled by hand. Budget most of the
shadcn setup time here.

### Would the Radix registry be materially cheaper?

No, and it is now slightly more expensive.

- **Install count is worse.** Base UI is a single package (`@base-ui/react`, "All
  components come in a single package and are tree-shakable"). The Radix registry pulls a
  separate `@radix-ui/react-*` package per primitive, so a six-component UI is six installs
  instead of one.
- **It is off the default path.** `init` would need `-b radix`, and the docs open on the
  Base UI tab.
- **Nothing we need is Radix-only.** The July changelog states every update ships for both
  libraries "unless a component only exists in Base UI" — the exclusivity runs the other
  way.

Base UI's 9.28 MB unpacked is the one number in Radix's favour, and it is `node_modules`
weight, not bundle weight. Not a reason.

### Cost

| | |
|---|---|
| installs | **7** (all runtime deps) |
| new files | `components.json`, `src/lib/utils.ts`, `src/components/ui/*.tsx` |
| files modified | `src/app/globals.css` (substantially), `src/app/layout.tsx` (one `isolation` rule), `package.json`, `pnpm-lock.yaml` |
| files **not** touched | `tsconfig.json`, `postcss.config.mjs`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `.prettierrc.json` |
| minutes | **20–25** for `init` + globals.css reconciliation + `pnpm format`; **~1–2 min** per `add` thereafter |

---

## Part 2 — TanStack Query in the Next 16 App Router

### Version and React 19

`@tanstack/react-query@5.101.4` (published 2026-07-21) is the current stable major; npm
`dist-tags` show `latest: 5.101.4` with no 6.x line. Its peer range is
**`react: ^18 || ^19`** — React 19.2.4 is supported, first-class, no override needed. Zero
transitive deps beyond `@tanstack/query-core@5.101.4`, 0.86 MB unpacked. The optional
`@tanstack/react-query-devtools@5.101.4` peers `@tanstack/react-query: ^5.101.4`.

### Provider: neither a module singleton nor `useState`

The docs are explicit that a bare module-level client is a data-leak bug:

> "// NEVER DO THIS: `const queryClient = new QueryClient()` — Creating the queryClient at
> the file root level makes the cache shared between all requests and means _all_ data gets
> passed to _all_ users. Besides being bad for performance, this also leaks any sensitive
> data."
> — `docs/framework/react/guides/ssr.md`

The App Router shape is a per-environment factory, not `useState`:

```tsx
// src/app/providers.tsx
'use client'

import { environmentManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 60 * 1000 } } })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (environmentManager.isServer()) {
    return makeQueryClient()           // server: always a fresh client
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient            // browser: one singleton
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```
— `docs/framework/react/guides/advanced-ssr.md`

Two things to be able to say out loud:

- **`'use client'` goes on `providers.tsx`, not on `layout.tsx`.** "Since
  `QueryClientProvider` relies on `useContext` under the hood, we have to put `'use client'`
  on top" (same doc). `layout.tsx` stays a Server Component and simply renders
  `<Providers>{children}</Providers>`.
- **Why not `useState`?** The docs warn: "Avoid `useState` when initializing the query
  client if you don't have a suspense boundary between this and the code that may suspend
  because React will throw away the client on the initial render if it suspends and there is
  no boundary." The browser-singleton guard exists for the same reason.

Note `environmentManager.isServer()` is the current form; `isServer` is still exported from
`@tanstack/query-core@5.101.4` (both symbols verified in the shipped `.d.ts`), so older
snippets using `import { isServer }` still compile — but write the documented form.

### Streaming / prefetch hydration: skip it

`HydrationBoundary` + `dehydrate` + `prefetchQuery` in a Server Component is real and well
documented, and it is not worth its keep here:

- Every one of this UI's queries hits **our own route handlers on `localhost`**. The
  latency the hydration APIs exist to remove is already ~0.
- Prefetching creates a **second data path**: the Server Component would call the service
  layer (or `fetch` its own route handler), and the client hook would call the route
  handler. Two ways to load the same data is exactly the kind of thing a line-by-line
  defense punishes.
- Streaming pending queries requires the extra `dehydrate.shouldDehydrateQuery` +
  `shouldRedactErrors` config from `advanced-ssr.md` — more surface, more to explain, zero
  observable benefit on a demo machine.
- The brief asks the frontend to demonstrate *consumption of the API*. Client-side
  `useQuery` against our documented endpoints demonstrates that more legibly than
  server-prefetched data that appears without a visible request.

**Decision: client-only. `QueryClientProvider` in the root layout, `useQuery`/`useMutation`
in client components, no `HydrationBoundary`, no `prefetchQuery`, no `initialData`.** If a
reviewer asks "why no SSR prefetch", the answer is the second-data-path argument, and it is
a better answer than having built it.

### Defaults that will misbehave on camera

From `docs/framework/react/guides/important-defaults.md`:

| default | doc text | why it bites the demo |
|---|---|---|
| `staleTime: 0` | "Query instances via `useQuery` … by default **consider cached data as stale**" | every remount refetches; navigating back and forth flashes loading states |
| `refetchOnWindowFocus: true` | "Stale queries are refetched automatically in the background when: … The window is refocused" | **the video killer.** Alt-tab to your notes and back, or click into the browser from the recording toolbar, and every visible query refetches |
| `retry: 3` + exponential backoff | "Queries that fail are **silently retried 3 times, with exponential backoff delay** before capturing and displaying an error to the UI" | **the failure-demo killer.** The deliberate wrong-currency 422 walkthrough will hang for seconds behind three silent retries before the error renders |
| `gcTime: 5 min` | "'inactive' queries are garbage collected after **5 minutes**" | harmless here |

Set all three explicitly, in `makeQueryClient()`, with a comment saying why:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // The demo is recorded; a background refetch on alt-tab looks like a bug.
      refetchOnWindowFocus: false,
      // Our errors are deterministic domain rejections (422 OutOfTerm, wrong currency),
      // not flaky network. Retrying them three times only delays the truth.
      retry: false,
    },
    mutations: { retry: false },
  },
})
```

`retry: false` is the one to be ready to defend, and the defense is strong: retrying a
`422` is meaningless, and #7 already establishes that a rejected request rolls back
entirely and frees its idempotency key, so a retry is not even harmful — just slow and
confusing on screen.

### The type-aware-lint landmine (this is where our code, not shadcn's, gets bitten)

`typescript-eslint`'s `recommendedTypeChecked` — which #4 turned on — includes
`@typescript-eslint/no-floating-promises: 'error'` and
`@typescript-eslint/no-misused-promises: 'error'` (verified in
`packages/eslint-plugin/src/configs/flat/recommended-type-checked.ts`). Both fire on
idiomatic-looking Query code:

- `onSubmit={async (e) => { await mutateAsync(...) }}` → **`no-misused-promises`**
  (`checksVoidReturn` defaults on; `onSubmit` expects `void`).
  *Fix, which is also the TanStack-idiomatic form:* a non-`async` handler that calls
  `mutate(...)`, which returns `void`.
- `onSuccess: () => { queryClient.invalidateQueries({ queryKey: [...] }) }` →
  **`no-floating-promises`** (`invalidateQueries` returns a `Promise`).
  *Fix:* drop the braces — `onSuccess: () => queryClient.invalidateQueries({ ... })` — or
  prefix with `void`.

Neither costs more than a minute once you know. Knowing costs ten minutes of confusion at
the worst possible moment, which is why it is written down here.

### Cost

| | |
|---|---|
| installs | **1** (`@tanstack/react-query`), +1 optional (`@tanstack/react-query-devtools` — skip it; it is a visible dev overlay in the video) |
| new files | `src/app/providers.tsx` |
| files modified | `src/app/layout.tsx`, `package.json`, `pnpm-lock.yaml` |
| files **not** touched | everything else |
| minutes | **~15** for the provider; **~20** more for the first real `useQuery` + `useMutation` pair including the lint gotchas above |

---

## Part 3 — Zustand: drop it

### The facts, so the drop is informed rather than lazy

`zustand@5.0.14` (published 2026-05-28). Zero runtime dependencies, 0.10 MB unpacked, no
install scripts. Every peer is optional (`peerDependenciesMeta` marks `react`,
`@types/react`, `immer` and `use-sync-external-store` all `optional: true`), with
`react: >=18.0.0`. **React 19.2.4 and the Next 16 App Router are fully supported.** It is
the cheapest of the three installs by a wide margin. This is not a compatibility rejection.

### The SSR caveat, stated plainly

Zustand's own Next.js guide:

> "Because the store should not be shared across requests, it should not be defined as a
> global variable. Instead, the store should be created per request using a store factory
> function. Additionally, React Server Components should not read from or write to the
> store, as RSCs cannot use hooks or context and aren't meant to be stateful. Having an RSC
> read from or write values to a global store violates the architecture of Next.js."
> — <https://zustand.docs.pmnd.rs/guides/nextjs>

> "Next.js applications are rendered twice: first on the server and again on the client.
> Having different outputs on both the client and the server will result in hydration
> errors."
> — same page

The correct shape is therefore **not** `create(...)` at module scope. It is
`createStore` from `zustand/vanilla` in a factory, a `createContext` holding the store API,
a `'use client'` provider doing `useState(() => createXStore())`, a `useXStore` selector
hook that throws when used outside the provider, and the provider mounted in
`layout.tsx` — roughly 60 lines across two new files, plus a second provider nested inside
the TanStack one in the root layout.

That is the honest price: **not one install, but a second provider tree and a
store-per-request ceremony**, in a UI whose entire job is to show a few tables and submit
two forms.

### There is no client state left for it to hold

Walk the state this UI actually has, against decisions already locked:

| state | who owns it | needs Zustand? |
|---|---|---|
| policy, ledger, documents, history — everything fetched | TanStack Query cache, keyed and invalidated after mutation | no |
| in-flight / error / success for endorsement + payment submission | `useMutation`'s own `isPending` / `error` / `data` | no |
| the idempotency key for a form | #7 locks this at `useState(() => crypto.randomUUID())` **at form mount** — deliberately component-scoped, because a key minted anywhere else defeats the point | no, and moving it to a store would be *wrong* |
| form field values | `useState`, or an uncontrolled form | no |
| which policy is selected | the URL, via the App Router route param `[policyId]` | no |
| a toast / banner after a mutation | `useMutation`'s callbacks, or `sonner` if it earns its own install | no |

The map's own standing caution anticipated this: "if [#12] finds no client state that
outlives a single component (TanStack Query owning server state usually leaves very
little), it should say so and drop the dependency rather than manufacture a store."

**This note says so.** Recommendation: **do not install Zustand.** If #12 later discovers
genuine cross-component client state, the escalation ladder is `useState` + props →
`useContext` with `useState` → *then* Zustand — and the first two rungs cost zero installs
and zero explanation.

### The `/zustand` skill's LobeHub conventions: overkill, and actively harmful here

The `/zustand` skill documents LobeHub's store architecture: `createXxxSlice` slice
composition via `flattenActions`, a three-layer public / `internal_*` / `internal_dispatch*`
action split, `messagesMap`/`topicsMap` reducers, class-based `XxxActionImpl` migrations,
and an optimistic-update pattern.

Those conventions solve a real problem — a chat application with hundreds of actions across
a dozen domains, where a flat store becomes unnavigable and optimistic updates need a
disciplined rollback path. **This repo has, at most, zero stores.** Adopting a three-layer
action taxonomy for a store that does not exist is not merely overkill; it is the exact
failure mode the map's standing constraint names ("prefer the boring, explainable option
over the clever one"). A reviewer asking "why is there an `internal_dispatch` layer here?"
has no good answer.

If a store somehow becomes necessary, the right reference is Zustand's own Next.js guide
above — one factory, one provider, one selector hook — not the LobeHub skill.

### Cost

**Zero, because we are not paying it.** For the record, had we: 1 install, 2 new files
(`src/stores/*.ts`, `src/providers/*-store-provider.tsx`), 1 modified (`layout.tsx`),
~15 minutes.

---

## Part 4 — Testing impact

### Where Vitest stands today

`vitest.config.mts` declares exactly one project: `unit`, `environment: 'node'`,
`include: ['src/**/*.test.ts']` — note **`.ts`, not `.tsx`**, so component tests would not
even be collected today. Per #4 there is no `vite-tsconfig-paths` (this Vite resolves
tsconfig paths natively via `resolve: { tsconfigPaths: true }`), and that `resolve` sits on
the **project**, not the config root.

### What a second, DOM-capable project costs

Next.js's own guide names the dependency set:

> `pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom`
> — `docs/01-app/02-guides/testing/vitest.mdx` (Manual Setup)

Against this repo that is **four new dev dependencies** (`vitest` is already present, and
`vite-tsconfig-paths` is not needed here):

| package | version | unpacked | note |
|---|---|---|---|
| `jsdom` | 30.0.1 | 7.09 MB | 21 transitive deps |
| `@vitejs/plugin-react` | 6.0.5 | 0.04 MB | **peer `vite: ^8.0.0`** |
| `@testing-library/react` | 16.3.2 | 0.34 MB | peers `react: ^18 \|\| ^19` — fine |
| `@testing-library/dom` | 10.4.1 | 0.28 MB | required peer of the above |

Plus almost certainly `@testing-library/jest-dom` for `toBeInTheDocument`, making it five.

**The one compatibility question resolves in our favour.** `@vitejs/plugin-react@6.x`
narrowed its peer range to `vite: ^8.0.0` at 6.0.0 (2026-03-12); 5.2.0 was the last version
accepting Vite 7. `vitest@4.1.10` declares `vite: ^6.0.0 || ^7.0.0 || ^8.0.0` and this
repo's `pnpm-lock.yaml` has already resolved **`vite@8.2.0`**. So `@vitejs/plugin-react@6.0.5`
installs cleanly with no peer warning and no override. Good to know; not a reason to do it.

The config change would be a second entry in `projects`, remembering the #4 lesson that
`resolve` does not inherit from the root:

```ts
{
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    name: 'component',
    environment: 'jsdom',
    include: ['src/components/**/*.test.tsx', 'src/app/**/*.test.tsx'],
    setupFiles: ['./test/setup-dom.ts'],
  },
}
```

Vitest's `environment` accepts `'jsdom'` directly (`docs/config/environment.md`), so this is
mechanically small — the cost is the installs, the setup file, and the first test's worth of
learning where React Testing Library and a `QueryClientProvider` wrapper meet.

**Browser mode is not the answer.** Vitest 4 requires a provider package —
`@vitest/browser-playwright` (recommended), `@vitest/browser-webdriverio`, or
`@vitest/browser-preview` — and the docs warn that `preview` "relies on simulating events"
and that "to run tests in CI you need to install either `playwright` or `webdriverio`"
(`docs/guide/browser/index.md`). That means `playwright@1.62.1` plus a browser binary
download in CI. Reject outright: the map's standing constraint is that anything costing
reviewer setup friction must earn it, and this earns nothing.

### The argument that closes it: coverage does not count these tests

`vitest.config.mts` sets `coverage.include: ['src/server/**']`. Frontend tests therefore
contribute **nothing** to the coverage number, which is the scored artifact. To make them
count you would have to widen `include` to `src/**` — which would immediately *lower* the
reported percentage by dragging in every untested page, layout and generated
`src/components/ui/*.tsx` file. **Adding frontend unit tests strictly cannot improve the
coverage signal and can only harm it.** That is not rhetoric; it falls out of the config #4
already merged.

### The defensible position, and how to state it

Yes, there is a defensible position, and it is strong:

1. **The brief's five named test areas are all backend** — proration, duplicate delivery,
   wrong-currency failure, balanced ledger writes, history verification. Not one is a
   rendering concern.
2. **The brief scores the UI on demonstrating API consumption, not on polish** (map, Out of
   scope: "A design system or polished frontend experience").
3. **Next.js's own guide caveats the technique**: "Since `async` Server Components are new
   to the React ecosystem, Vitest currently does not support them. While you can still run
   **unit tests** for synchronous Server and Client Components, we recommend using **E2E
   tests** for `async` components." Half our page tree is Server Components.
4. **Time is the scarce resource.** ~30–40 minutes for five installs, a new project, a DOM
   setup file and one trivial `expect(screen.getByRole('heading'))` — spent on the 10% of the
   brief that is not scored, taken from the 90% that is.

The mistake would be leaving this **unsaid**, which reads as an oversight. Say it, in one
line in the README's testing section:

> Tests cover the domain core and the persistence/API layer. The operator UI is deliberately
> not unit-tested: all five test areas the brief names are backend, coverage is scoped to
> `src/server/**`, and the UI's job here is to demonstrate API consumption, which the
> integration tests already assert against directly.

A reviewer who reads that sees a decision. A reviewer who finds silence sees a gap.

### Cost

| | |
|---|---|
| installs | **0** (recommended) — or **5** and ~7.7 MB if overruled |
| config files | **0** (recommended) — or `vitest.config.mts` + a new `test/setup-dom.ts` |
| minutes | **0** (recommended) — or **30–40**, for zero coverage benefit |

---

## Part 5 — Bottom line

### The full recommended stack

| piece | installs | new files | modified files | minutes |
|---|---|---|---|---|
| shadcn + Base UI (`init` + 6 components) | 7 | `components.json`, `src/lib/utils.ts`, `src/components/ui/*.tsx` | `src/app/globals.css`, `src/app/layout.tsx`, `package.json`, lockfile | **20–25** + ~1–2/component |
| TanStack Query | 1 | `src/app/providers.tsx` | `src/app/layout.tsx`, `package.json`, lockfile | **15** |
| first `useQuery` + `useMutation` hook pair | 0 | `src/hooks/*.ts` (or colocated) | — | **20** |
| Prettier / lint reconciliation after `add` | 0 | — | generated components (reformatted) | **10** |
| Zustand | **0 — dropped** | — | — | 0 |
| second Vitest project | **0 — dropped** | — | — | 0 |
| **total** | **8** | 4 + N components | 4 | **≈75–85** |

Config files **not** touched by any of this: `tsconfig.json`, `eslint.config.mjs`,
`postcss.config.mjs`, `next.config.ts`, `vitest.config.mts`, `.prettierrc.json`,
`pnpm-workspace.yaml`. That is the strongest single fact in this note — the toolchain #4
merged absorbs the entire client stack without a line of change.

**~80 minutes is over 20% of a 6-hour timebox for the 10% of the brief that is explicitly
unscored on polish.** That is the finding, and it should be read as a warning even though
the recommendation is to proceed.

### Minimum viable subset, if the timebox gets tight

**Ship TanStack Query. Ship nothing else.** ≈25 minutes: one install, one
`src/app/providers.tsx`, one `layout.tsx` edit, three overridden defaults, and the query
and mutation hooks the pages need. Style with the Tailwind v4 that is **already installed
and already configured**, on plain semantic HTML — `<table>`, `<form>`, `<button>`,
`<dl>` — which also hands you the `/web-design-guidelines` accessibility floor for free,
because native elements are accessible before you touch them.

The reasoning, in the form it would be defended live: the brief asks the frontend to
demonstrate that the API is consumable. **TanStack Query is the part that demonstrates
that** — the refetch-after-mutation, the in-flight state, the error state, the query keys
that make the endpoint surface legible in the source. shadcn demonstrates that you can run
a CLI. If exactly one of them survives the timebox, it is not close.

Order of sacrifice, in the order things get cut:

1. **Zustand — never installed.** Not a sacrifice; the map's own provisional caveat
   discharged.
2. **The second Vitest project — never installed.** Replaced by one honest sentence in the
   README.
3. **shadcn/Base UI — the first real cut.** It is the largest install (7 packages, ~42 MB
   unpacked), the only one that rewrites an existing file (`globals.css`), and the only one
   that fights Prettier. Its entire contribution is that the UI looks nicer, and looks are
   out of scope by the map's own words.
4. **TanStack Query — never cut.** It *is* the frontend story.

### Flag for the map

Three things #12 and #17 should absorb:

- **The map's `verbatimModuleSyntax` premise (via #16's body) is not real.** It is not in
  `tsconfig.json`. No decision depended on it, but the phantom constraint should not
  propagate.
- **"shadcn/ui on the Base UI primitives" is now simply "shadcn/ui defaults".** The locked
  decision was made when Base UI was a choice; as of 2026-07-02 it is the default and Radix
  is the flagged opt-out. The decision is unchanged in substance and cheaper than recorded.
- **This note recommends dropping Zustand, and puts shadcn third in the order of
  sacrifice.** Dropping Zustand is *sanctioned* by the map's own standing caution and is
  not an overturn. Ranking shadcn as cuttable is a genuine tension with the locked "Client
  stack" note — it is offered as input to #12, which the map says "owns the final call on
  how much of this stack is actually wired", not as a unilateral reversal.

---

## Feeds

- **#12 minimal operator UI scope** — owns the final call. Inherits: Zustand dropped, the
  MVS ladder above, the ~80-minute full-wiring estimate, and the component list to `add`.
- **#17 spec/diagram authoring** — the `components.json` block, the provider snippet, the
  three overridden TanStack defaults, and the README testing sentence are all copy-ready.
- **#11 test plan and CI** — no change. No new Vitest project, no new dev dependency, no CI
  step. `coverage.include: ['src/server/**']` stays as merged.
- **#7 idempotency** — reconfirmed: the key is minted at form mount with
  `useState(() => crypto.randomUUID())`, in the component, *not* in a store. That decision
  is a large part of why Zustand has nothing to hold.
- **#4 toolchain** — no config change required by any of this. Watch two things after
  `shadcn add`: `pnpm format:check` will fail on quote style until `pnpm format` runs, and
  any newly-pulled dependency with an install script will trip the `pnpm-workspace.yaml`
  `allowBuilds` gate and exit 1 (none of the seven current ones do).

## Sources

- shadcn/ui docs source, `shadcn-ui/ui` on `main` —
  `apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx` (dated 2026-07-02),
  `apps/v4/content/docs/changelog/2026-01-base-ui.mdx`,
  `apps/v4/content/docs/(root)/cli.mdx`,
  `apps/v4/content/docs/(root)/components-json.mdx`,
  `apps/v4/content/docs/installation/manual.mdx`,
  `apps/v4/content/docs/installation/next.mdx` —
  <https://github.com/shadcn-ui/ui/tree/main/apps/v4/content/docs>
- shadcn `components.json` JSON Schema (the authority on the `style` enum) —
  <https://ui.shadcn.com/schema.json>
- shadcn live registry items (the authority on what the CLI actually writes) —
  `https://ui.shadcn.com/r/styles/base-nova/index.json`, `/utils.json`, `/button.json`,
  `/card.json`, `/table.json`, `/input.json`, `/label.json`, `/badge.json`,
  `/dialog.json`, `/alert.json`, `/skeleton.json`, `/field.json`
- Base UI — <https://base-ui.com/react/overview/quick-start>; package
  `@base-ui/react@1.6.0` (2026-06-18) vs the superseded `@base-ui-components/react@1.0.0-rc.0`
  (2025-12-04); `'use client'` verified in the shipped
  `@base-ui/react@1.6.0/button/Button.js`
- TanStack Query docs on `main` — `docs/framework/react/guides/ssr.md`,
  `docs/framework/react/guides/advanced-ssr.md`,
  `docs/framework/react/guides/important-defaults.md` —
  <https://github.com/TanStack/query/tree/main/docs>; `environmentManager` and `isServer`
  both verified exported from `@tanstack/query-core@5.101.4`
- Zustand — "Setup with Next.js" (General Recommendations, SSR and Hydration) —
  <https://zustand.docs.pmnd.rs/guides/nextjs>
- Vitest docs on `main` — `docs/config/environment.md`, `docs/guide/browser/index.md` —
  <https://github.com/vitest-dev/vitest/tree/main/docs>
- Next.js docs on `canary` — `docs/01-app/02-guides/testing/vitest.mdx` —
  <https://github.com/vercel/next.js/tree/canary/docs>
- typescript-eslint generated config (rule membership of `recommendedTypeChecked`) —
  `packages/eslint-plugin/src/configs/flat/recommended-type-checked.ts` —
  <https://github.com/typescript-eslint/typescript-eslint>
- npm registry metadata (versions, publish dates, peer deps, lifecycle scripts, unpacked
  sizes) for `shadcn@4.16.1`, `@base-ui/react@1.6.0`, `@base-ui-components/react@1.0.0-rc.0`,
  `@tanstack/react-query@5.101.4`, `@tanstack/react-query-devtools@5.101.4`,
  `zustand@5.0.14`, `lucide-react@1.28.0`, `class-variance-authority@0.7.1`, `clsx@2.1.1`,
  `tailwind-merge@3.6.0`, `tw-animate-css@1.4.0`, `jsdom@30.0.1`,
  `@vitejs/plugin-react@6.0.5` (and the 5.2.0 → 6.0.0 peer-range narrowing),
  `@testing-library/react@16.3.2`, `@testing-library/dom@10.4.1`, `playwright@1.62.1`,
  `vite@8.2.0`, `vitest@4.1.10` — <https://registry.npmjs.org/>
- Repo state as read: `package.json`, `pnpm-lock.yaml` (resolved `vite@8.2.0`),
  `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `postcss.config.mjs`,
  `.prettierrc.json`, `pnpm-workspace.yaml`, `src/app/globals.css`
