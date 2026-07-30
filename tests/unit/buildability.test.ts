import { describe, it, expect } from 'vitest'
import { DEFAULT_MAP_LATITUDE_DEG, generateTerrain } from '../../src/sim/terrain'
import type { Terrain } from '../../src/sim/terrain'
import {
  computeBuildability,
  buildabilityAt,
  eligibleDepositKinds,
  generateDeposits,
  DEFAULT_DEPOSIT_DENSITY,
  DEFAULT_DEPOSIT_KINDS,
  DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT,
  ICE_MIN_ABS_LATITUDE_DEG,
} from '../../src/sim/buildability'
import type { DepositKindSpec } from '../../src/sim/buildability'

/** Build a synthetic Terrain directly (bypassing generateTerrain's noise) for cases
 * that need an exact, hand-verifiable elevation layout.
 *
 * `latitude` defaults to {@link DEFAULT_MAP_LATITUDE_DEG} so the many existing
 * cases here that do not care about latitude stay unchanged; the deposit-kind
 * cases below pass it explicitly. */
function makeTerrain(
  width: number,
  height: number,
  seed: number,
  elevation: number[],
  latitude: number = DEFAULT_MAP_LATITUDE_DEG,
): Terrain {
  if (elevation.length !== width * height) {
    throw new Error('test fixture error: elevation length must equal width*height')
  }
  return { width, height, seed, latitude, elevation }
}

/** A flat terrain: every tile maximally buildable, so eligibility never confounds
 * a test that is actually about deposit KIND. */
function flatTerrain(size: number, seed: number, latitude: number): Terrain {
  // `new Array(n).fill(v)` is typed `any[]`, which would let a wrong element type
  // (e.g. fill('0.5')) reach makeTerrain's `number[]` unchallenged. Explicit here.
  return makeTerrain(size, size, seed, new Array<number>(size * size).fill(0.5), latitude)
}

/** Every distinct kind present in a deposit list, as a sorted array for stable
 * comparison (the deposits themselves are ordered row-major, not by kind). */
function kindsPresent(deposits: readonly { kind: string }[]): string[] {
  return [...new Set(deposits.map((d) => d.kind))].sort()
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
    const flat = makeTerrain(5, 5, 1, new Array<number>(25).fill(0.5))
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
    const latitude = DEFAULT_MAP_LATITUDE_DEG
    const terrainSeed1 = { width: 10, height: 10, seed: 1, latitude, elevation }
    const terrainSeed2 = { width: 10, height: 10, seed: 2, latitude, elevation }
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
    const terrain = makeTerrain(3, 3, 1, new Array<number>(9).fill(0.5))
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

// ---------------------------------------------------------------------------
// Deposit kinds and the latitude gate
// ---------------------------------------------------------------------------

describe('DEFAULT_DEPOSIT_KINDS', () => {
  it('should register silica with no latitude gate, because Mars soil is silicate everywhere', () => {
    const silica = DEFAULT_DEPOSIT_KINDS.find((k) => k.kind === 'silica')
    expect(silica).toBeDefined()
    // Undefined or 0 both mean "no poleward requirement"; either is acceptable.
    expect(silica?.minAbsLatitudeDeg ?? 0).toBe(0)
  })

  it('should gate ice poleward of the documented shallow-ice latitude', () => {
    const ice = DEFAULT_DEPOSIT_KINDS.find((k) => k.kind === 'ice')
    expect(ice).toBeDefined()
    expect(ice?.minAbsLatitudeDeg).toBe(ICE_MIN_ABS_LATITUDE_DEG)
  })

  it('should place the ice threshold in the 35-40 degree band the SWIM/Odyssey mapping supports', () => {
    expect(ICE_MIN_ABS_LATITUDE_DEG).toBeGreaterThanOrEqual(35)
    expect(ICE_MIN_ABS_LATITUDE_DEG).toBeLessThanOrEqual(40)
  })
})

describe('eligibleDepositKinds', () => {
  it('should return only silica at the equator, because shallow ice is not accessible there', () => {
    // Curiosity's equatorial soil measurements found only ~2 wt% water; there is
    // no minable shallow ice at Gale-crater latitudes.
    expect(eligibleDepositKinds(0).map((k) => k.kind)).toEqual(['silica'])
  })

  it('should return both silica and ice at a poleward latitude', () => {
    expect(eligibleDepositKinds(60).map((k) => k.kind)).toEqual(['silica', 'ice'])
  })

  it('should include ice at EXACTLY the threshold latitude, in both hemispheres (inclusive boundary)', () => {
    expect(eligibleDepositKinds(ICE_MIN_ABS_LATITUDE_DEG).map((k) => k.kind)).toContain('ice')
    expect(eligibleDepositKinds(-ICE_MIN_ABS_LATITUDE_DEG).map((k) => k.kind)).toContain('ice')
  })

  it('should exclude ice one hair equatorward of the threshold, in both hemispheres', () => {
    const justInside = ICE_MIN_ABS_LATITUDE_DEG - 0.001
    expect(eligibleDepositKinds(justInside).map((k) => k.kind)).not.toContain('ice')
    expect(eligibleDepositKinds(-justInside).map((k) => k.kind)).not.toContain('ice')
  })

  it('should include ice at both poles', () => {
    expect(eligibleDepositKinds(90).map((k) => k.kind)).toContain('ice')
    expect(eligibleDepositKinds(-90).map((k) => k.kind)).toContain('ice')
  })

  it('should treat southern latitudes exactly like their northern mirror, since the gate is on absolute latitude', () => {
    expect(eligibleDepositKinds(-58)).toEqual(eligibleDepositKinds(58))
  })

  it('should preserve the declaration order of the supplied kinds, since that order feeds the deterministic weighted pick', () => {
    const kinds: readonly DepositKindSpec[] = [
      { kind: 'gamma', weight: 1 },
      { kind: 'alpha', weight: 1 },
      { kind: 'beta', weight: 1 },
    ]
    expect(eligibleDepositKinds(0, kinds).map((k) => k.kind)).toEqual(['gamma', 'alpha', 'beta'])
  })

  it('should return an empty list when every registered kind is gated poleward of the given latitude', () => {
    const kinds: readonly DepositKindSpec[] = [{ kind: 'ice', weight: 1, minAbsLatitudeDeg: 35 }]
    expect(eligibleDepositKinds(0, kinds)).toEqual([])
  })

  it('should register an INVENTED deposit kind with zero source changes, proving kind is an open key and not a closed union', () => {
    // The whole point of the open-string-key convention borrowed from catalog.ts:
    // a new resource must be addable as DATA. None of these three kinds is
    // mentioned anywhere in src/.
    const invented: readonly DepositKindSpec[] = [
      { kind: 'unobtanium', weight: 3 },
      { kind: 'perchlorate', weight: 1, minAbsLatitudeDeg: 10 },
      { kind: 'nitrogen-clathrate', weight: 1, minAbsLatitudeDeg: 80 },
    ]
    expect(eligibleDepositKinds(0, invented).map((k) => k.kind)).toEqual(['unobtanium'])
    expect(eligibleDepositKinds(45, invented).map((k) => k.kind)).toEqual([
      'unobtanium',
      'perchlorate',
    ])
    expect(eligibleDepositKinds(85, invented).map((k) => k.kind)).toEqual([
      'unobtanium',
      'perchlorate',
      'nitrogen-clathrate',
    ])
  })

  it.each([
    ['above the north pole', 90.5],
    ['below the south pole', -90.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('should throw a RangeError for a latitude %s', (_label, latitude) => {
    expect(() => eligibleDepositKinds(latitude)).toThrow(RangeError)
  })

  it('should throw a RangeError for an empty deposit kind key', () => {
    expect(() => eligibleDepositKinds(0, [{ kind: '', weight: 1 }])).toThrow(RangeError)
  })

  it('should throw a RangeError for a duplicate deposit kind key, which would make the weighting silently ambiguous', () => {
    expect(() =>
      eligibleDepositKinds(0, [
        { kind: 'silica', weight: 1 },
        { kind: 'silica', weight: 2 },
      ]),
    ).toThrow(RangeError)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('should throw a RangeError for a %s weight', (_label, weight) => {
    expect(() => eligibleDepositKinds(0, [{ kind: 'silica', weight }])).toThrow(RangeError)
  })

  it.each([
    ['negative', -1],
    ['beyond the pole', 91],
    ['NaN', Number.NaN],
  ])('should throw a RangeError for a %s minAbsLatitudeDeg', (_label, minAbsLatitudeDeg) => {
    expect(() =>
      eligibleDepositKinds(0, [{ kind: 'silica', weight: 1, minAbsLatitudeDeg }]),
    ).toThrow(RangeError)
  })

  it('should throw a RangeError for an empty kinds registry, which is a caller mistake rather than a map with no resources', () => {
    expect(() => eligibleDepositKinds(0, [])).toThrow(RangeError)
  })
})

describe('generateDeposits: typed deposits', () => {
  it('should give every deposit a non-empty kind drawn from the eligible registry', () => {
    const deposits = generateDeposits(flatTerrain(12, 5, 60), { density: 1, minBuildability: 0 })
    expect(deposits.length).toBe(144)
    for (const deposit of deposits) {
      expect(typeof deposit.kind).toBe('string')
      expect(deposit.kind.length).toBeGreaterThan(0)
      expect(['silica', 'ice']).toContain(deposit.kind)
    }
  })

  it('should never scatter ice on an equatorial map', () => {
    const deposits = generateDeposits(flatTerrain(24, 11, 0), { density: 1, minBuildability: 0 })
    expect(deposits.length).toBeGreaterThan(0)
    expect(kindsPresent(deposits)).toEqual(['silica'])
  })

  it('should scatter both silica and ice on a poleward map', () => {
    const deposits = generateDeposits(flatTerrain(24, 11, 68), { density: 1, minBuildability: 0 })
    // 68 deg N is Phoenix's landing latitude, where it struck buried ice within
    // centimetres of the surface in 2008.
    expect(kindsPresent(deposits)).toEqual(['ice', 'silica'])
  })

  it('should scatter ice at EXACTLY the threshold latitude but not one hair equatorward of it', () => {
    const options = { density: 1, minBuildability: 0 }
    const atThreshold = generateDeposits(
      flatTerrain(24, 11, ICE_MIN_ABS_LATITUDE_DEG),
      options,
    )
    const justEquatorward = generateDeposits(
      flatTerrain(24, 11, ICE_MIN_ABS_LATITUDE_DEG - 0.001),
      options,
    )
    expect(kindsPresent(atThreshold)).toContain('ice')
    expect(kindsPresent(justEquatorward)).not.toContain('ice')
  })

  it('should scatter ice on a far-southern map, since the gate is on absolute latitude', () => {
    const deposits = generateDeposits(flatTerrain(24, 11, -72), { density: 1, minBuildability: 0 })
    expect(kindsPresent(deposits)).toContain('ice')
  })

  it('should scatter identically at both poles', () => {
    const north = generateDeposits(flatTerrain(16, 3, 90), { density: 1, minBuildability: 0 })
    const south = generateDeposits(flatTerrain(16, 3, -90), { density: 1, minBuildability: 0 })
    expect(north).toEqual(south)
  })

  it('should reproduce byte-identical typed deposits for the same seed AND the same latitude', () => {
    const a = generateDeposits(generateTerrain(20, 20, 999, 52.5))
    const b = generateDeposits(generateTerrain(20, 20, 999, 52.5))
    expect(a).toEqual(b)
    // Guard against hidden mutable PRNG state across repeated calls.
    for (let i = 0; i < 5; i++) {
      expect(generateDeposits(generateTerrain(20, 20, 999, 52.5))).toEqual(a)
    }
  })

  it('should retype the map when latitude changes without moving a single deposit or altering its richness', () => {
    // The design property that makes the ice-versus-insolation tradeoff legible:
    // latitude selects WHICH resource a deposit is, never WHERE deposits are.
    // Implementation consequence — the kind draw must be consumed even when only
    // one kind is eligible, or the richness stream would shift with latitude.
    const options = { density: 0.5, minBuildability: 0 }
    const equatorial = generateDeposits(flatTerrain(30, 31337, 0), options)
    const polar = generateDeposits(flatTerrain(30, 31337, 70), options)

    expect(equatorial.map((d) => ({ x: d.x, y: d.y, richness: d.richness }))).toEqual(
      polar.map((d) => ({ x: d.x, y: d.y, richness: d.richness })),
    )
    // ...but the kinds must actually differ, or the gate is doing nothing.
    expect(equatorial.map((d) => d.kind)).not.toEqual(polar.map((d) => d.kind))
  })

  it('should produce different typed deposits for a different seed at the same latitude', () => {
    const a = generateDeposits(generateTerrain(40, 40, 1, 60))
    const b = generateDeposits(generateTerrain(40, 40, 2, 60))
    expect(a).not.toEqual(b)
  })

  it('should default to DEFAULT_DEPOSIT_KINDS when the caller supplies no registry', () => {
    const deposits = generateDeposits(flatTerrain(20, 8, 60), { density: 1, minBuildability: 0 })
    const registered = DEFAULT_DEPOSIT_KINDS.map((k) => k.kind)
    for (const deposit of deposits) {
      expect(registered).toContain(deposit.kind)
    }
  })

  it('should scatter an INVENTED deposit kind with zero source changes', () => {
    const deposits = generateDeposits(flatTerrain(10, 4, 20), {
      density: 1,
      minBuildability: 0,
      kinds: [{ kind: 'unobtanium', weight: 1 }],
    })
    expect(deposits.length).toBe(100)
    expect(kindsPresent(deposits)).toEqual(['unobtanium'])
  })

  it('should honour relative weights so a heavily-weighted kind dominates a lightly-weighted one', () => {
    // Not an exact-ratio assertion (that would be a brittle test of the PRNG's
    // distribution rather than of the weighting code); a 9:1 weighting on 900
    // tiles only has to come out lopsided in the right direction.
    const deposits = generateDeposits(flatTerrain(30, 12, 60), {
      density: 1,
      minBuildability: 0,
      kinds: [
        { kind: 'common', weight: 9 },
        { kind: 'rare', weight: 1 },
      ],
    })
    const common = deposits.filter((d) => d.kind === 'common').length
    const rare = deposits.filter((d) => d.kind === 'rare').length
    expect(common).toBeGreaterThan(rare * 3)
    expect(rare).toBeGreaterThan(0)
  })

  it('should return no deposits at all when no registered kind can occur at this latitude', () => {
    // A legitimate simulation outcome, not an error: a map whose only resource is
    // poleward ice, sited at the equator, genuinely has nothing to mine.
    const deposits = generateDeposits(flatTerrain(10, 4, 0), {
      density: 1,
      minBuildability: 0,
      kinds: [{ kind: 'ice', weight: 1, minAbsLatitudeDeg: 35 }],
    })
    expect(deposits).toEqual([])
  })

  it('should place zero deposits when density is 0 even though kinds are eligible', () => {
    expect(generateDeposits(flatTerrain(10, 55, 60), { density: 0 })).toEqual([])
  })

  it('should never scatter a deposit whose kind is gated poleward of the map latitude, across many seeds', () => {
    for (let seed = 0; seed < 25; seed++) {
      const deposits = generateDeposits(flatTerrain(8, seed, 20), {
        density: 1,
        minBuildability: 0,
      })
      for (const deposit of deposits) {
        expect(deposit.kind).toBe('silica')
      }
    }
  })

  it.each([
    ['beyond the north pole', 120],
    ['beyond the south pole', -120],
    ['NaN', Number.NaN],
    ['infinite', Number.NEGATIVE_INFINITY],
  ])(
    'should throw a RangeError when the terrain carries a latitude %s, validating at the generation boundary',
    (_label, latitude) => {
      // A hand-built Terrain can carry anything, so `generateDeposits` re-checks
      // rather than trusting `generateTerrain` to have been the only producer.
      const terrain = { width: 4, height: 4, seed: 1, latitude, elevation: new Array(16).fill(0.5) }
      expect(() => generateDeposits(terrain)).toThrow(RangeError)
    },
  )

  it('should throw a RangeError for a malformed kinds registry, at the same boundary as density and minBuildability', () => {
    const terrain = flatTerrain(4, 1, 60)
    expect(() => generateDeposits(terrain, { kinds: [] })).toThrow(RangeError)
    expect(() => generateDeposits(terrain, { kinds: [{ kind: '', weight: 1 }] })).toThrow(RangeError)
    expect(() => generateDeposits(terrain, { kinds: [{ kind: 'x', weight: 0 }] })).toThrow(RangeError)
  })
})
