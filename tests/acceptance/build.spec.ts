/**
 * ACCEPTANCE SUITE — "I have landed. Now let me DO something." (aic-oby.7, P0)
 *
 * THE BUG THIS FILE PROVES FIXED. The General played the live build and reported: "I
 * see no way to apply any actions after I have landed the ships. Only can end cycle
 * repeatedly." Colony Operations rendered a beautiful readout and offered exactly ONE
 * control. `src/sim/orders.ts`'s `applyOrders` and the adapter's `issue-orders` action
 * were both built and unit-tested, and NOTHING in any `.tsx` ever dispatched either —
 * the exact "seam wired, UI never calls it" shape that has bitten this project before
 * (aic-c1p, aic-8eq), one layer higher. A unit test on either side of that seam passed;
 * only a browser-level test that drives a real click can catch a UI that never issues
 * the intent it has every ingredient to issue. That is why this suite exists, following
 * `playable-start.spec.ts`'s own reasoning for being browser-level at all.
 *
 * FOUR THINGS THIS SUITE PROVES, matching the bead's mandatory acceptance criteria:
 *   1. a player can select a structure, place it, and SEE it in the build queue
 *   2. an illegal placement shows a readable reason (FR-006, verbatim typed rejection)
 *   3. a queued structure eventually COMPLETES and the colony readout changes as a
 *      result — the full loop, end to end, not just "the queue has an entry"
 *   4. a cancel removes it from the queue
 *
 * UI CONTRACT, following `playable-start.spec.ts`'s own convention: semantic testids,
 * not structural ones, so a redesign never has to touch this file.
 */

import { expect, test } from '@playwright/test'
import { HABITAT_BUILD_TURNS } from '../../src/sim/catalog-data-core'

/** Fixed seed so every assertion below is reproducible, matching `playable-start.spec.ts`. */
const SEED = 20260730

const ID = {
  surveyScreen: 'survey-screen',
  candidateSite: 'candidate-site', // + `-${x}-${y}`
  beginMission: 'begin-mission',

  opsScreen: 'ops-screen',
  endCycle: 'end-cycle',
  habitatCapacity: 'habitat-capacity',

  buildTray: 'build-tray',
  buildMenu: 'build-menu', // + `-${structureTypeId}`
  buildOutcome: 'build-outcome',
  buildQueue: 'build-queue',
  buildQueueEmpty: 'build-queue-empty',
  buildQueueRow: 'build-queue-row', // + `-${projectId}`
  buildQueueStatus: 'build-queue-status', // + `-${projectId}`
  cancelBuild: 'cancel-build', // + `-${projectId}`
  buildAnchor: 'build-anchor', // + `-${x}-${y}`
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

/**
 * Select `structureTypeId` in the build tray, then click the grid tile at `(x, y)`.
 *
 * `(0, 0)` and every tile used by these tests are far from the candidate lattice (which
 * starts at offset 3, spacing 8 — see `candidate-sites.ts`) and therefore never coincide
 * with wherever `landAndBegin` happened to land the two hulls for this seed.
 */
async function place(
  page: import('@playwright/test').Page,
  structureTypeId: string,
  x: number,
  y: number,
): Promise<void> {
  await page.locator(at(`${ID.buildMenu}-${structureTypeId}`)).click()
  await page.locator(at(`${ID.buildAnchor}-${String(x)}-${String(y)}`)).click()
}

test.describe('the build tray is findable immediately', () => {
  test('the build tray is visible in the viewport as soon as the mission begins, with no scrolling', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)
    const tray = page.locator(at(ID.buildTray))
    await expect(tray).toBeVisible()
    await expect(tray).toBeInViewport()
    // The build tray must offer at least the two mission-critical structures — the
    // reactor and the habitat — not just chain 1's industrial side-chain.
    await expect(page.locator(at(`${ID.buildMenu}-reactor-unit`))).toBeVisible()
    await expect(page.locator(at(`${ID.buildMenu}-habitat-module`))).toBeVisible()
  })
})

test.describe('a player can select, place, and see a structure in the build queue', () => {
  test('selecting a structure and clicking a tile queues it and shows it in the build queue', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)

    await expect(page.locator(at(ID.buildQueueEmpty))).toBeVisible()

    await place(page, 'regolith-hopper', 0, 0)

    await expect(page.locator(at(ID.buildOutcome))).toContainText(/regolith hopper/i)
    const row = page.locator(`[data-testid^="${ID.buildQueueRow}-"]`).first()
    await expect(row).toBeVisible()
    await expect(row).toContainText(/regolith hopper/i)
    await expect(page.locator(`[data-testid^="${ID.buildQueueStatus}-"]`).first()).toContainText(
      /turns/i,
    )
  })
})

test.describe('an illegal placement shows a readable reason', () => {
  test('placing on an already-occupied tile names the occupant, in plain language', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)

    await place(page, 'regolith-hopper', 0, 0)
    await expect(page.locator(at(ID.buildOutcome))).toContainText(/regolith hopper/i)

    // Same tile again, a different structure: the sim must refuse it as occupied.
    await place(page, 'sinter-press', 0, 0)

    const outcome = page.locator(at(ID.buildOutcome))
    await expect(outcome).toBeVisible()
    await expect(outcome).toContainText(/occupied/i)
    // FR-006: the sim's own typed reason, verbatim, not just a paraphrase.
    await expect(outcome).toContainText('occupied')
  })

  test('placing a footprint that hangs off the map is refused as out-of-bounds', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)

    // The Habitat Module is a 2x2 footprint; anchored at the grid's last tile (63, 63)
    // on the ratified 64x64 map, two of its four tiles fall outside the grid.
    await place(page, 'habitat-module', 63, 63)

    const outcome = page.locator(at(ID.buildOutcome))
    await expect(outcome).toBeVisible()
    await expect(outcome).toContainText(/off the map/i)
    await expect(outcome).toContainText('out-of-bounds')
  })
})

test.describe('a queued structure eventually completes and the colony readout changes', () => {
  test('a habitat under construction completes after a cycle, and habitat capacity rises', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)

    await expect(page.locator(at(ID.habitatCapacity))).toContainText(/\b0\b/)

    await place(page, 'habitat-module', 0, 0)
    const status = page.locator(`[data-testid^="${ID.buildQueueStatus}-"]`).first()
    await expect(status).not.toContainText(/complete/i)

    // A habitat takes HABITAT_BUILD_TURNS cycles, not one. That figure is owned by the
    // balance pass (aic-oby.4), which MEASURED it rather than guessing — this test
    // originally clicked once because it was written against an untuned placeholder.
    // Driving the real number keeps the test honest about what a player actually faces.
    //
    // WORTH SAYING PLAINLY: that is 80 End Cycle presses before a player sees their
    // first habitat finish. This loop is the clearest possible evidence for why
    // fast-forward (aic-oby.1) is not a convenience but a requirement.
    for (let cycle = 0; cycle < HABITAT_BUILD_TURNS; cycle++) {
      await page.locator(at(ID.endCycle)).click()
    }

    // The full loop: the queue reports the structure complete, AND the colony's own
    // habitat-capacity readout — the same element AC-3.3 asserts is zero on a fresh
    // colony — has actually moved, not just the build panel's own bookkeeping.
    await expect(status).toContainText(/complete/i)
    await expect(page.locator(at(ID.habitatCapacity))).toContainText(/\b8\b/)
  })
})

test.describe('a cancel removes a queued build from the queue', () => {
  test('cancelling a queued structure removes it from the build queue', async ({ page }) => {
    await openSurvey(page)
    await landAndBegin(page)

    await place(page, 'regolith-hopper', 0, 0)
    const row = page.locator(`[data-testid^="${ID.buildQueueRow}-"]`).first()
    await expect(row).toBeVisible()

    await page.locator(`[data-testid^="${ID.cancelBuild}-"]`).first().click()

    await expect(page.locator(at(ID.buildOutcome))).toContainText(/cancelled/i)
    await expect(page.locator(`[data-testid^="${ID.buildQueueRow}-"]`)).toHaveCount(0)
    await expect(page.locator(at(ID.buildQueueEmpty))).toBeVisible()
  })
})
