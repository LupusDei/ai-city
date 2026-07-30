import { describe, it, expect } from 'vitest'
import { createCatalog, getStructureType, listStructureTypes } from '../../src/sim/catalog'
import type { StructureTypeSpec } from '../../src/sim/catalog'

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
