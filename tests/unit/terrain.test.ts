import { describe, it, expect } from 'vitest'
import { generateTerrain, elevationAt } from '../../src/sim/terrain'
import { MAX_GRID_DIMENSION } from '../../src/sim/grid'

describe('generateTerrain', () => {
  it('should produce a terrain with width*height elevation entries when given valid dimensions', () => {
    const terrain = generateTerrain(5, 4, 1)
    expect(terrain.width).toBe(5)
    expect(terrain.height).toBe(4)
    expect(terrain.elevation).toHaveLength(20)
  })

  it('should produce a byte-identical terrain when regenerated with the same seed', () => {
    // The core guarantee: this is the first place nondeterminism could enter the
    // project, so identical inputs must yield deeply-equal outputs, not just
    // "close enough" ones.
    const a = generateTerrain(16, 12, 42)
    const b = generateTerrain(16, 12, 42)
    expect(a).toEqual(b)
  })

  it('should produce a byte-identical terrain across many repeated generations with the same seed', () => {
    // Guards against any hidden mutable module-level state (e.g. a PRNG singleton)
    // that would make the 3rd+ call diverge from the 1st.
    const first = generateTerrain(10, 10, 7)
    for (let i = 0; i < 5; i++) {
      expect(generateTerrain(10, 10, 7)).toEqual(first)
    }
  })

  it('should produce a different terrain when given a different seed', () => {
    const a = generateTerrain(16, 12, 1)
    const b = generateTerrain(16, 12, 2)
    expect(a).not.toEqual(b)
  })

  it('should produce a different terrain for a range of distinct seeds, not just one pair', () => {
    // A single not-equal pair could pass by fluke if the seed were ignored except
    // for one branch. Sweep several seeds and require every pairing to differ.
    const seeds = [0, 1, 2, 3, 100, 999]
    const terrains = seeds.map((seed) => generateTerrain(8, 8, seed))
    for (let i = 0; i < terrains.length; i++) {
      for (let j = i + 1; j < terrains.length; j++) {
        expect(terrains[i]).not.toEqual(terrains[j])
      }
    }
  })

  it('should produce only finite elevations within [0, 1] across every tile, not merely a sample', () => {
    const terrain = generateTerrain(37, 29, 12345)
    for (const e of terrain.elevation) {
      expect(Number.isFinite(e)).toBe(true)
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeLessThanOrEqual(1)
    }
  })

  it('should support a 1x1 terrain as the minimum valid size', () => {
    const terrain = generateTerrain(1, 1, 5)
    expect(terrain.elevation).toHaveLength(1)
    const only = terrain.elevation[0]
    expect(only).toBeDefined()
    expect(Number.isFinite(only)).toBe(true)
    expect(only).toBeGreaterThanOrEqual(0)
    expect(only).toBeLessThanOrEqual(1)
  })

  it('should be spatially coherent rather than white noise', () => {
    // White noise (independent uniform samples per tile) has an expected mean
    // absolute difference between neighbours of ~1/3 of the full [0,1] range.
    // Layered, interpolated value noise should land well below that, producing
    // recognisable landforms instead of static.
    const terrain = generateTerrain(64, 64, 2024)
    let totalDiff = 0
    let count = 0
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width - 1; x++) {
        const left = terrain.elevation[y * terrain.width + x]
        const right = terrain.elevation[y * terrain.width + x + 1]
        expect(left).toBeDefined()
        expect(right).toBeDefined()
        totalDiff += Math.abs((right as number) - (left as number))
        count++
      }
    }
    const meanAbsDiff = totalDiff / count
    expect(meanAbsDiff).toBeLessThan(0.1)
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
    expect(() => generateTerrain(width, height, 1)).toThrow(RangeError)
  })

  it('should reject dimensions above MAX_GRID_DIMENSION to prevent runaway allocation', () => {
    expect(() => generateTerrain(MAX_GRID_DIMENSION + 1, 1, 1)).toThrow(RangeError)
    expect(() => generateTerrain(1, MAX_GRID_DIMENSION + 1, 1)).toThrow(RangeError)
  })

  it('should accept dimensions exactly at MAX_GRID_DIMENSION', () => {
    // Kept to 1 in the other dimension so the test allocates ~512 tiles, not
    // MAX_GRID_DIMENSION^2 of them.
    expect(() => generateTerrain(MAX_GRID_DIMENSION, 1, 1)).not.toThrow()
  })
})

describe('elevationAt', () => {
  const terrain = generateTerrain(4, 3, 99)

  it('should return the elevation matching the raw array at an in-bounds coordinate', () => {
    const expected = terrain.elevation[1 * terrain.width + 2]
    expect(elevationAt(terrain, { x: 2, y: 1 })).toBe(expected)
  })

  it('should return the elevation for both extreme corners', () => {
    expect(elevationAt(terrain, { x: 0, y: 0 })).toBe(terrain.elevation[0])
    expect(elevationAt(terrain, { x: 3, y: 2 })).toBe(terrain.elevation[terrain.elevation.length - 1])
  })

  it('should return undefined one step past each edge', () => {
    expect(elevationAt(terrain, { x: 4, y: 0 })).toBeUndefined()
    expect(elevationAt(terrain, { x: 0, y: 3 })).toBeUndefined()
  })

  it('should return undefined for negative coordinates', () => {
    expect(elevationAt(terrain, { x: -1, y: 0 })).toBeUndefined()
    expect(elevationAt(terrain, { x: 0, y: -1 })).toBeUndefined()
  })

  it('should return undefined for fractional coordinates', () => {
    expect(elevationAt(terrain, { x: 1.5, y: 1 })).toBeUndefined()
  })

  it('should return undefined for NaN coordinates', () => {
    expect(elevationAt(terrain, { x: Number.NaN, y: 1 })).toBeUndefined()
  })
})
