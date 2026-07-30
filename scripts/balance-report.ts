/**
 * Reproduce the measurements behind `docs/balance-report.md` (aic-oby.4).
 *
 *     npx tsx scripts/balance-report.ts
 *
 * Runs the four scripted strategies (naive, considered, recovery, late-recovery)
 * across several seeds, using the REAL production roster (`catalog-data-core.ts`) and
 * the REAL mission config (278 turns, `DEFAULT_TURN_CYCLE`), and prints the same
 * numbers `docs/balance-report.md` reports by hand. This script is the reproducible
 * source of that document's figures — if a catalog value changes, re-run this and
 * update the report to match, exactly as `scripts/record-golden-trace.ts` is the
 * reproducible source of the golden trace.
 *
 * Also runs the "recovery sweep" (naive until turn X, for a range of X) to find the
 * turn at which the outcome flips from recoverable to inevitable, and the "weather
 * inertness" check (same seed/strategy, default storm tuning vs. storms disabled,
 * comparing outcomes byte-for-byte).
 */

import { createCatalog, getStructureType } from '../src/sim/catalog'
import type { StructureType } from '../src/sim/catalog'
import { coreStructureSpecs } from '../src/sim/catalog-data-core'
import { createBalanceStrategies } from '../src/sim/balance-strategies'
import type { MissionRunResult } from '../src/sim/mission-runner'
import { runMission } from '../src/sim/mission-runner'
import type { MissionConfig } from '../src/sim/mission'
import { DEFAULT_TURN_CYCLE, totalTurns } from '../src/sim/time'
import { DEFAULT_WEATHER_TUNING } from '../src/sim/weather'

/* eslint-disable no-console -- a reporting script's whole job is to print what it found */

const CONFIG = DEFAULT_TURN_CYCLE
const CATALOG = createCatalog(coreStructureSpecs(CONFIG))

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`core catalog is missing "${id}"`)
  return found
}

const REACTOR = type('reactor-unit')
const HABITAT = type('habitat-module')

const STRATEGIES = createBalanceStrategies({ reactorType: REACTOR, habitatType: HABITAT, config: CONFIG })

/** The wave size a balance run is tuned against. See `docs/balance-report.md`. */
const INCOMING_WAVE_SIZE = 400

const MISSION: MissionConfig = { turnCycle: CONFIG, incomingWaveSize: INCOMING_WAVE_SIZE }

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

interface Summary {
  readonly seed: number
  readonly strategy: string
  readonly won: boolean
  readonly finalHabitatCapacity: number
  readonly turnsInBrownout: number
  readonly maxDronesHeldOffline: number
  readonly firstBrownoutTurn: number | null
  readonly completions: number
}

function summarize(strategyName: string, result: MissionRunResult): Summary {
  const firstBrownout = result.turns.find((t) => t.brownout)
  return {
    seed: result.seed,
    strategy: strategyName,
    won: result.won,
    finalHabitatCapacity: result.finalHabitatCapacity,
    turnsInBrownout: result.turnsInBrownout,
    maxDronesHeldOffline: Math.max(...result.turns.map((t) => t.dronesHeldOffline)),
    firstBrownoutTurn: firstBrownout?.turn ?? null,
    completions: result.turns.reduce((n, t) => n + t.completedThisTurn.length, 0),
  }
}

console.log('=== aic-oby.4 balance pass — headless measurement ===')
console.log(`Mission: ${String(totalTurns(CONFIG))} turns, incomingWaveSize=${String(INCOMING_WAVE_SIZE)}`)
console.log(`Reactor: buildTurns=${String(REACTOR.buildTurns)}, output=${String(REACTOR.produces.electricity)} Wh/turn`)
console.log(
  `Habitat: buildTurns=${String(HABITAT.buildTurns)}, capacity=${String(HABITAT.habitatCapacity)}, ` +
    `rated=${String(HABITAT.consumes.electricity)} Wh/turn, standby=${String(HABITAT.standbyConsumes.electricity)} Wh/turn`,
)
console.log('')

const NAMED_STRATEGIES: ReadonlyArray<readonly [string, ReturnType<typeof createBalanceStrategies>['naive']]> = [
  ['naive', STRATEGIES.naive],
  ['considered', STRATEGIES.considered],
  ['recovery (correct at turn 90)', STRATEGIES.naiveUntil(90)],
  ['late-recovery (correct at turn 250)', STRATEGIES.naiveUntil(250)],
]

const allSummaries: Summary[] = []
for (const [name, strategy] of NAMED_STRATEGIES) {
  console.log(`--- ${name} ---`)
  for (const seed of SEEDS) {
    const result = runMission({ seed, mission: MISSION, strategy })
    const summary = summarize(name, result)
    allSummaries.push(summary)
    console.log(
      `seed ${String(seed).padStart(2)}: ${summary.won ? 'WON ' : 'LOST'} ` +
        `capacity=${String(summary.finalHabitatCapacity).padStart(3)}/${String(INCOMING_WAVE_SIZE)} ` +
        `brownoutTurns=${String(summary.turnsInBrownout).padStart(3)} ` +
        `maxOffline=${String(summary.maxDronesHeldOffline).padStart(2)} ` +
        `firstBrownout=${summary.firstBrownoutTurn === null ? 'never' : String(summary.firstBrownoutTurn)} ` +
        `completions=${String(summary.completions)}`,
    )
  }
  console.log('')
}

console.log('=== recovery sweep: naive until turn X, then considered ===')
const sweepSeeds = [1, 2, 3]
const sweepTurns = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 115,
  120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270,
]
for (const seed of sweepSeeds) {
  const row = sweepTurns.map((turn) => {
    const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.naiveUntil(turn) })
    return `${String(turn)}:${result.won ? 'W' : 'L'}`
  })
  console.log(`seed ${String(seed)}: ${row.join('  ')}`)
}
console.log('')

console.log('=== weather inertness check (same seed/strategy, storms on vs. off) ===')
console.log('(compares every field EXCEPT the per-turn dustStorm flag itself, which of course differs)')
function stripDustStorm(result: MissionRunResult): unknown {
  return { ...result, turns: result.turns.map(({ dustStorm: _dustStorm, ...rest }) => rest) }
}
for (const seed of [1, 2, 3]) {
  const withStorms = runMission({ seed, mission: MISSION, strategy: STRATEGIES.considered })
  const noStorms = runMission({
    seed,
    mission: MISSION,
    strategy: STRATEGIES.considered,
    weatherTuning: { ...DEFAULT_WEATHER_TUNING, stormOnsetProbabilityPerTurn: 0 },
  })
  const identical = JSON.stringify(stripDustStorm(withStorms)) === JSON.stringify(stripDustStorm(noStorms))
  const stormTurns = withStorms.turns.filter((t) => t.dustStorm).length
  console.log(
    `seed ${String(seed)}: stormTurns=${String(stormTurns)}, outcome identical with storms disabled: ${String(identical)}`,
  )
}

console.log('')
console.log('=== considered strategy: turn at which habitat capacity first reaches N ===')
const milestones = [16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 280, 320, 400, 500, 640, 800, 1000]
for (const seed of [1, 2, 3]) {
  const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.considered })
  const reached = milestones.map((n) => {
    const turn = result.turns.find((t) => t.habitatCapacity >= n)
    return `${String(n)}@${turn ? String(turn.turn) : '-'}`
  })
  console.log(`seed ${String(seed)}: ${reached.join('  ')}`)
}

console.log('')
console.log('=== diagnostic: recovery correcting at turn 70, full trajectory ===')
{
  const result = runMission({ seed: 1, mission: MISSION, strategy: STRATEGIES.naiveUntil(70) })
  for (const t of result.turns.filter((x) => x.turn % 5 === 0 || (x.turn >= 65 && x.turn <= 130))) {
    console.log(
      `  turn ${String(t.turn).padStart(3)}: capacity=${String(t.habitatCapacity).padStart(3)} ` +
        `offline=${String(t.dronesHeldOffline).padStart(2)} onShift=${String(t.dronesOnShift).padStart(2)} ` +
        `completed=${JSON.stringify(t.completedThisTurn)}`,
    )
  }
  console.log(`  FINAL: won=${String(result.won)} capacity=${String(result.finalHabitatCapacity)}`)
}

console.log('')
console.log('=== naive strategy: final drones-held-offline trajectory (every 10 turns) ===')
for (const seed of [1]) {
  const result = runMission({ seed, mission: MISSION, strategy: STRATEGIES.naive })
  const sample = result.turns.filter((t) => t.turn % 10 === 0 || t.turn === 1)
  for (const t of sample) {
    console.log(
      `  turn ${String(t.turn).padStart(3)}: capacity=${String(t.habitatCapacity).padStart(3)} ` +
        `offline=${String(t.dronesHeldOffline).padStart(2)} onShift=${String(t.dronesOnShift).padStart(2)} ` +
        `gen=${String(t.generationWh)}`,
    )
  }
}
