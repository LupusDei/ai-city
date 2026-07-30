/**
 * The dust-storm event scheduler (aic-oby.3): the seeded timeline that finally moves
 * `GenerationEnvironment.dustStorm` off `false` for good.
 *
 * =====================================================================
 * THE DEFECT THIS MODULE FIXES
 * =====================================================================
 * `generation.ts`'s `SOLAR_DECAY_KIND` curve has read `environment.dustStorm` since
 * aic-a00.18, and `turn.ts`'s `ColonyState.environment` has carried a
 * `GenerationEnvironment` through every turn for just as long — but nothing in the
 * codebase ever set that flag to `true`. `ColonyState`'s own doc comment names the gap
 * outright: "a dust-storm SCHEDULE is out of scope here... this field is the plumbing a
 * future scheduler bead sets before calling `resolveTurn`". This module is that bead: a
 * pure, seeded generator of storm start/end turns, plus one function that reads it and
 * sets `environment` for whichever turn is about to resolve.
 *
 * =====================================================================
 * WHY THIS SITS OUTSIDE `resolveTurn`, NOT INSIDE IT
 * =====================================================================
 * `turn.ts`'s own header is explicit that player orders are "applied BEFORE this
 * function, not inside it" — `resolveTurn` composes already-decided per-turn facts, and
 * nothing about deciding them. Weather is the same shape of fact: a colony-wide
 * condition decided ONCE per turn, before resolution, not a rule resolution itself
 * enforces. Concretely, `resolveTurn` reads `state.environment` and carries it forward
 * UNCHANGED (see its own comment on that field) — that contract is already covered by
 * `tests/integration/generation-seam.test.ts`'s "should carry a dust storm forward on
 * the returned state until something changes it", which this module must not break.
 * Folding the schedule into `resolveTurn` itself would mean either breaking that
 * contract or silently overriding whatever a caller had set — the wrong seam to touch
 * for a change that is properly the CALLER's business. `advanceWeather` below is that
 * caller-side step: given a colony and a precomputed timeline, it computes the ONE
 * `GenerationEnvironment` correct for the upcoming turn and returns a colony carrying
 * it, ready to hand to `resolveTurn` exactly as `queueConstruction`'s result is.
 *
 * `src/app/state/game-state.ts` — the sim/UI adapter, and the only place under
 * `src/app/` allowed to drive the sim (`tests/unit/app-boundary.test.ts`) — is where
 * this actually happens in a live mission: `beginMission` generates the timeline once,
 * from the session seed, and `advanceCycle` calls `advanceWeather` on the freshly
 * resolved colony before it is ever handed back to `resolveTurn` for the next turn's
 * forecast or the turn after that's real resolution.
 *
 * =====================================================================
 * THE MODEL, GROUNDED IN REALITY (not chosen for drama)
 * =====================================================================
 * One turn is 178,775s ~= 2.014 Martian sols (`time.ts`'s `DEFAULT_TURN_CYCLE`).
 *
 * Real Martian dust storms come in two recognised scales, and this scheduler
 * deliberately models ONE storm kind whose duration spans both — `generation.ts`'s own
 * `GenerationEnvironment` doc reserves "storm severity tiers" as a future interface
 * change, not something to invent here:
 *
 *   - REGIONAL storms form during the Martian dust-storm season (roughly southern
 *     spring through summer) and typically last from a few days to a few weeks.
 *   - PLANET-ENCIRCLING ("global") storms are rarer — recurring roughly once every 3-4
 *     Mars years — and can persist for weeks to months (the observed 2018 global storm
 *     ran close to three months).
 *
 * FIGURES, cited so nobody has to re-derive them:
 *   - `DEFAULT_STORM_MIN_DURATION_TURNS` = 2 (~4 sols, ~4 Earth days): the short end of
 *     "a few days", a brief regional squall.
 *   - `DEFAULT_STORM_MAX_DURATION_TURNS` = 30: NOT a fresh number — it is the exact
 *     duration `generation.ts`'s `SOLAR_STORM_RETENTION_BASIS_POINTS` (-90% retained
 *     output) was already cited FOR: "the proposal's illustrative storm band: 'storm:
 *     -90% output, 30 turns'" (docs/proposals/02-chain-silica-solar.html). Reusing it
 *     here rather than inventing a second figure keeps exactly one number meaning
 *     "how long the -90% band was illustrated to last". 30 turns ~= 60.4 sols ~= 62
 *     Earth days ~= two months, squarely inside "weeks to months" for a global event.
 *   - `DEFAULT_STORM_ONSET_PROBABILITY_PER_TURN` ~= 0.003 (0.3%/turn): tuned so a storm
 *     starts, ON AVERAGE, once every ~332 turns while none is active — one Mars year
 *     (668.6 sols / 2.014 sols-per-turn ~= 332 turns), the cadence of the MORE frequent
 *     of the two real phenomena (the annual regional dust-storm season), so a mission
 *     genuinely lives through weather rather than modelling only the rare global event.
 *     Over the ratified 278-turn mission (`time.ts`'s `MISSION_DEADLINE_SECONDS`), that
 *     is an expected ~0.84 storms — "most missions see one, some see none, a few see
 *     two" — which matches a mission lasting under one Mars year (0.84 of one) seeing
 *     at most one full dust-storm season, not a guaranteed one.
 *
 * =====================================================================
 * DATA-DRIVEN, FOR aic-oby.4's SAKE
 * =====================================================================
 * Every one of the three figures above is a field of `WeatherTuning`, a plain data
 * argument `generateStormTimeline` takes and defaults from `DEFAULT_WEATHER_TUNING` —
 * never a literal inside the generator's control flow. The balance pass this bead's
 * sibling owns needs to retune frequency and duration without touching this module's
 * logic at all; passing a different `WeatherTuning` is the whole mechanism.
 *
 * =====================================================================
 * DETERMINISM
 * =====================================================================
 * `generateStormTimeline` draws from exactly one `mulberry32(seed)` instance (imported
 * from `random.ts` — never reimplemented, per `tests/unit/boundary.test.ts`'s "single
 * source of truth" check) and computes the ENTIRE timeline as a pure function of
 * `(seed, horizonTurns, tuning)`. Two calls with identical arguments produce
 * deep-equal, independent arrays; two calls with different seeds diverge (see
 * `tests/unit/weather.test.ts`). No `Math.random`, `Date.now`, `new Date`, and no
 * Map/Set iteration order reaches any output.
 */

import { CALM_ENVIRONMENT } from './generation'
import type { GenerationEnvironment } from './generation'
import { mulberry32 } from './random'
import type { ColonyState } from './turn'

// ---------------------------------------------------------------------------
// The timeline shape
// ---------------------------------------------------------------------------

/**
 * One dust storm: the first and last turn (both INCLUSIVE, both counted the same way
 * `CycleReport.turn` is — 1 for the first turn ever resolved) on which
 * `GenerationEnvironment.dustStorm` is `true`.
 *
 * Both ends are named fields on purpose, not a start-plus-duration pair: a UI wanting
 * to announce "a storm is coming" or "the storm has passed" needs the END turn exactly
 * as much as the start, and computing it back out of a duration at every call site is
 * the kind of derived arithmetic this project's own discipline says belongs in one
 * place instead.
 */
export interface StormEvent {
  /** First turn this storm is active. Always >= 1. */
  readonly startTurn: number
  /** Last turn this storm is active (inclusive). Always >= `startTurn`. */
  readonly endTurn: number
}

/**
 * The tunable knobs a storm timeline is generated from — see the module header for
 * each default's real-world citation. Kept as plain data, exactly like
 * `DepositOptions` (`buildability.ts`) or `TurnCycleConfig` (`time.ts`), so a scenario
 * or a balance pass can construct a non-default one inline without touching this
 * module's logic (aic-oby.4's whole reason for existing).
 */
export interface WeatherTuning {
  /**
   * Chance, per turn, that a NEW storm begins — checked only on a turn with no storm
   * already active (a storm's own duration is drawn once, at onset; see
   * `generateStormTimeline`). Must be in the closed interval [0, 1]; `0` means "storms
   * never start" (a legitimate, data-driven way to disable weather without touching an
   * empty timeline by hand), `1` means "a storm starts on the very next turn checked" —
   * used by `tests/integration/weather-seam.test.ts` to force a deterministic storm for
   * the payoff test without depending on a lucky seed.
   */
  readonly stormOnsetProbabilityPerTurn: number
  /** Shortest possible storm, in turns. Must be a positive integer. */
  readonly minStormDurationTurns: number
  /** Longest possible storm, in turns. Must be a positive integer >= the minimum. */
  readonly maxStormDurationTurns: number
}

/** See the module header's "FIGURES" block for the citation. */
export const DEFAULT_STORM_MIN_DURATION_TURNS = 2
/** See the module header's "FIGURES" block for the citation. */
export const DEFAULT_STORM_MAX_DURATION_TURNS = 30
/** See the module header's "FIGURES" block for the citation. */
export const DEFAULT_STORM_ONSET_PROBABILITY_PER_TURN = 0.003

/** The reality-grounded defaults every caller gets unless it states otherwise. */
export const DEFAULT_WEATHER_TUNING: WeatherTuning = {
  stormOnsetProbabilityPerTurn: DEFAULT_STORM_ONSET_PROBABILITY_PER_TURN,
  minStormDurationTurns: DEFAULT_STORM_MIN_DURATION_TURNS,
  maxStormDurationTurns: DEFAULT_STORM_MAX_DURATION_TURNS,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** @throws {RangeError} if `value` is not a non-negative integer. */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

/** @throws {RangeError} if `value` is not a positive integer. */
function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, received: ${value}`)
  }
}

/** @throws {RangeError} if `value` is not a finite number in the closed interval [0, 1]. */
function assertUnitInterval(value: number, name: string): void {
  if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be a finite number in [0, 1], received: ${value}`)
  }
}

/**
 * @throws {RangeError} if any field of `tuning` is malformed, or if the maximum
 *   duration is shorter than the minimum.
 */
function validateWeatherTuning(tuning: WeatherTuning): void {
  assertUnitInterval(tuning.stormOnsetProbabilityPerTurn, 'stormOnsetProbabilityPerTurn')
  assertPositiveInteger(tuning.minStormDurationTurns, 'minStormDurationTurns')
  assertPositiveInteger(tuning.maxStormDurationTurns, 'maxStormDurationTurns')
  if (tuning.maxStormDurationTurns < tuning.minStormDurationTurns) {
    throw new RangeError(
      `maxStormDurationTurns (${tuning.maxStormDurationTurns}) must be >= ` +
        `minStormDurationTurns (${tuning.minStormDurationTurns})`,
    )
  }
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * Generate the whole dust-storm timeline for a mission, up front, from a seed.
 *
 * WALKS turn 1..`horizonTurns` once. On every turn with no storm currently being
 * placed, it draws exactly one `rand()` to decide whether a storm STARTS this turn; if
 * one does, a second `rand()` picks its duration (uniformly over the inclusive integer
 * range `[minStormDurationTurns, maxStormDurationTurns]`) and the walk jumps past the
 * storm's last turn before resuming onset checks — so two events NEVER overlap, though
 * (as in reality, where one storm's dissipation can overlap the next one's formation)
 * a new one may begin on the very next turn after the last one ended. A storm that
 * would run past `horizonTurns` is clipped to it, exactly as `turnsRemaining` clamps at
 * the mission deadline rather than reporting a turn that will never resolve.
 *
 * PURE AND DETERMINISTIC: draws from exactly one `mulberry32(seed)` instance and
 * returns a plain array with no reference to wall-clock time or any other seed's
 * stream. Identical `(seed, horizonTurns, tuning)` always returns a deep-equal, freshly
 * allocated array; changing any one of the three can change the result.
 *
 * @throws {RangeError} if `horizonTurns` is not a non-negative integer, or if `tuning`
 *   is malformed (see {@link WeatherTuning}).
 */
export function generateStormTimeline(
  seed: number,
  horizonTurns: number,
  tuning: WeatherTuning = DEFAULT_WEATHER_TUNING,
): readonly StormEvent[] {
  assertNonNegativeInteger(horizonTurns, 'horizonTurns')
  validateWeatherTuning(tuning)
  if (horizonTurns === 0) return []

  const rand = mulberry32(seed)
  const events: StormEvent[] = []
  const durationSpan = tuning.maxStormDurationTurns - tuning.minStormDurationTurns

  let turn = 1
  while (turn <= horizonTurns) {
    const onsetRoll = rand()
    if (onsetRoll >= tuning.stormOnsetProbabilityPerTurn) {
      turn += 1
      continue
    }

    const durationRoll = rand()
    // `durationSpan + 1` choices, uniformly, over the closed interval — the same
    // "roll then floor" idiom `buildability.ts`'s `pickKind` uses for a uniform pick
    // over a small integer range.
    const duration = tuning.minStormDurationTurns + Math.floor(durationRoll * (durationSpan + 1))
    const startTurn = turn
    const endTurn = Math.min(horizonTurns, startTurn + duration - 1)
    events.push({ startTurn, endTurn })
    turn = endTurn + 1
  }

  return events
}

// ---------------------------------------------------------------------------
// Reading the timeline into a colony
// ---------------------------------------------------------------------------

/** @throws {RangeError} if any event's `startTurn`/`endTurn` is malformed. */
function assertValidTimeline(timeline: readonly StormEvent[]): void {
  for (const event of timeline) {
    assertPositiveInteger(event.startTurn, 'StormEvent.startTurn')
    assertPositiveInteger(event.endTurn, 'StormEvent.endTurn')
    if (event.endTurn < event.startTurn) {
      throw new RangeError(
        `StormEvent.endTurn (${event.endTurn}) must be >= startTurn (${event.startTurn})`,
      )
    }
  }
}

/**
 * The colony-wide `GenerationEnvironment` for a single turn, read off a precomputed
 * timeline — a plain linear scan, since a mission's storm count is tiny (an expected
 * ~0.84 over the ratified 278-turn mission at the default tuning; see the module
 * header) and never large enough to warrant an interval index.
 *
 * @throws {RangeError} if `turn` is not a positive integer, or `timeline` contains a
 *   malformed event (see {@link assertValidTimeline}).
 */
function environmentForTurn(timeline: readonly StormEvent[], turn: number): GenerationEnvironment {
  assertPositiveInteger(turn, 'turn')
  assertValidTimeline(timeline)
  const active = timeline.some((event) => turn >= event.startTurn && turn <= event.endTurn)
  return active ? { dustStorm: true } : CALM_ENVIRONMENT
}

/**
 * Set `environment` on `state` for the turn about to resolve — `state.turnsTaken + 1`,
 * exactly the turn number `resolveTurn(state)` would report on its `CycleReport` if
 * called next.
 *
 * This is the caller-side step `turn.ts`'s own header reserved: "the plumbing a future
 * scheduler bead sets before calling `resolveTurn`". Everything else on `state` is
 * carried through UNCHANGED — this never touches the queue, the grid, the stockpiles
 * or anything else a colony carries, so composing it with `resolveTurn` cannot change
 * any other outcome; see `tests/integration/weather-seam.test.ts` for the seam proof
 * and `tests/unit/weather.test.ts` for the field-preservation unit proof.
 *
 * @throws {RangeError} if `state.turnsTaken` is not a non-negative integer, or
 *   `timeline` contains a malformed event.
 */
export function advanceWeather(state: ColonyState, timeline: readonly StormEvent[]): ColonyState {
  assertNonNegativeInteger(state.turnsTaken, 'state.turnsTaken')
  return { ...state, environment: environmentForTurn(timeline, state.turnsTaken + 1) }
}
