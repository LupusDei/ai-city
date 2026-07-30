/**
 * Landing site selection & scoring — the player's opening move.
 *
 * Premise: three starships left Earth for Mars. Two arrived — one carrying
 * construction drones, one carrying nuclear reactors. The third, carrying the
 * crew, was lost. The player's very first act is choosing where the two
 * surviving hulls set down. That choice must be consequential: this module
 * scores a candidate pair of touchdown points on three independent axes —
 * terrain buildability, proximity to mineral deposits, and separation between
 * the two hulls — so a bad choice visibly costs the colony something instead
 * of being cosmetic.
 *
 * Architectural decisions, and why:
 *
 * - Terrain buildability is taken as an INJECTED CALLBACK (`BuildabilityScorer`),
 *   never imported from a concrete buildability module. A buildability slice of
 *   the sim is being built concurrently elsewhere; importing it here would
 *   create a build-order dependency this module cannot control and does not
 *   need. The caller closes over whatever terrain/heightmap machinery it likes
 *   and hands this module a pure `(tiles) => number` function.
 *
 * - Mineral deposits are taken as plain `Coord[]` data rather than imported from
 *   the module that generates them. Keeping the dependency inverted this way is
 *   still right — this module's honest dependency is coordinates, nothing more —
 *   but note the correction: a deposit-generation module DOES exist
 *   (`buildability.ts`'s `generateDeposits`). An earlier version of this comment
 *   said it did not, which was true when written in an isolated worktree and
 *   false by the time both landed. That stale note helped hide aic-c1p: deposits
 *   were generated and scored, and nothing joined the two, so 35% of the site
 *   score ran on data no production code produced. The join now lives in
 *   `world.ts` (`generateWorld`, `depositCoords`, `buildabilityScorerFor`) and is
 *   covered by `tests/integration/world-seam.test.ts`. Callers should compose a
 *   `World` rather than assembling these arguments by hand.
 *
 * - Validation mirrors the discriminated-union rejection pattern established
 *   in `placement.ts`: a bad site is an ORDINARY outcome of player choice (a
 *   crater, a cliff edge, a second hull dropped on top of the first), not a
 *   programmer error, so nothing here throws for it. Every rejection carries a
 *   distinct `reason` literal plus enough structured detail (which hull, which
 *   tile) for a caller to explain the rejection to the player without
 *   re-deriving it.
 *
 * - Hull footprints reuse `grid.ts`'s `Coord`/`Grid`/`isInBounds` directly
 *   rather than routing through `catalog.ts`/`placement.ts`'s `StructureType`
 *   machinery. A landed hull is not a buildable structure (it has no build
 *   time, no catalog entry, no occupant bookkeeping requirement at this
 *   stage) — forcing it through the structure-catalog boundary would couple
 *   this module to a data shape (`StructureTypeSpec`) designed for a different
 *   concern, for no benefit.
 *
 * This module is pure: no I/O, no clock, no mutation of any input, and (per
 * the project's sim/renderer boundary test) no `Math.random`/`Date.now`/
 * `new Date` — every score is a deterministic function of its explicit inputs.
 */

import type { Coord, Grid } from './grid'
import { isInBounds } from './grid'

// ---------------------------------------------------------------------------
// Hulls
// ---------------------------------------------------------------------------

/** Which surviving hull a coordinate or rejection refers to. */
export type HullId = 'drone-hull' | 'reactor-hull'

/** A tile offset relative to a hull's anchor tile. Mirrors `catalog.ts`'s `FootprintOffset`. */
export interface FootprintOffset {
  readonly dx: number
  readonly dy: number
}

/**
 * Both surviving hulls share one footprint shape: a 2x2 block. A starship
 * hull is large relative to a single tile, and a multi-tile footprint (rather
 * than a single tile) is what makes "out of bounds" and "overlap" checks
 * exercise more than a trivial single-coordinate comparison — matching the
 * footprint-aware validation `placement.ts` already establishes for built
 * structures.
 */
export const HULL_FOOTPRINT: readonly FootprintOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
]

/**
 * Resolve `HULL_FOOTPRINT`'s offsets against `anchor` into absolute tile
 * coordinates. Pure coordinate arithmetic — like `resolveFootprint` in
 * placement.ts, it never consults a grid and so can never itself reject
 * anything, which keeps it safe to reuse for preview/ghost rendering of a
 * hull that has not been validated yet.
 */
export function resolveHullFootprint(anchor: Coord): readonly Coord[] {
  return HULL_FOOTPRINT.map(({ dx, dy }) => ({ x: anchor.x + dx, y: anchor.y + dy }))
}

// ---------------------------------------------------------------------------
// Buildability (injected)
// ---------------------------------------------------------------------------

/**
 * Caller-supplied terrain buildability scorer for one hull's resolved
 * footprint tiles.
 *
 * Contract: higher means flatter/more buildable. The intended range is
 * [0, 1], but this module does not trust the caller to enforce that — every
 * value returned here is sanitised (NaN/Infinity/out-of-range all clamped)
 * before it can affect a score, so a misbehaving scorer can degrade a result
 * but can never produce a NaN or Infinite total.
 */
export type BuildabilityScorer = (footprintTiles: readonly Coord[]) => number

/**
 * A footprint whose sanitised buildability score is at or below this
 * threshold is not merely "bad terrain" — it is a hard rejection
 * (`unbuildable`), because a weighted score alone cannot express "you may not
 * build here at all" (a sufficiently negative weight would only ever push the
 * *total* down, never remove the option). Zero is the natural threshold: it
 * is both the sanitised floor a scorer can return and the one value that
 * reads unambiguously as "cannot build" rather than "can build, poorly".
 */
export const MIN_BUILDABLE_SCORE = 0

// ---------------------------------------------------------------------------
// Validation result types (mirrors placement.ts's discriminated-union style)
// ---------------------------------------------------------------------------

/**
 * A hull rejected because its footprint would not sit entirely inside the
 * grid. `tile` is the specific offending absolute coordinate, not just the
 * anchor, so a caller can pinpoint exactly which part of the hull hung off
 * the edge — mirrors `OutOfBoundsRejection` in placement.ts exactly.
 */
export interface OutOfBoundsRejection {
  readonly ok: false
  readonly reason: 'out-of-bounds'
  readonly hull: HullId
  readonly tile: Coord
}

/**
 * A hull rejected because its footprint's sanitised buildability score is at
 * or below `MIN_BUILDABLE_SCORE`. `anchor` (not a single `tile`) is carried
 * here because unbuildability is a property of the whole footprint as
 * evaluated by the injected scorer, not of one offending coordinate.
 */
export interface UnbuildableRejection {
  readonly ok: false
  readonly reason: 'unbuildable'
  readonly hull: HullId
  readonly anchor: Coord
}

/**
 * A landing rejected because the two hulls' footprints share at least one
 * tile. `tile` is the first shared coordinate found (scanning the reactor
 * hull's footprint against the drone hull's), so a caller can point at
 * exactly where the two hulls would collide.
 */
export interface OverlappingHullsRejection {
  readonly ok: false
  readonly reason: 'overlapping-hulls'
  readonly tile: Coord
}

/** A landing site rejected for one of three distinct, typed reasons. */
export type LandingRejection =
  | OutOfBoundsRejection
  | UnbuildableRejection
  | OverlappingHullsRejection

/**
 * A landing site that passed validation, carrying every absolute tile each
 * hull would occupy so a caller (or `applyLanding`-style code a future bead
 * might add) never has to re-derive or re-validate them.
 */
export interface LandingValidationSuccess {
  readonly ok: true
  readonly droneHullTiles: readonly Coord[]
  readonly reactorHullTiles: readonly Coord[]
}

/**
 * The result of validating a candidate landing site for both hulls.
 *
 * A discriminated union rather than a thrown error, for the same reason as
 * `PlacementResult` in placement.ts: an illegal site (off the map, a crater,
 * a hull dropped on the other hull) is an ordinary, expected outcome of a
 * player's choice, not an exceptional program state.
 */
export type LandingValidationResult = LandingValidationSuccess | LandingRejection

/**
 * Sanitise a caller-supplied score into [0, 1].
 *
 * `NaN` is treated as the conservative floor (0): it carries no usable
 * direction, so folding it to "as if unbuildable/no-proximity" is safer than
 * folding it to 1. `Infinity`/`-Infinity` and any other out-of-range finite
 * value are ordinary clamping (`> 1` / `< 0`) — `NaN` is the only value for
 * which every comparison operator returns `false`, so it needs its own
 * explicit check rather than falling through the range comparisons below.
 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** The first footprint tile of `hull`'s placement at `anchor` that lies off `grid`, if any. */
function checkHullBounds(grid: Grid, hull: HullId, anchor: Coord): OutOfBoundsRejection | undefined {
  for (const tile of resolveHullFootprint(anchor)) {
    if (!isInBounds(grid, tile)) {
      return { ok: false, reason: 'out-of-bounds', hull, tile }
    }
  }
  return undefined
}

/** The first tile shared by both footprints, if any. Scans `reactorTiles` against a `droneTiles` set. */
function findOverlap(
  droneTiles: readonly Coord[],
  reactorTiles: readonly Coord[],
): Coord | undefined {
  const droneKeys = new Set(droneTiles.map((c) => `${c.x},${c.y}`))
  for (const tile of reactorTiles) {
    if (droneKeys.has(`${tile.x},${tile.y}`)) return tile
  }
  return undefined
}

/**
 * Validate landing both hulls at their respective anchors on `grid`.
 *
 * Checks run in a fixed, cheapest-first order — bounds, then overlap, then
 * buildability — and short-circuit on the first failure. This mirrors
 * `validatePlacement`'s per-tile short-circuit in placement.ts and, as a
 * side effect, means an out-of-bounds hull never even invokes the caller's
 * (possibly expensive) `buildabilityScore` callback.
 *
 * Never mutates `grid` (only reads it via `isInBounds`), and never throws for
 * an invalid site — see `LandingValidationResult`.
 */
export function validateLandingSite(
  grid: Grid,
  droneHullAnchor: Coord,
  reactorHullAnchor: Coord,
  buildabilityScore: BuildabilityScorer,
): LandingValidationResult {
  const droneBoundsRejection = checkHullBounds(grid, 'drone-hull', droneHullAnchor)
  if (droneBoundsRejection !== undefined) return droneBoundsRejection

  const reactorBoundsRejection = checkHullBounds(grid, 'reactor-hull', reactorHullAnchor)
  if (reactorBoundsRejection !== undefined) return reactorBoundsRejection

  const droneHullTiles = resolveHullFootprint(droneHullAnchor)
  const reactorHullTiles = resolveHullFootprint(reactorHullAnchor)

  const overlapTile = findOverlap(droneHullTiles, reactorHullTiles)
  if (overlapTile !== undefined) {
    return { ok: false, reason: 'overlapping-hulls', tile: overlapTile }
  }

  // Sanitised via clamp01 before the threshold check so a scorer returning
  // NaN (an arguably-worse-than-zero signal) is treated as unbuildable rather
  // than silently passing an `NaN <= 0` comparison (which is always false).
  if (clamp01(buildabilityScore(droneHullTiles)) <= MIN_BUILDABLE_SCORE) {
    return { ok: false, reason: 'unbuildable', hull: 'drone-hull', anchor: droneHullAnchor }
  }
  if (clamp01(buildabilityScore(reactorHullTiles)) <= MIN_BUILDABLE_SCORE) {
    return { ok: false, reason: 'unbuildable', hull: 'reactor-hull', anchor: reactorHullAnchor }
  }

  return { ok: true, droneHullTiles, reactorHullTiles }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The scale the final site score is reported on. 0-100 reads naturally as a
 * percentage-like "site quality" in a UI, independent of the underlying
 * weighted-sum machinery.
 */
export const SCORE_SCALE = 100

/**
 * Weight of the (0-1) buildability component in the total score.
 *
 * Weighted highest of the three: flat, stable ground is the single hard
 * precondition for every future structure at this site. A resource-poor but
 * flat site can still be serviced by rovers; unstable ground undermines
 * everything built on it, including whatever eventually reaches the
 * deposits.
 */
export const BUILDABILITY_WEIGHT = 0.45

/**
 * Weight of the (0-1) deposit-proximity component in the total score.
 *
 * Second-highest: mineral access drives the colony's long-run economy (ore
 * for construction, propellant feedstock, etc.), but — unlike buildability —
 * a distant deposit is a logistics cost the colony can pay down over time
 * with rovers/pipelines rather than a site the colony simply cannot use.
 */
export const DEPOSIT_PROXIMITY_WEIGHT = 0.35

/**
 * Weight of the (0-1) hull-separation PENALTY in the total score (subtracted).
 *
 * Lowest of the three: a split colony costs power-line and service overhead,
 * which is a real but soft tax compared to unbuildable ground or being
 * stranded far from every mineral deposit. Still large enough that
 * maximally-separated hulls visibly cost the player points — the whole point
 * of scoring this factor at all.
 */
export const HULL_SEPARATION_PENALTY_WEIGHT = 0.3

/**
 * Distance (in tiles) at which the deposit-proximity component has decayed
 * to exactly 0.5. Chosen as a fraction of a typical playable grid so
 * proximity meaningfully discriminates between "in the neighbourhood" and
 * "across the map" without needing a hand-tuned lookup table.
 */
export const DEPOSIT_PROXIMITY_HALF_DISTANCE = 10

/**
 * Distance (in tiles) at which the hull-separation penalty has risen to
 * exactly 0.5. Kept larger than `DEPOSIT_PROXIMITY_HALF_DISTANCE`: the two
 * hulls are expected to sit closer together than "the nearest deposit" for a
 * well-chosen site, so separation should only bite hard once the hulls are
 * genuinely far apart.
 */
export const HULL_SEPARATION_HALF_DISTANCE = 15

/** The three independent components that make up a site's total score, plus the total itself. */
export interface ScoreBreakdown {
  /** Average sanitised buildability across both hulls' footprints, in [0, 1]. Higher is flatter. */
  readonly buildability: number
  /** Average deposit-proximity score across both hulls' anchors, in [0, 1]. Higher is closer. */
  readonly depositProximity: number
  /** Separation penalty between the two hulls, in [0, 1). Higher means farther apart (worse). */
  readonly hullSeparationPenalty: number
  /** The weighted total, scaled to `[0, SCORE_SCALE]` and always finite. */
  readonly total: number
}

export interface ScoreLandingSiteParams {
  readonly droneHullAnchor: Coord
  readonly reactorHullAnchor: Coord
  readonly mineralDeposits: readonly Coord[]
  readonly buildabilityScore: BuildabilityScorer
}

function euclideanDistance(a: Coord, b: Coord): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The distance from `point` to the nearest of `targets`, or `Number.POSITIVE_INFINITY`
 * if `targets` is empty.
 *
 * Returning `Infinity` for the empty-map case (rather than `undefined`, forcing every
 * caller to branch) is deliberate: `decayScore` maps an infinite distance to exactly 0,
 * so "there are no deposits anywhere" falls out of the normal formula as the correct,
 * finite answer instead of needing a special case threaded through the caller.
 */
function nearestDistance(point: Coord, targets: readonly Coord[]): number {
  let min = Number.POSITIVE_INFINITY
  for (const target of targets) {
    const distance = euclideanDistance(point, target)
    if (distance < min) min = distance
  }
  return min
}

/**
 * Hyperbolic decay: 1 at `distance === 0`, exactly 0.5 at `distance === halfDistance`,
 * tending to 0 as `distance -> Infinity` (including the literal `Infinity` `nearestDistance`
 * returns for zero deposits, which maps here to exactly 0 — never `NaN`).
 */
function decayScore(distance: number, halfDistance: number): number {
  return halfDistance / (halfDistance + distance)
}

/**
 * Hyperbolic saturation: 0 at `distance === 0`, exactly 0.5 at `distance === halfDistance`,
 * tending to (but never reaching) 1 as `distance -> Infinity`. The mirror image of
 * `decayScore`, chosen so both distance-based components share one well-understood,
 * bounded, strictly-monotonic shape.
 */
function saturatingPenalty(distance: number, halfDistance: number): number {
  return distance / (distance + halfDistance)
}

/** Average, over both hull anchors, of the decayed distance to the nearest mineral deposit. */
function averageDepositProximity(anchors: readonly Coord[], deposits: readonly Coord[]): number {
  let sum = 0
  for (const anchor of anchors) {
    sum += decayScore(nearestDistance(anchor, deposits), DEPOSIT_PROXIMITY_HALF_DISTANCE)
  }
  return sum / anchors.length
}

/**
 * Score a candidate landing site for both hulls.
 *
 * Does NOT validate the site — a caller that wants rejection semantics
 * (out-of-bounds, unbuildable, overlap) should call `validateLandingSite`
 * first via `evaluateLanding`. This function is deliberately total (never
 * fails, never throws) so it can also be used to compare and rank hypothetical
 * sites during search/AI evaluation, where most candidates are never actually
 * applied.
 *
 * The total is a weighted sum of three independent components: buildability
 * and deposit proximity each in [0, 1] and contribute positively; hull
 * separation is in [0, 1) and contributes a penalty (subtracted). Every
 * distance-derived component is bounded by construction
 * (`decayScore`/`saturatingPenalty` are hyperbolic, never diverging), and
 * every buildability-callback value is sanitised via `clamp01` before use, so
 * the weighted sum is guaranteed finite regardless of adversarial inputs (a
 * misbehaving scorer, zero deposits on the map, or hulls placed at opposite
 * corners of the largest legal grid).
 *
 * `total` is floored at 0 (a heavy separation penalty against near-zero
 * buildability/proximity can otherwise go negative) and, by construction,
 * never needs an UPPER clamp to stay within `[0, SCORE_SCALE]`:
 * `BUILDABILITY_WEIGHT + DEPOSIT_PROXIMITY_WEIGHT <= 1`, so the positive
 * contribution alone can never reach `SCORE_SCALE`, before the separation
 * penalty even subtracts anything. An upper clamp was deliberately left out
 * rather than added as unreachable, untested "just in case" code — if a
 * future change to the weights ever violates that invariant, the
 * `'named scoring weight constants'` test in landing.test.ts asserting
 * `BUILDABILITY_WEIGHT + DEPOSIT_PROXIMITY_WEIGHT <= 1` is the guard that
 * should catch it, at which point an upper clamp should be reintroduced
 * alongside a test that actually exercises it.
 */
export function scoreLandingSite(params: ScoreLandingSiteParams): ScoreBreakdown {
  const { droneHullAnchor, reactorHullAnchor, mineralDeposits, buildabilityScore } = params

  const droneHullTiles = resolveHullFootprint(droneHullAnchor)
  const reactorHullTiles = resolveHullFootprint(reactorHullAnchor)

  const buildability =
    (clamp01(buildabilityScore(droneHullTiles)) + clamp01(buildabilityScore(reactorHullTiles))) / 2

  const depositProximity = averageDepositProximity(
    [droneHullAnchor, reactorHullAnchor],
    mineralDeposits,
  )

  const separationDistance = euclideanDistance(droneHullAnchor, reactorHullAnchor)
  const hullSeparationPenalty = saturatingPenalty(separationDistance, HULL_SEPARATION_HALF_DISTANCE)

  const rawTotal =
    SCORE_SCALE *
    (BUILDABILITY_WEIGHT * buildability +
      DEPOSIT_PROXIMITY_WEIGHT * depositProximity -
      HULL_SEPARATION_PENALTY_WEIGHT * hullSeparationPenalty)

  return {
    buildability,
    depositProximity,
    hullSeparationPenalty,
    // See this function's docstring for why only a floor (never an upper
    // clamp) is needed here.
    total: Math.max(0, rawTotal),
  }
}

// ---------------------------------------------------------------------------
// Mission readiness
// ---------------------------------------------------------------------------

/**
 * The player's current landing choice: each hull is either anchored somewhere
 * on the grid, or not yet placed (`null`). `null` rather than `undefined` is
 * used for "not yet placed" so a caller building this object from, say, a UI
 * form's state cannot accidentally omit the key and have it silently read as
 * "placed" via `undefined !== null`-style bugs.
 */
export interface LandingSelection {
  readonly droneHullAnchor: Coord | null
  readonly reactorHullAnchor: Coord | null
}

/** Neither hull's placement is enough on its own — the mission cannot start with only one hull down. */
export interface IncompleteLanding {
  readonly status: 'incomplete'
  readonly missingHulls: readonly HullId[]
}

/** Both hulls are placed, but the site itself is invalid. Carries the exact typed rejection. */
export interface RejectedLanding {
  readonly status: 'rejected'
  readonly rejection: LandingRejection
}

/** Both hulls are placed and the site is valid: a score is available. */
export interface ReadyLanding {
  readonly status: 'ready'
  /** Equal to `breakdown.total` — surfaced directly so a caller need not reach into `breakdown`. */
  readonly score: number
  readonly breakdown: ScoreBreakdown
  readonly droneHullTiles: readonly Coord[]
  readonly reactorHullTiles: readonly Coord[]
}

/**
 * The three possible states of the opening move, as a discriminated union on
 * `status`. Deliberately distinct from `LandingValidationResult`: "only one
 * hull chosen so far" (`incomplete`) is a different kind of not-ready-yet than
 * "both hulls chosen, but that placement is illegal" (`rejected` and
 * `LandingRejection`'s three reasons) — collapsing them would make a caller
 * unable to tell "keep picking" from "pick again".
 */
export type LandingReadiness = IncompleteLanding | RejectedLanding | ReadyLanding

export interface EvaluateLandingParams {
  readonly grid: Grid
  readonly selection: LandingSelection
  readonly mineralDeposits: readonly Coord[]
  readonly buildabilityScore: BuildabilityScorer
}

/**
 * Narrows `selection` to both anchors present. A named type guard (rather
 * than an inline `!== null` check followed by a cast) is what lets
 * `evaluateLanding` use `selection.droneHullAnchor`/`reactorHullAnchor`
 * directly as `Coord` afterwards with no unsafe cast anywhere in this module.
 */
function isCompleteSelection(
  selection: LandingSelection,
): selection is { droneHullAnchor: Coord; reactorHullAnchor: Coord } {
  return selection.droneHullAnchor !== null && selection.reactorHullAnchor !== null
}

/**
 * Evaluate the player's current landing choice end to end: incomplete (fewer
 * than two hulls placed) -> rejected (both placed, but illegal) -> ready
 * (scored). This is the single entry point a caller (UI, AI planner, test)
 * needs for "is the opening move done, and if so, how good is it" — it never
 * throws, for the same reason `validateLandingSite` doesn't: every branch
 * here is an ordinary state of an in-progress player decision, not a
 * programmer error.
 */
export function evaluateLanding(params: EvaluateLandingParams): LandingReadiness {
  const { grid, selection, mineralDeposits, buildabilityScore } = params

  if (!isCompleteSelection(selection)) {
    const missingHulls: HullId[] = []
    if (selection.droneHullAnchor === null) missingHulls.push('drone-hull')
    if (selection.reactorHullAnchor === null) missingHulls.push('reactor-hull')
    return { status: 'incomplete', missingHulls }
  }

  const { droneHullAnchor, reactorHullAnchor } = selection

  const validation = validateLandingSite(grid, droneHullAnchor, reactorHullAnchor, buildabilityScore)
  if (!validation.ok) {
    return { status: 'rejected', rejection: validation }
  }

  const breakdown = scoreLandingSite({
    droneHullAnchor,
    reactorHullAnchor,
    mineralDeposits,
    buildabilityScore,
  })

  return {
    status: 'ready',
    score: breakdown.total,
    breakdown,
    droneHullTiles: validation.droneHullTiles,
    reactorHullTiles: validation.reactorHullTiles,
  }
}
