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
 * occupancy state — it only reads elevation and latitude, and produces new,
 * independent data.
 *
 * Like terrain.ts, this module is pure data plus pure functions, and the same
 * determinism ban applies: no `Math.random`, `Date.now`, `new Date`, or
 * iteration over Object/Map/Set key order. `tests/unit/boundary.test.ts`
 * enforces this automatically for everything under `src/sim/`.
 */

import type { Coord } from './grid'
import type { Terrain } from './terrain'
import { assertValidMapLatitude, elevationAt, mulberry32 } from './terrain'

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
  /**
   * WHICH resource this deposit yields, as an open string key ('silica', 'ice',
   * ...) — never a closed TypeScript union.
   *
   * This mirrors `ResourceAmounts` in catalog.ts exactly, and for the same
   * reason: a new resource must be addable as DATA. A union here would mean
   * every new resource kind needed a source edit in this file, and a `switch`
   * somewhere downstream would have to grow a case — the precise coupling
   * catalog.ts was built to avoid. Validated at the generation boundary (see
   * {@link eligibleDepositKinds}), so downstream code can rely on this being a
   * non-empty string that some registered {@link DepositKindSpec} authorised.
   *
   * Required, not optional. A deposit with no kind is the exact defect this
   * field exists to remove: "site this Sifter on a SILICA deposit" cannot be
   * expressed against an untyped deposit, so allowing untyped ones back in
   * would reintroduce the hole.
   */
  readonly kind: string
  /** Deterministic yield magnitude in [0, 1). */
  readonly richness: number
}

/**
 * A registerable deposit kind: what a deposit can be, and where it can occur.
 *
 * This is the data record that keeps deposit kinds out of the source. Callers
 * pass a list of these via {@link DepositOptions.kinds}; nothing in this module
 * mentions any specific resource except in {@link DEFAULT_DEPOSIT_KINDS}, which
 * is itself just data.
 */
export interface DepositKindSpec {
  /** Open resource key, e.g. 'silica'. Must be non-empty and unique in its list. */
  readonly kind: string
  /**
   * Relative share of deposits of this kind, among the kinds eligible at a given
   * latitude. Any finite positive number; only the ratios matter, so weights do
   * not have to sum to anything in particular.
   */
  readonly weight: number
  /**
   * Poleward gate: |map latitude| must be at least this many degrees for this
   * kind to occur at all. Omitted (or 0) means "occurs at any latitude".
   *
   * Absolute latitude, so a threshold applies symmetrically to both hemispheres
   * — Mars' near-surface ice distribution is broadly symmetric about the
   * equator, and nothing in this simulation distinguishes north from south.
   */
  readonly minAbsLatitudeDeg?: number
}

/**
 * Minimum absolute latitude, in degrees, at which shallow subsurface water ice
 * is accessible: 35.
 *
 * Real-world basis, and the reason this is a hard gate rather than a falloff:
 * - Mars Odyssey's neutron spectrometer mapped high near-surface hydrogen
 *   (i.e. ice) concentrated poleward of roughly 40-60 degrees in both
 *   hemispheres, with the equatorial band conspicuously dry.
 * - NASA's SWIM (Subsurface Water Ice Mapping) project, assembled to help pick
 *   human landing sites, finds consistent shallow ice signatures only poleward
 *   of roughly 35-40 degrees.
 * - Phoenix landed at 68 degrees N in 2008 and struck buried ice within
 *   CENTIMETRES of the surface, confirming the poleward case directly.
 * - Curiosity, in equatorial Gale crater, measured only ~2 wt% water in the
 *   soil — hydrated minerals, not minable ice.
 *
 * 35 rather than 40 is chosen at the equatorward end of the published band on
 * purpose: it is the more permissive reading, so the game never refuses a site
 * the real mapping would call plausible. It is a step function rather than a
 * gradient because the underlying physical control (ice stability against
 * sublimation under present-day insolation) genuinely does have a boundary, and
 * a gradient would need per-latitude yield data this project does not have.
 *
 * The comparison is INCLUSIVE (`>=`): a map at exactly 35 degrees has ice.
 * Something has to happen at the boundary, and admitting it matches the
 * "permissive reading" choice above rather than contradicting it.
 */
export const ICE_MIN_ABS_LATITUDE_DEG = 35

/**
 * The deposit kinds a map has unless the caller registers its own.
 *
 * DATA, not logic — the only place in this module that names a resource. Two
 * entries for the MVP's two mineral chains:
 *
 * - **silica**, ungated. Ordinary Martian regolith is ~45 wt% SiO2 (Curiosity's
 *   APXS and CheMin instruments), so silicon feedstock exists at every latitude;
 *   and genuinely CONCENTRATED opaline silica deposits are real and localised —
 *   Spirit found up to ~90% SiO2 near Home Plate in Gusev crater, and
 *   hydrothermal silica is mapped at Nili Patera. A scattered "silica deposit"
 *   represents that concentrated kind, which is why it is scattered rather than
 *   assumed present on every tile.
 * - **ice**, gated poleward of {@link ICE_MIN_ABS_LATITUDE_DEG}.
 *
 * Together these create the intended strategic tension: ice pulls the landing
 * site poleward, solar insolation pulls it toward the equator, and the player
 * cannot have both optima.
 *
 * Weights are EQUAL, and that is a deliberate placeholder rather than a claim.
 * There is no published basis for a relative abundance ratio between
 * concentrated opaline silica and shallow ice at a given poleward site, so
 * inventing one would be false precision dressed as science. Equal weighting
 * pending playtesting, in the same spirit as {@link DEFAULT_DEPOSIT_DENSITY}.
 *
 * Declaration order is part of the value: it feeds the deterministic weighted
 * pick in `generateDeposits`, so reordering this array changes which kind a
 * given seed assigns to a given tile.
 */
export const DEFAULT_DEPOSIT_KINDS: readonly DepositKindSpec[] = [
  { kind: 'silica', weight: 1 },
  { kind: 'ice', weight: 1, minAbsLatitudeDeg: ICE_MIN_ABS_LATITUDE_DEG },
]

/** Tuning knobs for {@link generateDeposits}. All optional; see the exported defaults. */
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
  /**
   * The deposit kinds that may occur on this map, defaulting to
   * {@link DEFAULT_DEPOSIT_KINDS}. Supplying this is how a caller adds a
   * resource kind without touching any source under `src/sim/`.
   */
  readonly kinds?: readonly DepositKindSpec[]
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
 * Validate a deposit-kind registry and return only the kinds that can occur at
 * `latitudeDeg`, in their original declaration order.
 *
 * This is THE validation boundary for deposit kinds, in the same spirit as
 * `createCatalog` in catalog.ts: untrusted, caller-authored data is checked once,
 * here, so everything downstream can treat a `MineralDeposit.kind` as a
 * known-good non-empty key. `generateDeposits` calls this rather than
 * re-implementing the checks, so there is exactly one place the rules live.
 *
 * Declaration order is preserved (rather than, say, sorting by weight) because
 * the caller's array order is what makes the weighted pick in `generateDeposits`
 * reproducible. Filtering an array preserves order; iterating a Map or object
 * would not be a value contract, which is why no such structure appears here.
 *
 * An empty RESULT is a legitimate answer, not an error: a map registering only
 * poleward ice, sited at the equator, genuinely has nothing to mine. An empty
 * INPUT is an error, because a caller who registered no kinds at all has made a
 * mistake rather than described a barren world.
 *
 * @throws {RangeError} if `latitudeDeg` is not a finite degree value in
 *   [-90, 90]; if `kinds` is empty; or if any spec has an empty `kind`, a
 *   duplicate `kind`, a non-finite/non-positive `weight`, or a
 *   `minAbsLatitudeDeg` outside [0, 90]. Kind registries are authored content,
 *   not player input, so a malformed one is a defect and fails loudly — the same
 *   call this module already makes for `density` and `minBuildability`.
 */
export function eligibleDepositKinds(
  latitudeDeg: number,
  kinds: readonly DepositKindSpec[] = DEFAULT_DEPOSIT_KINDS,
): readonly DepositKindSpec[] {
  assertValidMapLatitude(latitudeDeg, 'Deposit kind latitude')

  if (kinds.length === 0) {
    throw new RangeError('Deposit kinds must contain at least one kind')
  }

  const seen = new Set<string>()
  for (const spec of kinds) {
    if (spec.kind.length === 0) {
      throw new RangeError('Deposit kind key must be a non-empty string')
    }
    if (seen.has(spec.kind)) {
      // Two entries for one key would make the effective weight the sum of both
      // while looking like a single declaration — silently ambiguous data.
      throw new RangeError(`Duplicate deposit kind: "${spec.kind}"`)
    }
    seen.add(spec.kind)

    // Zero is rejected along with negatives: a zero-weight kind can never be
    // picked, so it is either a typo or a kind the author meant to delete.
    if (!Number.isFinite(spec.weight) || spec.weight <= 0) {
      throw new RangeError(
        `Deposit kind "${spec.kind}": weight must be a finite positive number, received: ${spec.weight}`,
      )
    }

    const threshold = spec.minAbsLatitudeDeg
    if (threshold !== undefined && !(Number.isFinite(threshold) && threshold >= 0 && threshold <= 90)) {
      // An ABSOLUTE latitude, so the valid range is [0, 90], not [-90, 90] —
      // a negative threshold would be a sign the author confused this with a
      // signed latitude, and above 90 it could never be satisfied.
      throw new RangeError(
        `Deposit kind "${spec.kind}": minAbsLatitudeDeg must be a finite number in [0, 90], received: ${threshold}`,
      )
    }
  }

  const absLatitude = Math.abs(latitudeDeg)
  return kinds.filter((spec) => absLatitude >= (spec.minAbsLatitudeDeg ?? 0))
}

/**
 * Pick one kind from `eligible` using a single PRNG draw and the specs' weights.
 *
 * Linear scan over cumulative weight rather than a precomputed table: the
 * eligible list is a handful of entries, so an O(n) scan is free and there is no
 * table to keep in sync. Preconditions (non-empty, every weight finite and
 * positive) are guaranteed by `eligibleDepositKinds`, which is the only path to
 * this function.
 *
 * The scan deliberately stops BEFORE the last entry and returns it
 * unconditionally, rather than scanning all entries and keeping a fallback
 * return for the fall-through case. Both are correct — a draw in [0, 1) can only
 * exceed the cumulative total by floating-point rounding — but the fallback
 * version's last line is unreachable by construction, i.e. untestable dead code.
 * Making the final kind the explicit remainder bucket says the same thing with no
 * line that can never run, and it absorbs any rounding error by definition.
 */
function pickKind(eligible: readonly DepositKindSpec[], roll: number): string {
  let totalWeight = 0
  for (const spec of eligible) totalWeight += spec.weight

  let remaining = roll * totalWeight
  for (let i = 0; i < eligible.length - 1; i++) {
    // Safe: `i` is strictly less than `eligible.length`, so this index exists.
    const spec = eligible[i] as DepositKindSpec
    remaining -= spec.weight
    if (remaining < 0) return spec.kind
  }
  // Safe: `eligibleDepositKinds` guarantees a non-empty list (`generateDeposits`
  // returns early on an empty one), so there is always a last entry.
  return (eligible[eligible.length - 1] as DepositKindSpec).kind
}

/**
 * Scatter mineral deposits deterministically across `terrain`.
 *
 * Determinism contract: `generateDeposits` is keyed off `terrain.seed` via the
 * `mulberry32` PRNG imported from `terrain.ts`, so the whole sim core shares one
 * seeded-PRNG construction. Identical `(terrain, options)` — which now includes
 * `terrain.latitude` — always yields a deep-equal deposit array, on any run or
 * process; a different `seed` yields a different PRNG stream and therefore,
 * overwhelmingly likely, different deposits.
 *
 * Placement algorithm: iterate every tile in fixed row-major order (never
 * Object/Map/Set iteration, whose key order is not a value contract) and, for
 * each tile whose buildability exceeds `minBuildability`, draw exactly one
 * PRNG value to decide inclusion (accepted if the draw is below `density`) and
 * — only for accepted tiles — two more: one to choose the deposit's `kind` and
 * one to set `richness`. Row-major order is fixed regardless of map shape, so
 * the draw sequence (and thus the result) depends only on `(terrain, options)`,
 * never on incidental iteration order. Ineligible tiles consume zero draws, so
 * changing `minBuildability` alone does not perturb the draw sequence seen by
 * tiles that were already eligible under the old threshold... this is a minor
 * implementation detail, not a documented compatibility guarantee; nothing above
 * the eligibility gate itself is a public contract of *which* draw a tile
 * consumes.
 *
 * LATITUDE IS A RE-TYPER, NOT A RE-ROLLER. The kind draw is consumed
 * unconditionally for every accepted tile, even when only ONE kind is eligible
 * and the draw's outcome is therefore foregone. That looks wasteful and is
 * load-bearing: it keeps the draw sequence the same length at every latitude, so
 * two maps sharing a seed but differing in latitude put their deposits on the
 * SAME tiles with the SAME richness and differ only in which resource each one
 * is. Latitude then reads to the player as one axis moving, not as a completely
 * different world — which is the whole point of making the ice/insolation
 * tradeoff a legible choice. Skipping the draw for a single-kind map would
 * couple deposit POSITION to latitude and destroy that property.
 *
 * "Unbuildable extremes" rule: a tile is eligible only if its buildability
 * (from `computeBuildability`, applied to the same `terrain`) is strictly
 * greater than `minBuildability` (default {@link DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT}).
 * See that constant's doc comment for the justification.
 *
 * A 1x1 (or otherwise tiny) terrain never crashes: the loop below simply has
 * fewer iterations, and a terrain with zero eligible tiles legitimately
 * returns an empty array. So does a map at a latitude where no registered kind
 * can occur — there is genuinely nothing to mine there.
 *
 * @throws {RangeError} if `density` or `minBuildability` is outside [0, 1], if
 *   `terrain.latitude` is not a finite degree value in [-90, 90], or if `kinds`
 *   is malformed (see {@link eligibleDepositKinds}) — all caller/programmer
 *   errors, not ordinary simulation outcomes, so these throw rather than
 *   returning a typed rejection (see `placement.ts` for the contrasting case of
 *   an ordinary, expected rejection).
 */
export function generateDeposits(
  terrain: Terrain,
  options: DepositOptions = {},
): readonly MineralDeposit[] {
  const density = options.density ?? DEFAULT_DEPOSIT_DENSITY
  const minBuildability = options.minBuildability ?? DEFAULT_MIN_BUILDABILITY_FOR_DEPOSIT
  assertUnitInterval(density, 'density')
  assertUnitInterval(minBuildability, 'minBuildability')

  // Re-validated here rather than trusted from `generateTerrain`, because a
  // hand-built `Terrain` (tests do build them, and so may future map importers)
  // can carry any number at all — and an unchecked NaN latitude would make every
  // poleward comparison quietly false instead of loudly wrong.
  assertValidMapLatitude(terrain.latitude, 'Terrain latitude')
  const eligible = eligibleDepositKinds(terrain.latitude, options.kinds)
  // Nothing can occur here. Returning early (rather than looping and picking
  // from an empty list) keeps `pickKind`'s non-empty precondition true by
  // construction instead of by defensive check.
  if (eligible.length === 0) return []

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

      // Order matters and is fixed: kind before richness. See the
      // "latitude is a re-typer" note above for why this draw is unconditional.
      const kind = pickKind(eligible, rand())
      const richness = rand()
      deposits.push({ x, y, kind, richness })
    }
  }

  return deposits
}
