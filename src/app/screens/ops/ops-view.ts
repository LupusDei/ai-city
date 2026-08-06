/**
 * Every figure the Colony Operations screen displays, SELECTED from the adapter's state —
 * and nothing computed.
 *
 * ============================================================================
 * THIS MODULE SELECTS. IT DOES NOT CALCULATE. (Constitution §4, spec 005 FR-002)
 * ----------------------------------------------------------------------------
 * Every numeric field below is a field the SIM produced, copied across unchanged. There is
 * no arithmetic on game state anywhere in this file, and in particular there is no
 * `turnsTaken + 1`: `RunningState.outlook` exists precisely so the current turn number and
 * the turns remaining arrive as sim fields, because `resolveTurn` has already advanced the
 * clock and evaluated the mission for the turn in progress, and a second hand-rolled copy of
 * that arithmetic in the UI is exactly the drift FR-002 forbids.
 *
 * The three reads that are not plain field copies, and why each is legitimate:
 *   - `totalTurns(mission.turnCycle)` — a PURE sim read, explicitly sanctioned by
 *     `tests/unit/app-boundary.test.ts` ("PURE READS are fine here": time.totalTurns,
 *     time.turnsRemaining, grid.tileAt, world.depositCoords and friends).
 *   - `.length` on `dronesOnShift` and `droneRoster` — counting a list the sim built, which
 *     the adapter's own docblock names as the intended read for drones on shift.
 *   - finding `electricity` in the ledger's `vented` list — a lookup by key, not a
 *     computation. See {@link ventedElectricityWh}.
 *
 * ============================================================================
 * WHY A `.ts` MODULE RATHER THAN LOGIC INSIDE THE COMPONENT
 * ----------------------------------------------------------------------------
 * `vitest.config.ts` excludes `src/app/**\/*.tsx` from the coverage gate and pointedly does
 * NOT exclude pure `.ts` under `src/app/`. Selection logic living in the `.tsx` would be the
 * one part of this screen outside the 80/70/60 threshold. `aic-c1p` is what that costs: a
 * screen at 100% coverage fed by data nothing produced.
 *
 * It also makes the screen's honesty auditable. "Does the ops screen invent any number of
 * its own?" is answered by reading this file, not by reading a layout.
 *
 * DETERMINISM. Pure functions of their arguments. No clock, no randomness, no locale — see
 * {@link groupDigits} for why the last of those is not a nitpick. ★AC-4.3 compares two
 * renders of the same seed for string equality, and every string on the screen is produced
 * here.
 */

import type { ConstructionQueue } from '../../../sim/construction'
import type { Vented } from '../../../sim/ledger'
import type { MissionOutcome } from '../../../sim/mission'
import { ELECTRICITY } from '../../../sim/power'
import { totalTurns } from '../../../sim/time'
import type { CycleReport } from '../../../sim/turn'
import type { World } from '../../../sim/world'
import type { RunningState } from '../../state/game-state'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Group a whole number's digits in threes with commas: `1986389` -> `"1,986,389"`.
 *
 * WHY NOT `toLocaleString`. Because it renders `"1 986 389"` or `"1.986.389"` depending on
 * the machine's locale, which would make the screen's text a function of the environment.
 * ★AC-4.3 compares two renders for string equality and would still pass — both runs share a
 * locale — so this would not fail the acceptance suite; it would simply mean the game reads
 * differently on a colleague's laptop and that the golden figures in the unit tests are
 * locale-dependent assertions pretending to be constants. A deterministic simulation
 * deserves a deterministic readout.
 *
 * The lookahead inserts a separator only where a multiple of three digits follows and a
 * digit does not, and `\B` keeps a leading sign or non-digit from being treated as a group
 * boundary — so `-1234` is `"-1,234"` and never `"-,1234"`.
 */
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * A watt-hour quantity as the player reads it: `"1,029,776 Wh"`.
 *
 * Wh, NOT kWh. Converting would mean dividing a sim figure inside the app layer, and the
 * whole point of this module is that it performs no arithmetic on game state. The sim's unit
 * is watt-hours end to end (`power.ts`, `ledger.ts`, every `CycleReport` field), so the
 * screen speaks watt-hours and the number the player sees is the number the sim recorded.
 *
 * Zero renders as `"0 Wh"` and never as an empty string. AC-4.2's premise is that "a number
 * the player cannot see is a mechanic the player cannot learn" — and "nothing was vented
 * this turn" is itself information.
 */
export function formatWattHours(wattHours: number): string {
  return `${groupDigits(wattHours)} Wh`
}

/**
 * One decimal place on the total, matching `survey-readouts.ts`'s `TOTAL_DECIMALS`.
 *
 * The two screens show the SAME number and must therefore show it the same way — the survey
 * screen renders `breakdown.total.toFixed(1)` and the operations screen renders
 * `landing.score`, which the sim documents as equal to it. A player who saw "55.2" while
 * choosing and "55.19023601229619" while playing would reasonably conclude the game had
 * recomputed their landing.
 *
 * It is duplicated rather than imported because `survey-readouts.ts` keeps the constant
 * private and belongs to the survey screen; reaching into it would couple this screen to
 * another one's internals for a single digit. If a third screen ever needs it, the pair
 * belongs in `world-readouts.ts` alongside the other cross-screen formatters — which exists
 * for precisely this hazard.
 */
const LANDING_SCORE_DECIMALS = 1

/**
 * The landing score as the player read it while choosing: `"55.2"`, never
 * `"55.19023601229619"`.
 *
 * Fourteen decimal places is what `String(score)` produced, and it was on screen. It is not
 * merely untidy — it is the float's internal representation escaping into the fiction, and
 * it implies a precision that three hyperbolic decay curves evaluated at tile resolution do
 * not have. `toFixed` rounds half away from zero deterministically for these magnitudes and
 * is locale-independent, unlike `toLocaleString`; see {@link groupDigits}.
 */
export function formatLandingScore(score: number): string {
  return score.toFixed(LANDING_SCORE_DECIMALS)
}

/**
 * How much ELECTRICITY the ledger vented this turn, or `0` if none was.
 *
 * A lookup by resource key over the sim's own `Vented[]`, not a calculation: the amount is
 * `ledger.ts`'s figure, carried through untouched. Electricity specifically, because under
 * the General's no-storage ruling it is the resource that vents every single turn and the
 * one the readout exists for; a future overflowing silo is `CycleReport.overflow`, which
 * `ledger.ts` keeps separate precisely because the player's response differs (build a
 * battery vs. build a silo).
 *
 * Absent means zero rather than undefined. The ledger only lists a resource it actually
 * vented, so "no entry" and "vented nothing" are the same fact, and making the screen branch
 * on it would put a null check in front of the one number AC-4.2 exists to keep visible.
 */
export function ventedElectricityWh(vented: readonly Vented[]): number {
  return vented.find((entry) => entry.resource === ELECTRICITY)?.amount ?? 0
}

/**
 * The mission verdict as one sentence, from `mission.ts`'s own `MissionOutcome`.
 *
 * Branches on the sim's discriminant and reports the sim's fields; it decides nothing. Note
 * that `MissionInProgress` deliberately carries NO habitat capacity — `mission.ts` withholds
 * it because it is not yet meaningful as a verdict input — so this says only that the
 * mission is under way, and the screen shows capacity in its own readout regardless.
 */
export function missionVerdictText(mission: MissionOutcome): string {
  if (mission.status === 'in-progress') return 'Mission in progress'

  const headline = mission.status === 'won' ? 'Mission accomplished' : 'Mission failed'
  return (
    `${headline} — habitat capacity ${String(mission.habitatCapacity)} ` +
    `of ${String(mission.incomingWaveSize)} colonists`
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** Everything the ops screen renders, flat and free of nulls the layout would have to check. */
export interface OpsView {
  /**
   * The SURVEYED world, by reference — the adapter carries it across the phase change
   * rather than regenerating it, which is what makes ★AC-3.2 possible at all.
   */
  readonly world: World
  /**
   * Every structure standing on the colony, complete or not — `ColonyState.queue`, by
   * reference and unchanged.
   *
   * Here so the colony plate can DRAW the colony. `render-colony.ts` reads each project's
   * `tiles`, which `queueConstruction` wrote through the sim's own placement path, so the
   * map shows where the simulation actually put things rather than where a component
   * calculated they should go. Carried on the view rather than read off `state.colony` in
   * the layout for the reason this whole module exists: one place answers "what does the
   * screen see".
   */
  readonly queue: ConstructionQueue
  /**
   * Structure instance ids the colony has taken OUT OF SERVICE — destroyed, damaged, or shut
   * down for maintenance — as distinct from not yet built. `ColonyState.offlineStructureIds`,
   * by reference.
   *
   * Paired with {@link queue} because the two together answer "what do I own, and is it
   * running", and neither answers it alone: the queue holds every instance whether or not it
   * operates, and this list holds ids with no footprint attached. An offline generator
   * produces nothing and an offline consumer draws nothing, so this is the difference between
   * a structure the player can count on and one they cannot.
   */
  readonly offlineStructureIds: readonly string[]
  /** The turn now in progress (1, then 2, ...), or the final turn once the mission is over. */
  readonly turn: number
  /** The mission length: `totalTurns(turnCycle)`, i.e. 278. A pure sim read. */
  readonly totalTurns: number
  /** Turns left before the colonist wave arrives. The sim's figure, not `total - turn`. */
  readonly turnsRemaining: number
  /** Turns elapsed. The token an `end-cycle` intent must name — see `end-cycle-guard.ts`. */
  readonly turnsTaken: number
  /** Whether a further turn will resolve at all (`outlook !== null`). */
  readonly cycleInProgress: boolean
  readonly generationWh: number
  /** Total demand put to the brownout: operating structures plus every drone. */
  readonly powerDrawWh: number
  /** Turn capacity actually delivered. */
  readonly suppliedWh: number
  /**
   * Generation that reached nothing. Non-zero even in a brownout, because strict-order
   * shedding leaves capacity idle rather than bin-packing — reporting it is what makes that
   * tradeoff honest (`brownout.ts`).
   */
  readonly idleCapacityWh: number
  readonly brownout: boolean
  /**
   * The one integer that explains the whole turn: everything above it ran, everything at or
   * below it did not. `null` when nothing was shed.
   */
  readonly cutLine: number | null
  /** Energy produced with nowhere to go, and therefore gone. See {@link ventedElectricityWh}. */
  readonly ventedElectricityWh: number
  readonly dronesOnShift: number
  readonly dronesHeldOffline: number
  readonly droneRosterSize: number
  /** Robot-hours the on-shift drones yield — the colony's build rate. */
  readonly labourCapacityHours: number
  readonly habitatCapacity: number
  readonly mission: MissionOutcome
  /** The score the chosen landing earned, so the decision stays visible during the mission. */
  readonly landingScore: number
}

/**
 * The report the screen is currently describing: the turn IN PROGRESS while one is, and the
 * final resolved turn once the mission is over.
 *
 * Two fields, one question. `outlook` is the forecast for the turn the player is about to
 * commit and is null exactly when the mission has concluded; `lastReport` is what the most
 * recent turn actually did and is null exactly before the first one. So at most one of them
 * is ever missing, and preferring `outlook` means the screen shows the live turn whenever
 * there is one and the final figures when there is not — instead of blanking out at the very
 * moment the player wants to read the result.
 */
function reportOnDisplay(state: RunningState): CycleReport | null {
  return state.outlook ?? state.lastReport
}

/**
 * Select the ops screen's whole display from the adapter's state.
 *
 * Returns `null` only when the state carries no report at all. That is unreachable through
 * the adapter — `begin-mission` always sets an outlook and `end-cycle` always sets a
 * lastReport — but a total function is what lets the component handle it with one narrowing
 * check instead of a non-null assertion, which is an ERROR in `src/` and would be a page
 * crash if it were ever wrong. Same discipline as `TerrainCanvas`'s null context.
 */
export function opsView(state: RunningState): OpsView | null {
  const report = reportOnDisplay(state)
  if (report === null) return null

  const { electricity } = report

  return {
    world: state.world,
    queue: state.colony.queue,
    offlineStructureIds: state.colony.offlineStructureIds,
    turn: report.turn,
    totalTurns: totalTurns(state.colony.mission.turnCycle),
    turnsRemaining: report.mission.turnsRemaining,
    turnsTaken: state.colony.turnsTaken,
    cycleInProgress: state.outlook !== null,
    generationWh: electricity.generationWh,
    powerDrawWh: electricity.totalDemandWh,
    suppliedWh: electricity.suppliedWh,
    idleCapacityWh: electricity.unusedWh,
    brownout: electricity.brownout,
    cutLine: electricity.cutLine,
    ventedElectricityWh: ventedElectricityWh(report.vented),
    dronesOnShift: electricity.dronesOnShift.length,
    dronesHeldOffline: electricity.dronesHeldOffline.length,
    droneRosterSize: state.colony.droneRoster.length,
    labourCapacityHours: electricity.labourCapacityHours,
    habitatCapacity: report.habitatCapacity,
    mission: report.mission,
    landingScore: state.landing.score,
  }
}

// ---------------------------------------------------------------------------
// The turn that just ended
// ---------------------------------------------------------------------------

/**
 * What the most recently RESOLVED turn actually did — the record of the past, as distinct
 * from {@link OpsView}, which describes the turn in progress.
 *
 * Kept separate rather than folded into `OpsView` because the two answer different
 * questions and confusing them is a specific, easy mistake: `outlook.completedThisTurn`
 * describes a turn that has not happened, and rendering it under a "completed" heading would
 * promise the player a building they have not finished. Splitting the types makes that
 * mistake impossible to make silently.
 */
export interface CycleSummary {
  /** The turn number just completed. */
  readonly turn: number
  /** Labour-hours that reached a project. Always a whole number of build-turns. */
  readonly labourHoursApplied: number
  /** Labour-hours no queued project could absorb, and therefore lost. */
  readonly labourHoursUnused: number
  /** Structure ids that crossed from incomplete to complete during this turn. */
  readonly completedThisTurn: readonly string[]
  readonly ventedElectricityWh: number
  readonly cutLine: number | null
}

/**
 * The turn just ended, or `null` before the first one has resolved.
 *
 * Null is rendered as absence, not as zeros: on a fresh colony nothing has happened yet, and
 * a "last cycle" panel full of zeros would be a claim about a turn that was never taken.
 */
export function lastCycleSummary(state: RunningState): CycleSummary | null {
  const report = state.lastReport
  if (report === null) return null

  return {
    turn: report.turn,
    labourHoursApplied: report.labourHoursApplied,
    labourHoursUnused: report.labourHoursUnused,
    completedThisTurn: report.completedThisTurn,
    ventedElectricityWh: ventedElectricityWh(report.vented),
    cutLine: report.electricity.cutLine,
  }
}
