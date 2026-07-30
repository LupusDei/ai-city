import { describe, it, expect } from 'vitest'
import { computeBalances, applyLedger } from '../../src/sim/ledger'
import type { ResourceFlow, Stockpile } from '../../src/sim/ledger'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
// For the three-stage-chain test: netting the whole chain in declaration order.
import { listStructureTypes } from '../../src/sim/catalog'

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
    // `vented` is present and empty: with no flow resource declared, nothing can be
    // vented, and the field is always an array so callers never branch on absence.
    expect(applyLedger([])).toEqual({
      balances: [],
      stockpiles: {},
      shortfalls: [],
      vented: [],
      overflow: [],
    })
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

describe('ledger — a one-time buildCost is NOT a per-turn flow', () => {
  // WHY THIS BLOCK EXISTS: `buildCost` and `consumes` are both resource debits in
  // the same base units on the same object, so the single most likely bug in the
  // whole resource-chain epic is one of them being charged where the other belongs
  // — a bill of materials silently billed EVERY TURN, or upkeep charged once and
  // then never again. `ResourceFlow` is deliberately just `{ produces, consumes }`,
  // so a `StructureType` satisfies it while its `buildCost` and `storageCapacity`
  // are structurally invisible to this module. These tests pin that invisibility so
  // it cannot be "helpfully" fixed later.

  /** Registers one structure through the real catalog boundary and returns it. */
  function catalogType(spec: Parameters<typeof createCatalog>[0][number]) {
    const type = getStructureType(createCatalog([spec]), spec.id)
    expect(type).toBeDefined()
    return type!
  }

  it('should ignore a buildCost-only resource entirely when netting a turn', () => {
    // A PV Array costs 20 kg of silicon to BUILD and draws nothing to run. After it
    // is standing, a turn must show no silicon movement whatsoever — not 20_000 g of
    // consumption, and not a silicon balance line at all.
    const pvArray = catalogType({
      id: 'pv-array',
      name: 'Photovoltaic Array',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 3,
      buildCost: { silicon: 20_000 },
      produces: { electricity: 125_000 },
      consumes: {},
      habitatCapacity: 0,
    })

    expect(computeBalances([pvArray])).toEqual([
      { resource: 'electricity', produced: 125_000, consumed: 0, net: 125_000 },
    ])
  })

  it('should not touch a stockpile of a resource that only appears in buildCost', () => {
    const pvArray = catalogType({
      id: 'pv-array',
      name: 'Photovoltaic Array',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 3,
      buildCost: { silicon: 20_000 },
      produces: { electricity: 125_000 },
      consumes: {},
      habitatCapacity: 0,
    })

    // The silicon stockpile passes through untouched: 500 in, 500 out. If buildCost
    // were being read as a flow this would be 0 with a 19_500 g shortfall.
    const result = applyLedger([pvArray], { silicon: 500 })
    expect(result.stockpiles).toEqual({ silicon: 500, electricity: 125_000 })
    expect(result.shortfalls).toEqual([])
  })

  it('should charge only the per-turn consumes when a resource appears in BOTH maps', () => {
    // The confusable case made explicit: a Sinter Plant costs 5 kg of regolith once
    // to build and eats 40 kg of regolith every turn. Exactly 40_000 g must be
    // charged — never 45_000 (both), never 5_000 (the wrong one).
    const sinterPlant = catalogType({
      id: 'sinter-plant',
      name: 'Sinter Plant',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 8,
      buildCost: { regolith: 5_000 },
      produces: { sinteredPlate: 30_000 },
      consumes: { regolith: 40_000 },
      habitatCapacity: 0,
    })

    expect(computeBalances([sinterPlant])).toEqual([
      { resource: 'regolith', produced: 0, consumed: 40_000, net: -40_000 },
      { resource: 'sinteredPlate', produced: 30_000, consumed: 0, net: 30_000 },
    ])
  })

  it('should not re-charge buildCost on every turn of a long run', () => {
    // The sharpest statement of the bug this field could cause. Over 100 turns a
    // structure with a 20 kg silicon bill of materials must draw silicon zero times.
    // If buildCost ever leaked into the flow, this would end 2_000_000 g short.
    const pvArray = catalogType({
      id: 'pv-array',
      name: 'Photovoltaic Array',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 3,
      buildCost: { silicon: 20_000 },
      produces: { electricity: 125_000 },
      consumes: {},
      habitatCapacity: 0,
    })

    let stockpiles: Stockpile = { silicon: 1_000 }
    for (let turn = 0; turn < 100; turn += 1) {
      stockpiles = applyLedger([pvArray], stockpiles).stockpiles
    }
    expect(stockpiles).toEqual({ silicon: 1_000, electricity: 100 * 125_000 })
  })

  it('should ignore storageCapacity when netting a turn', () => {
    // A cap is not a flow either. A pure silo — no produces, no consumes, 1 t of
    // regolith capacity — must net nothing at all.
    const silo = catalogType({
      id: 'regolith-silo',
      name: 'Regolith Silo',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 2,
      produces: {},
      consumes: {},
      storageCapacity: { regolith: 1_000_000 },
      habitatCapacity: 0,
    })

    expect(computeBalances([silo])).toEqual([])
    expect(applyLedger([silo], { regolith: 42 })).toMatchObject({
      stockpiles: { regolith: 42 },
      shortfalls: [],
    })
  })

  it('OPEN GAP: applyLedger does not yet clamp stockpiles to storageCapacity', () => {
    // Deliberate, documented scope boundary — NOT an endorsement of unbounded
    // accumulation. aic-c75 adds the storageCapacity FIELD and its validation;
    // aggregating caps across completed structures and deciding overflow semantics
    // belongs to the chain beads that own turn resolution, exactly as the
    // placement-time `requiresDeposit` check does.
    //
    // This test exists so the gap is VISIBLE rather than silent: whoever implements
    // capping will see it fail and must consciously replace it with the real
    // overflow assertions. Overflow must then be reported as structured data,
    // symmetric with `Shortfall` — a silently discarded surplus is precisely the
    // ledger bug the field was introduced to prevent.
    const silo = catalogType({
      id: 'tiny-silo',
      name: 'Tiny Silo',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 1,
      produces: { regolith: 900 },
      consumes: {},
      storageCapacity: { regolith: 1_000 },
      habitatCapacity: 0,
    })

    // Two turns of 900 g into a 1_000 g silo. Today: 1_800, uncapped.
    const afterOne = applyLedger([silo]).stockpiles
    const afterTwo = applyLedger([silo], afterOne).stockpiles
    expect(afterTwo).toEqual({ regolith: 1_800 })
    expect(afterTwo.regolith).toBeGreaterThan(silo.storageCapacity.regolith!)
  })

  it('should net a full three-stage chain assembled from catalog data alone', () => {
    // extract → refine → consume, with invented resources and every new field in
    // play, netted by a ledger that knows nothing about any of them. This is the
    // whole point of the shared foundation: the chains are data, the sim is not.
    const catalog = createCatalog([
      {
        id: 'xenon-extractor',
        name: 'Xenon Extractor',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 6,
        buildCost: { plasteel: 12_000 },
        siting: { requiresDeposit: 'xenon-vein' },
        produces: { xenonOre: 500_000 },
        consumes: { electricity: 40_000 },
        storageCapacity: { xenonOre: 2_000_000 },
        habitatCapacity: 0,
      },
      {
        id: 'xenon-refinery',
        name: 'Xenon Refinery',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 9,
        buildCost: { plasteel: 30_000 },
        produces: { plasteel: 3_000 },
        consumes: { xenonOre: 500_000, electricity: 90_000 },
        storageCapacity: { plasteel: 100_000 },
        habitatCapacity: 0,
      },
      {
        id: 'plasteel-barracks',
        name: 'Plasteel Barracks',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 4,
        buildCost: { plasteel: 5_000 },
        produces: {},
        consumes: { plasteel: 100, electricity: 8_000 },
        habitatCapacity: 8,
      },
    ])

    const chain = listStructureTypes(catalog)
    const result = applyLedger(chain, { electricity: 200_000 })

    // The ore is fully consumed by the refinery in the same turn it is extracted;
    // plasteel accumulates net of the barracks' upkeep; electricity draws down.
    expect(result.stockpiles).toEqual({
      electricity: 200_000 - 40_000 - 90_000 - 8_000,
      plasteel: 3_000 - 100,
      xenonOre: 0,
    })
    expect(result.shortfalls).toEqual([])

    // None of the three bills of materials appear anywhere in the turn's accounting:
    // 47_000 g of plasteel was owed at CONSTRUCTION time, and this is a turn.
    expect(result.balances.find((b) => b.resource === 'plasteel')).toEqual({
      resource: 'plasteel',
      produced: 3_000,
      consumed: 100,
      net: 2_900,
    })
  })
})

/**
 * FLOW vs STOCK accumulation policy (aic-96o).
 *
 * RULED BY THE GENERAL: "No storing energy without barriers." Electricity does not
 * accumulate across turns — generation is spent or lost within the turn that
 * produced it — UNLESS an explicit storage structure grants containment.
 *
 * The consequence is bigger than a special case for one resource: the ledger cannot
 * apply one stockpile model to everything. Silica, water, regolith and oxygen are
 * STOCKS that carry over. Electricity is a FLOW that does not, until a battery grants
 * it capacity. So accumulation becomes a declared per-resource policy, and — crucially
 * for this module's resource-agnostic contract — the policy arrives as DATA from the
 * caller rather than as a hardcoded branch on the resource name. `ledger.ts` still
 * does not know that electricity exists.
 */
describe('applyLedger — flow resources', () => {
  it('should carry nothing over for a flow resource with no granted capacity', () => {
    // The default battery-less colony: 1,986,389 Wh generated, 500,000 Wh drawn, and
    // the 1,486,389 Wh surplus is gone at the turn boundary rather than banked.
    const result = applyLedger(
      [flow({ produces: { electricity: 1_986_389 }, consumes: { electricity: 500_000 } })],
      {},
      { flowResources: ['electricity'] },
    )
    expect(result.stockpiles.electricity).toBe(0)
  })

  it('should report the un-carried surplus as vented rather than dropping it silently', () => {
    // Symmetric with `Shortfall`. A surplus that vanishes without a trace is the same
    // class of bug as a stockpile silently going negative — and for energy this is a
    // real physical event, not bookkeeping: the radiators dump it as heat.
    const result = applyLedger(
      [flow({ produces: { electricity: 1_986_389 }, consumes: { electricity: 500_000 } })],
      {},
      { flowResources: ['electricity'] },
    )
    expect(result.vented).toEqual([{ resource: 'electricity', amount: 1_486_389 }])
  })

  it('should carry over up to granted capacity and vent only the excess', () => {
    // A battery is the "barrier" the ruling requires. With 1,000,000 Wh of granted
    // containment, that much of the surplus survives the turn and the rest vents.
    const result = applyLedger(
      [flow({ produces: { electricity: 1_986_389 }, consumes: { electricity: 500_000 } })],
      {},
      { flowResources: ['electricity'], storageCapacity: { electricity: 1_000_000 } },
    )
    expect(result.stockpiles.electricity).toBe(1_000_000)
    expect(result.vented).toEqual([{ resource: 'electricity', amount: 486_389 }])
  })

  it('should vent nothing when a flow resource fits entirely within capacity', () => {
    const result = applyLedger(
      [flow({ produces: { electricity: 400_000 } })],
      {},
      { flowResources: ['electricity'], storageCapacity: { electricity: 1_000_000 } },
    )
    expect(result.stockpiles.electricity).toBe(400_000)
    expect(result.vented).toEqual([])
  })

  it('should let a flow resource be drawn back down out of granted storage', () => {
    // The whole point of a battery: energy banked last turn is spendable this turn.
    // Without this, capacity would be a one-way ratchet and batteries would be a
    // sink rather than a store.
    const result = applyLedger(
      [flow({ consumes: { electricity: 300_000 } })],
      { electricity: 1_000_000 },
      { flowResources: ['electricity'], storageCapacity: { electricity: 1_000_000 } },
    )
    expect(result.stockpiles.electricity).toBe(700_000)
    expect(result.shortfalls).toEqual([])
  })

  it('should still report a shortfall when a flow resource goes negative', () => {
    // Shortfall behaviour is orthogonal to the policy: running out is running out.
    // In the real turn path a brownout makes this unreachable for electricity — the
    // allocation never lets draw exceed supply — so this is the invariant guard, and
    // it firing means the brownout upstream failed to do its job.
    const result = applyLedger(
      [flow({ produces: { electricity: 100 }, consumes: { electricity: 500 } })],
      {},
      { flowResources: ['electricity'] },
    )
    expect(result.shortfalls).toEqual([{ resource: 'electricity', amount: 400 }])
    expect(result.stockpiles.electricity).toBe(0)
    // Nothing is vented on a deficit turn — there is no surplus to vent.
    expect(result.vented).toEqual([])
  })

  it('should treat an unlisted resource as a stock that carries over freely', () => {
    // The default, and what keeps every pre-existing caller correct: mass resources
    // are stocks, and a policy that names only electricity must not change them.
    const result = applyLedger(
      [flow({ produces: { regolith: 60_000_000, electricity: 500_000 } })],
      { regolith: 1_000 },
      { flowResources: ['electricity'] },
    )
    expect(result.stockpiles.regolith).toBe(60_001_000)
    expect(result.stockpiles.electricity).toBe(0)
  })

  it('should treat every resource as a stock when no policy is given', () => {
    // Backwards compatibility, asserted: the policy argument is optional, and absent
    // means exactly the previous behaviour. 715 tests depended on that.
    const result = applyLedger([flow({ produces: { electricity: 500_000 } })])
    expect(result.stockpiles.electricity).toBe(500_000)
    expect(result.vented).toEqual([])
  })

  it('should treat an empty flowResources list as all-stocks', () => {
    const result = applyLedger([flow({ produces: { electricity: 7 } })], {}, { flowResources: [] })
    expect(result.stockpiles.electricity).toBe(7)
  })

  it('should sort vented entries by resource name', () => {
    // Same determinism discipline as `balances` and `shortfalls`: the report's order
    // must never be "whatever order the flows array happened to be in".
    const result = applyLedger(
      [flow({ produces: { zinc: 10, argon: 10, electricity: 10 } })],
      {},
      { flowResources: ['zinc', 'argon', 'electricity'] },
    )
    expect(result.vented.map((entry) => entry.resource)).toEqual(['argon', 'electricity', 'zinc'])
  })

  it('should drain a flow resource that has stale stock but lost its capacity', () => {
    // A battery destroyed between turns: the energy it was holding is no longer
    // contained, so it vents rather than lingering as an orphaned stockpile that
    // nothing can account for.
    const result = applyLedger([], { electricity: 900_000 }, { flowResources: ['electricity'] })
    expect(result.stockpiles.electricity).toBe(0)
    expect(result.vented).toEqual([{ resource: 'electricity', amount: 900_000 }])
  })

  it('should keep every reported quantity a whole base unit', () => {
    // No division is introduced by the policy — `Math.min` of two integers is an
    // integer — so the module's no-float discipline survives it.
    const result = applyLedger(
      [flow({ produces: { electricity: 1_986_389 }, consumes: { electricity: 3 } })],
      {},
      { flowResources: ['electricity'], storageCapacity: { electricity: 7 } },
    )
    expect(Number.isInteger(result.stockpiles.electricity!)).toBe(true)
    expect(Number.isInteger(result.vented[0]!.amount)).toBe(true)
  })

  it('should not mutate the caller’s policy or stockpiles', () => {
    const stockpiles: Stockpile = { electricity: 500 }
    const policy = { flowResources: ['electricity'], storageCapacity: { electricity: 100 } }
    applyLedger([], stockpiles, policy)
    expect(stockpiles).toEqual({ electricity: 500 })
    expect(policy).toEqual({ flowResources: ['electricity'], storageCapacity: { electricity: 100 } })
  })

  it('should cap a STOCK resource at declared capacity and report the overflow', () => {
    // aic-7f5 / spec 002 FR-003: production beyond the cap must be capped and REPORTED
    // as overflow, never silently discarded. A vanishing surplus is the same class of
    // bug as a stockpile silently going negative, and it will not surface until balance
    // work, by which point the numbers are already wrong.
    const result = applyLedger(
      [flow({ produces: { regolith: 60_000_000 } })],
      { regolith: 1_000_000 },
      { storageCapacity: { regolith: 5_000_000 } },
    )
    expect(result.stockpiles.regolith).toBe(5_000_000)
    expect(result.overflow).toEqual([{ resource: 'regolith', amount: 56_000_000 }])
  })

  it('should treat an ABSENT stock capacity as unbounded, unlike a flow', () => {
    // The asymmetry is physical, not a convenience. A flow cannot persist without
    // containment — energy with nowhere to go dissipates — so an absent capacity means
    // ZERO for a flow. A pile of regolith sits on the ground whether or not anyone built
    // a silo, so an absent capacity means UNBOUNDED for a stock.
    //
    // NOTE the tension, deliberately left for chain 1: spec 002 FR-003 says every
    // stockpile MUST have a cap, which implies the default should eventually be 0 rather
    // than unbounded. Flipping it is a one-line change here, but it is a BALANCE decision
    // that belongs with whoever authors the caps — today no structure declares any, so a
    // 0 default would mean the colony could not hold a single gram of anything.
    const result = applyLedger([flow({ produces: { regolith: 60_000_000 } })], {}, {})
    expect(result.stockpiles.regolith).toBe(60_000_000)
    expect(result.overflow).toEqual([])
  })

  it('should distinguish an explicit zero stock capacity from an absent one', () => {
    // Mirrors `catalog.ts`'s rule that an explicit 0 storageCapacity is a real statement
    // ("this structure handles regolith but buffers none of it"), not the same as
    // omitting the key.
    const result = applyLedger(
      [flow({ produces: { regolith: 500 } })],
      {},
      { storageCapacity: { regolith: 0 } },
    )
    expect(result.stockpiles.regolith).toBe(0)
    expect(result.overflow).toEqual([{ resource: 'regolith', amount: 500 }])
  })

  it('should report overflow separately from vented, because they are different events', () => {
    // Both are "produced, had nowhere to go", but the player's response differs — build a
    // battery versus build a silo or throttle a mine — so a cycle report must be able to
    // say which happened without the reader decoding a discriminant.
    const result = applyLedger(
      [flow({ produces: { electricity: 1_000_000, regolith: 500 } })],
      {},
      { flowResources: ['electricity'], storageCapacity: { regolith: 100 } },
    )
    expect(result.vented).toEqual([{ resource: 'electricity', amount: 1_000_000 }])
    expect(result.overflow).toEqual([{ resource: 'regolith', amount: 400 }])
  })

  it('should not report overflow when a stock fits within its capacity', () => {
    const result = applyLedger(
      [flow({ produces: { regolith: 400 } })],
      {},
      { storageCapacity: { regolith: 1_000 } },
    )
    expect(result.stockpiles.regolith).toBe(400)
    expect(result.overflow).toEqual([])
  })

  it('should let a capped stock be drawn back down and refilled', () => {
    // A cap is a ceiling, not a ratchet: a full silo must still be spendable.
    const full = applyLedger(
      [flow({ produces: { regolith: 10_000 } })],
      {},
      { storageCapacity: { regolith: 1_000 } },
    )
    expect(full.stockpiles.regolith).toBe(1_000)

    const spent = applyLedger(
      [flow({ consumes: { regolith: 600 } })],
      full.stockpiles,
      { storageCapacity: { regolith: 1_000 } },
    )
    expect(spent.stockpiles.regolith).toBe(400)
    expect(spent.overflow).toEqual([])
  })

  it('should sort overflow entries by resource name', () => {
    const result = applyLedger(
      [flow({ produces: { zinc: 10, argon: 10 } })],
      {},
      { storageCapacity: { zinc: 1, argon: 1 } },
    )
    expect(result.overflow.map((entry) => entry.resource)).toEqual(['argon', 'zinc'])
  })

  it('should keep overflow amounts whole base units', () => {
    // `Math.min` of two integers is an integer, so the cap introduces no division.
    const result = applyLedger(
      [flow({ produces: { regolith: 7 } })],
      {},
      { storageCapacity: { regolith: 3 } },
    )
    expect(Number.isInteger(result.overflow[0]!.amount)).toBe(true)
  })

  it('should not let a flow resource accumulate across many turns without capacity', () => {
    // THE ruling, over the long run — the property a single-turn test cannot show.
    // 278 turns of surplus generation must leave the stockpile at exactly zero, not
    // at 278 turns' worth of banked energy.
    let stockpiles: Stockpile = {}
    const policy = { flowResources: ['electricity'] }
    for (let turn = 0; turn < 278; turn++) {
      stockpiles = applyLedger(
        [flow({ produces: { electricity: 1_986_389 }, consumes: { electricity: 500_000 } })],
        stockpiles,
        policy,
      ).stockpiles
    }
    expect(stockpiles.electricity).toBe(0)
  })
})
