/**
 * Drone roster, shifts & labour capacity — the core tension of the colony sim.
 *
 * The ratified mechanic (per the General): a drone works one 25h shift, then must
 * recharge for a full Mars sol before it can work again. Recharging draws colony
 * power. That single fact is what makes power and labour ONE constraint rather than
 * two independent ones: you cannot buy more build-rate by spending only labour-side
 * resources, because every drone that works this cycle first had to be *charged* by
 * the reactor. This module answers, for one turn: given a roster of drones and a
 * reactor power budget earmarked for drone charging, how many drones can actually be
 * on shift, how many must be held offline, and how much labour (robot-hours) does
 * that yield.
 *
 * This module builds on `./time` (`labourCapacityHours`, `TurnCycleConfig`) rather
 * than duplicating either the 25h-shift constant or the hours-per-shift arithmetic —
 * `time.ts` is the single source of truth for the turn cycle, this module only adds
 * the power-supply constraint on top of it.
 */
import { MARS_SOL_SECONDS, labourCapacityHours } from './time'
import type { TurnCycleConfig } from './time'

/** A drone's stable identifier within the roster. */
export type DroneId = string

/**
 * Energy restored to one drone over one full recharge sol, in kWh.
 *
 * Reality-grounded, ratified figure — do not replace with a different number without
 * updating this comment's basis. 125 kWh is the amount of charge a drone's battery
 * pack draws to go from "just finished a 25h shift" back to "full for the next 25h
 * shift," restored over the ~24.66h of one Mars sol.
 */
export const DRONE_RECHARGE_ENERGY_KWH = 125

/** Seconds per hour, used only for the kWh -> kW unit conversion below. */
const SECONDS_PER_HOUR = 3600

/**
 * Round-trip efficiency of the drone charging system (aic-emx).
 *
 * Energy drawn from the colony grid is always greater than energy delivered to the
 * pack — losses in the charger electronics and in the cells themselves. 0.92 is a
 * conventional round-trip figure for a well-managed lithium pack.
 */
export const CHARGE_EFFICIENCY = 0.92

/**
 * Continuous power to keep a drone's battery pack warm enough to accept charge, in W.
 *
 * Mars ambient runs near -60 C, and lithium cells cannot safely charge while frozen,
 * so the pack is held near 0 C throughout the recharge. ~32 W is the steady-state loss
 * for an insulated ~1 m² pack across that gradient. It is genuinely this small because
 * the Martian atmosphere is ~610 Pa, far too thin to carry meaningful convective heat
 * loss — conduction through insulation dominates. Do not inflate this figure by
 * reasoning from Earth-atmosphere intuitions.
 */
export const PACK_THERMAL_WATTS = 32

/**
 * Total energy the COLONY GRID must supply per drone per recharge sol, in kWh.
 *
 * This is the number that matters for the power budget, and it is deliberately
 * distinct from `DRONE_RECHARGE_ENERGY_KWH`: that constant is the energy the drone
 * actually *uses*, this one is what the reactors must actually *deliver*, including
 * both losses above.
 */
export const DRONE_GRID_ENERGY_KWH =
  DRONE_RECHARGE_ENERGY_KWH / CHARGE_EFFICIENCY +
  (PACK_THERMAL_WATTS * (MARS_SOL_SECONDS / 3600)) / 1000

/**
 * Average power one drone draws from the colony grid while recharging, in kW.
 *
 * Derived as energy / time rather than hardcoded: `DRONE_GRID_ENERGY_KWH` spread over
 * one Mars sol. The sol length is imported from `time.ts`'s `MARS_SOL_SECONDS` (not
 * re-derived here) so this figure can never drift out of sync with the turn-cycle
 * module's definition of a sol. ~136.66 kWh / 24.6597h ~= 5.54 kW.
 *
 * HISTORY (aic-emx): this was originally 5.07 kW, computed as the ideal 125 kWh over
 * one sol. That omitted charging losses and pack thermal upkeep, understating the
 * game's single binding constraint by 9.3%. Every term is now a named constant so the
 * derivation stays auditable — the same pattern `time.ts` uses for the 577-day deadline.
 *
 * This is an intentionally non-integer, floating-point constant: unlike the
 * seconds-based clock arithmetic in `time.ts` (which must stay exact to avoid
 * replay drift across hundreds of turns), this is a single derived physical rate
 * computed once from its inputs at module load, not accumulated turn over turn —
 * so ordinary IEEE-754 rounding here is harmless.
 */
export const DRONE_RECHARGE_DRAW_KW =
  (DRONE_GRID_ENERGY_KWH * SECONDS_PER_HOUR) / MARS_SOL_SECONDS

/**
 * Tolerance added before flooring available-power-to-drone-count division.
 *
 * `DRONE_RECHARGE_DRAW_KW` is an irrational-ish floating-point value, so a caller
 * who computes "exactly enough power for N drones" as `N * DRONE_RECHARGE_DRAW_KW`
 * and passes that back in can hit IEEE-754 rounding that makes the quotient land at
 * `N - 1e-13` instead of exactly `N`. Without this epsilon, `Math.floor` would then
 * report `N - 1` drones supported — an off-by-one that silently under-counts an
 * exact-fit roster. The epsilon is far smaller than any physically meaningful power
 * shortfall (a real shortfall of even one hundredth of a drone's draw is orders of
 * magnitude larger than 1e-9), so it cannot mask a genuine insufficiency.
 */
const FLOOR_EPSILON = 1e-9

/** Result of resolving one turn's drone roster against the available charging power. */
export interface DroneShiftResult {
  /** Total number of drones in the roster, regardless of shift outcome. */
  readonly rosterSize: number
  /** How many drones were successfully charged and are on shift this turn. */
  readonly dronesOnShift: number
  /** How many drones could not be supplied recharge power and are held offline. */
  readonly dronesHeldOffline: number
  /**
   * IDs of drones on shift, in roster order. Together with `offlineDroneIds` this
   * exactly partitions the input roster — every id appears in exactly one array.
   */
  readonly onShiftDroneIds: readonly DroneId[]
  /**
   * IDs of drones held offline, in roster order (see the priority rule documented
   * on `computeDroneShift`). Reported explicitly — never just a count — so the
   * player-facing UI can show *which* drones are idle and why the build rate is
   * lower than roster size would suggest.
   */
  readonly offlineDroneIds: readonly DroneId[]
  /** Robot-hours of labour available this turn: `labourCapacityHours(config, dronesOnShift)`. */
  readonly labourCapacityHours: number
}

/** @throws {RangeError} if `powerKw` is not a finite, non-negative number. */
function assertValidPower(powerKw: number): void {
  if (!Number.isFinite(powerKw) || powerKw < 0) {
    throw new RangeError(
      `availableChargingPowerKw must be a finite, non-negative number, received: ${powerKw}`,
    )
  }
}

/**
 * Validates roster shape: every id must be a non-empty string, and ids must be
 * unique. Uniqueness matters because the roster-order priority rule (see
 * `computeDroneShift`) reports offline status per id — a duplicate id would make
 * that report ambiguous (which of the two same-named drones is actually offline?).
 *
 * @throws {RangeError} on an empty-string id or a duplicate id.
 */
function assertValidRoster(roster: readonly DroneId[]): void {
  const seen = new Set<DroneId>()
  for (const id of roster) {
    if (id.length === 0) {
      throw new RangeError('Drone roster contains an empty-string id')
    }
    if (seen.has(id)) {
      throw new RangeError(`Drone roster contains a duplicate id: "${id}"`)
    }
    seen.add(id)
  }
}

/**
 * How many drones the given power budget can simultaneously recharge, with no
 * upper bound applied yet (the caller separately clamps this to roster size).
 *
 * Floors rather than rounds: a drone cannot be "partially" recharged and put to
 * partial use this turn (see `FLOOR_EPSILON` for why an epsilon is added first).
 */
function maxDronesSupportedByPower(availableChargingPowerKw: number): number {
  return Math.floor(availableChargingPowerKw / DRONE_RECHARGE_DRAW_KW + FLOOR_EPSILON)
}

/**
 * Resolve one turn's drone roster against the reactor power earmarked for drone
 * charging, producing how many drones are on shift and the resulting labour
 * capacity.
 *
 * Offline-priority rule (documented, deterministic — never Set/Map iteration
 * order): drones are prioritized strictly by their POSITION IN THE `roster` ARRAY.
 * If the power budget supports fewer drones than the roster's size, the drones at
 * the LOWEST indices keep charging priority and stay on shift; the drones at the
 * HIGHEST indices are held offline first. This is a pure function of the roster
 * array's order and the power figure — it never depends on id sort order, hashing,
 * or any Set/Map's incidental iteration order, so the same roster and power always
 * produce the same offline set (a golden-trace/replay requirement).
 *
 * Rationale for "earliest position wins": the roster array is the caller's
 * authoritative ordering (e.g. build/acquisition order), so this reads naturally as
 * "longest-serving drones keep their charging slot; the newest additions to the
 * fleet are the first to be curtailed when power is tight" — a simple seniority
 * rule a player can learn and predict.
 *
 * @throws {RangeError} if `availableChargingPowerKw` is not a finite, non-negative
 *   number; if `roster` contains an empty-string or duplicate id; or if `config`
 *   fails `time.ts`'s own validation (delegated, not re-implemented here).
 */
export function computeDroneShift(
  config: TurnCycleConfig,
  roster: readonly DroneId[],
  availableChargingPowerKw: number,
): DroneShiftResult {
  assertValidPower(availableChargingPowerKw)
  assertValidRoster(roster)

  const maxSupported = Math.max(0, maxDronesSupportedByPower(availableChargingPowerKw))
  const dronesOnShift = Math.min(roster.length, maxSupported)

  const onShiftDroneIds = roster.slice(0, dronesOnShift)
  const offlineDroneIds = roster.slice(dronesOnShift)

  // Delegates to time.ts for the actual hours arithmetic (and its own config
  // validation) rather than recomputing "25 * dronesOnShift" here, so the two
  // modules can never silently disagree on what a drone-hour is.
  const capacityHours = labourCapacityHours(config, dronesOnShift)

  return {
    rosterSize: roster.length,
    dronesOnShift,
    dronesHeldOffline: offlineDroneIds.length,
    onShiftDroneIds,
    offlineDroneIds,
    labourCapacityHours: capacityHours,
  }
}
