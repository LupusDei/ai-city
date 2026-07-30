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
 *   - the dust-storm timeline, and each turn's `dustStorm` flag, come from
 *     `weather.generateStormTimeline`/`weather.advanceWeather` (aic-oby.3) — see
 *     `beginMission` and `advanceCycle` below
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
import { createCatalog } from '../../sim/catalog'
import type { StructureCatalog, StructureTypeSpec } from '../../sim/catalog'
import { chainOneStructureSpecs } from '../../sim/catalog-data'
import { coreStructureSpecs } from '../../sim/catalog-data-core'
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
import { deserializeColony, serializeColony } from '../../sim/persist'
import type { SaveLoadFailure } from '../../sim/persist'
import { DEFAULT_TURN_CYCLE, totalTurns } from '../../sim/time'
import { resolveTurn } from '../../sim/turn'
import type { ColonyState, CycleReport } from '../../sim/turn'
import { advanceWeather, generateStormTimeline } from '../../sim/weather'
import type { StormEvent } from '../../sim/weather'
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
 * Colonists arriving on wave 2 — the mission's win threshold.
 *
 * RATIFIED BY THE GENERAL 2026-07-30: **100 colonists**, arriving with roughly two Earth
 * years of food (enough to reach wave 3), plus oxygen, water, equipment, drones, reactors
 * and batteries.
 *
 * That last clause is the important half and it reframes the whole mission. The wave is
 * not only a demand, it is a RESUPPLY: it brings its own consumables and its own power and
 * labour. So the colony is not being asked to feed 100 people or to generate the 400 kW
 * their rated life support will eventually draw (10 reactors' worth — far beyond the three
 * that survived). It is being asked to have somewhere survivable for them to arrive INTO.
 * You are building a beachhead, not a self-sufficient city.
 *
 * WHAT 100 COSTS, at figures already ratified elsewhere in this codebase:
 *   - 13 habitat modules at 8 colonists each = 52 tiles of habitat.
 *   - 80 kW just to hold those 13 empty on STANDBY (20% of the 4 kW/colonist rated draw).
 *     That is two of your three reactors, spent on buildings nobody lives in yet, before
 *     a single drone recharges. THIS is the death spiral the design was built around,
 *     now with a number attached: over-build habitats early and the standby draw eats the
 *     power budget that was buying you labour.
 *   - 5,850 t of regolith to shield them (98 Hopper-turns) and 143 t of sintered crust
 *     (119 Press-turns) — against a 278-turn budget, with one Press costing 75% of a
 *     reactor to run. Chain 1 stops being optional.
 *
 * Superseded 6, which was an unratified placeholder authored by the adapter when no figure
 * existed anywhere in the repo. 6 made the win condition trivial: a single habitat cleared
 * it. 100 makes it the mission.
 *
 * `beginSurvey` takes a `mission` override, so no test depends on this default.
 */
export const INCOMING_WAVE_SIZE = 400

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
   * The mission's dust-storm timeline (aic-oby.3), generated ONCE at `begin-mission`
   * from `seed` — the same "generate the schedule once" discipline `world` follows for
   * terrain — and never regenerated. Each entry's `startTurn`/`endTurn` is directly
   * observable, so a screen can announce an upcoming or ongoing storm without asking
   * the sim anything further; `colony.environment.dustStorm` is this turn's already-
   * REALIZED status, read off this same timeline by `advanceWeather` before every
   * `resolveTurn` call below.
   */
  readonly weatherTimeline: readonly StormEvent[]
  /**
   * Every structure a player can QUEUE, validated once at `begin-mission` — the build
   * tray's whole data source (aic-oby.7). See {@link buildableStructureSpecs} for what
   * is combined into it and why nothing here is hardcoded per structure id: a screen
   * enumerates this catalog GENERICALLY (`catalog.listStructureTypes`), so a chain that
   * adds a fourth structure needs no change anywhere under `src/app/`.
   *
   * Built from `mission.turnCycle`, exactly as `colony-start.ts`'s private hull catalog
   * is — a structure's watt-hour figures are a function of how long a turn is, so a
   * scenario running a non-default cycle must validate against ITS OWN cycle, not
   * `DEFAULT_TURN_CYCLE`. Generated once, here, and carried unchanged for the rest of
   * the mission: the world and the weather timeline are already "decide once, carry
   * through" for the identical reason (see the module header), and a catalog rebuilt
   * per render would be wasted, deterministic-but-pointless work.
   *
   * Deliberately NOT the two landed hulls (`colony-start.ts` keeps those in ITS OWN
   * private catalog): a hull is not a buildable structure, and putting it in this
   * catalog would offer "Drone Hold (landed)" in the build tray as though a player
   * could queue a second one.
   */
  readonly catalog: StructureCatalog
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

/**
 * Discard both hull anchors and survey the SAME world again.
 *
 * Added after the survey screen reported (correctly) that the opening decision was
 * one-shot and irreversible: `selectSite` fills the drone hull then the reactor hull, and
 * once both are committed the only remaining transition is `begin-mission`. A player who
 * places two hulls, reads a score of 48.1 and wants to try a different pair had exactly
 * one escape: reload.
 *
 * And reload was worse than nothing. `resolveSeed` only writes a seed into the URL when
 * the PLAYER supplied one, so a player who arrived at `/` and surveyed a generated world
 * would get a DIFFERENT world on reload. The escape hatch silently destroyed the thing
 * being decided about — reload was a reroll, not a retry.
 *
 * CRITICAL: this resets `selection`, `readiness` and `rejection` to their opening values
 * and keeps `world` BY REFERENCE. Regenerating the world here — even from the same seed —
 * would be the aic-c1p defect reproduced inside the adapter: deep-equal, visually
 * identical, and quietly not the world the player was looking at. A test pins the identity.
 */
export interface ClearSelectionAction {
  readonly kind: 'clear-selection'
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
  | ClearSelectionAction
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
// The build tray's catalog (aic-oby.7)
// ---------------------------------------------------------------------------

/**
 * Every buildable structure spec, from every authored chain — the ONE place they are
 * concatenated before validation.
 *
 * A screen never imports `catalog-data.ts` or `catalog-data-core.ts` directly (nor
 * could it and stay inside `tests/unit/app-boundary.test.ts`'s reads — this composition
 * is a decision about WHICH content ships, which belongs at the adapter alongside every
 * other "assemble the sim's inputs" call this module already makes). Adding a fourth
 * chain is a one-line addition here, never a change to `OpsScreen.tsx` or
 * `build-view.ts`: both read the resulting `StructureCatalog` generically via
 * `catalog.listStructureTypes`, never by a hardcoded id list.
 */
function buildableStructureSpecs(mission: MissionConfig): readonly StructureTypeSpec[] {
  return [...coreStructureSpecs(mission.turnCycle), ...chainOneStructureSpecs(mission.turnCycle)]
}

/** Validate {@link buildableStructureSpecs} into the build tray's `StructureCatalog`. */
function buildableCatalog(mission: MissionConfig): StructureCatalog {
  return createCatalog(buildableStructureSpecs(mission))
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
  const built = buildColony({ world: state.world, landing, mission: state.mission })

  // Generated ONCE, from the session seed (aic-oby.3's "storms derive from the mission
  // seed") and the mission's own total-turn count — never re-rolled, for the same
  // reason the world above is generated exactly once at survey time.
  const weatherTimeline = generateStormTimeline(state.seed, totalTurns(state.mission.turnCycle))
  // Sets `colony.environment` for turn 1 BEFORE it is ever handed to `resolveTurn` —
  // see `weather.ts`'s header on why this happens here, at the adapter, rather than
  // inside `resolveTurn` itself.
  const colony = advanceWeather(built, weatherTimeline)

  return {
    phase: 'running',
    seed: state.seed,
    // BY REFERENCE. The surveyed world, not a regenerated one — see the module header.
    world: state.world,
    landing,
    colony,
    weatherTimeline,
    catalog: buildableCatalog(state.mission),
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

  // `state.colony.environment` was already set for THIS turn — either by `beginMission`
  // (turn 1) or by the previous call's own `advanceWeather` below (every turn since) —
  // so the real resolve reads it as-is, exactly as `resolveTurn`'s own contract expects.
  const resolved = resolveTurn(state.colony)
  // Pre-set the NEXT turn's environment before it is stored or forecast — see
  // `weather.ts`'s header on why this happens here rather than inside `resolveTurn`.
  const nextColony = advanceWeather(resolved.state, state.weatherTimeline)
  return {
    ...state,
    colony: nextColony,
    lastReport: resolved.report,
    outlook: hasConcluded(resolved.report) ? null : resolveTurn(nextColony).report,
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
/**
 * Reset both hull anchors, keeping the SAME world object.
 *
 * `world` is passed through by reference, not regenerated. That is the whole point: a
 * re-roll from the same seed is deep-equal and visually identical, so nothing on screen
 * would reveal that the player is now surveying a different world than the one they were
 * comparing scores on. `readiness` is recomputed from the sim rather than cached from
 * `beginSurvey`, so the opening "nothing placed yet" verdict still comes from
 * `evaluateLandingOn` in every phase of the decision.
 */
function clearSelection(state: SurveyingState): SurveyingState {
  const selection: LandingSelection = { droneHullAnchor: null, reactorHullAnchor: null }
  return {
    ...state,
    selection,
    readiness: evaluateLandingOn(state.world, selection),
    rejection: null,
  }
}

export function dispatch(state: GameState, action: GameAction): GameState {
  switch (action.kind) {
    case 'select-site':
      return state.phase === 'surveying' ? selectSite(state, action.anchor) : state
    case 'clear-selection':
      return state.phase === 'surveying' ? clearSelection(state) : state
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

// ---------------------------------------------------------------------------
// Save and resume a mission (aic-oby.2)
// ---------------------------------------------------------------------------
//
// THIS IS THE THIN HALF. `src/sim/persist.ts` owns every acceptance criterion for
// this bead that actually matters for correctness — byte-identical round trip,
// resuming and continuing matches an uninterrupted run exactly, malformed/truncated/
// wrong-version saves are rejected with a clear message, never a crash. That rigor is
// spent entirely on `ColonyState`, because that is the one part of a mission with
// turn-to-turn state a bad round trip could silently corrupt (a dropped
// `powerSourceState`, a coerced float, a resurrected duplicate id).
//
// `world` and `landing` are NOT put through that same machinery, and that is a
// deliberate scope decision, not an oversight: `colony-start.ts` documents `world` as
// the STATIC substrate (terrain, buildability, deposits) and `landing` as a one-time
// SCORED RECORD of the opening choice — neither one accumulates anything turn over
// turn, so there is no "resume and continue" property for either of them to get
// wrong. They are carried through as plain data with a light existence check, which
// is what keeps this half "thin": duplicating `persist.ts`'s full field-by-field
// validation here for values that cannot desync a running mission would be effort
// spent on the wrong risk.

/** The mission-save envelope's own version, independent of `persist.ts`'s. */
const MISSION_SAVE_FORMAT_VERSION = 1

/**
 * The on-disk shape of a saved mission.
 *
 * `colonyData` is the colony's OWN save string (`persist.ts`'s `serializeColony`
 * output), embedded rather than inlined as a nested object. Two things fall out of
 * that: the colony half of a mission save can be lifted out verbatim and handed to
 * `deserializeColony` on its own (a bug report, a debug tool), and the colony format
 * can gain its own version bump without forcing every mission save ever written to be
 * rewritten — the two formats evolve independently on purpose.
 */
interface MissionSaveFile {
  readonly formatVersion: typeof MISSION_SAVE_FORMAT_VERSION
  readonly seed: number
  readonly world: World
  readonly landing: ReadyLanding
  readonly colonyData: string
}

export interface SaveMissionSuccess {
  readonly ok: true
  /** Opaque to the caller — pass it to {@link loadMission} unmodified. */
  readonly data: string
}

/** There is nothing to save while still surveying: no colony exists yet to resume. */
export interface SaveMissionFailure {
  readonly ok: false
  readonly reason: 'not-running'
}

export type SaveMissionResult = SaveMissionSuccess | SaveMissionFailure

/**
 * Serialise the running mission to a string a player can store and load later.
 *
 * Refused (never thrown) unless a mission is actually RUNNING — there is no world,
 * landing or colony to save from a still-in-progress survey.
 */
export function saveMission(state: GameState): SaveMissionResult {
  if (state.phase !== 'running') return { ok: false, reason: 'not-running' }
  const save: MissionSaveFile = {
    formatVersion: MISSION_SAVE_FORMAT_VERSION,
    seed: state.seed,
    world: state.world,
    landing: state.landing,
    colonyData: serializeColony(state.colony),
  }
  return { ok: true, data: JSON.stringify(save) }
}

export type LoadMissionResult =
  | { readonly ok: true; readonly state: RunningState }
  | { readonly ok: false; readonly error: SaveLoadFailure }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A generic, always-safe rejection for the light checks in this half of the file. */
function malformedMission(message: string): LoadMissionResult {
  return { ok: false, error: { ok: false, kind: 'malformed', message } }
}

/**
 * A light existence check, NOT a validation walk — see the section header for why
 * `world` and `landing` do not get `persist.ts`'s full rigor. This exists only so a
 * hand-edited or unrelated JSON blob fails here, with a clear message, rather than
 * reaching a render path with a field silently missing.
 */
function looksLikeWorld(value: unknown): value is World {
  return (
    isPlainObject(value) &&
    'terrain' in value &&
    'buildability' in value &&
    'deposits' in value &&
    'grid' in value
  )
}

/** See {@link looksLikeWorld}. */
function looksLikeReadyLanding(value: unknown): value is ReadyLanding {
  return (
    isPlainObject(value) &&
    value.status === 'ready' &&
    'score' in value &&
    'breakdown' in value &&
    'droneHullTiles' in value &&
    'reactorHullTiles' in value
  )
}

/**
 * Parse and validate a mission save produced by {@link saveMission}, or reject it with
 * a typed, player-readable reason — NEVER throws, matching `persist.ts`'s own
 * contract, which this function delegates the colony half of validation to entirely.
 *
 * Deliberately does not resume `lastReport`: a mission save has no record of what a
 * turn already resolved did (only the state that resulted), so a freshly loaded
 * mission reports `lastReport: null`, the same value a mission that has not yet taken
 * its first turn reports. That is an honest "we don't know", not a claim that nothing
 * happened — `outlook`, by contrast, is always recomputed fresh from the loaded
 * colony, because it is a pure forecast `resolveTurn` can reproduce from state alone.
 *
 * @throws Never. Every rejection is a `LoadMissionResult` with `ok: false`.
 */
export function loadMission(raw: string): LoadMissionResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return malformedMission('This save file is not readable and cannot be loaded.')
  }
  if (!isPlainObject(parsed)) {
    return malformedMission('This save file is not readable and cannot be loaded.')
  }

  const formatVersion = parsed.formatVersion
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    return malformedMission('This save file has no valid version number and cannot be loaded.')
  }
  if (formatVersion !== MISSION_SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: {
        ok: false,
        kind: 'version-mismatch',
        message:
          `This save was made with mission format ${formatVersion}, but this version of ` +
          `the game reads format ${MISSION_SAVE_FORMAT_VERSION}. It cannot be loaded here.`,
      },
    }
  }

  const seed = parsed.seed
  if (typeof seed !== 'number' || !Number.isInteger(seed)) {
    return malformedMission('This save file has no valid seed and cannot be loaded.')
  }
  if (!looksLikeWorld(parsed.world)) {
    return malformedMission('This save file has no valid surveyed world and cannot be loaded.')
  }
  if (!looksLikeReadyLanding(parsed.landing)) {
    return malformedMission('This save file has no valid landing record and cannot be loaded.')
  }
  if (typeof parsed.colonyData !== 'string') {
    return malformedMission('This save file has no valid colony data and cannot be loaded.')
  }

  const colonyResult = deserializeColony(parsed.colonyData)
  if (!colonyResult.ok) return { ok: false, error: colonyResult }
  const colony = colonyResult.colony

  // Mirror `advanceCycle`'s own guard: a concluded mission's `outlook` is `null`
  // forever, and `resolveTurn` must never be called again past that point (see its
  // doc — the verdict is meant to stay fixed once the deadline turn is reached).
  const concluded = colony.turnsTaken >= totalTurns(colony.mission.turnCycle)

  return {
    ok: true,
    state: {
      phase: 'running',
      seed,
      world: parsed.world,
      landing: parsed.landing,
      colony,
      // REGENERATED, not saved. The storm timeline is a pure function of the mission
      // seed and the mission length, so recomputing it on load is guaranteed to
      // reproduce the exact schedule the mission was already running under — the same
      // determinism guarantee the whole sim rests on. Persisting it would add a second
      // copy of derivable data that could drift from the generator, and a save written
      // before a weather-tuning change would then resume under stale weather.
      //
      // This gap was found by a typecheck failure when save/load and the storm
      // scheduler were merged (each was built without the other). It was not merely a
      // missing field: a loaded mission would have carried an EMPTY timeline, so the
      // weather would simply never come again for the rest of that save — a silent,
      // permanent loss of the game's only environmental pressure.
      weatherTimeline: generateStormTimeline(seed, totalTurns(colony.mission.turnCycle)),
      // REBUILT, not saved — the same reasoning as `weatherTimeline` just above: the
      // build tray's catalog is a pure function of the mission's own turn cycle, so
      // recomputing it here is guaranteed to reproduce exactly what the mission was
      // already running under, with no second copy of derivable data to drift.
      catalog: buildableCatalog(colony.mission),
      lastReport: null,
      outlook: concluded ? null : resolveTurn(colony).report,
      orderOutcomes: [],
    },
  }
}
