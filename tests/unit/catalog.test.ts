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
