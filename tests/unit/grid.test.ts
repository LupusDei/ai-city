import { describe, it, expect } from 'vitest'
import { createGrid, isInBounds, tileAt, MAX_GRID_DIMENSION } from '../../src/sim/grid'

describe('createGrid', () => {
  it('should create width*height tiles when given valid dimensions', () => {
    const grid = createGrid(4, 3)
    expect(grid.width).toBe(4)
    expect(grid.height).toBe(3)
    expect(grid.tiles).toHaveLength(12)
  })

  it('should initialise every tile as unoccupied when created', () => {
    const grid = createGrid(3, 3)
    expect(grid.tiles.every((t) => t.occupantId === null)).toBe(true)
  })

  it('should label every tile with its own coordinates in row-major order', () => {
    const grid = createGrid(3, 2)
    // Row-major: index = y * width + x. This assertion is the guard against
    // the classic row/column transposition bug.
    expect(grid.tiles.map((t) => `${t.x},${t.y}`)).toEqual([
      '0,0', '1,0', '2,0',
      '0,1', '1,1', '2,1',
    ])
  })

  it('should support a 1x1 grid as the minimum valid size', () => {
    const grid = createGrid(1, 1)
    expect(grid.tiles).toHaveLength(1)
    expect(grid.tiles[0]).toMatchObject({ x: 0, y: 0, occupantId: null })
  })

  it.each([
    ['zero width', 0, 5],
    ['zero height', 5, 0],
    ['negative width', -1, 5],
    ['negative height', 5, -1],
    ['fractional width', 2.5, 5],
    ['fractional height', 5, 2.5],
    ['NaN width', Number.NaN, 5],
    ['NaN height', 5, Number.NaN],
    ['infinite width', Number.POSITIVE_INFINITY, 5],
    ['infinite height', 5, Number.POSITIVE_INFINITY],
  ])('should reject %s', (_label, width, height) => {
    expect(() => createGrid(width, height)).toThrow(RangeError)
  })

  it('should reject dimensions above MAX_GRID_DIMENSION to prevent runaway allocation', () => {
    expect(() => createGrid(MAX_GRID_DIMENSION + 1, 1)).toThrow(RangeError)
    expect(() => createGrid(1, MAX_GRID_DIMENSION + 1)).toThrow(RangeError)
  })

  it('should accept dimensions exactly at MAX_GRID_DIMENSION', () => {
    expect(() => createGrid(MAX_GRID_DIMENSION, 1)).not.toThrow()
  })
})

describe('isInBounds', () => {
  const grid = createGrid(4, 3)

  it('should return true for a coordinate inside the grid', () => {
    expect(isInBounds(grid, { x: 2, y: 1 })).toBe(true)
  })

  it('should return true for both extreme corners', () => {
    expect(isInBounds(grid, { x: 0, y: 0 })).toBe(true)
    expect(isInBounds(grid, { x: 3, y: 2 })).toBe(true)
  })

  it('should return false one step past each edge', () => {
    // The off-by-one guard: width=4 means max valid x is 3, not 4.
    expect(isInBounds(grid, { x: 4, y: 0 })).toBe(false)
    expect(isInBounds(grid, { x: 0, y: 3 })).toBe(false)
  })

  it('should return false for negative coordinates', () => {
    expect(isInBounds(grid, { x: -1, y: 0 })).toBe(false)
    expect(isInBounds(grid, { x: 0, y: -1 })).toBe(false)
  })

  it('should return false for fractional coordinates', () => {
    // A half-tile is not a tile.
    expect(isInBounds(grid, { x: 1.5, y: 1 })).toBe(false)
  })

  it('should return false for NaN coordinates', () => {
    expect(isInBounds(grid, { x: Number.NaN, y: 1 })).toBe(false)
  })
})

describe('tileAt', () => {
  const grid = createGrid(4, 3)

  it('should return the tile whose coordinates match the request', () => {
    const tile = tileAt(grid, { x: 2, y: 1 })
    expect(tile).toMatchObject({ x: 2, y: 1 })
  })

  it('should not confuse transposed coordinates on a non-square grid', () => {
    // If width/height were swapped internally, these two would collide.
    expect(tileAt(grid, { x: 3, y: 0 })).toMatchObject({ x: 3, y: 0 })
    expect(tileAt(grid, { x: 0, y: 2 })).toMatchObject({ x: 0, y: 2 })
  })

  it('should return undefined for an out-of-bounds coordinate', () => {
    expect(tileAt(grid, { x: 4, y: 0 })).toBeUndefined()
    expect(tileAt(grid, { x: -1, y: 0 })).toBeUndefined()
  })
})
