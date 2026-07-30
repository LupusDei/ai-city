/**
 * Tests for the electricity grid (aic-96o).
 *
 * This file REPLACES the tests for the previous kW-based allocator.
 * `REACTOR_OUTPUT_KW`, `totalGenerationKw`, `allocateStructurePower`,
 * `computePowerBudget`, `PowerReactor` and `PowerConsumerStructure` are gone, and
 * their tests went with them: that API was one of two modules both claiming to own
 * electricity (docs/turn-composition-audit.md B1), it worked in float kW against the
 * project's integer-watt-hour rule, and its allocator was non-monotone (B3). It had
 * zero production callers, so nothing but its own tests depended on it.
 *
 * The load-bearing tests here pin the resolution rather than the mechanics:
 *   - `should not need an epsilon to charge an exact-fit roster` — the acceptance
 *     criterion Raynor set: integer Wh in, exact drone count out, no FLOOR_EPSILON.
 *   - `should read a structure's draw from catalog data` — one home for the number.
 *   - `should shed processors before drones` — the reversal of the shipped rule.
 */

import { describe, expect, it } from 'vitest'

import {
  DRONE_TURN_CAPACITY_WH,
  ELECTRICITY,
  REACTOR_OUTPUT_WATTS,
  electricityDrawWh,
  electricityLedgerPolicy,
  electricityWh,
  energyPerTurnWh,
  resolveElectricity,
} from '../../src/sim/power'
import type { GridParticipant } from '../../src/sim/power'
import {
  PRIORITY_DRONE_RECHARGE,
  PRIORITY_HABITAT,
  PRIORITY_PROCESSOR_DOWNSTREAM,
  PRIORITY_PROCESSOR_UPSTREAM,
} from '../../src/sim/brownout'
import { DRONE_GRID_ENERGY_WH } from '../../src/sim/drones'
import { DEFAULT_TURN_CYCLE, DRONE_SHIFT_HOURS } from '../../src/sim/time'

/** Terse participant builder; each test overrides only what it is about. */
function participant(overrides: Partial<GridParticipant> & { id: string }): GridParticipant {
  return {
    producesWh: 0,
    consumesWh: 0,
    priority: PRIORITY_PROCESSOR_DOWNSTREAM,
    operating: true,
    ...overrides,
  }
}

/** One reactor's whole-turn output, derived exactly as a catalog author would derive it. */
const REACTOR_WH = energyPerTurnWh(REACTOR_OUTPUT_WATTS, DEFAULT_TURN_CYCLE)

function reactor(id: string, operating = true): GridParticipant {
  return participant({ id, producesWh: REACTOR_WH, operating })
}

/** A 40-drone roster with zero-padded ids, so ascending id order is unambiguous. */
function roster(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `drone-${String(i).padStart(2, '0')}`)
}

describe('ELECTRICITY', () => {
  it('should be the canonical resource key', () => {
    // Exported so no other module spells the string. A second spelling anywhere is a
    // silent split of the resource into two that never net against each other.
    expect(ELECTRICITY).toBe('electricity')
  })
})

describe('energyPerTurnWh', () => {
  it('should convert a continuous wattage into whole watt-hours over one turn', () => {
    // 40,000 W over a 178,775 s turn = 49.65972 h -> 1,986,389 Wh.
    expect(REACTOR_WH).toBe(1_986_389)
  })

  it('should agree with the specs’ quoted 1,986 kWh per reactor turn', () => {
    // The specs quote the reactor at "1,986 kWh per turn". Asserting the derived
    // figure matches to that precision stops the reality-grounded number and the
    // computed one silently diverging.
    expect(Math.round(REACTOR_WH / 1000)).toBe(1_986)
  })

  it('should return a whole number for any wattage', () => {
    // The point of the helper: an author calls it once and gets something
    // `createCatalog`'s integer guard accepts. Rounding here, where it is documented,
    // beats a float that gets rejected three modules away.
    for (const watts of [1, 7, 12_000, 30_000, 40_000, 999_999]) {
      expect(Number.isInteger(energyPerTurnWh(watts, DEFAULT_TURN_CYCLE))).toBe(true)
    }
  })

  it('should return zero for zero watts', () => {
    expect(energyPerTurnWh(0, DEFAULT_TURN_CYCLE)).toBe(0)
  })

  it('should reject a negative or non-finite wattage', () => {
    expect(() => energyPerTurnWh(-1, DEFAULT_TURN_CYCLE)).toThrow(RangeError)
    expect(() => energyPerTurnWh(Number.NaN, DEFAULT_TURN_CYCLE)).toThrow(RangeError)
  })

  it('should reject a malformed turn cycle by delegating to time.ts', () => {
    expect(() => energyPerTurnWh(40_000, { ...DEFAULT_TURN_CYCLE, workSeconds: 0 })).toThrow(
      RangeError,
    )
  })
})

describe('DRONE_TURN_CAPACITY_WH — the turn-capacity model', () => {
  it('should reserve more capacity than a drone actually consumes', () => {
    // A drone charges only during the recharge sol, but under the no-storage ruling
    // work-phase generation cannot be banked to charge it later — so the capacity is
    // tied up for the WHOLE turn and the work-phase half is lost. Reservation
    // therefore exceeds consumption by exactly the turn/sol ratio (2.0138).
    expect(DRONE_TURN_CAPACITY_WH).toBeGreaterThan(DRONE_GRID_ENERGY_WH)
    expect(DRONE_TURN_CAPACITY_WH).toBe(275_204)
    expect(DRONE_GRID_ENERGY_WH).toBe(136_659)
  })

  it('should be the figure that reproduces the ratified drone ceiling', () => {
    // THE test that would have caught a factor-of-two error. Comparing per-turn ENERGY
    // instead of turn CAPACITY gives 3 * 1,986,389 / 136,659 = 43.6 drones against a
    // ratified 21.7 — double the ceiling, destroying the co-binding of power and
    // labour that the whole mechanic rests on. Both figures are asserted so the wrong
    // model cannot be reintroduced silently.
    const threeReactors = REACTOR_WH * 3
    expect(Math.floor(threeReactors / DRONE_TURN_CAPACITY_WH)).toBe(21)
    // The naive model, shown failing, so the distinction is documented in executable form.
    expect(Math.floor(threeReactors / DRONE_GRID_ENERGY_WH)).toBe(43)
  })

  it('should be a whole number of watt-hours', () => {
    // Rounded once at its point of definition, so no per-turn path ever divides.
    expect(Number.isInteger(DRONE_TURN_CAPACITY_WH)).toBe(true)
  })
})

describe('electricityWh', () => {
  it('should read the electricity amount from a resource map', () => {
    expect(electricityWh({ electricity: 12_000, regolith: 5 })).toBe(12_000)
  })

  it('should return zero when the map has no electricity key', () => {
    // "No opinion on this resource" is 0, matching ledger.ts's convention for an
    // absent key — never undefined, never NaN.
    expect(electricityWh({ regolith: 5 })).toBe(0)
    expect(electricityWh({})).toBe(0)
  })

  it('should return an explicit zero unchanged', () => {
    expect(electricityWh({ electricity: 0 })).toBe(0)
  })
})

describe('electricityLedgerPolicy', () => {
  it('should declare electricity as a flow resource', () => {
    // RULED BY THE GENERAL: "No storing energy without barriers." This is the one
    // place in the codebase that states electricity is a flow, so `ledger.ts` can
    // stay resource-agnostic and never branch on a resource name.
    expect(electricityLedgerPolicy(0).flowResources).toEqual([ELECTRICITY])
  })

  it('should grant zero carry-over capacity for a battery-less colony', () => {
    expect(electricityLedgerPolicy(0).storageCapacity).toEqual({ electricity: 0 })
  })

  it('should grant the containment a battery provides', () => {
    // Batteries are the "barrier". They do not smooth day/night — a turn spans 2.014
    // sols, so solar already averages out within it — they are the only route to
    // cross-turn energy at all, which is what makes them strategic.
    expect(electricityLedgerPolicy(1_000_000).storageCapacity).toEqual({
      electricity: 1_000_000,
    })
  })

  it('should reject a non-integer or negative capacity', () => {
    expect(() => electricityLedgerPolicy(1.5)).toThrow(RangeError)
    expect(() => electricityLedgerPolicy(-1)).toThrow(RangeError)
  })
})

describe('electricityDrawWh', () => {
  const habitat = {
    consumes: { electricity: 1_589_111 },
    standbyConsumes: { electricity: 317_822 },
  }

  it('should read a structure’s draw from catalog data, not from a second field', () => {
    // ONE HOME for the number (audit B1, conflict 1). The previous design kept a
    // structure's draw in `PowerConsumerStructure.drawKw`, unlinked from
    // `consumes.electricity`: populating one left the other module blind, populating
    // both charged the colony twice, and nothing detected either case.
    expect(electricityDrawWh(habitat, false)).toBe(1_589_111)
  })

  it('should return the standby draw when the structure is not productive', () => {
    // The General's ruling: an empty habitat draws a reduced standby figure — neither
    // nothing (which would make over-building habitats free) nor full rated.
    expect(electricityDrawWh(habitat, true)).toBe(317_822)
  })

  it('should return zero standby draw for a structure with no standby entry', () => {
    expect(
      electricityDrawWh({ consumes: { electricity: 12_000 }, standbyConsumes: {} }, true),
    ).toBe(0)
  })

  it('should return zero for a structure that draws no electricity at all', () => {
    // The Shield Berm: 0 W running, 0 W idle.
    expect(electricityDrawWh({ consumes: {}, standbyConsumes: {} }, false)).toBe(0)
    expect(electricityDrawWh({ consumes: {}, standbyConsumes: {} }, true)).toBe(0)
  })
})

describe('resolveElectricity — generation', () => {
  it('should sum generation from produces.electricity across operating participants', () => {
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [reactor('reactor-1'), reactor('reactor-2')],
      droneRoster: [],
    })
    expect(result.generationWh).toBe(REACTOR_WH * 2)
  })

  it('should exclude a participant that is not operating', () => {
    // Covers "still under construction" and "built but offline/damaged" alike: from
    // the grid's point of view a reactor not in service generates nothing, and the
    // reason it is out of service changes nothing about the arithmetic.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [reactor('reactor-1'), reactor('reactor-2', false)],
      droneRoster: [],
    })
    expect(result.generationWh).toBe(REACTOR_WH)
  })

  it('should report a zero grid for an empty colony, not NaN', () => {
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [],
      droneRoster: [],
    })
    expect(result.generationWh).toBe(0)
    expect(result.totalDemandWh).toBe(0)
    expect(result.brownout).toBe(false)
    expect(result.labourCapacityHours).toBe(0)
    expect(result.cutLine).toBeNull()
  })

  it('should let a participant both generate and draw', () => {
    // A solar array with a parasitic load, or a reactor with its own cooling draw.
    // Handled uniformly rather than by a special case: it contributes to generation
    // AND appears as a demand competing in the same order as everything else.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [participant({ id: 'array-1', producesWh: 100_000, consumesWh: 1_000 })],
      droneRoster: [],
    })
    expect(result.generationWh).toBe(100_000)
    expect(result.structureDemandWh).toBe(1_000)
    expect(result.poweredStructureIds).toEqual(['array-1'])
  })

  it('should replace the old count-times-constant generation model', () => {
    // AUDIT E1. Generation used to be `reactorCount * REACTOR_OUTPUT_KW`, which could
    // not express a second reactor type at all, and flatly could not express spec
    // 003's solar arrays whose output decays with soiling and dust storms. Two
    // generators with DIFFERENT outputs is the test that model failed.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        reactor('reactor-1'),
        participant({ id: 'array-1', producesWh: 29_200 }),
        // A soiled array: same type, less output, no code branch anywhere.
        participant({ id: 'array-2', producesWh: 17_520 }),
      ],
      droneRoster: [],
    })
    expect(result.generationWh).toBe(REACTOR_WH + 29_200 + 17_520)
  })
})

describe('resolveElectricity — demand and shedding', () => {
  it('should power every consumer when generation covers the whole draw', () => {
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        reactor('reactor-1'),
        participant({ id: 'hopper-1', consumesWh: 595_917, priority: PRIORITY_PROCESSOR_UPSTREAM }),
      ],
      droneRoster: ['drone-01'],
    })
    expect(result.shedStructureIds).toEqual([])
    expect(result.dronesHeldOffline).toEqual([])
    expect(result.brownout).toBe(false)
    expect(result.dronesOnShift).toEqual(['drone-01'])
  })

  it('should shed processors before drones, reversing the shipped rule', () => {
    // AUDIT B4. The previous allocator powered ALL structures before drone charging
    // saw any budget, on an analogy to real grids curtailing EV charging before
    // hospitals — an analogy that does not survive an unmanned colony, where there
    // are no hospitals because there are no people and the drones are the entire
    // workforce. A shed processor loses one turn of output while its feedstock keeps
    // accumulating; a lost drone-turn is progress on everything, gone, against a
    // fixed deadline.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      // Exactly enough for the two drones and nothing else.
      participants: [
        participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH * 2 }),
        participant({
          id: 'press-1',
          consumesWh: 1_489_500,
          priority: PRIORITY_PROCESSOR_DOWNSTREAM,
        }),
      ],
      droneRoster: ['drone-01', 'drone-02'],
    })
    expect(result.dronesOnShift).toEqual(['drone-01', 'drone-02'])
    expect(result.shedStructureIds).toEqual(['press-1'])
    expect(result.brownout).toBe(true)
  })

  it('should keep a habitat powered ahead of drone recharge', () => {
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        participant({ id: 'gen-1', producesWh: 400_000 }),
        participant({ id: 'hab-1', consumesWh: 317_822, priority: PRIORITY_HABITAT }),
      ],
      droneRoster: ['drone-01'],
    })
    // `gen-1` draws nothing, so it is never shed and is trivially powered — a
    // zero-demand consumer cannot be rationed. It is INCLUDED here on purpose: the
    // turn loop uses this list as "structures operating this turn", and a generator
    // producing power is certainly one of those.
    expect(result.poweredStructureIds).toEqual(['hab-1', 'gen-1'])
    // 400,000 - 317,822 = 82,178 Wh left, well short of one drone's 275,204 reservation.
    expect(result.dronesOnShift).toEqual([])
    expect(result.dronesHeldOffline).toEqual(['drone-01'])
  })

  it('should exclude a non-operating participant from demand entirely', () => {
    // A structure under construction is neither a brownout victim nor a beneficiary:
    // it has no operational systems to power yet. It must appear in neither list and
    // must not inflate the reported demand.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        reactor('reactor-1'),
        participant({ id: 'half-built', consumesWh: 500_000, operating: false }),
      ],
      droneRoster: [],
    })
    expect(result.structureDemandWh).toBe(0)
    // Only the operating reactor appears; `half-built` is in NEITHER list.
    expect(result.poweredStructureIds).toEqual(['reactor-1'])
    expect(result.shedStructureIds).toEqual([])
  })

  it('should never shed a zero-draw structure', () => {
    // The Shield Berm draws nothing, so nothing can be denied it. Listing it as a
    // brownout victim would make the cycle report untruthful.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        participant({ id: 'berm-1', consumesWh: 0 }),
        participant({ id: 'press-1', consumesWh: 30_000 }),
      ],
      droneRoster: [],
    })
    expect(result.poweredStructureIds).toEqual(['berm-1'])
    expect(result.shedStructureIds).toEqual(['press-1'])
  })

  it('should report unused generation so idle capacity is visible', () => {
    // Strict-order shedding deliberately leaves capacity idle rather than
    // bin-packing. That is only an acceptable tradeoff if the waste is REPORTED —
    // "you have 82,178 Wh spare and your next consumer needs 136,659" is actionable;
    // silently doing something clever is not.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        participant({ id: 'gen-1', producesWh: 400_000 }),
        participant({ id: 'hab-1', consumesWh: 317_822, priority: PRIORITY_HABITAT }),
      ],
      droneRoster: ['drone-01'],
    })
    expect(result.unusedWh).toBe(82_178)
  })
})

describe('resolveElectricity — drones and labour', () => {
  it('should not need an epsilon to charge an exact-fit roster', () => {
    // THE ACCEPTANCE CRITERION (Raynor, aic-a00.6). `drones.ts` carries a
    // FLOOR_EPSILON because `maxDronesSupportedByPower` divides a FLOAT kW budget by
    // a float per-drone draw, so an exact-fit roster could land at N - 1e-13 and
    // floor to N - 1. This path performs NO DIVISION AT ALL: each drone is its own
    // integer demand, compared exactly. An exact fit charges exactly N, and one
    // watt-hour short of N+1 charges exactly N.
    for (const n of [0, 1, 3, 17, 22, 33]) {
      expect(
        resolveElectricity({
          config: DEFAULT_TURN_CYCLE,
          participants: [participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH * n })],
          droneRoster: roster(40),
        }).dronesOnShift,
      ).toHaveLength(n)

      expect(
        resolveElectricity({
          config: DEFAULT_TURN_CYCLE,
          participants: [
            participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH * (n + 1) - 1 }),
          ],
          droneRoster: roster(40),
        }).dronesOnShift,
      ).toHaveLength(n)
    }
  })

  it('should yield labour hours as an exact integer multiple of the shift length', () => {
    // And therefore an exact multiple of `construction.ts`'s
    // `requiredLabourHoursPerBuildTurn`, which is what lets labour be granted in
    // whole build-turns with no remainder and no epsilon (aic-chg).
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH * 3 })],
      droneRoster: roster(4),
    })
    expect(result.dronesOnShift).toHaveLength(3)
    expect(result.labourCapacityHours).toBe(DRONE_SHIFT_HOURS * 3)
    expect(Number.isInteger(result.labourCapacityHours)).toBe(true)
  })

  it('should charge drones in ascending id order, not roster array order', () => {
    // AUDIT B5. `computeDroneShift` prioritised ROSTER ARRAY POSITION, so the outcome
    // depended on how the caller built its array — two callers holding the same
    // colony could disagree, and a golden trace could pass for one and fail for the
    // other. Ascending instance id is intrinsic to colony state (spec 003 FR-007).
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH })],
      droneRoster: ['drone-09', 'drone-02', 'drone-05'],
    })
    expect(result.dronesOnShift).toEqual(['drone-02'])
    expect(result.dronesHeldOffline).toEqual(['drone-05', 'drone-09'])
  })

  it('should partition the roster exactly — every drone on shift or offline, never both', () => {
    const ids = ['drone-01', 'drone-02', 'drone-03']
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH })],
      droneRoster: ids,
    })
    expect([...result.dronesOnShift, ...result.dronesHeldOffline].sort()).toEqual([...ids].sort())
  })

  it('should report zero labour when no drone can be charged', () => {
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [],
      droneRoster: ['drone-01', 'drone-02'],
    })
    expect(result.dronesOnShift).toEqual([])
    expect(result.labourCapacityHours).toBe(0)
    expect(result.droneDemandWh).toBe(DRONE_TURN_CAPACITY_WH * 2)
    expect(result.brownout).toBe(true)
  })

  it('should tag drone demands with the drone-recharge priority class', () => {
    // Not directly observable in the result, so asserted through behaviour: a
    // structure at exactly PRIORITY_DRONE_RECHARGE ties with the drones and is
    // ordered against them by id alone. 'a-tie' sorts before every 'drone-NN'.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH }),
        participant({
          id: 'a-tie',
          consumesWh: DRONE_TURN_CAPACITY_WH,
          priority: PRIORITY_DRONE_RECHARGE,
        }),
      ],
      droneRoster: ['drone-01'],
    })
    // 'a-tie' wins the tie and takes the whole budget; `gen-1` draws nothing so it is
    // powered regardless, and the drone starves.
    expect(result.poweredStructureIds).toEqual(['a-tie', 'gen-1'])
    expect(result.dronesOnShift).toEqual([])
  })

  it('should report actual drone energy separately from reserved capacity', () => {
    // The two figures the turn-capacity model necessarily produces: `droneDemandWh` is
    // what the brownout rations, `droneEnergyWh` is what the ledger debits. The
    // difference is generation that existed during the work phase and had nowhere to
    // go, which the ledger reports as Vented.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [participant({ id: 'gen-1', producesWh: DRONE_TURN_CAPACITY_WH * 2 })],
      droneRoster: roster(2),
    })
    expect(result.droneDemandWh).toBe(DRONE_TURN_CAPACITY_WH * 2)
    expect(result.droneEnergyWh).toBe(DRONE_GRID_ENERGY_WH * 2)
    expect(result.droneEnergyWh).toBeLessThan(result.droneDemandWh)
  })

  it('should charge no drone energy for a drone that was held offline', () => {
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [],
      droneRoster: roster(5),
    })
    expect(result.droneEnergyWh).toBe(0)
  })

  it('should reproduce the ratified 21-drone ceiling for three reactors', () => {
    // The ratified balance proof, executed rather than quoted: three 40 kWe reactors
    // support 21 drones and not 22. This is the figure that makes power and labour
    // co-binding, so a change that breaks it breaks the game's core mechanic.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [reactor('reactor-1'), reactor('reactor-2'), reactor('reactor-3')],
      droneRoster: roster(40),
    })
    expect(result.dronesOnShift).toHaveLength(21)
    expect(result.brownout).toBe(true)
  })

  it('should reproduce the ratified drop to 17 drones with one habitat running', () => {
    // The other half of the same proof: one habitat's draw costs ~4.6 drones. The
    // General's derivation of the ~25 kW figure is what the habitat draw below
    // encodes (1,241,493 Wh over one turn = 25 kW), and it lands on 17 as ratified.
    const result = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [
        reactor('reactor-1'),
        reactor('reactor-2'),
        reactor('reactor-3'),
        participant({ id: 'hab-1', consumesWh: 1_241_493, priority: PRIORITY_HABITAT }),
      ],
      droneRoster: roster(40),
    })
    // The habitat plus the three zero-draw reactors; the habitat is the only real load.
    expect(result.poweredStructureIds).toContain('hab-1')
    expect(result.shedStructureIds).toEqual([])
    expect(result.dronesOnShift).toHaveLength(17)
  })
})

describe('resolveElectricity — determinism', () => {
  const participants = [
    reactor('reactor-1'),
    participant({ id: 'press-1', consumesWh: 1_489_500, priority: PRIORITY_PROCESSOR_DOWNSTREAM }),
    participant({ id: 'hopper-1', consumesWh: 595_917, priority: PRIORITY_PROCESSOR_UPSTREAM }),
  ]
  const droneRoster = ['drone-03', 'drone-01', 'drone-02']

  it('should return a deep-equal result when run twice', () => {
    const args = { config: DEFAULT_TURN_CYCLE, participants, droneRoster }
    expect(resolveElectricity(args)).toEqual(resolveElectricity(args))
  })

  it('should produce the same result regardless of input array order', () => {
    const forward = resolveElectricity({ config: DEFAULT_TURN_CYCLE, participants, droneRoster })
    const reversed = resolveElectricity({
      config: DEFAULT_TURN_CYCLE,
      participants: [...participants].reverse(),
      droneRoster: [...droneRoster].reverse(),
    })
    expect(reversed).toEqual(forward)
  })

  it('should not mutate its input arrays', () => {
    const participantsCopy = participants.map((entry) => ({ ...entry }))
    const rosterCopy = [...droneRoster]
    resolveElectricity({ config: DEFAULT_TURN_CYCLE, participants, droneRoster })
    expect(participants).toEqual(participantsCopy)
    expect(droneRoster).toEqual(rosterCopy)
  })

  it('should keep every reported quantity an integer', () => {
    // No division happens anywhere in this path, so nothing can arrive fractional.
    const result = resolveElectricity({ config: DEFAULT_TURN_CYCLE, participants, droneRoster })
    for (const value of [
      result.generationWh,
      result.structureDemandWh,
      result.droneDemandWh,
      result.totalDemandWh,
      result.unusedWh,
      result.labourCapacityHours,
    ]) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('should conserve energy: supply plus unused equals generation', () => {
    // The accounting invariant. If this ever fails, watt-hours are being created or
    // destroyed inside the allocator.
    const result = resolveElectricity({ config: DEFAULT_TURN_CYCLE, participants, droneRoster })
    expect(result.suppliedWh + result.unusedWh).toBe(result.generationWh)
  })
})

describe('resolveElectricity — validation', () => {
  it('should reject a non-integer or negative energy figure', () => {
    expect(() =>
      resolveElectricity({
        config: DEFAULT_TURN_CYCLE,
        participants: [participant({ id: 'gen-1', producesWh: 1.5 })],
        droneRoster: [],
      }),
    ).toThrow(RangeError)
    expect(() =>
      resolveElectricity({
        config: DEFAULT_TURN_CYCLE,
        participants: [participant({ id: 'c-1', consumesWh: -1 })],
        droneRoster: [],
      }),
    ).toThrow(RangeError)
  })

  it('should reject an id shared between a participant and a drone', () => {
    // Both become demands in one brownout call, where ids must be unique — and a
    // collision would silently drop one of them from the result's partition.
    expect(() =>
      resolveElectricity({
        config: DEFAULT_TURN_CYCLE,
        participants: [participant({ id: 'drone-01', consumesWh: 100 })],
        droneRoster: ['drone-01'],
      }),
    ).toThrow(/drone-01/)
  })

  it('should reject duplicate participant ids', () => {
    expect(() =>
      resolveElectricity({
        config: DEFAULT_TURN_CYCLE,
        participants: [participant({ id: 'dup' }), participant({ id: 'dup' })],
        droneRoster: [],
      }),
    ).toThrow(RangeError)
  })

  it('should reject duplicate or empty drone ids', () => {
    expect(() =>
      resolveElectricity({
        config: DEFAULT_TURN_CYCLE,
        participants: [],
        droneRoster: ['drone-01', 'drone-01'],
      }),
    ).toThrow(RangeError)
    expect(() =>
      resolveElectricity({ config: DEFAULT_TURN_CYCLE, participants: [], droneRoster: [''] }),
    ).toThrow(RangeError)
  })

  it('should reject a malformed turn cycle by delegating to time.ts', () => {
    expect(() =>
      resolveElectricity({
        config: { ...DEFAULT_TURN_CYCLE, workSeconds: -1 },
        participants: [],
        droneRoster: ['drone-01'],
      }),
    ).toThrow(RangeError)
  })
})
