/**
 * Playwright config for EXPLORATORY runs — deliberately separate from the gate.
 *
 * `playwright.config.ts` points at `tests/acceptance/` and is a blocking CI job: a failure
 * there means a person can no longer start the game and take a turn. Exploratory sessions
 * are a different activity with a different failure meaning — they drive the real UI to
 * find out what happens, log heavily, and are expected to surface surprises rather than
 * pass cleanly.
 *
 * Keeping them in a separate directory and config is not tidiness. `init-agents` dropped a
 * seed test containing `// generate code here.` straight into `tests/acceptance/`, and
 * because `testMatch` is `*.spec.ts` it silently took the gate from 16 tests to 17 — an
 * always-passing empty test counted as coverage. Anything that can wander into the gating
 * directory will eventually inflate it, so exploration gets its own door.
 *
 * Run: `npx playwright test --config playwright.explore.config.ts`
 * Port defaults to 5300 (not the gate's 5173) so an exploratory run and an acceptance run
 * can never fight over a server — see the base config's note on why reusing one is unsafe.
 */

import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env['AIC_EXPLORE_PORT'] ?? 5300)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/exploratory',
  testMatch: /.*\.spec\.ts$/,
  // Exploration is for reading, so run it serially and never retry: a retry would
  // interleave two sessions' logs and make the transcript useless.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Generous: a session that plays dozens of turns is legitimately slow, and a timeout
  // here should mean "the app stopped responding", not "the game is long".
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    // Never reuse, for the reason the base config documents at length: a reused server can
    // be serving a DIFFERENT git worktree, and the run then reports on somebody else's code.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
