/**
 * SEAM TEST — proves `power.ts` and `drones.ts` are genuinely WIRED TOGETHER in
 * production code, not merely two modules that each pass their own unit tests in
 * isolation (see the standing rule in `.claude/rules/03-testing.md`, added after
 * aic-c1p: two modules closed green at 100% coverage and were never wired to each
 * other — one exported a function that only its own test imported).
 *
 * The proof has three parts:
 *   1. Feed `computePowerBudget`'s real `availableChargingPowerKw` output straight
 *      into the real `computeDroneShift` (no test double for either function) and
 *      assert the resulting labour capacity is EXACTLY what the power budget implies.
 *   2. Import the REAL `DRONE_RECHARGE_DRAW_KW` from `drones.ts` (not a hardcoded
 *      ~5.54) to independently derive the expectation, so a future change to that
 *      constant's derivation breaks this test loudly instead of silently.
 *   3. Assert the end-to-end causal chain that is the entire game: fewer reactors
 *      => less charging power => fewer drones on shift => strictly lower labour
 *      capacity, holding across the power.ts/drones.ts module boundary.
 */
import { describe, it, expect } from 'vitest'
import { computePowerBudget } from '../../src/sim/power'
import type { PowerReactor, PowerConsumerStructure } from '../../src/sim/power'
import { computeDroneShift, DRONE_RECHARGE_DRAW_KW } from '../../src/sim/drones'
import type { DroneId } from '../../src/sim/drones'
import { DEFAULT_TURN_CYCLE, labourCapacityHours } from '../../src/sim/time'

/** Three completed, online reactors: 120 kW of generation (3 * REACTOR_OUTPUT_KW). */
const THREE_REACTORS: readonly PowerReactor[] = [
  { id: 'reactor-1', turnsCompleted: 1, buildTurns: 1, online: true },
  { id: 'reactor-2', turnsCompleted: 1, buildTurns: 1, online: true },
  { id: 'reactor-3', turnsCompleted: 1, buildTurns: 1, online: true },
]

/** Same colony with the third reactor lost (destroyed/offline) — 80 kW of generation. */
const TWO_REACTORS: readonly PowerReactor[] = THREE_REACTORS.slice(0, 2)

/** Two completed structures drawing 50 kW total, leaving the remainder for drone charging. */
const STRUCTURES: readonly PowerConsumerStructure[] = [
  { id: 'habitat-1', turnsCompleted: 2, buildTurns: 2, drawKw: 25 },
  { id: 'refinery-1', turnsCompleted: 4, buildTurns: 4, drawKw: 25 },
]

/** A 15-drone roster — comfortably larger than either scenario's power-supported count. */
const ROSTER: readonly DroneId[] = Array.from({ length: 15 }, (_, i) => `drone-${i + 1}`)

describe('power.ts -> drones.ts seam', () => {
  it('should feed the real availableChargingPowerKw into the real computeDroneShift and get the labour capacity the budget implies', () => {
    const budget = computePowerBudget(THREE_REACTORS, STRUCTURES, ROSTER.length)

    // Sanity on the budget itself: 120kW generation - 50kW structures = 70kW for charging.
    expect(budget.totalGenerationKw).toBe(120)
    expect(budget.structureSupplyKw).toBe(50)
    expect(budget.availableChargingPowerKw).toBe(70)

    const shift = computeDroneShift(DEFAULT_TURN_CYCLE, ROSTER, budget.availableChargingPowerKw)

    // Independently derive the expected drone count from the REAL constant — if
    // power.ts and drones.ts were not actually wired (e.g. one side used a stale
    // or hardcoded draw figure), this would drift from `shift.dronesOnShift`.
    const expectedDronesOnShift = Math.min(
      ROSTER.length,
      Math.floor(budget.availableChargingPowerKw / DRONE_RECHARGE_DRAW_KW),
    )
    expect(expectedDronesOnShift).toBeGreaterThan(0)
    expect(expectedDronesOnShift).toBeLessThan(ROSTER.length) // must be a binding constraint, not slack

    expect(shift.dronesOnShift).toBe(expectedDronesOnShift)
    expect(shift.dronesHeldOffline).toBe(ROSTER.length - expectedDronesOnShift)
    expect(shift.labourCapacityHours).toBe(
      labourCapacityHours(DEFAULT_TURN_CYCLE, expectedDronesOnShift),
    )
  })

  it('should cascade: losing a reactor strictly reduces charging power, drones on shift, AND labour capacity', () => {
    const budgetWithThree = computePowerBudget(THREE_REACTORS, STRUCTURES, ROSTER.length)
    const budgetWithTwo = computePowerBudget(TWO_REACTORS, STRUCTURES, ROSTER.length)

    // The power-side half of the chain: fewer reactors => less charging power.
    expect(budgetWithTwo.totalGenerationKw).toBeLessThan(budgetWithThree.totalGenerationKw)
    expect(budgetWithTwo.availableChargingPowerKw).toBeLessThan(
      budgetWithThree.availableChargingPowerKw,
    )
    // Structures are unaffected — the priority order protects them first, exactly
    // as documented in power.ts; the whole cascade is absorbed by charging power.
    expect(budgetWithTwo.poweredStructureIds).toEqual(budgetWithThree.poweredStructureIds)
    expect(budgetWithTwo.structureSupplyKw).toBe(budgetWithThree.structureSupplyKw)

    const shiftWithThree = computeDroneShift(
      DEFAULT_TURN_CYCLE,
      ROSTER,
      budgetWithThree.availableChargingPowerKw,
    )
    const shiftWithTwo = computeDroneShift(
      DEFAULT_TURN_CYCLE,
      ROSTER,
      budgetWithTwo.availableChargingPowerKw,
    )

    // The drone-side half of the chain, crossing the module boundary: less
    // charging power => fewer drones on shift => strictly lower labour capacity.
    // This causal chain, proven end to end, IS the game's central tension.
    expect(shiftWithTwo.dronesOnShift).toBeLessThan(shiftWithThree.dronesOnShift)
    expect(shiftWithTwo.labourCapacityHours).toBeLessThan(shiftWithThree.labourCapacityHours)
  })

  it('should starve drone charging (not structures) when a severe brownout hits, per the documented priority order', () => {
    // A single reactor (40kW) is entirely consumed by the FIRST structure
    // (drawKw: 40, exactly the whole budget), leaving nothing over for the
    // second structure OR for charging. Under the documented priority
    // (structures before drones, array order within structures), the FIRST
    // structure stays powered, the SECOND is shed, and charging gets zero.
    const heavyStructures: readonly PowerConsumerStructure[] = [
      { id: 'habitat-1', turnsCompleted: 2, buildTurns: 2, drawKw: 40 },
      { id: 'refinery-1', turnsCompleted: 4, buildTurns: 4, drawKw: 25 },
    ]
    const oneReactor: readonly PowerReactor[] = [THREE_REACTORS[0] as PowerReactor]
    const budget = computePowerBudget(oneReactor, heavyStructures, ROSTER.length)

    expect(budget.brownout).toBe(true)
    expect(budget.poweredStructureIds).toEqual(['habitat-1'])
    expect(budget.unpoweredStructureIds).toEqual(['refinery-1'])
    expect(budget.availableChargingPowerKw).toBe(0)

    const shift = computeDroneShift(DEFAULT_TURN_CYCLE, ROSTER, budget.availableChargingPowerKw)
    expect(shift.dronesOnShift).toBe(0)
    expect(shift.labourCapacityHours).toBe(0)
    expect(shift.dronesHeldOffline).toBe(ROSTER.length)
  })

  it('should yield zero drones on shift and zero labour capacity for a colony with no reactors at all', () => {
    const budget = computePowerBudget([], STRUCTURES, ROSTER.length)
    expect(budget.availableChargingPowerKw).toBe(0)

    const shift = computeDroneShift(DEFAULT_TURN_CYCLE, ROSTER, budget.availableChargingPowerKw)
    expect(shift.dronesOnShift).toBe(0)
    expect(shift.labourCapacityHours).toBe(0)
  })
})
