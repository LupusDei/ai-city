/**
 * Drone energetics: what one drone's recharge costs the colony grid.
 *
 * The ratified mechanic (per the General): a drone works one 25 h shift, then must
 * recharge for a full Mars sol before it can work again. Recharging draws colony
 * power. That single fact is what makes power and labour ONE constraint rather than
 * two independent ones — you cannot buy more build-rate by spending only labour-side
 * resources, because every drone that works this cycle first had to be CHARGED by the
 * reactor.
 *
 * This module now owns exactly that: the reality-grounded per-drone energy figures and
 * their derivation. It no longer decides which drones get to charge.
 *
 * WHAT WAS REMOVED, AND WHY (aic-96o). `computeDroneShift`, `DroneShiftResult`,
 * `maxDronesSupportedByPower` and `FLOOR_EPSILON` are gone. They resolved a roster
 * against a FLOAT kW budget, and two things had made them wrong rather than merely
 * superseded:
 *
 *   1. THE PRIORITY RULE CONTRADICTED THE ACCEPTED SPECS. Offline priority was a
 *      drone's POSITION IN THE ROSTER ARRAY, which makes the outcome a property of how
 *      the caller assembled its list rather than of the colony — two callers holding
 *      the same colony could disagree, and a golden trace could pass for one and fail
 *      for the other. Spec 003 FR-007 requires ascending instance id, which is
 *      intrinsic to state. See docs/turn-composition-audit.md B5.
 *   2. IT WAS THE LAST FLOAT IN THE POWER PATH, and the reason `FLOOR_EPSILON` had to
 *      exist at all. The epsilon was never a workaround for a constant being inexact;
 *      it was a consequence of dividing a float kW budget by a float per-drone draw, so
 *      an exact-fit roster could land at `N - 1e-13` and floor to `N - 1`.
 *
 * Both are now handled by `power.ts`'s `resolveElectricity`, which models each drone as
 * its OWN integer watt-hour demand and delegates ordering to `brownout.ts`. Because
 * there is no division anywhere in that path, the epsilon did not need porting — it
 * needed deleting. The class of error stopped existing rather than being compensated
 * for, which is the same shape as the fix to `advanceConstruction` (aic-chg).
 *
 * The kWh/kW constants below are retained as the AUDITABLE DERIVATION of the ratified
 * figures — they are what a reviewer checks the physics against — and
 * `tests/unit/drones.test.ts` asserts they never drift from the integer watt-hour
 * values that the sim actually uses.
 */
import { MARS_SOL_SECONDS } from './time'

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

/**
 * Energy restored to one drone's pack per recharge sol, in INTEGER WATT-HOURS.
 *
 * RATIFIED BY THE GENERAL (aic-049): "Watt hours for the win." Watt-hours are the
 * ledger's base unit for energy (aic-5ub), and `catalog.ts` now REJECTS any
 * non-integer resource amount — so the moment drone recharge becomes a real
 * `consumes.electricity` entry, a fractional kWh figure would be refused. These
 * Wh constants are therefore the canonical ones; the kWh values above and below
 * remain as derived views for prose and reporting, and tests assert the two never
 * drift apart.
 */
export const DRONE_RECHARGE_ENERGY_WH = 125_000

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
 * Total energy the colony grid must supply per drone per recharge sol, in INTEGER
 * WATT-HOURS. The canonical figure for the power budget.
 *
 * DERIVATION AND THE ROUNDING, both ratified (aic-049):
 *   125,000 Wh / 0.92 charge efficiency        = 135,869.5652 Wh
 *   + 32 W x 24.659722 h pack thermal upkeep   =      789.1111 Wh
 *                                              = 136,658.6763 Wh
 * Rounded to the nearest whole watt-hour: 136,659 Wh.
 *
 * The rounding error is 0.3237 Wh, or 2.4 PARTS PER MILLION. It preserves the
 * General's ratified 5.54 kW draw exactly at the precision he stated it, and the
 * reactor budget is unchanged to four decimal places: 120 kW (three 40 kWe units)
 * supports 21.6537 drones both before and after. Rounding HERE, once, at the point
 * of definition, was chosen over rounding at each ledger call site — an implicit
 * rounding scattered across callers is precisely the silent inexactness the integer
 * discipline exists to prevent.
 *
 * HISTORICAL NOTE, corrected (aic-96o). An earlier version of this comment said
 * `FLOOR_EPSILON` still existed below and would die only once the CALLER passed
 * watt-hours rather than float kW. That analysis was right and the epsilon is now
 * GONE — `maxDronesSupportedByPower` was removed with it, because the whole-turn
 * capacity reservation in `power.ts` replaced the division that needed it. This
 * comment is corrected rather than deleted because a comment describing code that
 * no longer exists is exactly what hid aic-c1p for a day: `landing.ts` claimed no
 * deposit-generation module existed long after one did. A stale comment is a defect.
 */
export const DRONE_GRID_ENERGY_WH = Math.round(
  DRONE_RECHARGE_ENERGY_WH / CHARGE_EFFICIENCY +
    PACK_THERMAL_WATTS * (MARS_SOL_SECONDS / 3600),
)

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
