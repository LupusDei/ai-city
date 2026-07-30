/**
 * Tests for drone energetics.
 *
 * The `computeDroneShift` suites that used to live here are gone with the function
 * (aic-96o). It resolved a roster against a FLOAT kW budget using ROSTER ARRAY POSITION
 * as priority, which contradicted spec 003 FR-007's ascending-instance-id requirement
 * and was the sole reason `FLOOR_EPSILON` had to exist. `power.ts`'s
 * `resolveElectricity` replaces it, modelling each drone as its own integer watt-hour
 * demand — so there is no division to be inexact and the epsilon was deleted rather
 * than ported. See `drones.ts`'s header and docs/turn-composition-audit.md B5.
 *
 * What remains is the part that was always the real value here: the AUDITABLE
 * DERIVATION of the ratified per-drone energy figures, and the guard that the kWh
 * views and the canonical integer watt-hour values never drift apart.
 */
import { describe, it, expect } from 'vitest'
import {
  DRONE_RECHARGE_ENERGY_KWH,
  DRONE_RECHARGE_DRAW_KW,
  DRONE_GRID_ENERGY_KWH,
  CHARGE_EFFICIENCY,
  PACK_THERMAL_WATTS,
  DRONE_GRID_ENERGY_WH,
  DRONE_RECHARGE_ENERGY_WH,
} from '../../src/sim/drones'
// Read-only: proves the ratified kW figure is still load-bearing rather than
// decorative, by tying it to the turn-capacity value the sim actually rations.
import { DRONE_TURN_CAPACITY_WH } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE, DRONE_WORK_SECONDS, MARS_SOL_SECONDS } from '../../src/sim/time'

describe('reality-grounded constants', () => {
  it('should fix the usable shift energy at 125 kWh per full sol', () => {
    // Ratified by the General: a 5 kW drone over a 25 h shift consumes 125 kWh.
    // This is the USABLE energy at the pack, before charging losses.
    expect(DRONE_RECHARGE_ENERGY_KWH).toBe(125)
  })

  it('should account for charging losses and pack thermal maintenance', () => {
    // aic-emx: the ideal figure omitted two real losses. Both must be named
    // constants so the derivation stays auditable rather than a magic 5.54.
    expect(CHARGE_EFFICIENCY).toBe(0.92)
    expect(PACK_THERMAL_WATTS).toBe(32)
    // Grid energy = usable / efficiency, plus thermal upkeep over the recharge sol.
    expect(DRONE_GRID_ENERGY_KWH).toBeGreaterThan(136.6)
    expect(DRONE_GRID_ENERGY_KWH).toBeLessThan(136.7)
  })

  it('should derive the recharge draw at approximately 5.54 kW', () => {
    // 136.66 kWh / 24.6597h (one Mars sol, from time.ts) ~= 5.54 kW.
    // The old ideal-case 5.07 understated the game's binding constraint by 9.3%.
    expect(DRONE_RECHARGE_DRAW_KW).toBeGreaterThan(5.53)
    expect(DRONE_RECHARGE_DRAW_KW).toBeLessThan(5.55)
  })

  it('should never regress to the ideal-case figure that ignores losses', () => {
    // Regression guard for aic-emx: 5.07 kW is the lossless number. If this
    // ever passes again, someone has silently dropped efficiency or thermal.
    expect(DRONE_RECHARGE_DRAW_KW).toBeGreaterThan(5.4)
  })

  it('should derive the draw from its inputs rather than hardcoding it', () => {
    // Recomputing the whole chain here proves the exported value is genuinely
    // derived: if someone replaces it with a literal 5.54, this still passes,
    // but any change to efficiency/thermal/sol length would then break it.
    const grid = DRONE_RECHARGE_ENERGY_KWH / CHARGE_EFFICIENCY
    const solHours = MARS_SOL_SECONDS / 3600
    const thermal = (PACK_THERMAL_WATTS * solHours) / 1000
    expect(DRONE_GRID_ENERGY_KWH).toBeCloseTo(grid + thermal, 10)
    expect(DRONE_RECHARGE_DRAW_KW).toBeCloseTo(DRONE_GRID_ENERGY_KWH / solHours, 10)
  })
})
describe('integer watt-hour base units (aic-049)', () => {
  // RATIFIED BY THE GENERAL: "Watt hours for the win." The ledger enforces integer
  // base units (aic-5ub), so drone energy must be expressible as whole watt-hours
  // or the guard will correctly reject drone recharge the moment it becomes a real
  // consumes.electricity amount.
  it('should express pack energy as a whole number of watt-hours', () => {
    expect(DRONE_RECHARGE_ENERGY_WH).toBe(125_000)
    expect(Number.isInteger(DRONE_RECHARGE_ENERGY_WH)).toBe(true)
  })

  it('should express grid energy as a whole number of watt-hours', () => {
    // 125,000 / 0.92 + 32 W x 24.659722 h = 136,658.6763 Wh, rounded to nearest Wh.
    expect(DRONE_GRID_ENERGY_WH).toBe(136_659)
    expect(Number.isInteger(DRONE_GRID_ENERGY_WH)).toBe(true)
  })

  it('should keep the rounding error negligible against the derived value', () => {
    const derived =
      (DRONE_RECHARGE_ENERGY_WH / CHARGE_EFFICIENCY) +
      PACK_THERMAL_WATTS * (MARS_SOL_SECONDS / 3600)
    const errorPpm = (Math.abs(DRONE_GRID_ENERGY_WH - derived) / derived) * 1e6
    // 2.4 ppm. Asserted rather than commented so a future edit that quietly
    // changes a constant cannot silently widen the approximation.
    expect(errorPpm).toBeLessThan(10)
  })

  it('should preserve the ratified 5.54 kW draw', () => {
    const drawKw = DRONE_GRID_ENERGY_WH / 1000 / (MARS_SOL_SECONDS / 3600)
    expect(drawKw).toBeCloseTo(5.54, 2)
  })

  it('should agree with the legacy kWh figure to within the rounding error', () => {
    // The kWh constants remain as derived views for reporting; the Wh figures are
    // now canonical. They must not drift apart.
    expect(DRONE_GRID_ENERGY_WH / 1000).toBeCloseTo(DRONE_GRID_ENERGY_KWH, 3)
  })

  it('should keep the ratified 5.54 kW draw load-bearing via the turn-capacity figure', () => {
    // The ratified figure is a POWER: 5.54 kW drawn continuously through the recharge
    // sol. `power.ts` rations turn CAPACITY, so the two must correspond exactly — that
    // correspondence is what makes 5.54 kW still mean something rather than surviving
    // as a decorative constant nothing reads.
    //
    // It is also the guard against the factor-of-two error: comparing per-turn ENERGY
    // rather than turn capacity would let 3 reactors charge 43 drones instead of the
    // ratified 21. See power.ts's turn-capacity block.
    // Compared with a 1 Wh tolerance, not for equality, and the reason matters:
    // `DRONE_TURN_CAPACITY_WH` is derived from the CANONICAL INTEGER `DRONE_GRID_ENERGY_WH`,
    // while `DRONE_RECHARGE_DRAW_KW` is derived from the unrounded float `DRONE_GRID_ENERGY_KWH`.
    // The two therefore round at different points and land 1 Wh apart (275,204 against
    // 275,203). That is the right way round — the integer is the source of truth and the
    // float is the auditable derivation — and 1 Wh on 275 kWh is 4 parts per million,
    // orders of magnitude below the smallest step that can change any brownout outcome.
    const turnHours = (DRONE_WORK_SECONDS + MARS_SOL_SECONDS) / 3600
    const fromRatifiedKw = Math.round(DRONE_RECHARGE_DRAW_KW * 1000 * turnHours)
    expect(Math.abs(DRONE_TURN_CAPACITY_WH - fromRatifiedKw)).toBeLessThanOrEqual(1)
    // And it is strictly larger than what a drone actually takes, by the turn/sol ratio.
    expect(DRONE_TURN_CAPACITY_WH).toBeGreaterThan(DRONE_GRID_ENERGY_WH)
  })

  it('should keep the locked turn cycle consistent with the sol used in the derivation', () => {
    // Preserved from the deleted `computeDroneShift` suite: the drone figures are
    // derived against `MARS_SOL_SECONDS`, so the locked cycle's recharge phase must BE
    // one sol. If they ever diverge, every energy figure above is quietly wrong.
    expect(DEFAULT_TURN_CYCLE.rechargeSeconds).toBe(MARS_SOL_SECONDS)
    expect(DEFAULT_TURN_CYCLE.workSeconds).toBe(DRONE_WORK_SECONDS)
  })
})
