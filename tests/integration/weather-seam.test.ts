/**
 * Integration test for the weather seam (aic-oby.3): `weather.ts`'s scheduler ->
 * `advanceWeather` -> `resolveTurn`, proven against a REAL colony built through
 * `createCatalog`/`queueConstruction`/`createColony` — not a hand-assembled fixture
 * standing in for any of them, matching the discipline
 * `tests/integration/generation-seam.test.ts` set for `generation.ts` itself.
 *
 * THE PAYOFF, specifically: a colony containing BOTH a photovoltaic array
 * (`SOLAR_DECAY_KIND`) and a fission reactor (the `constant` default) sees its solar
 * contribution measurably cut during a scheduled storm while its fission contribution
 * does not move at all — through `resolveTurn`, end to end, not merely asserted against
 * `generation.ts`'s curve in isolation (that proof already exists in
 * `tests/unit/generation.test.ts` and `tests/integration/generation-seam.test.ts`; this
 * file additionally proves the SCHEDULER is what flips the switch across a live
 * mission).
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { queueConstruction } from '../../src/sim/construction'
import { createGrid } from '../../src/sim/grid'
import { CALM_ENVIRONMENT, SOLAR_DECAY_KIND, SOLAR_STORM_RETENTION_BASIS_POINTS } from '../../src/sim/generation'
import { ELECTRICITY } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'
import { advanceWeather, generateStormTimeline } from '../../src/sim/weather'
import type { StormEvent, WeatherTuning } from '../../src/sim/weather'

const CONFIG = DEFAULT_TURN_CYCLE
const SOLAR_RATED_WH = 200_000
const REACTOR_RATED_WH = 500_000
const BASIS_POINTS_WHOLE = 10_000

const CATALOG = createCatalog([
  {
    id: 'fission-reactor',
    name: 'Fission Surface Power Unit',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: REACTOR_RATED_WH },
    consumes: {},
    habitatCapacity: 0,
    // No `powerOutputModel` named: defaults to `constant` (catalog.ts) — the same
    // "history- and environment-blind" curve real fission plant should be, and the
    // curve `generation.ts`'s own header names as the one every existing catalog entry
    // gets unchanged.
  },
  {
    id: 'solar-array',
    name: 'Photovoltaic Array',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: SOLAR_RATED_WH },
    consumes: {},
    powerOutputModel: SOLAR_DECAY_KIND,
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

/** A fresh colony with one reactor and one solar array, both complete from turn 1. */
function buildColonyWithBothSources(): ColonyState {
  const grid = createGrid(16, 16)
  const siteReactor = queueConstruction(grid, 'reactor-1', type('fission-reactor'), { x: 0, y: 0 })
  if (!siteReactor.ok) throw new Error(`test setup: ${siteReactor.reason}`)
  const siteSolar = queueConstruction(siteReactor.grid, 'solar-1', type('solar-array'), { x: 1, y: 0 })
  if (!siteSolar.ok) throw new Error(`test setup: ${siteSolar.reason}`)

  return createColony(
    { turnCycle: CONFIG, incomingWaveSize: 1 },
    { grid: siteSolar.grid, queue: [siteReactor.project, siteSolar.project] },
  )
}

/** Forces a storm to start on turn 1 and last exactly `durationTurns`, regardless of seed. */
function guaranteedStormTuning(durationTurns: number): WeatherTuning {
  return {
    stormOnsetProbabilityPerTurn: 1,
    minStormDurationTurns: durationTurns,
    maxStormDurationTurns: durationTurns,
  }
}

describe('weather seam — a storm reduces solar while leaving fission untouched, through resolveTurn', () => {
  it('should generate the full rated total with no storm scheduled', () => {
    const colony = buildColonyWithBothSources()
    const calm = advanceWeather(colony, [])
    const resolved = resolveTurn(calm)
    expect(resolved.report.electricity.generationWh).toBe(SOLAR_RATED_WH + REACTOR_RATED_WH)
  })

  it('should cut the total by EXACTLY solar\'s storm reduction — proving fission contributed the same amount either way', () => {
    const colony = buildColonyWithBothSources()

    const calmColony = advanceWeather(colony, [])
    const stormyColony = advanceWeather(colony, [{ startTurn: 1, endTurn: 1 }])

    const calmResult = resolveTurn(calmColony)
    const stormyResult = resolveTurn(stormyColony)

    // Both first-operating-turn, so solar has accrued no soiling yet (turnsOperated=0):
    // its calm output is exactly its rated figure, and its storm output is exactly the
    // rated figure retained at `SOLAR_STORM_RETENTION_BASIS_POINTS` (10%, -90%).
    const expectedSolarDuringStorm = Math.round(
      (SOLAR_RATED_WH * SOLAR_STORM_RETENTION_BASIS_POINTS) / BASIS_POINTS_WHOLE,
    )

    expect(stormyResult.report.electricity.generationWh).toBeLessThan(
      calmResult.report.electricity.generationWh,
    )

    const drop =
      calmResult.report.electricity.generationWh - stormyResult.report.electricity.generationWh
    // If fission's contribution had moved even by one watt-hour, this equality would
    // fail — it isolates the WHOLE drop as solar's alone.
    expect(drop).toBe(SOLAR_RATED_WH - expectedSolarDuringStorm)
    expect(stormyResult.report.electricity.generationWh).toBe(
      expectedSolarDuringStorm + REACTOR_RATED_WH,
    )
  })

  it('should leave a fission-ONLY colony\'s generation completely unaffected by a scheduled storm', () => {
    // The same proof again, but with no solar present at all — removing any need to
    // isolate its contribution algebraically. If this ever fails, `currentOutputWh` or
    // `resolveTurn` started branching on `dustStorm` for a curve that should ignore it.
    const grid = createGrid(16, 16)
    const site = queueConstruction(grid, 'reactor-1', type('fission-reactor'), { x: 0, y: 0 })
    if (!site.ok) throw new Error(`test setup: ${site.reason}`)
    const colony = createColony(
      { turnCycle: CONFIG, incomingWaveSize: 1 },
      { grid: site.grid, queue: [site.project] },
    )

    const calmResult = resolveTurn(advanceWeather(colony, []))
    const stormyResult = resolveTurn(advanceWeather(colony, [{ startTurn: 1, endTurn: 1 }]))

    expect(stormyResult.report.electricity.generationWh).toBe(
      calmResult.report.electricity.generationWh,
    )
    expect(stormyResult.report.electricity.generationWh).toBe(REACTOR_RATED_WH)
  })
})

describe('weather seam — a storm has an observable start and end across a live, multi-turn mission', () => {
  it('should show generation fall when the scheduled storm starts and recover (net of ongoing soiling) when it ends', () => {
    let colony = buildColonyWithBothSources()
    // Horizon set to EXACTLY the storm's duration: with onset probability 1, a wider
    // horizon would have the very next calm turn immediately roll a NEW storm too (a
    // real, tested behaviour — see "should never produce two overlapping storms" — but
    // not what this test wants). The resulting one-event timeline is then reused past
    // its own horizon below: `advanceWeather` only ever checks event membership, so
    // turns past turn 3 correctly read as calm regardless of what horizon generated it.
    const timeline = generateStormTimeline(20260730, 3, guaranteedStormTuning(3)) // storm: turns 1-3
    const storm = timeline[0] as StormEvent
    expect(storm).toEqual({ startTurn: 1, endTurn: 3 })

    const generationByTurn: number[] = []
    for (let i = 0; i < 6; i++) {
      colony = advanceWeather(colony, timeline)
      const resolved = resolveTurn(colony)
      generationByTurn.push(resolved.report.electricity.generationWh)
      colony = resolved.state
    }

    // Turns 1-3 (index 0-2): storm active, output cut hard below the reactor's own
    // rated floor — impossible unless solar was suppressed, since the reactor alone
    // already supplies REACTOR_RATED_WH every turn.
    for (const i of [0, 1, 2]) {
      expect(generationByTurn[i]).toBeLessThan(REACTOR_RATED_WH + SOLAR_RATED_WH)
    }
    // Turn 4 (index 3): the storm has ended (endTurn=3) — generation jumps back up,
    // even though solar has three more turns of soiling behind it than turn 1 did.
    const turn3 = generationByTurn[2] as number
    const turn4 = generationByTurn[3] as number
    expect(turn4).toBeGreaterThan(turn3)
  })

  it('should match the sim\'s directly-computed dustStorm status turn by turn (the timeline is the single source of truth)', () => {
    let colony = buildColonyWithBothSources()
    // See the previous test's comment: horizon == duration, so exactly one event is
    // generated and turns past it read as calm when the same array is reused.
    const timeline = generateStormTimeline(1, 2, guaranteedStormTuning(2)) // turns 1-2
    const observedStorm: boolean[] = []
    for (let i = 0; i < 5; i++) {
      colony = advanceWeather(colony, timeline)
      observedStorm.push(colony.environment.dustStorm)
      colony = resolveTurn(colony).state
    }
    // Turn 1 and 2 stormy, turns 3-5 calm — read directly off the colony `advanceWeather`
    // set, before `resolveTurn` even ran, so this is the UI-observable signal itself.
    expect(observedStorm).toEqual([true, true, false, false, false])
  })
})

describe('weather seam — determinism across a whole mission', () => {
  it('should produce an identical multi-turn trace from the same seed, run twice independently', () => {
    const tuning: WeatherTuning = {
      stormOnsetProbabilityPerTurn: 0.05,
      minStormDurationTurns: 2,
      maxStormDurationTurns: 6,
    }
    const seed = 424242
    const horizon = 60

    function runTrace(): readonly { readonly turn: number; readonly generationWh: number; readonly dustStorm: boolean }[] {
      let colony = buildColonyWithBothSources()
      const timeline = generateStormTimeline(seed, horizon, tuning)
      const trace: { readonly turn: number; readonly generationWh: number; readonly dustStorm: boolean }[] = []
      for (let i = 0; i < horizon; i++) {
        colony = advanceWeather(colony, timeline)
        const dustStorm = colony.environment.dustStorm
        const resolved = resolveTurn(colony)
        trace.push({ turn: resolved.report.turn, generationWh: resolved.report.electricity.generationWh, dustStorm })
        colony = resolved.state
      }
      return trace
    }

    const first = runTrace()
    const second = runTrace()
    expect(first).toEqual(second)
    // Non-vacuous: this scenario's tuning is lively enough that at least one storm
    // actually occurred somewhere in the 60-turn trace.
    expect(first.some((entry) => entry.dustStorm)).toBe(true)
  })
})

describe('weather seam — storms disabled behaves exactly as today', () => {
  it('should produce identical resolveTurn output whether advanceWeather is called with an empty timeline or never called at all', () => {
    const colony = buildColonyWithBothSources()

    const viaEmptyTimeline = resolveTurn(advanceWeather(colony, []))
    const viaNoWeatherAtAll = resolveTurn(colony)

    expect(viaEmptyTimeline.report).toEqual(viaNoWeatherAtAll.report)
    expect(viaEmptyTimeline.state).toEqual(viaNoWeatherAtAll.state)
    expect(colony.environment).toEqual(CALM_ENVIRONMENT)
  })
})
