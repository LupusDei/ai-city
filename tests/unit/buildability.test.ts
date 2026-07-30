import { describe, it, expect } from 'vitest'
import { generateTerrain } from '../../src/sim/terrain'
import type { Terrain } from '../../src/sim/terrain'
import {
  computeBuildability,
  buildabilityAt,
  generateDeposits,
  DEFAULT_DEPOSIT_DENSITY,
  DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT,
} from '../../src/sim/buildability'

/** Build a synthetic Terrain directly (bypassing generateTerrain's noise) for cases
 * that need an exact, hand-verifiable elevation layout. */
function makeTerrain(width: number, height: number, seed: number, elevation: number[]): Terrain {
  if (elevation.length !== width * height) {
    throw new Error('test fixture error: elevation length must equal width*height')
  }
  return { width, height, seed, elevation }
}

describe('computeBuildability', () => {
  it('should be bounded in [0, 1] with no NaN across every tile of a real generated terrain, not merely a sample', () => {
    const terrain = generateTerrain(47, 31, 12345)
    const map = computeBuildability(terrain)
    expect(map.score).toHaveLength(47 * 31)
    for (const s of map.score) {
      expect(Number.isNaN(s)).toBe(false)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  it('should assign maximum buildability (1) to every tile of a perfectly flat terrain', () => {
    const flat = makeTerrain(5, 5, 1, new Array(25).fill(0.5))
    const map = computeBuildability(flat)
    for (const s of map.score) {
      expect(s).toBe(1)
    }
  })

  it('should assign minimum buildability (0) to every tile of a maximally steep checkerboard terrain', () => {
    // Checkerboard of 0/1: every neighbour (including diagonals) of every tile
    // differs by the maximum possible elevation delta of 1, so this is the
    // steepest terrain representable in a [0,1]-normalised heightmap.
    const width = 6
    const height = 6
    const elevation = new Array<number>(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        elevation[y * width + x] = (x + y) % 2 === 0 ? 0 : 1
      }
    }
    const steep = makeTerrain(width, height, 1, elevation)
    const map = computeBuildability(steep)
    for (const s of map.score) {
      expect(s).toBe(0)
    }
  })

  it('should assign strictly higher buildability to a gentler slope than a steeper slope, proving the score tracks slope magnitude rather than being noise', () => {
    const width = 10
    const height = 3
    // Two linear ramps of identical shape, differing only in per-column step size:
    // gentle rises slowly across the map, steep rises to the elevation ceiling
    // almost immediately. Both are monotonic and noise-free, isolating slope
    // magnitude as the only variable under test.
    const gentleElevation = new Array<number>(width * height)
    const steepElevation = new Array<number>(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        gentleElevation[y * width + x] = Math.min(1, x * 0.02)
        steepElevation[y * width + x] = Math.min(1, x * 0.4)
      }
    }
    const gentle = makeTerrain(width, height, 1, gentleElevation)
    const steep = makeTerrain(width, height, 1, steepElevation)

    const gentleMap = computeBuildability(gentle)
    const steepMap = computeBuildability(steep)

    // Compare an interior column (x=2) where both ramps are still actively
    // rising (neither has saturated at the 0/1 ceiling on BOTH sides yet — the
    // steep ramp saturates by x=3, which would falsely show a slope of 0 on
    // its far side if compared further right), on the middle row.
    const index = 1 * width + 2
    const gentleScore = gentleMap.score[index] as number
    const steepScore = steepMap.score[index] as number
    expect(gentleScore).toBeGreaterThan(steepScore)
  })

  it('should compute every corner of a small terrain correctly using only its in-bounds neighbours, never reading past the edge', () => {
    // 3x3 hand-verifiable elevation grid:
    //   0.0 0.1 0.2
    //   0.3 0.4 0.5
    //   0.6 0.7 0.9
    const elevation = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9]
    const terrain = makeTerrain(3, 3, 1, elevation)
    const map = computeBuildability(terrain)

    // Top-left corner (0,0): in-bounds Moore neighbours are (1,0)=0.1, (0,1)=0.3,
    // (1,1)=0.4. Max |diff| from center 0.0 is |0.4-0.0| = 0.4 -> score 0.6.
    expect(buildabilityAt(map, { x: 0, y: 0 })).toBeCloseTo(0.6, 10)

    // Top-right corner (2,0): neighbours (1,0)=0.1, (1,1)=0.4, (2,1)=0.5.
    // Max |diff| from center 0.2 is |0.5-0.2| = 0.3 -> score 0.7.
    expect(buildabilityAt(map, { x: 2, y: 0 })).toBeCloseTo(0.7, 10)

    // Bottom-left corner (0,2): neighbours (0,1)=0.3, (1,1)=0.4, (1,2)=0.7.
    // Max |diff| from center 0.6 is |0.3-0.6| = 0.3 -> score 0.7.
    expect(buildabilityAt(map, { x: 0, y: 2 })).toBeCloseTo(0.7, 10)

    // Bottom-right corner (2,2): neighbours (1,1)=0.4, (2,1)=0.5, (1,2)=0.7.
    // Max |diff| from center 0.9 is |0.4-0.9| = 0.5 -> score 0.5.
    expect(buildabilityAt(map, { x: 2, y: 2 })).toBeCloseTo(0.5, 10)
  })

  it('should compute a non-corner edge tile correctly on a rectangular (non-square) grid', () => {
    // 4x2 grid; tile (2,0) is a top-edge, non-corner tile with 5 in-bounds
    // Moore neighbours: (1,0), (3,0), (1,1), (2,1), (3,1).
    //   0.1 0.2 0.9 0.3
    //   0.1 0.2 0.2 0.3
    const elevation = [0.1, 0.2, 0.9, 0.3, 0.1, 0.2, 0.2, 0.3]
    const terrain = makeTerrain(4, 2, 1, elevation)
    const map = computeBuildability(terrain)
    // Center 0.9; neighbours 0.2, 0.3, 0.2, 0.2, 0.3 -> max diff = |0.2-0.9| = 0.7 -> score 0.3.
    expect(buildabilityAt(map, { x: 2, y: 0 })).toBeCloseTo(0.3, 10)
  })

  it('should not crash on a degenerate 1x1 map and should treat its single tile as fully buildable (no neighbours to disagree with)', () => {
    const terrain = makeTerrain(1, 1, 1, [0.73])
    const map = computeBuildability(terrain)
    expect(map.score).toEqual([1])
  })

  it('should return undefined from buildabilityAt for coordinates outside the map, matching elevationAt/tileAt convention', () => {
    const terrain = makeTerrain(2, 2, 1, [0, 0, 0, 0])
    const map = computeBuildability(terrain)
    expect(buildabilityAt(map, { x: -1, y: 0 })).toBeUndefined()
    expect(buildabilityAt(map, { x: 0, y: -1 })).toBeUndefined()
    expect(buildabilityAt(map, { x: 2, y: 0 })).toBeUndefined()
    expect(buildabilityAt(map, { x: 0, y: 2 })).toBeUndefined()
    expect(buildabilityAt(map, { x: 1.5, y: 0 })).toBeUndefined()
  })
})

describe('generateDeposits', () => {
  it('should be reproducible: identical seed (and dimensions) produces deep-equal deposits every run', () => {
    const terrainA = generateTerrain(20, 20, 999)
    const terrainB = generateTerrain(20, 20, 999)
    const depositsA = generateDeposits(terrainA)
    const depositsB = generateDeposits(terrainB)
    expect(depositsA).toEqual(depositsB)
  })

  it('should be reproducible across many repeated calls with the same terrain, guarding against hidden mutable PRNG state', () => {
    const terrain = generateTerrain(15, 15, 42)
    const first = generateDeposits(terrain)
    for (let i = 0; i < 5; i++) {
      expect(generateDeposits(terrain)).toEqual(first)
    }
  })

  it('should produce different deposits for a different seed', () => {
    const terrainA = generateTerrain(40, 40, 1)
    const terrainB = generateTerrain(40, 40, 2)
    const depositsA = generateDeposits(terrainA)
    const depositsB = generateDeposits(terrainB)
    expect(depositsA).not.toEqual(depositsB)
  })

  it('should produce a different PRNG draw stream for a different seed even when the eligible tile set is identical', () => {
    // Hold elevation (and therefore buildability/eligibility) fixed, varying only
    // `seed`. If richness values were identical here, it would prove the deposit
    // PRNG is NOT actually keyed off terrain.seed as required.
    const elevation = new Array(10 * 10).fill(0.5)
    const terrainSeed1 = { width: 10, height: 10, seed: 1, elevation }
    const terrainSeed2 = { width: 10, height: 10, seed: 2, elevation }
    const depositsSeed1 = generateDeposits(terrainSeed1, { density: 1, minBuildability: 0 })
    const depositsSeed2 = generateDeposits(terrainSeed2, { density: 1, minBuildability: 0 })
    // Same eligible tile set (whole map, flat) -> same coordinates chosen either way.
    expect(depositsSeed1.map((d) => ({ x: d.x, y: d.y }))).toEqual(
      depositsSeed2.map((d) => ({ x: d.x, y: d.y })),
    )
    // But the richness stream itself must differ between seeds.
    expect(depositsSeed1.map((d) => d.richness)).not.toEqual(depositsSeed2.map((d) => d.richness))
  })

  it('should never place a deposit outside the grid bounds, across many seeds and dimensions', () => {
    const cases: Array<[number, number, number]> = [
      [10, 10, 1],
      [7, 13, 2],
      [1, 20, 3],
      [20, 1, 4],
      [33, 33, 5],
    ]
    for (const [width, height, seed] of cases) {
      const terrain = generateTerrain(width, height, seed)
      const deposits = generateDeposits(terrain, { density: 1 })
      expect(deposits.length).toBeGreaterThan(0)
      for (const deposit of deposits) {
        expect(deposit.x).toBeGreaterThanOrEqual(0)
        expect(deposit.x).toBeLessThan(width)
        expect(deposit.y).toBeGreaterThanOrEqual(0)
        expect(deposit.y).toBeLessThan(height)
      }
    }
  })

  it('should never place a deposit on a tile at or below the minBuildability threshold (unbuildable extremes)', () => {
    // Left half of the map is a steep checkerboard (buildability 0 everywhere
    // interior to it); right half is perfectly flat (buildability 1). With
    // density=1, every eligible (flat) tile gets a deposit and every ineligible
    // (steep) tile must not.
    const width = 10
    const height = 10
    const elevation = new Array<number>(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < width / 2) {
          elevation[y * width + x] = (x + y) % 2 === 0 ? 0 : 1
        } else {
          elevation[y * width + x] = 0.5
        }
      }
    }
    const terrain = makeTerrain(width, height, 7, elevation)
    const deposits = generateDeposits(terrain, { density: 1 })

    for (const deposit of deposits) {
      expect(deposit.x).toBeGreaterThanOrEqual(width / 2)
    }
    // And the flat half should be fully populated since density=1.
    const flatTileCount = (width / 2) * height
    expect(deposits.length).toBe(flatTileCount)
  })

  it('should place zero deposits when density is 0, regardless of seed', () => {
    const terrain = generateTerrain(10, 10, 55)
    const deposits = generateDeposits(terrain, { density: 0 })
    expect(deposits).toEqual([])
  })

  it('should place a deposit on every eligible tile when density is 1', () => {
    const terrain = makeTerrain(3, 3, 1, new Array(9).fill(0.5))
    const deposits = generateDeposits(terrain, { density: 1, minBuildability: 0 })
    expect(deposits).toHaveLength(9)
    const coords = new Set(deposits.map((d) => `${d.x},${d.y}`))
    expect(coords.size).toBe(9)
  })

  it('should not crash on a degenerate 1x1 map and should only ever place its single deposit at (0,0)', () => {
    const terrain = makeTerrain(1, 1, 1, [0.5])
    const deposits = generateDeposits(terrain, { density: 1 })
    expect(deposits.length).toBeLessThanOrEqual(1)
    for (const deposit of deposits) {
      expect(deposit).toMatchObject({ x: 0, y: 0 })
    }
  })

  it('should produce richness values bounded in [0, 1) for every deposit', () => {
    const terrain = generateTerrain(20, 20, 3)
    const deposits = generateDeposits(terrain, { density: 1 })
    for (const deposit of deposits) {
      expect(Number.isNaN(deposit.richness)).toBe(false)
      expect(deposit.richness).toBeGreaterThanOrEqual(0)
      expect(deposit.richness).toBeLessThan(1)
    }
  })

  it('should apply documented defaults when no options are passed', () => {
    expect(DEFAULT_DEPOSIT_DENSITY).toBeGreaterThan(0)
    expect(DEFAULT_DEPOSIT_DENSITY).toBeLessThanOrEqual(1)
    expect(DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT).toBeLessThanOrEqual(1)
    const terrain = generateTerrain(10, 10, 1)
    // Should not throw, and should return an array (possibly empty) using defaults.
    expect(Array.isArray(generateDeposits(terrain))).toBe(true)
  })

  it('should throw a RangeError for a density outside [0, 1]', () => {
    const terrain = generateTerrain(5, 5, 1)
    expect(() => generateDeposits(terrain, { density: -0.1 })).toThrow(RangeError)
    expect(() => generateDeposits(terrain, { density: 1.1 })).toThrow(RangeError)
  })

  it('should throw a RangeError for a minBuildability outside [0, 1]', () => {
    const terrain = generateTerrain(5, 5, 1)
    expect(() => generateDeposits(terrain, { minBuildability: -0.1 })).toThrow(RangeError)
    expect(() => generateDeposits(terrain, { minBuildability: 1.1 })).toThrow(RangeError)
  })
})
