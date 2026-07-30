/**
 * Integration test for the generation seam: catalog -> generation -> turn.ts's frozen
 * operational set -> power.ts's grid (aic-a00.18).
 *
 * WHY THIS FILE EXISTS. `tests/unit/generation.test.ts` proves `generation.ts`'s own
 * pure functions are correct in isolation. That is necessary but not sufficient — the
 * defect this bead fixes was never "the math is wrong", it was "`turn.ts` never asked
 * generation.ts anything at all". Per `.claude/rules/03-testing.md`'s seam requirement,
 * this file proves `resolveTurn` — the REAL production entry point, not a stand-in —
 * genuinely calls `currentOutputWh` and `advancePowerSourceState` for every structure,
 * every turn, with no fixture standing in for either module. Every colony below is
 * built the same way `tests/integration/electricity-seam.test.ts` and
 * `tests/integration/golden-scenario.ts` build theirs: real `createCatalog` entries,
 * real `queueConstruction` placement, real `resolveTurn` calls.
 *
 * Four things are proved, one per `describe` block, matching the bead's acceptance
 * criteria:
 *   1. A constant reactor behaves identically through the new path (no regression).
 *   2. A solar array's output genuinely decays turn over turn, and a dust storm
 *      genuinely reduces it further — through `resolveTurn`, not through calling
 *      `currentOutputWh` directly.
 *   3. Two arrays completed on DIFFERENT turns hold DIFFERENT `PowerSourceState` on the
 *      returned `ColonyState`, purely because turn resolution tracked their histories
 *      separately — the per-instance-state requirement.
 *   4. A source kind invented in THIS FILE, registered nowhere else in the codebase,
 *      produces correctly through `resolveTurn` with zero lines changed in `turn.ts` —
 *      the data-driven-extension requirement.
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { queueConstruction } from '../../src/sim/construction'
import { createGrid } from '../../src/sim/grid'
import {
  CALM_ENVIRONMENT,
  SOLAR_DECAY_KIND,
  SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN,
  currentOutputWh,
  registerOutputModel,
} from '../../src/sim/generation'
import { DRONE_TURN_CAPACITY_WH, ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'

const CONFIG = DEFAULT_TURN_CYCLE
const SOLAR_RATED_WH = 100_000

// Registered once, at module load — proving REQUIREMENT 5 (extension without touching
// turn.ts) needs exactly this and a catalog entry naming it. A linear curve losing a
// fixed 1,000 Wh a turn: deliberately a SHAPE no built-in curve has (solarDecay caps and
// is multiplicative; radioisotopeDecay uses ppm), so a passing test cannot be an
// accident of reusing solarDecay's own math under a different name.
const INVENTED_KIND = 'generation-seam-test-linear-decay'
registerOutputModel(INVENTED_KIND, (ratedWh, state) => Math.max(0, ratedWh - state.turnsOperated * 1_000))

const CATALOG = createCatalog([
  {
    id: 'reactor',
    name: 'Fission Surface Power Unit',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    // Exactly enough to charge one drone every turn — no more, no less — so the single
    // drone in the construction scenario below is NEVER shed and NEVER has spare budget
    // that would let a second build turn's worth of labour land in one turn.
    produces: { [ELECTRICITY]: DRONE_TURN_CAPACITY_WH },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'big-reactor',
    name: 'Fission Surface Power Unit (real wattage)',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'solar-array-prebuilt',
    name: 'Photovoltaic Array',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: SOLAR_RATED_WH },
    consumes: {},
    powerOutputModel: SOLAR_DECAY_KIND,
    habitatCapacity: 0,
  },
  {
    id: 'solar-array-built-later',
    name: 'Photovoltaic Array (drone-built)',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 1,
    produces: { [ELECTRICITY]: SOLAR_RATED_WH },
    consumes: {},
    powerOutputModel: SOLAR_DECAY_KIND,
    habitatCapacity: 0,
  },
  {
    id: 'invented-generator',
    name: 'Something Nobody Has Invented Yet',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: 50_000 },
    consumes: {},
    powerOutputModel: INVENTED_KIND,
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

describe('generation seam — constant reactor through resolveTurn (no regression)', () => {
  it('should generate its unchanged rated figure turn after turn, exactly as electricityWh(produces) did before', () => {
    const grid = createGrid(16, 16)
    const site = queueConstruction(grid, 'reactor-1', type('big-reactor'), { x: 0, y: 0 })
    if (!site.ok) throw new Error(`test setup: ${site.reason}`)

    let colony: ColonyState = createColony(
      { turnCycle: CONFIG, incomingWaveSize: 1 },
      { grid: site.grid, queue: [site.project] },
    )

    const rated = energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG)
    for (let turn = 0; turn < 5; turn++) {
      const resolved = resolveTurn(colony)
      expect(resolved.report.electricity.generationWh).toBe(rated)
      colony = resolved.state
    }
  })
})

describe('generation seam — solar decay and dust storms through resolveTurn', () => {
  function siteSolarOnlyColony(): ColonyState {
    const grid = createGrid(16, 16)
    const site = queueConstruction(grid, 'array-1', type('solar-array-prebuilt'), { x: 0, y: 0 })
    if (!site.ok) throw new Error(`test setup: ${site.reason}`)
    return createColony(
      { turnCycle: CONFIG, incomingWaveSize: 1 },
      { grid: site.grid, queue: [site.project] },
    )
  }

  it('should generate the full rated figure on its first operating turn', () => {
    const resolved = resolveTurn(siteSolarOnlyColony())
    expect(resolved.report.electricity.generationWh).toBe(SOLAR_RATED_WH)
  })

  it('should generate LESS on the second turn than the first — genuine turn-over-turn decay, not a flat read', () => {
    let colony = siteSolarOnlyColony()
    const turn1 = resolveTurn(colony)
    colony = turn1.state
    const turn2 = resolveTurn(colony)

    expect(turn2.report.electricity.generationWh).toBeLessThan(turn1.report.electricity.generationWh)
    // Exact figure: turn 2 reads turnsOperated=1 (one operating turn behind it).
    const expectedTurn2 = Math.round(
      (SOLAR_RATED_WH * (10_000 - SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN)) / 10_000,
    )
    expect(turn2.report.electricity.generationWh).toBe(expectedTurn2)
  })

  it('should generate less during a colony-wide dust storm than the same history under a calm sky', () => {
    let calm = siteSolarOnlyColony()
    calm = resolveTurn(calm).state // advance one turn of history first, identically for both branches

    const stormy: ColonyState = { ...calm, environment: { dustStorm: true } }

    const calmResult = resolveTurn(calm)
    const stormyResult = resolveTurn(stormy)

    expect(stormyResult.report.electricity.generationWh).toBeLessThan(
      calmResult.report.electricity.generationWh,
    )
  })

  it('should carry a dust storm forward on the returned state until something changes it', () => {
    const base = siteSolarOnlyColony()
    const stormy: ColonyState = { ...base, environment: { dustStorm: true } }
    const resolved = resolveTurn(stormy)
    expect(resolved.state.environment).toEqual({ dustStorm: true })
  })
})

describe('generation seam — per-instance state (two arrays built on different turns)', () => {
  it('should track independent histories, so an array built earlier reports a LOWER current output than one built later', () => {
    const grid0 = createGrid(16, 16)
    const siteReactor = queueConstruction(grid0, 'reactor-1', type('reactor'), { x: 0, y: 0 })
    if (!siteReactor.ok) throw new Error(`test setup: ${siteReactor.reason}`)
    const sitePrebuilt = queueConstruction(siteReactor.grid, 'array-early', type('solar-array-prebuilt'), {
      x: 1,
      y: 0,
    })
    if (!sitePrebuilt.ok) throw new Error(`test setup: ${sitePrebuilt.reason}`)
    const siteLater = queueConstruction(sitePrebuilt.grid, 'array-late', type('solar-array-built-later'), {
      x: 2,
      y: 0,
    })
    if (!siteLater.ok) throw new Error(`test setup: ${siteLater.reason}`)

    let colony: ColonyState = createColony(
      { turnCycle: CONFIG, incomingWaveSize: 1 },
      {
        grid: siteLater.grid,
        queue: [siteReactor.project, sitePrebuilt.project, siteLater.project],
        // One drone: the reactor above is sized to charge exactly one, every turn, so
        // construction labour is exactly one build-turn's worth per real turn — see
        // `big-reactor`/`reactor`'s comment above `CATALOG`.
        droneRoster: ['drone-01'],
      },
    )

    // Turn 1: array-early is already complete and operates; array-late (buildTurns: 1)
    // completes DURING this turn's construction step, so per ordering note 1 it is NOT
    // in this turn's frozen operational set — it generates nothing yet.
    const turn1 = resolveTurn(colony)
    expect(turn1.report.completedThisTurn).toContain('array-late')
    expect(turn1.state.powerSourceState['array-early']).toEqual({ turnsOperated: 1 })
    // Never having operated, array-late's history was never advanced.
    expect(turn1.state.powerSourceState['array-late']).toBeUndefined()
    colony = turn1.state

    // Turn 2: array-late is now in the frozen operational set for the first time.
    const turn2 = resolveTurn(colony)
    expect(turn2.state.powerSourceState['array-early']).toEqual({ turnsOperated: 2 })
    expect(turn2.state.powerSourceState['array-late']).toEqual({ turnsOperated: 1 })

    // The two ids now hold DIFFERENT histories purely because they came online on
    // different turns — the per-instance-state requirement, proved on the real
    // ColonyState `resolveTurn` returns, not a hand-built fixture.
    const early = turn2.state.powerSourceState['array-early']
    const late = turn2.state.powerSourceState['array-late']
    if (early === undefined || late === undefined) throw new Error('both arrays must have state by turn 2')
    expect(early.turnsOperated).not.toBe(late.turnsOperated)

    // And that difference is not decorative: it changes the actual watt-hours each
    // would generate, computed independently through the same `currentOutputWh` the
    // seam under test calls internally.
    const solarArrayType = type('solar-array-prebuilt')
    const earlyOutput = currentOutputWh(solarArrayType, early, CALM_ENVIRONMENT)
    const lateOutput = currentOutputWh(solarArrayType, late, CALM_ENVIRONMENT)
    expect(earlyOutput).toBeLessThan(lateOutput)
  })

  it('should FREEZE a taken-offline instance\'s history rather than resetting or advancing it, and RESUME it on return', () => {
    const grid = createGrid(16, 16)
    const site = queueConstruction(grid, 'array-1', type('solar-array-prebuilt'), { x: 0, y: 0 })
    if (!site.ok) throw new Error(`test setup: ${site.reason}`)

    let colony: ColonyState = createColony(
      { turnCycle: CONFIG, incomingWaveSize: 1 },
      { grid: site.grid, queue: [site.project] },
    )

    // Turn 1: operates normally, turnsOperated 0 -> 1.
    colony = resolveTurn(colony).state
    expect(colony.powerSourceState['array-1']).toEqual({ turnsOperated: 1 })

    // Taken offline for turn 2: not in the frozen operational set, so its history must
    // neither advance nor reset — this is the `else if (previous !== undefined)` branch
    // in `resolveTurn`'s step 2b, distinct from a structure that has NEVER operated
    // (which gets no key at all, proved in the previous test).
    const offline: ColonyState = { ...colony, offlineStructureIds: ['array-1'] }
    const turnOffline = resolveTurn(offline)
    expect(turnOffline.state.powerSourceState['array-1']).toEqual({ turnsOperated: 1 })

    // Back online for turn 3: resumes counting from where it left off (1 -> 2), not
    // from a reset zero.
    const backOnline: ColonyState = { ...turnOffline.state, offlineStructureIds: [] }
    const turnResumed = resolveTurn(backOnline)
    expect(turnResumed.state.powerSourceState['array-1']).toEqual({ turnsOperated: 2 })
  })
})

describe('generation seam — an invented kind, registered only in this test file (REQUIREMENT 5)', () => {
  it('should generate correctly through resolveTurn, proving the registry needs no turn.ts change to add a new source', () => {
    const grid = createGrid(16, 16)
    const site = queueConstruction(grid, 'invented-1', type('invented-generator'), { x: 0, y: 0 })
    if (!site.ok) throw new Error(`test setup: ${site.reason}`)

    let colony: ColonyState = createColony(
      { turnCycle: CONFIG, incomingWaveSize: 1 },
      { grid: site.grid, queue: [site.project] },
    )

    // Turn 1: turnsOperated 0 -> full rated (50,000).
    const turn1 = resolveTurn(colony)
    expect(turn1.report.electricity.generationWh).toBe(50_000)
    colony = turn1.state

    // Turn 2: turnsOperated 1 -> rated minus this invented curve's own 1,000 Wh/turn.
    const turn2 = resolveTurn(colony)
    expect(turn2.report.electricity.generationWh).toBe(49_000)
  })
})
