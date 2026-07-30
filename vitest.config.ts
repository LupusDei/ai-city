import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Listing `include` explicitly makes untested source files count against the
      // thresholds. Without it a module with zero tests is simply invisible to
      // coverage, which would let untested code slip straight past the gate.
      // (Vitest 4 folded the old `all: true` flag into this behaviour.)
      include: ['src/**/*.ts'],
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
