import { describe, it, expect } from 'vitest'
import {
  DRONE_RECHARGE_ENERGY_KWH,
  DRONE_RECHARGE_DRAW_KW,
  DRONE_GRID_ENERGY_KWH,
  CHARGE_EFFICIENCY,
  PACK_THERMAL_WATTS,
  computeDroneShift,
} from '../../src/sim/drones'
import { DEFAULT_TURN_CYCLE, MARS_SOL_SECONDS } from '../../src/sim/time'
import type { TurnCycleConfig } from '../../src/sim/time'

/** A tiny custom cycle so labour-hours arithmetic in assertions stays easy to hand-check. */
const SIMPLE_CYCLE: TurnCycleConfig = {
  workSeconds: 10 * 3600, // 10-hour shift
  rechargeSeconds: 1000,
  missionSeconds: 1_000_000,
}

/** Power for exactly `n` drones charging simultaneously, in kW. */
function powerFor(n: number): number {
  return n * DRONE_RECHARGE_DRAW_KW
}

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

describe('computeDroneShift — labour capacity', () => {
  it('should scale labour capacity linearly with drones on shift', () => {
    const roster1 = ['d1']
    const roster2 = ['d1', 'd2']
    const roster4 = ['d1', 'd2', 'd3', 'd4']
    const abundant = powerFor(10)

    const r1 = computeDroneShift(SIMPLE_CYCLE, roster1, abundant)
    const r2 = computeDroneShift(SIMPLE_CYCLE, roster2, abundant)
    const r4 = computeDroneShift(SIMPLE_CYCLE, roster4, abundant)

    expect(r1.labourCapacityHours).toBe(10)
    expect(r2.labourCapacityHours).toBe(20)
    expect(r4.labourCapacityHours).toBe(40)
    // Explicitly linear: doubling drones doubles capacity.
    expect(r4.labourCapacityHours).toBe(r2.labourCapacityHours * 2)
  })

  it('should yield zero capacity for an empty roster, not a crash or divide-by-zero', () => {
    const result = computeDroneShift(SIMPLE_CYCLE, [], powerFor(5))
    expect(result.dronesOnShift).toBe(0)
    expect(result.labourCapacityHours).toBe(0)
    expect(result.dronesHeldOffline).toBe(0)
    expect(result.offlineDroneIds).toEqual([])
  })

  it('should yield zero capacity for a roster with zero available charging power', () => {
    const result = computeDroneShift(SIMPLE_CYCLE, ['d1', 'd2', 'd3'], 0)
    expect(result.dronesOnShift).toBe(0)
    expect(result.labourCapacityHours).toBe(0)
    expect(result.dronesHeldOffline).toBe(3)
  })
})

describe('computeDroneShift — power-constrained offline holding', () => {
  it('should hold a drone offline rather than let it work for free when power is short by one', () => {
    const roster = ['d1', 'd2', 'd3']
    const result = computeDroneShift(SIMPLE_CYCLE, roster, powerFor(2))

    expect(result.dronesOnShift).toBe(2)
    expect(result.dronesHeldOffline).toBe(1)
    expect(result.labourCapacityHours).toBe(20) // 10h * 2 drones, NOT 30
  })

  it('should report the exact count and identity of held-offline drones (partial power, the critical case)', () => {
    const roster = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
    const result = computeDroneShift(SIMPLE_CYCLE, roster, powerFor(3))

    expect(result.rosterSize).toBe(5)
    expect(result.dronesOnShift).toBe(3)
    expect(result.dronesHeldOffline).toBe(2)
    expect(result.onShiftDroneIds).toEqual(['alpha', 'bravo', 'charlie'])
    expect(result.offlineDroneIds).toEqual(['delta', 'echo'])
    expect(result.labourCapacityHours).toBe(30)
  })

  it('should follow a deterministic roster-order priority: earlier roster positions keep power first', () => {
    // Same roster, same shortfall, run twice (and with a differently-but-equivalently
    // ordered array) — the offline set must be a pure function of (roster, power),
    // never incidental Map/Set iteration order.
    const roster = ['z', 'y', 'x', 'w']
    const power = powerFor(1)

    const first = computeDroneShift(SIMPLE_CYCLE, roster, power)
    const second = computeDroneShift(SIMPLE_CYCLE, [...roster], power)

    expect(first.onShiftDroneIds).toEqual(['z'])
    expect(first.offlineDroneIds).toEqual(['y', 'x', 'w'])
    expect(second.offlineDroneIds).toEqual(first.offlineDroneIds)
  })

  it('should hold offline the drones whose ids happen to sort first alphabetically, proving order is roster-position-based, not id-based', () => {
    // If offline selection were (incorrectly) based on sorting ids, 'alpha' would be
    // held offline here since it sorts first. Roster-position priority instead keeps
    // it on shift because it is listed first.
    const roster = ['alpha', 'zulu']
    const result = computeDroneShift(SIMPLE_CYCLE, roster, powerFor(1))

    expect(result.onShiftDroneIds).toEqual(['alpha'])
    expect(result.offlineDroneIds).toEqual(['zulu'])
  })

  it('should not create extra capacity beyond roster size when power exceeds what the roster needs', () => {
    const roster = ['d1', 'd2', 'd3']
    const result = computeDroneShift(SIMPLE_CYCLE, roster, powerFor(1000))

    expect(result.dronesOnShift).toBe(3)
    expect(result.dronesHeldOffline).toBe(0)
    expect(result.offlineDroneIds).toEqual([])
    expect(result.labourCapacityHours).toBe(30)
  })

  it('should treat power that exactly covers the whole roster as fully sufficient (no float-rounding shortfall)', () => {
    const roster = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']
    const result = computeDroneShift(SIMPLE_CYCLE, roster, powerFor(7))

    expect(result.dronesOnShift).toBe(7)
    expect(result.dronesHeldOffline).toBe(0)
  })

  it('should floor fractional drone-equivalents of power rather than granting partial capacity', () => {
    // 2.9 drones' worth of power supports only 2 whole drones — a drone cannot be
    // "partially" recharged and put to partial use.
    const roster = ['d1', 'd2', 'd3']
    const result = computeDroneShift(SIMPLE_CYCLE, roster, powerFor(2) + DRONE_RECHARGE_DRAW_KW * 0.9)

    expect(result.dronesOnShift).toBe(2)
    expect(result.dronesHeldOffline).toBe(1)
  })
})

describe('computeDroneShift — input validation', () => {
  it('should reject negative available charging power', () => {
    expect(() => computeDroneShift(SIMPLE_CYCLE, ['d1'], -1)).toThrow(RangeError)
  })

  it('should reject non-finite available charging power (NaN)', () => {
    expect(() => computeDroneShift(SIMPLE_CYCLE, ['d1'], NaN)).toThrow(RangeError)
  })

  it('should reject non-finite available charging power (Infinity)', () => {
    expect(() => computeDroneShift(SIMPLE_CYCLE, ['d1'], Infinity)).toThrow(RangeError)
  })

  it('should reject a roster containing a duplicate drone id', () => {
    expect(() => computeDroneShift(SIMPLE_CYCLE, ['d1', 'd2', 'd1'], powerFor(3))).toThrow(
      /duplicate/i,
    )
  })

  it('should reject a roster containing an empty-string drone id', () => {
    expect(() => computeDroneShift(SIMPLE_CYCLE, ['d1', ''], powerFor(2))).toThrow(RangeError)
  })

  it('should propagate a malformed turn-cycle config (delegated to time.ts validation)', () => {
    const badConfig: TurnCycleConfig = { ...SIMPLE_CYCLE, workSeconds: 0 }
    expect(() => computeDroneShift(badConfig, ['d1'], powerFor(1))).toThrow(RangeError)
  })
})

describe('computeDroneShift — against the real, locked turn cycle', () => {
  it('should compute plausible capacity for a modest roster under the default cycle', () => {
    // Sanity check against the actual ratified numbers (25h shifts, ~5.54kW draw),
    // not just the simplified SIMPLE_CYCLE used above.
    const roster = ['d1', 'd2', 'd3', 'd4', 'd5']
    const result = computeDroneShift(DEFAULT_TURN_CYCLE, roster, powerFor(3))

    expect(result.dronesOnShift).toBe(3)
    expect(result.dronesHeldOffline).toBe(2)
    expect(result.labourCapacityHours).toBe(75) // 25h * 3
  })
})
