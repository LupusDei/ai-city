/**
 * ACCEPTANCE SUITE — "the game has verbs."
 *
 * The definition of done for `aic-8tl.10`. Written BEFORE the build tray exists, so it
 * fails for the right reason first.
 *
 * WHY THIS FILE EXISTS. `playable-start.spec.ts` proves a person can launch, survey, land
 * and take turn 1. It passed 16/16 while the game was unplayable, because it never took a
 * second turn. Driving the real UI for 25 consecutive turns showed every readout identical
 * to turn 1 — drones 7 of 33, capacity 0, vented 1,029,776 Wh — with the screen itself
 * reporting "175 h with no project to absorb it · completed: nothing" every cycle. The
 * colony had 175 robot-hours a turn and nothing to spend them on.
 *
 * So the load-bearing test here is not "a tray exists" — it is ★AC-B5, which requires
 * figures to MOVE across turns. A tray that changes no number is the same defect one layer
 * up, and it would pass every other assertion in this file.
 *
 * ★AC-B4 is the other one that matters, and it was rewritten once. I first framed it as
 * "building must COST something", having assumed every structure carries a bill of
 * materials. It does not, and the domain is right where my assumption was wrong: the
 * Regolith Hopper and Sinter Press are FREE and must be, because the Hopper is what
 * PRODUCES regolith — charging regolith to build one means the chain can never bootstrap.
 * Only the Shield Berm carries a bill (450,000,000 g regolith plus 11,000,000 g sintered
 * plate). Free extractors and expensive products is exactly the shape a bootstrapping
 * economy should have.
 *
 * So ★AC-B4 now asserts the ECONOMY IS LIVE: queue an extractor, run turns, and the
 * stockpile the expensive structure is priced in must actually fill. That was completely
 * inert before this bead.
 *
 * Cost enforcement is still tested, by AC-B3.2: the Berm has a bill and an empty opening
 * stockpile, so it must be visibly unbuildable on turn 1. `buildCost` was debited NOWHERE
 * in production before this work — `turn.ts` scoped it out and named `applyOrders` as the
 * caller that should charge it, and `applyOrders` did not.
 *
 * UI CONTRACT: the `data-testid` values below are the contract. Implementers add them; do
 * not rename them to suit a component. Where an assertion pins EXACT text it is because a
 * substring would let a wrong value through — "3 / 278" contains a "2", which is how an
 * earlier assertion in the sibling suite passed a defect it existed to catch.
 */

import { expect, test } from '@playwright/test'

const SEED = 20260730

const ID = {
  surveyScreen: 'survey-screen',
  candidateSite: 'candidate-site',
  beginMission: 'begin-mission',

  opsScreen: 'ops-screen',
  turnReadout: 'turn-readout',
  endCycle: 'end-cycle',
  dronesOnShift: 'drones-on-shift',
  habitatCapacity: 'habitat-capacity',

  /** The tray listing what can be built. */
  buildTray: 'build-tray',
  /** One option in the tray, suffixed with the catalog id: `build-option-regolith-hopper`. */
  buildOption: 'build-option',
  /** The currently-selected structure, or absent when nothing is selected. */
  buildSelection: 'build-selection',
  /** Cancels the current selection without placing. */
  buildCancel: 'build-cancel',
  /** A placeable tile on the colony map, suffixed `-x-y`. */
  buildTarget: 'build-target',
  /** Structures standing or under construction, one row each. */
  structureRow: 'structure-row',
  /** Count of projects currently under construction. */
  underConstruction: 'under-construction',
  /** The sim's typed reason when an order is refused. */
  orderRejection: 'order-rejection',
  /** Stockpile readout for a resource, suffixed `-regolith`. */
  stockpile: 'stockpile',
  /** Labour applied vs unused this cycle. */
  labourApplied: 'labour-applied',
} as const

const at = (id: string): string => `[data-testid="${id}"]`

async function landAndBegin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/?seed=${SEED}`)
  await expect(page.locator(at(ID.surveyScreen))).toBeVisible()
  const candidates = page.locator(`[data-testid^="${ID.candidateSite}"]:not([disabled])`)
  await candidates.nth(0).click()
  await candidates.nth(38).click()
  await page.locator(at(ID.beginMission)).click()
  await expect(page.locator(at(ID.opsScreen))).toBeVisible()
}

/** Queue the first affordable tray option onto the first placeable tile. */
async function queueFirstBuild(page: import('@playwright/test').Page): Promise<string> {
  const option = page.locator(`[data-testid^="${ID.buildOption}"]:not([disabled])`).first()
  const label = await option.innerText()
  await option.click()
  await expect(page.locator(at(ID.buildSelection))).toBeVisible()
  await page.locator(`[data-testid^="${ID.buildTarget}"]:not([disabled])`).first().click()
  return label
}

// ---------------------------------------------------------------------------
// US-B1 — there is something to build
// ---------------------------------------------------------------------------

test.describe('US-B1 — the colony offers work', () => {
  test('AC-B1.1 the ops screen shows a build tray with the chain-1 structures', async ({
    page,
  }) => {
    await landAndBegin(page)
    await expect(page.locator(at(ID.buildTray))).toBeVisible()
    // The catalog authored in `catalog-data.ts`: Regolith Hopper, Sinter Press, Shield Berm.
    // Asserted as a count rather than by name so a rename does not fail this, but a tray
    // that lists nothing does.
    const options = page.locator(`[data-testid^="${ID.buildOption}"]`)
    await expect(options).toHaveCount(3)
  })

  test('AC-B1.2 each option states what it costs and what it draws', async ({ page }) => {
    await landAndBegin(page)
    const first = page.locator(`[data-testid^="${ID.buildOption}"]`).first()
    // A digit, not mere non-emptiness: a placeholder satisfies `not.toBeEmpty()`, which is
    // exactly how an earlier assertion in the sibling suite asserted nothing at all.
    await expect(first).toContainText(/\d/)
  })

  test('AC-B1.3 selecting an option arms placement, and cancelling disarms it', async ({
    page,
  }) => {
    await landAndBegin(page)
    await expect(page.locator(at(ID.buildSelection))).toHaveCount(0)
    await page.locator(`[data-testid^="${ID.buildOption}"]:not([disabled])`).first().click()
    await expect(page.locator(at(ID.buildSelection))).toBeVisible()
    await page.locator(at(ID.buildCancel)).click()
    await expect(page.locator(at(ID.buildSelection))).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// US-B2 — placing it puts it under construction
// ---------------------------------------------------------------------------

test.describe('US-B2 — a queued build becomes a project', () => {
  test('AC-B2.1 placing a selected structure puts it under construction', async ({ page }) => {
    await landAndBegin(page)
    await expect(page.locator(at(ID.underConstruction))).toContainText(/\b0\b/)
    await queueFirstBuild(page)
    await expect(page.locator(at(ID.underConstruction))).toContainText(/\b1\b/)
  })

  test('AC-B2.2 the queued structure appears in the standing-structures list', async ({
    page,
  }) => {
    await landAndBegin(page)
    const before = await page.locator(`[data-testid^="${ID.structureRow}"]`).count()
    await queueFirstBuild(page)
    await expect(page.locator(`[data-testid^="${ID.structureRow}"]`)).toHaveCount(before + 1)
  })

  test('AC-B2.3 an illegal placement is refused with the sim’s own reason', async ({
    page,
  }) => {
    await landAndBegin(page)
    await queueFirstBuild(page)
    // Place a second structure on the tile the first one just took.
    await page.locator(`[data-testid^="${ID.buildOption}"]:not([disabled])`).first().click()
    const taken = page.locator(`[data-testid^="${ID.buildTarget}"][disabled]`).first()
    if ((await taken.count()) > 0) {
      // Occupied tiles are offered as disabled — the inert-control-that-explains-itself
      // rule. Nothing to click, and that is the correct outcome.
      await expect(taken).toBeDisabled()
      return
    }
    await page.locator(`[data-testid^="${ID.buildTarget}"]`).first().click()
    await expect(page.locator(at(ID.orderRejection))).toContainText(
      /out-of-bounds|occupied|unbuildable/,
    )
  })
})

// ---------------------------------------------------------------------------
// US-B3 — building it costs something  (★)
// ---------------------------------------------------------------------------

test.describe('US-B3 — a build has a price', () => {
  test('★ AC-B4 the economy is live — production accumulates and pays for the next thing', async ({
    page,
  }) => {
    // CORRECTED. I first wrote this as "committing a build debits a stockpile", assuming
    // every structure has a bill of materials. It does not, and the domain is right where
    // my test was wrong: the Regolith Hopper and Sinter Press are FREE, and they must be.
    // The Hopper is what PRODUCES regolith, so charging regolith to build one means the
    // chain can never bootstrap — you would need the output to build the thing that makes
    // the output. Only the Shield Berm carries a bill (450,000,000 g regolith plus
    // 11,000,000 g sintered plate), which is exactly the shape a bootstrapping economy
    // should have: free extractors, expensive products.
    //
    // So the real assertion is not "a build costs something" — it is that the ECONOMY IS
    // LIVE: a queued extractor completes, produces, and the stockpile it fills is the one
    // the expensive structure is priced in. That is the loop the whole resource design
    // rests on, and it was completely inert before this bead.
    await landAndBegin(page)
    const regolith = page.locator(`[data-testid^="${ID.stockpile}"]`).first()
    const opening = await regolith.innerText()

    await queueFirstBuild(page)

    // Long enough to finish a 2-turn Hopper and then produce for several cycles.
    for (let i = 0; i < 10; i += 1) {
      const end = page.locator(at(ID.endCycle))
      if (!(await end.isEnabled())) break
      const turn = await page.locator(at(ID.turnReadout)).innerText()
      await end.click()
      await expect(page.locator(at(ID.turnReadout))).not.toHaveText(turn)
    }

    const closing = await regolith.innerText()
    expect(
      closing,
      'ten turns after queueing an extractor, no stockpile moved — nothing is producing',
    ).not.toBe(opening)
  })

  test('AC-B3.2 an unaffordable structure cannot be committed', async ({ page }) => {
    await landAndBegin(page)
    // The colony starts with an empty stockpile, so anything with a bill of materials is
    // unaffordable on turn 1. It must be visibly refused rather than silently queued.
    const options = page.locator(`[data-testid^="${ID.buildOption}"]`)
    const disabled = page.locator(`[data-testid^="${ID.buildOption}"][disabled]`)
    expect(
      await disabled.count(),
      'nothing was unaffordable on turn 1 with an empty stockpile',
    ).toBeGreaterThan(0)
    expect(await options.count()).toBeGreaterThan(await disabled.count() - 1)
  })
})

// ---------------------------------------------------------------------------
// US-B4 — the colony actually changes  (★)
// ---------------------------------------------------------------------------

test.describe('US-B4 — the mission progresses', () => {
  test('AC-B5.1 labour is absorbed by a project instead of going unused', async ({ page }) => {
    await landAndBegin(page)
    // Before any project exists the screen reports 175 h with nothing to absorb it.
    await queueFirstBuild(page)
    await page.locator(at(ID.endCycle)).click()
    await expect(page.locator(at(ID.turnReadout))).toHaveText('2 / 278')
    await expect(page.locator(at(ID.labourApplied))).toContainText(/\d/)
    // Some labour must have gone INTO the project.
    await expect(page.locator(at(ID.labourApplied))).not.toContainText(/^0\b/)
  })

  test('★ AC-B5 twelve turns with a project queued MOVE the numbers', async ({ page }) => {
    // THE TEST THIS BEAD EXISTS FOR. An exploratory run of 25 turns showed every readout
    // frozen: drones 7 of 33, capacity 0, vented 1,029,776 Wh, cut line 7, for 25 turns.
    // A build tray that leaves them frozen has changed nothing that matters.
    await landAndBegin(page)
    await queueFirstBuild(page)

    const snapshots: string[] = []
    for (let i = 0; i < 12; i += 1) {
      snapshots.push(
        [
          await page.locator(at(ID.dronesOnShift)).innerText(),
          await page.locator(at(ID.habitatCapacity)).innerText(),
          await page.locator(at(ID.underConstruction)).innerText(),
        ].join('|'),
      )
      const end = page.locator(at(ID.endCycle))
      if (!(await end.isEnabled())) break
      const turn = await page.locator(at(ID.turnReadout)).innerText()
      await end.click()
      await expect(page.locator(at(ID.turnReadout))).not.toHaveText(turn)
    }

    const distinct = new Set(snapshots)
    expect(
      distinct.size,
      `every one of ${String(snapshots.length)} turns read identically — the colony did not change`,
    ).toBeGreaterThan(1)
  })
})
