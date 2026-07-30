/**
 * ACCEPTANCE SUITE — "run the game, start it, select a landing site, begin my first turn."
 *
 * This file is the DEFINITION OF DONE for specs/005-playable-start, and it is written
 * BEFORE the app exists so it fails for the right reason first.
 *
 * WHY BROWSER-LEVEL. Every defect this project has shipped passed its unit tests.
 * `aic-c1p`: two beads closed green at 100% coverage while 35% of the landing score ran on
 * data nothing produced. `aic-8eq`: ten modules, 100% coverage, could not run a turn.
 * `aic-ck0`: a module orphaned one commit after that was fixed. A unit test cannot answer
 * "can a person start this game and take a turn." Only this can.
 *
 * THE THREE LOAD-BEARING TESTS are marked ★. They assert data FLOWS rather than that a
 * screen RENDERS, which is the distinction every one of those three defects turned on.
 * ★ AC-2.2 would catch a constant score. ★ AC-3.2 would catch a bridge that silently
 * re-rolls the world — the aic-c1p failure, one layer up. ★ AC-4.3 would catch
 * determinism that holds in the sim but is broken by the UI.
 *
 * UI CONTRACT. The `data-testid` values below ARE the contract between this suite and the
 * implementation. They are deliberately semantic (what the thing means) rather than
 * structural (where it sits), so the layout can be redesigned freely without touching
 * this file. Implementers: add these testids; do not rename them to suit a component.
 */

import { expect, test } from '@playwright/test'

/** Fixed seed so every assertion below is reproducible. */
const SEED = 20260730

const ID = {
  surveyScreen: 'survey-screen',
  terrainCanvas: 'terrain-canvas',
  seedReadout: 'seed-readout',
  candidateSite: 'candidate-site', // + `-${x}-${y}`
  siteScore: 'site-score',
  scoreBuildability: 'score-buildability',
  scoreDepositProximity: 'score-deposit-proximity',
  scoreHullSeparation: 'score-hull-separation',
  rejectionReason: 'rejection-reason',
  beginMission: 'begin-mission',
  hullsPlaced: 'hulls-placed',

  opsScreen: 'ops-screen',
  turnReadout: 'turn-readout', // "1 / 278"
  turnsRemaining: 'turns-remaining',
  powerGeneration: 'power-generation',
  powerDraw: 'power-draw',
  dronesOnShift: 'drones-on-shift',
  habitatCapacity: 'habitat-capacity',
  depositCount: 'deposit-count',
  gridDimensions: 'grid-dimensions',
  brownoutCutLine: 'brownout-cut-line',
  ventedEnergy: 'vented-energy',
  endCycle: 'end-cycle',
  missionVerdict: 'mission-verdict',
} as const

const at = (id: string): string => `[data-testid="${id}"]`

async function openSurvey(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/?seed=${SEED}`)
  await expect(page.locator(at(ID.surveyScreen))).toBeVisible()
}

/** Place both hulls at two sites known to be legal for this seed, then confirm. */
async function landAndBegin(page: import('@playwright/test').Page): Promise<void> {
  const candidates = page.locator(`[data-testid^="${ID.candidateSite}"]:not([disabled])`)
  await candidates.nth(0).click()
  await candidates.nth(1).click()
  await expect(page.locator(at(ID.beginMission))).toBeEnabled()
  await page.locator(at(ID.beginMission)).click()
  await expect(page.locator(at(ID.opsScreen))).toBeVisible()
}

// ---------------------------------------------------------------------------
// US1 — Launch and survey
// ---------------------------------------------------------------------------

test.describe('US1 — launch and survey', () => {
  test('AC-1.1 the app serves and the survey screen renders with no console errors', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    await openSurvey(page)
    expect(errors).toEqual([])
  })

  test('AC-1.2 the terrain renders to a canvas and the seed is visible', async ({ page }) => {
    await openSurvey(page)
    const canvas = page.locator(at(ID.terrainCanvas))
    await expect(canvas).toBeVisible()
    // A canvas with zero area is "visible" to the DOM but renders nothing.
    const box = await canvas.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(0)
    expect(box?.height ?? 0).toBeGreaterThan(0)
    await expect(page.locator(at(ID.seedReadout))).toContainText(String(SEED))
  })

  test('AC-1.3 the same seed renders identical terrain across reloads', async ({ page }) => {
    // WHAT THIS ACTUALLY GUARDS, measured rather than assumed. The survey screen paints
    // candidate-site markers OVER the canvas, and a Playwright element screenshot captures
    // the element's box AS RENDERED — so the markers are inside these bytes. Verified by
    // probe: placing one hull CHANGES this screenshot.
    //
    // So this assertion is stronger than its name: it pins the determinism of the marker
    // layer as well as the terrain. That is why `SurveyScreen` forbids text over the map,
    // transitions on a marker, and measured sizes, and uses whole-pixel geometry — those
    // constraints are load-bearing here, not stylistic. Anyone "improving" the markers
    // with a CSS transition or a ResizeObserver-driven size will break this test, and the
    // failure will look like a terrain-rendering bug.
    //
    // Stress-checked at --repeat-each=10 on AC-1.3 alone and --repeat-each=3 on the full
    // suite (48 runs): no flake. The agent that built this screen was killed by a 529
    // before it could run that check; this is its unfinished work, completed.
    await openSurvey(page)
    const first = await page.locator(at(ID.terrainCanvas)).screenshot()
    await page.reload()
    await expect(page.locator(at(ID.surveyScreen))).toBeVisible()
    const second = await page.locator(at(ID.terrainCanvas)).screenshot()
    expect(Buffer.compare(first, second)).toBe(0)
  })

  test('AC-edge no seed in the URL generates and displays one rather than crashing', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator(at(ID.surveyScreen))).toBeVisible()
    // A generated seed is a number, so require one. `not.toBeEmpty()` would be satisfied
    // by the literal word "seed" or a placeholder.
    await expect(page.locator(at(ID.seedReadout))).toContainText(/\d/)
  })
})

// ---------------------------------------------------------------------------
// US2 — Choose a landing site consequentially
// ---------------------------------------------------------------------------

test.describe('US2 — the landing choice is consequential', () => {
  test('AC-2.1 a complete landing shows a numeric score and all three components', async ({
    page,
  }) => {
    // CORRECTED after the survey-screen agent pointed out this test was weaker than it
    // read. It originally clicked ONE candidate and asserted the four readouts were
    // not-empty. But `evaluateLanding` cannot score a single anchor — one hull is
    // `incomplete` and carries no `ScoreBreakdown`, correctly, because all three
    // components are properties of the PAIR (buildability across both footprints,
    // proximity averaged over both anchors, separation between them). So after one click
    // the honest render is a placeholder, which satisfied `not.toBeEmpty()` while proving
    // nothing. The only way to have passed the old test with real numbers would have been
    // for a component to invent a score the sim never produced.
    //
    // Now it places BOTH hulls and requires the score to contain a digit. Asserting a
    // digit rather than mere non-emptiness is what stops a placeholder satisfying it.
    await openSurvey(page)
    const candidates = page.locator(`[data-testid^="${ID.candidateSite}"]:not([disabled])`)
    await candidates.nth(0).click()
    await candidates.nth(1).click()
    for (const id of [
      ID.siteScore,
      ID.scoreBuildability,
      ID.scoreDepositProximity,
      ID.scoreHullSeparation,
    ]) {
      await expect(page.locator(at(id))).toContainText(/\d/)
    }
  })

  test('★ AC-2.2 two different sites produce DIFFERENT scores', async ({ page }) => {
    // The load-bearing assertion for this story. A hardcoded or constant score would
    // satisfy AC-2.1 completely. This is what makes the survey screen a decision.
    await openSurvey(page)
    const candidates = page.locator(`[data-testid^="${ID.candidateSite}"]:not([disabled])`)
    await candidates.nth(0).click()
    await candidates.nth(1).click()
    const scoreA = await page.locator(at(ID.siteScore)).innerText()

    await page.reload()
    await expect(page.locator(at(ID.surveyScreen))).toBeVisible()
    const again = page.locator(`[data-testid^="${ID.candidateSite}"]:not([disabled])`)
    await again.nth(0).click()
    await again.nth(2).click()
    const scoreB = await page.locator(at(ID.siteScore)).innerText()

    expect(scoreA).not.toBe(scoreB)
  })

  test('AC-2.3 an illegal site is refused with the sim’s specific reason', async ({
    page,
  }) => {
    await openSurvey(page)
    const candidates = page.locator(`[data-testid^="${ID.candidateSite}"]:not([disabled])`)
    await candidates.nth(0).click()
    await candidates.nth(0).click() // same tile twice -> overlapping hulls
    const reason = page.locator(at(ID.rejectionReason))
    await expect(reason).toBeVisible()
    await expect(reason).toContainText(/out-of-bounds|unbuildable|overlapping-hulls/)
    await expect(page.locator(at(ID.hullsPlaced))).toContainText(/\b1\b/)
  })

  test('AC-2.4 begin is disabled until both hulls are placed, and says what is missing', async ({
    page,
  }) => {
    await openSurvey(page)
    const begin = page.locator(at(ID.beginMission))
    await expect(begin).toBeDisabled()
    // Word-boundary throughout: the format is the survey screen's to choose ("0 of 2",
    // "0/2"), so exact text would couple this test to a layout decision — but a bare
    // substring lets a wrong count slip through. \b pins the number without pinning prose.
    await expect(page.locator(at(ID.hullsPlaced))).toContainText(/\b0\b/)
    await page.locator(`[data-testid^="${ID.candidateSite}"]`).first().click()
    await expect(begin).toBeDisabled()
    await expect(page.locator(at(ID.hullsPlaced))).toContainText(/\b1\b/)
  })
})

// ---------------------------------------------------------------------------
// US3 — Begin the mission from that choice
// ---------------------------------------------------------------------------

test.describe('US3 — the mission begins from the chosen landing', () => {
  test('AC-3.1 confirming lands and shows Colony Operations', async ({ page }) => {
    await openSurvey(page)
    await landAndBegin(page)
    await expect(page.locator(at(ID.opsScreen))).toBeVisible()
  })

  test('★ AC-3.2 the started colony IS the surveyed world, not a fresh one', async ({ page }) => {
    // THE aic-c1p GUARD, one layer up. A bridge that generates a new world on start would
    // pass every other test in this file: screens render, scores show, turns advance. The
    // only way to catch it is to carry an observable property across the transition.
    await openSurvey(page)
    const surveyedDeposits = await page.locator(at(ID.depositCount)).innerText()
    const surveyedGrid = await page.locator(at(ID.gridDimensions)).innerText()

    await landAndBegin(page)

    await expect(page.locator(at(ID.depositCount))).toHaveText(surveyedDeposits)
    await expect(page.locator(at(ID.gridDimensions))).toHaveText(surveyedGrid)
  })

  test('AC-3.3 the fresh colony reports turn 1 of 278 and zero habitat capacity', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)
    // Exact text, not substring. `toContainText('1')` would also be satisfied by
    // "11 / 278" or "1 / 278" alike, which is not what "turn 1 of 278" means.
    await expect(page.locator(at(ID.turnReadout))).toHaveText('1 / 278')
    // Word-boundary regex, not a substring: "10" CONTAINS "0", so a habitat capacity
    // of 10 would have satisfied `toContainText('0')`. Same class of hole as AC-edge's.
    await expect(page.locator(at(ID.habitatCapacity))).toContainText(/\b0\b/)
    // A digit, not mere non-emptiness: an em-dash placeholder satisfies `not.toBeEmpty()`,
    // which is exactly how AC-2.1 managed to assert nothing at all before it was fixed.
    for (const id of [ID.powerGeneration, ID.powerDraw, ID.dronesOnShift]) {
      await expect(page.locator(at(id))).toContainText(/\d/)
    }
  })

  test('AC-edge reloading mid-survey does not present a half-started mission', async ({
    page,
  }) => {
    await openSurvey(page)
    await page.locator(`[data-testid^="${ID.candidateSite}"]`).first().click()
    await page.reload()
    await expect(page.locator(at(ID.surveyScreen))).toBeVisible()
    await expect(page.locator(at(ID.opsScreen))).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// US4 — Take the first turn
// ---------------------------------------------------------------------------

test.describe('US4 — the first turn resolves', () => {
  test('AC-4.1 End Cycle advances exactly one turn', async ({ page }) => {
    await openSurvey(page)
    await landAndBegin(page)
    // EXACT text throughout. `toContainText('2')` is a substring match, and
    // "3 / 278" contains a '2' — via the 278 — so a guard that advanced TWO turns
    // would have satisfied the old assertion. See the note on AC-edge below.
    await expect(page.locator(at(ID.turnsRemaining))).toHaveText('277')
    await page.locator(at(ID.endCycle)).click()
    await expect(page.locator(at(ID.turnReadout))).toHaveText('2 / 278')
    await expect(page.locator(at(ID.turnsRemaining))).toHaveText('276')
  })

  test('AC-4.2 brownout and vented energy are reported, never silently dropped', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)
    await page.locator(at(ID.endCycle)).click()
    // STRENGTHENED. This previously read:
    //     await expect(ventedEnergy).not.toBeEmpty()
    //     if ((await cut.count()) > 0) await expect(cut).not.toBeEmpty()
    // Both halves were weak and the second was the worst assertion in the file: a
    // CONDITIONAL that silently does nothing when the element is absent. Delete the cut
    // line entirely and the test still passes. And `not.toBeEmpty()` is satisfied by an
    // em dash, so a screen that rendered a permanent placeholder for both figures would
    // have been green — while the player learned nothing, which is the exact thing these
    // readouts exist to prevent.
    //
    // The colony opens with ONE reactor against 33 drones, so a brownout on turn 1 is
    // certain, and the no-storage ruling guarantees energy is vented every turn. Both are
    // therefore assertable as REAL NUMBERS rather than mere presence.
    await expect(page.locator(at(ID.ventedEnergy))).toContainText(/\d/)
    await expect(page.locator(at(ID.brownoutCutLine))).toContainText(/\d/)
  })

  test('AC-edge two clicks delivered in ONE tick advance exactly one turn', async ({
    page,
  }) => {
    // REWRITTEN, because the previous version could not fail. It used Playwright's
    // `dblclick()`, and I mutation-tested that: disabling the click-count guard, then also
    // the in-flight latch, then ALSO the adapter's stale-token refusal — all three off —
    // and it still passed. A probe explained why: `dblclick()` delivers only one click to
    // the React handler in this app, so the gesture never exercises the hazard. The test
    // asserted a behaviour that was true by construction, which is the definition of a
    // decorative test, and it was counted as coverage for three guards it could not see.
    //
    // Two SEPARATE clicks are not the hazard either — they legitimately advance two turns,
    // because two independent gestures naming different turns are two real intents. Probed
    // and confirmed: two clicks give "3 / 278", which is correct.
    //
    // The actual hazard is two click events delivered in a SINGLE tick — a duplicated
    // handler, a stale closure, StrictMode's double-invoke, or a synthetic dispatch. That
    // is what the guards defend, so that is what this now fires. Note the ops screen's own
    // finding: a synthetic click reaches even a DISABLED button, so `disabled` alone is not
    // the defence and the handler predicate is load-bearing.
    await openSurvey(page)
    await landAndBegin(page)
    await expect(page.locator(at(ID.turnsRemaining))).toHaveText('277')

    await page.evaluate((sel: string) => {
      const button = document.querySelector(sel)
      if (button === null) throw new Error(`no ${sel}`)
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    }, at(ID.endCycle))

    await expect(page.locator(at(ID.turnReadout))).toHaveText('2 / 278')
    await expect(page.locator(at(ID.turnsRemaining))).toHaveText('276')
  })

  test('★ AC-4.3 same seed, same landing, same orders -> identical turn-1 display', async ({
    page,
  }) => {
    // Determinism observable THROUGH THE UI. The sim's golden trace proves the sim is
    // deterministic; it cannot prove the adapter or the render layer has not introduced
    // ordering, time or randomness of its own.
    const capture = async (): Promise<string> => {
      await openSurvey(page)
      await landAndBegin(page)
      await page.locator(at(ID.endCycle)).click()
      const parts: string[] = []
      for (const id of [
        ID.turnReadout,
        ID.turnsRemaining,
        ID.powerGeneration,
        ID.powerDraw,
        ID.dronesOnShift,
        ID.habitatCapacity,
        ID.ventedEnergy,
      ]) {
        parts.push(`${id}=${await page.locator(at(id)).innerText()}`)
      }
      return parts.join('|')
    }
    const first = await capture()
    const second = await capture()
    expect(second).toBe(first)
  })
})
