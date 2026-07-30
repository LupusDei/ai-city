import { describe, expect, it, vi } from 'vitest'
import { createGrid } from '../../src/sim/grid'
import type { Coord, Grid } from '../../src/sim/grid'
import { elevationAt, generateTerrain } from '../../src/sim/terrain'
import {
  BUILDABILITY_WEIGHT,
  DEPOSIT_PROXIMITY_WEIGHT,
  HULL_FOOTPRINT,
  HULL_SEPARATION_PENALTY_WEIGHT,
  MIN_BUILDABLE_SCORE,
  SCORE_SCALE,
  evaluateLanding,
  resolveHullFootprint,
  scoreLandingSite,
  validateLandingSite,
} from '../../src/sim/landing'
import type { BuildabilityScorer, LandingSelection } from '../../src/sim/landing'

/**
 * Deep-clones a `Grid` for before/after mutation comparisons. Mirrors the
 * helper in placement.test.ts: `structuredClone` needs DOM/Node ambient types
 * this project's tsconfig does not pull in, and `Grid` is plain, cycle-free,
 * JSON-shaped data, so a JSON round-trip is a sufficient dependency-free clone.
 */
function cloneGrid(grid: Grid): Grid {
  return JSON.parse(JSON.stringify(grid)) as Grid
}

/** A buildability scorer that ignores its input and always returns `value`. */
function constantBuildability(value: number): BuildabilityScorer {
  return () => value
}

/** A buildability scorer that returns 0 for any footprint touching `badX`, else 1. */
function unbuildableAtX(badX: number): BuildabilityScorer {
  return (tiles) => (tiles.some((t) => t.x === badX) ? 0 : 1)
}

describe('resolveHullFootprint', () => {
  it('should resolve every HULL_FOOTPRINT offset against the anchor', () => {
    const anchor: Coord = { x: 3, y: 4 }
    const tiles = resolveHullFootprint(anchor)
    expect(tiles).toEqual(
      HULL_FOOTPRINT.map(({ dx, dy }) => ({ x: anchor.x + dx, y: anchor.y + dy })),
    )
  })

  it('should place the anchor tile itself in the resolved footprint', () => {
    const anchor: Coord = { x: 0, y: 0 }
    const tiles = resolveHullFootprint(anchor)
    expect(tiles).toContainEqual(anchor)
  })
})

describe('validateLandingSite', () => {
  const grid = createGrid(20, 20)
  const alwaysBuildable = constantBuildability(1)

  it('should accept two in-bounds, non-overlapping, buildable hulls', () => {
    const result = validateLandingSite(grid, { x: 0, y: 0 }, { x: 10, y: 10 }, alwaysBuildable)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.droneHullTiles).toEqual(resolveHullFootprint({ x: 0, y: 0 }))
    expect(result.reactorHullTiles).toEqual(resolveHullFootprint({ x: 10, y: 10 }))
  })

  it('should reject with a typed out-of-bounds reason when the drone hull footprint hangs off the edge', () => {
    const result = validateLandingSite(grid, { x: 19, y: 19 }, { x: 5, y: 5 }, alwaysBuildable)
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'out-of-bounds', hull: 'drone-hull' }),
    )
  })

  it('should reject with a typed out-of-bounds reason when the reactor hull footprint hangs off the edge', () => {
    const result = validateLandingSite(grid, { x: 5, y: 5 }, { x: 19, y: 19 }, alwaysBuildable)
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'out-of-bounds', hull: 'reactor-hull' }),
    )
  })

  it('should identify the specific offending tile, not just the anchor, for out-of-bounds', () => {
    const result = validateLandingSite(grid, { x: 19, y: 0 }, { x: 5, y: 5 }, alwaysBuildable)
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'out-of-bounds', tile: { x: 20, y: 0 } }),
    )
  })

  it('should reject overlapping hulls with a typed reason and the shared tile', () => {
    // drone anchor (0,0) occupies (0,0)(1,0)(0,1)(1,1); reactor anchor (1,1)
    // occupies (1,1)(2,1)(1,2)(2,2) -- tile (1,1) is shared.
    const result = validateLandingSite(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, alwaysBuildable)
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'overlapping-hulls', tile: { x: 1, y: 1 } }),
    )
  })

  it('should accept hulls placed edge-adjacent with no shared tile', () => {
    const result = validateLandingSite(grid, { x: 0, y: 0 }, { x: 2, y: 0 }, alwaysBuildable)
    expect(result.ok).toBe(true)
  })

  it('should reject the drone hull with a typed unbuildable reason when its footprint scores at or below MIN_BUILDABLE_SCORE', () => {
    const result = validateLandingSite(grid, { x: 3, y: 3 }, { x: 15, y: 15 }, unbuildableAtX(3))
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'unbuildable', hull: 'drone-hull' }),
    )
  })

  it('should reject the reactor hull with a typed unbuildable reason when its footprint scores at or below MIN_BUILDABLE_SCORE', () => {
    const result = validateLandingSite(grid, { x: 15, y: 15 }, { x: 3, y: 3 }, unbuildableAtX(3))
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'unbuildable', hull: 'reactor-hull' }),
    )
  })

  it('should treat a buildability score of exactly MIN_BUILDABLE_SCORE as unbuildable, not merely low', () => {
    expect(MIN_BUILDABLE_SCORE).toBe(0)
    const result = validateLandingSite(grid, { x: 5, y: 5 }, { x: 15, y: 15 }, constantBuildability(0))
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'unbuildable' }))
  })

  it('should check bounds before buildability, never calling the scorer for an out-of-bounds hull', () => {
    const scorer = vi.fn(() => 0)
    validateLandingSite(grid, { x: 19, y: 19 }, { x: 5, y: 5 }, scorer)
    expect(scorer).not.toHaveBeenCalled()
  })

  it('should check overlap before buildability', () => {
    const scorer = vi.fn(() => 0)
    const result = validateLandingSite(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, scorer)
    expect(result).toEqual(expect.objectContaining({ reason: 'overlapping-hulls' }))
    expect(scorer).not.toHaveBeenCalled()
  })

  it('should never mutate the grid it validates against', () => {
    const before = cloneGrid(grid)
    validateLandingSite(grid, { x: 0, y: 0 }, { x: 10, y: 10 }, alwaysBuildable)
    validateLandingSite(grid, { x: 19, y: 19 }, { x: 5, y: 5 }, alwaysBuildable)
    validateLandingSite(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, alwaysBuildable)
    expect(grid).toEqual(before)
  })

  it('should never throw for any ordinary invalid placement', () => {
    expect(() =>
      validateLandingSite(grid, { x: 19, y: 19 }, { x: 5, y: 5 }, alwaysBuildable),
    ).not.toThrow()
    expect(() =>
      validateLandingSite(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, alwaysBuildable),
    ).not.toThrow()
    expect(() =>
      validateLandingSite(grid, { x: 3, y: 3 }, { x: 15, y: 15 }, unbuildableAtX(3)),
    ).not.toThrow()
  })
})

describe('scoreLandingSite: buildability factor (held independent)', () => {
  const droneHullAnchor: Coord = { x: 2, y: 2 }
  const reactorHullAnchor: Coord = { x: 12, y: 12 }
  // No deposits and a fixed separation isolate the buildability term: with
  // mineralDeposits empty, depositProximity is fixed at 0 for both scenarios,
  // and the anchors (hence hullSeparationPenalty) never change either.
  const mineralDeposits: readonly Coord[] = []

  it('should rise when the injected buildability scorer reports flatter terrain', () => {
    const rough = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits,
      buildabilityScore: constantBuildability(0.2),
    })
    const flat = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits,
      buildabilityScore: constantBuildability(0.9),
    })

    expect(flat.buildability).toBeGreaterThan(rough.buildability)
    expect(flat.total).toBeGreaterThan(rough.total)
    // The other two factors must be provably unchanged, not just "probably".
    expect(flat.depositProximity).toBe(rough.depositProximity)
    expect(flat.hullSeparationPenalty).toBe(rough.hullSeparationPenalty)
  })
})

describe('scoreLandingSite: deposit proximity factor (held independent)', () => {
  const droneHullAnchor: Coord = { x: 0, y: 0 }
  const reactorHullAnchor: Coord = { x: 10, y: 0 }
  // A constant scorer fixes buildability; the anchors never move, so
  // hullSeparationPenalty is fixed too. Only deposit placement differs.
  const buildabilityScore = constantBuildability(0.5)

  it('should rise as mineral deposits move closer to the hulls', () => {
    const far = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits: [{ x: 500, y: 500 }],
      buildabilityScore,
    })
    const near = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits: [{ x: 1, y: 0 }],
      buildabilityScore,
    })

    expect(near.depositProximity).toBeGreaterThan(far.depositProximity)
    expect(near.total).toBeGreaterThan(far.total)
    expect(near.buildability).toBe(far.buildability)
    expect(near.hullSeparationPenalty).toBe(far.hullSeparationPenalty)
  })

  it('should score by the NEAREST deposit, ignoring farther ones on the same map', () => {
    const withOnlyTheNearDeposit = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits: [{ x: 1, y: 0 }],
      buildabilityScore,
    })
    const withNearAndSeveralFarDeposits = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits: [
        { x: 1, y: 0 },
        { x: 300, y: 300 },
        { x: 400, y: 1 },
      ],
      buildabilityScore,
    })

    expect(withNearAndSeveralFarDeposits.depositProximity).toBe(withOnlyTheNearDeposit.depositProximity)
  })
})

describe('scoreLandingSite: hull separation factor (held independent)', () => {
  const droneHullAnchor: Coord = { x: 0, y: 0 }
  // Zero deposits fixes depositProximity at 0 regardless of anchor position;
  // a constant scorer fixes buildability regardless of footprint tiles. Only
  // the reactor hull's distance from the drone hull differs between cases.
  const mineralDeposits: readonly Coord[] = []
  const buildabilityScore = constantBuildability(0.5)

  it('should fall as the two hulls are placed farther apart', () => {
    const close = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor: { x: 3, y: 0 },
      mineralDeposits,
      buildabilityScore,
    })
    const far = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor: { x: 100, y: 0 },
      mineralDeposits,
      buildabilityScore,
    })

    expect(far.hullSeparationPenalty).toBeGreaterThan(close.hullSeparationPenalty)
    expect(far.total).toBeLessThan(close.total)
    expect(far.buildability).toBe(close.buildability)
    expect(far.depositProximity).toBe(close.depositProximity)
  })

  it('should apply zero separation penalty for coincident anchors', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 5, y: 5 },
      reactorHullAnchor: { x: 5, y: 5 },
      mineralDeposits,
      buildabilityScore,
    })
    expect(result.hullSeparationPenalty).toBe(0)
  })
})

describe('scoreLandingSite: determinism', () => {
  it('should return an identical breakdown for identical inputs called twice', () => {
    const params = {
      droneHullAnchor: { x: 4, y: 4 },
      reactorHullAnchor: { x: 9, y: 9 },
      mineralDeposits: [{ x: 6, y: 6 }],
      buildabilityScore: constantBuildability(0.7),
    }
    expect(scoreLandingSite(params)).toEqual(scoreLandingSite(params))
  })

  it('should score identically across two independently-generated terrains from the same seed', () => {
    const width = 30
    const height = 30
    const seed = 20260729
    const droneHullAnchor: Coord = { x: 5, y: 5 }
    const reactorHullAnchor: Coord = { x: 20, y: 15 }
    const mineralDeposits: readonly Coord[] = [{ x: 12, y: 10 }]

    const terrainToBuildability = (terrain: ReturnType<typeof generateTerrain>): BuildabilityScorer => {
      return (tiles) => {
        const elevations = tiles.map((t) => elevationAt(terrain, t) ?? 0)
        const spread = Math.max(...elevations) - Math.min(...elevations)
        return 1 - spread
      }
    }

    const terrainA = generateTerrain(width, height, seed)
    const terrainB = generateTerrain(width, height, seed)

    const scoreA = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits,
      buildabilityScore: terrainToBuildability(terrainA),
    })
    const scoreB = scoreLandingSite({
      droneHullAnchor,
      reactorHullAnchor,
      mineralDeposits,
      buildabilityScore: terrainToBuildability(terrainB),
    })

    expect(scoreB).toEqual(scoreA)
  })
})

describe('scoreLandingSite: bounded and finite', () => {
  it('should be finite (never NaN or Infinity) with zero mineral deposits on the map', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 5, y: 5 },
      mineralDeposits: [],
      buildabilityScore: constantBuildability(0.5),
    })
    expect(Number.isFinite(result.total)).toBe(true)
    expect(Number.isFinite(result.depositProximity)).toBe(true)
    expect(result.depositProximity).toBe(0)
  })

  it('should clamp a NaN-returning buildability scorer to a finite total, never NaN', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 5, y: 5 },
      mineralDeposits: [{ x: 1, y: 1 }],
      buildabilityScore: constantBuildability(Number.NaN),
    })
    expect(Number.isFinite(result.total)).toBe(true)
    expect(result.buildability).toBe(0)
  })

  it('should clamp an Infinity-returning buildability scorer to a finite total, never Infinity', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 5, y: 5 },
      mineralDeposits: [{ x: 1, y: 1 }],
      buildabilityScore: constantBuildability(Number.POSITIVE_INFINITY),
    })
    expect(Number.isFinite(result.total)).toBe(true)
    expect(result.buildability).toBe(1)
  })

  it('should clamp a negative buildability scorer to zero, not a negative contribution', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 5, y: 5 },
      mineralDeposits: [{ x: 1, y: 1 }],
      buildabilityScore: constantBuildability(-50),
    })
    expect(result.buildability).toBe(0)
    expect(Number.isFinite(result.total)).toBe(true)
  })

  it('should remain finite and within [0, SCORE_SCALE] for hulls placed at extreme opposite corners of a large grid', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 499, y: 499 },
      mineralDeposits: [],
      buildabilityScore: constantBuildability(1),
    })
    expect(Number.isFinite(result.total)).toBe(true)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(SCORE_SCALE)
    expect(result.hullSeparationPenalty).toBeLessThan(1)
    expect(result.hullSeparationPenalty).toBeGreaterThan(0)
  })

  it('should keep total within [0, SCORE_SCALE] even for a maximally adversarial combination', () => {
    const result = scoreLandingSite({
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 499, y: 499 },
      mineralDeposits: [],
      buildabilityScore: constantBuildability(0),
    })
    expect(Number.isFinite(result.total)).toBe(true)
    expect(result.total).toBe(0)
  })
})

describe('named scoring weight constants', () => {
  it('should expose finite, positive, named weights (not inline magic numbers)', () => {
    for (const weight of [BUILDABILITY_WEIGHT, DEPOSIT_PROXIMITY_WEIGHT, HULL_SEPARATION_PENALTY_WEIGHT]) {
      expect(Number.isFinite(weight)).toBe(true)
      expect(weight).toBeGreaterThan(0)
    }
  })

  it('should keep the positive weights summing to at most 1, so total never needs an upper clamp', () => {
    // scoreLandingSite's docstring relies on this invariant to justify NOT
    // adding an upper clamp on `total` (which would otherwise be dead,
    // untested code given today's weights). If this ever fails, `total`'s
    // computation needs an upper clamp reinstated alongside a test that
    // actually exercises it.
    expect(BUILDABILITY_WEIGHT + DEPOSIT_PROXIMITY_WEIGHT).toBeLessThanOrEqual(1)
  })
})

describe('evaluateLanding: mission readiness', () => {
  const grid = createGrid(20, 20)
  const alwaysBuildable = constantBuildability(1)
  const mineralDeposits: readonly Coord[] = [{ x: 8, y: 8 }]

  it('should report incomplete with both hulls missing when neither anchor is set', () => {
    const selection: LandingSelection = { droneHullAnchor: null, reactorHullAnchor: null }
    const result = evaluateLanding({ grid, selection, mineralDeposits, buildabilityScore: alwaysBuildable })
    expect(result).toEqual({
      status: 'incomplete',
      missingHulls: ['drone-hull', 'reactor-hull'],
    })
  })

  it('should report incomplete with only the reactor hull missing when just the drone hull is placed', () => {
    const selection: LandingSelection = {
      droneHullAnchor: { x: 2, y: 2 },
      reactorHullAnchor: null,
    }
    const result = evaluateLanding({ grid, selection, mineralDeposits, buildabilityScore: alwaysBuildable })
    expect(result).toEqual({ status: 'incomplete', missingHulls: ['reactor-hull'] })
  })

  it('should report incomplete with only the drone hull missing when just the reactor hull is placed', () => {
    const selection: LandingSelection = {
      droneHullAnchor: null,
      reactorHullAnchor: { x: 2, y: 2 },
    }
    const result = evaluateLanding({ grid, selection, mineralDeposits, buildabilityScore: alwaysBuildable })
    expect(result).toEqual({ status: 'incomplete', missingHulls: ['drone-hull'] })
  })

  it('should never throw when reporting an incomplete mission', () => {
    const selection: LandingSelection = { droneHullAnchor: null, reactorHullAnchor: null }
    expect(() =>
      evaluateLanding({ grid, selection, mineralDeposits, buildabilityScore: alwaysBuildable }),
    ).not.toThrow()
  })

  it('should report rejected with the typed rejection when both hulls are placed but invalid', () => {
    const selection: LandingSelection = {
      droneHullAnchor: { x: 19, y: 19 },
      reactorHullAnchor: { x: 5, y: 5 },
    }
    const result = evaluateLanding({ grid, selection, mineralDeposits, buildabilityScore: alwaysBuildable })
    expect(result).toEqual({
      status: 'rejected',
      rejection: expect.objectContaining({ ok: false, reason: 'out-of-bounds', hull: 'drone-hull' }),
    })
  })

  it('should report ready with a score and breakdown when both hulls are placed and valid', () => {
    const selection: LandingSelection = {
      droneHullAnchor: { x: 2, y: 2 },
      reactorHullAnchor: { x: 12, y: 12 },
    }
    const result = evaluateLanding({ grid, selection, mineralDeposits, buildabilityScore: alwaysBuildable })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('unreachable')
    expect(result.score).toBe(result.breakdown.total)
    expect(Number.isFinite(result.score)).toBe(true)
    expect(result.droneHullTiles).toEqual(resolveHullFootprint({ x: 2, y: 2 }))
    expect(result.reactorHullTiles).toEqual(resolveHullFootprint({ x: 12, y: 12 }))
  })
})
