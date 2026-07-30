import { describe, it, expect } from 'vitest'
import { createGrid } from '../../src/sim/grid'
import type { Grid } from '../../src/sim/grid'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType, StructureTypeSpec } from '../../src/sim/catalog'
import {
  resolveFootprint,
  validatePlacement,
  applyPlacement,
} from '../../src/sim/placement'
import type { ValidPlacement } from '../../src/sim/placement'

/**
 * Deep-clones a `Grid` for before/after mutation comparisons.
 *
 * `structuredClone` would need DOM/Node ambient types this project's
 * `tsconfig` (lib: ES2022 only, no @types/node) doesn't pull in. `Grid` is
 * plain, cycle-free JSON-shaped data, so round-tripping through JSON is a
 * simple, dependency-free deep clone that needs no extra typings.
 */
function cloneGrid(grid: Grid): Grid {
  return JSON.parse(JSON.stringify(grid)) as Grid
}

/**
 * Builds a validated StructureType via the real catalog boundary rather than
 * hand-rolling one, so test fixtures exercise the same validation path
 * production code does (per the "real output shapes, not just type
 * definitions" testing rule).
 */
function structureType(overrides: Partial<StructureTypeSpec> = {}): StructureType {
  const id = overrides.id ?? 'test-structure'
  const spec: StructureTypeSpec = {
    id,
    name: 'Test Structure',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 1,
    produces: {},
    consumes: {},
    habitatCapacity: 0,
    ...overrides,
  }
  const catalog = createCatalog([spec])
  const type = getStructureType(catalog, id)
  if (type === undefined) {
    // Test-setup invariant, not a player-facing failure path — throwing here
    // surfaces a broken fixture immediately rather than a confusing assertion.
    throw new Error(`test setup failed: structure "${id}" not found in fixture catalog`)
  }
  return type
}

const domino = () =>
  structureType({
    id: 'domino',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
  })

const lShape = () =>
  structureType({
    id: 'l-shape',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
    ],
  })

const centred = () =>
  structureType({
    id: 'centred',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ],
  })

describe('resolveFootprint', () => {
  it('should resolve a single-tile footprint to the anchor itself', () => {
    const type = structureType()
    expect(resolveFootprint(type, { x: 3, y: 2 })).toEqual([{ x: 3, y: 2 }])
  })

  it('should resolve a multi-tile footprint to every offset added to the anchor', () => {
    const type = domino()
    expect(resolveFootprint(type, { x: 2, y: 1 })).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ])
  })

  it('should resolve an L-shaped footprint to its three distinct absolute tiles', () => {
    const type = lShape()
    expect(resolveFootprint(type, { x: 1, y: 1 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ])
  })

  it('should resolve negative offsets to tiles on either side of the anchor', () => {
    const type = centred()
    expect(resolveFootprint(type, { x: 5, y: 5 })).toEqual([
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 6, y: 5 },
    ])
  })
})

describe('validatePlacement — success', () => {
  it('should accept a single-tile placement fully inside the grid', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, structureType(), { x: 1, y: 1 })
    expect(result).toEqual({ ok: true, tiles: [{ x: 1, y: 1 }] })
  })

  it('should return ALL footprint tiles, not just the anchor, on success', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, domino(), { x: 1, y: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tiles).toEqual([
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ])
    }
  })

  it('should accept a footprint that exactly touches the far edge without exceeding it', () => {
    const grid = createGrid(4, 3)
    // domino at x=2..3, width=4 -> max valid x is 3. Exact fit, not an overhang.
    const result = validatePlacement(grid, domino(), { x: 2, y: 0 })
    expect(result.ok).toBe(true)
  })

  it('should accept an L-shaped footprint fully inside the grid', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, lShape(), { x: 0, y: 0 })
    expect(result).toEqual({
      ok: true,
      tiles: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    })
  })

  it('should accept a negative-offset footprint when every resolved tile stays in bounds', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, centred(), { x: 1, y: 1 })
    expect(result).toEqual({
      ok: true,
      tiles: [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 2, y: 1 },
      ],
    })
  })
})

describe('validatePlacement — out of bounds', () => {
  it('should reject when the anchor itself is off the grid', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, structureType(), { x: 4, y: 0 })
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', tile: { x: 4, y: 0 } })
  })

  it('should reject when a NON-anchor footprint tile hangs off the right edge', () => {
    const grid = createGrid(4, 3)
    // Anchor (3,0) is valid; the domino's second tile (4,0) is not.
    const result = validatePlacement(grid, domino(), { x: 3, y: 0 })
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', tile: { x: 4, y: 0 } })
  })

  it('should reject when a NON-anchor footprint tile hangs off the bottom edge', () => {
    const grid = createGrid(4, 3)
    const type = structureType({
      id: 'vertical-domino',
      footprint: [
        { dx: 0, dy: 0 },
        { dx: 0, dy: 1 },
      ],
    })
    const result = validatePlacement(grid, type, { x: 0, y: 2 })
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', tile: { x: 0, y: 3 } })
  })

  it('should reject a negative-offset footprint whose resolved tile goes off the left edge', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, centred(), { x: 0, y: 0 })
    expect(result).toEqual({ ok: false, reason: 'out-of-bounds', tile: { x: -1, y: 0 } })
  })

  it('should carry the distinct typed reason "out-of-bounds"', () => {
    const grid = createGrid(4, 3)
    const result = validatePlacement(grid, structureType(), { x: 10, y: 10 })
    if (result.ok) throw new Error('expected rejection')
    // Narrowing on `reason` is the whole point of the discriminated union.
    expect(result.reason).toBe('out-of-bounds')
  })

  it('should leave grid state completely unmutated after an out-of-bounds rejection', () => {
    const grid = createGrid(4, 3)
    const before = cloneGrid(grid)
    validatePlacement(grid, domino(), { x: 3, y: 0 })
    expect(grid).toEqual(before)
  })
})

describe('validatePlacement — occupied', () => {
  it('should reject when the anchor tile is already occupied', () => {
    const empty = createGrid(4, 3)
    const first = validatePlacement(empty, structureType(), { x: 1, y: 1 })
    if (!first.ok) throw new Error('fixture setup failed')
    const occupiedGrid = applyPlacement(empty, 'structure-a', first)

    const result = validatePlacement(occupiedGrid, structureType(), { x: 1, y: 1 })
    expect(result).toEqual({
      ok: false,
      reason: 'occupied',
      tile: { x: 1, y: 1 },
      occupantId: 'structure-a',
    })
  })

  it('should reject a PARTIAL overlap where the anchor is free but another footprint tile is occupied', () => {
    // This is the highest-value case: a naive implementation that only checks
    // the anchor tile would wrongly accept this placement.
    const empty = createGrid(4, 3)
    const first = validatePlacement(empty, structureType(), { x: 2, y: 0 })
    if (!first.ok) throw new Error('fixture setup failed')
    const occupiedGrid = applyPlacement(empty, 'structure-a', first)

    // L-shape anchored at (1,0): tiles (1,0) free, (2,0) OCCUPIED, (1,1) free.
    const result = validatePlacement(occupiedGrid, lShape(), { x: 1, y: 0 })
    expect(result).toEqual({
      ok: false,
      reason: 'occupied',
      tile: { x: 2, y: 0 },
      occupantId: 'structure-a',
    })
  })

  it('should carry the distinct typed reason "occupied"', () => {
    const empty = createGrid(4, 3)
    const first = validatePlacement(empty, structureType(), { x: 0, y: 0 })
    if (!first.ok) throw new Error('fixture setup failed')
    const occupiedGrid = applyPlacement(empty, 'structure-a', first)

    const result = validatePlacement(occupiedGrid, structureType(), { x: 0, y: 0 })
    if (result.ok) throw new Error('expected rejection')
    expect(result.reason).toBe('occupied')
  })

  it('should leave grid state completely unmutated after an occupied rejection', () => {
    const empty = createGrid(4, 3)
    const first = validatePlacement(empty, structureType(), { x: 2, y: 0 })
    if (!first.ok) throw new Error('fixture setup failed')
    const occupiedGrid = applyPlacement(empty, 'structure-a', first)
    const before = cloneGrid(occupiedGrid)

    validatePlacement(occupiedGrid, lShape(), { x: 1, y: 0 })

    expect(occupiedGrid).toEqual(before)
  })
})

describe('applyPlacement', () => {
  function place(grid: Grid, id: string, type: StructureType, anchor: { x: number; y: number }) {
    const result = validatePlacement(grid, type, anchor)
    if (!result.ok) throw new Error('fixture setup failed: expected a valid placement')
    return { grid: applyPlacement(grid, id, result), placement: result as ValidPlacement }
  }

  it('should occupy every footprint tile, not just the anchor', () => {
    const grid = createGrid(4, 3)
    const { grid: next } = place(grid, 'structure-a', domino(), { x: 1, y: 1 })

    expect(next.tiles.find((t) => t.x === 1 && t.y === 1)?.occupantId).toBe('structure-a')
    expect(next.tiles.find((t) => t.x === 2 && t.y === 1)?.occupantId).toBe('structure-a')
  })

  it('should leave tiles outside the footprint unoccupied', () => {
    const grid = createGrid(4, 3)
    const { grid: next } = place(grid, 'structure-a', domino(), { x: 1, y: 1 })

    const untouched = next.tiles.filter((t) => !(t.x === 1 && t.y === 1) && !(t.x === 2 && t.y === 1))
    expect(untouched.every((t) => t.occupantId === null)).toBe(true)
  })

  it('should occupy exactly the tiles of an L-shaped footprint and no others', () => {
    const grid = createGrid(4, 3)
    const { grid: next } = place(grid, 'structure-a', lShape(), { x: 0, y: 0 })

    const occupiedCoords = next.tiles.filter((t) => t.occupantId !== null).map((t) => `${t.x},${t.y}`)
    expect(occupiedCoords.sort()).toEqual(['0,0', '0,1', '1,0'])
  })

  it('should occupy the correct tiles for a negative-offset footprint', () => {
    const grid = createGrid(4, 3)
    const { grid: next } = place(grid, 'structure-a', centred(), { x: 1, y: 1 })

    const occupiedCoords = next.tiles.filter((t) => t.occupantId !== null).map((t) => `${t.x},${t.y}`)
    expect(occupiedCoords.sort()).toEqual(['0,1', '1,1', '2,1'])
  })

  it('should return a NEW grid object distinct from the input', () => {
    const grid = createGrid(4, 3)
    const { grid: next } = place(grid, 'structure-a', structureType(), { x: 0, y: 0 })
    expect(next).not.toBe(grid)
    expect(next.tiles).not.toBe(grid.tiles)
  })

  it('should NOT mutate the original grid', () => {
    const grid = createGrid(4, 3)
    const before = cloneGrid(grid)
    place(grid, 'structure-a', domino(), { x: 1, y: 1 })
    expect(grid).toEqual(before)
  })

  it('should preserve grid width and height in the returned grid', () => {
    const grid = createGrid(4, 3)
    const { grid: next } = place(grid, 'structure-a', structureType(), { x: 0, y: 0 })
    expect(next.width).toBe(4)
    expect(next.height).toBe(3)
  })

  it('should allow a second placement to occupy remaining free tiles after the first', () => {
    const grid = createGrid(4, 3)
    const { grid: afterFirst } = place(grid, 'structure-a', domino(), { x: 0, y: 0 })
    const { grid: afterSecond } = place(afterFirst, 'structure-b', domino(), { x: 2, y: 0 })

    expect(afterSecond.tiles.find((t) => t.x === 0 && t.y === 0)?.occupantId).toBe('structure-a')
    expect(afterSecond.tiles.find((t) => t.x === 2 && t.y === 0)?.occupantId).toBe('structure-b')
  })
})
