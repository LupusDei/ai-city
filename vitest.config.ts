import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.test.ts` / `.test.tsx` here; the Playwright suite is `.spec.ts` and lives in
    // tests/acceptance. That naming split is load-bearing, not cosmetic: it is the only
    // reason the 812-test unit suite kept running while the acceptance spec sat in the
    // tree unable to resolve @playwright/test. Keep unit/integration on `.test.*` and
    // acceptance on `.spec.ts`.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**', 'tests/acceptance/**'],

    // The sim is headless by design and its tests must never need a DOM. Node stays the
    // default so that a sim test which accidentally depends on a browser global fails
    // instead of quietly passing. React component tests opt in per file with the
    // docblock `// @vitest-environment jsdom` (see tests/unit/app-shell.test.tsx) — an
    // explicit, visible, per-file choice rather than a blanket environment.
    environment: 'node',

    coverage: {
      provider: 'v8',
      // Listing `include` explicitly makes untested source files count against the
      // thresholds. Without it a module with zero tests is simply invisible to
      // coverage, which would let untested code slip straight past the gate.
      // (Vitest 4 folded the old `all: true` flag into this behaviour.)
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        // React components and the DOM entry point are covered by the Playwright
        // acceptance suite (`npm run test:acceptance`), which asserts what a player can
        // actually see and do — the thing unit coverage of a component provably does not
        // measure on this project (`aic-c1p`: 100% coverage over a screen fed by data
        // nothing produced). Line coverage of JSX would report a number, not a guarantee.
        //
        // NOTE THE PRECISION: only `.tsx` is excluded. Pure `.ts` logic under src/app/
        // — seed parsing, adapters, intent dispatch — stays fully inside the 80/70/60
        // gate, because that code is exactly the kind unit tests DO pin down. Do not
        // widen this to `src/app/**`.
        'src/app/**/*.tsx',
      ],
      reporter: ['text', 'html'],
      // Constitution §1: 80% lines, 70% branches, 60% functions. Blocking, not advisory.
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 60,
      },
    },
  },
})
