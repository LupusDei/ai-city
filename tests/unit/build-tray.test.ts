/**
 * Unit tests for the build tray's thinking half.
 *
 * REAL SIM VALUES THROUGHOUT, never hand-shaped fixtures. `aic-c1p` shipped a landing score
 * at 100% coverage while a third of it ran on data nothing produced, and `tests/support/
 * running-colony.ts` exists because of it. The catalog here is the REAL
 * `chainOneStructureSpecs` through the REAL `createCatalog`, and the grid is a real colony's,
 * so an assertion about the Shield Berm's bill is an assertion about the figure the player
 * is actually charged.
 */

import { describe, expect, it } from 'vitest'

import {
  buildCatalog,
  buildOptions,
  formatAmount,
  placementTargets,
  queueBuildOrder,
  rejectionText,
  selectedOption,
  stockpileReadouts,
  underConstructionCount,
} from '../../src/app/screens/ops/build-tray'
import { getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import {
  REGOLITH,
  REGOLITH_HOPPER_ID,
  SHIELD_BERM_ID,
  SINTERED_PLATE,
  SINTER_PRESS_ID,
} from '../../src/sim/catalog-data'
import { createGrid } from '../../src/sim/grid'
import { applyOrders } from '../../src/sim/orders'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { startedColony } from '../support/running-colony'

const CATALOG = buildCatalog(DEFAULT_TURN_CYCLE)

function typeOf(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`catalog is missing ${id}`)
  return found
}

const HOPPER = typeOf(REGOLITH_HOPPER_ID)
const PRESS = typeOf(SINTER_PRESS_ID)
const BERM = typeOf(SHIELD_BERM_ID)

// ---------------------------------------------------------------------------

describe('buildCatalog', () => {
  it('should offer exactly the three chain-1 structures in menu order', () => {
    expect(buildOptions(CATALOG, {}).map((option) => option.id)).toEqual([
      REGOLITH_HOPPER_ID,
      SINTER_PRESS_ID,
      SHIELD_BERM_ID,
    ])
  })

  it('should validate through createCatalog, so every entry carries the normalised fields', () => {
    // `buildCost` is OPTIONAL on a spec and REQUIRED on a validated type. The Hopper authors
    // none, so seeing `{}` here proves the specs genuinely went through the validation
    // boundary rather than being passed along raw.
    expect(HOPPER.buildCost).toEqual({})
    expect(HOPPER.siting).toEqual({})
  })
})

describe('formatAmount', () => {
  it('should render mass in grouped grams', () => {
    expect(formatAmount(REGOLITH, 450_000_000)).toBe('450,000,000 g')
  })

  it('should render energy in watt-hours, not grams', () => {
    expect(formatAmount('electricity', 595_917)).toBe('595,917 Wh')
  })

  it('should render zero as a real figure rather than an empty string', () => {
    expect(formatAmount(REGOLITH, 0)).toBe('0 g')
  })
})

describe('buildOptions', () => {
  it('should state a cost, a draw and a labour figure for every option', () => {
    for (const option of buildOptions(CATALOG, {})) {
      expect(option.costLabel.length).toBeGreaterThan(0)
      expect(option.drawLabel.length).toBeGreaterThan(0)
      expect(option.labourLabel.length).toBeGreaterThan(0)
    }
  })

  it('should carry a digit in the first option, so the tray states something concrete', () => {
    // AC-B1.2's own assertion, pinned here too: a placeholder satisfies "not empty", which
    // is exactly how an earlier assertion in the sibling suite asserted nothing at all.
    const first = buildOptions(CATALOG, {})[0]
    expect(first).toBeDefined()
    expect(`${first?.labourLabel ?? ''} ${first?.drawLabel ?? ''}`).toMatch(/\d/)
  })

  it('should name the free extractors as free rather than pricing them at zero', () => {
    const options = buildOptions(CATALOG, {})
    expect(options.find((o) => o.id === REGOLITH_HOPPER_ID)?.costLabel).toBe('free to build')
    expect(options.find((o) => o.id === SINTER_PRESS_ID)?.costLabel).toBe('free to build')
  })

  it("should price the Shield Berm from the catalog's own derived bill", () => {
    const berm = buildOptions(CATALOG, {}).find((o) => o.id === SHIELD_BERM_ID)
    // Sorted by resource name, matching checkAffordability's own sort.
    expect(berm?.costLabel).toBe(
      `${formatAmount(REGOLITH, BERM.buildCost[REGOLITH] ?? 0)} ${REGOLITH} · ` +
        `${formatAmount(SINTERED_PLATE, BERM.buildCost[SINTERED_PLATE] ?? 0)} ${SINTERED_PLATE}`,
    )
  })

  it('should call the material-gated berm material-gated rather than instant', () => {
    // `buildTurns: 0` means "needs no drone-hours", which is the opposite of "0 turns".
    expect(buildOptions(CATALOG, {}).find((o) => o.id === SHIELD_BERM_ID)?.labourLabel).toBe(
      'no drone work — material-gated',
    )
  })

  it('should report a zero-draw structure as drawing nothing', () => {
    expect(buildOptions(CATALOG, {}).find((o) => o.id === SHIELD_BERM_ID)?.drawLabel).toBe(
      'draws nothing',
    )
  })

  it('should make the free structures affordable on an empty stockpile', () => {
    const options = buildOptions(CATALOG, {})
    expect(options.find((o) => o.id === REGOLITH_HOPPER_ID)?.affordable).toBe(true)
    expect(options.find((o) => o.id === SINTER_PRESS_ID)?.affordable).toBe(true)
  })

  it('should make the costed structure unaffordable on an empty stockpile', () => {
    const berm = buildOptions(CATALOG, {}).find((o) => o.id === SHIELD_BERM_ID)
    expect(berm?.affordable).toBe(false)
  })

  it('should say what is missing and how much is held, not merely "cannot afford"', () => {
    const berm = buildOptions(CATALOG, {}).find((o) => o.id === SHIELD_BERM_ID)
    expect(berm?.shortfall.map((line) => line.resource)).toEqual([REGOLITH, SINTERED_PLATE])
    expect(berm?.shortfall[0]?.text).toBe(
      `needs ${formatAmount(REGOLITH, BERM.buildCost[REGOLITH] ?? 0)} ${REGOLITH}, holds 0`,
    )
  })

  it('should report no shortfall once the colony can pay in full', () => {
    const rich = { [REGOLITH]: 10_000_000_000, [SINTERED_PLATE]: 10_000_000_000 }
    const berm = buildOptions(CATALOG, rich).find((o) => o.id === SHIELD_BERM_ID)
    expect(berm?.affordable).toBe(true)
    expect(berm?.shortfall).toEqual([])
  })

  it('should agree with the sim exactly at the boundary where the bill is met', () => {
    // `canAfford` is inclusive: a colony that can pay EXACTLY can build and be left with
    // nothing. The tray must not strand a player one gram short of spending their last gram.
    const exact = {
      [REGOLITH]: BERM.buildCost[REGOLITH] ?? 0,
      [SINTERED_PLATE]: BERM.buildCost[SINTERED_PLATE] ?? 0,
    }
    expect(buildOptions(CATALOG, exact).find((o) => o.id === SHIELD_BERM_ID)?.affordable).toBe(
      true,
    )

    const oneShort = { ...exact, [REGOLITH]: (BERM.buildCost[REGOLITH] ?? 0) - 1 }
    expect(
      buildOptions(CATALOG, oneShort).find((o) => o.id === SHIELD_BERM_ID)?.affordable,
    ).toBe(false)
  })

  it('should give every option the acceptance contract testid', () => {
    expect(buildOptions(CATALOG, {}).map((o) => o.testId)).toEqual([
      'build-option-regolith-hopper',
      'build-option-sinter-press',
      'build-option-shield-berm',
    ])
  })
})

describe('selectedOption', () => {
  const options = buildOptions(CATALOG, {})

  it('should return null when nothing is armed', () => {
    expect(selectedOption(options, null)).toBeNull()
  })

  it('should return the armed option', () => {
    expect(selectedOption(options, SINTER_PRESS_ID)?.id).toBe(SINTER_PRESS_ID)
  })

  it('should return null for an id no longer in the menu', () => {
    expect(selectedOption(options, 'a-structure-that-was-removed')).toBeNull()
  })
})

describe('placementTargets', () => {
  it('should offer one target per tile, row-major', () => {
    const grid = createGrid(4, 3)
    const targets = placementTargets(grid, HOPPER)
    expect(targets).toHaveLength(12)
    expect(targets[0]?.testId).toBe('build-target-0-0')
    expect(targets[1]?.testId).toBe('build-target-1-0')
    expect(targets[4]?.testId).toBe('build-target-0-1')
  })

  it('should mark every tile of an empty grid legal for a one-tile structure', () => {
    expect(placementTargets(createGrid(4, 4), HOPPER).every((t) => t.legal)).toBe(true)
  })

  it("should refuse tiles where a multi-tile footprint would hang off the edge", () => {
    // The Press is an L three tiles tall/wide, so the last row and column cannot anchor it.
    const targets = placementTargets(createGrid(4, 4), PRESS)
    const bottomRight = targets.find((t) => t.x === 3 && t.y === 3)
    expect(bottomRight?.legal).toBe(false)
    expect(bottomRight?.reason).toBe('out-of-bounds')
  })

  it("should carry the sim's own occupied verdict for a tile a hull stands on", () => {
    const colony = startedColony()
    const targets = placementTargets(colony.colony.grid, HOPPER)
    const occupied = targets.filter((t) => !t.legal && t.reason === 'occupied')
    // The two landed hulls occupy 4 tiles each.
    expect(occupied).toHaveLength(8)
  })

  it('should mark an occupied tile illegal and its free neighbour legal', () => {
    const colony = startedColony()
    const grid = colony.colony.grid
    const targets = placementTargets(grid, HOPPER)
    const anyOccupied = targets.find((t) => t.reason === 'occupied')
    expect(anyOccupied).toBeDefined()
    expect(anyOccupied?.legal).toBe(false)
    expect(targets.some((t) => t.legal)).toBe(true)
  })

  it('should agree with the sim on a partial overlap, not merely on the anchor', () => {
    // The case an anchor-only check invented in the app layer would wave through: the anchor
    // is free but another footprint tile is not.
    const colony = startedColony()
    const grid = colony.colony.grid
    const occupiedTile = grid.tiles.find((tile) => tile.occupantId !== null)
    expect(occupiedTile).toBeDefined()
    if (occupiedTile === undefined) return

    // Anchor one tile to the left of an occupied tile: the Press's (1,1) offset reaches it.
    const anchor = { x: occupiedTile.x - 1, y: occupiedTile.y - 1 }
    const anchorTile = grid.tiles[anchor.y * grid.width + anchor.x]
    expect(anchorTile?.occupantId).toBeNull()

    const target = placementTargets(grid, PRESS).find(
      (t) => t.x === anchor.x && t.y === anchor.y,
    )
    expect(target?.legal).toBe(false)
    expect(target?.reason).toBe('occupied')
  })
})

describe('queueBuildOrder', () => {
  it('should mint a deterministic id from the structure and the anchor', () => {
    expect(queueBuildOrder(HOPPER, { x: 12, y: 34 }).id).toBe('regolith-hopper-12-34')
  })

  it('should produce an identical order for identical input', () => {
    expect(queueBuildOrder(HOPPER, { x: 3, y: 4 })).toEqual(
      queueBuildOrder(HOPPER, { x: 3, y: 4 }),
    )
  })

  it('should give different anchors different ids', () => {
    expect(queueBuildOrder(HOPPER, { x: 1, y: 2 }).id).not.toBe(
      queueBuildOrder(HOPPER, { x: 2, y: 1 }).id,
    )
  })

  it('should give different structures at one anchor different ids', () => {
    expect(queueBuildOrder(HOPPER, { x: 5, y: 5 }).id).not.toBe(
      queueBuildOrder(PRESS, { x: 5, y: 5 }).id,
    )
  })

  it('should carry the structure type and anchor through unchanged', () => {
    const order = queueBuildOrder(PRESS, { x: 7, y: 8 })
    expect(order.kind).toBe('queue-build')
    expect(order.structureType).toBe(PRESS)
    expect(order.anchor).toEqual({ x: 7, y: 8 })
  })

  it('should survive a queue/cancel/re-queue cycle without a duplicate-id throw', () => {
    // The defect an ordinal id generator produces: cancel the FIRST of two and the count
    // returns to 1, so the next mint duplicates the surviving project's id and
    // `enqueueProject` throws a RangeError inside a click handler.
    const colony = startedColony()
    const state = { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} }

    const first = queueBuildOrder(HOPPER, { x: 40, y: 40 })
    const second = queueBuildOrder(HOPPER, { x: 41, y: 40 })
    const afterBoth = applyOrders(state, [first, second])
    expect(afterBoth.outcomes.every((o) => o.ok)).toBe(true)

    const afterCancel = applyOrders(afterBoth.state, [{ kind: 'cancel-build', id: first.id }])
    expect(afterCancel.outcomes[0]?.ok).toBe(true)

    // Re-queueing at the freed anchor must NOT throw, and must be accepted.
    const requeued = applyOrders(afterCancel.state, [queueBuildOrder(HOPPER, { x: 40, y: 40 })])
    expect(requeued.outcomes[0]?.ok).toBe(true)
    expect(requeued.state.queue.filter((p) => p.structureType.id === REGOLITH_HOPPER_ID)).toHaveLength(
      2,
    )
  })

  it('should be accepted by applyOrders against a real colony', () => {
    // The end-to-end shape check: an order this module minted is one the sim actually takes.
    const colony = startedColony()
    const free = colony.colony.grid.tiles.find((tile) => tile.occupantId === null)
    expect(free).toBeDefined()
    if (free === undefined) return

    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [queueBuildOrder(HOPPER, { x: free.x, y: free.y })],
    )
    expect(result.outcomes[0]?.ok).toBe(true)
    expect(result.state.queue).toHaveLength(colony.colony.queue.length + 1)
  })
})

describe('underConstructionCount', () => {
  it('should be zero for a fresh colony whose landed hulls are already complete', () => {
    const colony = startedColony()
    expect(underConstructionCount(DEFAULT_TURN_CYCLE, colony.colony.queue)).toBe(0)
  })

  it('should count a newly queued project', () => {
    const colony = startedColony()
    const free = colony.colony.grid.tiles.find((tile) => tile.occupantId === null)
    expect(free).toBeDefined()
    if (free === undefined) return

    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [queueBuildOrder(HOPPER, { x: free.x, y: free.y })],
    )
    expect(underConstructionCount(DEFAULT_TURN_CYCLE, result.state.queue)).toBe(1)
  })

  it('should be zero for an empty queue', () => {
    expect(underConstructionCount(DEFAULT_TURN_CYCLE, [])).toBe(0)
  })
})

describe('stockpileReadouts', () => {
  it('should list the menu materials even when the colony holds nothing', () => {
    // The turn-1 case, and the reason the list comes from the catalog rather than the
    // stockpile: a colony that has never mined has an EMPTY stockpiles object.
    expect(stockpileReadouts(CATALOG, {}).map((r) => r.resource)).toEqual([
      REGOLITH,
      SINTERED_PLATE,
    ])
  })

  it('should read an absent resource as zero rather than as unknown', () => {
    expect(stockpileReadouts(CATALOG, {})[0]?.amount).toBe(0)
    expect(stockpileReadouts(CATALOG, {})[0]?.text).toBe('0 g')
  })

  it('should report what the colony actually holds', () => {
    const readouts = stockpileReadouts(CATALOG, { [REGOLITH]: 60_000_000 })
    expect(readouts.find((r) => r.resource === REGOLITH)?.text).toBe('60,000,000 g')
  })

  it('should exclude electricity, which is vented rather than stockpiled', () => {
    expect(stockpileReadouts(CATALOG, { electricity: 5 }).map((r) => r.resource)).not.toContain(
      'electricity',
    )
  })

  it('should give every readout the acceptance contract testid', () => {
    expect(stockpileReadouts(CATALOG, {}).map((r) => r.testId)).toEqual([
      'stockpile-regolith',
      'stockpile-sinteredPlate',
    ])
  })

  it('should sort by resource name rather than by catalog authoring order', () => {
    const resources = stockpileReadouts(CATALOG, {}).map((r) => r.resource)
    expect([...resources].sort((a, b) => (a < b ? -1 : 1))).toEqual(resources)
  })
})

describe('rejectionText', () => {
  it('should be null when nothing was refused', () => {
    expect(rejectionText([])).toBeNull()
    expect(rejectionText([{ ok: true, order: { kind: 'cancel-build', id: 'x' } }])).toBeNull()
  })

  it("should surface the sim's occupied verdict verbatim, with the tile and the occupant", () => {
    const colony = startedColony()
    const occupied = colony.colony.grid.tiles.find((tile) => tile.occupantId !== null)
    expect(occupied).toBeDefined()
    if (occupied === undefined) return

    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [queueBuildOrder(HOPPER, { x: occupied.x, y: occupied.y })],
    )
    const text = rejectionText(result.outcomes)
    expect(text).toContain('occupied')
    expect(text).toContain(`${String(occupied.x)}, ${String(occupied.y)}`)
    expect(text).toContain(occupied.occupantId ?? '')
  })

  it("should surface the sim's out-of-bounds verdict verbatim", () => {
    const colony = startedColony()
    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [queueBuildOrder(HOPPER, { x: 9999, y: 9999 })],
    )
    expect(rejectionText(result.outcomes)).toContain('out-of-bounds')
  })

  it('should surface an unaffordable refusal with the amount still short', () => {
    const colony = startedColony()
    const free = colony.colony.grid.tiles.find((tile) => tile.occupantId === null)
    expect(free).toBeDefined()
    if (free === undefined) return

    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [queueBuildOrder(BERM, { x: free.x, y: free.y })],
    )
    const text = rejectionText(result.outcomes)
    expect(text).toContain('unaffordable')
    expect(text).toContain(REGOLITH)
    expect(text).toContain('short')
  })

  it('should surface an unknown-project cancel with the id it could not find', () => {
    const colony = startedColony()
    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [{ kind: 'cancel-build', id: 'no-such-project' }],
    )
    expect(rejectionText(result.outcomes)).toContain('unknown-project')
    expect(rejectionText(result.outcomes)).toContain('no-such-project')
  })

  it('should report the first refusal when a batch carries one among successes', () => {
    const colony = startedColony()
    const free = colony.colony.grid.tiles.find((tile) => tile.occupantId === null)
    const occupied = colony.colony.grid.tiles.find((tile) => tile.occupantId !== null)
    expect(free).toBeDefined()
    expect(occupied).toBeDefined()
    if (free === undefined || occupied === undefined) return

    const result = applyOrders(
      { grid: colony.colony.grid, queue: colony.colony.queue, stockpiles: {} },
      [
        queueBuildOrder(HOPPER, { x: free.x, y: free.y }),
        queueBuildOrder(HOPPER, { x: occupied.x, y: occupied.y }),
      ],
    )
    expect(result.outcomes[0]?.ok).toBe(true)
    expect(rejectionText(result.outcomes)).toContain('occupied')
  })
})
