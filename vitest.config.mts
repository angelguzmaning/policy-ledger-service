import { defineConfig } from 'vitest/config'

// The `integration` project — global setup, the dedicated test database,
// `fileParallelism: false` — lands with the persistence work; see
// docs/research/0003-pg-test-isolation-and-vitest-config.md.
export default defineConfig({
  test: {
    projects: [
      {
        // Resolves the `@/*` paths from tsconfig.json — native in this Vite,
        // which is why vite-tsconfig-paths is not a dependency. It belongs on
        // the project, not the root: a root config that declares `projects`
        // does not run tests itself and its `resolve` is not inherited.
        resolve: { tsconfigPaths: true },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/server/**'],
      exclude: ['src/server/**/*.test.ts', 'src/server/db/migrations/**'],
    },
  },
})
