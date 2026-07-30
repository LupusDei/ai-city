import { defineConfig, devices } from '@playwright/test'

/**
 * Acceptance harness (`aic-8tl.7`, spec 005 NFR-001).
 *
 * WHY THIS EXISTS AT ALL. Every defect this project has shipped passed its unit tests —
 * `aic-c1p`, `aic-8eq` and `aic-ck0` were all fully covered modules that were not wired
 * to anything. No unit test can answer "can a person start this game and take a turn";
 * only a real browser against a real server can. `tests/acceptance/playable-start.spec.ts`
 * is that answer, and it was written BEFORE the app so it fails for the right reason first.
 *
 * EXPECTED STATE TODAY: most of this suite FAILS, because the survey screen, the
 * sim/UI adapter and the landing bridge do not exist yet (`aic-8tl.1`-`.5`, `aic-hfb`).
 * That is the point. Nothing in this config may be relaxed to make the run look green —
 * the failures are the work queue.
 */

const PORT = 5173
const BASE_URL = `http://localhost:${PORT}`

/** GitHub Actions and most CI providers set this; used only to tighten behaviour. */
const isCI = process.env.CI !== undefined && process.env.CI !== ''

export default defineConfig({
  testDir: './tests/acceptance',

  // `.spec.ts` here, `.test.ts` for Vitest. The two runners must never collect each
  // other's files: Vitest cannot drive a browser and Playwright cannot see the sim's
  // node-environment suite.
  testMatch: /.*\.spec\.ts$/,

  fullyParallel: true,

  // A committed `test.only` would silently shrink the definition of done in CI.
  forbidOnly: isCI,

  // No retries. While the screens are being built the failures are real and expected, so
  // retrying only triples the runtime; once the suite is green, a retry would mask
  // exactly the flakiness this project cannot afford in a determinism check (AC-4.3).
  retries: 0,

  // In CI: `github` annotates the failing lines in the PR diff, `list` keeps the raw
  // pass/fail readable in the log, and `html` produces the playwright-report/ directory
  // the workflow uploads as an artifact. Locally, just the list — an auto-opening HTML
  // report in the middle of a `verify` loop is a nuisance.
  reporter: isCI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    // Traces on failure are the fastest way for the screen implementers to see how far
    // the flow got. They land in test-results/, which is gitignored.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    // Locally, reuse a dev server the developer already has open; in CI always start a
    // clean one so a stale process cannot serve a stale bundle.
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
