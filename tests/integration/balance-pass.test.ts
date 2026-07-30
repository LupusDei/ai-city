/**
 * The balance pass's own regression gate (aic-oby.4): the headless runner, the real
 * production roster (`catalog-data-core.ts`), and the real 278-turn mission, asserting
 * the exact properties the bead's acceptance criteria name.
 *
 * `scripts/balance-report.ts` is the exploratory tool that FOUND these numbers (see
 * `docs/balance-report.md` for the full measurement and reasoning); this file is what
 * keeps them from silently drifting once found. Every assertion below is a property
 * measured in `docs/balance-report.md`, restated as a test — a future catalog change
 * that breaks the death spiral's reachability, its recoverability window, or the
 * naive/considered split will fail HERE, not just make the report stale.
 *
 * Runs the FULL 278-turn mission, several times per test — this is deliberately not a
 * shortened mission: `time.totalTurns(DEFAULT_TURN_CYCLE)` is 278, and a shortened
 * config would measure a different game. Each run is pure arithmetic (no I/O, no
 * rendering), and `tests/integration/construction-drift.test.ts` already established
 * that a 278-turn adversarial run costs milliseconds — this suite runs dozens of them
 * and stays fast.
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import {
  HABITAT_CAPACITY_PER_MODULE,
  HABITAT_MODULE_ID,
  REACTOR_UNIT_ID,
  coreStructureSpecs,
} from '../../src/sim/catalog-data-core'
import { createBalanceStrategies } from '../../src/sim/balance-strategies'
import { runMission } from '../../src/sim/mission-runner'
import type { MissionRunResult } from '../../src/sim/mission-runner'
import type { MissionConfig } from '../../src/sim/mission'
import { DEFAULT_TURN_CYCLE, totalTurns } from '../../src/sim/time'
import { DEFAULT_WEATHER_TUNING } from '../../src/sim/weather'

const CONFIG = DEFAULT_TURN_CYCLE
const CATALOG = createCatalog(coreStructureSpecs(CONFIG))

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`core catalog is missing "${id}"`)
  return found
}

const REACTOR = type(REACTOR_UNIT_ID)
const HABITAT = type(HABITAT_MODULE_ID)
const STRATEGIES = createBalanceStrategies({ reactorType: REACTOR, habitatType: HABITAT, config: CONFIG })

/**
 * The tuned mission-config half of this bead's measurement: 50 habitats' worth. See
 * `catalog-data-core.HABITAT_CAPACITY_PER_MODULE`'s doc and `docs/balance-report.md`.
 */
const INCOMING_WAVE_SIZE = 400
const MISSION: MissionConfig = { turnCycle: CONFIG, incomingWaveSize: INCOMING_WAVE_SIZE }

/** Several seeds, so a passing suite is evidence about the GAME, not one lucky map. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** The naive strategy's structural ceiling: 6 habitats, `HABITAT_CAPACITY_PER_MODULE` each — see the module docs on why this is power-ratio-limited, not turn-limited. */
const NAIVE_CEILING_HABITATS = 6
const NAIVE_CEILING_CAPACITY = NAIVE_CEILING_HABITATS * HABITAT_CAPACITY_PER_MODULE

describe('aic-oby.4 balance pass — the reactor/habitat roster over a full 278-turn mission', () => {
  it('should run exactly the ratified 278-turn mission', () => {
    expect(totalTurns(CONFIG)).toBe(278)
  })

  describe('naive (habitats only, one starting reactor, never augmented) — should LOSE, every seed', () => {
    it.each(SEEDS)('seed %i', (seed) => {
      const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.naive })
      expect(result.won).toBe(false)
      // The naive ceiling is a POWER-RATIO limit, not a turns-remaining limit: once
      // completed habitats' standby draw exceeds what one reactor can spare after the
      // full fleet's reservation, drone charging is zero forever and NOTHING further
      // is ever built — reachable by pure arithmetic regardless of the 278-turn budget.
      expect(result.finalHabitatCapacity).toBe(NAIVE_CEILING_CAPACITY)
      expect(result.finalHabitatCapacity).toBeLessThan(INCOMING_WAVE_SIZE)
    })
  })

  describe('considered (reactor whenever the habitat-standby share gets thin) — should WIN, every seed', () => {
    it.each(SEEDS)('seed %i', (seed) => {
      const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.considered })
      expect(result.won).toBe(true)
      expect(result.finalHabitatCapacity).toBeGreaterThanOrEqual(INCOMING_WAVE_SIZE)
      // "Near the deadline, not trivially early": measured at turn ~201/278 — asserting
      // a band (not an exact turn) so an unrelated one-turn shift in the ledger's
      // rounding does not make this brittle, while still catching a regression that
      // makes the mission solvable in (say) the first quarter of the mission.
      const firstWinTurn = result.turns.find((t) => t.habitatCapacity >= INCOMING_WAVE_SIZE)?.turn
      expect(firstWinTurn).toBeDefined()
      expect(firstWinTurn as number).toBeGreaterThan(150)
      expect(firstWinTurn as number).toBeLessThan(260)
    })
  })

  describe('recoverable if caught early: naive until turn 90, then considered — should WIN', () => {
    it.each(SEEDS)('seed %i', (seed) => {
      const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(90) })
      expect(result.won).toBe(true)
    })
  })

  describe('not recoverable if caught late: naive until turn 250, then considered — should LOSE', () => {
    it.each(SEEDS)('seed %i', (seed) => {
      const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(250) })
      expect(result.won).toBe(false)
      // By turn 250 the naive phase has already run the colony to its permanent,
      // zero-drone ceiling (see the naive suite above) — a correction this late cannot
      // do anything a correction at turn 90 could, because there is no labour left to
      // spend on the reactor it queues.
      expect(result.finalHabitatCapacity).toBe(NAIVE_CEILING_CAPACITY)
    })
  })

  it('should locate the recovery/no-recovery crossover strictly between turn 90 and turn 250 (measured at 107/108)', () => {
    // The crossover itself is measured once here, at higher resolution, rather than
    // swept turn-by-turn across all ten seeds on every run — the sweep in
    // `scripts/balance-report.ts` is the exploratory tool that found 107/108; this
    // pins the two turns the acceptance criteria actually name plus the exact
    // measured boundary, for one representative seed.
    const seed = 1
    expect(runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(90) }).won).toBe(true)
    expect(runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(107) }).won).toBe(true)
    expect(runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(108) }).won).toBe(false)
    expect(runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(250) }).won).toBe(false)
  })

  it('should reproduce byte-identically for the same seed, mission and strategy (reproducible from seed)', () => {
    const params = { seed: 42, mission: MISSION, strategy: STRATEGIES.considered }
    const first = runMission(params)
    const second = runMission(params)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('should currently be unaffected by dust storms — every generator in this roster uses the constant curve', () => {
    // aic-oby.3 landed a real, seeded storm scheduler, and this run genuinely lives
    // through several storms (see `stormTurns` below) — but nothing in the CURRENT
    // buildable roster reads `GenerationEnvironment.dustStorm` (`generation.ts`'s
    // `SOLAR_DECAY_KIND` curve is the one that does, and no catalog entry names it
    // yet). This is an honest, measured property of today's roster, not an assumption:
    // disabling storms entirely changes nothing about the outcome. See
    // `docs/balance-report.md` for why this is a finding worth stating rather than
    // quietly relying on.
    const seed = 1
    const withStorms = runMission({ seed, mission: MISSION, strategy: STRATEGIES.considered })
    const stormTurns = withStorms.turns.filter((t) => t.dustStorm).length
    expect(stormTurns).toBeGreaterThan(0) // the scheduler is genuinely active in this run

    const noStorms = runMission({
      seed,
      mission: MISSION,
      strategy: STRATEGIES.considered,
      weatherTuning: { ...DEFAULT_WEATHER_TUNING, stormOnsetProbabilityPerTurn: 0 },
    })

    const stripDustStorm = (result: MissionRunResult): unknown => ({
      ...result,
      turns: result.turns.map(({ dustStorm: _dustStorm, ...rest }) => rest),
    })
    expect(JSON.stringify(stripDustStorm(noStorms))).toBe(JSON.stringify(stripDustStorm(withStorms)))
  })
})
