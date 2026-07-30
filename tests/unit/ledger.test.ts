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
