/**
 * The sim/UI adapter: the ONE surface between React and the simulation (aic-8tl.5,
 * spec 005 FR-004).
 *
 * WHY THIS MODULE EXISTS. Every screen in this project is a view over a deterministic
 * sim that owns every rule. Without a single seam, each screen grows its own copy of
 * "how do I start a colony", "how do I end a turn", and — the expensive one — its own
 * opinion about what the current state IS. That is how a UI ends up mutating sim state
 * directly and how two screens end up disagreeing about the same colony. FR-004 forbids
 * it: all player actions go through one intent-dispatch surface. This is that surface,
 * and `tests/unit/app-boundary.test.ts` is the gate that keeps it the only one.
 *
 * ============================================================================
 * THIS IS A BOUNDARY, NOT A LAYER. IT CONTAINS NO GAME LOGIC.
 * ----------------------------------------------------------------------------
 * Every number a screen displays is produced by a sim function and STORED here
 * unchanged. Nothing in this file computes a score, a power figure, a turn count or a
 * verdict — if you find yourself about to, it belongs in `src/sim/`. Two independent
 * gates keep the sim clean of the reverse dependency (`tests/unit/boundary.test.ts` and
 * `tsconfig.sim.json`), and this file is the matching discipline on the app side: it
 * calls, it stores, it routes. That is all.
 *
 * Concretely, everything below delegates:
 *   - the world comes from `world.generateWorld`
 *   - the site score and its rejection come from `colony-start.evaluateLandingOn`
 *   - the colony comes from `colony-start.buildColony`
 *   - a turn comes from `turn.resolveTurn`
 *   - a build/cancel order comes from `orders.applyOrders`
 * ============================================================================
 *
 * ============================================================================
 * THE WORLD AND THE COLONY ARE A PAIR. DO NOT MERGE THEM.
 * ----------------------------------------------------------------------------
 * `ColonyState` deliberately carries NO deposits, no terrain and no buildability:
 * `turn.ts` and `colony-start.ts` both document the world as the STATIC substrate and
 * the colony as the mutable state on top of it, precisely so the map has one source of
 * truth. Every bridge function that returns a colony also returns the world it was built
 * from, for exactly this reason.
 *
 * So this adapter holds `{ world, colony }` as a pair, and it MUST NOT absorb the world
 * into colony state — that would recreate the two-sources-of-truth defect `ColonyState`
 * was written to avoid. It is also what makes the acceptance suite's ★AC-3.2 possible at
 * all: the survey screen and the ops screen both read a deposit count, and they can only
 * agree because the world travels alongside the colony instead of being regenerated.
 * `begin-mission` carries `world` across the phase change BY REFERENCE, and
 * `tests/unit/game-state.test.ts` pins that by object identity — a re-roll from the same
 * seed is deep-equal to the original, so only identity can tell the two apart.
 * ============================================================================
 *
 * ============================================================================
 * TWO PHASES, AS A DISCRIMINATED UNION — NOT A PILE OF NULLABLE FIELDS
 * ----------------------------------------------------------------------------
 * The app is either SURVEYING (a world, zero/one/two hull anchors, a score once both are
 * down) or RUNNING (a world plus a colony). Modelled as a union on `phase`, matching the
 * pattern the sim already uses everywhere (`LandingReadiness`, `PlacementRejection`,
 * `MissionOutcome`, `StartMissionResult`).
 *
 * The alternative — one flat record with `colony: ColonyState | null` — makes a
 * half-started mission REPRESENTABLE: a colony alongside a still-incomplete selection, or
 * a selection alongside a live colony. The spec has an edge case for each ("reload
 * mid-survey must not present a half-started mission"; "browser back after starting must
 * not resurrect a stale survey over a live colony"). A union makes both states impossible
 * to construct rather than something a screen has to remember to check.
 *
 * There are exactly two nullable fields, both on `RunningState`, and each marks a genuine
 * absence at one END of the mission rather than a half-built state:
 *   - `lastReport` is null before the first turn has resolved (nothing has happened yet).
 *   - `outlook` is null once the mission has concluded (no further turn will be taken).
 * ============================================================================
 *
 * DETERMINISM. Pure functions of their arguments. No `Date.now`, no `Math.random`, no
 * clock, no I/O, and no `Set`/`Map` iteration anywhere — the one ordered output this
 * module produces itself, `placedHulls`, is built by two `if`s in a fixed order.
 * Spec 005's ★AC-4.3 requires the same seed, landing and orders to render an identical
 * turn 1, and the sim's determinism only survives if this seam adds none of its own. The
 * seed itself is decided in `src/app/seed.ts` (the one place allowed to be random) and
 * arrives here as an already-decided number.
 */

import type { DepositOptions } from '../../sim/buildability'
import {
  DRONE_HULL_ID,
  REACTOR_HULL_ID,
  buildColony,
  evaluateLandingOn,
} from '../../sim/colony-start'
import type { Coord } from '../../sim/grid'
import type {
  HullId,
  LandingRejection,
  LandingReadiness,
  LandingSelection,
  ReadyLanding,
} from '../../sim/landing'
import type { MissionConfig } from '../../sim/mission'
import { applyOrders } from '../../sim/orders'
import type { OrderOutcome, PlayerOrder } from '../../sim/orders'
import { DEFAULT_TURN_CYCLE } from '../../sim/time'
import { resolveTurn } from '../../sim/turn'
import type { ColonyState, CycleReport } from '../../sim/turn'
import { generateWorld } from '../../sim/world'
import type { World } from '../../sim/world'

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

/**
 * The ratified colony map: 64x64 tiles, 320 m on a side at `TILE_EDGE_METRES` (README).
 *
 * Held here rather than in a component because the map size is an input to the SIM call
 * that surveys the world, and this module owns that call. It matches `turn.ts`'s private
 * `DEFAULT_GRID_DIMENSION`; that constant is not exported, and threading it out of the
 * turn loop to serve the app is the wrong seam to open for one number.
 */
export const MAP_DIMENSION = 64

/**
 * Colonists arriving when the deadline hits — the mission's win threshold.
 *
 * NOT A RATIFIED FIGURE, and flagged as such rather than presented as one. The README
 * locks the deadline (577 days = 278 turns) and the win CONDITION ("habitat capacity
 * sufficient for the arriving colonist wave") but no document in this repo states the
 * wave SIZE. Six is taken from `docs/turn-composition-audit.md`, which describes one
 * habitat's 25 kW rated life support as "~4 kW x 6 colonists of rated capacity" — i.e.
 * one completed habitat houses one wave, which makes the MVP's win condition "finish a
 * habitat" rather than an arbitrary arithmetic target.
 *
 * It is authored HERE because `mission.ts` is explicit that both the deadline and the
 * wave size are data ("a design change to either must only ever require a new
 * `MissionConfig` value, not a code change"), and the composition root is what supplies
 * that data. It affects nothing in this slice except the verdict AT the deadline — turn 1
 * through 277 are identical for any value. Replace it when the General rules on a number;
 * `beginSurvey` takes a `mission` override so no test has to depend on this default.
 */
export const INCOMING_WAVE_SIZE = 6

/** The mission every session runs unless a caller states otherwise. */
export const DEFAULT_MISSION: MissionConfig = {
  turnCycle: DEFAULT_TURN_CYCLE,
  incomingWaveSize: INCOMING_WAVE_SIZE,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Choosing where to land: a surveyed world, and up to two hull anchors on it. */
export interface SurveyingState {
  readonly phase: 'surveying'
  /** The session seed, so it stays displayable on every screen (FR-005). */
  readonly seed: number
  /** Carried until `begin-mission` needs it. Configuration, never derived. */
  readonly mission: MissionConfig
  /** The surveyed world. Generated ONCE, at `beginSurvey`, and never regenerated. */
  readonly world: World
  /** The anchors the player has committed. A refused selection never lands here. */
  readonly selection: LandingSelection
  /**
   * The sim's verdict on {@link selection} — always evaluated from the COMMITTED
   * selection, so the two can never disagree.
   */
  readonly readiness: LandingReadiness
  /**
   * Why the most recent attempted selection was refused, or `null` if it was accepted.
   *
   * The sim's typed `LandingRejection` object, carried through UNTOUCHED (FR-006:
   * "illegal actions MUST surface the sim's typed rejection reason verbatim, not a
   * generic message"). Not stringified, not re-worded, not wrapped: the screen renders
   * `out-of-bounds` / `unbuildable` / `overlapping-hulls` from `reason`, and has the
   * offending tile and hull available alongside it.
   */
  readonly rejection: LandingRejection | null
}

/** The mission is under way: the surveyed world, plus the colony standing on it. */
export interface RunningState {
  readonly phase: 'running'
  readonly seed: number
  /**
   * The SAME `World` object the survey scored — see the header. The colony carries no
   * deposits, terrain or buildability of its own, so this is where the ops screen's
   * deposit count and grid dimensions come from.
   */
  readonly world: World
  /** The scored landing this colony was built from, score and breakdown included. */
  readonly landing: ReadyLanding
  readonly colony: ColonyState
  /**
   * What the most recently RESOLVED turn actually did, or `null` before the first one.
   *
   * This is the record of the past: brownout cut line, vented energy, completions.
   */
  readonly lastReport: CycleReport | null
  /**
   * `resolveTurn`'s report for the turn now IN PROGRESS — a forecast, whose state half
   * is discarded — or `null` once the mission has concluded.
   *
   * WHY THIS EXISTS. Spec 005's AC-3.3 requires the ops screen to show power generation,
   * power draw, drones on shift and habitat capacity AT TURN 1, before any turn has been
   * resolved. Those figures come from turn resolution's frozen operational set, and the
   * predicate that decides which structures are in standby is PRIVATE to `turn.ts`. So a
   * screen cannot reconstruct them without reimplementing half the turn loop — which is
   * exactly the "no game logic in components" violation this module exists to prevent.
   * Asking the sim for the turn's own report and storing it is the alternative, and it
   * costs one extra pure call per state change.
   *
   * It is a FORECAST, so treat it as one: `completedThisTurn` describes a turn that has
   * not happened. For what DID happen, read {@link lastReport}.
   *
   * WHAT THE OPS SCREEN READS FROM IT, with no arithmetic of its own — every acceptance
   * figure for the turn IN PROGRESS is already a field here, computed by the sim:
   *   - `outlook.turn` .......................... the current turn number (1, then 2, ...)
   *   - `outlook.mission.turnsRemaining` ........ turns-remaining (277 at turn 1, then 276)
   *   - `outlook.electricity.generationWh` ...... power generation
   *   - `outlook.electricity.totalDemandWh` ..... power draw
   *   - `outlook.electricity.dronesOnShift` ..... drones on shift (read `.length`)
   *   - `outlook.electricity.cutLine` ........... the brownout cut line, or null
   *   - `outlook.habitatCapacity` ............... habitat capacity
   *   - `outlook.vented` ........................ energy vented rather than silently lost
   * Do NOT derive the turn number or turns-remaining by adding one to `colony.turnsTaken`:
   * `resolveTurn` already advanced the clock and evaluated the mission for this turn, and
   * a second, hand-rolled copy of that arithmetic in a component is precisely the game
   * logic FR-002 forbids there. The total (278) comes from `time.totalTurns(mission.turnCycle)`,
   * a pure read a component is free to make.
   *
   * `null` exactly when the mission has concluded, which is also the signal that
   * `end-cycle` is refused — the spec's "End Cycle at turn 278 must show the mission
   * verdict, not turn 279". One field, one guard, so the two cannot disagree.
   */
  readonly outlook: CycleReport | null
  /**
   * One outcome per order in the most recent `issue-orders` batch, in the same order,
   * carrying `orders.ts`'s own typed rejections verbatim (FR-006 again). Reset when a
   * turn resolves: an outcome describes the orders issued for the turn just ended, and
   * showing it against the next turn would be a stale rejection.
   */
  readonly orderOutcomes: readonly OrderOutcome[]
}

/** The whole application state, as a discriminated union on `phase`. See the header. */
export type GameState = SurveyingState | RunningState

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/**
 * Place the next unplaced hull at `anchor` (drone hull first, then reactor hull).
 *
 * One action for both hulls rather than two, because the player performs one gesture —
 * clicking a candidate site — and which hull it fills is a consequence of what is already
 * down, not a separate decision the UI should have to track.
 */
export interface SelectSiteAction {
  readonly kind: 'select-site'
  readonly anchor: Coord
}

/** Turn the scored landing into a running colony. Refused unless the landing is ready. */
export interface BeginMissionAction {
  readonly kind: 'begin-mission'
}

/** Apply a batch of typed player orders to the colony, via `orders.applyOrders`. */
export interface IssueOrdersAction {
  readonly kind: 'issue-orders'
  readonly orders: readonly PlayerOrder[]
}

/**
 * Resolve exactly one turn.
 *
 * `afterTurnsTaken` is REQUIRED, and it is the whole double-fire guard: the action names
 * the turn it means to end, and dispatch refuses it unless that is the turn the colony is
 * actually on. See {@link dispatch} for why this is a required field and not an optional
 * convenience.
 */
export interface EndCycleAction {
  readonly kind: 'end-cycle'
  /** The colony's `turnsTaken` at the moment the player asked to end the cycle. */
  readonly afterTurnsTaken: number
}

/** Every intent the UI can dispatch. Extend this union as new player actions are added. */
export type GameAction =
  | SelectSiteAction
  | BeginMissionAction
  | IssueOrdersAction
  | EndCycleAction

// ---------------------------------------------------------------------------
// Opening a session
// ---------------------------------------------------------------------------

export interface BeginSurveyParams {
  /** An already-decided seed. See `src/app/seed.ts` — randomness stops there. */
  readonly seed: number
  /** Square map edge in tiles. Defaults to {@link MAP_DIMENSION}. */
  readonly dimension?: number
  /** Defaults to {@link DEFAULT_MISSION}. */
  readonly mission?: MissionConfig
  /** Passed straight to the world generator. */
  readonly depositOptions?: DepositOptions
}

/**
 * Survey a world from a seed and open the landing decision — the app's entry point.
 *
 * GENERATES THE WORLD EXACTLY ONCE per session. A caller must hold the returned state
 * (React: lazy `useState`) and never call this again for the same seed: regenerating
 * would re-roll the map underneath a player mid-decision, and AC-1.3 requires one seed to
 * render one terrain across reloads.
 *
 * Deliberately does NOT use `colony-start.startMission`, even though that function does
 * survey-score-start in one call. `startMission` is for a caller that has only a seed; a
 * survey SCREEN must render the terrain before the player can choose a site, so it
 * already holds a world — and `colony-start.ts`'s own header says such a caller should
 * use `evaluateLandingOn` and `buildColony` directly, on the path that cannot generate a
 * world at all. That is what {@link dispatch} does.
 *
 * @throws {RangeError} if `dimension` or `mission` is malformed — propagated unchanged
 *   from `world.ts`/`time.ts`. A bad map size or mission config is a programmer or config
 *   error, never player input, so it fails loudly here rather than becoming a state a
 *   screen would try to render.
 */
export function beginSurvey(params: BeginSurveyParams): SurveyingState {
  const dimension = params.dimension ?? MAP_DIMENSION
  const world = generateWorld(dimension, dimension, params.seed, params.depositOptions)
  const selection: LandingSelection = { droneHullAnchor: null, reactorHullAnchor: null }

  return {
    phase: 'surveying',
    seed: params.seed,
    mission: params.mission ?? DEFAULT_MISSION,
    world,
    selection,
    // Even the opening "nothing placed yet" verdict comes from the sim, so the screen
    // reads `missingHulls` from the same field in every phase of the decision.
    readiness: evaluateLandingOn(world, selection),
    rejection: null,
  }
}

/**
 * Which hulls the player has committed, in a fixed order (drone hull, then reactor hull).
 *
 * Exists so a component never has to count anything itself: the survey screen's
 * hulls-placed readout is `placedHulls(selection).length`, not arithmetic over two
 * nullable fields. This is bookkeeping about the PLAYER'S OWN INPUT, which is the one
 * thing this module legitimately owns — it is not a game rule, and it asks the sim
 * nothing.
 */
export function placedHulls(selection: LandingSelection): readonly HullId[] {
  const placed: HullId[] = []
  if (selection.droneHullAnchor !== null) placed.push(DRONE_HULL_ID)
  if (selection.reactorHullAnchor !== null) placed.push(REACTOR_HULL_ID)
  return placed
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

/**
 * Fill the next empty hull slot, or `null` when both are already placed.
 *
 * Drone hull first. That order is not arbitrary: `buildColony` lands the drone hull first
 * too, so if a caller ever manages to overlap the two, the rejection names the reactor
 * hull as the one that could not be placed in both layers rather than disagreeing.
 */
function withNextHull(selection: LandingSelection, anchor: Coord): LandingSelection | null {
  if (selection.droneHullAnchor === null) return { ...selection, droneHullAnchor: anchor }
  if (selection.reactorHullAnchor === null) return { ...selection, reactorHullAnchor: anchor }
  return null
}

/**
 * Commit a hull anchor, or record why it was refused.
 *
 * A REFUSED SELECTION IS NOT COMMITTED. That is the shape spec 005's AC-2.3 requires:
 * clicking one tile twice must show `overlapping-hulls` AND still report one hull placed
 * — so the rejection is recorded while `selection` and `readiness` stay exactly as they
 * were. It also means `readiness` is always the verdict on the committed selection, never
 * on an attempt that was thrown away.
 *
 * NOTE, for the survey screen: `evaluateLanding` only validates a site once BOTH anchors
 * are down (a single anchor can only ever be `incomplete`), so the first click is always
 * accepted and an illegal FIRST anchor surfaces on the second click, reported against
 * `drone-hull`. That is the sim's contract, carried verbatim rather than papered over
 * with a validation this module is not allowed to invent. In practice a generated world
 * has no unbuildable 2x2 anchor at all — buildability is `1 - normalised slope` and the
 * measured minimum is ~0.67 — so the reachable refusals are `overlapping-hulls` and
 * `out-of-bounds`.
 */
function selectSite(state: SurveyingState, anchor: Coord): SurveyingState {
  const selection = withNextHull(state.selection, anchor)
  // Both hulls are down: there is no slot to fill, so this is a no-op. Returning the
  // identical object lets a caller skip a re-render on referential equality.
  if (selection === null) return state

  const readiness = evaluateLandingOn(state.world, selection)
  if (readiness.status === 'rejected') {
    return { ...state, rejection: readiness.rejection }
  }
  return { ...state, selection, readiness, rejection: null }
}

/** Whether the mission has reached a verdict, per the sim's own `MissionOutcome`. */
function hasConcluded(report: CycleReport): boolean {
  return report.mission.status !== 'in-progress'
}

/**
 * Turn a ready landing into a running colony.
 *
 * Refused (as a no-op) unless the landing is `ready`. The survey screen also disables its
 * begin control until then (AC-2.4), so this is the belt to that braces: an intent that
 * arrives anyway — a stale click, a keyboard shortcut, a test — cannot start a colony on
 * an illegal or half-chosen site.
 */
function beginMission(state: SurveyingState): GameState {
  if (state.readiness.status !== 'ready') return state

  const landing = state.readiness
  const colony = buildColony({ world: state.world, landing, mission: state.mission })

  return {
    phase: 'running',
    seed: state.seed,
    // BY REFERENCE. The surveyed world, not a regenerated one — see the module header.
    world: state.world,
    landing,
    colony,
    lastReport: null,
    outlook: resolveTurn(colony).report,
    orderOutcomes: [],
  }
}

/**
 * Apply a batch of player orders to the colony, then refresh the outlook.
 *
 * Routed entirely through `orders.applyOrders` — this module reimplements no part of
 * order validation, and `applyOrders` is generic over the colony's shape so a real
 * `ColonyState` goes in and a real `ColonyState` comes back with every field it did not
 * touch carried through.
 *
 * ORDERS TAKE EFFECT IN THE TURN NOW IN PROGRESS, never the next one — `orders.ts` is
 * emphatic that this is step 1 of the turn, because the alternative is a silent one-turn
 * desync between what the player asked for and what the game did. Applying them to the
 * colony immediately, and re-forecasting `outlook` from the result, is what makes that
 * true here: the queued build is already sitting in `colony.queue`, occupying its tiles,
 * before `end-cycle` ever calls `resolveTurn`.
 *
 * @throws {RangeError} if an order's instance id duplicates one already queued —
 *   `orders.ts`'s deliberate programmer-error convention (ids are minted by the calling
 *   layer, so a collision is a defect in the id generator, not player input). Left to
 *   propagate rather than softened into a typed rejection the UI would render as ordinary
 *   gameplay.
 */
function issueOrders(state: RunningState, orders: readonly PlayerOrder[]): RunningState {
  // `applyOrders` treats an empty batch as a true no-op; mirroring that here keeps the
  // whole state referentially unchanged rather than just its colony.
  if (orders.length === 0) return state
  // Once the mission has a verdict the colony is FROZEN — the same guard, and the same
  // reasoning, as `advanceCycle`'s deadline check. Accepting a build order after the
  // deadline would let a finished mission be quietly edited after the fact, and would
  // leave the state with orders applied but no turn in progress to apply them to.
  if (state.outlook === null) return state

  const applied = applyOrders(state.colony, orders)
  return {
    ...state,
    colony: applied.state,
    orderOutcomes: applied.outcomes,
    // Re-forecast, so the player sees this order's effect on the turn IN PROGRESS.
    outlook: resolveTurn(applied.state).report,
  }
}

/**
 * Resolve exactly one turn — and refuse anything that would resolve two.
 *
 * TWO GUARDS, and they refuse different things:
 *
 *  1. THE STALE-TOKEN GUARD. `afterTurnsTaken` must equal the colony's current
 *     `turnsTaken`. Re-dispatching one action object — a duplicated event handler, a
 *     stale closure firing twice, React StrictMode double-invoking a reducer, two clicks
 *     landing in one batch before a re-render — is therefore idempotent: the second
 *     application names a turn already taken and is refused. This is why the field is
 *     required rather than optional: an optional guard is one a caller can forget, and
 *     the cost of forgetting is a turn silently spent from a 278-turn budget. It is also
 *     why the guard is deterministic and lives HERE rather than being a debounce timer in
 *     a component: ★AC-4.3 forbids this seam from introducing time.
 *
 *  2. THE DEADLINE GUARD. Once the mission has a verdict, `outlook` is null and no
 *     further turn is resolved — spec 005's "End Cycle at turn 278 must show the mission
 *     verdict, not turn 279".
 *
 * NOTE FOR THE OPS SCREEN: guard 1 collapses a REPEATED intent, which is not the same
 * thing as collapsing two genuinely separate clicks a re-render apart. A `dblclick` whose
 * two `click` events straddle a React commit produces two DIFFERENT intents, each naming
 * the turn it saw — and two turns is the correct reading of two independent clicks. If
 * the button must swallow the second half of a double-click, that belongs to the button.
 */
function advanceCycle(state: RunningState, afterTurnsTaken: number): RunningState {
  if (state.outlook === null) return state
  if (afterTurnsTaken !== state.colony.turnsTaken) return state

  const resolved = resolveTurn(state.colony)
  return {
    ...state,
    colony: resolved.state,
    lastReport: resolved.report,
    outlook: hasConcluded(resolved.report) ? null : resolveTurn(resolved.state).report,
    // The turn they were issued for is over. See `RunningState.orderOutcomes`.
    orderOutcomes: [],
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Apply one intent to the game state, returning the next state — the single entry point
 * for every player action (FR-004).
 *
 * PURE. Same state and action in, same state out, with no reference to a clock, a random
 * source or the DOM. React holds the result (`setGame((current) => dispatch(current,
 * action))`); this function knows nothing about React.
 *
 * AN INAPPLICABLE INTENT IS A NO-OP THAT RETURNS THE IDENTICAL STATE OBJECT. One rule,
 * applied uniformly: End Cycle while surveying, a selection once the mission is running, a
 * third hull on top of two, an unrecognised action kind from untyped JavaScript. Nothing
 * throws and nothing half-applies, so a stale control, a replayed event or a keyboard
 * shortcut fired at the wrong moment cannot corrupt state or crash a screen — and
 * returning the same object means React can skip the re-render on identity.
 *
 * @throws {RangeError} only where the sim itself does, for a genuine programmer error —
 *   see {@link issueOrders} on duplicate instance ids. Every ORDINARY refusal (an illegal
 *   site, an occupied anchor, a cancelled build that no longer exists, an intent that does
 *   not apply) is typed data on the returned state, never an exception.
 */
export function dispatch(state: GameState, action: GameAction): GameState {
  switch (action.kind) {
    case 'select-site':
      return state.phase === 'surveying' ? selectSite(state, action.anchor) : state
    case 'begin-mission':
      return state.phase === 'surveying' ? beginMission(state) : state
    case 'issue-orders':
      return state.phase === 'running' ? issueOrders(state, action.orders) : state
    case 'end-cycle':
      return state.phase === 'running' ? advanceCycle(state, action.afterTurnsTaken) : state
    default:
      // Unreachable through `GameAction`, reachable from untyped JavaScript at runtime.
      // Kept rather than cast away so an unknown intent is inert instead of undefined
      // behaviour — the same reason `construction.ts` keeps its documented unreachable
      // guard.
      return state
  }
}
