/**
 * The headless full-mission runner (aic-oby.4, and the same shape aic-gom.8 asks for:
 * "run a complete 278-turn mission with no renderer, for balance iteration and
 * regression").
 *
 * ============================================================================
 * WHY THIS MODULE EXISTS
 * ----------------------------------------------------------------------------
 * `src/app/state/game-state.ts` is the only production composition of
 * `colony-start.buildColony` -> `weather.advanceWeather` -> `orders.applyOrders` ->
 * `turn.resolveTurn`, and it exists to serve a React click at a time. There was no way
 * to play an entire mission and get a verdict back without a browser. A balance pass
 * cannot MEASURE a death spiral's reachability or recoverability against that: it needs
 * to run the same 278-turn mission dozens of times, across seeds and scripted
 * strategies, and read off aggregate numbers. This module is that harness, built as
 * production `src/sim` code (not a throwaway script) so it is unit-tested like
 * everything else it composes and so `tests/integration/balance-pass.test.ts` can
 * exercise it as a real regression gate, not just a one-off measurement tool.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ----------------------------------------------------------------------------
 * It does not decide WHAT to build — that is a `Strategy`, injected by the caller,
 * exactly as `landing.ts` injects a `BuildabilityScorer`. This module owns only the
 * MECHANICS common to any strategy: bootstrapping a colony from a seed, advancing
 * weather, turning a strategy's build intents into real, sited orders, resolving each
 * turn, and collecting a compact per-turn record. `src/sim/balance-strategies.ts` is
 * where the four named strategies (naive, considered, recovery, late-recovery) live;
 * this module knows nothing about any of them and is exercised in its own tests with
 * synthetic, single-tile structures — its mechanics must hold for ANY catalog.
 *
 * ============================================================================
 * FIXED LANDING ANCHORS, NOT A SEARCH
 * ----------------------------------------------------------------------------
 * `colony-start.startMission` needs a `LandingSelection` (two hull anchors), and a
 * balance harness has no player to choose them. Rather than search for the
 * highest-scoring site per seed — which would fold a second, unrelated optimisation
 * problem into every balance run and make a run's outcome depend on how good that
 * search was — this module takes FIXED anchors (defaulting to a pair well inside a
 * standard map, `src/app/state/game-state.ts`'s own 64x64 `MAP_DIMENSION`) and lands
 * there on every seed. `game-state.ts`'s own comment on buildability's measured minimum
 * (~0.67) is why this is safe: a generated world essentially always accepts a
 * reasonable anchor pair. If a given seed's terrain genuinely refuses the fixed
 * anchors, this module throws rather than silently retrying with an undocumented
 * search — a balance run's bootstrap failing is itself a finding, not something to
 * paper over.
 *
 * ============================================================================
 * PLACEMENT: A DETERMINISTIC SCAN, NEVER A SEARCH WITH SIDE EFFECTS
 * ----------------------------------------------------------------------------
 * A `Strategy` names WHICH structure type to build, never WHERE — placement is this
 * module's job, so a strategy can be written purely in terms of the colony's resource
 * and power state. `findOpenAnchor` scans the grid in a fixed row-major order and
 * returns the first anchor `placement.ts`'s own `validatePlacement` accepts. This is
 * read-only and re-derives nothing `placement.ts` doesn't already decide; it is not a
 * new placement RULE, only a caller choosing where to try one.
 *
 * ============================================================================
 * DETERMINISM
 * ----------------------------------------------------------------------------
 * No `Math.random`, `Date.now`, or `new Date` anywhere in this module. The only
 * randomness in a run is `generateWorld`'s and `weather.generateStormTimeline`'s, both
 * seeded from the caller's `seed` and both already proven deterministic by their own
 * test suites. `runMission` is a pure function of its params: the per-turn loop reads
 * `colony.turnsTaken` to know which turn is next and never an external clock, and a
 * `Strategy` is REQUIRED to be pure (a caller-supplied contract, exactly like
 * `landing.ts`'s injected scorer) — `tests/unit/mission-runner.test.ts` pins
 * byte-identical reproduction from identical params as the check.
 */

import type { Coord } from './grid'
import { buildColony, evaluateLandingOn } from './colony-start'
import type { MissionConfig } from './mission'
import type { StructureType } from './catalog'
import type { PlayerOrder } from './orders'
import { applyOrders } from './orders'
import { validatePlacement } from './placement'
import { totalTurns } from './time'
import { resolveTurn } from './turn'
import type { ColonyState, CycleReport } from './turn'
import { advanceWeather, generateStormTimeline, DEFAULT_WEATHER_TUNING } from './weather'
import type { WeatherTuning } from './weather'
import { generateWorld } from './world'

/** The map edge in tiles a run surveys, unless the caller states otherwise. Matches `game-state.ts`'s `MAP_DIMENSION`. */
export const DEFAULT_MAP_DIMENSION = 64

/** The drone hull's fixed anchor, unless the caller states otherwise. See the module header. */
export const DEFAULT_DRONE_HULL_ANCHOR: Coord = { x: 20, y: 20 }
/** The reactor hull's fixed anchor, unless the caller states otherwise. Ten tiles clear of the drone hull. */
export const DEFAULT_REACTOR_HULL_ANCHOR: Coord = { x: 30, y: 20 }

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** One structure a strategy wants queued this turn. Placement is the runner's job, not the strategy's. */
export interface BuildIntent {
  readonly kind: 'build'
  readonly structureType: StructureType
}

/**
 * Abandon an in-flight project, however far along it is.
 *
 * WHY A STRATEGY NEEDS THIS (found by measurement, not assumed up front). A "corrected"
 * strategy that only ever WAITS for an in-flight project to finish before queueing
 * something better cannot actually recover from a bad start: `construction.ts`'s
 * documented allocation rule is a strict left-to-right dam, so a habitat queued during
 * the naive phase keeps first claim on every turn's labour until it either finishes or
 * is removed — a corrective reactor queued BEHIND it earns nothing until it does. With
 * few drones on shift (exactly the situation a correction is trying to fix), that wait
 * can consume most of the turns a recovery has left. Real players can already do this —
 * `orders.ts`'s `CancelBuildOrder` exists and is wired into `game-state.ts`'s
 * `issueOrders` — so a strategy that models "recognise the mistake and scrap it" is
 * using an existing player action, not inventing sim logic.
 */
export interface CancelIntent {
  readonly kind: 'cancel'
  /** The `ConstructionProject.id` to cancel — read off `StrategyContext.colony.queue`. */
  readonly projectId: string
}

/** Everything a `Strategy` can ask for this turn. See {@link BuildIntent} and {@link CancelIntent}. */
export type StrategyIntent = BuildIntent | CancelIntent

/** Everything a `Strategy` may read to decide what to build this turn. */
export interface StrategyContext {
  /** The turn about to resolve — `colony.turnsTaken + 1`, matching `CycleReport.turn`'s convention. */
  readonly turn: number
  /** The colony as it stands BEFORE this turn's orders are applied. */
  readonly colony: ColonyState
  /** The PREVIOUS turn's resolved report, or `null` before turn 1 has resolved. */
  readonly lastReport: CycleReport | null
}

/**
 * A scripted player: a pure function from the colony's current state to the intents it
 * wants applied this turn (usually zero or one — see `balance-strategies.ts`). MUST be
 * pure and MUST NOT read `Math.random`/`Date.now`: this is sim-path code and is
 * executed inside `runMission`'s per-turn loop exactly like every other step.
 */
export type Strategy = (context: StrategyContext) => readonly StrategyIntent[]

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * The first anchor, scanning row-major from `(0, 0)`, at which `structureType` would
 * validate on `colony.grid` — or `null` if none exists.
 *
 * Read-only: calls `placement.ts`'s own `validatePlacement`, never mutates `grid`, and
 * decides nothing about WHETHER a footprint is legal that `placement.ts` does not
 * already decide.
 */
function findOpenAnchor(colony: ColonyState, structureType: StructureType): Coord | null {
  for (let y = 0; y < colony.grid.height; y++) {
    for (let x = 0; x < colony.grid.width; x++) {
      const anchor = { x, y }
      if (validatePlacement(colony.grid, structureType, anchor).ok) return anchor
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Per-turn records
// ---------------------------------------------------------------------------

/** One resolved turn's headline numbers — enough to diagnose a balance run without re-deriving anything. */
export interface TurnMetric {
  readonly turn: number
  readonly habitatCapacity: number
  readonly dronesOnShift: number
  readonly dronesHeldOffline: number
  readonly brownout: boolean
  readonly cutLine: number | null
  readonly generationWh: number
  readonly labourHoursApplied: number
  readonly labourHoursUnused: number
  readonly completedThisTurn: readonly string[]
  /** Whether a dust storm was active on THIS turn (aic-oby.3). */
  readonly dustStorm: boolean
}

/** A build intent the strategy asked for that could not be sited anywhere this turn. */
export interface UnplacedIntent {
  readonly turn: number
  readonly structureId: string
}

export interface MissionRunParams {
  readonly seed: number
  readonly mission: MissionConfig
  readonly strategy: Strategy
  /** Square map edge in tiles. Defaults to {@link DEFAULT_MAP_DIMENSION}. */
  readonly dimension?: number
  /** Defaults to {@link DEFAULT_DRONE_HULL_ANCHOR}. */
  readonly droneHullAnchor?: Coord
  /** Defaults to {@link DEFAULT_REACTOR_HULL_ANCHOR}. */
  readonly reactorHullAnchor?: Coord
  /** Defaults to `weather.DEFAULT_WEATHER_TUNING`. Overridable so a balance run can isolate weather's effect (see `docs/balance-report.md`). */
  readonly weatherTuning?: WeatherTuning
}

export interface MissionRunResult {
  readonly seed: number
  readonly totalTurns: number
  readonly incomingWaveSize: number
  readonly turns: readonly TurnMetric[]
  readonly notPlaced: readonly UnplacedIntent[]
  readonly finalHabitatCapacity: number
  readonly won: boolean
  /** Turns (of `totalTurns`) in which at least one structure was shed. */
  readonly turnsInBrownout: number
}

/**
 * Bootstrap a colony at the module's fixed landing anchors.
 *
 * @throws {RangeError} if the fixed anchors are not a viable landing for this seed's
 *   surveyed world — see the module header on why this is a loud failure, not a retry.
 */
function bootstrap(params: MissionRunParams): ColonyState {
  const dimension = params.dimension ?? DEFAULT_MAP_DIMENSION
  const droneHullAnchor = params.droneHullAnchor ?? DEFAULT_DRONE_HULL_ANCHOR
  const reactorHullAnchor = params.reactorHullAnchor ?? DEFAULT_REACTOR_HULL_ANCHOR

  const world = generateWorld(dimension, dimension, params.seed)
  const readiness = evaluateLandingOn(world, { droneHullAnchor, reactorHullAnchor })
  if (readiness.status !== 'ready') {
    throw new RangeError(
      `mission-runner: the fixed landing anchors (drone ${JSON.stringify(droneHullAnchor)}, ` +
        `reactor ${JSON.stringify(reactorHullAnchor)}) are not a ready landing for seed ` +
        `${String(params.seed)} on a ${String(dimension)}x${String(dimension)} map — status ` +
        `"${readiness.status}". Pass explicit anchors that clear this seed's terrain.`,
    )
  }

  return buildColony({ world, landing: readiness, mission: params.mission })
}

/**
 * Run a complete mission headlessly: bootstrap, then resolve every turn up to
 * `totalTurns(mission.turnCycle)`, applying the strategy's build intents each turn.
 *
 * @throws {RangeError} if the fixed landing anchors are not viable for this seed (see
 *   {@link bootstrap}), or if `mission`/`config` fails `time.ts`'s own validation.
 */
export function runMission(params: MissionRunParams): MissionRunResult {
  const weatherTuning = params.weatherTuning ?? DEFAULT_WEATHER_TUNING
  const horizon = totalTurns(params.mission.turnCycle)
  const timeline = generateStormTimeline(params.seed, horizon, weatherTuning)

  let colony = bootstrap(params)
  let lastReport: CycleReport | null = null
  let mintCounter = 0
  const mintId = (): string => {
    mintCounter += 1
    return `balance-${String(mintCounter)}`
  }

  const turns: TurnMetric[] = []
  const notPlaced: UnplacedIntent[] = []

  for (let turnIndex = 0; turnIndex < horizon; turnIndex++) {
    colony = advanceWeather(colony, timeline)

    const intents = params.strategy({ turn: colony.turnsTaken + 1, colony, lastReport })

    // Apply intents ONE AT A TIME, re-deriving an open anchor against the colony as it
    // stands after each prior intent this turn — the simplest way to guarantee two
    // intents in the same turn never contend for the same tile, without duplicating
    // `placement.ts`'s occupancy rule in a hand-rolled grid patch. A `cancel` intent
    // naming an id no longer in the queue (already complete, or cancelled earlier in
    // this same batch) is an ORDINARY no-op via `applyOrders`'s own typed rejection —
    // never thrown, exactly as a stale UI click would be.
    let working = colony
    for (const intent of intents) {
      if (intent.kind === 'cancel') {
        working = applyOrders(working, [{ kind: 'cancel-build', id: intent.projectId }]).state
        continue
      }
      const anchor = findOpenAnchor(working, intent.structureType)
      if (anchor === null) {
        notPlaced.push({ turn: colony.turnsTaken + 1, structureId: intent.structureType.id })
        continue
      }
      const order: PlayerOrder = {
        kind: 'queue-build',
        id: mintId(),
        structureType: intent.structureType,
        anchor,
      }
      working = applyOrders(working, [order]).state
    }

    const resolved = resolveTurn(working)
    colony = resolved.state
    lastReport = resolved.report

    turns.push({
      turn: resolved.report.turn,
      habitatCapacity: resolved.report.habitatCapacity,
      dronesOnShift: resolved.report.electricity.dronesOnShift.length,
      dronesHeldOffline: resolved.report.electricity.dronesHeldOffline.length,
      brownout: resolved.report.electricity.brownout,
      cutLine: resolved.report.electricity.cutLine,
      generationWh: resolved.report.electricity.generationWh,
      labourHoursApplied: resolved.report.labourHoursApplied,
      labourHoursUnused: resolved.report.labourHoursUnused,
      completedThisTurn: resolved.report.completedThisTurn,
      dustStorm: colony.environment.dustStorm,
    })
  }

  const finalReport = lastReport
  const finalHabitatCapacity = finalReport?.habitatCapacity ?? 0
  const won = finalReport?.mission.status === 'won'

  return {
    seed: params.seed,
    totalTurns: horizon,
    incomingWaveSize: params.mission.incomingWaveSize,
    turns,
    notPlaced,
    finalHabitatCapacity,
    won,
    turnsInBrownout: turns.filter((t) => t.brownout).length,
  }
}
