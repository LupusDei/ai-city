import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAP_LATITUDE_DEG,
  assertValidMapLatitude,
  generateTerrain,
  elevationAt,
} from '../../src/sim/terrain'
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

describe('map latitude', () => {
  it('should default to DEFAULT_MAP_LATITUDE_DEG when the caller omits latitude, keeping the three-argument call site valid', () => {
    const terrain = generateTerrain(8, 8, 1)
    expect(terrain.latitude).toBe(DEFAULT_MAP_LATITUDE_DEG)
  })

  it('should default to a latitude poleward enough for shallow ice to be reachable', () => {
    // The default has to be a site a player could actually run an ice chain at,
    // or the default map silently disables a whole resource chain. 40 deg is
    // Arcadia Planitia's latitude, which is exactly why real mission planning
    // keeps landing on it: far enough poleward for SWIM-mapped shallow ice, far
    // enough equatorward that insolation is still workable.
    expect(Math.abs(DEFAULT_MAP_LATITUDE_DEG)).toBeGreaterThanOrEqual(35)
    expect(Math.abs(DEFAULT_MAP_LATITUDE_DEG)).toBeLessThanOrEqual(90)
  })

  it('should carry the caller-supplied latitude verbatim, including fractional and southern (negative) values', () => {
    expect(generateTerrain(4, 4, 1, 22.5).latitude).toBe(22.5)
    expect(generateTerrain(4, 4, 1, -68.2).latitude).toBe(-68.2)
  })

  it('should accept the exact endpoints of the valid range: 0 and both poles', () => {
    expect(generateTerrain(2, 2, 1, 0).latitude).toBe(0)
    expect(generateTerrain(2, 2, 1, 90).latitude).toBe(90)
    expect(generateTerrain(2, 2, 1, -90).latitude).toBe(-90)
  })

  it.each([
    ['just past the north pole', 90.000001],
    ['just past the south pole', -90.000001],
    ['far past the north pole', 1000],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('should reject latitude %s with a RangeError', (_label, latitude) => {
    expect(() => generateTerrain(4, 4, 1, latitude)).toThrow(RangeError)
  })

  it('should leave elevation byte-identical when only latitude changes, proving latitude is carried metadata and not a noise input', () => {
    // Load-bearing design property. Latitude must retype the map's RESOURCES
    // without reshuffling its SHAPE: if latitude perturbed the heightmap, a
    // player sliding the landing latitude would get an entirely different world,
    // and the ice-versus-insolation tradeoff would become unreadable noise
    // instead of a legible choice about one axis.
    const equatorial = generateTerrain(24, 24, 4242, 0)
    const polar = generateTerrain(24, 24, 4242, 75)
    expect(equatorial.elevation).toEqual(polar.elevation)
  })

  it('should still make two terrains differing only in latitude non-deep-equal, so latitude is part of the terrain value', () => {
    const a = generateTerrain(6, 6, 9, 10)
    const b = generateTerrain(6, 6, 9, 50)
    expect(a).not.toEqual(b)
  })

  it('should keep same-seed same-latitude terrains deeply equal', () => {
    expect(generateTerrain(12, 9, 777, -41.5)).toEqual(generateTerrain(12, 9, 777, -41.5))
  })
})

describe('assertValidMapLatitude', () => {
  it('should accept every latitude inside the closed range, including the endpoints', () => {
    for (const latitude of [-90, -35, -0.5, 0, 0.5, 35, 90]) {
      expect(() => assertValidMapLatitude(latitude, 'latitude')).not.toThrow()
    }
  })

  it('should throw a RangeError naming the label it was given, so callers can tell which latitude was bad', () => {
    expect(() => assertValidMapLatitude(120, 'Terrain latitude')).toThrow(RangeError)
    expect(() => assertValidMapLatitude(120, 'Terrain latitude')).toThrow(/Terrain latitude/)
  })

  it('should reject non-finite values rather than letting NaN pass a naive range comparison', () => {
    // `NaN < -90` and `NaN > 90` are both false, so a range check written as two
    // comparisons without a finiteness guard admits NaN silently.
    expect(() => assertValidMapLatitude(Number.NaN, 'latitude')).toThrow(RangeError)
    expect(() => assertValidMapLatitude(Number.POSITIVE_INFINITY, 'latitude')).toThrow(RangeError)
  })
})
