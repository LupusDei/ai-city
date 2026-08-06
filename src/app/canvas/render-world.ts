/**
 * Draws a `World` onto a 2D canvas. Reads simulation state; decides nothing about it.
 *
 * CONSTITUTION §4 — NO GAME LOGIC IN THE RENDERER. Everything below is a projection of
 * numbers the sim has already produced onto pixels. It calls `elevationAt` and
 * `buildabilityAt` and reads `world.deposits`, and that is the whole of its relationship
 * with the simulation: no thresholds of its own, no derived statistics over the map, no
 * decision a rule in `src/sim/` could disagree with. Delete this file and the simulation
 * is unchanged; that is the test of whether a renderer has stayed a renderer.
 *
 * WHY THE DRAWING IS HERE AND NOT IN THE COMPONENT. `TerrainCanvas.tsx` is a thin mount:
 * it owns a `<canvas>` ref and calls `renderWorld` once. All the logic lives in this
 * plain `.ts` module for two reasons. First, coverage — `src/app/**\/*.tsx` is excluded
 * from the coverage gate but pure `.ts` under `src/app/` is not, and this is code that
 * unit tests genuinely can pin down. Second, and more important, it makes AC-1.3
 * testable in milliseconds instead of only through a screenshot; see `Painter2D`.
 *
 * ── DETERMINISM (spec 005 AC-1.3: byte-identical terrain across a page reload) ────────
 *
 * This is the primary requirement of this module, not a property of it. A reload does not
 * re-render the same `World` object — it regenerates one from the seed and renders that —
 * so the guarantee needed is that equal-by-value worlds produce equal-by-value pixels.
 * Everything that could break it is excluded by construction:
 *
 *   - NO RANDOMNESS. Nothing here calls `Math.random`; every colour and coordinate is a
 *     function of the world and the tile size.
 *   - NO CLOCK, NO ANIMATION. One synchronous pass, no `requestAnimationFrame`, no
 *     transitions, no interpolation against elapsed time. The same world drawn a second
 *     later is the same picture.
 *   - NO DEVICE-PIXEL-RATIO DEPENDENCE. The backing store is sized purely from the world
 *     and the tile size, and `TerrainCanvas` sets the CSS size to match it exactly. A
 *     `devicePixelRatio` multiplier is the standard way to make a canvas crisp and it
 *     would put a resampling step between the render and the bytes compared by AC-1.3.
 *     Crispness is instead obtained by making one canvas pixel one tile pixel.
 *   - NO CONTAINER MEASUREMENT. Nothing is derived from a measured element size, so no
 *     part of the picture depends on layout, font loading or scroll position — all of
 *     which can settle differently between two loads of the same page.
 *   - NO AMBIENT CONTEXT STATE. The first thing done is a transform reset, and every
 *     style is assigned before use. The picture is therefore independent of anything
 *     drawn before it, which is what makes a redraw idempotent under React StrictMode's
 *     deliberate double-invoke.
 *   - NO TEXT. Not one `fillText`. Glyph rasterisation depends on which fonts have
 *     finished loading, and a label that renders in a fallback face on the first load and
 *     the real face on the second is a byte difference with no visible cause.
 *   - FIXED ITERATION ORDER. Tiles row-major (matching the sim's own `y * width + x`
 *     storage), deposits in array order, and no iteration over a `Map`, `Set` or object's
 *     keys anywhere. Same ban, and the same reason, as `src/sim/buildability.ts`.
 *   - FIXED-PRECISION COLOUR STRINGS. See `mars-palette.ts`.
 *
 * ── WHAT IS DRAWN, AND WHY IN THIS ORDER ─────────────────────────────────────────────
 *
 *   1. Void — the whole extent, opaquely, so no pixel is ever left transparent to
 *      composite against the page's own background.
 *   2. Elevation — the shaded Mars base, one rectangle per tile.
 *   3. Slope shade — buildability, as a basalt darkening over steep ground. Flat, fully
 *      buildable ground gets no overlay at all, so clean iron-oxide red reads as
 *      buildable with no legend required.
 *   4. Graticule — a faint survey grid every `GRATICULE_TILE_INTERVAL` tiles, for
 *      judging distance and hull separation by eye.
 *   5. Deposits — last, so a marker is never painted over by the ground beneath it,
 *      differentiated by `kind` in both silhouette and colour.
 *
 * Layers 2 and 3 are separate full passes rather than interleaved per tile. Interleaving
 * would produce the same picture today only because the shade never leaves its own tile;
 * keeping them as passes makes the layering a property of the code rather than a
 * coincidence of the current shade shape.
 */

import { buildabilityAt } from '../../sim/buildability'
import { elevationAt } from '../../sim/terrain'
import type { World } from '../../sim/world'
import type { DepositMarker, Rgb } from './mars-palette'
import {
  MARS_VOID,
  SLOPE_SHADE,
  depositMarker,
  elevationColour,
  rgbCss,
  rgbaCss,
  slopeShadeAlpha,
} from './mars-palette'

/**
 * The subset of `CanvasRenderingContext2D` this renderer uses — eleven members, all of
 * them 2D-context standards.
 *
 * WHY NARROW THE CONTEXT AT ALL. Because it is what makes AC-1.3 testable without a
 * browser. A `CanvasRenderingContext2D` cannot be constructed in Node and cannot be
 * inspected once drawn to; a `Painter2D` can be a RECORDING fake that appends every style
 * assignment and draw call to an ordered trace. Rendering twice and comparing traces then
 * proves determinism directly, and — unlike a screenshot comparison, which can only say
 * that two images differ — it localises any divergence to a single call. It also catches
 * float-formatting drift and iteration-order changes, which a low-resolution screenshot
 * might round away entirely. See `tests/unit/render-world.test.ts`.
 *
 * The style properties keep the DOM's own `string | CanvasGradient | CanvasPattern` type
 * rather than narrowing to `string`, because TypeScript compares mutable properties
 * invariantly enough that narrowing them would stop a real `CanvasRenderingContext2D`
 * being assignable to this interface — and that assignability, exercised where
 * `TerrainCanvas.tsx` passes a real context straight in, is the compile-time proof that
 * this interface has not drifted from the real thing.
 */
export interface Painter2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void
  fill(): void
  stroke(): void
}

/**
 * Device pixels per tile when the caller does not choose: 8.
 *
 * Sized so the ratified 64x64 map is 512x512 — comfortably inside a 1280x720 viewport
 * alongside a page heading, which means the acceptance suite's element screenshot never
 * needs to scroll or stitch, and scroll position can therefore never enter the bytes
 * AC-1.3 compares. It is also the smallest tile that still leaves room for a legible
 * deposit marker at `DEPOSIT_RADIUS_RATIO`.
 */
export const DEFAULT_TILE_SIZE = 8

/** Tiles between graticule rules: 8, so the default 64-tile map is ruled into eighths. */
export const GRATICULE_TILE_INTERVAL = 8

/**
 * Below this tile size the graticule is omitted entirely.
 *
 * At two or three pixels per tile a rule every eight tiles is a quarter of the ink on
 * screen and the terrain disappears behind its own grid. Omitting it is also what
 * guarantees the graticule's step is never zero, so its loops always terminate.
 */
export const GRATICULE_MIN_TILE_SIZE = 3

/** Graticule ink: cold and very faint, so it reads as an instrument overlay, not terrain. */
const GRATICULE_COLOUR: Rgb = { r: 236, g: 226, b: 216 }
const GRATICULE_ALPHA = 0.12

/**
 * Deposit marker radius as a fraction of the tile, and its floor in device pixels.
 *
 * 0.45 rather than something more modest because this was checked against the rendered
 * image rather than reasoned about. At 0.32 — a 2.5 px radius on a default 8 px tile — a
 * diamond and a disc are both simply a dot: the SHAPE differentiation `DEPOSIT_MARKERS`
 * exists to provide was arithmetically present and visually absent, leaving hue as the
 * only cue and defeating the point of encoding kind twice. At 0.45 the silhouette is
 * 7 px across and reads, while still fitting inside its own tile.
 */
const DEPOSIT_RADIUS_RATIO = 0.45
const MIN_DEPOSIT_RADIUS = 2

const TAU = Math.PI * 2

/** The size of a rendered world's backing store, in device pixels. */
export interface CanvasPixelSize {
  readonly width: number
  readonly height: number
}

/** Options for {@link renderWorld}. */
export interface RenderWorldOptions {
  /** Device pixels per tile. Defaults to {@link DEFAULT_TILE_SIZE}. */
  readonly tileSize?: number
}

/**
 * Normalise a caller-supplied tile size to a whole, non-negative number of pixels.
 *
 * Floored rather than rounded, and clamped at 0 rather than allowed negative, because
 * both alternatives end badly at the DOM boundary: a fractional canvas `width` is rounded
 * by the browser in a way not worth leaving to a byte-comparison test, and a negative one
 * throws `IndexSizeError`. Spec 005's zero-size-canvas edge case requires not throwing,
 * so a nonsensical tile size degrades to an empty canvas.
 *
 * EXPORTED (not private) because the colony renderer needs to agree with it exactly. It was
 * briefly duplicated there — deliberately, to avoid editing this module while two screens
 * were being redesigned in parallel against it, which was the right call at the time. But a
 * six-line copy of a rule in a determinism-critical path is the same drift risk that made
 * us delete the second copy of `mulberry32` earlier in this project: two implementations
 * that agree today and are free to disagree tomorrow, with nothing failing when they do.
 */
export function normaliseTileSize(tileSize: number): number {
  if (!Number.isFinite(tileSize) || tileSize <= 0) return 0
  return Math.floor(tileSize)
}

/**
 * The backing-store size needed to draw `world` at `tileSize` device pixels per tile.
 *
 * Exported because `TerrainCanvas` needs exactly the number `renderWorld` will draw to,
 * and computing it twice in two places is how a canvas ends up with a backing store a
 * pixel short of its picture.
 *
 * Measured from `world.grid`, not `world.terrain`. The two agree by construction in
 * `generateWorld`, but the grid is the authoritative PLAYABLE extent — it is what
 * `validateLandingSite` bounds-checks against — so the canvas shows exactly the area the
 * player can act on. Elevation and buildability are read through their own bounds-checked
 * accessors, so a mismatch degrades to void tiles rather than to an out-of-bounds read.
 */
export function worldPixelSize(world: World, tileSize: number = DEFAULT_TILE_SIZE): CanvasPixelSize {
  const size = normaliseTileSize(tileSize)
  return {
    width: Math.max(0, world.grid.width) * size,
    height: Math.max(0, world.grid.height) * size,
  }
}

/**
 * Draw `world` to `painter`. Total: never throws, for any world or tile size.
 *
 * @param painter - A 2D canvas context, or anything structurally like one.
 * @param world - The surveyed world. Read only; never mutated.
 * @param options - See {@link RenderWorldOptions}.
 */
export function renderWorld(
  painter: Painter2D,
  world: World,
  options: RenderWorldOptions = {},
): void {
  // Reset before anything else, unconditionally — including on the zero-size path below.
  // A caller that left a transform on the context would otherwise shift the whole map,
  // and "the map moved by a pixel because of something drawn before it" is precisely the
  // class of nondeterminism AC-1.3 exists to forbid.
  painter.setTransform(1, 0, 0, 1, 0, 0)

  const tileSize = normaliseTileSize(options.tileSize ?? DEFAULT_TILE_SIZE)
  const { width: pixelWidth, height: pixelHeight } = worldPixelSize(world, tileSize)
  // Nothing to draw, and nowhere to draw it. Spec 005: "A canvas of zero size (hidden
  // container) — must not throw."
  if (pixelWidth === 0 || pixelHeight === 0) return

  const { width, height } = world.grid

  painter.lineWidth = 1
  painter.clearRect(0, 0, pixelWidth, pixelHeight)
  painter.fillStyle = rgbCss(MARS_VOID)
  painter.fillRect(0, 0, pixelWidth, pixelHeight)

  drawElevation(painter, world, tileSize, width, height)
  drawSlopeShade(painter, world, tileSize, width, height)
  drawGraticule(painter, tileSize, pixelWidth, pixelHeight)
  drawDeposits(painter, world, tileSize, width, height)
}

/** Layer 2: the shaded Mars base, one rectangle per tile, row-major. */
function drawElevation(
  painter: Painter2D,
  world: World,
  tileSize: number,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // `?? 0` covers a world whose elevation array is shorter than its grid — a
      // hand-built or truncated one. Untreated, `undefined` becomes `rgb(NaN, NaN, NaN)`,
      // which the canvas silently ignores: a blank region indistinguishable from a
      // renderer that never ran. The datum colour at least draws something.
      const elevation = elevationAt(world.terrain, { x, y }) ?? 0
      painter.fillStyle = rgbCss(elevationColour(elevation))
      painter.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
    }
  }
}

/**
 * Layer 3: buildability, as a basalt darkening in proportion to slope.
 *
 * Fully buildable tiles are SKIPPED rather than drawn at alpha 0. A zero-alpha fill paints
 * nothing, so issuing it would be both waste and — in a trace or a profile —
 * indistinguishable from a bug.
 */
function drawSlopeShade(
  painter: Painter2D,
  world: World,
  tileSize: number,
  width: number,
  height: number,
): void {
  const shade = SLOPE_SHADE
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A missing score reads as `undefined`, which `slopeShadeAlpha` renders fully
      // opaque: unknown ground must not look ready to build on. See its docblock.
      const score = buildabilityAt(world.buildability, { x, y })
      const alpha = slopeShadeAlpha(score ?? Number.NaN)
      if (alpha <= 0) continue
      painter.fillStyle = rgbaCss(shade, alpha)
      painter.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
    }
  }
}

/**
 * Layer 4: a faint survey grid every `GRATICULE_TILE_INTERVAL` tiles.
 *
 * Interior rules only. The outer edge is the canvas boundary already, and a half-pixel
 * line there would be clipped to half its width — visibly lighter than every other rule.
 *
 * Coordinates are offset by half a pixel because a 1px stroke is centred on its path: on
 * an integer coordinate it straddles two pixel columns at half intensity each, which is
 * both blurry and a needless extra source of resampling difference.
 */
function drawGraticule(
  painter: Painter2D,
  tileSize: number,
  pixelWidth: number,
  pixelHeight: number,
): void {
  if (tileSize < GRATICULE_MIN_TILE_SIZE) return
  const step = GRATICULE_TILE_INTERVAL * tileSize
  // A map narrower and shorter than one interval has no interior rule to draw. Checking
  // here rather than inside the loops keeps `beginPath`/`stroke` out of the trace
  // entirely, so an empty graticule costs nothing and shows as nothing.
  if (step >= pixelWidth && step >= pixelHeight) return

  painter.strokeStyle = rgbaCss(GRATICULE_COLOUR, GRATICULE_ALPHA)
  painter.beginPath()
  for (let x = step; x < pixelWidth; x += step) {
    painter.moveTo(x + 0.5, 0)
    painter.lineTo(x + 0.5, pixelHeight)
  }
  for (let y = step; y < pixelHeight; y += step) {
    painter.moveTo(0, y + 0.5)
    painter.lineTo(pixelWidth, y + 0.5)
  }
  painter.stroke()
}

/**
 * Layer 5: one marker per mineral deposit, differentiated by `kind`.
 *
 * Drawn in `world.deposits` order, which `generateDeposits` builds row-major — so array
 * order is already a stable function of the seed, and sorting or bucketing here would
 * only add a second ordering to keep deterministic.
 */
function drawDeposits(
  painter: Painter2D,
  world: World,
  tileSize: number,
  width: number,
  height: number,
): void {
  const radius = Math.max(MIN_DEPOSIT_RADIUS, tileSize * DEPOSIT_RADIUS_RATIO)

  for (const deposit of world.deposits) {
    // Defence in depth for a hand-built or imported world. A marker at a negative
    // coordinate is not something to discover from a screenshot diff.
    if (deposit.x < 0 || deposit.y < 0 || deposit.x >= width || deposit.y >= height) continue

    const centreX = deposit.x * tileSize + tileSize / 2
    const centreY = deposit.y * tileSize + tileSize / 2
    const marker = depositMarker(deposit.kind)

    painter.fillStyle = rgbCss(marker.fill)
    painter.strokeStyle = rgbCss(marker.rim)
    traceMarker(painter, marker, centreX, centreY, radius)
    painter.fill()
    painter.stroke()
  }
}

/**
 * Lay down the path for one marker's silhouette.
 *
 * All three shapes are paths, including the square, so that every marker is filled AND
 * stroked by the same two calls in `drawDeposits`. A `fillRect`/`strokeRect` square would
 * be one more context member on `Painter2D` and one more shape of call to keep
 * deterministic, for a rectangle a four-segment path draws identically.
 */
function traceMarker(
  painter: Painter2D,
  marker: DepositMarker,
  centreX: number,
  centreY: number,
  radius: number,
): void {
  painter.beginPath()

  if (marker.shape === 'disc') {
    painter.arc(centreX, centreY, radius, 0, TAU)
    return
  }

  if (marker.shape === 'diamond') {
    painter.moveTo(centreX, centreY - radius)
    painter.lineTo(centreX + radius, centreY)
    painter.lineTo(centreX, centreY + radius)
    painter.lineTo(centreX - radius, centreY)
    painter.closePath()
    return
  }

  painter.moveTo(centreX - radius, centreY - radius)
  painter.lineTo(centreX + radius, centreY - radius)
  painter.lineTo(centreX + radius, centreY + radius)
  painter.lineTo(centreX - radius, centreY + radius)
  painter.closePath()
}
