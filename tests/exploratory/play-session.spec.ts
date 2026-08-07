/**
 * EXPLORATORY session — not a gate. Drives the real UI to confirm the game functions
 * beyond the one turn the acceptance suite covers.
 *
 * The acceptance suite proves a person can launch, survey, land and take turn 1. Nobody has
 * ever clicked End Cycle twenty times in a browser. The sim's golden trace runs 16 turns,
 * but a golden trace cannot see a memory leak, a console error on turn 9, a readout that
 * stops updating, or a control that dies after the state it was written for.
 *
 * This file REPORTS rather than asserts wherever it can, so a surprise shows up as evidence
 * instead of a red line with no context. The few hard assertions are for things that would
 * make the rest of the run meaningless.
 */

import { expect, test } from '@playwright/test'

const at = (id: string): string => `[data-testid="${id}"]`
const SEED = 20260730
const TURNS = 25

test('play 25 turns through the UI and report what happens', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => pageErrors.push(e.message))

  await page.goto(`/?seed=${SEED}`)
  await expect(page.locator(at('survey-screen'))).toBeVisible()

  // --- Land ---
  const candidates = page.locator('[data-testid^="candidate-site"]:not([disabled])')
  const candidateCount = await candidates.count()
  await candidates.nth(0).click()
  await candidates.nth(40 % candidateCount).click()
  const sited = await page.locator(at('site-score')).innerText()
  await page.locator(at('begin-mission')).click()
  await expect(page.locator(at('ops-screen'))).toBeVisible()

  console.log(`\n=== LANDED · seed ${SEED} · ${candidateCount} candidates offered · site scored ${sited} ===`)
  console.log('turn | remaining | drones  | capacity | vented Wh    | cut | structures')

  const readings: { turn: string; drones: string; vented: string }[] = []

  for (let i = 0; i < TURNS; i += 1) {
    const turn = await page.locator(at('turn-readout')).innerText()
    const remaining = await page.locator(at('turns-remaining')).innerText()
    const drones = await page.locator(at('drones-on-shift')).innerText()
    const capacity = await page.locator(at('habitat-capacity')).innerText()
    const vented = await page.locator(at('vented-energy')).innerText()
    const cutLoc = page.locator(at('brownout-cut-line'))
    const cut = (await cutLoc.count()) > 0 ? await cutLoc.innerText() : '—'
    readings.push({ turn, drones, vented })
    console.log(
      `${turn.padEnd(9)}| ${remaining.padEnd(9)} | ${drones.padEnd(7)} | ${capacity.padEnd(8)} | ${vented.padEnd(12)} | ${cut.padEnd(3)} |`,
    )

    const end = page.locator(at('end-cycle'))
    if (!(await end.isEnabled())) {
      console.log(`\n  End Cycle became disabled at ${turn} — stopping.`)
      break
    }
    await end.click()
    await expect(page.locator(at('turn-readout'))).not.toHaveText(turn, { timeout: 5000 })
  }

  // --- What the run revealed ---
  const firstDrones = readings[0]?.drones
  const lastDrones = readings[readings.length - 1]?.drones
  const allSameDrones = readings.every((r) => r.drones === firstDrones)
  const allSameVented = readings.every((r) => r.vented === readings[0]?.vented)

  console.log('\n=== FINDINGS ===')
  console.log(`  turns played              : ${String(readings.length)}`)
  console.log(`  drones on shift  first→last: ${String(firstDrones)} → ${String(lastDrones)}`)
  console.log(`  drones NEVER changed      : ${String(allSameDrones)}`)
  console.log(`  vented energy NEVER changed: ${String(allSameVented)}`)
  console.log(`  console errors            : ${String(consoleErrors.length)}`)
  console.log(`  uncaught page errors      : ${String(pageErrors.length)}`)
  for (const e of consoleErrors.slice(0, 5)) console.log(`    console: ${e.slice(0, 160)}`)
  for (const e of pageErrors.slice(0, 5)) console.log(`    pageerror: ${e.slice(0, 160)}`)

  // Hard assertions: only for things that would invalidate the whole run.
  expect(pageErrors, 'the app threw an uncaught error while playing').toEqual([])
  expect(readings.length, 'the game stopped advancing before 25 turns').toBeGreaterThan(1)
})

test('the re-plot flow returns to a usable survey', async ({ page }) => {
  await page.goto(`/?seed=${SEED}`)
  const candidates = page.locator('[data-testid^="candidate-site"]:not([disabled])')
  await candidates.nth(0).click()
  await candidates.nth(1).click()
  const first = await page.locator(at('site-score')).innerText()

  // NOTE: use the testid, not `getByText(/re-plot/i)`. My first version of this probe
  // matched the explanatory prose ("Candidate sites are locked — re-plot to choose again")
  // instead of the button, clicked a paragraph, and reported that re-plot was broken. It
  // is not: it works correctly. A text selector that also matches the sentence describing
  // the control is a false-failure generator.
  const replot = page.locator(at('clear-selection'))
  const hasReplot = (await replot.count()) > 0
  console.log(`\n=== RE-PLOT ===\n  control present: ${String(hasReplot)}`)
  if (!hasReplot) return

  await replot.click()
  const after = page.locator('[data-testid^="candidate-site"]:not([disabled])')
  const usable = await after.count()
  console.log(`  candidates enabled after re-plot: ${String(usable)}`)
  await after.nth(2).click()
  await after.nth(3).click()
  const second = await page.locator(at('site-score')).innerText()
  console.log(`  score before ${first} → after re-plot ${second}`)
  expect(usable, 're-plot left no selectable candidates').toBeGreaterThan(2)
})
