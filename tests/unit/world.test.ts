/**
 * Unit tests for the two adapters that close the terrain -> landing seam (aic-c1p).
 *
 * These are the pieces that were missing entirely: nothing converted a
 * `MineralDeposit[]` (x, y, richness) into the `Coord[]` that landing scoring
 * consumes, and nothing turned a `BuildabilityMap` into a `BuildabilityScorer`.
 * The seam itself is covered in tests/integration/world-seam.test.ts; here we
 * pin the adapters' edge behaviour, which integration cannot reach cleanly.
 */

import { describe, expect, it } from 'vitest'

import type { BuildabilityMap, MineralDeposit } from '../../src/sim/buildability'
import { buildabilityScorerFor, depositCoords, generateWorld } from '../../src/sim/world'

/** A hand-built map is appropriate HERE (unlike in the seam test) because the
 *  point is to pin exact aggregation behaviour at known values. */
function mapOf(width: number, height: number, score: readonly number[]): BuildabilityMap {
  return { width, height, score }
}

describe('depositCoords', () => {
  it('should strip richness and preserve order', () => {
    const deposits: readonly MineralDeposit[] = [
      { x: 3, y: 4, richness: 0.9 },
      { x: 1, y: 2, richness: 0.1 },
    ]
    expect(depositCoords(deposits)).toEqual([
      { x: 3, y: 4 },
      { x: 1, y: 2 },
    ])
  })

  it('should return an empty array for no deposits', () => {
    expect(depositCoords([])).toEqual([])
  })

  it('should not alias the input objects', () => {
    const deposits: readonly MineralDeposit[] = [{ x: 1, y: 1, richness: 0.5 }]
    const coords = depositCoords(deposits)
    // A returned object that aliased the deposit would carry `richness` along,
    // silently widening the Coord contract for every downstream consumer.
    expect(Object.keys(coords[0]!).sort()).toEqual(['x', 'y'])
    expect(coords[0]).not.toBe(deposits[0])
  })
})

describe('buildabilityScorerFor', () => {
  it('should return the MINIMUM buildability across the footprint, not the mean', () => {
    // A foundation is only as good as its worst tile. Averaging would let five
    // good tiles carry one cliff tile, and MIN_BUILDABLE_SCORE = 0 is a HARD
    // rejection in landing.ts — so min is what makes "one unbuildable tile
    // means an unbuildable footprint" fall out correctly.
    const scorer = buildabilityScorerFor(mapOf(2, 2, [1, 1, 1, 0.25]))
    expect(
      scorer([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0.25)
  })

  it('should score a single tile as that tile', () => {
    const scorer = buildabilityScorerFor(mapOf(2, 1, [0.4, 0.8]))
    expect(scorer([{ x: 1, y: 0 }])).toBe(0.8)
  })

  it('should return 0 when any footprint tile is unbuildable', () => {
    const scorer = buildabilityScorerFor(mapOf(2, 1, [0.9, 0]))
    expect(
      scorer([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toBe(0)
  })

  it('should treat an out-of-bounds footprint tile as unbuildable rather than skipping it', () => {
    // `buildabilityAt` returns undefined out of bounds. Skipping such a tile
    // would let a footprint hanging off the map score as if it were smaller and
    // entirely on good ground — the failure mode is a FALSE PASS, so it must be 0.
    const scorer = buildabilityScorerFor(mapOf(2, 1, [1, 1]))
    expect(
      scorer([
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ]),
    ).toBe(0)
  })

  it('should return 0 for an empty footprint instead of Infinity', () => {
    // A naive Math.min(...[]) returns Infinity, which would sail through the
    // `<= MIN_BUILDABLE_SCORE` check and report a nothing-footprint as buildable.
    const scorer = buildabilityScorerFor(mapOf(2, 1, [1, 1]))
    expect(scorer([])).toBe(0)
  })

  it('should be a pure function of the map it was built from', () => {
    const scorer = buildabilityScorerFor(mapOf(1, 1, [0.7]))
    const tile = [{ x: 0, y: 0 }]
    expect(scorer(tile)).toBe(scorer(tile))
  })
})

describe('generateWorld', () => {
  it('should reject non-integer or out-of-range dimensions loudly', () => {
    // Mirrors createGrid/generateTerrain: a bad dimension is a config error, not
    // player input, so it throws rather than degrading.
    expect(() => generateWorld(0, 8, 1)).toThrow(RangeError)
    expect(() => generateWorld(8, 0, 1)).toThrow(RangeError)
    expect(() => generateWorld(8.5, 8, 1)).toThrow(RangeError)
  })

  it('should honour deposit options', () => {
    const none = generateWorld(16, 16, 7, { density: 0 })
    expect(none.deposits).toEqual([])
  })

  it('should place every deposit inside the terrain bounds', () => {
    const world = generateWorld(24, 24, 99, { density: 1, minBuildability: 0 })
    for (const deposit of world.deposits) {
      expect(deposit.x).toBeGreaterThanOrEqual(0)
      expect(deposit.y).toBeGreaterThanOrEqual(0)
      expect(deposit.x).toBeLessThan(24)
      expect(deposit.y).toBeLessThan(24)
    }
  })
})
