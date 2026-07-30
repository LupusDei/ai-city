/**
 * Tile buildability and mineral deposit scatter, both derived from `terrain.ts`.
 *
 * Two independent derivations live here on purpose, not in separate files: they
 * share the same input (a `Terrain`) and, for deposits, the first derivation
 * (buildability) directly gates the second (deposits are never sited on
 * unbuildable extremes) — see `generateDeposits` for the exact rule. Splitting
 * them would force that dependency across a file boundary for no benefit.
 *
 * This module never mutates its `Terrain` input and never touches the grid's
 * occupancy state — it only reads elevation and produces new, independent data.
 *
 * Like terrain.ts, this module is pure data plus pure functions, and the same
 * determinism ban applies: no `Math.random`, `Date.now`, `new Date`, or
 * iteration over Object/Map/Set key order. `tests/unit/boundary.test.ts`
 * enforces this automatically for everything under `src/sim/`.
 */

import type { Coord } from './grid'
import type { Terrain } from './terrain'
import { elevationAt } from './terrain'

// ---------------------------------------------------------------------------
// Buildability
// ---------------------------------------------------------------------------

/**
 * Buildability score per tile, row-major (`index = y * width + x`) to match
 * `Terrain` and `Grid`. Every score is in the closed interval [0, 1]: 1 is
 * perfectly flat (fully buildable), 0 is the steepest slope representable on a
 * [0,1]-normalised heightmap.
 *
 * `width`/`height` are carried on the result (rather than requiring the caller
 * to keep the source `Terrain` around) so a `BuildabilityMap` is self-contained
 * for `buildabilityAt`, mirroring why `Terrain` itself carries `width`/`height`.
 */
export interface BuildabilityMap {
  readonly width: number
  readonly height: number
  readonly score: readonly number[]
}

/**
 * Offsets to a tile's full 8-connected (Moore) neighbourhood.
 *
 * Diagonals are included, not just the 4-connected (von Neumann) set, because a
 * slope that only shows up diagonally (e.g. a corner of a plateau) is a real
 * slope a structure's foundation would still have to contend with — omitting
 * diagonals would let such a tile score as falsely buildable.
 */
const MOORE_OFFSETS: readonly Coord[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
]

/**
 * Derive a per-tile buildability score from local slope.
 *
 * Slope, per tile, is defined as the maximum absolute elevation difference
 * between the tile and whichever of its up-to-8 Moore neighbours actually
 * exist on the grid (`elevationAt` returns `undefined` for the rest, which are
 * simply skipped rather than treated as zero-elevation or wrapped around — a
 * fabricated neighbour would corrupt the score, and wrapping would silently
 * treat the map as a torus it is not). Using the WORST (max) neighbour rather
 * than an average means a single steep edge (e.g. a cliff bordering an
 * otherwise flat tile) correctly drags that tile's score down; an average
 * would let a cliff hide behind three flat neighbours.
 *
 * Because `Terrain.elevation` is contractually normalised to [0, 1]
 * (guaranteed by `generateTerrain`), the max difference is already in [0, 1],
 * so `buildability = 1 - slope` is already bounded — the `Math.min`/`Math.max`
 * clamp below is a defensive belt-and-braces measure, not load-bearing logic,
 * kept in case a future caller ever hands this a hand-built `Terrain` whose
 * elevations stray outside that range (as several tests here deliberately do
 * NOT, but a careless one might).
 *
 * A 1x1 (or otherwise neighbourless) tile has no neighbours to disagree with,
 * so its slope is 0 and its buildability is the maximum, 1 — there is no
 * evidence it is anything but buildable.
 */
export function computeBuildability(terrain: Terrain): BuildabilityMap {
  const { width, height } = terrain
  const score = new Array<number>(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      // Safe: (x, y) is produced by iterating terrain's own width/height, so
      // this index is provably within `terrain.elevation`. Mirrors the same
      // loop-bound-guaranteed `as number` cast terrain.ts uses for `raw[i]`.
      const center = terrain.elevation[index] as number

      let maxDiff = 0
      for (const offset of MOORE_OFFSETS) {
        const neighbour = elevationAt(terrain, { x: x + offset.x, y: y + offset.y })
        if (neighbour === undefined) continue // out of bounds: no fabricated neighbour
        const diff = Math.abs(neighbour - center)
        if (diff > maxDiff) maxDiff = diff
      }

      const slope = Math.min(1, Math.max(0, maxDiff))
      score[index] = 1 - slope
    }
  }

  return { width, height, score }
}

/**
 * The buildability score at `coord`, or `undefined` if the coordinate is not on
 * this map. Deliberately mirrors `elevationAt`/`tileAt`'s out-of-bounds
 * convention exactly, so callers already familiar with either need to learn
 * nothing new to use this one.
 */
export function buildabilityAt(map: BuildabilityMap, coord: Coord): number | undefined {
  const { x, y } = coord
  const inBounds =
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height
  if (!inBounds) return undefined
  return map.score[y * map.width + x]
}

// ---------------------------------------------------------------------------
// Mineral deposits
// ---------------------------------------------------------------------------

/**
 * A single scattered mineral deposit.
 *
 * `richness` is drawn from the same deterministic PRNG stream as placement
 * (see `generateDeposits`) rather than fixed at a constant, so two deposits at
 * different tiles are not interchangeable — a consumer (e.g. a future mining
 * building) has an immediate, seed-reproducible reason to prefer one site over
 * another beyond "a deposit exists here or it doesn't".
 */
export interface MineralDeposit {
  readonly x: number
  readonly y: number
  /** Deterministic yield magnitude in [0, 1). */
  readonly richness: number
}

/** Tuning knobs for {@link generateDeposits}. Both are optional; see the exported defaults. */
export interface DepositOptions {
  /**
   * Fraction, in [0, 1], of ELIGIBLE tiles (see `minBuildability`) that receive
   * a deposit. 0 places none; 1 places one on every eligible tile.
   */
  readonly density?: number
  /**
   * Tiles with buildability at or below this threshold are ineligible for a
   * deposit — see the "unbuildable extremes" rule documented on
   * {@link generateDeposits}.
   */
  readonly minBuildability?: number
}

/**
 * Default deposit density: roughly 1 in 20 eligible tiles.
 *
 * Chosen to read as "scattered" rather than "sparse" or "carpeted" on a
 * typical colony-sized map — dense enough that a player scanning a few dozen
 * tiles will find one, sparse enough that finding one still means something.
 * There is no gameplay-balance data yet to justify a more precise figure; this
 * is a deliberately conservative placeholder pending playtesting.
 */
export const DEFAULT_DEPOSIT_DENSITY = 0.05

/**
 * Default eligibility threshold: buildability must exceed 0.2 for a tile to
 * receive a deposit.
 *
 * This excludes only the steepest "unbuildable extreme" tiles — cliff faces
 * and crater rims — where no mining structure could physically be sited to
 * extract the deposit regardless of what lies beneath it. It deliberately does
 * NOT exclude merely-hilly tiles (buildability comfortably above this
 * threshold is still common on realistic terrain), because moderate slope is
 * routine mining terrain, not an extreme.
 */
export const DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT = 0.2

function assertUnitInterval(value: number, name: string): void {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be a number in [0, 1], received: ${value}`)
  }
}

/**
 * Scatter mineral deposits deterministically across `terrain`.
 *
 * Determinism contract: `generateDeposits` is keyed off `terrain.seed` via the
 * same `mulberry32` PRNG construction `terrain.ts` uses (duplicated here, not
 * imported, because `terrain.ts` does not export it and is explicitly
 * off-limits to modify — see the module header). Identical
 * `(terrain, options)` therefore always yields a deep-equal deposit array, on
 * any run or process; a different `seed` yields a different PRNG stream and
 * therefore, overwhelmingly likely, different deposits.
 *
 * Placement algorithm: iterate every tile in fixed row-major order (never
 * Object/Map/Set iteration, whose key order is not a value contract) and, for
 * each tile whose buildability exceeds `minBuildability`, draw exactly one
 * PRNG value to decide inclusion (accepted if the draw is below `density`) and
 * — only for accepted tiles — one more to set `richness`. Row-major order is
 * fixed regardless of map shape, so the draw sequence (and thus the result)
 * depends only on `(terrain, options)`, never on incidental iteration order.
 * Ineligible tiles consume zero draws, so changing `minBuildability` alone
 * does not perturb the draw sequence seen by tiles that were already eligible
 * under the old threshold... this is a minor implementation detail, not a
 * documented compatibility guarantee; nothing above the eligibility gate
 * itself is a public contract of *which* draw a tile consumes.
 *
 * "Unbuildable extremes" rule: a tile is eligible only if its buildability
 * (from `computeBuildability`, applied to the same `terrain`) is strictly
 * greater than `minBuildability` (default {@link DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT}).
 * See that constant's doc comment for the justification.
 *
 * A 1x1 (or otherwise tiny) terrain never crashes: the loop below simply has
 * fewer iterations, and a terrain with zero eligible tiles legitimately
 * returns an empty array.
 *
 * @throws {RangeError} if `density` or `minBuildability` is outside [0, 1] —
 *   a caller/programmer error, not an ordinary simulation outcome, so this
 *   throws rather than returning a typed rejection (see `placement.ts` for the
 *   contrasting case of an ordinary, expected rejection).
 */
export function generateDeposits(
  terrain: Terrain,
  options: DepositOptions = {},
): readonly MineralDeposit[] {
  const density = options.density ?? DEFAULT_DEPOSIT_DENSITY
  const minBuildability = options.minBuildability ?? DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT
  assertUnitInterval(density, 'density')
  assertUnitInterval(minBuildability, 'minBuildability')

  const buildability = computeBuildability(terrain)
  const rand = mulberry32(terrain.seed)
  const deposits: MineralDeposit[] = []

  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      const index = y * terrain.width + x
      // Safe: same loop-bound reasoning as computeBuildability's `center` cast.
      const tileBuildability = buildability.score[index] as number
      if (!(tileBuildability > minBuildability)) continue

      const placementRoll = rand()
      if (placementRoll >= density) continue

      const richness = rand()
      deposits.push({ x, y, richness })
    }
  }

  return deposits
}

/**
 * mulberry32: a minimal 32-bit seeded PRNG, duplicated verbatim from
 * `terrain.ts`.
 *
 * Duplicated rather than imported because `terrain.ts` does not export this
 * function and this task is explicitly forbidden from modifying `terrain.ts`
 * (another agent owns it). Using the exact same construction here — rather
 * than, say, a different seeded PRNG — is what the task calls for explicitly:
 * a consistent, well-understood seeded-PRNG "house style" across the sim core,
 * so any future reviewer auditing determinism only has to trust one small
 * algorithm, not several different ones.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
