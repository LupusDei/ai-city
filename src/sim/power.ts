/**
 * The electricity grid: generation, demand, and who keeps their power.
 *
 * This module is the SINGLE authority on electricity (aic-96o). Before it, two
 * closed beads both owned the resource — `ledger.ts` treated it as a stockpiling
 * quantity in ledger units, this module treated it as an instantaneous float-kW rate
 * with its own `drawKw` field unlinked from `catalog.ts`'s `consumes.electricity` —
 * and neither imported the other. Populating one home left the other blind;
 * populating both charged the colony twice; nothing detected either. See
 * docs/turn-composition-audit.md B1 for the full four-way conflict.
 *
 * The resolution, in three parts:
 *   1. ONE HOME FOR THE NUMBER. A structure's electricity draw is
 *      `consumes.electricity` in the catalog, validated as an integer watt-hour
 *      amount at the one validation boundary. `drawKw` is gone. `electricityDrawWh`
 *      is the only reader.
 *   2. ONE UNIT. Integer watt-hours throughout, per the General's ruling. No floats,
 *      no kW, and no division in any per-turn path.
 *   3. ELECTRICITY IS A FLOW, NOT A STOCK. Per the General's ruling "no storing
 *      energy without barriers", surplus generation is spent or lost within the turn
 *      that produced it unless a storage structure grants containment.
 *      `electricityLedgerPolicy` is the one place that declares this, so `ledger.ts`
 *      stays resource-agnostic and never branches on a resource name.
 *
 * Allocation is delegated to `brownout.ts`, which owns the total order. This module's
 * own former allocator (`allocateStructurePower`, first-fit-continue over the
 * caller's array order) is gone: it was non-monotone — raising generation could
 * switch a running consumer OFF — and it made priority a property of caller
 * bookkeeping rather than of the colony. See `brownout.ts`'s header.
 *
 * =====================================================================
 * THE TURN-CAPACITY MODEL — READ THIS BEFORE CHANGING ANY NUMBER HERE
 * =====================================================================
 * A turn has two phases: 25 h of drone work (90,000 s) and one Mars sol of recharge
 * (88,775 s). Structures draw continuously across both. Drones draw ONLY during the
 * recharge phase. The grid's binding moment is therefore the recharge phase, when
 * drone charging stacks on top of structure draw.
 *
 * That distinction is worth a FACTOR OF TWO on the game's central constraint, and
 * getting it wrong is silent. Naively comparing each consumer's energy per turn
 * against generation per turn gives:
 *
 *     3 reactors (5,959,167 Wh/turn) / drone energy (136,659 Wh) = 43.6 drones
 *
 * The ratified figure is 21.7. The naive model DOUBLES the drone ceiling and destroys
 * the co-binding of power and labour that the entire mechanic rests on.
 *
 * The correct model is a CAPACITY RESERVATION over the whole turn. A charging drone
 * ties up ~5,543 W of reactor capacity, and — this is the crux — it ties it up for the
 * WHOLE TURN even though it draws for only the recharge half, because the no-storage
 * ruling means work-phase generation CANNOT be banked to charge it later. Capacity
 * idle during the work phase is simply lost. So:
 *
 *     drone reservation = drone energy * (turn / sol) = 275,204 Wh of turn capacity
 *     3 reactors / 275,204                  = 21.65 -> 21 drones   (ratified 21.7) ✓
 *     ...minus one 25 kW habitat            = 17.14 -> 17 drones   (ratified 17.1) ✓
 *
 * Both ratified figures reproduced exactly. `tests/unit/power.test.ts` asserts them,
 * so a change that breaks the ratified balance fails loudly rather than quietly.
 *
 * NOTE, and it is the interesting part: the no-storage ruling is what DETERMINES this
 * number. If energy could be banked across phases, work-phase surplus would charge
 * drones and the ceiling really would be ~43. A ruling about storage silently set the
 * game's core balance figure.
 *
 * ---------------------------------------------------------------------
 * PRECONDITION — THIS MODEL IS ONLY VALID WHILE NO STORAGE EXISTS
 * ---------------------------------------------------------------------
 * The whole-turn reservation assumes work-phase generation has nowhere to go. That is
 * true today and ONLY today, because nothing in the colony grants electricity storage
 * capacity. Do not inherit this model without inheriting its precondition.
 *
 * The moment any structure grants capacity via `storageCapacity.electricity`, the
 * assumption breaks: work-phase surplus becomes bankable, a charging drone no longer
 * ties up capacity it is not drawing, and this reservation OVER-CHARGES the drone —
 * under-reporting the fleet the colony can actually run.
 *
 * How much is at stake, because it is not a rounding detail: under no-storage a
 * three-reactor colony running its full 21-drone fleet throws away 3,089,328 Wh of a
 * 5,959,167 Wh turn. That splits into two parts, and only the first is what storage
 * would recover:
 *   - PHASE WASTE, 2,909,445 Wh — capacity reserved but never drawn, because a drone
 *     charges for only the recharge half of the turn. As a fraction of reserved
 *     capacity this is 50.34%, which is EXACTLY the duty cycle (90,000 s of work in a
 *     178,775 s turn) and necessarily so: drones work half the cycle and charge the
 *     other half, so half the reactor output has nothing to do.
 *   - UNALLOCATED, 179,883 Wh — the 0.65 of a drone that 21 whole drones leave over.
 *     Not recoverable by storage; that needs a 22nd drone.
 * Recovering the phase waste would raise the drone ceiling from 21 toward 43.
 *
 * So a battery is not a smoothing device. There is nothing to smooth: a turn spans
 * 2.014 sols, so solar already averages out within one turn and no diurnal buffering
 * is needed. A battery is the only route to cross-turn energy, and therefore the
 * single highest-leverage structure available — it could roughly double the fleet.
 * That is a consequence of the no-storage ruling, not of any balance choice.
 *
 * Storage is deliberately OUT OF SCOPE here and no battery exists. When one is added,
 * `resolveElectricity` must take the granted capacity as an input and reserve
 * `DRONE_GRID_ENERGY_WH` rather than `DRONE_TURN_CAPACITY_WH` for the portion of the
 * fleet that bankable surplus can cover. `electricityLedgerPolicy` already accepts a
 * capacity figure, so the ledger half is ready; this allocator is the half that is not.
 * `tests/unit/power.test.ts` asserts the precondition explicitly, so the model cannot
 * be silently carried past the point where it stops being true.
 *
 * CONSEQUENCE for `produces`/`consumes`: for a structure that draws continuously, its
 * turn-capacity reservation and its per-turn energy are THE SAME NUMBER, so
 * `consumes.electricity` serves both with no conversion anywhere. The drone is the
 * only consumer whose draw is confined to a sub-window, so it is the only place the
 * two figures differ — `DRONE_TURN_CAPACITY_WH` (reserved) versus
 * `DRONE_GRID_ENERGY_WH` (actually taken). Both are reported; the difference is
 * generation that existed during the work phase and had nowhere to go, which
 * `ledger.ts` reports as `Vented`.
 *
 * Determinism: pure functions of their arguments' values. No `Math.random`,
 * `Date.now`, `new Date`, and no Map/Set iteration order reaches any output — `Set` is
 * used only for membership tests. No division occurs in any per-turn path; the only
 * divisions in the module are inside `energyPerTurnWh` and the module-load derivation
 * of `DRONE_TURN_CAPACITY_WH`, each rounded once at its point of definition rather
 * than at call sites — the same discipline `drones.ts` documents for
 * `DRONE_GRID_ENERGY_WH`.
 */

import type { ResourceAmounts } from './catalog'
import type { LedgerPolicy, Stockpile } from './ledger'
import { PRIORITY_DRONE_RECHARGE, resolveBrownout } from './brownout'
import type { PowerDemand } from './brownout'
import { DRONE_GRID_ENERGY_WH } from './drones'
import type { DroneId } from './drones'
import { DRONE_WORK_SECONDS, MARS_SOL_SECONDS, labourCapacityHours, turnDurationSeconds } from './time'
import type { TurnCycleConfig } from './time'

/** Seconds per hour. Used only in the two documented authoring-time conversions. */
const SECONDS_PER_HOUR = 3600

/**
 * The canonical resource key for electricity.
 *
 * Exported so no other module ever spells the string. A second spelling anywhere
 * silently splits the resource into two that never net against each other — and
 * because the resource key space is deliberately open (`catalog.ts` validates that
 * keys are non-empty, not that they are known), a typo cannot be caught any other way.
 */
export const ELECTRICITY = 'electricity'

/**
 * Electrical output of one completed, online reactor unit, in WATTS.
 *
 * NASA's Fission Surface Power project — a joint NASA/Department of Energy technology
 * demonstration for lunar and Mars surface nuclear power — targets a baseline unit
 * output of 40 kWe, continuous and unattended, for multi-year surface operation. This
 * is the project's reality-grounded baseline; do not replace it with a
 * differently-sourced figure without updating this citation.
 *
 * An AUTHORING INPUT, not something the sim reads per turn. A catalog author converts
 * this figure once, with `energyPerTurnWh`, into `produces.electricity` — the RATED
 * (peak, nameplate) output this reactor type declares.
 *
 * That rated figure is no longer what `turn.ts` reads per turn, though: this module's
 * own `GridParticipant.producesWh` is filled in by `generation.ts`'s `currentOutputWh`,
 * which resolves the rated figure through a REGISTERED CURVE
 * (`StructureType.powerOutputModel`) before it ever reaches `resolveElectricity` here.
 * A `REACTOR_OUTPUT_WATTS` reactor gets the `constant` curve by default — output equal
 * to rated, forever, exactly the old `reactorCount * REACTOR_OUTPUT_KW` behaviour — but
 * the SAME seam also carries spec 003's solar arrays, whose output decays with soiling
 * and dust storms, and any future source kind, entirely as catalog data plus a
 * registered curve (aic-a00.18, closing audit E1). See `generation.ts`'s module header
 * for the full design; this module still owns the grid — generation, demand and the
 * brownout — and knows nothing about WHICH curve produced the number it was handed.
 */
export const REACTOR_OUTPUT_WATTS = 40_000

/**
 * Reactor capacity one charging drone reserves for a whole turn, in integer
 * watt-hours. See the turn-capacity block in the module header for the derivation and
 * for why this is deliberately NOT `DRONE_GRID_ENERGY_WH`.
 *
 * Derived rather than hardcoded, from `drones.ts`'s per-drone recharge energy and
 * `time.ts`'s two phase lengths, so it cannot drift from either. Rounded ONCE here at
 * the point of definition — the same choice `drones.ts` documents for
 * `DRONE_GRID_ENERGY_WH` — rather than at each call site, because an implicit rounding
 * scattered across callers is exactly the silent inexactness the integer discipline
 * exists to prevent.
 *
 * 136,659 Wh * (178,775 s / 88,775 s) = 275,204 Wh.
 */
export const DRONE_TURN_CAPACITY_WH = Math.round(
  (DRONE_GRID_ENERGY_WH * (DRONE_WORK_SECONDS + MARS_SOL_SECONDS)) / MARS_SOL_SECONDS,
)

/** @throws {RangeError} if `value` is not a non-negative integer. */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

/** @throws {RangeError} if `value` is not a finite, non-negative number. */
function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number, received: ${value}`)
  }
}

/**
 * Convert a continuous wattage into whole watt-hours over one turn.
 *
 * An AUTHORING-TIME helper: a catalog author calls this once to turn a
 * reality-grounded wattage (40,000 W for a reactor, 12,000 W for a Regolith Hopper)
 * into the integer watt-hour amount `createCatalog` accepts. It is deliberately NOT
 * called per turn — the point of putting the figure in the catalog is that the
 * conversion happens once, where it is reviewed.
 *
 * Rounds to the nearest whole watt-hour. Rounding here, once, is strictly better than
 * returning a float that `createCatalog`'s integer guard would reject three modules
 * away with no hint of where the fraction came from.
 *
 * @throws {RangeError} if `watts` is negative or non-finite, or if `config` fails
 *   `time.ts`'s own validation (delegated, not re-implemented).
 */
export function energyPerTurnWh(watts: number, config: TurnCycleConfig): number {
  assertFiniteNonNegative(watts, 'watts')
  return Math.round((watts * turnDurationSeconds(config)) / SECONDS_PER_HOUR)
}

/**
 * The electricity amount in a resource map, or `0` if it names none.
 *
 * The ONLY place `ELECTRICITY` is read out of a map. An absent key is `0` — "this
 * structure has no opinion on this resource" — matching `ledger.ts`'s convention for
 * an absent key exactly, so nothing downstream ever sees `undefined` or `NaN`.
 */
export function electricityWh(amounts: ResourceAmounts): number {
  return amounts[ELECTRICITY] ?? 0
}

/**
 * The minimal shape needed to read a structure's electricity draw. A validated
 * `StructureType` satisfies it structurally with no adapter — the same inversion
 * `ledger.ts` uses for `ResourceFlow`, and for the same reason: this module accounts
 * for draws, it does not care how the structure came to exist.
 */
export interface ElectricityDrawSource {
  readonly consumes: ResourceAmounts
  readonly standbyConsumes: ResourceAmounts
}

/**
 * A structure's electricity draw this turn, in integer watt-hours: its RATED draw
 * while productive, or its STANDBY draw while complete but not productive.
 *
 * RATIFIED BY THE GENERAL (aic-96o): an empty habitat draws neither nothing nor full
 * rated, but a reduced standby figure — ~20% of rated. "Draws nothing" would have made
 * over-building habitats free and weakened the death spiral the design rests on; full
 * rated would have been brutal. See `catalog.ts`'s `standbyConsumes` for the two
 * independent derivations of the 20% figure, and for the shielding-dependent extension
 * that is deliberately not modelled yet.
 *
 * `standby` is supplied by the caller because occupancy is a colony-level fact, not a
 * property of a structure type. For the whole MVP the colony is UNMANNED, so every
 * habitat is in standby every turn; when the wave lands that becomes one condition in
 * the turn loop rather than a change here.
 */
export function electricityDrawWh(source: ElectricityDrawSource, standby: boolean): number {
  return standby ? electricityWh(source.standbyConsumes) : electricityWh(source.consumes)
}

/**
 * The colony's `ledger.ts` accumulation policy: electricity is a FLOW, everything else
 * is a stock, capped by whatever storage the colony grants.
 *
 * RULED BY THE GENERAL: "No storing energy without barriers." Generation is spent or
 * lost within the turn that produced it, unless a storage structure grants containment.
 * This is the ONE place in the codebase that states electricity is a flow, which is what
 * lets `ledger.ts` remain resource-agnostic — it applies a declared policy and never
 * branches on a resource name.
 *
 * `storageCapacity` is the colony's aggregate capacity per resource, summed by turn
 * resolution across every OPERATING structure's `storageCapacity` (aic-7f5). It is
 * accepted as a whole map rather than an electricity-only figure so that the flow
 * declaration and the capacity table stay in one policy — building them separately would
 * put `flowResources: [ELECTRICITY]` in a second place, which is precisely the split this
 * function exists to prevent.
 *
 * An absent `electricity` entry means zero containment: the stockpile returns to zero
 * every turn, however many turns run, and the whole surplus is reported as `Vented`.
 *
 * Batteries do NOT smooth day/night: a turn spans 2.014 sols, so solar already averages
 * out within one turn and there is no diurnal smoothing to do. They are the only route to
 * cross-turn energy at all, which is precisely what makes them a strategic structure
 * rather than a redundant one — see the precondition block in this module's header for
 * just how much leverage that is.
 *
 * @throws {RangeError} if any capacity is not a non-negative integer. Validated here
 *   rather than trusted because this map is AGGREGATED by a caller (summed across
 *   structures) rather than read straight from the validated catalog, so it has not
 *   passed `createCatalog`'s guard as a unit.
 */
export function electricityLedgerPolicy(storageCapacity: Stockpile = {}): LedgerPolicy {
  for (const [resource, amount] of Object.entries(storageCapacity)) {
    assertNonNegativeInteger(amount, `storageCapacity.${resource}`)
  }
  return {
    flowResources: [ELECTRICITY],
    // Electricity defaults to ZERO containment rather than being absent: for a flow,
    // absent and 0 mean the same thing in `ledger.ts`, but stating it explicitly makes
    // the battery-less case visible in the policy a reader inspects.
    storageCapacity: { [ELECTRICITY]: storageCapacity[ELECTRICITY] ?? 0, ...storageCapacity },
  }
}

/**
 * One structure instance's participation in the grid this turn.
 *
 * Deliberately minimal and structural rather than a `StructureType` plus instance
 * state: this module needs three numbers and a flag, and taking only those keeps it
 * free of any dependency on `construction.ts` or `placement.ts` (only the catalog's
 * `ResourceAmounts` type is imported, for `electricityWh`). The turn-resolution layer,
 * which is allowed to know everything, builds these.
 *
 * Both energy figures are TURN-CAPACITY watt-hours — see the module header. For a
 * continuously-drawing structure that is identical to its per-turn energy, so a caller
 * passes `electricityDrawWh(type, standby)` straight through with no conversion on the
 * demand side. `producesWh` is the one figure this module does NOT compute for the
 * caller: `turn.ts` fills it in from `generation.ts`'s `currentOutputWh(type, state,
 * environment)`, which resolves the catalog's rated `produces.electricity` through a
 * registered curve — a constant reactor's curve happens to return that rated figure
 * unchanged, which is why this field's SHAPE (a bare integer) never had to change for
 * `generation.ts` to exist (aic-a00.18).
 */
export interface GridParticipant {
  /** The structure INSTANCE id. Non-empty, and unique across participants AND drones. */
  readonly id: string
  /** Turn-capacity watt-hours GENERATED while operating. `0` for non-generators. */
  readonly producesWh: number
  /** Turn-capacity watt-hours DRAWN while operating. */
  readonly consumesWh: number
  /** Brownout priority class, from `catalog.ts`'s `priorityClass`. Lower is shed later. */
  readonly priority: number
  /**
   * Whether this structure is in service this turn: construction complete AND not
   * offline or damaged. Collapsed into one flag deliberately — from the grid's point
   * of view a unit not in service generates nothing and draws nothing, and the reason
   * changes none of the arithmetic. A non-operating participant is excluded from
   * generation, from demand, and from BOTH result lists: it is neither a brownout
   * victim nor a beneficiary, it simply has no operational systems yet.
   */
  readonly operating: boolean
}

/** The result of resolving one turn's electricity grid. */
export interface ElectricityResult {
  /** Total turn-capacity watt-hours generated by operating generators. */
  readonly generationWh: number
  /** Sum of `consumesWh` across every OPERATING structure, powered or shed. */
  readonly structureDemandWh: number
  /** Turn capacity the FULL roster would reserve: `roster.length * DRONE_TURN_CAPACITY_WH`. */
  readonly droneDemandWh: number
  /** Total demand actually put to the brownout: operating structures plus every drone. */
  readonly totalDemandWh: number
  /** Turn capacity actually delivered — the demands of everything powered. */
  readonly suppliedWh: number
  /**
   * Generation not delivered to anything. Non-zero even during a brownout, because
   * strict-order shedding leaves capacity idle rather than bin-packing; reporting it is
   * what makes that tradeoff acceptable (see `brownout.ts`). Under the no-storage
   * ruling this capacity is genuinely lost.
   */
  readonly unusedWh: number
  /**
   * Watt-hours the on-shift drones will ACTUALLY draw, as opposed to the turn capacity
   * they reserve. Feeds the ledger; `droneDemandWh` feeds the brownout. See the
   * turn-capacity block in the module header for why the two differ.
   */
  readonly droneEnergyWh: number
  /** Ids of operating structures that received power, in priority order. */
  readonly poweredStructureIds: readonly string[]
  /** Ids of operating structures denied power, in priority order. Never a zero-draw structure. */
  readonly shedStructureIds: readonly string[]
  /** Drones charged and on shift, in ascending id order. */
  readonly dronesOnShift: readonly DroneId[]
  /** Drones that could not be charged, in ascending id order. */
  readonly dronesHeldOffline: readonly DroneId[]
  /** Robot-hours the on-shift drones yield: an exact multiple of the shift length. */
  readonly labourCapacityHours: number
  /** True iff anything was shed. */
  readonly brownout: boolean
  /** Index into the priority-ordered demand list of the first shed consumer, or `null`. */
  readonly cutLine: number | null
}

export interface ResolveElectricityParams {
  readonly config: TurnCycleConfig
  readonly participants: readonly GridParticipant[]
  /** Every drone the colony owns, in any order. Priority is ascending id, never position. */
  readonly droneRoster: readonly DroneId[]
}

/**
 * Resolve one turn's electricity grid: generation, demand, and the brownout.
 *
 * Steps, in order:
 *   1. Validate. Ids must be non-empty and unique ACROSS participants and drones
 *      together, because both become demands in one `resolveBrownout` call, where a
 *      collision would silently drop one of them from the result's partition.
 *   2. Sum generation from operating participants' `producesWh`.
 *   3. Build one demand per operating participant, plus ONE DEMAND PER DRONE. Per-drone
 *      demands are what make binary idle correct for a divisible fleet: three drones'
 *      worth of capacity charges exactly three drones. This is also what retires
 *      `drones.ts`'s `FLOOR_EPSILON` from the production path — there is no division
 *      here to be inexact, so an exact-fit roster charges exactly N and one watt-hour
 *      short charges exactly N-1.
 *   4. Delegate allocation to `resolveBrownout`, which owns the total order.
 *   5. Split the powered and shed sets back into structures and drones.
 *
 * A participant that both generates and draws is handled uniformly: it contributes to
 * generation AND competes as a demand. No special case.
 *
 * An empty colony resolves to an all-zero grid, not `NaN` and not a throw — matching
 * the "an empty collection is the ordinary starting state" convention used by
 * `ledger.ts`'s `computeBalances` and `mission.ts`'s `totalHabitatCapacity`.
 *
 * Deterministic: a pure function of its arguments' VALUES. Input array order is not
 * observable, because every priority is `(priorityClass, id)` and both are intrinsic to
 * colony state. Neither input array is mutated.
 *
 * @throws {RangeError} if any energy figure is not a non-negative integer; if any id is
 *   empty or duplicated within or across the two collections; or if `config` fails
 *   `time.ts`'s validation (delegated via `labourCapacityHours`).
 */
export function resolveElectricity(params: ResolveElectricityParams): ElectricityResult {
  const { config, participants, droneRoster } = params

  // One membership set across BOTH collections — see step 1. Used only for `has`,
  // never enumerated, so no Set iteration order can reach an output.
  const seen = new Set<string>()
  const assertUniqueId = (id: string, label: string): void => {
    if (id.length === 0) throw new RangeError(`A ${label} id must not be an empty string`)
    if (seen.has(id)) {
      throw new RangeError(
        `Duplicate grid consumer id: "${id}" — ids must be unique across structures and drones`,
      )
    }
    seen.add(id)
  }

  const demands: PowerDemand[] = []
  const structureIds = new Set<string>()
  let generationWh = 0
  let structureDemandWh = 0

  for (const structure of participants) {
    assertUniqueId(structure.id, 'structure')
    assertNonNegativeInteger(structure.producesWh, `structure "${structure.id}".producesWh`)
    assertNonNegativeInteger(structure.consumesWh, `structure "${structure.id}".consumesWh`)

    if (!structure.operating) continue // not in service: no generation, no draw, no verdict

    generationWh += structure.producesWh
    structureDemandWh += structure.consumesWh
    structureIds.add(structure.id)
    demands.push({
      id: structure.id,
      priority: structure.priority,
      wattHours: structure.consumesWh,
    })
  }

  for (const droneId of droneRoster) {
    assertUniqueId(droneId, 'drone')
    demands.push({
      id: droneId,
      priority: PRIORITY_DRONE_RECHARGE,
      wattHours: DRONE_TURN_CAPACITY_WH,
    })
  }

  const allocation = resolveBrownout(demands, generationWh)

  // Partition the allocation back into structures and drones. Membership tests only,
  // and the ORDER is inherited from `allocation`, which is already in priority order —
  // so these arrays are deterministic with no sorting here.
  const poweredStructureIds = allocation.poweredIds.filter((id) => structureIds.has(id))
  const shedStructureIds = allocation.shedIds.filter((id) => structureIds.has(id))
  const dronesOnShift = allocation.poweredIds.filter((id) => !structureIds.has(id))
  const dronesHeldOffline = allocation.shedIds.filter((id) => !structureIds.has(id))

  return {
    generationWh,
    structureDemandWh,
    droneDemandWh: droneRoster.length * DRONE_TURN_CAPACITY_WH,
    totalDemandWh: allocation.totalDemandWattHours,
    suppliedWh: allocation.suppliedWattHours,
    unusedWh: allocation.unusedWattHours,
    droneEnergyWh: dronesOnShift.length * DRONE_GRID_ENERGY_WH,
    poweredStructureIds,
    shedStructureIds,
    dronesOnShift,
    dronesHeldOffline,
    // Delegated to time.ts rather than recomputing `25 * n`, so this module and the
    // turn cycle can never silently disagree about what a drone-hour is. Always an
    // exact multiple of one build-turn's labour, which is what lets
    // `advanceConstruction` grant labour in whole build-turns with no remainder.
    labourCapacityHours: labourCapacityHours(config, dronesOnShift.length),
    brownout: allocation.brownout,
    cutLine: allocation.cutLine,
  }
}
