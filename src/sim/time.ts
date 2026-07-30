/**
 * The turn cycle and mission-deadline time model.
 *
 * This module is the sim's single source of truth for "how much time has passed"
 * and "how much time is left." Every quantity it stores or returns is an integer
 * number of seconds. This is a hard constraint, not a style preference: a clock
 * built on floating-point hours (e.g. a sol stored as 24.6597) accumulates
 * representation error across hundreds of turns, and a colony sim that cannot
 * replay identically from the same seed is not a colony sim, it is a slot
 * machine. Integers add and multiply exactly; floats do not. See constitution
 * §1 (determinism) for why this is non-negotiable project-wide.
 */

/** Seconds in one Earth hour. Named so "3600" never appears as a bare literal. */
const SECONDS_PER_HOUR = 3600

/** Seconds in one Earth day. Used only for the mission-deadline derivation below. */
const SECONDS_PER_EARTH_DAY = 86400

/**
 * Length of one Mars sol, in whole seconds, rounded down from the true value.
 *
 * A sol is 24h 39m 35.244s. We truncate to whole seconds (24h 39m 35s) because
 * the clock path is integer-seconds-only; the discarded 0.244s/sol is ~50s over
 * a 278-turn mission, negligible against a single turn (178,775s) and explicitly
 * accepted by the General rather than silently smuggled in as a float.
 *
 * 24 * 3600 + 39 * 60 + 35 = 86400 + 2340 + 35 = 88775.
 */
export const MARS_SOL_SECONDS = 24 * SECONDS_PER_HOUR + 39 * 60 + 35

/**
 * Length of a drone's work shift, in hours, before it must recharge.
 *
 * This is the one place the "25" appears as a literal; every other place that
 * needs it (the default config's `workSeconds`, `labourCapacityHours`) derives
 * from this constant rather than repeating the number, so the two can never
 * drift out of sync.
 */
export const DRONE_SHIFT_HOURS = 25

/** Drone work-shift length in seconds: 25h * 3600s/h = 90,000s. */
export const DRONE_WORK_SECONDS = DRONE_SHIFT_HOURS * SECONDS_PER_HOUR

/**
 * Mission deadline, in seconds: 577 Earth days.
 *
 * Derivation (do not replace with a bare literal — this is reality-grounded,
 * not a design guess):
 *   - Earth-Mars synodic period: 779.9 days. This is the time between one
 *     Earth-Mars launch window and the next — i.e. how often a new wave of
 *     colonists CAN depart Earth for Mars.
 *   - Starship transit time: 203 days. How long a departing wave takes to
 *     travel from Earth to Mars and land.
 *   - 779.9 - 203 = 576.9 days, rounded to 577: the interval from THIS
 *     colony's landing until the NEXT wave of colonists DEPARTS Earth (not
 *     until it arrives). That is the deadline this colony is racing against —
 *     it must be self-sufficient before the next wave commits to leaving,
 *     because after that point no message from Mars can change their minds.
 *   - 577 days * 86,400 s/day = 49,852,800 seconds.
 */
export const MISSION_DEADLINE_SECONDS = 577 * SECONDS_PER_EARTH_DAY

/**
 * Configuration for the turn cycle and mission length, all in integer seconds.
 *
 * Kept as plain data (not a class) so it can be constructed inline in tests
 * for scenarios other than the locked default — e.g. a shortened mission for
 * a fast-forward integration test — without touching the locked constants.
 */
export interface TurnCycleConfig {
  /** How long a drone can work before it must recharge, in seconds. */
  readonly workSeconds: number
  /** How long the recharge (one Mars sol) takes, in seconds. */
  readonly rechargeSeconds: number
  /** Total mission length before the deadline, in seconds. */
  readonly missionSeconds: number
}

/**
 * The locked, reality-grounded turn cycle ratified by the General.
 *
 * One turn = 25h drone work + one full Mars sol recharge = 90,000s + 88,775s
 * = 178,775s (~49.66h, ~2.014 sols). Do not hand-derive alternates elsewhere —
 * import this and the exported functions below instead, so a future change to
 * any one of these numbers only has to happen here.
 */
export const DEFAULT_TURN_CYCLE: TurnCycleConfig = {
  workSeconds: DRONE_WORK_SECONDS,
  rechargeSeconds: MARS_SOL_SECONDS,
  missionSeconds: MISSION_DEADLINE_SECONDS,
}

/**
 * Guards a config field as a strictly positive integer.
 *
 * Zero is rejected alongside negatives: a zero-length work shift or recharge
 * would make the turn cycle degenerate (division by a zero turn length
 * elsewhere, or an infinite-turn mission), so it is treated as a config error,
 * not a valid edge case. `Number.isInteger` already returns `false` for `NaN`
 * and `Infinity`, so both are rejected by the same check.
 */
function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive integer number of seconds, received: ${value}`,
    )
  }
}

/**
 * Guards a turn count as a non-negative integer.
 *
 * Unlike the config fields above, zero is valid here: "zero turns taken" is
 * the ordinary starting state of a fresh mission, not an error.
 */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

/**
 * Validates every field of a `TurnCycleConfig`.
 *
 * @throws {RangeError} if any field is not a positive integer. Called at the
 *   top of every exported function below so a malformed config (e.g. loaded
 *   from a corrupt save) fails loudly at the boundary instead of producing a
 *   silently wrong turn count deep in game logic.
 */
function validateTurnCycleConfig(config: TurnCycleConfig): void {
  assertPositiveInteger(config.workSeconds, 'workSeconds')
  assertPositiveInteger(config.rechargeSeconds, 'rechargeSeconds')
  assertPositiveInteger(config.missionSeconds, 'missionSeconds')
}

/**
 * The length of one full turn (work + recharge), in whole seconds.
 *
 * @throws {RangeError} if `config` fails validation.
 */
export function turnDurationSeconds(config: TurnCycleConfig): number {
  validateTurnCycleConfig(config)
  return config.workSeconds + config.rechargeSeconds
}

/**
 * The number of full turns that fit inside the mission deadline.
 *
 * Uses `Math.floor` rather than rounding: a partially-completed turn does not
 * count as a turn the colony gets to act in, so it must not inflate the total.
 * The division here is safe from float drift at these magnitudes — both
 * operands are well inside `Number.MAX_SAFE_INTEGER`, and the true quotient
 * for the locked mission (~278.85) sits far enough from the 278/279 boundary
 * that IEEE-754 rounding error (~1e-16 relative) cannot flip the floor.
 *
 * @throws {RangeError} if `config` fails validation.
 */
export function totalTurns(config: TurnCycleConfig): number {
  validateTurnCycleConfig(config)
  return Math.floor(config.missionSeconds / turnDurationSeconds(config))
}

/**
 * Turns remaining before the mission deadline, given how many have elapsed.
 *
 * Clamped at zero: a turn counter that has run past the total (e.g. because a
 * caller kept simulating after the deadline for epilogue/debrief purposes)
 * must never report a negative number of turns remaining.
 *
 * @throws {RangeError} if `config` fails validation or `turnsTaken` is not a
 *   non-negative integer.
 */
export function turnsRemaining(config: TurnCycleConfig, turnsTaken: number): number {
  validateTurnCycleConfig(config)
  assertNonNegativeInteger(turnsTaken, 'turnsTaken')
  const remaining = totalTurns(config) - turnsTaken
  return remaining > 0 ? remaining : 0
}

/**
 * Total wall-clock seconds elapsed after `turnsTaken` full turns.
 *
 * Deliberately not clamped to the mission length: unlike `turnsRemaining`,
 * this is a plain multiplication with no "past the end" special case for the
 * caller to worry about, and callers that need to compare against the
 * deadline can do so themselves against `missionSeconds`.
 *
 * @throws {RangeError} if `config` fails validation or `turnsTaken` is not a
 *   non-negative integer.
 */
export function elapsedSeconds(config: TurnCycleConfig, turnsTaken: number): number {
  validateTurnCycleConfig(config)
  assertNonNegativeInteger(turnsTaken, 'turnsTaken')
  return turnDurationSeconds(config) * turnsTaken
}

/**
 * Total robot-hours of labour available from `droneCount` drones on shift.
 *
 * Derives hours-per-shift from `config.workSeconds` (rather than hardcoding
 * `25` a second time) so this can never drift from the turn-cycle config it
 * is describing. This is the one spot in the module where a seconds value is
 * converted to hours, so it is also the one spot that could silently
 * introduce a float: if `workSeconds` were not a whole number of hours, the
 * division below would produce a fraction. Rather than truncate that away
 * (which would silently under-report capacity) this rejects such a config
 * outright — a partial-hour drone shift is not a supported scenario.
 *
 * @throws {RangeError} if `config` fails validation, if `config.workSeconds`
 *   is not an exact whole number of hours, or if `droneCount` is not a
 *   non-negative integer.
 */
export function labourCapacityHours(config: TurnCycleConfig, droneCount: number): number {
  validateTurnCycleConfig(config)
  assertNonNegativeInteger(droneCount, 'droneCount')

  if (config.workSeconds % SECONDS_PER_HOUR !== 0) {
    throw new RangeError(
      `workSeconds (${config.workSeconds}) must be an exact whole number of hours ` +
        'to compute labour capacity without floating-point error',
    )
  }

  const hoursPerShift = config.workSeconds / SECONDS_PER_HOUR
  return hoursPerShift * droneCount
}
