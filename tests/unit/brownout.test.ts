/**
 * Tests for the brownout total order (aic-a00.6 / aic-8eq, Phase 1).
 *
 * Three of these tests are not ordinary coverage — they are the reason this
 * module exists at all, and they pin properties the previously-shipped
 * first-fit-continue allocator in `power.ts` does NOT have:
 *
 *   - `should never un-power a consumer when generation increases` pins
 *     MONOTONICITY. First-fit-continue fails it: see the test body for the
 *     exact arithmetic where adding generation switches a running consumer off.
 *   - `should not backfill a shed consumer's budget with a lower-priority one`
 *     pins that shedding follows the total order rather than bin-packing.
 *   - `should produce the same result regardless of input array order` pins
 *     that priority is intrinsic to colony STATE, not to whatever order a
 *     caller happened to build its array in.
 *
 * Per `.claude/rules/03-testing.md` these are unit tests of one module's own
 * public contract; the cross-module seam they feed (power -> brownout ->
 * drones -> construction) is Phase 2's integration test, and deliberately not
 * faked here with a fixture.
 */

import { describe, expect, it } from 'vitest'

import {
  BROWNOUT_PRIORITY_CLASSES,
  PRIORITY_DEFAULT,
  PRIORITY_DRONE_RECHARGE,
  PRIORITY_HABITAT,
  PRIORITY_LIFE_SUPPORT,
  PRIORITY_PROCESSOR_DOWNSTREAM,
  PRIORITY_PROCESSOR_UPSTREAM,
  comparePowerDemands,
  rationaleForPriority,
  resolveBrownout,
} from '../../src/sim/brownout'
import type { PowerDemand } from '../../src/sim/brownout'

/** Terse demand builder so each test reads as its scenario, not its plumbing. */
function demand(id: string, priority: number, wattHours: number): PowerDemand {
  return { id, priority, wattHours }
}

describe('BROWNOUT_PRIORITY_CLASSES', () => {
  it('should be a strict total order with no two classes sharing a priority', () => {
    // Spec 002 FR-005 / spec 003 FR-007 require a documented TOTAL order,
    // "no ties". A duplicate priority value between two named classes would be
    // exactly such a tie, resolvable only by id — which is a tie-break for
    // instances of the SAME class, never a substitute for ordering the classes.
    const priorities = BROWNOUT_PRIORITY_CLASSES.map((entry) => entry.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
  })

  it('should list classes in strictly ascending priority order', () => {
    const priorities = BROWNOUT_PRIORITY_CLASSES.map((entry) => entry.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
  })

  it('should place drone recharge above every processor class', () => {
    // The single most consequential ordering decision in the module, and the one
    // that reverses aic-a00.9's shipped rule. Asserted rather than merely
    // commented so a future edit that quietly demotes drone charging fails here.
    expect(PRIORITY_DRONE_RECHARGE).toBeLessThan(PRIORITY_PROCESSOR_DOWNSTREAM)
    expect(PRIORITY_DRONE_RECHARGE).toBeLessThan(PRIORITY_PROCESSOR_UPSTREAM)
    expect(PRIORITY_DRONE_RECHARGE).toBeLessThan(PRIORITY_DEFAULT)
  })

  it('should keep life support and habitat above drone recharge', () => {
    expect(PRIORITY_LIFE_SUPPORT).toBeLessThan(PRIORITY_HABITAT)
    expect(PRIORITY_HABITAT).toBeLessThan(PRIORITY_DRONE_RECHARGE)
  })

  it('should shed abundant upstream processors before scarce downstream ones', () => {
    expect(PRIORITY_PROCESSOR_DOWNSTREAM).toBeLessThan(PRIORITY_PROCESSOR_UPSTREAM)
  })

  it('should describe every class with a non-empty name and rationale', () => {
    for (const entry of BROWNOUT_PRIORITY_CLASSES) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.rationale.length).toBeGreaterThan(0)
    }
  })
})

describe('rationaleForPriority (aic-svp)', () => {
  // A shed structure's idle REASON, in `turn.ts`'s `CycleReport`, is this function's
  // whole reason to exist: naming WHY a priority class sits where it does, for
  // whichever priority value a shed structure actually carried.

  it('should return the exact rationale for every documented priority class', () => {
    for (const entry of BROWNOUT_PRIORITY_CLASSES) {
      expect(rationaleForPriority(entry.priority)).toBe(entry.rationale)
    }
  })

  it('should fall back to the unclassified rationale for a priority between two documented classes', () => {
    // 350 sits between PRIORITY_DRONE_RECHARGE (300) and PRIORITY_PROCESSOR_DOWNSTREAM
    // (400) — a value the "spaced by 100" design explicitly leaves room for, and one
    // no documented class owns.
    const unclassified = BROWNOUT_PRIORITY_CLASSES.find((entry) => entry.name === 'unclassified')
    expect(unclassified).toBeDefined()
    expect(rationaleForPriority(350)).toBe(unclassified!.rationale)
  })

  it('should fall back to the unclassified rationale for a priority outside the documented range', () => {
    const unclassified = BROWNOUT_PRIORITY_CLASSES.find((entry) => entry.name === 'unclassified')!
    expect(rationaleForPriority(-1)).toBe(unclassified.rationale)
    expect(rationaleForPriority(1_000_000)).toBe(unclassified.rationale)
  })
})

describe('comparePowerDemands', () => {
  it('should order a higher-priority demand before a lower-priority one', () => {
    const high = demand('z-habitat', PRIORITY_HABITAT, 1000)
    const low = demand('a-furnace', PRIORITY_PROCESSOR_DOWNSTREAM, 1000)
    expect(comparePowerDemands(high, low)).toBeLessThan(0)
    expect(comparePowerDemands(low, high)).toBeGreaterThan(0)
  })

  it('should break ties on equal priority by ascending id', () => {
    const first = demand('drone-01', PRIORITY_DRONE_RECHARGE, 1000)
    const second = demand('drone-02', PRIORITY_DRONE_RECHARGE, 1000)
    expect(comparePowerDemands(first, second)).toBeLessThan(0)
    expect(comparePowerDemands(second, first)).toBeGreaterThan(0)
  })

  it('should compare ids by UTF-16 code unit, never by locale', () => {
    // `localeCompare` is locale- and ICU-version-dependent: in an `en` locale it
    // orders 'a' before 'B', while code-unit order puts 'B' (66) first. A golden
    // trace compared across two machines with different locales would diverge on
    // exactly this. Pinning code-unit order makes that impossible.
    const upper = demand('B', PRIORITY_DEFAULT, 1000)
    const lower = demand('a', PRIORITY_DEFAULT, 1000)
    expect(comparePowerDemands(upper, lower)).toBeLessThan(0)
    expect('a'.localeCompare('B')).toBeLessThan(0) // documents the trap being avoided
  })

  it('should return 0 only for demands with identical priority and id', () => {
    // A comparator that returns 0 for two DISTINCT demands is not a total order.
    // Since ids are validated unique, 0 can only ever mean "the same consumer".
    const one = demand('same', PRIORITY_HABITAT, 500)
    const two = demand('same', PRIORITY_HABITAT, 900)
    expect(comparePowerDemands(one, two)).toBe(0)
    expect(comparePowerDemands(one, demand('other', PRIORITY_HABITAT, 500))).not.toBe(0)
  })
})

describe('resolveBrownout — sufficient power', () => {
  it('should power every consumer and report no brownout', () => {
    const result = resolveBrownout(
      [
        demand('hab-1', PRIORITY_HABITAT, 24_000),
        demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
      ],
      100_000,
    )

    expect(result.poweredIds).toEqual(['hab-1', 'press-1'])
    expect(result.shedIds).toEqual([])
    expect(result.brownout).toBe(false)
    expect(result.cutLine).toBeNull()
    expect(result.totalDemandWattHours).toBe(54_000)
    expect(result.suppliedWattHours).toBe(54_000)
    expect(result.unusedWattHours).toBe(46_000)
  })

  it('should power a consumer whose demand exactly equals the remaining budget', () => {
    // The exact-fit boundary. `drones.ts` needed a FLOOR_EPSILON to survive this
    // case only because it divides floats; this module compares integers, so
    // exact fit is exact and no epsilon is warranted (or permitted).
    const result = resolveBrownout([demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000)], 30_000)
    expect(result.poweredIds).toEqual(['press-1'])
    expect(result.unusedWattHours).toBe(0)
    expect(result.brownout).toBe(false)
  })
})

describe('resolveBrownout — shedding', () => {
  it('should shed in exact reverse priority order', () => {
    const demands = [
      demand('hab-1', PRIORITY_HABITAT, 24_000),
      demand('drone-1', PRIORITY_DRONE_RECHARGE, 5_000),
      demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
      demand('hopper-1', PRIORITY_PROCESSOR_UPSTREAM, 12_000),
    ]
    // 29,000 covers habitat + one drone, and nothing more.
    const result = resolveBrownout(demands, 29_000)

    expect(result.poweredIds).toEqual(['hab-1', 'drone-1'])
    expect(result.shedIds).toEqual(['press-1', 'hopper-1'])
    expect(result.brownout).toBe(true)
    expect(result.cutLine).toBe(2)
  })

  it('should shed a consumer that is short by a single watt-hour, not run it partially', () => {
    // Binary idle (spec 002 FR-004, spec 003 FR-006): there is no fractional
    // path. One Wh short is as idle as zero Wh available.
    const result = resolveBrownout([demand('furnace-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000)], 29_999)

    expect(result.poweredIds).toEqual([])
    expect(result.shedIds).toEqual(['furnace-1'])
    expect(result.suppliedWattHours).toBe(0)
    expect(result.unusedWattHours).toBe(29_999)
    expect(result.cutLine).toBe(0)
  })

  it('should not backfill a shed consumer’s budget with a lower-priority one', () => {
    // THE structural difference from aic-a00.9's first-fit-continue. Press (30k,
    // higher priority) does not fit in 20k, so it is shed — and the Hopper (12k,
    // lower priority) is shed too, even though it WOULD have fitted. Priority
    // means priority; a cheaper consumer does not overtake a shed one.
    const result = resolveBrownout(
      [
        demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
        demand('hopper-1', PRIORITY_PROCESSOR_UPSTREAM, 12_000),
      ],
      20_000,
    )

    expect(result.poweredIds).toEqual([])
    expect(result.shedIds).toEqual(['press-1', 'hopper-1'])
    expect(result.unusedWattHours).toBe(20_000)
  })

  it('should never un-power a consumer when generation increases', () => {
    // MONOTONICITY, and the concrete arithmetic that condemns first-fit-continue.
    //
    // Under first-fit-continue with these two consumers:
    //   budget 20,000 -> Press (30k) does not fit and is skipped; Hopper (12k)
    //                    fits in the leftover, so the HOPPER RUNS.
    //   budget 30,000 -> Press fits and consumes all of it; nothing is left for
    //                    the Hopper, so the HOPPER STOPS.
    // Building a reactor would switch a working factory off. No player can be
    // asked to reason about that, and no cycle report can explain it.
    //
    // Strict-order shedding is monotone by construction: the powered set is
    // always a PREFIX of the total order, and prefixes only ever grow as the
    // budget grows. Asserted as a sweep rather than at two points so the
    // property, not two lucky numbers, is what is pinned.
    const demands = [
      demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
      demand('hopper-1', PRIORITY_PROCESSOR_UPSTREAM, 12_000),
    ]

    let previous: readonly string[] = []
    for (let budget = 0; budget <= 60_000; budget += 1_000) {
      const powered = resolveBrownout(demands, budget).poweredIds
      // Every consumer powered at a lower budget must still be powered here.
      for (const id of previous) {
        expect(powered).toContain(id)
      }
      previous = powered
    }

    // And the endpoints, spelled out, so the sweep's intent is unmistakable.
    expect(resolveBrownout(demands, 20_000).poweredIds).toEqual([])
    expect(resolveBrownout(demands, 30_000).poweredIds).toEqual(['press-1'])
    expect(resolveBrownout(demands, 42_000).poweredIds).toEqual(['press-1', 'hopper-1'])
  })

  it('should keep the powered set a prefix of the priority order at every budget', () => {
    const demands = [
      demand('hab-1', PRIORITY_HABITAT, 24_000),
      demand('drone-1', PRIORITY_DRONE_RECHARGE, 5_540),
      demand('drone-2', PRIORITY_DRONE_RECHARGE, 5_540),
      demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
    ]
    const order = ['hab-1', 'drone-1', 'drone-2', 'press-1']

    for (let budget = 0; budget <= 70_000; budget += 500) {
      const { poweredIds } = resolveBrownout(demands, budget)
      expect(poweredIds).toEqual(order.slice(0, poweredIds.length))
    }
  })
})

describe('resolveBrownout — determinism', () => {
  it('should produce the same result regardless of input array order', () => {
    // aic-a00.9 made priority "the caller's array order", which means two callers
    // holding the SAME colony can get different brownouts. Priority here is a
    // function of state (class + id) only, so array order cannot be observed.
    const a = demand('hab-1', PRIORITY_HABITAT, 24_000)
    const b = demand('drone-1', PRIORITY_DRONE_RECHARGE, 5_540)
    const c = demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000)

    const forward = resolveBrownout([a, b, c], 30_000)
    const reversed = resolveBrownout([c, b, a], 30_000)
    const shuffled = resolveBrownout([b, c, a], 30_000)

    expect(reversed).toEqual(forward)
    expect(shuffled).toEqual(forward)
  })

  it('should return a deep-equal result when run twice on the same input', () => {
    const demands = [
      demand('hopper-1', PRIORITY_PROCESSOR_UPSTREAM, 12_000),
      demand('drone-9', PRIORITY_DRONE_RECHARGE, 5_540),
      demand('drone-10', PRIORITY_DRONE_RECHARGE, 5_540),
    ]
    expect(resolveBrownout(demands, 17_000)).toEqual(resolveBrownout(demands, 17_000))
  })

  it('should not mutate the caller’s demands array', () => {
    // The comparator requires a sorted view; sorting IN PLACE would reorder a
    // caller-owned array as a side effect, and a caller that also uses that array
    // for anything ordered (a UI list, a roster) would silently change behaviour.
    const demands = [
      demand('z-last', PRIORITY_PROCESSOR_UPSTREAM, 12_000),
      demand('a-first', PRIORITY_HABITAT, 24_000),
    ]
    const snapshot = demands.map((entry) => ({ ...entry }))

    resolveBrownout(demands, 100_000)

    expect(demands).toEqual(snapshot)
  })

  it('should break instance ties by id, not by position, when power is tight', () => {
    // Two drones of identical class and demand, listed newest-first. Ascending id
    // wins, so `drone-01` keeps its charge regardless of where it sat in the array.
    const result = resolveBrownout(
      [
        demand('drone-02', PRIORITY_DRONE_RECHARGE, 5_540),
        demand('drone-01', PRIORITY_DRONE_RECHARGE, 5_540),
      ],
      5_540,
    )
    expect(result.poweredIds).toEqual(['drone-01'])
    expect(result.shedIds).toEqual(['drone-02'])
  })
})

describe('resolveBrownout — edge cases', () => {
  it('should be a safe no-op for an empty demand list', () => {
    const result = resolveBrownout([], 120_000)
    expect(result.poweredIds).toEqual([])
    expect(result.shedIds).toEqual([])
    expect(result.brownout).toBe(false)
    expect(result.cutLine).toBeNull()
    expect(result.totalDemandWattHours).toBe(0)
    expect(result.suppliedWattHours).toBe(0)
    expect(result.unusedWattHours).toBe(120_000)
  })

  it('should shed everything when generation is zero', () => {
    const result = resolveBrownout(
      [demand('hab-1', PRIORITY_HABITAT, 24_000), demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000)],
      0,
    )
    expect(result.poweredIds).toEqual([])
    expect(result.shedIds).toEqual(['hab-1', 'press-1'])
    expect(result.brownout).toBe(true)
    expect(result.cutLine).toBe(0)
  })

  it('should never shed a zero-demand consumer, even below the cut line', () => {
    // The Shield Berm draws 0 W (spec 002 FR-008). Shedding is the rationing of a
    // scarce good; a consumer that consumes none of it cannot be rationed, and
    // listing it as a brownout victim would make the cycle report untruthful.
    const result = resolveBrownout(
      [
        demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
        demand('berm-1', PRIORITY_DEFAULT, 0),
      ],
      0,
    )
    expect(result.poweredIds).toEqual(['berm-1'])
    expect(result.shedIds).toEqual(['press-1'])
  })

  it('should not let a zero-demand consumer move the cut line', () => {
    const result = resolveBrownout(
      [
        demand('berm-1', PRIORITY_HABITAT, 0),
        demand('press-1', PRIORITY_PROCESSOR_DOWNSTREAM, 30_000),
        demand('hopper-1', PRIORITY_PROCESSOR_UPSTREAM, 12_000),
      ],
      0,
    )
    expect(result.poweredIds).toEqual(['berm-1'])
    expect(result.shedIds).toEqual(['press-1', 'hopper-1'])
    // cutLine indexes the priority-ordered list, and `berm-1` occupies slot 0.
    expect(result.cutLine).toBe(1)
  })

  it('should reproduce a per-drone floor division when every drone is one demand', () => {
    // Modelling drone recharge as ONE DEMAND PER DRONE is what makes binary idle
    // correct for a divisible fleet: 3 drones' worth of budget charges exactly 3
    // drones, which is `computeDroneShift`'s floor behaviour with none of its
    // float division or its FLOOR_EPSILON.
    const perDrone = 5_540
    const roster = Array.from({ length: 10 }, (_, index) =>
      demand(`drone-${String(index).padStart(2, '0')}`, PRIORITY_DRONE_RECHARGE, perDrone),
    )
    const budget = perDrone * 3 + 1 // one Wh of change: must NOT buy a fourth drone

    const result = resolveBrownout(roster, budget)
    expect(result.poweredIds).toEqual(['drone-00', 'drone-01', 'drone-02'])
    expect(result.unusedWattHours).toBe(1)
  })
})

describe('resolveBrownout — validation', () => {
  it('should reject a non-integer power budget', () => {
    // Integer discipline per `time.ts`'s header: a fractional budget is the seam
    // through which float drift enters an accumulating quantity.
    expect(() => resolveBrownout([], 1.5)).toThrow(RangeError)
    expect(() => resolveBrownout([], Number.NaN)).toThrow(RangeError)
    expect(() => resolveBrownout([], Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('should reject a negative power budget', () => {
    expect(() => resolveBrownout([], -1)).toThrow(RangeError)
  })

  it('should reject a non-integer or negative demand', () => {
    expect(() => resolveBrownout([demand('a', PRIORITY_DEFAULT, 1.5)], 100)).toThrow(RangeError)
    expect(() => resolveBrownout([demand('a', PRIORITY_DEFAULT, -1)], 100)).toThrow(RangeError)
    expect(() => resolveBrownout([demand('a', PRIORITY_DEFAULT, Number.NaN)], 100)).toThrow(RangeError)
  })

  it('should reject a non-integer priority', () => {
    // Priority must be an integer so equality (and therefore the id tie-break)
    // is exact; two priorities differing by 1e-15 would be a silent, unorderable
    // near-tie that the id tie-break would never get to resolve.
    expect(() => resolveBrownout([demand('a', 1.5, 100)], 100)).toThrow(RangeError)
  })

  it('should reject an empty-string consumer id', () => {
    expect(() => resolveBrownout([demand('', PRIORITY_DEFAULT, 100)], 100)).toThrow(RangeError)
  })

  it('should reject duplicate consumer ids', () => {
    // A duplicate id makes the tie-break ambiguous and the report unreadable
    // ("which of the two things called press-1 was shed?"). Mirrors
    // `drones.ts`'s `assertValidRoster` and `power.ts`'s `assertUniqueNonEmptyIds`.
    expect(() =>
      resolveBrownout([demand('press-1', PRIORITY_DEFAULT, 100), demand('press-1', PRIORITY_DEFAULT, 200)], 500),
    ).toThrow(RangeError)
  })

  it('should name the offending consumer in the error message', () => {
    expect(() => resolveBrownout([demand('press-1', PRIORITY_DEFAULT, -5)], 100)).toThrow(/press-1/)
  })
})
