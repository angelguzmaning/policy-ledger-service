// `pnpm migrate` -- creates the app database off the admin connection if it
// doesn't exist yet, then runs the same migration runner the Vitest
// integration project's global-setup uses.

import { DATABASE_NAME, ensureDatabaseExists, migrate } from './lib/database'

async function main(): Promise<void> {
  if (await ensureDatabaseExists()) {
    console.log(`Created database "${DATABASE_NAME}".`)
  }

  const applied = await migrate()
  if (applied.length === 0) {
    console.log('No new migrations to apply.')
  } else {
    console.log(`Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
