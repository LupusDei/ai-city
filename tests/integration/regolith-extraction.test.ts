/**
 * US1 — extract regolith, end to end through the REAL turn loop (`aic-d8y.2`, spec 002).
 *
 * WHY THIS IS AN INTEGRATION TEST AND WHY THERE IS NO `production.ts`.
 *
 * `specs/002-regolith-shield-chain/tasks.md` proposed a new `src/sim/production.ts` for
 * T005–T007 (per-turn production resolution, binary idle, overflow). Building it would
 * have been PARALLEL MACHINERY: `turn.ts` already resolves production, and it already does
 * so generically —
 *
 *   - it freezes the operational set from start-of-turn completion, so a structure still
 *     under construction contributes nothing (T005);
 *   - it takes flows ONLY from structures that are both complete AND powered, so a shed
 *     consumer produces nothing and consumes none of its inputs (T006, FR-004);
 *   - it aggregates `storageCapacity` across operating structures and `ledger.ts` reports
 *     the excess as `Overflow` rather than discarding it (T007, FR-003).
 *
 * So US1's deliverable is one catalog ENTRY plus this suite proving the generic machinery
 * carries it — which is exactly FR-002's claim ("catalog data only, no new code branch")
 * being demonstrated rather than asserted. A second production module would have had to
 * re-derive the completion rule, the powered rule and the capacity rule, and the two copies
 * would have drifted; that is the `aic-c1p`/`aic-8eq` shape this project has paid for three
 * times.
 *
 * Everything below therefore uses the production path: `queueConstruction` sites the
 * structures (validating placement and writing grid occupancy), `createColony` builds the
 * state, `resolveTurn` runs the turn. The only fixture is a generator, because chain 1 has
 * no power source of its own.
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import {
  HOPPER_REGOLITH_PER_TURN_G,
  PRESS_PLATE_PER_TURN_G,
  PRESS_REGOLITH_PER_TURN_G,
  REGOLITH,
  REGOLITH_HOPPER_ID,
  SHIELD_BERM_ID,
  SINTERED_PLATE,
  SINTER_PRESS_ID,
  chainOneStructureSpecs,
} from '../../src/sim/catalog-data'
import { queueConstruction, totalLabourHoursRequired } from '../../src/sim/construction'
import type { ConstructionQueue } from '../../src/sim/construction'
import { createGrid } from '../../src/sim/grid'
import type { Coord, Grid } from '../../src/sim/grid'
import type { DroneId } from '../../src/sim/drones'
import type { Stockpile } from '../../src/sim/ledger'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState, CycleReport } from '../../src/sim/turn'
import { expectDeterministic } from './turn-harness'

const CONFIG = DEFAULT_TURN_CYCLE

/** The Hopper's authored per-turn draw: 595,917 Wh. Read from the entry, never re-derived. */
const HOPPER_WH = chainType(REGOLITH_HOPPER_ID).consumes[ELECTRICITY] ?? 0

/** The Hopper's authored regolith cap: 675,000,000 g. */
const CAP = chainType(REGOLITH_HOPPER_ID).storageCapacity[REGOLITH] ?? 0

function chainType(id: string): StructureType {
  const found = getStructureType(createCatalog(chainOneStructureSpecs(CONFIG)), id)
  if (found === undefined) throw new Error(`chain 1 catalog is missing "${id}"`)
  return found
}

/**
 * A pure generator with no draw, producing an exact watt-hour figure for the turn.
 *
 * A TEST FIXTURE, not catalog data: chain 1 has no power source of its own. Stated in
 * watt-hours rather than watts because the brownout boundary tests need "one watt-hour less
 * than the Hopper draws", and expressing that as a wattage would need a division whose
 * result rounds straight back to the same watt-hour count. `buildTurns: 0` so it is
 * complete on arrival — the landed-starship case `catalog.ts` already documents.
 */
function generatorAtWh(wattHours: number): StructureType {
  const catalog = createCatalog([
    {
      id: 'generator',
      name: 'Test Generator',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 0,
      produces: { [ELECTRICITY]: wattHours },
      consumes: {},
      habitatCapacity: 0,
    },
  ])
  const found = getStructureType(catalog, 'generator')
  if (found === undefined) throw new Error('generator fixture failed to validate')
  return found
}

/** The same fixture stated as a continuous wattage, converted exactly as a catalog author would. */
function generator(watts: number): StructureType {
  return generatorAtWh(energyPerTurnWh(watts, CONFIG))
}

interface Sited {
  readonly id: string
  readonly structureType: StructureType
  readonly anchor: Coord
  /** Whether it arrives with its full labour already applied. Defaults to `true`. */
  readonly complete?: boolean
}

interface ColonyOptions {
  readonly stockpiles?: Stockpile
  readonly droneRoster?: readonly DroneId[]
  readonly offlineStructureIds?: readonly string[]
}

/**
 * Build a colony with `sited` structures placed through `queueConstruction`.
 *
 * Completion is expressed as accumulated labour reaching `totalLabourHoursRequired`, which
 * is how a genuinely-built structure reaches completion — never by setting a flag, because
 * `isProjectComplete` derives completion from labour and a flag would bypass the very rule
 * under test.
 */
function colony(sited: readonly Sited[], options: ColonyOptions = {}): ColonyState {
  let grid: Grid = createGrid(16, 16)
  let queue: ConstructionQueue = []

  for (const entry of sited) {
    const placed = queueConstruction(grid, entry.id, entry.structureType, entry.anchor)
    if (!placed.ok) {
      throw new Error(`could not site ${entry.id}: ${placed.reason}`)
    }
    grid = placed.grid
    const complete = entry.complete ?? true
    queue = [
      ...queue,
      complete
        ? {
            ...placed.project,
            accumulatedLabourHours: totalLabourHoursRequired(entry.structureType, CONFIG),
          }
        : placed.project,
    ]
  }

  return createColony(
    { turnCycle: CONFIG, incomingWaveSize: 8 },
    {
      grid,
      queue,
      droneRoster: options.droneRoster ?? [],
      stockpiles: options.stockpiles ?? {},
      offlineStructureIds: options.offlineStructureIds ?? [],
    },
  )
}

/** A completed Hopper plus a generator of `watts`. The base scenario for most tests below. */
function hopperColony(watts: number, options: ColonyOptions = {}): ColonyState {
  return colony(
    [
      { id: 'gen', structureType: generator(watts), anchor: { x: 0, y: 0 } },
      { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
    ],
    options,
  )
}

/** Run `turns` turns, returning every report and the final state. */
function run(
  initial: ColonyState,
  turns: number,
): { readonly state: ColonyState; readonly reports: readonly CycleReport[] } {
  let state = initial
  const reports: CycleReport[] = []
  for (let index = 0; index < turns; index++) {
    const resolved = resolveTurn(state)
    state = resolved.state
    reports.push(resolved.report)
  }
  return { state, reports }
}

function balance(report: CycleReport, resource: string): number {
  return report.balances.find((entry) => entry.resource === resource)?.net ?? 0
}

describe('US1 — a powered Hopper extracts regolith (FR-006)', () => {
  it('should raise the pile by exactly 60,000,000 g in one turn', () => {
    const { state, reports } = run(hopperColony(REACTOR_OUTPUT_WATTS), 1)
    const report = reports[0]!

    expect(state.stockpiles[REGOLITH]).toBe(HOPPER_REGOLITH_PER_TURN_G)
    expect(state.stockpiles[REGOLITH]).toBe(60_000_000)
    expect(balance(report, REGOLITH)).toBe(60_000_000)
    expect(report.shortfalls).toEqual([])
    expect(report.overflow).toEqual([])
  })

  it('should draw exactly its authored watt-hours and appear as powered', () => {
    const { reports } = run(hopperColony(REACTOR_OUTPUT_WATTS), 1)
    const { electricity } = reports[0]!

    expect(electricity.structureDemandWh).toBe(HOPPER_WH)
    expect(electricity.suppliedWh).toBe(HOPPER_WH)
    expect(electricity.poweredStructureIds).toContain('hopper')
    expect(electricity.shedStructureIds).toEqual([])
    expect(electricity.brownout).toBe(false)
  })

  it('should accumulate linearly across turns with no drift', () => {
    const { state, reports } = run(hopperColony(REACTOR_OUTPUT_WATTS), 5)

    expect(state.stockpiles[REGOLITH]).toBe(5 * 60_000_000)
    for (const report of reports) {
      expect(balance(report, REGOLITH)).toBe(60_000_000)
      expect(report.overflow).toEqual([])
    }
  })

  it('should be deterministic — the same state resolved twice gives the same result', () => {
    const state = hopperColony(REACTOR_OUTPUT_WATTS, { stockpiles: { [REGOLITH]: 12_345_000 } })
    const first = resolveTurn(state)
    const second = resolveTurn(state)

    expect(first.state.stockpiles).toEqual(second.state.stockpiles)
    expect(first.report).toEqual(second.report)
  })

  it('should produce an identical 14-turn trace across two independent runs', () => {
    // The whole US1 trace, through the existing determinism harness rather than a
    // hand-rolled comparison: two runs from independently-constructed initial state,
    // spanning construction, steady extraction, cap saturation and reported overflow.
    // `runTrace` additionally asserts the step neither mutates nor returns its input state.
    expectDeterministic<{ readonly colony: ColonyState; readonly report: CycleReport | null }>({
      label: 'regolith-us1-one-hopper-14-turns',
      initial: () => ({
        colony: colony(
          [
            { id: 'gen', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 0, y: 0 } },
            {
              id: 'hopper',
              structureType: chainType(REGOLITH_HOPPER_ID),
              anchor: { x: 4, y: 4 },
              complete: false,
            },
          ],
          { droneRoster: ['drone-0', 'drone-1'] },
        ),
        report: null,
      }),
      step: (state) => {
        const resolved = resolveTurn(state.colony)
        return { colony: resolved.state, report: resolved.report }
      },
      turns: 14,
      project: (state) => ({
        turn: state.colony.turnsTaken,
        stockpiles: state.colony.stockpiles,
        overflow: state.report?.overflow ?? [],
        shed: state.report?.electricity.shedStructureIds ?? [],
        completed: state.report?.completedThisTurn ?? [],
      }),
    })
  })
})

describe('US1 — an unfinished Hopper produces nothing (acceptance scenario 2)', () => {
  it('should produce nothing and draw nothing while under construction', () => {
    const state = colony([
      { id: 'gen', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 0, y: 0 } },
      {
        id: 'hopper',
        structureType: chainType(REGOLITH_HOPPER_ID),
        anchor: { x: 4, y: 4 },
        complete: false,
      },
    ])
    const { state: next, reports } = run(state, 1)
    const report = reports[0]!

    expect(next.stockpiles[REGOLITH]).toBeUndefined()
    expect(report.electricity.structureDemandWh).toBe(0)
    // Neither a brownout victim nor a beneficiary: it has no operational systems yet.
    expect(report.electricity.poweredStructureIds).not.toContain('hopper')
    expect(report.electricity.shedStructureIds).not.toContain('hopper')
  })

  it('should need exactly 2 build-turns of labour, then produce from the FOLLOWING turn', () => {
    // Two drones yield 50 labour-hours a turn, which is exactly the Hopper's 2 build turns
    // (25 h each). So it completes during turn 1 — and must still produce NOTHING that
    // turn, because production is judged on START-of-turn completion (`turn.ts` ordering
    // note 2). A structure that produced on its own completion turn would get a free turn.
    expect(totalLabourHoursRequired(chainType(REGOLITH_HOPPER_ID), CONFIG)).toBe(50)

    const state = colony(
      [
        { id: 'gen', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 0, y: 0 } },
        {
          id: 'hopper',
          structureType: chainType(REGOLITH_HOPPER_ID),
          anchor: { x: 4, y: 4 },
          complete: false,
        },
      ],
      { droneRoster: ['drone-0', 'drone-1'] },
    )

    const { reports } = run(state, 3)

    expect(reports[0]!.labourHoursApplied).toBe(50)
    expect(reports[0]!.completedThisTurn).toEqual(['hopper'])
    expect(balance(reports[0]!, REGOLITH)).toBe(0)
    expect(balance(reports[1]!, REGOLITH)).toBe(60_000_000)
    expect(balance(reports[2]!, REGOLITH)).toBe(60_000_000)
  })
})

describe('US1 — binary idle under brownout (FR-004, acceptance scenario 3)', () => {
  it('should produce ZERO, not a fraction, when the budget is one watt-hour short', () => {
    // The Hopper's own demand minus 1 Wh — built from the Hopper's authored figure rather
    // than from a wattage, so nothing else draws and this is a pure one-watt-hour miss:
    // the sharpest possible test that the rule is a comparison and not a ratio.
    const nearlyEnough = colony([
      { id: 'gen', structureType: generatorAtWh(HOPPER_WH - 1), anchor: { x: 0, y: 0 } },
      { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
    ])
    const { state: next, reports } = run(nearlyEnough, 1)
    const report = reports[0]!

    expect(report.electricity.brownout).toBe(true)
    expect(report.electricity.shedStructureIds).toEqual(['hopper'])
    expect(report.electricity.cutLine).toBe(0)
    expect(report.electricity.suppliedWh).toBe(0)
    // Zero, not 99.99% of 60,000,000: a shed structure's flow never reaches the ledger.
    expect(next.stockpiles[REGOLITH]).toBeUndefined()
    expect(balance(report, REGOLITH)).toBe(0)
    expect(report.overflow).toEqual([])
  })

  it('should run at FULL rate when the budget is exactly its demand — an inclusive boundary', () => {
    // No epsilon is needed anywhere because both sides are integers.
    const exact = colony([
      { id: 'gen', structureType: generatorAtWh(HOPPER_WH), anchor: { x: 0, y: 0 } },
      { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
    ])
    const { state: next, reports } = run(exact, 1)

    expect(reports[0]!.electricity.brownout).toBe(false)
    expect(reports[0]!.electricity.unusedWh).toBe(0)
    expect(next.stockpiles[REGOLITH]).toBe(60_000_000)
  })

  it('should keep the pile it already holds while shed — a bin does not empty when unpowered', () => {
    const shed = colony(
      [
        { id: 'gen', structureType: generatorAtWh(HOPPER_WH - 1), anchor: { x: 0, y: 0 } },
        { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
      ],
      { stockpiles: { [REGOLITH]: CAP } },
    )
    const { state: next, reports } = run(shed, 1)

    // Storage capacity is granted by an OPERATING structure, not a POWERED one, so the cap
    // survives the brownout and the pile sits at exactly capacity with nothing to discard.
    expect(next.stockpiles[REGOLITH]).toBe(CAP)
    expect(reports[0]!.overflow).toEqual([])
  })
})

describe('US1 — capped pile with cap-and-report overflow (FR-003, acceptance scenario 4)', () => {
  it('should fill to 660,000,000 g by turn 11 with no overflow', () => {
    const { state, reports } = run(hopperColony(REACTOR_OUTPUT_WATTS), 11)

    expect(state.stockpiles[REGOLITH]).toBe(11 * 60_000_000)
    expect(state.stockpiles[REGOLITH]).toBeLessThan(CAP)
    for (const report of reports) expect(report.overflow).toEqual([])
  })

  it('should clamp to exactly the cap on turn 12 and report the 45,000,000 g discarded', () => {
    // 660,000,000 + 60,000,000 = 720,000,000 against a 675,000,000 cap.
    const { state, reports } = run(hopperColony(REACTOR_OUTPUT_WATTS), 12)

    expect(state.stockpiles[REGOLITH]).toBe(CAP)
    expect(reports[11]!.overflow).toEqual([{ resource: REGOLITH, amount: 45_000_000 }])
  })

  it('should report a WHOLE turn of overflow once the pile sits exactly at capacity', () => {
    const { state, reports } = run(
      hopperColony(REACTOR_OUTPUT_WATTS, { stockpiles: { [REGOLITH]: CAP } }),
      1,
    )

    expect(state.stockpiles[REGOLITH]).toBe(CAP)
    expect(reports[0]!.overflow).toEqual([{ resource: REGOLITH, amount: 60_000_000 }])
  })

  it('should never discard silently — reported overflow equals produced minus accepted', () => {
    // The whole point of `Overflow` being structured data. If a surplus ever vanished
    // without a report this identity would break, and it is the only check that can see it.
    let previous = 0
    const { reports } = run(hopperColony(REACTOR_OUTPUT_WATTS), 14)
    for (const report of reports) {
      const produced = balance(report, REGOLITH)
      const accepted = (report.overflow.length === 0 ? produced : CAP - previous)
      const reported = report.overflow.find((entry) => entry.resource === REGOLITH)?.amount ?? 0
      expect(reported).toBe(produced - accepted)
      previous += accepted
    }
    expect(previous).toBe(CAP)
  })

  it('should be UNCAPPED and unproductive when the Hopper is offline', () => {
    // An offline structure grants no capacity and produces nothing: the pile is frozen
    // exactly as it was, and an uncapped stock is unbounded rather than overflowing.
    const { state, reports } = run(
      hopperColony(REACTOR_OUTPUT_WATTS, {
        stockpiles: { [REGOLITH]: CAP },
        offlineStructureIds: ['hopper'],
      }),
      1,
    )

    expect(state.stockpiles[REGOLITH]).toBe(CAP)
    expect(reports[0]!.overflow).toEqual([])
    expect(reports[0]!.electricity.structureDemandWh).toBe(0)
  })
})

describe('US1 — the 40x over-feed is real, not just authored (the chain lesson)', () => {
  it('should have one Hopper out-produce one Press by more than 40x, turn after turn', () => {
    // Two reactor units, because the pair draws 105% of one (SC-001).
    const pair = colony([
      { id: 'gen-1', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 0, y: 0 } },
      { id: 'gen-2', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 2, y: 0 } },
      { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
      { id: 'press', structureType: chainType(SINTER_PRESS_ID), anchor: { x: 8, y: 8 } },
    ])
    const { state, reports } = run(pair, 8)

    // The Press eats 1.4 t of the Hopper's 60 t, so the pile still grows by 58.6 t a turn.
    // That NET being positive — and this large — IS the over-feed: the extraction stage
    // cannot be the constraint, so power spent on presses is the only lever that matters.
    for (const report of reports) {
      expect(balance(report, REGOLITH)).toBe(HOPPER_REGOLITH_PER_TURN_G - PRESS_REGOLITH_PER_TURN_G)
      expect(balance(report, SINTERED_PLATE)).toBe(PRESS_PLATE_PER_TURN_G)
      expect(report.electricity.brownout).toBe(false)
      expect(report.shortfalls).toEqual([])
    }
    expect(state.stockpiles[REGOLITH]).toBe(8 * 58_600_000)
    expect(state.stockpiles[SINTERED_PLATE]).toBe(8 * 1_200_000)
  })

  it('should let the Press bite on the same turn its feedstock is dug, from an empty pile', () => {
    // Flows net WITHIN the turn, so a Press starting against an empty stockpile is not
    // short — the Hopper's 60 t and the Press's 1.4 t are one balance. A shortfall here
    // would mean the chain could never start without a seeded pile.
    const pair = colony([
      { id: 'gen-1', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 0, y: 0 } },
      { id: 'gen-2', structureType: generator(REACTOR_OUTPUT_WATTS), anchor: { x: 2, y: 0 } },
      { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
      { id: 'press', structureType: chainType(SINTER_PRESS_ID), anchor: { x: 8, y: 8 } },
    ])
    const { reports } = run(pair, 1)

    expect(reports[0]!.shortfalls).toEqual([])
    expect(balance(reports[0]!, SINTERED_PLATE)).toBe(1_200_000)
  })

  it('should shed the Hopper BEFORE the Press when the budget covers only one', () => {
    // The ordering that reads backwards until you look at the numbers: the abundant stage
    // goes dark first, because its output was overflowing anyway. Budget covers the Press
    // (1,489,792 Wh) but not both (2,085,709 Wh).
    const pressWh = chainType(SINTER_PRESS_ID).consumes[ELECTRICITY] ?? 0
    const tight = colony(
      [
        { id: 'gen', structureType: generatorAtWh(pressWh), anchor: { x: 0, y: 0 } },
        { id: 'hopper', structureType: chainType(REGOLITH_HOPPER_ID), anchor: { x: 4, y: 4 } },
        { id: 'press', structureType: chainType(SINTER_PRESS_ID), anchor: { x: 8, y: 8 } },
      ],
      { stockpiles: { [REGOLITH]: 10_000_000 } },
    )
    const { state, reports } = run(tight, 1)

    expect(reports[0]!.electricity.poweredStructureIds).toContain('press')
    expect(reports[0]!.electricity.shedStructureIds).toEqual(['hopper'])
    // The Press ran on the existing pile; the Hopper added nothing.
    expect(state.stockpiles[REGOLITH]).toBe(10_000_000 - PRESS_REGOLITH_PER_TURN_G)
    expect(state.stockpiles[SINTERED_PLATE]).toBe(PRESS_PLATE_PER_TURN_G)
  })
})

describe('US1 — the entries need no new placement rule (FR-002)', () => {
  it('should site the L-shaped Press by validating every one of its three tiles', () => {
    const press = chainType(SINTER_PRESS_ID)
    const grid = createGrid(16, 16)
    const placed = queueConstruction(grid, 'press', press, { x: 5, y: 5 })

    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    expect(placed.project.tiles).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ])
  })

  it('should refuse the L-shaped Press when only its NON-anchor tile is blocked', () => {
    // The anchor is free, so a placement rule that checked only the anchor would wrongly
    // accept this. Blocking (6,6) — the far end of the L — is what proves every tile is
    // checked, and it needs no knowledge of what a Sinter Press is.
    const press = chainType(SINTER_PRESS_ID)
    const hopper = chainType(REGOLITH_HOPPER_ID)
    const blocked = queueConstruction(createGrid(16, 16), 'hopper', hopper, { x: 6, y: 6 })
    expect(blocked.ok).toBe(true)
    if (!blocked.ok) return

    const placed = queueConstruction(blocked.grid, 'press', press, { x: 5, y: 5 })
    expect(placed.ok).toBe(false)
  })

  it('should site the 12-tile Berm ring and leave its 2x2 interior free for a habitat', () => {
    const berm = chainType(SHIELD_BERM_ID)
    const placed = queueConstruction(createGrid(16, 16), 'berm', berm, { x: 4, y: 4 })

    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    expect(placed.project.tiles).toHaveLength(12)
    // The interior is untouched, so a 2x2 module still fits inside the ring.
    const hopper = chainType(REGOLITH_HOPPER_ID)
    const inside = queueConstruction(placed.grid, 'inner', hopper, { x: 5, y: 5 })
    expect(inside.ok).toBe(true)
  })
})
