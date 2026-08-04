import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // Resolves the `@/*` paths from tsconfig.json -- native in this Vite,
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
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/db.ts'],
          // One test file touches the database at a time.
          fileParallelism: false,
          // Explicit for the reader; false is already the default.
          sequence: { concurrent: false },
          testTimeout: 20_000,
          hookTimeout: 30_000,
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
