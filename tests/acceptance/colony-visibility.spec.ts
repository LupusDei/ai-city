/**
 * ACCEPTANCE SUITE — "You cannot see your own colony" (aic-oby.8, P0).
 *
 * THE BUG THIS FILE PROVES FIXED. The General played the live build ON A PHONE and
 * reported: "Grid is slightly off screen and I can't tell where I am placing items."
 * Four distinct defects were verified in code, all in the render/display path that
 * `build.spec.ts` and `playable-start.spec.ts` never exercised at a MOBILE viewport or
 * against the rendered PIXELS of the canvas:
 *
 *   1. The grid overflowed the viewport on a phone — unreachable tiles.
 *   2. `render-world.ts` drew terrain and deposits only, never the colony: a queued
 *      structure was invisible.
 *   3. No placement preview: nothing showed the footprint a click would occupy.
 *   4. A generator's build card read "0 Wh / cycle" for its own output.
 *
 * FOUR THINGS THIS SUITE PROVES, matching the bead's mandatory acceptance criteria:
 *   1. at a MOBILE viewport, the grid fits with NO horizontal overflow and the far
 *      corner tile — the exact class of tile the General could not reach — is both
 *      on-screen and genuinely clickable.
 *   2. after queueing a structure, it is VISIBLE on the grid at the tile the
 *      confirmation names — read from the canvas's own rendered PIXELS, not merely
 *      from a DOM list, because the bug was "nothing appears on the map".
 *   3. an in-progress structure is visually distinct from a completed one — the same
 *      tile's rendered pixel colour changes once construction finishes.
 *   4. a generator's card shows a non-zero, positively-signed generation figure.
 *
 * WHY PIXELS, NOT JUST TESTIDS. `build.spec.ts` already proves a queued structure
 * reaches the build QUEUE panel (a DOM list). It cannot prove anything reaches the MAP,
 * because before this bead nothing did — the queue panel and the map were two
 * completely independent surfaces. Reading `getImageData` off the real `<canvas>` is
 * the only way to prove the fix is the fix: the colony is now actually DRAWN.
 *
 * UI CONTRACT, following `build.spec.ts`'s own convention: semantic testids, not
 * structural ones.
 */

import { expect, test } from '@playwright/test'

import { DEFAULT_TILE_SIZE } from '../../src/app/canvas/render-world'
import { HABITAT_BUILD_TURNS } from '../../src/sim/catalog-data-core'

/** Fixed seed so every assertion below is reproducible, matching the other suites. */
const SEED = 20260730

const ID = {
  surveyScreen: 'survey-screen',
  candidateSite: 'candidate-site', // + `-${x}-${y}`
  beginMission: 'begin-mission',

  opsScreen: 'ops-screen',
  endCycle: 'end-cycle',

  buildMenu: 'build-menu', // + `-${structureTypeId}`
  buildOutcome: 'build-outcome',
  buildAnchor: 'build-anchor', // + `-${x}-${y}`
  terrainCanvas: 'terrain-canvas',
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
 * Every tile these tests place at is far from the candidate lattice (offset 3, spacing
 * 8 — see `candidate-sites.ts`) and therefore never coincides with wherever
 * `landAndBegin` happened to land the two hulls for this seed, matching `build.spec.ts`'s
 * own reasoning.
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

/** The RGBA of one backing-store pixel at the centre of tile `(x, y)`, off the REAL canvas. */
async function tileColour(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<readonly [number, number, number, number]> {
  return page.evaluate(
    ({ testId, px, py }) => {
      const canvas = document.querySelector(`[data-testid="${testId}"]`)
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('terrain-canvas is not a canvas')
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('terrain-canvas has no 2D context')
      const data = context.getImageData(px, py, 1, 1).data
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0] as const
    },
    { testId: ID.terrainCanvas, px: x * DEFAULT_TILE_SIZE + Math.floor(DEFAULT_TILE_SIZE / 2), py: y * DEFAULT_TILE_SIZE + Math.floor(DEFAULT_TILE_SIZE / 2) },
  )
}

// ---------------------------------------------------------------------------
// 1. The grid fits a phone viewport, and every tile is reachable
// ---------------------------------------------------------------------------

test.describe('the grid fits a phone viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the page has no horizontal overflow, and the far corner tile is on-screen and clickable', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)

    // No horizontal scrollbar anywhere on the page — the General's literal complaint
    // ("Grid is slightly off screen").
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // The terrain canvas itself must fit inside the viewport width.
    const canvasBox = await page.locator(at(ID.terrainCanvas)).boundingBox()
    expect(canvasBox).not.toBeNull()
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(390.5)

    // Select something to build, so the placement lattice is on screen, and reach the
    // FAR corner (63, 63) on the ratified 64x64 map — the exact class of tile the
    // General could not tap.
    await page.locator(at(`${ID.buildMenu}-regolith-hopper`)).click()
    const farAnchor = page.locator(at(`${ID.buildAnchor}-63-63`))
    await expect(farAnchor).toBeVisible()

    const anchorBox = await farAnchor.boundingBox()
    expect(anchorBox).not.toBeNull()
    expect(anchorBox!.x + anchorBox!.width).toBeLessThanOrEqual(390.5)

    // Not just visible — genuinely clickable, and the click reaches the sim.
    await farAnchor.click()
    await expect(page.locator(at(ID.buildOutcome))).toContainText(/regolith hopper/i)
    await expect(page.locator(at(ID.buildOutcome))).toContainText('(63, 63)')
  })
})

// ---------------------------------------------------------------------------
// 2. A queued structure is VISIBLE on the grid, at the tile the confirmation names
// ---------------------------------------------------------------------------

test.describe('a queued structure is drawn on the map', () => {
  test('the tile the confirmation names changes colour on the real canvas', async ({ page }) => {
    await openSurvey(page)
    await landAndBegin(page)

    const before = await tileColour(page, 5, 5)

    await place(page, 'regolith-hopper', 5, 5)
    await expect(page.locator(at(ID.buildOutcome))).toContainText('(5, 5)')

    const after = await tileColour(page, 5, 5)
    expect(after).not.toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// 3. In-progress vs complete is a visible distinction, not just a queue-panel label
// ---------------------------------------------------------------------------

test.describe('an in-progress structure reads differently from a completed one', () => {
  test('the same tile’s rendered colour changes once construction completes', async ({ page }) => {
    await openSurvey(page)
    await landAndBegin(page)

    // A habitat takes real build turns (aic-oby.4's measured figure), so it is genuinely
    // in-progress right after queueing — unlike a `buildTurns: 0` structure.
    await place(page, 'habitat-module', 6, 6)
    await expect(page.locator(at(ID.buildOutcome))).toContainText('(6, 6)')
    const inProgress = await tileColour(page, 6, 6)

    for (let cycle = 0; cycle < HABITAT_BUILD_TURNS; cycle++) {
      await page.locator(at(ID.endCycle)).click()
    }

    const complete = await tileColour(page, 6, 6)
    expect(complete).not.toEqual(inProgress)
  })
})

// ---------------------------------------------------------------------------
// 4. A generator's build card shows its GENERATION, signed — not a misleading zero draw
// ---------------------------------------------------------------------------

test.describe('a generator’s card shows what it generates', () => {
  test('the Fission Surface Power Unit card reads a non-zero, positively-signed figure', async ({
    page,
  }) => {
    await openSurvey(page)
    await landAndBegin(page)

    const card = page.locator(at(`${ID.buildMenu}-reactor-unit`))
    await expect(card).toBeVisible()
    // Signed positive, with a real magnitude — never the old "0 Wh / cycle".
    await expect(card).toContainText(/\+[\d,]+\s*Wh/)
    await expect(card).not.toContainText('0 Wh')
  })
})
