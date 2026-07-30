/**
 * Integration test for the terrain -> buildability -> deposits -> landing seam.
 *
 * WHY THIS FILE EXISTS (aic-c1p): `generateDeposits` and `scoreLandingSite` both
 * shipped with 100% unit coverage and passing tests, and were never connected to
 * each other. `generateDeposits` had exactly one caller — its own unit test — and
 * `landing.ts` never imported `buildability.ts` at all. Deposit proximity carries
 * 35% of the site score, so a third of the player's opening decision was driven by
 * data that no production code produced.
 *
 * A unit test on either side of a missing seam passes. That is the whole point:
 * this class of defect is structurally invisible to unit tests, because no unit
 * owns the join. So the join gets an integration test, and it asserts against
 * PRODUCTION-GENERATED data — never a hand-written deposit fixture, because a
 * fixture is exactly what let the gap hide.
 */

import { describe, expect, it } from 'vitest'

import { generateDeposits } from '../../src/sim/buildability'
import { createGrid } from '../../src/sim/grid'
import type { Coord } from '../../src/sim/grid'
import {
  evaluateLanding,
  resolveHullFootprint,
  scoreLandingSite,
  validateLandingSite,
} from '../../src/sim/landing'
import { buildabilityScorerFor, depositCoords, generateWorld } from '../../src/sim/world'

const WIDTH = 32
const HEIGHT = 32
const SEED = 20260730

/**
 * Find the first two hull anchors that form a legal landing on `world`.
 *
 * Deliberately discovered by asking the real validator rather than hardcoding
 * coordinates: hardcoded anchors would silently stop being valid the moment
 * terrain generation changed, and the test would then be asserting about a
 * rejected landing while still passing its other expectations.
 */
function findLegalAnchors(
  world: ReturnType<typeof generateWorld>,
): { drone: Coord; reactor: Coord } | null {
  const scorer = buildabilityScorerFor(world.buildability)
  const candidates: Coord[] = []
  for (let y = 0; y < world.terrain.height; y += 1) {
    for (let x = 0; x < world.terrain.width; x += 1) {
      const tiles = resolveHullFootprint({ x, y })
      if (tiles.every((t) => t.x < world.terrain.width && t.y < world.terrain.height)) {
        if (scorer(tiles) > 0) candidates.push({ x, y })
      }
    }
  }
  for (const drone of candidates) {
    for (const reactor of candidates) {
      // NOTE: validateLandingSite takes POSITIONAL arguments, while its siblings
      // scoreLandingSite and evaluateLanding take params objects. Passing an object
      // here type-errors but, in a JS-runtime test, silently yields undefined
      // anchors — which is how this helper failed the first time.
      const result = validateLandingSite(world.grid, drone, reactor, scorer)
      if (result.ok) return { drone, reactor }
    }
  }
  return null
}

describe('world seam: terrain -> buildability -> deposits -> landing', () => {
  it('should compose a world whose deposits come from generateDeposits, not from a fixture', () => {
    const world = generateWorld(WIDTH, HEIGHT, SEED)

    // The exact production call the old code never made from anywhere but a test.
    expect(world.deposits).toEqual(generateDeposits(world.terrain))
    expect(world.deposits.length).toBeGreaterThan(0)
  })

  it('should produce byte-identical worlds from the same seed', () => {
    expect(generateWorld(WIDTH, HEIGHT, SEED)).toEqual(generateWorld(WIDTH, HEIGHT, SEED))
  })

  it('should produce different deposits for different seeds', () => {
    const a = generateWorld(WIDTH, HEIGHT, SEED)
    const b = generateWorld(WIDTH, HEIGHT, SEED + 1)
    expect(a.deposits).not.toEqual(b.deposits)
  })

  it('should keep the grid dimensions consistent with the terrain', () => {
    const world = generateWorld(WIDTH, HEIGHT, SEED)
    expect(world.grid.width).toBe(world.terrain.width)
    expect(world.grid.height).toBe(world.terrain.height)
    expect(world.buildability.width).toBe(world.terrain.width)
    expect(world.buildability.height).toBe(world.terrain.height)
  })

  it('should score a landing site end to end from world-derived data alone', () => {
    const world = generateWorld(WIDTH, HEIGHT, SEED)
    const anchors = findLegalAnchors(world)
    expect(anchors).not.toBeNull()

    const readiness = evaluateLanding({
      grid: world.grid,
      selection: { droneHullAnchor: anchors!.drone, reactorHullAnchor: anchors!.reactor },
      mineralDeposits: depositCoords(world.deposits),
      buildabilityScore: buildabilityScorerFor(world.buildability),
    })

    expect(readiness.status).toBe('ready')
    if (readiness.status !== 'ready') return
    expect(Number.isFinite(readiness.score)).toBe(true)
    expect(readiness.score).toBeGreaterThan(0)
  })

  /**
   * The load-bearing assertion. It is not enough that the wiring type-checks —
   * the generated deposits must actually MOVE the score, or the 0.35 weight is
   * still decorative. Comparing against an empty deposit list isolates exactly
   * the contribution the seam carries.
   */
  it('should make generated deposits actually drive the deposit-proximity score', () => {
    const world = generateWorld(WIDTH, HEIGHT, SEED)
    const anchors = findLegalAnchors(world)
    expect(anchors).not.toBeNull()

    const common = {
      droneHullAnchor: anchors!.drone,
      reactorHullAnchor: anchors!.reactor,
      buildabilityScore: buildabilityScorerFor(world.buildability),
    }

    const withDeposits = scoreLandingSite({
      ...common,
      mineralDeposits: depositCoords(world.deposits),
    })
    const withoutDeposits = scoreLandingSite({ ...common, mineralDeposits: [] })

    expect(withoutDeposits.depositProximity).toBe(0)
    expect(withDeposits.depositProximity).toBeGreaterThan(0)
    expect(withDeposits.total).toBeGreaterThan(withoutDeposits.total)
  })

  it('should rank a site next to a generated deposit above one far from every deposit', () => {
    const world = generateWorld(WIDTH, HEIGHT, SEED)
    const scorer = buildabilityScorerFor(world.buildability)
    const deposits = depositCoords(world.deposits)
    const target = deposits[0]!

    // Farthest in-bounds corner from `target`, so the comparison is meaningful
    // regardless of where the seed happened to scatter the first deposit.
    const far: Coord = {
      x: target.x < world.terrain.width / 2 ? world.terrain.width - 3 : 0,
      y: target.y < world.terrain.height / 2 ? world.terrain.height - 4 : 0,
    }

    const near = scoreLandingSite({
      droneHullAnchor: target,
      reactorHullAnchor: target,
      mineralDeposits: deposits,
      buildabilityScore: scorer,
    })
    const remote = scoreLandingSite({
      droneHullAnchor: far,
      reactorHullAnchor: far,
      mineralDeposits: deposits,
      buildabilityScore: scorer,
    })

    expect(near.depositProximity).toBeGreaterThan(remote.depositProximity)
  })

  it('should not depend on a caller remembering to build the grid separately', () => {
    // Regression guard for the original defect's shape: a consumer must be able to
    // get every piece of a scorable world from ONE call. If `generateWorld` ever
    // stops returning one of these, the seam has been broken open again.
    const world = generateWorld(WIDTH, HEIGHT, SEED)
    expect(world).toEqual(
      expect.objectContaining({
        terrain: expect.any(Object),
        buildability: expect.any(Object),
        deposits: expect.any(Array),
        grid: expect.any(Object),
      }),
    )
    expect(world.grid).toEqual(createGrid(WIDTH, HEIGHT))
  })
})
