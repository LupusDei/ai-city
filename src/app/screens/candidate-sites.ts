/**
 * The candidate touchdown points the survey screen offers, and the geometry of their markers.
 *
 * ============================================================================
 * WHY THE SCREEN OFFERS A LATTICE RATHER THAN EVERY TILE
 * ----------------------------------------------------------------------------
 * A 64x64 map has 3,844 legal 2x2 hull anchors. Presenting all of them is not a decision,
 * it is a shrug: the player has no basis on which to prefer (17, 23) over (17, 24), the
 * score difference between neighbouring tiles is below the resolution of the readout, and
 * 3,844 focusable buttons over a canvas is a keyboard-navigation and rendering problem for
 * no gain in agency.
 *
 * So the survey plots ONE candidate at the centre of each cell of the map's own graticule
 * (`render-world.ts`'s `GRATICULE_TILE_INTERVAL`, 8 tiles). That gives 64 genuinely
 * different sites — different terrain, different distance to the nearest deposit, different
 * separation from every other candidate — which is the number of choices that makes the
 * opening move a decision rather than a chore. It also means the markers land ON the grid
 * the map already draws, so the affordance reads as part of the survey instrument rather
 * than as an overlay someone bolted on.
 * ============================================================================
 *
 * ============================================================================
 * WHY LEGALITY IS PRE-FILTERED HERE — AND WHY IT IS NOT GAME LOGIC
 * ----------------------------------------------------------------------------
 * `evaluateLanding` only validates a site once BOTH anchors are down: a single anchor can
 * only ever be `incomplete`. So an illegal FIRST anchor is accepted at the time it is
 * clicked and only surfaces on the SECOND click, reported against `drone-hull` — a
 * rejection the player cannot connect to the click that caused it. The sim is right to work
 * this way (a landing is a pair, and that is what it validates), which means the screen must
 * not OFFER an anchor the sim will refuse.
 *
 * Constitution §4 forbids game logic in components, and this is not it. `legal` is not a
 * second opinion about a landing: it is `isInBounds` — the sim's own predicate — applied to
 * `resolveHullFootprint` — the sim's own footprint resolution. Both are pure reads, and both
 * are the exact functions `validateLandingSite` uses for its `out-of-bounds` check. Nothing
 * here decides buildability, proximity, separation or overlap; those are the sim's, and the
 * screen learns them only from `LandingReadiness`.
 *
 * Note what is deliberately NOT pre-filtered: `unbuildable` and `overlapping-hulls`.
 * Overlap is a property of the PAIR and cannot be known when a lattice is built, and it is
 * the refusal spec 005's AC-2.3 exercises — clicking one candidate twice must produce the
 * sim's `overlapping-hulls`, so an already-chosen candidate stays live rather than being
 * disabled out of the way. `unbuildable` is unreachable on a generated world in practice
 * (buildability is `1 - normalised slope`; the measured minimum across the lattice is ~0.70)
 * and is the sim's call regardless.
 * ============================================================================
 *
 * DETERMINISM. Pure functions of their arguments: no clock, no randomness, no `Set`/`Map`
 * iteration, and a fixed row-major emission order matching the sim's own `y * width + x`
 * tile storage. Spec 005's AC-1.3 compares the rendered map byte for byte across a reload,
 * and the marker layer sits on top of that canvas — so the markers' own positions have to
 * be as reproducible as the terrain underneath them.
 */

import type { BuildabilityMap } from '../../sim/buildability'
import type { Coord, Grid } from '../../sim/grid'
import { isInBounds } from '../../sim/grid'
import type { HullId, LandingSelection } from '../../sim/landing'
import { resolveHullFootprint } from '../../sim/landing'
import { buildabilityScorerFor } from '../../sim/world'

/**
 * Tiles between candidate anchors: 8, matching `render-world.ts`'s `GRATICULE_TILE_INTERVAL`.
 *
 * Not merely a similar number — the same one, for the reason in the header: a candidate per
 * graticule cell makes the lattice legible against a grid the map already draws. The two
 * constants are deliberately NOT shared through an import, because they answer different
 * questions (how often to rule the map, versus how far apart to plot survey candidates) and
 * a future change to one should not silently move the other.
 */
export const CANDIDATE_LATTICE_SPACING = 8

/**
 * Where the first candidate anchor sits: 3 tiles in.
 *
 * Chosen so a 2x2 footprint is CENTRED in its graticule cell rather than merely inside it.
 * At tile size 8 a cell spans 64 device pixels; an anchor at 3 puts the footprint across
 * pixels 24-40, whose midpoint is 32 — the cell's exact centre. An anchor at 4 (the obvious
 * "half of 8") would put it at 32-48, eight pixels off centre, and 64 markers each eight
 * pixels off would read as a misaligned overlay rather than as the survey's own plot.
 *
 * It also keeps the last lattice anchor at 59 on the ratified map, whose footprint ends at
 * 60 — comfortably inside 64, so no candidate on the ratified map is ever offered disabled.
 */
export const CANDIDATE_LATTICE_OFFSET = 3

/**
 * Extra device pixels around a marker's footprint box, so the click target is larger than
 * the 2x2 footprint it depicts.
 *
 * The marker must show the footprint at its true size — a hull is 2x2 tiles and drawing it
 * bigger would misinform the player about what they are placing — but 16 device pixels is a
 * mean target for a pointer. The button box is therefore inflated by this margin on every
 * side while its visible footprint stays exact, giving a 24px target around a 16px mark. It
 * is an even number so the inflation splits evenly and the box stays on whole pixels: a
 * half-pixel offset would put the marker layer on a different subpixel grid than the canvas
 * beneath it.
 */
export const CANDIDATE_TOUCH_MARGIN = 8

/** One candidate touchdown point the survey offers the player. */
export interface CandidateSite {
  /** The anchor tile — the footprint's top-left, which is what a `select-site` intent takes. */
  readonly anchor: Coord
  /**
   * The absolute tiles a hull anchored here would occupy, resolved by the sim's own
   * `resolveHullFootprint`. Carried so the screen never re-derives a footprint.
   */
  readonly tiles: readonly Coord[]
  /**
   * Whether the footprint sits entirely inside the grid — the sim's `isInBounds` over every
   * resolved tile. `false` means the screen must offer the marker `disabled`; see the header
   * for why an illegal anchor must never be clickable.
   */
  readonly legal: boolean
}

/** Options for {@link candidateSites}. Both default to the exported lattice constants. */
export interface CandidateLatticeOptions {
  readonly spacing?: number
  readonly offset?: number
}

/**
 * Plot the candidate lattice over `grid`, row-major.
 *
 * @throws {RangeError} if `spacing` is not a positive finite number. A zero or negative
 *   spacing is a non-terminating loop, not a degraded lattice, so it fails loudly rather
 *   than hanging the page — and it can only ever be a programmer error, never player input.
 */
export function candidateSites(
  grid: Grid,
  options: CandidateLatticeOptions = {},
): readonly CandidateSite[] {
  const spacing = options.spacing ?? CANDIDATE_LATTICE_SPACING
  const offset = options.offset ?? CANDIDATE_LATTICE_OFFSET

  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new RangeError(`Candidate lattice spacing must be a positive number; received: ${spacing}`)
  }

  const sites: CandidateSite[] = []
  // Row-major, matching the sim's own tile storage order, so the DOM order of the markers
  // and the sim's tile order are the same sequence. The acceptance suite selects candidates
  // positionally (`nth(0)`, `nth(2)`), so this order is part of the contract.
  for (let y = offset; y < grid.height; y += spacing) {
    for (let x = offset; x < grid.width; x += spacing) {
      const anchor: Coord = { x, y }
      const tiles = resolveHullFootprint(anchor)
      sites.push({ anchor, tiles, legal: tiles.every((tile) => isInBounds(grid, tile)) })
    }
  }
  return sites
}

/**
 * The acceptance contract's testid for a candidate at `anchor`: `candidate-site-${x}-${y}`.
 *
 * The suite matches on the `candidate-site` PREFIX and then indexes positionally, so the
 * suffix is not what it selects by — it is what makes a failing trace readable, naming the
 * tile a click landed on instead of leaving a reviewer to count DOM nodes.
 */
export function candidateTestId(anchor: Coord): string {
  return `candidate-site-${anchor.x}-${anchor.y}`
}

/**
 * Which hull, if any, the player has already committed at exactly `anchor`.
 *
 * Compares ANCHORS, not footprints. A neighbouring candidate whose footprint overlaps a
 * committed hull is not "occupied" — it is a site the sim will refuse with
 * `overlapping-hulls`, and letting the player discover that from the sim is the point of
 * FR-006. Reporting it as occupied here would be this module forming an opinion about a
 * landing, which is exactly what it must not do.
 *
 * Bookkeeping over the PLAYER'S OWN INPUT, in the same spirit as the adapter's
 * `placedHulls`: it asks the sim nothing and decides nothing.
 */
export function occupantOf(selection: LandingSelection, anchor: Coord): HullId | null {
  if (isSameTile(selection.droneHullAnchor, anchor)) return 'drone-hull'
  if (isSameTile(selection.reactorHullAnchor, anchor)) return 'reactor-hull'
  return null
}

function isSameTile(a: Coord | null, b: Coord): boolean {
  return a !== null && a.x === b.x && a.y === b.y
}

// ---------------------------------------------------------------------------
// Ground quality — the reason to prefer one candidate to another
// ---------------------------------------------------------------------------

/**
 * The sim's own buildability reading for each candidate's footprint, in lattice order.
 *
 * WHY A MARKER CARRIES A GROUND READING. Sixty-four identically-drawn markers are not a
 * decision, they are a shrug — the player has no basis on which to prefer any of them. The
 * basis EXISTS and the map already draws it: `render-world.ts` shades every tile by
 * buildability, darkening toward basalt over steep ground, and the legend teaches exactly
 * that. Drawing every marker the same discards it, and drawing an opaque marker over it
 * discarded it twice.
 *
 * AND IT IS NOT GAME LOGIC (constitution §4). The distinction §4 draws is between a
 * component DECIDING something the sim owns and a component DISPLAYING something the sim
 * has already computed — and FR-002 positively requires the second. `render-world.ts` is the
 * standing precedent: it reads `buildabilityAt` and renders it as colour, because rendering
 * a sim value as ink is presentation. This aggregates over a footprint instead of a tile,
 * and it does so with `buildabilityScorerFor` — the SIM'S OWN aggregator, the exact function
 * `colony-start.ts` hands to `scoreLandingSite` — over `resolveHullFootprint`'s own tiles.
 *
 * So nothing here invents a weighting, and nothing here forms an opinion about a landing.
 * Note in particular what this deliberately does NOT do: it does not rank the candidates,
 * sort them, pick a best one, threshold them into good/bad bands, or normalise one marker's
 * ink against what the others scored. Each reticle carries the ground that is under it and
 * nothing about any other site. The moment a function in this file needs to know which of
 * two sites is better, that rule belongs in `src/sim/` and the answer belongs on
 * `LandingReadiness`.
 *
 * MINIMUM, NOT MEAN — because that is what the sim's scorer does, and for the sim's reason:
 * a foundation is only as good as its worst tile, and averaging would let three flat tiles
 * carry a cliff tile and advertise a site the validator would then refuse.
 */
export function candidateGrounds(
  sites: readonly CandidateSite[],
  buildability: BuildabilityMap,
): readonly number[] {
  // One scorer for the whole lattice rather than one per site: `buildabilityScorerFor`
  // returns a closure over the map, and building sixty-four identical ones would be waste
  // that says something misleading about the cost of a ground reading.
  const score = buildabilityScorerFor(buildability)
  return sites.map((site) => score(site.tiles))
}

/**
 * Footprint buildability at or below which a reticle draws at its faintest, and at or above
 * which it draws at its strongest: 0.70 and 0.90.
 *
 * CHOSEN FROM MEASURED TERRAIN, not from the nominal [0, 1] domain — the same method, and
 * the same problem, as `mars-palette.ts`'s `SLOPE_SHADE_GAIN`. Footprint buildability across
 * the lattice was sampled at three seeds and spans roughly [0.70, 0.92], with the middle
 * half inside [0.81, 0.85]: the fractal heightmap is smooth, so a 2x2 footprint almost never
 * straddles anything dramatic. Mapping [0, 1] onto the ink range would therefore compress
 * every marker on the map into the top tenth of it and read as a flat wash — sixty-four
 * markers that are technically different and visually identical, which is the defect this
 * encoding exists to fix, surviving in a form that is harder to notice.
 *
 * Anchoring the ramp on the measured band instead spends the whole ink range where the real
 * values actually live. Both ends CLAMP rather than extrapolate, so a future generator that
 * produces flatter or rougher ground degrades to "as good as the scale shows" rather than to
 * an invisible or over-saturated marker.
 *
 * These are presentation constants and nothing reads them as a rule: no site is refused,
 * preferred or scored by them. A site at 0.70 is offered exactly as clickable as one at
 * 0.92, and `evaluateLanding` remains the only thing with an opinion about either.
 */
export const GROUND_INK_FLOOR = 0.7
export const GROUND_INK_CEILING = 0.9

/** The faintest and strongest a reticle's ticks are ever drawn. */
const MIN_GROUND_INK = 0.14
const MAX_GROUND_INK = 0.96

/**
 * Decimal places in the emitted ink string.
 *
 * FIXED PRECISION, for the reason `mars-palette.ts` fixes its colour strings: AC-1.3
 * compares the marker layer byte for byte across a reload, and a float rendered by default
 * `toString` is one representation change away from a different CSS value. Three places is
 * far finer than the eye can resolve in an alpha and still an exact, stable string.
 */
const GROUND_INK_DECIMALS = 3

/**
 * How strongly a reticle is inked for a footprint of the given buildability, as an alpha
 * string for the marker's `--ground-ink` custom property.
 *
 * Linear between {@link GROUND_INK_FLOOR} and {@link GROUND_INK_CEILING}, and strictly
 * monotonic across that band — the one property the encoding must have, since anything
 * non-monotonic would actively mislead a player into reading a worse site as a better one.
 *
 * A non-finite reading inks at the MINIMUM. Same false-negative-over-false-positive
 * direction as `slopeShadeAlpha` and `buildabilityScorerFor`: unknown ground that advertised
 * itself as the strongest site on the map would invite the player to spend a hull on it.
 */
export function groundInk(ground: number): string {
  if (!Number.isFinite(ground)) return MIN_GROUND_INK.toFixed(GROUND_INK_DECIMALS)

  const span = GROUND_INK_CEILING - GROUND_INK_FLOOR
  const position = (ground - GROUND_INK_FLOOR) / span
  const clamped = Math.min(1, Math.max(0, position))
  const ink = MIN_GROUND_INK + (MAX_GROUND_INK - MIN_GROUND_INK) * clamped
  return ink.toFixed(GROUND_INK_DECIMALS)
}

/**
 * The shortest and longest a reticle's corner arms are drawn, in device pixels.
 *
 * A SECOND CHANNEL FOR THE SAME READING, and it earns its keep. Ink alone was measurably
 * present and visually weak: the markers sit on terrain of every brightness, so an alpha
 * difference that is obvious over dark basalt is nearly invisible over pale dust, and the
 * player scanning the map reads shape faster than they read contrast. Arm length is immune
 * to what is underneath it. Encoding one value twice is the same argument `mars-palette.ts`
 * makes for giving deposit markers both a hue AND a silhouette.
 *
 * 7px maximum against a 20px footprint at the survey tile size: two arms plus a gap, so the
 * brackets never close into the filled box this reticle exists to replace.
 */
const MIN_TICK_PX = 3
const MAX_TICK_PX = 7

/**
 * The corner-arm length for a footprint of the given buildability, in whole device pixels.
 *
 * WHOLE PIXELS, hence quantised — about five distinct lengths across the measured band. That
 * is a rendering constraint rather than a judgement, and the distinction matters: the arms
 * land on the same pixel grid as the canvas beneath them (AC-1.3), exactly as the marker box
 * does. It is NOT a banding of sites into quality tiers — no band means anything, nothing is
 * refused or preferred by it, and the underlying ink stays continuous so two sites one step
 * apart in length are still told apart by their inking.
 *
 * Rounded rather than floored so the mapping is symmetric about each step, and clamped at
 * both ends by {@link groundInk}'s own floor and ceiling so the two channels always agree
 * about which end of the scale a site sits at.
 */
export function groundTickLength(ground: number): number {
  // Reuses the ink's own normalised position, so the two encodings cannot drift apart and
  // say different things about the same footprint.
  const position = (Number(groundInk(ground)) - MIN_GROUND_INK) / (MAX_GROUND_INK - MIN_GROUND_INK)
  return Math.round(MIN_TICK_PX + (MAX_TICK_PX - MIN_TICK_PX) * position)
}

/** A marker's absolute box within the rendered map, in device pixels. */
export interface CandidateMarkerBox {
  readonly left: number
  readonly top: number
  /** The clickable box: the footprint inflated by {@link CANDIDATE_TOUCH_MARGIN}. */
  readonly size: number
  /** The visible mark: the hull footprint at its true size. */
  readonly footprintSize: number
}

/**
 * Where a candidate's marker sits over a map drawn at `tileSize` device pixels per tile.
 *
 * Positioned from the world and the tile size ALONE — never from a measured element. That
 * is the same constraint `TerrainCanvas` obeys and for the same reason: the marker layer is
 * painted over the canvas AC-1.3 screenshots byte for byte, so anything layout-dependent in
 * these numbers would put font loading and scrollbar presence into a determinism check.
 */
export function candidateMarkerBox(anchor: Coord, tileSize: number): CandidateMarkerBox {
  // Two tiles: the hull footprint is 2x2 (`HULL_FOOTPRINT`).
  const footprintSize = tileSize * 2
  const size = footprintSize + CANDIDATE_TOUCH_MARGIN
  const inset = CANDIDATE_TOUCH_MARGIN / 2
  return {
    left: anchor.x * tileSize - inset,
    top: anchor.y * tileSize - inset,
    size,
    footprintSize,
  }
}
