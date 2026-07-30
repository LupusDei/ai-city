import { describe, it, expect } from 'vitest'
import { computeBalances, applyLedger } from '../../src/sim/ledger'
import type { ResourceFlow, Stockpile } from '../../src/sim/ledger'
import { createCatalog, getStructureType } from '../../src/sim/catalog'

/** A minimal flow; individual tests override just the field under test. */
function flow(overrides: Partial<ResourceFlow> = {}): ResourceFlow {
  return {
    produces: {},
    consumes: {},
    ...overrides,
  }
}

describe('computeBalances', () => {
  it('should return an empty array for an empty colony (no structures)', () => {
    // The zero-ledger acceptance criterion: no structures must yield [], not a
    // crash and not NaN-laced garbage.
    expect(computeBalances([])).toEqual([])
  })

  it('should net a flow that only produces a resource', () => {
    expect(computeBalances([flow({ produces: { electricity: 10 } })])).toEqual([
      { resource: 'electricity', produced: 10, consumed: 0, net: 10 },
    ])
  })

  it('should net a flow that only consumes a resource', () => {
    expect(computeBalances([flow({ consumes: { electricity: 6 } })])).toEqual([
      { resource: 'electricity', produced: 0, consumed: 6, net: -6 },
    ])
  })

  it('should net production against consumption of the same resource within one flow', () => {
    const solarWithHeater = flow({ produces: { electricity: 10 }, consumes: { electricity: 4 } })
    expect(computeBalances([solarWithHeater])).toEqual([
      { resource: 'electricity', produced: 10, consumed: 4, net: 6 },
    ])
  })

  it('should sum production and consumption across multiple flows for the same resource', () => {
    const reactorA = flow({ produces: { electricity: 10 } })
    const reactorB = flow({ produces: { electricity: 5 } })
    const habitat = flow({ consumes: { electricity: 8 } })
    expect(computeBalances([reactorA, reactorB, habitat])).toEqual([
      { resource: 'electricity', produced: 15, consumed: 8, net: 7 },
    ])
  })

  it('should track independent resources without cross-contamination', () => {
    // A resource produced but never consumed, and one consumed but never
    // produced, must both work in the same turn.
    const refinery = flow({ produces: { oxygen: 4 } })
    const habitat = flow({ consumes: { electricity: 3 } })
    const balances = computeBalances([refinery, habitat])
    expect(balances).toEqual(
      expect.arrayContaining([
        { resource: 'oxygen', produced: 4, consumed: 0, net: 4 },
        { resource: 'electricity', produced: 0, consumed: 3, net: -3 },
      ]),
    )
    expect(balances).toHaveLength(2)
  })

  it('should return balances sorted by resource name regardless of insertion order', () => {
    // Determinism: Object.keys ordering on the flow maps must never leak into
    // the reported order.
    const structure = flow({
      produces: { zinc: 1, aluminium: 2 },
      consumes: { magnesium: 3 },
    })
    expect(computeBalances([structure]).map((b) => b.resource)).toEqual([
      'aluminium',
      'magnesium',
      'zinc',
    ])
  })

  it('should accept a brand-new, never-seen-before resource with zero source changes', () => {
    // This is the data-driven acceptance criterion for the whole ledger: silica,
    // hydrogen, carbon, metals, or any invented resource must drop in as DATA. If
    // this test ever needs a source edit to pass, the design has regressed.
    const balances = computeBalances([flow({ produces: { unobtainium: 7 } })])
    expect(balances).toEqual([
      { resource: 'unobtainium', produced: 7, consumed: 0, net: 7 },
    ])
  })

  it('should treat a zero-value resource entry as present, not absent', () => {
    expect(computeBalances([flow({ produces: { electricity: 0 } })])).toEqual([
      { resource: 'electricity', produced: 0, consumed: 0, net: 0 },
    ])
  })
})

describe('applyLedger', () => {
  it('should produce a zero ledger for an empty colony with no prior stockpiles', () => {
    // Empty colony -> zero ledger. Not NaN, not an empty-object crash.
    expect(applyLedger([])).toEqual({ balances: [], stockpiles: {}, shortfalls: [] })
  })

  it('should default to an empty stockpile when none is supplied', () => {
    const result = applyLedger([flow({ produces: { electricity: 5 } })])
    expect(result.stockpiles).toEqual({ electricity: 5 })
  })

  it('should increase the stockpile by net production when there is no consumption', () => {
    const result = applyLedger([flow({ produces: { electricity: 10 } })], { electricity: 2 })
    expect(result.stockpiles).toEqual({ electricity: 12 })
    expect(result.shortfalls).toEqual([])
  })

  it('should decrease the stockpile by net consumption while sufficient stock remains', () => {
    const result = applyLedger([flow({ consumes: { electricity: 4 } })], { electricity: 10 })
    expect(result.stockpiles).toEqual({ electricity: 6 })
    expect(result.shortfalls).toEqual([])
  })

  it('should report a typed shortfall and clamp the stockpile to zero when consumption exceeds available stock', () => {
    const result = applyLedger([flow({ consumes: { electricity: 10 } })], { electricity: 3 })
    expect(result.stockpiles).toEqual({ electricity: 0 })
    expect(result.shortfalls).toEqual([{ resource: 'electricity', amount: 7 }])
  })

  it('should report a shortfall equal to full consumption when there is no prior stockpile and no production', () => {
    const result = applyLedger([flow({ consumes: { electricity: 5 } })])
    expect(result.stockpiles).toEqual({ electricity: 0 })
    expect(result.shortfalls).toEqual([{ resource: 'electricity', amount: 5 }])
  })

  it('should never let a stockpile value go negative, even across several deficient resources', () => {
    const result = applyLedger(
      [flow({ consumes: { electricity: 20, oxygen: 15 } })],
      { electricity: 5, oxygen: 1 },
    )
    expect(result.stockpiles).toEqual({ electricity: 0, oxygen: 0 })
    expect(Object.values(result.stockpiles).every((v) => v >= 0)).toBe(true)
    expect(result.shortfalls).toEqual([
      { resource: 'electricity', amount: 15 },
      { resource: 'oxygen', amount: 14 },
    ])
  })

  it('should preserve a stockpiled resource untouched by any flow this turn', () => {
    const result = applyLedger([flow({ produces: { electricity: 3 } })], {
      electricity: 1,
      silica: 40,
    })
    expect(result.stockpiles).toEqual({ electricity: 4, silica: 40 })
    expect(result.shortfalls).toEqual([])
  })

  it('should initialize a stockpile entry the first time a resource is produced', () => {
    const result = applyLedger([flow({ produces: { hydrogen: 9 } })], {})
    expect(result.stockpiles).toEqual({ hydrogen: 9 })
  })

  it('should net a resource produced by one structure and consumed by a different structure in the same turn', () => {
    const generator = flow({ produces: { electricity: 12 } })
    const habitat = flow({ consumes: { electricity: 5 } })
    const result = applyLedger([generator, habitat], { electricity: 0 })
    expect(result.stockpiles).toEqual({ electricity: 7 })
    expect(result.shortfalls).toEqual([])
  })

  it('should handle a resource produced but never consumed, and one consumed but never produced, in the same turn', () => {
    const refinery = flow({ produces: { oxygen: 6 } })
    const habitat = flow({ consumes: { electricity: 3 } })
    const result = applyLedger([refinery, habitat], { electricity: 3, oxygen: 0 })
    expect(result.stockpiles).toEqual({ electricity: 0, oxygen: 6 })
    expect(result.shortfalls).toEqual([])
  })

  it('should return stockpile keys in deterministic sorted order regardless of input key order', () => {
    const stockpiles: Stockpile = { zinc: 1, aluminium: 2, magnesium: 3 }
    const result = applyLedger([], stockpiles)
    expect(Object.keys(result.stockpiles)).toEqual(['aluminium', 'magnesium', 'zinc'])
  })

  it('should return shortfalls in deterministic sorted order regardless of input key order', () => {
    const result = applyLedger([
      flow({ consumes: { zinc: 5, aluminium: 5, magnesium: 5 } }),
    ])
    expect(result.shortfalls.map((s) => s.resource)).toEqual([
      'aluminium',
      'magnesium',
      'zinc',
    ])
  })

  it('should accept a brand-new resource end-to-end with zero source changes', () => {
    const result = applyLedger([flow({ produces: { unobtainium: 3 } })], { unobtainium: 1 })
    expect(result.stockpiles).toEqual({ unobtainium: 4 })
    expect(result.shortfalls).toEqual([])
  })

  it('should not mutate the caller-supplied stockpiles object', () => {
    const stockpiles: Stockpile = { electricity: 5 }
    applyLedger([flow({ consumes: { electricity: 2 } })], stockpiles)
    expect(stockpiles).toEqual({ electricity: 5 })
  })

  it('should accept a validated catalog entry whose amounts are realistic base units', () => {
    // End-to-end unit sanity: a 5 kW draw over a 25 h shift is 125_000 Wh and a
    // 300 kg oxygen yield is 300_000 g. These are the magnitudes real catalog data
    // will carry once everything is expressed in Wh/grams, and they must flow
    // through the ledger with no scaling, rounding or precision loss.
    const catalog = createCatalog([
      {
        id: 'sabatier-reactor',
        name: 'Sabatier Reactor',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 5,
        produces: { oxygen: 300_000 },
        consumes: { electricity: 125_000 },
        habitatCapacity: 0,
      },
    ])
    const reactor = getStructureType(catalog, 'sabatier-reactor')
    const result = applyLedger([reactor!], { electricity: 200_000 })
    expect(result.stockpiles).toEqual({ electricity: 75_000, oxygen: 300_000 })
    expect(result.shortfalls).toEqual([])
  })

  it('should accept any object with produces/consumes maps, including a validated StructureType', () => {
    // Structural typing check: a real catalog StructureType satisfies ResourceFlow
    // with no adapter, proving the ledger stays decoupled from catalog.ts.
    const catalog = createCatalog([
      {
        id: 'refinery',
        name: 'Refinery',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 5,
        produces: { oxygen: 3 },
        consumes: { electricity: 8 },
        habitatCapacity: 0,
      },
    ])
    const refinery = getStructureType(catalog, 'refinery')
    expect(refinery).toBeDefined()

    // Non-null assertion, not a ResourceFlow cast: StructureType already satisfies
    // ResourceFlow structurally (no adapter needed) once narrowed past `undefined`.
    const result = applyLedger([refinery!], { electricity: 8 })
    expect(result.stockpiles).toEqual({ electricity: 0, oxygen: 3 })
    expect(result.shortfalls).toEqual([])
  })
})

describe('ledger — integer base units (Wh / grams)', () => {
  // WHY: `catalog.ts` guarantees every authored amount is a non-negative integer in
  // base units, because `time.ts` established that integer arithmetic is
  // non-negotiable project-wide for determinism (constitution §1). These tests pin
  // the consequence the rest of the sim relies on: integers IN means exact,
  // order-independent integers OUT. If any of them ever fails, the ledger has begun
  // introducing floats of its own (a division, an average, a percentage) and the
  // determinism argument no longer holds end to end.

  it('should keep every balance field an exact integer when fed integer flows', () => {
    const balances = computeBalances([
      flow({ produces: { electricity: 125_000 }, consumes: { silica: 1 } }),
      flow({ consumes: { electricity: 47_531 } }),
      flow({ produces: { silica: 300_000, oxygen: 0 } }),
    ])
    for (const balance of balances) {
      expect(Number.isInteger(balance.produced)).toBe(true)
      expect(Number.isInteger(balance.consumed)).toBe(true)
      expect(Number.isInteger(balance.net)).toBe(true)
    }
    expect(balances).toEqual([
      { resource: 'electricity', produced: 125_000, consumed: 47_531, net: 77_469 },
      { resource: 'oxygen', produced: 0, consumed: 0, net: 0 },
      { resource: 'silica', produced: 300_000, consumed: 1, net: 299_999 },
    ])
  })

  it('should keep stockpiles and shortfalls exact integers', () => {
    const result = applyLedger(
      [
        flow({ consumes: { electricity: 125_000, oxygen: 3 } }),
        flow({ produces: { electricity: 40_000 } }),
      ],
      { electricity: 84_999, oxygen: 1 },
    )
    expect(result.stockpiles).toEqual({ electricity: 0, oxygen: 0 })
    expect(result.shortfalls).toEqual([
      { resource: 'electricity', amount: 1 },
      { resource: 'oxygen', amount: 2 },
    ])
    for (const value of Object.values(result.stockpiles)) {
      expect(Number.isInteger(value)).toBe(true)
    }
    for (const shortfall of result.shortfalls) {
      expect(Number.isInteger(shortfall.amount)).toBe(true)
    }
  })

  it('should net identically regardless of the order structures are summed in', () => {
    // THE point of integer base units. With float amounts this is a coin flip on the
    // last bit; with integers it is a guarantee. It starts mattering the moment
    // brownouts impose a documented priority order over consumers, because sum order
    // then becomes an observable of the simulation rather than an accident.
    const structures = [
      flow({ produces: { electricity: 250_000 } }),
      flow({ consumes: { electricity: 125_000 } }),
      flow({ consumes: { electricity: 47_531 }, produces: { oxygen: 300_000 } }),
      flow({ consumes: { oxygen: 89_017 } }),
      flow({ produces: { electricity: 1 } }),
    ]
    const forwards = applyLedger(structures, { electricity: 7, oxygen: 0 })
    const backwards = applyLedger([...structures].reverse(), { electricity: 7, oxygen: 0 })
    const rotated = applyLedger([...structures.slice(2), ...structures.slice(0, 2)], {
      electricity: 7,
      oxygen: 0,
    })

    expect(backwards).toEqual(forwards)
    expect(rotated).toEqual(forwards)
    expect(forwards.stockpiles).toEqual({ electricity: 77_477, oxygen: 210_983 })
  })

  it('should not accumulate representation error across many turns', () => {
    // The failure mode `time.ts` describes for a float clock, applied to the ledger:
    // hundreds of turns of accumulation must land on an exactly predictable total,
    // not on "close enough".
    const TURNS = 500
    const PER_TURN_NET = 125_000 - 47_531
    let stockpiles: Stockpile = {}
    for (let turn = 0; turn < TURNS; turn += 1) {
      stockpiles = applyLedger(
        [flow({ produces: { electricity: 125_000 }, consumes: { electricity: 47_531 } })],
        stockpiles,
      ).stockpiles
    }
    expect(stockpiles).toEqual({ electricity: TURNS * PER_TURN_NET })
  })

  it('should stay exact for amounts at the documented exactness ceiling', () => {
    // Number.MAX_SAFE_INTEGER is the boundary of exact integer arithmetic in a
    // double. Consuming exactly the whole stockpile must land on precisely 0 with no
    // shortfall — the sharpest available check that nothing rounded.
    const huge = Number.MAX_SAFE_INTEGER
    const result = applyLedger([flow({ consumes: { electricity: huge } })], { electricity: huge })
    expect(result.stockpiles).toEqual({ electricity: 0 })
    expect(result.shortfalls).toEqual([])
  })
})
