/**
 * Power generation, distribution & brownout.
 *
 * Reactors generate electricity; structures and drone charging both draw it.
 * When total desired draw exceeds what the reactors can generate this turn, a
 * BROWNOUT occurs and something has to be curtailed. This module is the single
 * place that decides what.
 *
 * =====================================================================
 * THE BROWNOUT PRIORITY ORDER (the core tension — read this before touching
 * anything below)
 * =====================================================================
 *
 * Rule, in two levels, both deterministic and neither depending on Map/Set
 * iteration order:
 *
 *   1. STRUCTURES ARE POWERED BEFORE DRONE CHARGING GETS ANY BUDGET.
 *      Structure draw is the colony's "critical load" — life support,
 *      manufacturing, resource extraction — the stuff that keeps the colony
 *      alive turn over turn. Drone charging is the colony's "flexible load":
 *      exactly like real-world grid demand-response programs that curtail EV
 *      charging before hospitals or refrigeration, a drone that misses a
 *      charging window simply works fewer shifts later — nobody dies, the
 *      build rate merely slows. So whenever generation cannot cover both in
 *      full, structures eat first; the charging budget (`availableChargingPowerKw`)
 *      is whatever reactor capacity is left over, and it is reported as a
 *      power BUDGET, not a guaranteed draw — `drones.ts`'s `computeDroneShift`
 *      is the module that turns a budget into an actual number of drones on
 *      shift.
 *
 *   2. WITHIN STRUCTURES, PRIORITY IS THE CALLER'S ARRAY ORDER — never id sort
 *      order, never Map/Set iteration. This mirrors `computeDroneShift`'s own
 *      documented rule exactly (see `drones.ts`): the earliest positions in
 *      the `structures` array keep power first; the latest positions are shed
 *      first when generation falls short. `allocateStructurePower` uses a
 *      "first-fit-continue" walk: a structure that does not fit in whatever
 *      generation remains is shed, but the walk keeps going — a cheaper,
 *      lower-priority structure later in the array can still claim whatever
 *      capacity remains. This is a deliberate generalisation of
 *      `computeDroneShift`'s floor-division shortcut: when every draw is
 *      identical (as every drone's charging draw is), first-fit-continue
 *      degenerates to exactly "power the first N, shed the rest" — once one
 *      entry doesn't fit, no later entry of the same size fits either, so the
 *      "continue" never actually recovers anything. Structures, unlike
 *      drones, draw HETEROGENEOUS amounts of power, so a naive
 *      floor-division shortcut is not available here; first-fit-continue is
 *      the natural generalisation that never leaves reactor capacity idle
 *      just because a bigger, higher-priority structure ahead of it couldn't
 *      be afforded.
 *
 * Reported consequence: "unpowered" structures (see `PowerBudgetResult`) are
 * never removed or destroyed — they simply produce nothing this turn (a
 * future turn-resolution step is expected to zero out their `ledger.ts`
 * production flows for exactly the ids in `unpoweredStructureIds`; this
 * module does not itself touch the ledger).
 *
 * =====================================================================
 * Integration contract with `drones.ts`
 * =====================================================================
 * `DRONE_RECHARGE_DRAW_KW` is imported, never re-derived or hardcoded, so this
 * module's notion of "how much power one drone's recharge costs" can never
 * silently drift from `drones.ts`'s. It is used ONLY to size
 * `totalDroneChargeDemandKw` (how much the roster would like, for `brownout`
 * reporting) — the actual number of drones that get to charge is decided
 * exclusively by `computeDroneShift`, fed `availableChargingPowerKw` from this
 * module's output. This module deliberately does not import or call
 * `computeDroneShift` itself, so the two modules stay decoupled: this one
 * produces a power budget, `drones.ts` decides what a roster does with it.
 * See `tests/integration/power-drones.test.ts` for the wired-together proof.
 */

import { DRONE_RECHARGE_DRAW_KW } from './drones'

/**
 * Electrical output of one completed, online reactor unit, in kWe.
 *
 * NASA's Fission Surface Power (FSP) project — a joint NASA/Department of
 * Energy technology demonstration for lunar and Mars surface nuclear power —
 * targets a baseline unit output of 40 kWe, continuous and unattended, for
 * multi-year surface operation. This is the project's chosen reality-grounded
 * baseline for one reactor unit; do not replace with a differently-sourced
 * figure without updating this citation.
 */
export const REACTOR_OUTPUT_KW = 40

/**
 * A reactor instance as this module needs to see it.
 *
 * `online` is deliberately distinct from "completed": a fully-built reactor
 * can still be taken offline (destroyed, damaged, shut down for maintenance)
 * without ceasing to exist as a structure. Named `online` rather than
 * `powered` specifically to avoid confusion with the CONSUMER-side vocabulary
 * used below (`poweredStructureIds`) — a reactor is never itself "powered",
 * it is the thing supplying power.
 */
export interface PowerReactor {
  readonly id: string
  /** Turns of drone labour applied toward `buildTurns` so far. */
  readonly turnsCompleted: number
  /** Turns of drone labour required before this reactor can generate. */
  readonly buildTurns: number
  /** Whether the reactor is currently in service (false: offline/destroyed/damaged). */
  readonly online: boolean
}

/** A structure instance as this module needs to see it, for power-draw purposes only. */
export interface PowerConsumerStructure {
  readonly id: string
  /** Turns of drone labour applied toward `buildTurns` so far. */
  readonly turnsCompleted: number
  /** Turns of drone labour required before this structure is operational. */
  readonly buildTurns: number
  /** Continuous electrical draw once operational, in kW. */
  readonly drawKw: number
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number, received: ${value}`)
  }
}

/**
 * Validates a set of ids as non-empty and pairwise-unique.
 *
 * Uses a `Set` only to test MEMBERSHIP (has one of these ids been seen
 * before?), never to enumerate or derive output order from — so this stays
 * fully compatible with the project's ban on Map/Set iteration order leaking
 * into any observable result. Mirrors `drones.ts`'s `assertValidRoster`.
 *
 * @throws {RangeError} on an empty-string id or a duplicate id.
 */
function assertUniqueNonEmptyIds(ids: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (id.length === 0) {
      throw new RangeError(`A ${label} id must not be an empty string`)
    }
    if (seen.has(id)) {
      throw new RangeError(`Duplicate ${label} id: "${id}"`)
    }
    seen.add(id)
  }
}

/**
 * Whether a single reactor is currently contributing generation: fully built
 * AND online. See the module doc for why "online" is tracked separately from
 * "completed".
 *
 * @throws {RangeError} if `turnsCompleted` or `buildTurns` is not a
 *   non-negative integer.
 */
export function isReactorGenerating(reactor: PowerReactor): boolean {
  assertNonNegativeInteger(reactor.turnsCompleted, 'reactor.turnsCompleted')
  assertNonNegativeInteger(reactor.buildTurns, 'reactor.buildTurns')
  return reactor.online && reactor.turnsCompleted >= reactor.buildTurns
}

/**
 * Total electricity generation this turn, in kW: `REACTOR_OUTPUT_KW` summed
 * over only the reactors `isReactorGenerating` accepts.
 *
 * Returns `0` for an empty reactor list — not `NaN`, not a crash — matching
 * the same "empty collection is an ordinary starting state" convention used
 * throughout this codebase (see `ledger.ts`'s `computeBalances`,
 * `mission.ts`'s `totalHabitatCapacity`).
 *
 * @throws {RangeError} if any reactor fails `isReactorGenerating`'s validation.
 */
export function totalGenerationKw(reactors: readonly PowerReactor[]): number {
  let total = 0
  for (const reactor of reactors) {
    if (isReactorGenerating(reactor)) total += REACTOR_OUTPUT_KW
  }
  return total
}

/**
 * Whether a structure's construction has finished, i.e. whether it has any
 * operational systems (and therefore any power draw) at all this turn.
 *
 * `turnsCompleted >= buildTurns` (not `===`), mirroring `mission.ts`'s
 * `isStructureComplete` exactly, for the same reason: a structure that
 * accrued more labour than strictly required must still read as complete.
 *
 * @throws {RangeError} if `turnsCompleted` or `buildTurns` is not a
 *   non-negative integer.
 */
export function isStructureOperational(
  structure: Pick<PowerConsumerStructure, 'turnsCompleted' | 'buildTurns'>,
): boolean {
  assertNonNegativeInteger(structure.turnsCompleted, 'structure.turnsCompleted')
  assertNonNegativeInteger(structure.buildTurns, 'structure.buildTurns')
  return structure.turnsCompleted >= structure.buildTurns
}

/** Result of resolving one turn's structures against available generation. */
export interface StructureAllocationResult {
  /** Ids of operational structures that received power this turn, in priority (array) order. */
  readonly poweredStructureIds: readonly string[]
  /** Ids of operational structures denied power this turn (brownout victims), in priority order. */
  readonly unpoweredStructureIds: readonly string[]
  /** Sum of `drawKw` actually delivered to powered structures. */
  readonly structureSupplyKw: number
  /** Generation left over after structures, in kW — never negative. */
  readonly remainingKw: number
  /** Sum of `drawKw` across every OPERATIONAL structure, powered or not. */
  readonly totalStructureDemandKw: number
}

/**
 * Resolve `structures` against `generationKw` of available power, applying
 * the WITHIN-STRUCTURES half of the brownout priority order documented at the
 * top of this file: array position is priority, first-fit-continue.
 *
 * Structures still under construction (`!isStructureOperational`) are
 * excluded entirely from both `poweredStructureIds` and
 * `unpoweredStructureIds` — they are not yet a brownout victim or a
 * beneficiary, they simply have no operational systems yet to power.
 *
 * @throws {RangeError} if `generationKw` is not finite and non-negative; if
 *   any structure's `drawKw` is not finite and non-negative, its
 *   `turnsCompleted`/`buildTurns` is not a non-negative integer, or if
 *   `structures` contains an empty-string or duplicate id.
 */
export function allocateStructurePower(
  structures: readonly PowerConsumerStructure[],
  generationKw: number,
): StructureAllocationResult {
  assertFiniteNonNegative(generationKw, 'generationKw')
  assertUniqueNonEmptyIds(
    structures.map((structure) => structure.id),
    'structure',
  )

  for (const structure of structures) {
    assertFiniteNonNegative(structure.drawKw, `structure "${structure.id}".drawKw`)
  }

  const poweredStructureIds: string[] = []
  const unpoweredStructureIds: string[] = []
  let remainingKw = generationKw
  let structureSupplyKw = 0
  let totalStructureDemandKw = 0

  for (const structure of structures) {
    if (!isStructureOperational(structure)) continue // not yet built: no draw, no verdict

    totalStructureDemandKw += structure.drawKw

    // First-fit-continue: see the module doc's "WITHIN STRUCTURES" rule for why
    // this does not stop at the first structure that doesn't fit.
    if (structure.drawKw <= remainingKw) {
      poweredStructureIds.push(structure.id)
      remainingKw -= structure.drawKw
      structureSupplyKw += structure.drawKw
    } else {
      unpoweredStructureIds.push(structure.id)
    }
  }

  return {
    poweredStructureIds,
    unpoweredStructureIds,
    structureSupplyKw,
    remainingKw,
    totalStructureDemandKw,
  }
}

/** Result of resolving one turn's full power budget: generation, structures, and drone charging. */
export interface PowerBudgetResult {
  /** Total generation this turn, from only completed, online reactors. */
  readonly totalGenerationKw: number
  /** Sum of `drawKw` across every operational structure, powered or not. */
  readonly totalStructureDemandKw: number
  /** What the FULL drone roster would draw if every drone could charge this turn. */
  readonly totalDroneChargeDemandKw: number
  /**
   * True iff desired total draw (structures + full drone charging demand)
   * exceeds generation — the single test for "did a brownout happen".
   */
  readonly brownout: boolean
  /** Ids of operational structures powered this turn, in priority order. */
  readonly poweredStructureIds: readonly string[]
  /** Ids of operational structures denied power this turn, in priority order. */
  readonly unpoweredStructureIds: readonly string[]
  /** Generation actually delivered to structures this turn. */
  readonly structureSupplyKw: number
  /**
   * Generation left over after structures — the power BUDGET earmarked for
   * drone charging. Feed this directly into `drones.ts`'s `computeDroneShift`
   * as its `availableChargingPowerKw` argument (see `tests/integration/power-drones.test.ts`).
   */
  readonly availableChargingPowerKw: number
}

/**
 * Resolve one turn's full power budget: generation from `reactors`, draw from
 * `structures`, and the leftover power BUDGET earmarked for drone charging
 * given a roster of `droneRosterSize` drones.
 *
 * This function does not itself decide how many drones charge — that is
 * `computeDroneShift`'s job in `drones.ts`, fed this function's
 * `availableChargingPowerKw`. `droneRosterSize` here is used only to size
 * `totalDroneChargeDemandKw` for the `brownout` verdict; see the module doc's
 * "Integration contract" section.
 *
 * Deterministic: a pure function of its three arguments' VALUES. Never reads
 * Map/Set iteration order, `Math.random`, `Date.now`, or `new Date` — the
 * same `(reactors, structures, droneRosterSize)` always resolves to a
 * deep-equal result, on any run (see `tests/unit/power.test.ts`'s explicit
 * run-twice-and-compare regression test).
 *
 * @throws {RangeError} if `droneRosterSize` is not a non-negative integer; if
 *   `reactors` contains an empty-string or duplicate id; or if any reactor or
 *   structure fails its own field validation (delegated to
 *   `totalGenerationKw`/`allocateStructurePower`, not re-implemented here).
 */
export function computePowerBudget(
  reactors: readonly PowerReactor[],
  structures: readonly PowerConsumerStructure[],
  droneRosterSize: number,
): PowerBudgetResult {
  assertNonNegativeInteger(droneRosterSize, 'droneRosterSize')
  assertUniqueNonEmptyIds(
    reactors.map((reactor) => reactor.id),
    'reactor',
  )

  // BROWNOUT PRIORITY, LEVEL 1: structures are resolved against the FULL
  // generation figure before drone charging sees any of it — see the module
  // doc's "STRUCTURES ARE POWERED BEFORE DRONE CHARGING" rule.
  const generationKw = totalGenerationKw(reactors)
  const allocation = allocateStructurePower(structures, generationKw)

  const totalDroneChargeDemandKw = droneRosterSize * DRONE_RECHARGE_DRAW_KW
  const totalDemandKw = allocation.totalStructureDemandKw + totalDroneChargeDemandKw

  return {
    totalGenerationKw: generationKw,
    totalStructureDemandKw: allocation.totalStructureDemandKw,
    totalDroneChargeDemandKw,
    brownout: totalDemandKw > generationKw,
    poweredStructureIds: allocation.poweredStructureIds,
    unpoweredStructureIds: allocation.unpoweredStructureIds,
    structureSupplyKw: allocation.structureSupplyKw,
    availableChargingPowerKw: allocation.remainingKw,
  }
}
