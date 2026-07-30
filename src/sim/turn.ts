/**
 * Deterministic turn resolution — the authoritative `state -> state` step function
 * (aic-a00.6), and the bridge that makes the other modules a game rather than ten
 * islands (aic-8eq).
 *
 * WHY THIS MODULE EXISTS. Before it, every top-level operation in the sim had ZERO
 * production callers: `resolveElectricity`, `advanceConstruction`, `applyLedger`,
 * `evaluateMission` and `totalHabitatCapacity` were each exercised only by their own
 * unit tests. Coverage was ~100% and the colony could not run a single turn. That is
 * not a coverage failure, it is a structural one — a unit test on either side of a
 * missing seam passes, which is precisely how the project got here (see
 * docs/turn-composition-audit.md, and aic-c1p for the first instance of the pattern).
 *
 * This module owns exactly one thing: THE ORDER. It contains no rules of its own — no
 * arithmetic that belongs to power, construction, the ledger or the mission — so it
 * cannot drift away from the modules it composes. Every step delegates.
 *
 * =====================================================================
 * THE ORDER, AND WHY IT IS THIS ORDER
 * =====================================================================
 * Two of these decisions are invisible, and would otherwise be settled by whatever
 * sequence someone happened to type. Both are asserted by test.
 *
 * 1. THERE IS A DEPENDENCY CYCLE, AND EXACTLY ONE ORDERING BREAKS IT.
 *
 *      power budget <- which structures are operational <- accumulated labour
 *           |                                                      ^
 *           +--> drone charging --> drones on shift --> labour -----+
 *
 *    Power needs completion; completion needs labour; labour needs power. This is
 *    acyclic IF AND ONLY IF power reads a START-OF-TURN completion snapshot. So the
 *    operational set is computed ONCE, at the top of the turn, from start-of-turn
 *    accumulated labour, and every later step reads that frozen set. If construction
 *    were resolved first, a structure completed during this turn would immediately
 *    draw power and produce output in the same turn — a free turn of production on its
 *    completion turn — and the whole turn's outcome would depend on statement order
 *    inside one function.
 *
 * 2. PRODUCTION AND CAPACITY ARE JUDGED AT DIFFERENT MOMENTS, DELIBERATELY.
 *    Step 4 (the ledger) reads the START-of-turn operational set. Step 6 (the mission
 *    verdict) reads END-of-turn completion. That looks like an inconsistency and is
 *    not; the alternatives are both worse:
 *      - A habitat finished on turn 278 MUST count toward the win. Construction
 *        completed before the deadline, and the deadline is when the next wave departs
 *        Earth. Freezing capacity too would lose the mission on a technicality.
 *      - That same habitat must produce NOTHING on turn 278. It never actually
 *        operated for any part of that turn.
 *    So: capacity is about whether the thing EXISTS by the deadline; production is
 *    about whether it RAN during the turn. Different questions, different moments.
 *
 * PLAYER ORDERS ARE APPLIED BEFORE THIS FUNCTION, not inside it. `queueConstruction`
 * and `cancelProject` are the caller's to invoke, and an order issued for turn N must
 * be applied to the state BEFORE `resolveTurn(N)` — applying it afterwards silently
 * delays it by a turn from what the player saw. This module deliberately does not take
 * an orders parameter: there is no order type yet, and inventing one here would couple
 * turn resolution to a UI concern that has not been designed.
 *
 * STORAGE CAPACITY IS AGGREGATED HERE (aic-7f5), and this is the only place it could be.
 * `catalog.ts` declares a cap per structure TYPE, but the colony's actual capacity is a
 * sum over the structures that exist and are IN SERVICE — which only turn resolution
 * knows. An unfinished or offline silo grants nothing, and that falls out of reusing the
 * same frozen operational set rather than being a separate rule.
 *
 * OUT OF SCOPE, tracked elsewhere, and named so nobody assumes otherwise:
 *   - `buildCost` debiting. A bill of materials is charged ONCE when construction is
 *     committed, which is the caller's `queueConstruction` step, never per-turn here.
 *   - Input starvation (a processor short of feedstock). Binary idle on POWER is
 *     enforced here; binary idle on INPUTS belongs to the production module the
 *     resource-chain epics add. A powered processor with no feedstock will currently
 *     record a ledger `Shortfall` and still produce, which is why the golden scenario
 *     seeds a starting stockpile rather than baking that gap into a regression lock.
 *
 * Determinism: a pure function of its argument's value. No `Math.random`, `Date.now`,
 * `new Date`, no I/O, and no Map/Set iteration order reaches any output — `Set` is used
 * only for membership. Every accumulating quantity is an integer, and no step divides.
 * The same state resolved N times yields identical output, and the input state is never
 * mutated. `tests/integration/turn-golden.test.ts` locks a multi-turn trace.
 */

import { createGrid } from './grid'
import type { Grid } from './grid'
import {
  advanceConstruction,
  isProjectComplete,
  toHabitatStructure,
  toResourceFlow,
} from './construction'
import type { ConstructionProject, ConstructionQueue } from './construction'
import type { DroneId } from './drones'
import { applyLedger } from './ledger'
import type { Overflow, ResourceBalance, Shortfall, Stockpile, Vented } from './ledger'
import { evaluateMission, totalHabitatCapacity } from './mission'
import type { MissionConfig, MissionOutcome } from './mission'
import {
  ELECTRICITY,
  electricityDrawWh,
  electricityLedgerPolicy,
  resolveElectricity,
} from './power'
import type { ElectricityResult, GridParticipant } from './power'
import { CALM_ENVIRONMENT, INITIAL_POWER_SOURCE_STATE, advancePowerSourceState, currentOutputWh } from './generation'
import type { GenerationEnvironment, PowerSourceState } from './generation'

/** Default grid size when a caller does not supply one: the 64x64 (320 m) ratified map. */
const DEFAULT_GRID_DIMENSION = 64

/**
 * The complete, canonical colony state — the single record every module's view is
 * DERIVED from (audit E9).
 *
 * Before this type existed, five modules each took a bespoke slice of the same
 * structure instances (`PowerReactor[]`, `PowerConsumerStructure[]`,
 * `ConstructionQueue`, `HabitatStructure[]`, `ResourceFlow[]`) and a caller would have
 * had to maintain them as parallel arrays kept in sync by hand, with nothing checking
 * that they agreed. Here there is ONE list of structure instances — `queue` — and every
 * module's view is produced from it by a total function.
 *
 * `queue` is named for its construction-ordering role but holds EVERY structure
 * instance, complete or not. A finished reactor stays in it: it is still a structure
 * that occupies tiles, generates power and could be taken offline. Nothing is ever
 * promoted out of the queue into a second collection, because two collections is the
 * bug this type exists to prevent.
 */
export interface ColonyState {
  /** Deadline and incoming wave size. `mission.turnCycle` is the single turn-cycle source. */
  readonly mission: MissionConfig
  /** Turns elapsed. Matches `time.ts`'s `turnsTaken` convention: a fresh colony is 0. */
  readonly turnsTaken: number
  readonly grid: Grid
  /** Every structure instance, complete or not. See the note above. */
  readonly queue: ConstructionQueue
  /** Every drone the colony owns. Order is not significant — priority is ascending id. */
  readonly droneRoster: readonly DroneId[]
  readonly stockpiles: Stockpile
  /**
   * Structures taken out of service — destroyed, damaged, or shut down for maintenance
   * — as distinct from not yet built. An offline structure neither generates nor draws.
   * Kept as a list of ids on the colony rather than a flag on the project because
   * being in service is a fact about the world, not about the build order, and because
   * `ConstructionProject` is `construction.ts`'s type and should not grow a field only
   * the power path reads.
   */
  readonly offlineStructureIds: readonly string[]
  /**
   * Per-instance generation history, keyed by structure instance id (aic-a00.18) — see
   * `generation.ts`'s module header for why this lives here rather than as a field on
   * `ConstructionProject`: it is the SAME reasoning as `offlineStructureIds` just
   * above, applied to a second world-level fact only the power path reads. A structure
   * with no entry (never yet operated, or never a generator at all) is treated as
   * `INITIAL_POWER_SOURCE_STATE` — see step 2 below — so this map only ever needs a
   * key for an instance that has operated at least once.
   */
  readonly powerSourceState: Readonly<Record<string, PowerSourceState>>
  /**
   * Colony-wide conditions capable of modulating generation this turn (aic-a00.18) —
   * see `generation.ts`'s `GenerationEnvironment`. Carried on state, not derived,
   * because a dust-storm SCHEDULE is out of scope here (docs/turn-composition-audit.md
   * E5's dust-storm PRNG stream does not exist yet); this field is the plumbing a
   * future scheduler bead sets before calling `resolveTurn`, defaulting to
   * `CALM_ENVIRONMENT` until one does.
   */
  readonly environment: GenerationEnvironment
}

/** The documented sub-step order, exported as data so it can be asserted, not just read. */
export const TURN_STEPS = [
  'freeze-operational-set',
  'resolve-electricity',
  'advance-construction',
  'apply-ledger',
  'advance-clock',
  'evaluate-mission',
] as const

export type TurnStepName = (typeof TURN_STEPS)[number]

/**
 * Everything that happened in one turn, in a form a player-facing cycle report or a
 * golden trace can consume without re-deriving anything.
 *
 * This is the "explainable" half of the accepted design's promise that brownouts are
 * "deterministic and explainable, never whatever the iteration order happened to be".
 * The whole turn's power outcome is explained by `electricity.cutLine` — one integer:
 * everything above it ran, everything at or below it did not.
 */
export interface CycleReport {
  /** Turns taken AFTER this turn resolved, i.e. the turn number just completed. */
  readonly turn: number
  /** The order actually executed. Echoed so a test can pin it against `TURN_STEPS`. */
  readonly steps: readonly TurnStepName[]
  /** The full grid outcome: generation, demand, who was shed, the cut line. */
  readonly electricity: ElectricityResult
  /** Labour-hours that reached a project this turn. Always a whole number of build-turns. */
  readonly labourHoursApplied: number
  /** Labour-hours no queued project could absorb. Lost — see `advanceConstruction`. */
  readonly labourHoursUnused: number
  /** Ids that crossed from incomplete to complete during THIS turn's construction step. */
  readonly completedThisTurn: readonly string[]
  /** Per-resource production/consumption/net for the turn, sorted by resource. */
  readonly balances: readonly ResourceBalance[]
  /** Resources that ran out. Should be empty for electricity — the brownout prevents it. */
  readonly shortfalls: readonly Shortfall[]
  /** Flow resources produced but not containable, and therefore gone (e.g. vented energy). */
  readonly vented: readonly Vented[]
  /**
   * Stock resources produced beyond the colony's aggregate storage capacity, and
   * therefore gone. Empty until a structure declares a `storageCapacity` — see the
   * capacity aggregation in `resolveTurn` and `LedgerPolicy.storageCapacity`.
   */
  readonly overflow: readonly Overflow[]
  /** Completed habitat capacity at END of turn — see ordering note 2. */
  readonly habitatCapacity: number
  /** The mission verdict, evaluated at the new turn count. */
  readonly mission: MissionOutcome
}

/** The result of one turn: the new state, and what happened. */
export interface TurnResolution {
  readonly state: ColonyState
  readonly report: CycleReport
}

/** Optional starting contents for {@link createColony}. */
export interface CreateColonyOptions {
  readonly grid?: Grid
  readonly queue?: ConstructionQueue
  readonly droneRoster?: readonly DroneId[]
  readonly stockpiles?: Stockpile
  readonly offlineStructureIds?: readonly string[]
  /** Starting generation history, keyed by instance id. Defaults to `{}` — nobody has operated yet. */
  readonly powerSourceState?: Readonly<Record<string, PowerSourceState>>
  /** Starting colony-wide conditions. Defaults to `CALM_ENVIRONMENT`. */
  readonly environment?: GenerationEnvironment
}

/**
 * Validates ids as non-empty and pairwise-unique.
 *
 * Uses a `Set` only for MEMBERSHIP, never enumerated, so no iteration order can reach
 * an output. Mirrors the identical idiom in `power.ts` and `brownout.ts` — one
 * uniqueness pattern across the sim, learned once.
 */
function assertUniqueNonEmptyIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (id.length === 0) throw new RangeError(`A ${label} id must not be an empty string`)
    if (seen.has(id)) throw new RangeError(`Duplicate ${label} id: "${id}"`)
    seen.add(id)
  }
}

/**
 * Build a starting colony.
 *
 * Validates the roster and queue HERE rather than leaving it to the first turn, so a
 * malformed colony fails at construction with a message naming the roster or the
 * queue. Left to `resolveElectricity`, the same defect would surface mid-turn as a
 * "duplicate grid consumer" error with no hint that the roster was the problem.
 *
 * @throws {RangeError} if any drone or project id is empty or duplicated.
 */
export function createColony(
  mission: MissionConfig,
  options: CreateColonyOptions = {},
): ColonyState {
  const queue = options.queue ?? []
  const droneRoster = options.droneRoster ?? []

  assertUniqueNonEmptyIds(droneRoster, 'drone')
  assertUniqueNonEmptyIds(
    queue.map((project) => project.id),
    'construction project',
  )

  return {
    mission,
    turnsTaken: 0,
    grid: options.grid ?? createGrid(DEFAULT_GRID_DIMENSION, DEFAULT_GRID_DIMENSION),
    queue,
    droneRoster,
    stockpiles: options.stockpiles ?? {},
    offlineStructureIds: options.offlineStructureIds ?? [],
    powerSourceState: options.powerSourceState ?? {},
    environment: options.environment ?? CALM_ENVIRONMENT,
  }
}

/**
 * Whether a completed structure is drawing its STANDBY load rather than its rated load.
 *
 * For the MVP this is exactly "is it a habitat", because the colony is UNMANNED for the
 * entire mission (ratified) — so every habitat is in standby every turn, drawing the
 * ~20% crew-independent load the General ruled on rather than full rated life support.
 *
 * Expressed as one predicate in one place so that when the colonist wave lands this
 * becomes a condition on occupancy rather than a hunt through the turn loop. Structures
 * with no `standbyConsumes` entry are unaffected either way: `electricityDrawWh` returns
 * 0 for an absent key, and for a non-habitat this predicate is false regardless.
 */
function isInStandby(project: ConstructionProject): boolean {
  return project.structureType.habitatCapacity > 0
}

/**
 * Resolve exactly one turn.
 *
 * Returns a NEW state; the input is never mutated. See the module header for the step
 * order and for the two ordering decisions that are deliberate rather than incidental.
 *
 * @throws {RangeError} if `state.mission.turnCycle` or `turnsTaken` fails `time.ts`'s
 *   validation, or if the roster or queue contains an empty or duplicated id
 *   (delegated to the modules that own those rules, never re-implemented here).
 */
export function resolveTurn(state: ColonyState): TurnResolution {
  const config = state.mission.turnCycle

  // ---------------------------------------------------------------------
  // STEP 1 — freeze the operational set (see ordering note 1)
  // ---------------------------------------------------------------------
  // Membership only; never enumerated for order.
  const offline = new Set(state.offlineStructureIds)
  const operatingIds = new Set<string>()
  for (const project of state.queue) {
    if (isProjectComplete(config, project) && !offline.has(project.id)) {
      operatingIds.add(project.id)
    }
  }

  // ---------------------------------------------------------------------
  // STEP 2 — resolve the electricity grid against that frozen set
  // ---------------------------------------------------------------------
  // `producesWh` is NOT a flat catalog read (aic-a00.18, fixed): `currentOutputWh`
  // resolves each participant's OWN registered output curve against its history AS OF
  // THE START of this turn (before step 2b advances it) and this turn's environment.
  // A constant reactor's curve ignores both and returns its rated figure unchanged,
  // which is what keeps this behaviour-preserving for every existing catalog entry.
  const participants: GridParticipant[] = state.queue.map((project) => ({
    id: project.id,
    producesWh: currentOutputWh(
      project.structureType,
      state.powerSourceState[project.id] ?? INITIAL_POWER_SOURCE_STATE,
      state.environment,
    ),
    consumesWh: electricityDrawWh(project.structureType, isInStandby(project)),
    priority: project.structureType.priorityClass,
    operating: operatingIds.has(project.id),
  }))

  // ---------------------------------------------------------------------
  // STEP 2b — advance each operating instance's generation history for NEXT turn
  // ---------------------------------------------------------------------
  // Computed from THIS turn's `operatingIds` (step 1), so a structure completed this
  // very turn is not yet advanced — it had no history to advance, having just been
  // read as `INITIAL_POWER_SOURCE_STATE` above. A structure not operating (still under
  // construction, or offline) carries its existing history forward unchanged; see
  // `generation.ts`'s `PowerSourceState` doc for why downtime does not accrue soiling
  // in this model.
  //
  // Kept SPARSE deliberately — a project that has never yet operated gets no key at
  // all, not an explicit `{ turnsOperated: 0 }` — matching `ColonyState.powerSourceState`'s
  // own doc ("only ever needs a key for an instance that has operated at least once")
  // and `offlineStructureIds`'s existing convention of listing only the exception, not
  // every structure's default state.
  const powerSourceState: Record<string, PowerSourceState> = {}
  for (const project of state.queue) {
    const previous = state.powerSourceState[project.id]
    if (operatingIds.has(project.id)) {
      powerSourceState[project.id] = advancePowerSourceState(previous ?? INITIAL_POWER_SOURCE_STATE)
    } else if (previous !== undefined) {
      powerSourceState[project.id] = previous
    }
  }

  const electricity = resolveElectricity({
    config,
    participants,
    droneRoster: state.droneRoster,
  })

  // ---------------------------------------------------------------------
  // STEP 3 — spend this turn's labour on the build queue
  // ---------------------------------------------------------------------
  const advanced = advanceConstruction(config, state.queue, electricity.labourCapacityHours)

  // Which projects crossed the completion line DURING this step. Computed by diffing
  // against step 1's frozen set rather than re-deriving, so it cannot disagree with the
  // set the rest of the turn used.
  const completedThisTurn = advanced.queue
    .filter((project) => !operatingIds.has(project.id) && isProjectComplete(config, project))
    .map((project) => project.id)

  // ---------------------------------------------------------------------
  // STEP 4 — account for the turn's resource flows
  // ---------------------------------------------------------------------
  // Flows come from structures that were BOTH operational at the start of the turn AND
  // powered. That conjunction is what makes binary idle real: a shed consumer's flow
  // never reaches the ledger at all, so it consumes none of its inputs rather than
  // draining a stockpile to whatever was left (spec 002 FR-004, spec 003 FR-006). Note
  // this reads `state.queue`, NOT `advanced.queue` — production is judged on
  // start-of-turn completion (ordering note 2).
  const poweredIds = new Set(electricity.poweredStructureIds)
  const flows = state.queue
    .filter((project) => poweredIds.has(project.id))
    // `toResourceFlow` rather than passing `project.structureType` directly. The two are
    // equivalent here — `poweredIds` only ever contains structures step 1 already found
    // complete — but this is `construction.ts`'s own adapter for exactly this seam, and
    // it independently returns an empty flow for an incomplete project. Reaching past it
    // to the raw structure type would put a SECOND notion of "what does this project
    // contribute to the ledger" in the codebase, which is how the two drift. Defence in
    // depth on the rule that matters most: an unfinished structure produces nothing.
    .map((project) => toResourceFlow(config, project))

  // Drone recharge is a real electricity draw with no structure behind it, so it enters
  // the ledger as its own flow. This is the ACTUAL energy taken, not the turn capacity
  // reserved — see `power.ts`'s turn-capacity block for why the two differ.
  const ledgerFlows =
    electricity.droneEnergyWh > 0
      ? [...flows, { produces: {}, consumes: { [ELECTRICITY]: electricity.droneEnergyWh } }]
      : flows

  // STORAGE CAPACITY (aic-7f5). Aggregated across every OPERATING structure, for every
  // resource. This is the step that could only ever live here: `catalog.ts` declares a
  // cap per structure TYPE, but the colony's actual capacity is a sum over the
  // structures that exist and are in service — and turn resolution is the only place
  // that knows which those are.
  //
  // Under-construction and offline structures grant nothing: an unfinished silo holds
  // no regolith. That falls out of reusing step 1's frozen operational set rather than
  // being a separate rule.
  //
  // NOTE the live precondition on electricity specifically: `power.ts`'s whole-turn
  // drone reservation assumes work-phase generation is unbankable. If a structure ever
  // grants electricity capacity, that assumption breaks and the reservation
  // over-charges the drone. See the precondition block in `power.ts`. The capacity is
  // summed here regardless, so the ledger half is already correct.
  const grantedStorage: Record<string, number> = {}
  for (const project of state.queue) {
    if (!operatingIds.has(project.id)) continue
    for (const [resource, amount] of Object.entries(project.structureType.storageCapacity)) {
      grantedStorage[resource] = (grantedStorage[resource] ?? 0) + amount
    }
  }

  // Electricity is a FLOW, not a stock (the General's "no storing energy without
  // barriers"), and `power.ts` owns that declaration so `ledger.ts` never branches on a
  // resource name. Every other resource is a stock, capped only where a capacity is
  // declared — see `LedgerPolicy.storageCapacity` for why the two defaults differ.
  const ledger = applyLedger(ledgerFlows, state.stockpiles, electricityLedgerPolicy(grantedStorage))

  // ---------------------------------------------------------------------
  // STEP 5 — advance the clock
  // ---------------------------------------------------------------------
  const turnsTaken = state.turnsTaken + 1

  // ---------------------------------------------------------------------
  // STEP 6 — evaluate the mission against END-of-turn completion
  // ---------------------------------------------------------------------
  // Reads `advanced.queue` (ordering note 2): a habitat finished during THIS turn
  // counts toward the verdict, even though step 4 correctly gave it no production.
  const habitats = advanced.queue.map((project) => toHabitatStructure(config, project))
  const mission = evaluateMission(state.mission, turnsTaken, habitats)

  return {
    state: {
      mission: state.mission,
      turnsTaken,
      // Unchanged this turn: nothing in turn resolution places or demolishes anything.
      // Carried on the state because placement and demolition are colony operations
      // that happen between turns, and the grid is what they operate on.
      grid: state.grid,
      queue: advanced.queue,
      droneRoster: state.droneRoster,
      stockpiles: ledger.stockpiles,
      offlineStructureIds: state.offlineStructureIds,
      powerSourceState,
      // Unchanged this turn: no dust-storm scheduler exists yet to move it (see the
      // field's own doc on `ColonyState`). Carried forward so a future scheduler's
      // write persists across turns exactly like every other piece of colony state.
      environment: state.environment,
    },
    report: {
      turn: turnsTaken,
      steps: TURN_STEPS,
      electricity,
      labourHoursApplied: advanced.labourHoursApplied,
      labourHoursUnused: advanced.labourHoursUnused,
      completedThisTurn,
      balances: ledger.balances,
      shortfalls: ledger.shortfalls,
      vented: ledger.vented,
      overflow: ledger.overflow,
      habitatCapacity: totalHabitatCapacity(habitats),
      mission,
    },
  }
}
