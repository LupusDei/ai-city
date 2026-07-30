import { describe, it, expect } from 'vitest'
import {
  REACTOR_OUTPUT_KW,
  isReactorGenerating,
  totalGenerationKw,
  isStructureOperational,
  allocateStructurePower,
  computePowerBudget,
} from '../../src/sim/power'
import type { PowerReactor, PowerConsumerStructure } from '../../src/sim/power'
import { DRONE_RECHARGE_DRAW_KW } from '../../src/sim/drones'

/** A complete, online reactor — the common case in most tests below. */
function reactor(overrides: Partial<PowerReactor> = {}): PowerReactor {
  return { id: 'r1', turnsCompleted: 1, buildTurns: 1, online: true, ...overrides }
}

/** A complete structure with a given draw — individual tests override fields. */
function structure(overrides: Partial<PowerConsumerStructure> = {}): PowerConsumerStructure {
  return { id: 's1', turnsCompleted: 1, buildTurns: 1, drawKw: 0, ...overrides }
}

describe('REACTOR_OUTPUT_KW', () => {
  it('should fix reactor output at 40 kWe (NASA Fission Surface Power baseline)', () => {
    expect(REACTOR_OUTPUT_KW).toBe(40)
  })
})

describe('isReactorGenerating', () => {
  it('should return true for a completed, online reactor', () => {
    expect(isReactorGenerating(reactor({ turnsCompleted: 5, buildTurns: 5, online: true }))).toBe(
      true,
    )
  })

  it('should return false for an online reactor still under construction', () => {
    expect(
      isReactorGenerating(reactor({ turnsCompleted: 2, buildTurns: 5, online: true })),
    ).toBe(false)
  })

  it('should return false for a completed reactor that is offline', () => {
    expect(
      isReactorGenerating(reactor({ turnsCompleted: 5, buildTurns: 5, online: false })),
    ).toBe(false)
  })

  it('should return false for an incomplete, offline reactor', () => {
    expect(
      isReactorGenerating(reactor({ turnsCompleted: 0, buildTurns: 5, online: false })),
    ).toBe(false)
  })

  it('should treat turnsCompleted strictly greater than buildTurns as still complete', () => {
    expect(
      isReactorGenerating(reactor({ turnsCompleted: 9, buildTurns: 5, online: true })),
    ).toBe(true)
  })

  it('should reject a negative turnsCompleted', () => {
    expect(() => isReactorGenerating(reactor({ turnsCompleted: -1 }))).toThrow(RangeError)
  })

  it('should reject a non-integer buildTurns', () => {
    expect(() => isReactorGenerating(reactor({ buildTurns: 1.5 }))).toThrow(RangeError)
  })
})

describe('totalGenerationKw', () => {
  it('should return zero for an empty reactor list, not NaN or a crash', () => {
    expect(totalGenerationKw([])).toBe(0)
  })

  it('should sum REACTOR_OUTPUT_KW across every completed, online reactor', () => {
    const reactors = [reactor({ id: 'r1' }), reactor({ id: 'r2' }), reactor({ id: 'r3' })]
    expect(totalGenerationKw(reactors)).toBe(3 * REACTOR_OUTPUT_KW)
  })

  it('should exclude reactors still under construction from the total', () => {
    const reactors = [
      reactor({ id: 'r1', turnsCompleted: 5, buildTurns: 5 }),
      reactor({ id: 'r2', turnsCompleted: 1, buildTurns: 5 }),
    ]
    expect(totalGenerationKw(reactors)).toBe(REACTOR_OUTPUT_KW)
  })

  it('should exclude offline reactors even if fully constructed', () => {
    const reactors = [
      reactor({ id: 'r1', online: true }),
      reactor({ id: 'r2', online: false }),
    ]
    expect(totalGenerationKw(reactors)).toBe(REACTOR_OUTPUT_KW)
  })

  it('should cascade a lost reactor into strictly lower total generation', () => {
    const threeReactors = [reactor({ id: 'r1' }), reactor({ id: 'r2' }), reactor({ id: 'r3' })]
    const twoReactors = [reactor({ id: 'r1' }), reactor({ id: 'r2' })]
    expect(totalGenerationKw(twoReactors)).toBeLessThan(totalGenerationKw(threeReactors))
    expect(totalGenerationKw(threeReactors) - totalGenerationKw(twoReactors)).toBe(
      REACTOR_OUTPUT_KW,
    )
  })
})

describe('isStructureOperational', () => {
  it('should return true once turnsCompleted reaches buildTurns', () => {
    expect(isStructureOperational({ turnsCompleted: 4, buildTurns: 4 })).toBe(true)
  })

  it('should return false while still under construction', () => {
    expect(isStructureOperational({ turnsCompleted: 3, buildTurns: 4 })).toBe(false)
  })

  it('should return true when turnsCompleted overshoots buildTurns', () => {
    expect(isStructureOperational({ turnsCompleted: 10, buildTurns: 4 })).toBe(true)
  })

  it('should reject a negative buildTurns', () => {
    expect(() => isStructureOperational({ turnsCompleted: 0, buildTurns: -1 })).toThrow(
      RangeError,
    )
  })
})

describe('allocateStructurePower — brownout priority order (array-position priority)', () => {
  it('should power every completed structure when generation fully covers demand', () => {
    const structures = [structure({ id: 's1', drawKw: 10 }), structure({ id: 's2', drawKw: 15 })]
    const result = allocateStructurePower(structures, 25)
    expect(result.poweredStructureIds).toEqual(['s1', 's2'])
    expect(result.unpoweredStructureIds).toEqual([])
    expect(result.structureSupplyKw).toBe(25)
    expect(result.remainingKw).toBe(0)
    expect(result.totalStructureDemandKw).toBe(25)
  })

  it('should shed the LAST array position first when generation is short by one structure', () => {
    const structures = [
      structure({ id: 'early', drawKw: 10 }),
      structure({ id: 'mid', drawKw: 10 }),
      structure({ id: 'late', drawKw: 10 }),
    ]
    const result = allocateStructurePower(structures, 20)
    expect(result.poweredStructureIds).toEqual(['early', 'mid'])
    expect(result.unpoweredStructureIds).toEqual(['late'])
  })

  it('should prioritize by array position, not by id sort order', () => {
    // 'zulu' sorts after 'alpha' but is listed FIRST, so it must be the one kept
    // powered — proving priority is array position, never id-based sorting.
    const structures = [structure({ id: 'zulu', drawKw: 10 }), structure({ id: 'alpha', drawKw: 10 })]
    const result = allocateStructurePower(structures, 10)
    expect(result.poweredStructureIds).toEqual(['zulu'])
    expect(result.unpoweredStructureIds).toEqual(['alpha'])
  })

  it('should first-fit-continue: skip an unaffordable higher-priority structure but still power a cheaper one later in the array', () => {
    const structures = [structure({ id: 'big', drawKw: 30 }), structure({ id: 'small', drawKw: 5 })]
    const result = allocateStructurePower(structures, 10)
    expect(result.poweredStructureIds).toEqual(['small'])
    expect(result.unpoweredStructureIds).toEqual(['big'])
    expect(result.structureSupplyKw).toBe(5)
    expect(result.remainingKw).toBe(5)
  })

  it('should exclude structures still under construction from both powered and unpowered lists', () => {
    const structures = [
      structure({ id: 'built', turnsCompleted: 3, buildTurns: 3, drawKw: 5 }),
      structure({ id: 'building', turnsCompleted: 1, buildTurns: 3, drawKw: 5 }),
    ]
    const result = allocateStructurePower(structures, 100)
    expect(result.poweredStructureIds).toEqual(['built'])
    expect(result.unpoweredStructureIds).toEqual([])
    expect(result.totalStructureDemandKw).toBe(5)
  })

  it('should yield zero draw and no crash for zero structures and zero generation', () => {
    const result = allocateStructurePower([], 0)
    expect(result).toEqual({
      poweredStructureIds: [],
      unpoweredStructureIds: [],
      structureSupplyKw: 0,
      remainingKw: 0,
      totalStructureDemandKw: 0,
    })
  })

  it('should reject a negative generationKw', () => {
    expect(() => allocateStructurePower([], -1)).toThrow(RangeError)
  })

  it('should reject a non-finite generationKw', () => {
    expect(() => allocateStructurePower([], NaN)).toThrow(RangeError)
  })

  it('should reject a negative drawKw', () => {
    expect(() => allocateStructurePower([structure({ drawKw: -5 })], 10)).toThrow(RangeError)
  })

  it('should reject a duplicate structure id', () => {
    const structures = [structure({ id: 'dup' }), structure({ id: 'dup' })]
    expect(() => allocateStructurePower(structures, 10)).toThrow(/duplicate/i)
  })

  it('should reject an empty-string structure id', () => {
    expect(() => allocateStructurePower([structure({ id: '' })], 10)).toThrow(RangeError)
  })
})

describe('computePowerBudget', () => {
  it('should yield zero draw and no brownout for zero reactors, zero structures, zero drones', () => {
    const result = computePowerBudget([], [], 0)
    expect(result).toEqual({
      totalGenerationKw: 0,
      totalStructureDemandKw: 0,
      totalDroneChargeDemandKw: 0,
      brownout: false,
      poweredStructureIds: [],
      unpoweredStructureIds: [],
      structureSupplyKw: 0,
      availableChargingPowerKw: 0,
    })
  })

  it('should compute total generation from only completed, online reactors', () => {
    const reactors = [
      reactor({ id: 'r1' }),
      reactor({ id: 'r2', online: false }),
      reactor({ id: 'r3', turnsCompleted: 0, buildTurns: 3 }),
    ]
    const result = computePowerBudget(reactors, [], 0)
    expect(result.totalGenerationKw).toBe(REACTOR_OUTPUT_KW)
  })

  it('should NOT trigger a brownout when generation fully covers structures and drone charging', () => {
    // 2 reactors = 80 kW. Structures need 20 kW. 10 drones need 10 * DRONE_RECHARGE_DRAW_KW (~55.4 kW).
    // 20 + 55.4 = 75.4 < 80, so this must NOT brown out.
    const reactors = [reactor({ id: 'r1' }), reactor({ id: 'r2' })]
    const structures = [structure({ id: 's1', drawKw: 20 })]
    const result = computePowerBudget(reactors, structures, 10)
    expect(result.brownout).toBe(false)
    expect(result.poweredStructureIds).toEqual(['s1'])
    expect(result.availableChargingPowerKw).toBe(60)
  })

  it('should trigger a brownout when total desired draw (structures + full drone charging) exceeds generation', () => {
    // 1 reactor = 40 kW. Structures need 20kW, leaving 20kW for charging, but 10
    // drones WANT 10 * DRONE_RECHARGE_DRAW_KW (~55.4 kW) — total demand exceeds generation.
    const reactors = [reactor({ id: 'r1' })]
    const structures = [structure({ id: 's1', drawKw: 20 })]
    const result = computePowerBudget(reactors, structures, 10)
    expect(result.brownout).toBe(true)
    expect(result.poweredStructureIds).toEqual(['s1'])
    expect(result.availableChargingPowerKw).toBe(20)
  })

  it('BROWNOUT PRIORITY ORDER: structures are powered before drone charging gets any budget', () => {
    // 1 reactor = 40kW. Structures alone need 50kW (more than generation).
    // Under the documented priority (structures before drones), structures still
    // take priority among themselves (array order); drones get whatever is left
    // over, which here is 0 kW, not a negative number and not borrowed from drones.
    const reactors = [reactor({ id: 'r1' })]
    const structures = [
      structure({ id: 'early', drawKw: 40 }),
      structure({ id: 'late', drawKw: 10 }),
    ]
    const result = computePowerBudget(reactors, structures, 5)
    expect(result.poweredStructureIds).toEqual(['early'])
    expect(result.unpoweredStructureIds).toEqual(['late'])
    expect(result.availableChargingPowerKw).toBe(0)
    expect(result.brownout).toBe(true)
  })

  it('should cascade a lost reactor to BOTH a shed structure and a reduced charging budget', () => {
    const structures = [
      structure({ id: 's1', drawKw: 40 }),
      structure({ id: 's2', drawKw: 30 }),
    ]
    const withTwoReactors = computePowerBudget(
      [reactor({ id: 'r1' }), reactor({ id: 'r2' })],
      structures,
      3,
    )
    const withOneReactor = computePowerBudget([reactor({ id: 'r1' })], structures, 3)

    // With 80kW: both structures powered (70kW), 10kW left for charging.
    expect(withTwoReactors.poweredStructureIds).toEqual(['s1', 's2'])
    expect(withTwoReactors.availableChargingPowerKw).toBe(10)

    // Losing a reactor drops generation to 40kW: s1 (40kW) fits, s2 (30kW) does not.
    expect(withOneReactor.poweredStructureIds).toEqual(['s1'])
    expect(withOneReactor.unpoweredStructureIds).toEqual(['s2'])
    expect(withOneReactor.availableChargingPowerKw).toBe(0)
    expect(withOneReactor.availableChargingPowerKw).toBeLessThan(
      withTwoReactors.availableChargingPowerKw,
    )
  })

  it('should use the REAL DRONE_RECHARGE_DRAW_KW to compute drone charge demand, not a hardcoded figure', () => {
    const result = computePowerBudget([], [], 4)
    expect(result.totalDroneChargeDemandKw).toBeCloseTo(4 * DRONE_RECHARGE_DRAW_KW, 10)
  })

  it('should reject a negative droneRosterSize', () => {
    expect(() => computePowerBudget([], [], -1)).toThrow(RangeError)
  })

  it('should reject a non-integer droneRosterSize', () => {
    expect(() => computePowerBudget([], [], 1.5)).toThrow(RangeError)
  })

  it('should reject a duplicate reactor id', () => {
    expect(() => computePowerBudget([reactor({ id: 'dup' }), reactor({ id: 'dup' })], [], 0)).toThrow(
      /duplicate/i,
    )
  })

  it('should reject an empty-string reactor id', () => {
    expect(() => computePowerBudget([reactor({ id: '' })], [], 0)).toThrow(RangeError)
  })

  it('should resolve deterministically: running the same state twice yields deep-equal results', () => {
    const reactors = [reactor({ id: 'r1' }), reactor({ id: 'r2', online: false })]
    const structures = [
      structure({ id: 's1', drawKw: 12 }),
      structure({ id: 's2', drawKw: 33 }),
      structure({ id: 's3', drawKw: 7 }),
    ]

    const first = computePowerBudget(reactors, structures, 6)
    // Fresh array/object references, deep-equal content — proves the result is a
    // pure function of the VALUES, not of any incidental object identity or
    // Map/Set iteration order.
    const second = computePowerBudget(
      reactors.map((r) => ({ ...r })),
      structures.map((s) => ({ ...s })),
      6,
    )

    expect(second).toEqual(first)
  })
})
