/**
 * Mission clock, habitat readiness & win/lose verdict.
 *
 * This is the sim's goal function. The colony is UNMANNED for the entire mission —
 * zero humans on Mars until the next colonist wave lands — so there is no population
 * to simulate, no food/health/morale loop, nothing to optimize except one question:
 * "when the clock runs out, is there enough completed habitat capacity to house the
 * arriving wave?" Everything below exists to answer that question, and nothing else.
 *
 * Deliberately built ON TOP of `time.ts` (`totalTurns`/`turnsRemaining`), never
 * duplicating it: the deadline turn is derived from the turn-cycle config every time,
 * so a future change to the turn cycle or the mission length automatically flows
 * through here without this module needing to change.
 *
 * On "completed vs in-progress" — modelling a system that doesn't exist yet:
 * There is no construction/build-progress module in the codebase yet (placement.ts
 * only tracks *where* a structure sits on the grid, not build progress). Rather than
 * invent one here — which would either duplicate a future construction module or
 * couple this pure goal-function module to that module's eventual, still-unstable
 * shape — `HabitatStructure` below is a minimal, self-contained data contract: the
 * two fields `habitatCapacity` and `buildTurns` are `Pick`ed directly from
 * `catalog.ts`'s `StructureType` (so this module is provably describing the same
 * "capacity" and "build cost" the catalog already defines), plus one new field,
 * `turnsCompleted`, representing however many turns of drone labour a future
 * construction system has applied toward that structure's `buildTurns`. Whatever
 * shape the real construction system ends up taking, mapping its per-instance state
 * into `{ habitatCapacity, buildTurns, turnsCompleted }` is a one-line adapter, and
 * this module never has to import or know about placement, drones, or the grid.
 */

import { totalTurns, turnsRemaining, type TurnCycleConfig } from './time'
import type { StructureType } from './catalog'

/**
 * The minimal per-instance data this module needs from a placed structure.
 *
 * `habitatCapacity` and `buildTurns` are `Pick`ed from `StructureType` (see the
 * module doc above) rather than redeclared, so this can never silently drift from
 * what the catalog means by those two names. `turnsCompleted` is the one field this
 * module adds: how many turns of construction have been applied so far.
 */
export type HabitatStructure = Pick<StructureType, 'habitatCapacity' | 'buildTurns'> & {
  /** Turns of drone labour applied toward `buildTurns` so far. */
  readonly turnsCompleted: number
}

/**
 * Data-driven mission tunables. Both the deadline (via `turnCycle`) and the
 * incoming wave size are configuration, never literals baked into the logic below
 * — a design change to either must only ever require a new `MissionConfig` value,
 * not a code change in `evaluateMission`.
 */
export interface MissionConfig {
  /** The turn cycle whose `totalTurns(...)` marks the mission deadline. */
  readonly turnCycle: TurnCycleConfig
  /** Number of colonists arriving when the deadline hits. Must be housed to win. */
  readonly incomingWaveSize: number
}

/** The three (and only three) states a mission can be in. */
export type MissionStatus = 'in-progress' | 'won' | 'lost'

/**
 * The clock has not yet reached the deadline turn. No verdict exists yet — habitat
 * capacity is intentionally NOT reported here, because it is not yet meaningful as
 * a verdict input (the colony may still complete more habitats before the deadline).
 */
export interface MissionInProgress {
  readonly status: 'in-progress'
  readonly turnsRemaining: number
}

/**
 * The clock has reached (or passed) the deadline turn and a verdict has been
 * computed. `turnsRemaining` is always `0` here (the deadline has been reached),
 * included so callers can render a single `turnsRemaining` field regardless of
 * `status` without a branch.
 */
export interface MissionResolved {
  readonly status: 'won' | 'lost'
  readonly turnsRemaining: number
  /** Total capacity of only the COMPLETED structures at resolution time. */
  readonly habitatCapacity: number
  /** Echoed from `MissionConfig` for convenient display alongside the verdict. */
  readonly incomingWaveSize: number
}

/** The result of evaluating a mission at a given turn count. */
export type MissionOutcome = MissionInProgress | MissionResolved

/**
 * Guards a value as a non-negative integer, mirroring the discipline in
 * `time.ts` and `catalog.ts`: malformed data (fractional, negative, NaN, Infinity)
 * is a programmer/data error and must fail loudly at the boundary, not silently
 * corrupt a sum or a comparison deep inside the verdict logic.
 */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

/**
 * Whether a structure's construction has finished.
 *
 * `turnsCompleted >= buildTurns` (not `===`) so a structure that has accrued more
 * labour than strictly required (e.g. a future construction system that doesn't
 * clamp progress at the cap) is still correctly treated as complete rather than
 * falling through as neither complete nor sensibly incomplete.
 *
 * @throws {RangeError} if `buildTurns` or `turnsCompleted` is not a non-negative
 *   integer.
 */
export function isStructureComplete(structure: HabitatStructure): boolean {
  assertNonNegativeInteger(structure.buildTurns, 'structure.buildTurns')
  assertNonNegativeInteger(structure.turnsCompleted, 'structure.turnsCompleted')
  return structure.turnsCompleted >= structure.buildTurns
}

/**
 * Sum of `habitatCapacity` across only the COMPLETED structures in `structures`.
 *
 * This is the single most safety-critical calculation in the mission module: a
 * habitat at 9/10 build turns houses nobody, and must contribute exactly zero, not
 * a fraction of its rated capacity and not its full rated capacity. Returns `0` for
 * an empty list rather than throwing — "no structures yet" is the ordinary starting
 * state of a fresh colony, not an error.
 *
 * @throws {RangeError} if any structure's `habitatCapacity`, `buildTurns`, or
 *   `turnsCompleted` is not a non-negative integer.
 */
export function totalHabitatCapacity(structures: readonly HabitatStructure[]): number {
  let capacity = 0
  for (const structure of structures) {
    assertNonNegativeInteger(structure.habitatCapacity, 'structure.habitatCapacity')
    if (isStructureComplete(structure)) {
      capacity += structure.habitatCapacity
    }
  }
  return capacity
}

/**
 * Validates the mission-specific tunable this module adds on top of `TurnCycleConfig`.
 * `turnCycle` itself is validated by the `time.ts` functions called from
 * `evaluateMission`, so it is deliberately not re-checked here.
 *
 * @throws {RangeError} if `incomingWaveSize` is not a non-negative integer.
 */
function assertValidMissionConfig(config: MissionConfig): void {
  assertNonNegativeInteger(config.incomingWaveSize, 'config.incomingWaveSize')
}

/**
 * Evaluate the mission's clock and, once the deadline has been reached, its
 * win/lose verdict.
 *
 * The verdict is computed fresh from `turnsTaken` and `structures` on every call —
 * this function is pure and stateless, so it is only ever called with the "wrong"
 * timing if a CALLER re-evaluates it every turn instead of once at the deadline.
 * Given identical inputs it always returns the identical outcome (that is what
 * "resolved" means below: once `turnsTaken` reaches the deadline turn, the verdict
 * is fixed and re-querying it — e.g. for an end-of-mission epilogue screen several
 * turns later — must keep returning the same win/lose result, not flip or re-roll).
 *
 * @param config Data-driven deadline (via `turnCycle`) and incoming wave size.
 * @param turnsTaken Turns elapsed so far. Passed straight through to
 *   `time.ts`'s `turnsRemaining`, which enforces it is a non-negative integer.
 * @param structures Every structure known to the colony, complete or not.
 *   `totalHabitatCapacity` is responsible for filtering to only the completed ones.
 * @throws {RangeError} if `config.turnCycle` or `turnsTaken` fails `time.ts`
 *   validation, if `config.incomingWaveSize` is not a non-negative integer, or if
 *   any structure's fields are invalid.
 */
export function evaluateMission(
  config: MissionConfig,
  turnsTaken: number,
  structures: readonly HabitatStructure[],
): MissionOutcome {
  assertValidMissionConfig(config)

  const deadlineTurn = totalTurns(config.turnCycle)
  const remaining = turnsRemaining(config.turnCycle, turnsTaken)

  if (turnsTaken < deadlineTurn) {
    return { status: 'in-progress', turnsRemaining: remaining }
  }

  const habitatCapacity = totalHabitatCapacity(structures)
  const status: 'won' | 'lost' = habitatCapacity >= config.incomingWaveSize ? 'won' : 'lost'

  return {
    status,
    turnsRemaining: remaining,
    habitatCapacity,
    incomingWaveSize: config.incomingWaveSize,
  }
}
