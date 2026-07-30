import { describe, it, expect } from 'vitest'
import { createCatalog, getStructureType, listStructureTypes } from '../../src/sim/catalog'
import type { StructureTypeSpec } from '../../src/sim/catalog'
// Read-only, for the cross-module check that `siting.requiresDeposit` accepts every
// kind the deposit generator can actually emit. Deposits are only non-decorative if
// the two open key spaces line up.
import { DEFAULT_DEPOSIT_KINDS } from '../../src/sim/buildability'

/** A minimal valid spec; individual tests override just the field under test. */
function spec(overrides: Partial<StructureTypeSpec> = {}): StructureTypeSpec {
  return {
    id: 'habitat-module',
    name: 'Habitat Module',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 10,
    produces: {},
    consumes: { electricity: 5 },
    habitatCapacity: 4,
    ...overrides,
  }
}

describe('createCatalog', () => {
  it('should expose a structure type by id when given a valid spec', () => {
    const catalog = createCatalog([spec()])
    expect(getStructureType(catalog, 'habitat-module')).toMatchObject({
      id: 'habitat-module',
      buildTurns: 10,
      habitatCapacity: 4,
    })
  })

  it('should return undefined for an id that is not in the catalog', () => {
    const catalog = createCatalog([spec()])
    expect(getStructureType(catalog, 'no-such-structure')).toBeUndefined()
  })

  it('should preserve declaration order when listing types', () => {
    // Iteration order is load-bearing: the sim must never depend on
    // nondeterministic key ordering.
    const catalog = createCatalog([
      spec({ id: 'a' }),
      spec({ id: 'b' }),
      spec({ id: 'c' }),
    ])
    expect(listStructureTypes(catalog).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('should accept an empty catalog', () => {
    expect(listStructureTypes(createCatalog([]))).toEqual([])
  })

  it('should reject duplicate structure ids', () => {
    expect(() => createCatalog([spec({ id: 'dup' }), spec({ id: 'dup' })])).toThrow(
      /duplicate/i,
    )
  })
})

describe('createCatalog — footprints', () => {
  it('should accept a multi-tile rectangular footprint', () => {
    const catalog = createCatalog([
      spec({
        id: 'reactor',
        footprint: [
          { dx: 0, dy: 0 },
          { dx: 1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 1, dy: 1 },
        ],
      }),
    ])
    expect(getStructureType(catalog, 'reactor')?.footprint).toHaveLength(4)
  })

  it('should accept a non-rectangular (L-shaped) footprint', () => {
    // The General specified "larger, more complex shapes" — not just rectangles.
    const catalog = createCatalog([
      spec({
        id: 'l-shape',
        footprint: [
          { dx: 0, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 1, dy: 1 },
        ],
      }),
    ])
    expect(getStructureType(catalog, 'l-shape')?.footprint).toHaveLength(3)
  })

  it('should accept a footprint with negative offsets around the anchor', () => {
    const catalog = createCatalog([
      spec({
        id: 'centred',
        footprint: [
          { dx: 0, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 1, dy: 0 },
        ],
      }),
    ])
    expect(getStructureType(catalog, 'centred')?.footprint).toHaveLength(3)
  })

  it('should reject an empty footprint', () => {
    expect(() => createCatalog([spec({ footprint: [] })])).toThrow(/footprint/i)
  })

  it('should reject a footprint that omits the anchor offset (0,0)', () => {
    // Placement anchors at (0,0); a footprint not covering it would let a
    // structure be placed on a tile it does not actually occupy.
    expect(() => createCatalog([spec({ footprint: [{ dx: 1, dy: 0 }] })])).toThrow(
      /anchor/i,
    )
  })

  it('should reject duplicate offsets within a footprint', () => {
    // A duplicate would double-count tiles and corrupt occupancy accounting.
    expect(() =>
      createCatalog([
        spec({
          footprint: [
            { dx: 0, dy: 0 },
            { dx: 0, dy: 0 },
          ],
        }),
      ]),
    ).toThrow(/duplicate/i)
  })

  it.each([
    ['fractional', 0.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('should reject a %s footprint offset', (_label, bad) => {
    expect(() =>
      createCatalog([
        spec({
          footprint: [
            { dx: 0, dy: 0 },
            { dx: bad, dy: 0 },
          ],
        }),
      ]),
    ).toThrow(RangeError)
  })
})

describe('createCatalog — scalar field validation', () => {
  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('should reject %s buildTurns', (_label, bad) => {
    expect(() => createCatalog([spec({ buildTurns: bad })])).toThrow(RangeError)
  })

  it('should accept buildTurns of 0 to represent a pre-placed structure', () => {
    // The landed starships are not built by drones — they arrive complete.
    expect(() => createCatalog([spec({ id: 'landed-ship', buildTurns: 0 })])).not.toThrow()
  })

  it.each([
    ['negative', -1],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
  ])('should reject %s habitatCapacity', (_label, bad) => {
    expect(() => createCatalog([spec({ habitatCapacity: bad })])).toThrow(RangeError)
  })

  it('should reject an empty structure id', () => {
    expect(() => createCatalog([spec({ id: '' })])).toThrow(/id/i)
  })
})

describe('createCatalog — resource maps', () => {
  it.each([
    ['negative', -5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('should reject a %s resource amount', (_label, bad) => {
    expect(() => createCatalog([spec({ consumes: { electricity: bad } })])).toThrow(
      RangeError,
    )
  })

  it('should reject an empty resource key', () => {
    expect(() => createCatalog([spec({ produces: { '': 5 } })])).toThrow(/resource/i)
  })

  it('should allow a structure to both produce and consume resources', () => {
    const catalog = createCatalog([
      spec({ id: 'refinery', produces: { oxygen: 3 }, consumes: { electricity: 8 } }),
    ])
    expect(getStructureType(catalog, 'refinery')).toMatchObject({
      produces: { oxygen: 3 },
      consumes: { electricity: 8 },
    })
  })

  it('should accept a brand-new resource kind with no code change', () => {
    // This is the data-driven acceptance criterion for the whole epic: silica,
    // oxygen, hydrogen, carbon and metals must drop in as DATA later. If this
    // test ever needs a source edit to pass, the design has regressed.
    const catalog = createCatalog([
      spec({
        id: 'future-refinery',
        produces: { silica: 2, hydrogen: 1, unobtainium: 7 },
        consumes: { electricity: 12, carbon: 3 },
      }),
    ])
    expect(getStructureType(catalog, 'future-refinery')?.produces).toEqual({
      silica: 2,
      hydrogen: 1,
      unobtainium: 7,
    })
  })
})

describe('createCatalog — integer base units (Wh / grams)', () => {
  // WHY these tests exist: `time.ts` argues that integer arithmetic is
  // non-negotiable PROJECT-WIDE for determinism (constitution §1) — "a colony sim
  // that cannot replay identically from the same seed is not a colony sim, it is a
  // slot machine." The clock obeys that in integer seconds; the resource ledger
  // must obey it in integer base units (watt-hours for energy, grams for mass).
  // Float amounts make sums order-dependent, which bites the moment a brownout
  // priority order over consumers exists and a power margin hinges on 119.99999
  // vs 120.

  it.each([
    ['a half', 0.5],
    ['one and a half', 1.5],
    ['a tenth', 0.1],
    ['a float that is almost an integer', 119.99999],
    ['a repeating fraction', 1 / 3],
  ])('should reject %s as a resource amount', (_label, fractional) => {
    expect(() => createCatalog([spec({ consumes: { electricity: fractional } })])).toThrow(
      RangeError,
    )
  })

  it('should reject a fractional amount in produces, not only in consumes', () => {
    expect(() => createCatalog([spec({ produces: { oxygen: 2.5 } })])).toThrow(RangeError)
  })

  it('should accept an amount of exactly 0', () => {
    // 0 is a meaningful authored value ("this structure explicitly has no draw"),
    // distinct from omitting the key, so it must stay legal.
    const catalog = createCatalog([spec({ consumes: { electricity: 0 } })])
    expect(getStructureType(catalog, 'habitat-module')?.consumes).toEqual({ electricity: 0 })
  })

  it('should accept an amount of 1 (the smallest positive base unit)', () => {
    // One watt-hour / one gram is the quantum of the ledger: there is deliberately
    // no way to express "half a watt-hour".
    const catalog = createCatalog([spec({ produces: { electricity: 1 } })])
    expect(getStructureType(catalog, 'habitat-module')?.produces).toEqual({ electricity: 1 })
  })

  it('should accept a large integer amount, as base units require', () => {
    // Base units make everyday figures large: a 5 kW draw over a 25 h shift is
    // 125_000 Wh, and a 300 kg hopper is 300_000 g. Nothing about the guard may
    // penalise realistic magnitudes.
    const catalog = createCatalog([
      spec({ consumes: { electricity: 125_000 }, produces: { silica: 300_000 } }),
    ])
    expect(getStructureType(catalog, 'habitat-module')).toMatchObject({
      consumes: { electricity: 125_000 },
      produces: { silica: 300_000 },
    })
  })

  it('should accept an amount at Number.MAX_SAFE_INTEGER', () => {
    // The exactness ceiling of the double-based ledger. Physically absurd (9
    // petawatt-hours), but it is the documented boundary of exact integer
    // arithmetic, so the guard must not reject inside its own valid range.
    const catalog = createCatalog([
      spec({ produces: { electricity: Number.MAX_SAFE_INTEGER } }),
    ])
    expect(getStructureType(catalog, 'habitat-module')?.produces).toEqual({
      electricity: Number.MAX_SAFE_INTEGER,
    })
  })

  it.each([
    ['-1', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('should reject %s as a resource amount', (_label, bad) => {
    expect(() => createCatalog([spec({ consumes: { electricity: bad } })])).toThrow(RangeError)
  })

  it('NEGATIVE CONTROL: the integer guard demonstrably fires on a fractional amount', () => {
    // A guard nobody has watched fail is a guard you cannot trust (the coverage
    // gate on this project was proven the same way). This test does not merely
    // assert "something threw": it captures the error, checks it is a RangeError,
    // checks the message names the offending field AND value, and then proves the
    // fraction was the SOLE cause by re-running the identical spec with the value
    // rounded to a whole base unit and requiring success.
    const fractionalSpec = spec({ id: 'brownout-victim', consumes: { electricity: 119.99999 } })

    let captured: unknown
    try {
      createCatalog([fractionalSpec])
    } catch (error) {
      captured = error
    }

    expect(captured).toBeInstanceOf(RangeError)
    expect((captured as RangeError).message).toContain('brownout-victim')
    expect((captured as RangeError).message).toContain('consumes.electricity')
    expect((captured as RangeError).message).toMatch(/integer/i)
    expect((captured as RangeError).message).toContain('119.99999')

    // Same structure, same field, whole base units: accepted. So the guard fired
    // on the fraction and nothing else.
    expect(() =>
      createCatalog([spec({ id: 'brownout-victim', consumes: { electricity: 120 } })]),
    ).not.toThrow()
  })

  it('should still accept brand-new invented resource kinds, provided they are whole base units', () => {
    // The resource-agnostic property is load-bearing for every planned resource
    // chain, so the integer rule must be enforced WITHOUT closing the open key
    // space. New kinds still drop in as pure data.
    const catalog = createCatalog([
      spec({
        id: 'invented-chain',
        produces: { unobtainium: 41, plasteel: 1, spice: 0 },
        consumes: { electricity: 250_000, deuterium: 7 },
      }),
    ])
    expect(getStructureType(catalog, 'invented-chain')?.produces).toEqual({
      unobtainium: 41,
      plasteel: 1,
      spice: 0,
    })
  })

  it('should reject a fractional amount on an invented resource kind too', () => {
    // The rule is a property of the ledger, not a whitelist of known resources.
    expect(() =>
      createCatalog([spec({ produces: { unobtainium: 0.25 } })]),
    ).toThrow(RangeError)
  })
})

describe('catalog immutability', () => {
  it('should not be affected by later mutation of the caller’s input array', () => {
    // Defensive copy: a catalog that aliases caller data can be corrupted after load.
    const specs = [spec({ id: 'a' })]
    const catalog = createCatalog(specs)
    specs.push(spec({ id: 'b' }))
    expect(listStructureTypes(catalog).map((t) => t.id)).toEqual(['a'])
  })

  it('should not be affected by later mutation of a spec’s footprint array', () => {
    const footprint = [{ dx: 0, dy: 0 }]
    const catalog = createCatalog([spec({ id: 'a', footprint })])
    footprint.push({ dx: 5, dy: 5 })
    expect(getStructureType(catalog, 'a')?.footprint).toHaveLength(1)
  })
})

describe('createCatalog — buildCost (ONE-TIME bill of materials)', () => {
  // WHY these tests exist: before `buildCost`, `consumes` was the only resource
  // debit a structure could express, and it is a PER-TURN operating draw. There was
  // nowhere to record "this Photovoltaic Array costs 20 kg of silicon to BUILD", so
  // a production chain's output could never be spent on anything — the chain was
  // just a number that goes up. These tests pin the one-time/per-turn distinction
  // hard, because confusing the two is the bug this field would otherwise cause.

  it('should preserve a populated buildCost bill of materials', () => {
    // The real first caller: a PV Array costs 20 kg of silicon, i.e. 20_000 g.
    const catalog = createCatalog([spec({ id: 'pv-array', buildCost: { silicon: 20_000 } })])
    expect(getStructureType(catalog, 'pv-array')?.buildCost).toEqual({ silicon: 20_000 })
  })

  it('should preserve a multi-resource buildCost', () => {
    // The second real caller: a Shield Berm costs 450 t of regolith plus 7.5 t of
    // sintered plate. Base units make these large; nothing may penalise that.
    const catalog = createCatalog([
      spec({
        id: 'shield-berm',
        buildCost: { regolith: 450_000_000, sinteredPlate: 7_500_000 },
      }),
    ])
    expect(getStructureType(catalog, 'shield-berm')?.buildCost).toEqual({
      regolith: 450_000_000,
      sinteredPlate: 7_500_000,
    })
  })

  it('should treat an ABSENT buildCost as an empty bill of materials', () => {
    // The common case by far: most MVP structures cost nothing to build. Authors
    // must not be forced to write `buildCost: {}` on every entry, and consumers
    // must not be forced to write `?? {}` at every read site — so the validated
    // type always carries the field even when the spec omitted it.
    const catalog = createCatalog([spec({ id: 'free-to-build' })])
    expect(getStructureType(catalog, 'free-to-build')?.buildCost).toEqual({})
  })

  it('should accept an EMPTY buildCost, indistinguishable from an absent one', () => {
    // Absent and `{}` mean the same thing ("free"), so they must normalise to the
    // same value. Two spellings of "free" that behaved differently would be a trap.
    const explicit = createCatalog([spec({ id: 'x', buildCost: {} })])
    const implicit = createCatalog([spec({ id: 'x' })])
    expect(getStructureType(explicit, 'x')?.buildCost).toEqual(
      getStructureType(implicit, 'x')?.buildCost,
    )
  })

  it('should accept a buildCost line item of exactly 0', () => {
    // Mirrors the existing rule for produces/consumes: 0 is a meaningful authored
    // value ("this bill explicitly lists silicon, and it is free").
    const catalog = createCatalog([spec({ id: 'x', buildCost: { silicon: 0 } })])
    expect(getStructureType(catalog, 'x')?.buildCost).toEqual({ silicon: 0 })
  })

  it('should accept a brand-new invented resource kind in buildCost with no code change', () => {
    // The resource-agnostic property is load-bearing for all three chains. It must
    // hold for the NEW fields exactly as it already holds for produces/consumes.
    const catalog = createCatalog([
      spec({ id: 'invented', buildCost: { unobtainium: 3, plasteel: 12_000, spice: 1 } }),
    ])
    expect(getStructureType(catalog, 'invented')?.buildCost).toEqual({
      unobtainium: 3,
      plasteel: 12_000,
      spice: 1,
    })
  })

  it('should accept a buildCost at the documented exactness ceiling', () => {
    const catalog = createCatalog([
      spec({ id: 'x', buildCost: { regolith: Number.MAX_SAFE_INTEGER } }),
    ])
    expect(getStructureType(catalog, 'x')?.buildCost).toEqual({
      regolith: Number.MAX_SAFE_INTEGER,
    })
  })

  it.each([
    ['negative', -1],
    ['fractional', 0.5],
    ['one and a half', 1.5],
    ['a repeating fraction', 1 / 3],
    ['a float that is almost an integer', 119.99999],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('should reject %s in buildCost', (_label, bad) => {
    expect(() => createCatalog([spec({ buildCost: { silicon: bad } })])).toThrow(RangeError)
  })

  it('should reject an empty resource key in buildCost', () => {
    expect(() => createCatalog([spec({ buildCost: { '': 5 } })])).toThrow(/resource/i)
  })

  it('should reject a fractional amount on an invented resource kind in buildCost too', () => {
    // The integer rule is a property of amounts, never a whitelist of resources.
    expect(() => createCatalog([spec({ buildCost: { unobtainium: 0.25 } })])).toThrow(RangeError)
  })

  it('NEGATIVE CONTROL: the buildCost guard demonstrably fires, naming field and value', () => {
    // A guard nobody has watched fail is a guard you cannot trust. Capture the
    // error, assert its type, assert the message names the offending field PATH and
    // VALUE, then prove the fraction was the SOLE cause by re-running with a whole
    // base unit and requiring success.
    let captured: unknown
    try {
      createCatalog([spec({ id: 'pv-array', buildCost: { silicon: 20_000.5 } })])
    } catch (error) {
      captured = error
    }

    expect(captured).toBeInstanceOf(RangeError)
    expect((captured as RangeError).message).toContain('pv-array')
    expect((captured as RangeError).message).toContain('buildCost.silicon')
    expect((captured as RangeError).message).toMatch(/integer/i)
    expect((captured as RangeError).message).toContain('20000.5')

    expect(() =>
      createCatalog([spec({ id: 'pv-array', buildCost: { silicon: 20_000 } })]),
    ).not.toThrow()
  })

  it('should keep buildCost and consumes completely independent for the same resource', () => {
    // THE distinction test. A Sinter Plant costs 5 kg of silicon ONCE to build and
    // draws 40 kg of regolith EVERY TURN to operate. Same units, same structure,
    // totally different semantics. If these two maps ever share storage, alias each
    // other, or get merged, this test fails — which is exactly what it is for.
    const catalog = createCatalog([
      spec({
        id: 'sinter-plant',
        buildCost: { silicon: 5_000, regolith: 1 },
        consumes: { regolith: 40_000, electricity: 90_000 },
      }),
    ])
    const type = getStructureType(catalog, 'sinter-plant')
    expect(type?.buildCost).toEqual({ silicon: 5_000, regolith: 1 })
    expect(type?.consumes).toEqual({ regolith: 40_000, electricity: 90_000 })
  })

  it('should let a structure be expensive to build yet free to run, and vice versa', () => {
    // The two ends of the distinction, stated as data: a passive Shield Berm has a
    // huge bill of materials and zero upkeep; a Relay has no bill at all and a
    // permanent draw. Neither is expressible without separating the two fields.
    const catalog = createCatalog([
      spec({ id: 'berm', buildCost: { regolith: 450_000_000 }, consumes: {} }),
      spec({ id: 'relay', buildCost: {}, consumes: { electricity: 4_000 } }),
    ])
    expect(getStructureType(catalog, 'berm')).toMatchObject({
      buildCost: { regolith: 450_000_000 },
      consumes: {},
    })
    expect(getStructureType(catalog, 'relay')).toMatchObject({
      buildCost: {},
      consumes: { electricity: 4_000 },
    })
  })
})

describe('createCatalog — siting.requiresDeposit', () => {
  // WHY these tests exist: without a siting requirement, mineral deposits are
  // decoration and the survey screen's deposit-proximity score is a lie — nothing
  // in the game could ever require a specific deposit under a specific structure.
  // NOTE: this file validates the FIELD only. The placement-time check ("is there
  // actually a silica deposit under this anchor?") belongs to the chain beads;
  // catalog.ts deliberately knows nothing about grids or deposits.

  it('should preserve a requiresDeposit siting requirement', () => {
    const catalog = createCatalog([
      spec({ id: 'silica-sifter', siting: { requiresDeposit: 'silica' } }),
    ])
    expect(getStructureType(catalog, 'silica-sifter')?.siting.requiresDeposit).toBe('silica')
  })

  it('should treat an ABSENT siting block as no siting requirement', () => {
    // The overwhelmingly common case: a habitat can go anywhere buildable. Authors
    // must not be forced to declare an empty siting block on every entry.
    const catalog = createCatalog([spec({ id: 'anywhere' })])
    expect(getStructureType(catalog, 'anywhere')?.siting).toEqual({})
    expect(getStructureType(catalog, 'anywhere')?.siting.requiresDeposit).toBeUndefined()
  })

  it('should accept an empty siting block as no siting requirement', () => {
    const catalog = createCatalog([spec({ id: 'anywhere', siting: {} })])
    expect(getStructureType(catalog, 'anywhere')?.siting.requiresDeposit).toBeUndefined()
  })

  it('should accept an invented deposit kind, keeping the kind key space open', () => {
    // `MineralDeposit.kind` is an open string key, never a closed union, so
    // `requiresDeposit` must be too — otherwise adding a deposit kind as data would
    // still need a source edit here, the exact coupling both files exist to avoid.
    const catalog = createCatalog([
      spec({ id: 'xenon-rig', siting: { requiresDeposit: 'xenon-vein' } }),
    ])
    expect(getStructureType(catalog, 'xenon-rig')?.siting.requiresDeposit).toBe('xenon-vein')
  })

  it('should accept every kind in the default deposit registry as a requiresDeposit value', () => {
    // Cross-module check that the two key spaces genuinely line up: anything
    // `eligibleDepositKinds` can emit must be sitable against. Deposits stop being
    // decoration only if this holds.
    for (const { kind } of DEFAULT_DEPOSIT_KINDS) {
      const catalog = createCatalog([spec({ id: kind, siting: { requiresDeposit: kind } })])
      expect(getStructureType(catalog, kind)?.siting.requiresDeposit).toBe(kind)
    }
  })

  it('should reject an empty requiresDeposit string', () => {
    // An empty kind can never match any deposit, so it is an authoring defect that
    // would otherwise present as "this structure can never be placed, and nobody
    // can say why".
    expect(() => createCatalog([spec({ siting: { requiresDeposit: '' } })])).toThrow(RangeError)
  })

  it('NEGATIVE CONTROL: the requiresDeposit guard demonstrably fires, naming field and value', () => {
    let captured: unknown
    try {
      createCatalog([spec({ id: 'ice-well', siting: { requiresDeposit: '' } })])
    } catch (error) {
      captured = error
    }

    expect(captured).toBeInstanceOf(RangeError)
    expect((captured as RangeError).message).toContain('ice-well')
    expect((captured as RangeError).message).toContain('siting.requiresDeposit')
    expect((captured as RangeError).message).toMatch(/non-empty string/i)
    // The offending value itself, quoted so an empty string is actually visible.
    expect((captured as RangeError).message).toContain('""')

    // Same structure, same field, one non-empty value: accepted. So the empty
    // string was the sole cause.
    expect(() =>
      createCatalog([spec({ id: 'ice-well', siting: { requiresDeposit: 'ice' } })]),
    ).not.toThrow()
  })
})

describe('createCatalog — storageCapacity (stockpile cap)', () => {
  // WHY these tests exist: unbounded accumulation removes every logistics decision
  // from the game — with infinite storage there is never a reason to build a
  // hopper, throttle a mine, or prioritise a haul. The cap has to be authored data
  // on the structure that provides it.

  it('should preserve a populated storageCapacity', () => {
    const catalog = createCatalog([
      spec({ id: 'regolith-hopper', storageCapacity: { regolith: 300_000 } }),
    ])
    expect(getStructureType(catalog, 'regolith-hopper')?.storageCapacity).toEqual({
      regolith: 300_000,
    })
  })

  it('should preserve a multi-resource storageCapacity', () => {
    const catalog = createCatalog([
      spec({
        id: 'depot',
        storageCapacity: { regolith: 1_000_000, silicon: 40_000, electricity: 125_000 },
      }),
    ])
    expect(getStructureType(catalog, 'depot')?.storageCapacity).toEqual({
      regolith: 1_000_000,
      silicon: 40_000,
      electricity: 125_000,
    })
  })

  it('should treat an ABSENT storageCapacity as storing nothing', () => {
    const catalog = createCatalog([spec({ id: 'stores-nothing' })])
    expect(getStructureType(catalog, 'stores-nothing')?.storageCapacity).toEqual({})
  })

  it('should accept an empty storageCapacity as storing nothing', () => {
    const explicit = createCatalog([spec({ id: 'x', storageCapacity: {} })])
    const implicit = createCatalog([spec({ id: 'x' })])
    expect(getStructureType(explicit, 'x')?.storageCapacity).toEqual(
      getStructureType(implicit, 'x')?.storageCapacity,
    )
  })

  it('should accept a storageCapacity of exactly 0', () => {
    // An explicit zero cap is meaningfully different from omitting the key: it says
    // "this structure handles regolith but buffers none of it", which a
    // just-in-time hauling rule needs to be able to state.
    const catalog = createCatalog([spec({ id: 'x', storageCapacity: { regolith: 0 } })])
    expect(getStructureType(catalog, 'x')?.storageCapacity).toEqual({ regolith: 0 })
  })

  it('should accept a brand-new invented resource kind in storageCapacity', () => {
    const catalog = createCatalog([
      spec({ id: 'invented-silo', storageCapacity: { unobtainium: 1, spice: 2_000_000 } }),
    ])
    expect(getStructureType(catalog, 'invented-silo')?.storageCapacity).toEqual({
      unobtainium: 1,
      spice: 2_000_000,
    })
  })

  it('should accept a storageCapacity at the documented exactness ceiling', () => {
    const catalog = createCatalog([
      spec({ id: 'x', storageCapacity: { electricity: Number.MAX_SAFE_INTEGER } }),
    ])
    expect(getStructureType(catalog, 'x')?.storageCapacity).toEqual({
      electricity: Number.MAX_SAFE_INTEGER,
    })
  })

  it.each([
    ['negative', -1],
    ['fractional', 0.5],
    ['one and a half', 1.5],
    ['a repeating fraction', 1 / 3],
    ['a float that is almost an integer', 119.99999],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('should reject %s in storageCapacity', (_label, bad) => {
    expect(() => createCatalog([spec({ storageCapacity: { regolith: bad } })])).toThrow(
      RangeError,
    )
  })

  it('should reject an empty resource key in storageCapacity', () => {
    expect(() => createCatalog([spec({ storageCapacity: { '': 5 } })])).toThrow(/resource/i)
  })

  it('should reject a fractional amount on an invented resource kind in storageCapacity too', () => {
    expect(() => createCatalog([spec({ storageCapacity: { unobtainium: 0.25 } })])).toThrow(
      RangeError,
    )
  })

  it('NEGATIVE CONTROL: the storageCapacity guard demonstrably fires, naming field and value', () => {
    let captured: unknown
    try {
      createCatalog([spec({ id: 'hopper', storageCapacity: { regolith: 300_000.25 } })])
    } catch (error) {
      captured = error
    }

    expect(captured).toBeInstanceOf(RangeError)
    expect((captured as RangeError).message).toContain('hopper')
    expect((captured as RangeError).message).toContain('storageCapacity.regolith')
    expect((captured as RangeError).message).toMatch(/integer/i)
    expect((captured as RangeError).message).toContain('300000.25')

    expect(() =>
      createCatalog([spec({ id: 'hopper', storageCapacity: { regolith: 300_000 } })]),
    ).not.toThrow()
  })

  it('should keep storageCapacity independent of produces and consumes', () => {
    // A cap is not a flow. A silo that stores 1 t of regolith produces and consumes
    // nothing; a mine that produces regolith may buffer none of it. Both must be
    // expressible without one field leaking into another.
    const catalog = createCatalog([
      spec({ id: 'silo', produces: {}, consumes: {}, storageCapacity: { regolith: 1_000_000 } }),
      spec({ id: 'mine', produces: { regolith: 500_000 }, consumes: {}, storageCapacity: {} }),
    ])
    expect(getStructureType(catalog, 'silo')).toMatchObject({
      produces: {},
      consumes: {},
      storageCapacity: { regolith: 1_000_000 },
    })
    expect(getStructureType(catalog, 'mine')).toMatchObject({
      produces: { regolith: 500_000 },
      storageCapacity: {},
    })
  })
})

describe('catalog immutability — defensive copies of resource maps', () => {
  // WHY: `validateAndFreeze` deep-copies every mutable member because a catalog
  // that ALIASES caller-owned objects can be corrupted after it has already been
  // validated — the copy is the only thing making "validated once, trusted forever"
  // true. Until now that was tested for the footprint array and the specs array but
  // NOT for the resource maps, so the guarantee was half-proven. Each test below
  // mutates the caller's object after `createCatalog` and requires the catalog to be
  // unaffected.

  it('should not be affected by later mutation of the caller’s buildCost object', () => {
    const buildCost: Record<string, number> = { silicon: 20_000 }
    const catalog = createCatalog([spec({ id: 'pv-array', buildCost })])

    buildCost.silicon = 1
    buildCost.unobtainium = 999
    delete buildCost.silicon

    expect(getStructureType(catalog, 'pv-array')?.buildCost).toEqual({ silicon: 20_000 })
  })

  it('should not be affected by later mutation of the caller’s storageCapacity object', () => {
    const storageCapacity: Record<string, number> = { regolith: 300_000 }
    const catalog = createCatalog([spec({ id: 'hopper', storageCapacity })])

    storageCapacity.regolith = 0
    storageCapacity.spice = 7

    expect(getStructureType(catalog, 'hopper')?.storageCapacity).toEqual({ regolith: 300_000 })
  })

  it('should not be affected by later mutation of the caller’s siting object', () => {
    const siting: { requiresDeposit?: string } = { requiresDeposit: 'silica' }
    const catalog = createCatalog([spec({ id: 'sifter', siting })])

    siting.requiresDeposit = 'ice'

    expect(getStructureType(catalog, 'sifter')?.siting.requiresDeposit).toBe('silica')
  })

  it('should not be affected by later mutation of the caller’s produces object', () => {
    // Pre-existing field, previously untested for aliasing. Same guarantee.
    const produces: Record<string, number> = { oxygen: 300_000 }
    const catalog = createCatalog([spec({ id: 'sabatier', produces })])

    produces.oxygen = 1
    produces.unobtainium = 5

    expect(getStructureType(catalog, 'sabatier')?.produces).toEqual({ oxygen: 300_000 })
  })

  it('should not be affected by later mutation of the caller’s consumes object', () => {
    const consumes: Record<string, number> = { electricity: 125_000 }
    const catalog = createCatalog([spec({ id: 'smelter', consumes })])

    consumes.electricity = 0

    expect(getStructureType(catalog, 'smelter')?.consumes).toEqual({ electricity: 125_000 })
  })

  it('should not alias one caller object shared across two catalog entries', () => {
    // The sharpest form of the aliasing bug: one authored map reused for two
    // structures. If either entry aliases it, mutating it corrupts both at once —
    // and it would corrupt them with a value that could never have passed validation.
    const shared: Record<string, number> = { silicon: 20_000 }
    const catalog = createCatalog([
      spec({ id: 'a', buildCost: shared }),
      spec({ id: 'b', buildCost: shared }),
    ])

    shared.silicon = -1

    expect(getStructureType(catalog, 'a')?.buildCost).toEqual({ silicon: 20_000 })
    expect(getStructureType(catalog, 'b')?.buildCost).toEqual({ silicon: 20_000 })
  })
})

describe('createCatalog — a full three-stage chain from data alone', () => {
  it('should register extract → refine → consume with entirely invented resources', () => {
    // The epic's acceptance criterion, restated over the THREE NEW FIELDS: a
    // complete chain — a sited extractor, a refiner, and a terminal consumer — must
    // be expressible as pure catalog data with zero source changes, using resource
    // kinds and a deposit kind that appear nowhere in src/. If this test ever needs
    // a source edit to pass, the data-driven design has regressed and all three
    // planned chains are in trouble.
    const catalog = createCatalog([
      {
        id: 'xenon-extractor',
        name: 'Xenon Extractor',
        footprint: [
          { dx: 0, dy: 0 },
          { dx: 1, dy: 0 },
        ],
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
        buildCost: { plasteel: 30_000, unobtainium: 4 },
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

    expect(listStructureTypes(catalog).map((t) => t.id)).toEqual([
      'xenon-extractor',
      'xenon-refinery',
      'plasteel-barracks',
    ])

    // Stage 1 is SITED on an invented deposit kind and buffers its own output.
    expect(getStructureType(catalog, 'xenon-extractor')).toMatchObject({
      siting: { requiresDeposit: 'xenon-vein' },
      buildCost: { plasteel: 12_000 },
      storageCapacity: { xenonOre: 2_000_000 },
    })
    // Stage 2 consumes stage 1's output and is paid for in stage 2's OWN product —
    // the bootstrapping case that only becomes expressible once buildCost is
    // separate from consumes.
    expect(getStructureType(catalog, 'xenon-refinery')).toMatchObject({
      buildCost: { plasteel: 30_000, unobtainium: 4 },
      consumes: { xenonOre: 500_000, electricity: 90_000 },
    })
    // Stage 3 is the terminal consumer, siting-free and storage-free: the defaults
    // must make the common case require no ceremony at all.
    expect(getStructureType(catalog, 'plasteel-barracks')).toMatchObject({
      buildCost: { plasteel: 5_000 },
      siting: {},
      storageCapacity: {},
    })
  })
})
