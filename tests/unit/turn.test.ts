/**
 * Tests for deterministic turn resolution (aic-a00.6).
 *
 * This is the module the whole audit was about: before it, every top-level sim
 * operation had ZERO production callers and the game could not run a single turn
 * (aic-8eq). So the tests that matter most here are not the field-by-field checks —
 * they are the ones that pin the ORDER, because the ordering decisions are invisible
 * and would otherwise be settled by whatever sequence someone happened to type:
 *
 *   - `should not let a structure completed this turn produce this turn` pins the
 *     start-of-turn operational freeze that breaks the power/labour/completion cycle.
 *   - `should count a habitat completed on the deadline turn toward the verdict` pins
 *     the deliberate asymmetry against it. Those two look contradictory and are not.
 *   - `should not mutate the state it was given` and the determinism suite pin the
 *     acceptance criteria verbatim.
 */

import { describe, expect, it } from 'vitest'

import {
  PRIORITY_HABITAT,
  PRIORITY_PROCESSOR_UPSTREAM,
  rationaleForPriority,
} from '../../src/sim/brownout'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { createProject, requiredLabourHoursPerBuildTurn } from '../../src/sim/construction'
import type { ConstructionProject } from '../../src/sim/construction'
import { createGrid } from '../../src/sim/grid'
import { validatePlacement } from '../../src/sim/placement'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE, MISSION_DEADLINE_SECONDS, totalTurns } from '../../src/sim/time'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'

const CONFIG = DEFAULT_TURN_CYCLE
const HOURS_PER_BUILD_TURN = requiredLabourHoursPerBuildTurn(CONFIG)

const CATALOG = createCatalog([
  {
    id: 'reactor',
    name: 'Fission Surface Power Unit',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 4,
    produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'habitat',
    name: 'Habitat Module',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 6,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(32_000, CONFIG) },
    standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(6_400, CONFIG) },
    priorityClass: PRIORITY_HABITAT,
    habitatCapacity: 8,
  },
  {
    id: 'hopper',
    name: 'Regolith Hopper',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 3,
    produces: { regolith: 60_000_000 },
    consumes: { [ELECTRICITY]: energyPerTurnWh(12_000, CONFIG) },
    priorityClass: PRIORITY_PROCESSOR_UPSTREAM,
    habitatCapacity: 0,
  },
  // The two below exist only for the ledger-attribution seam test (aic-svp): two
  // DIFFERENT structure types (so their per-instance regolith draw genuinely differs,
  // which a single type with two instances could not show — see that test's comment)
  // consuming a resource nothing in this file's catalog PRODUCES, so a colony built
  // from them alone runs a real, colony-driven shortfall rather than a hand-built one.
  {
    id: 'crusher-small',
    name: 'Ore Crusher (small)',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 2,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(5_000, CONFIG), regolith: 300 },
    habitatCapacity: 0,
  },
  {
    id: 'crusher-large',
    name: 'Ore Crusher (large)',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 2,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(5_000, CONFIG), regolith: 500 },
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

/** A project sited at a free tile, optionally pre-advanced to a given build progress. */
function project(id: string, typeId: string, x: number, buildTurnsDone = 0): ConstructionProject {
  const grid = createGrid(24, 24)
  const placement = validatePlacement(grid, type(typeId), { x, y: 0 })
  if (!placement.ok) throw new Error(`test setup: ${id} did not fit`)
  const fresh = createProject(id, type(typeId), placement)
  return { ...fresh, accumulatedLabourHours: buildTurnsDone * HOURS_PER_BUILD_TURN }
}

/** A finished project of `typeId` — enough accumulated labour to be operational. */
function done(id: string, typeId: string, x: number): ConstructionProject {
  return project(id, typeId, x, type(typeId).buildTurns)
}

function colony(overrides: Partial<ColonyState> = {}): ColonyState {
  return {
    ...createColony({ turnCycle: CONFIG, incomingWaveSize: 8 }, { grid: createGrid(24, 24) }),
    ...overrides,
  }
}

function roster(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `drone-${String(i).padStart(2, '0')}`)
}

describe('createColony', () => {
  it('should produce a colony at turn zero with nothing built', () => {
    const state = createColony({ turnCycle: CONFIG, incomingWaveSize: 8 })
    expect(state.turnsTaken).toBe(0)
    expect(state.queue).toEqual([])
    expect(state.droneRoster).toEqual([])
    expect(state.stockpiles).toEqual({})
    expect(state.offlineStructureIds).toEqual([])
  })

  it('should accept an initial grid, roster, queue and stockpiles', () => {
    const state = createColony(
      { turnCycle: CONFIG, incomingWaveSize: 8 },
      {
        grid: createGrid(8, 8),
        droneRoster: ['drone-01'],
        queue: [done('r-1', 'reactor', 0)],
        stockpiles: { regolith: 500 },
      },
    )
    expect(state.grid.width).toBe(8)
    expect(state.droneRoster).toEqual(['drone-01'])
    expect(state.queue).toHaveLength(1)
    expect(state.stockpiles).toEqual({ regolith: 500 })
  })

  it('should reject a duplicate drone id at construction time', () => {
    // Caught here rather than deep inside the first turn's brownout, where the error
    // would name a grid consumer and give no hint that the roster was malformed.
    expect(() =>
      createColony({ turnCycle: CONFIG, incomingWaveSize: 8 }, { droneRoster: ['d1', 'd1'] }),
    ).toThrow(RangeError)
  })

  it('should reject an empty drone id at construction time', () => {
    // An empty id is not merely invalid, it is unorderable: brownout priority breaks
    // ties on ascending id, so an empty string would sort ahead of every real drone and
    // silently take charging priority over the whole fleet.
    expect(() =>
      createColony({ turnCycle: CONFIG, incomingWaveSize: 8 }, { droneRoster: ['d1', ''] }),
    ).toThrow(/drone id must not be an empty string/)
  })

  it('should reject an empty project id at construction time', () => {
    const broken = { ...done('x', 'reactor', 0), id: '' }
    expect(() =>
      createColony({ turnCycle: CONFIG, incomingWaveSize: 8 }, { queue: [broken] }),
    ).toThrow(/construction project id must not be an empty string/)
  })

  it('should reject a duplicate project id at construction time', () => {
    expect(() =>
      createColony(
        { turnCycle: CONFIG, incomingWaveSize: 8 },
        { queue: [done('x', 'reactor', 0), done('x', 'hopper', 2)] },
      ),
    ).toThrow(/x/)
  })
})

describe('resolveTurn — the acceptance criteria', () => {
  it('should return a NEW state and not mutate the input', () => {
    const before = colony({ queue: [done('r-1', 'reactor', 0)], droneRoster: roster(3) })
    const snapshot = JSON.parse(JSON.stringify(before)) as unknown

    const after = resolveTurn(before)

    expect(after.state).not.toBe(before)
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot)
  })

  it('should yield identical output when the same state is resolved repeatedly', () => {
    const state = colony({
      queue: [done('r-1', 'reactor', 0), project('hab-1', 'habitat', 2)],
      droneRoster: roster(5),
      stockpiles: { regolith: 1_000 },
    })
    expect(resolveTurn(state)).toEqual(resolveTurn(state))
    expect(resolveTurn(state)).toEqual(resolveTurn(state))
  })

  it('should resolve an empty colony as a safe no-op that still advances the clock', () => {
    // "Safe no-op" means nothing crashes and nothing is invented — NOT that the clock
    // stops. A turn passing on an empty colony is exactly what losing looks like.
    const { state, report } = resolveTurn(colony())

    expect(state.turnsTaken).toBe(1)
    expect(state.queue).toEqual([])
    expect(state.stockpiles).toEqual({})
    expect(report.electricity.generationWh).toBe(0)
    expect(report.electricity.brownout).toBe(false)
    expect(report.labourHoursApplied).toBe(0)
    expect(report.habitatCapacity).toBe(0)
    expect(report.mission.status).toBe('in-progress')
  })

  it('should advance the clock by exactly one turn', () => {
    let state = colony()
    for (let expected = 1; expected <= 5; expected++) {
      state = resolveTurn(state).state
      expect(state.turnsTaken).toBe(expected)
    }
  })

  it('should expose its sub-step order as data, and resolve in that order', () => {
    // The ordering is the module's whole contract, so it is asserted rather than left
    // to a comment that can drift from the code (the aic-c1p defect class).
    const { report } = resolveTurn(colony())
    expect(report.steps).toEqual([
      'freeze-operational-set',
      'resolve-electricity',
      'advance-construction',
      'apply-ledger',
      'advance-clock',
      'evaluate-mission',
    ])
  })
})

describe('resolveTurn — the start-of-turn operational freeze', () => {
  it('should not let a structure completed this turn produce this turn', () => {
    // THE ordering decision that breaks the dependency cycle
    // (power <- completion <- labour <- power). The operational set is frozen from
    // START-of-turn progress, so a hopper that finishes during this turn's
    // construction step produces nothing until the next turn. Resolving construction
    // first would silently grant it a free turn of output on its completion turn.
    const oneTurnShort = type('hopper').buildTurns - 1
    // A THREE-drone roster, deliberately. With ten, drone charging (priority 300)
    // outranks the hopper (priority 500) and takes the whole reactor, so the hopper
    // would be shed on turn 2 for a completely different reason and this test would
    // pass while proving nothing. See the dedicated test for that behaviour below.
    const state = colony({
      queue: [done('r-1', 'reactor', 0), project('hop-1', 'hopper', 2, oneTurnShort)],
      droneRoster: roster(3),
    })

    const { state: next, report } = resolveTurn(state)

    // It finished this turn...
    expect(report.completedThisTurn).toEqual(['hop-1'])
    // ...and produced nothing.
    expect(next.stockpiles.regolith ?? 0).toBe(0)
    expect(report.electricity.poweredStructureIds).not.toContain('hop-1')

    // Next turn it is operational and produces.
    const after = resolveTurn(next)
    expect(after.state.stockpiles.regolith).toBe(60_000_000)
  })

  it('should not charge a structure completed this turn for power this turn', () => {
    const oneTurnShort = type('habitat').buildTurns - 1
    const state = colony({
      queue: [done('r-1', 'reactor', 0), project('hab-1', 'habitat', 2, oneTurnShort)],
      droneRoster: roster(10),
    })
    const { report } = resolveTurn(state)
    expect(report.electricity.structureDemandWh).toBe(0)
  })

  it('should let drone charging starve a processor, not the other way round', () => {
    // The brownout order's most consequential consequence, surfaced through the full
    // turn: a large roster outranks every processor, so growing the fleet can switch
    // the factories off. That is the intended tension — drone-hours are unrecoverable
    // against a fixed deadline while a shed processor loses only one turn of output —
    // and it is exactly the behaviour the previous rule had backwards (audit B4).
    const state = colony({
      queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)],
      droneRoster: roster(10),
    })
    const { state: next, report } = resolveTurn(state)

    // One reactor charges 7 of the 10 drones, and nothing is left for the hopper.
    expect(report.electricity.dronesOnShift).toHaveLength(7)
    expect(report.electricity.shedStructureIds).toEqual(['hop-1'])
    expect(next.stockpiles.regolith ?? 0).toBe(0)

    // A second reactor buys the hopper back — and, monotonically, costs no drone.
    const withTwo = resolveTurn({
      ...state,
      queue: [...state.queue, done('r-2', 'reactor', 4)],
    })
    expect(withTwo.report.electricity.dronesOnShift).toHaveLength(10)
    expect(withTwo.report.electricity.shedStructureIds).toEqual([])
    expect(withTwo.state.stockpiles.regolith).toBe(60_000_000)
  })

  it('should exclude an offline structure from generation and demand', () => {
    const online = resolveTurn(colony({ queue: [done('r-1', 'reactor', 0)] }))
    const offline = resolveTurn(
      colony({ queue: [done('r-1', 'reactor', 0)], offlineStructureIds: ['r-1'] }),
    )
    expect(online.report.electricity.generationWh).toBeGreaterThan(0)
    expect(offline.report.electricity.generationWh).toBe(0)
  })
})

describe('resolveTurn — power, labour and construction chain', () => {
  it('should turn reactor output into drones into construction progress', () => {
    const state = colony({
      queue: [done('r-1', 'reactor', 0), project('hab-1', 'habitat', 2)],
      droneRoster: roster(40),
    })
    const { state: next, report } = resolveTurn(state)

    expect(report.electricity.dronesOnShift.length).toBeGreaterThan(0)
    expect(report.labourHoursApplied).toBeGreaterThan(0)
    const habitat = next.queue.find((p) => p.id === 'hab-1')!
    expect(habitat.accumulatedLabourHours).toBe(report.labourHoursApplied)
  })

  it('should grant labour only in whole build-turns', () => {
    // aic-chg's ruling, preserved through composition: the turn loop must not
    // reintroduce partial funding by handing construction a fractional figure.
    const state = colony({
      queue: [done('r-1', 'reactor', 0), project('hab-1', 'habitat', 2)],
      droneRoster: roster(40),
    })
    const { state: next } = resolveTurn(state)
    const habitat = next.queue.find((p) => p.id === 'hab-1')!
    expect(habitat.accumulatedLabourHours % HOURS_PER_BUILD_TURN).toBe(0)
  })

  it('should make no construction progress with no drones', () => {
    const state = colony({ queue: [project('hab-1', 'habitat', 2)], droneRoster: [] })
    const { state: next, report } = resolveTurn(state)
    expect(report.labourHoursApplied).toBe(0)
    expect(next.queue[0]!.accumulatedLabourHours).toBe(0)
  })

  it('should make no construction progress with drones but no power', () => {
    // The co-binding, from the other side: a full roster and no reactor builds nothing.
    const state = colony({ queue: [project('hab-1', 'habitat', 2)], droneRoster: roster(40) })
    const { report } = resolveTurn(state)
    expect(report.electricity.dronesOnShift).toEqual([])
    expect(report.labourHoursApplied).toBe(0)
  })

  it('should report labour that no queued project could absorb', () => {
    // Distinguishes "the build queue is fully staffed" from a bug that dropped labour.
    const state = colony({ queue: [done('r-1', 'reactor', 0)], droneRoster: roster(40) })
    const { report } = resolveTurn(state)
    expect(report.labourHoursApplied).toBe(0)
    expect(report.labourHoursUnused).toBe(report.electricity.labourCapacityHours)
  })
})

describe('resolveTurn — the ledger', () => {
  it('should credit production only from powered, operational structures', () => {
    const state = colony({
      queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)],
      droneRoster: [],
    })
    const { state: next, report } = resolveTurn(state)
    expect(report.electricity.poweredStructureIds).toContain('hop-1')
    expect(next.stockpiles.regolith).toBe(60_000_000)
  })

  it('should credit nothing from a shed structure', () => {
    // Binary idle through the whole composition: no reactor means the hopper is shed,
    // and a shed hopper produces nothing rather than a reduced amount.
    const state = colony({ queue: [done('hop-1', 'hopper', 2)], droneRoster: [] })
    const { state: next, report } = resolveTurn(state)
    expect(report.electricity.shedStructureIds).toEqual(['hop-1'])
    expect(next.stockpiles.regolith ?? 0).toBe(0)
  })

  it('should accumulate mass resources across turns but never electricity', () => {
    let state = colony({
      queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)],
      droneRoster: [],
    })
    for (let i = 0; i < 5; i++) state = resolveTurn(state).state

    expect(state.stockpiles.regolith).toBe(60_000_000 * 5)
    // The General's ruling, preserved through composition.
    expect(state.stockpiles[ELECTRICITY]).toBe(0)
  })

  it('should cap a stockpile at the capacity its operating structures grant', () => {
    // aic-7f5. The aggregation only turn resolution can do: catalog.ts declares a cap per
    // structure TYPE, and the colony's real capacity is the sum over structures actually
    // in service.
    const silo = createCatalog([
      {
        id: 'silo',
        name: 'Regolith Silo',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 1,
        produces: {},
        consumes: {},
        storageCapacity: { regolith: 20_000_000 },
        habitatCapacity: 0,
      },
    ]).types.get('silo')!

    const withSilo = colony({
      queue: [
        done('r-1', 'reactor', 0),
        done('hop-1', 'hopper', 2),
        { ...project('silo-1', 'hopper', 4), structureType: silo, accumulatedLabourHours: 10_000 },
      ],
      droneRoster: [],
    })

    const { state: next, report } = resolveTurn(withSilo)
    // The hopper made 60,000,000 g; the colony can hold 20,000,000 g.
    expect(next.stockpiles.regolith).toBe(20_000_000)
    expect(report.overflow).toEqual([{ resource: 'regolith', amount: 40_000_000 }])
  })

  it('should grant no capacity from an unfinished or offline silo', () => {
    // Falls out of reusing the frozen operational set: an unbuilt silo holds nothing, so
    // the resource stays unbounded rather than being capped at zero.
    const silo = createCatalog([
      {
        id: 'silo',
        name: 'Regolith Silo',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 5,
        produces: {},
        consumes: {},
        storageCapacity: { regolith: 1_000 },
        habitatCapacity: 0,
      },
    ]).types.get('silo')!

    const { state: next, report } = resolveTurn(
      colony({
        queue: [
          done('r-1', 'reactor', 0),
          done('hop-1', 'hopper', 2),
          // Zero progress: not operating, so it grants nothing.
          { ...project('silo-1', 'hopper', 4), structureType: silo, accumulatedLabourHours: 0 },
        ],
        droneRoster: [],
      }),
    )
    expect(next.stockpiles.regolith).toBe(60_000_000)
    expect(report.overflow).toEqual([])
  })

  it('should leave stockpiles unbounded when nothing declares a capacity', () => {
    // The documented stock default. Not an oversight — see LedgerPolicy.storageCapacity
    // for why an absent stock capacity means unbounded while an absent FLOW capacity
    // means zero, and for the FR-003 tension that leaves it this way until caps are
    // authored.
    const { report } = resolveTurn(
      colony({ queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)], droneRoster: [] }),
    )
    expect(report.overflow).toEqual([])
  })

  it('should report vented electricity every turn a surplus exists', () => {
    const state = colony({ queue: [done('r-1', 'reactor', 0)], droneRoster: [] })
    const { report } = resolveTurn(state)
    const vented = report.vented.find((entry) => entry.resource === ELECTRICITY)
    expect(vented?.amount).toBe(report.electricity.generationWh)
  })

  it('should debit the actual drone recharge energy, not the reserved capacity', () => {
    // The turn-capacity model's two figures, kept straight through the composition:
    // the brownout rations reservations, the ledger debits real energy.
    const state = colony({ queue: [done('r-1', 'reactor', 0)], droneRoster: roster(3) })
    const { report } = resolveTurn(state)
    const electricityBalance = report.balances.find((b) => b.resource === ELECTRICITY)!
    expect(electricityBalance.consumed).toBe(report.electricity.droneEnergyWh)
    expect(electricityBalance.consumed).toBeLessThan(report.electricity.suppliedWh)
  })
})

describe('resolveTurn — habitat standby', () => {
  it('should charge a completed habitat its standby draw while the colony is unmanned', () => {
    const state = colony({ queue: [done('r-1', 'reactor', 0), done('hab-1', 'habitat', 2)] })
    const { report } = resolveTurn(state)
    expect(report.electricity.structureDemandWh).toBe(energyPerTurnWh(6_400, CONFIG))
  })

  it('should still count a habitat in standby toward capacity', () => {
    // Standby is about POWER, not readiness. A completed habitat houses its rated
    // capacity whether or not anyone is inside it yet.
    const state = colony({ queue: [done('r-1', 'reactor', 0), done('hab-1', 'habitat', 2)] })
    expect(resolveTurn(state).report.habitatCapacity).toBe(8)
  })
})

describe('resolveTurn — the mission verdict', () => {
  /** A colony positioned one turn before the deadline. */
  function atDeadlineMinusOne(queue: readonly ConstructionProject[]): ColonyState {
    return colony({ turnsTaken: totalTurns(CONFIG) - 1, queue, droneRoster: roster(40) })
  }

  it('should report in-progress before the deadline', () => {
    expect(resolveTurn(colony()).report.mission.status).toBe('in-progress')
  })

  it('should count a habitat completed on the deadline turn toward the verdict', () => {
    // THE DELIBERATE ASYMMETRY, and it reads like a contradiction with the freeze test
    // above until you see why: production is judged on START-of-turn completion (a
    // structure must not get a free turn of output), while CAPACITY is judged on
    // END-of-turn completion (a habitat finished before the deadline must count).
    // Freezing both would lose the mission on a technicality for a habitat that
    // finished exactly on time.
    const oneShort = type('habitat').buildTurns - 1
    const { report } = resolveTurn(
      atDeadlineMinusOne([done('r-1', 'reactor', 0), project('hab-1', 'habitat', 2, oneShort)]),
    )

    expect(report.completedThisTurn).toContain('hab-1')
    expect(report.habitatCapacity).toBe(8)
    expect(report.mission.status).toBe('won')
  })

  it('should lose when capacity is short at the deadline', () => {
    const { report } = resolveTurn(atDeadlineMinusOne([done('r-1', 'reactor', 0)]))
    expect(report.mission.status).toBe('lost')
    if (report.mission.status === 'in-progress') return
    expect(report.mission.habitatCapacity).toBe(0)
    expect(report.mission.incomingWaveSize).toBe(8)
  })

  it('should not count an unfinished habitat toward the verdict', () => {
    // mission.ts's "9/10 houses nobody" rule, preserved through composition.
    const { report } = resolveTurn(
      atDeadlineMinusOne([project('hab-1', 'habitat', 2, type('habitat').buildTurns - 2)]),
    )
    expect(report.habitatCapacity).toBe(0)
    expect(report.mission.status).toBe('lost')
  })

  it('should keep returning the same verdict after the deadline has passed', () => {
    let state = colony({ turnsTaken: totalTurns(CONFIG), queue: [done('hab-1', 'habitat', 2)] })
    const first = resolveTurn(state).report.mission.status
    state = resolveTurn(state).state
    expect(resolveTurn(state).report.mission.status).toBe(first)
  })
})

describe('resolveTurn — determinism', () => {
  const state = colony({
    queue: [
      done('r-1', 'reactor', 0),
      done('hop-1', 'hopper', 2),
      project('hab-1', 'habitat', 4),
    ],
    droneRoster: ['drone-05', 'drone-01', 'drone-03'],
    stockpiles: { regolith: 7 },
  })

  it('should produce identical results regardless of roster array order', () => {
    const reordered = { ...state, droneRoster: ['drone-03', 'drone-05', 'drone-01'] }
    // The rosters differ only in order, so the resolved states must match exactly
    // apart from the roster field itself, which is carried through unchanged.
    const a = resolveTurn(state)
    const b = resolveTurn(reordered)
    expect(b.report).toEqual(a.report)
    expect({ ...b.state, droneRoster: [] }).toEqual({ ...a.state, droneRoster: [] })
  })

  it('should keep every reported quantity an integer', () => {
    const { report } = resolveTurn(state)
    for (const value of [
      report.labourHoursApplied,
      report.labourHoursUnused,
      report.habitatCapacity,
      report.electricity.generationWh,
      report.electricity.droneEnergyWh,
    ]) {
      expect(Number.isInteger(value)).toBe(true)
    }
    for (const balance of report.balances) {
      expect(Number.isInteger(balance.net)).toBe(true)
    }
  })

  it('should never read the wall clock or an unseeded random source', () => {
    // Guarded structurally by tests/unit/boundary.test.ts across all of src/sim, and
    // behaviourally here: two runs separated in time must agree exactly.
    const first = resolveTurn(state)
    const second = resolveTurn(state)
    expect(second).toEqual(first)
  })

  it('should stay exact over the full mission length', () => {
    // 278 turns of composition with no drift: the property a single-turn test cannot
    // show, and the reason every accumulating quantity is an integer.
    let running = colony({
      queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)],
      droneRoster: roster(4),
    })
    const deadline = totalTurns(CONFIG)
    for (let i = 0; i < deadline; i++) running = resolveTurn(running).state

    expect(running.turnsTaken).toBe(deadline)
    expect(running.stockpiles.regolith).toBe(60_000_000 * deadline)
    expect(running.stockpiles[ELECTRICITY]).toBe(0)
    expect(Number.isInteger(running.stockpiles.regolith!)).toBe(true)
  })

  it('should derive the deadline from the mission config, not a literal', () => {
    expect(totalTurns(CONFIG)).toBe(278)
    expect(CONFIG.missionSeconds).toBe(MISSION_DEADLINE_SECONDS)
  })
})

// ---------------------------------------------------------------------------
// aic-svp: a shed structure's REASON, and a ledger shortfall's per-structure
// attribution, both surviving end-to-end into CycleReport.
// ---------------------------------------------------------------------------
// docs/turn-composition-audit.md E4: before this, the colony could compute that it was
// short some resource, or that a structure went dark, but never say WHICH structure or
// WHY. Both tests below run a REAL colony through `resolveTurn` — the actual
// construction/power/brownout/ledger composition, not a hand-built ledger fixture —
// because the acceptance criterion is that attribution survives the WHOLE seam, not
// just one module's own unit tests.

describe('resolveTurn — shed structure reasons (aic-svp)', () => {
  it('should give a shed structure a reason matching the brownout rationale for its priority class', () => {
    // Exactly the existing "drone charging starves a processor" scenario: one reactor
    // cannot cover both 10 drones and the hopper, so the hopper — priority
    // PRIORITY_PROCESSOR_UPSTREAM — is shed.
    const state = colony({
      queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)],
      droneRoster: roster(10),
    })
    const { report } = resolveTurn(state)

    expect(report.electricity.shedStructureIds).toEqual(['hop-1'])
    expect(report.shedStructures).toEqual([
      { id: 'hop-1', reason: rationaleForPriority(PRIORITY_PROCESSOR_UPSTREAM) },
    ])
    // Guards against a lookup that returns SOME valid-looking rationale for the WRONG
    // priority class — a bug `toEqual` against `rationaleForPriority`'s own output
    // could not, by itself, catch if both sides shared the mistake.
    expect(report.shedStructures[0]?.reason).toContain('abundant extraction stage')
  })

  it('should report no shed structures when every operational structure is powered', () => {
    const state = colony({
      queue: [done('r-1', 'reactor', 0), done('r-2', 'reactor', 4), done('hop-1', 'hopper', 2)],
      droneRoster: roster(10),
    })
    const { report } = resolveTurn(state)
    expect(report.electricity.shedStructureIds).toEqual([])
    expect(report.shedStructures).toEqual([])
  })

  it('should report no shed structures for an empty colony', () => {
    const { report } = resolveTurn(colony())
    expect(report.shedStructures).toEqual([])
  })
})

describe('resolveTurn — ledger shortfall attribution (aic-svp)', () => {
  it('should name the specific structures whose consumption produced a real, colony-driven shortfall', () => {
    // Two DIFFERENT structure types (see the catalog comment above), both powered by a
    // single reactor with no drones competing for the budget, both consuming a resource
    // nothing in this colony produces. The shortfall is genuine: it falls out of the
    // real construction -> power -> ledger composition, not an assertion about
    // `applyLedger` in isolation.
    const state = colony({
      queue: [
        done('r-1', 'reactor', 0),
        done('crush-1', 'crusher-small', 2),
        done('crush-2', 'crusher-large', 4),
      ],
      droneRoster: [],
    })
    const { report } = resolveTurn(state)

    // Both crushers stayed powered — proves this is a RESOURCE shortfall, not a power
    // one, and that binary idle on power did not incidentally erase the scenario.
    expect(report.electricity.shedStructureIds).toEqual([])
    expect(report.electricity.poweredStructureIds).toEqual(
      expect.arrayContaining(['crush-1', 'crush-2']),
    )

    expect(report.shortfalls).toEqual([{ resource: 'regolith', amount: 800 }])
    expect(report.shortfallAttribution).toEqual([
      {
        resource: 'regolith',
        contributors: [
          { id: 'crush-1', amount: 300 },
          { id: 'crush-2', amount: 500 },
        ],
      },
    ])
  })

  it('should produce empty shortfall attribution when nothing is short', () => {
    const state = colony({
      queue: [done('r-1', 'reactor', 0), done('hop-1', 'hopper', 2)],
      droneRoster: [],
    })
    const { report } = resolveTurn(state)
    expect(report.shortfalls).toEqual([])
    expect(report.shortfallAttribution).toEqual([])
  })

  it('should produce empty shortfall attribution for an empty colony', () => {
    const { report } = resolveTurn(colony())
    expect(report.shortfalls).toEqual([])
    expect(report.shortfallAttribution).toEqual([])
  })
})
