/**
 * World composition: the seam that joins terrain, buildability, mineral deposits
 * and the playable grid into one object a caller can actually score a landing against.
 *
 * WHY THIS MODULE EXISTS (aic-c1p). `terrain.ts`, `buildability.ts` and `landing.ts`
 * were each built to a high standard, in isolation, and were never connected.
 * `generateDeposits` had exactly one caller in the entire codebase — its own unit
 * test — and `landing.ts` did not import `buildability.ts` at all. Landing scoring
 * therefore took `mineralDeposits: readonly Coord[]` and a `BuildabilityScorer` as
 * caller-supplied data that no production code produced, while deposit proximity
 * carried 35% of the site score. Every unit test passed. The feature did not work.
 *
 * Two adapters were missing, and they are the whole content of this file:
 *   1. `MineralDeposit` (x, y, richness) -> `Coord` (x, y), which is what scoring wants.
 *   2. `BuildabilityMap` (a flat score array) -> `BuildabilityScorer` (a footprint
 *      predicate), which is what validation and scoring both call.
 *
 * Deliberately a composition layer with no rules of its own: it owns no generation
 * logic and no scoring logic, so it cannot drift away from the modules it joins.
 * Everything here is a pure function of its inputs, so a world remains fully
 * reproducible from `(width, height, seed, options)` — the determinism contract the
 * rest of the sim depends on.
 */

import type { BuildabilityMap, DepositOptions, MineralDeposit } from './buildability'
import { buildabilityAt, computeBuildability, generateDeposits } from './buildability'
import type { Coord, Grid } from './grid'
import { createGrid } from './grid'
import type { BuildabilityScorer } from './landing'
import type { Terrain } from './terrain'
import { generateTerrain } from './terrain'

/**
 * Everything needed to render a surface and score a landing on it, from one call.
 *
 * Bundled rather than left to the caller to assemble because assembling it by hand
 * is exactly what nobody did: a caller that has to remember four separate
 * constructor calls and how to convert between their output types will forget one,
 * and the omission is silent (an empty deposit list scores as "no deposits anywhere"
 * rather than as an error).
 */
export interface World {
  readonly terrain: Terrain
  readonly buildability: BuildabilityMap
  readonly deposits: readonly MineralDeposit[]
  readonly grid: Grid
}

/**
 * Project deposits onto the bare coordinates landing scoring consumes.
 *
 * Returns fresh `{ x, y }` objects rather than the `MineralDeposit`s themselves.
 * Passing the deposits straight through would type-check — `MineralDeposit` is
 * structurally assignable to `Coord` — but it would leak `richness` into every
 * downstream consumer of a `Coord`, quietly widening that contract and inviting
 * code to depend on a field `Coord` does not promise.
 *
 * `richness` is dropped rather than aggregated because site scoring asks a purely
 * geometric question ("how far to the nearest deposit"). When richness starts
 * mattering — a mining building's yield, say — it should be read from the deposit
 * itself, not smuggled through the scoring path.
 */
export function depositCoords(deposits: readonly MineralDeposit[]): readonly Coord[] {
  return deposits.map(({ x, y }) => ({ x, y }))
}

/**
 * Build the `BuildabilityScorer` that `validateLandingSite` and `scoreLandingSite` expect.
 *
 * Aggregates a multi-tile footprint by **minimum**, not mean. A foundation is only
 * as good as its worst tile, and `landing.ts` treats a score at or below
 * `MIN_BUILDABLE_SCORE` (0) as a hard `unbuildable` rejection rather than a low
 * score — so taking the minimum is what makes "one unbuildable tile means an
 * unbuildable footprint" fall out of the existing rule instead of needing a second,
 * parallel check. Averaging would let five flat tiles carry a cliff tile and hand
 * back a site the validator would then accept.
 *
 * Two edge cases both resolve to 0, and both are chosen so that the failure mode is
 * a false NEGATIVE (refusing a legal site) rather than a false POSITIVE (accepting
 * an illegal one):
 *
 *   - **Out-of-bounds tile.** `buildabilityAt` returns `undefined` off-map. Skipping
 *     such a tile would score a footprint hanging off the edge as though it were
 *     smaller and entirely on good ground. `validateLandingSite` does check bounds
 *     first, so this is defence in depth rather than the primary guard — but a
 *     scorer that silently rewards going out of bounds is a trap for the next
 *     caller, who may not check.
 *   - **Empty footprint.** `Math.min()` of nothing is `Infinity`, which would sail
 *     straight through the `<= MIN_BUILDABLE_SCORE` comparison and report a
 *     footprint occupying no tiles as perfectly buildable.
 */
export function buildabilityScorerFor(map: BuildabilityMap): BuildabilityScorer {
  return (footprintTiles: readonly Coord[]): number => {
    if (footprintTiles.length === 0) return 0

    let worst = Number.POSITIVE_INFINITY
    for (const tile of footprintTiles) {
      const score = buildabilityAt(map, tile)
      if (score === undefined) return 0
      if (score < worst) worst = score
    }
    return worst
  }
}

/**
 * Generate a complete, reproducible world from a seed.
 *
 * Ordering matters: `generateTerrain` runs first because it validates the
 * dimensions, so a malformed call fails before any of the more expensive
 * derivations run. Buildability and deposits are both derived from that one
 * `Terrain` (and `generateDeposits` keys its PRNG off `terrain.seed`), which is what
 * keeps the whole world a pure function of `(width, height, seed, depositOptions)`.
 *
 * @throws {RangeError} if either dimension is not an integer within the grid limits.
 *   Propagated unchanged from `generateTerrain`/`createGrid`: a bad dimension is a
 *   config or programmer error, not player input, so it fails loudly here exactly as
 *   it does there.
 */
export function generateWorld(
  width: number,
  height: number,
  seed: number,
  depositOptions: DepositOptions = {},
): World {
  const terrain = generateTerrain(width, height, seed)
  return {
    terrain,
    buildability: computeBuildability(terrain),
    deposits: generateDeposits(terrain, depositOptions),
    grid: createGrid(width, height),
  }
}
