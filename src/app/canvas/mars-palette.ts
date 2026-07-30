/**
 * The Mars surface palette: how a tile's simulation numbers become a colour.
 *
 * WHY THIS IS A SEPARATE MODULE. `render-world.ts` decides WHERE paint goes; this file
 * decides WHAT colour it is. Splitting them means the colour arithmetic — every clamp,
 * every interpolation, every fallback — is exercised by ordinary unit tests
 * (`tests/unit/mars-palette.test.ts`) instead of only by a screenshot, and it keeps the
 * renderer's draw sequence readable without a wall of hex literals inline.
 *
 * CONSTITUTION §4. Nothing here computes anything ABOUT the game. Every function is a
 * total mapping from a number the sim already produced (an elevation in [0, 1], a
 * buildability score in [0, 1]) or a string the sim already validated (a deposit `kind`)
 * onto a colour. No thresholds are invented that the sim does not already hold, no
 * statistics are taken over the map, and nothing is decided that a rule could disagree
 * with. This module could be deleted and the simulation would be unchanged.
 *
 * DETERMINISM (spec 005, AC-1.3). Every function is pure, total and free of any clock or
 * random source, and every string this module emits is fixed-precision: channels are
 * rounded to integers and alpha to three decimal places. That matters more than it
 * looks. Two alphas that are arithmetically equal but computed by different routes can
 * stringify differently (`0.30000000000000004`), and a CSS colour string that differs by
 * one character is a different colour to the canvas — which a byte-comparing screenshot
 * test would report as "terrain is not reproducible" with no clue as to why.
 *
 * NON-FINITE INPUT IS HANDLED, NOT ASSUMED AWAY. A `World` can be hand-built (the tests
 * do it) or arrive truncated from a future map importer, in which case an out-of-range
 * index reads as `undefined`. Left alone, that propagates to `rgb(NaN, NaN, NaN)`, which
 * the canvas silently ignores — producing a blank region that is indistinguishable from a
 * renderer that was never called. Every entry point therefore substitutes a defined
 * value, and the direction of each substitution is chosen so the map errs toward
 * DISCOURAGING a site rather than recommending one.
 */

/** An 8-bit-per-channel colour. Channels are conceptually in [0, 255]; see `rgbCss`. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** A colour anchored at a normalised elevation, for the interpolated elevation ramp. */
export interface ElevationStop {
  /** Normalised elevation in [0, 1] at which this colour applies exactly. */
  readonly at: number
  readonly colour: Rgb
}

/** How many decimal places of alpha survive into a CSS string. See the module docblock. */
const ALPHA_PRECISION = 3

/**
 * Clamp to [low, high], mapping NaN to `low`.
 *
 * NaN is singled out from the other non-finite values on purpose. The infinities have an
 * unambiguous clamped answer — `Math.min(high, Infinity)` is `high` — whereas NaN has
 * none, so it takes the low bound: for a colour channel that is the darker reading, which
 * matches the fail-dark direction chosen everywhere else in this module.
 */
function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low
  return Math.min(high, Math.max(low, value))
}

/**
 * A colour as an `rgb()` string with integer channels.
 *
 * Rounds and clamps rather than trusting the caller. Interpolation produces fractional
 * channels by construction, and `rgb(122.49999999999999, ...)` is both valid CSS and a
 * needless invitation for two equal colours to stringify differently.
 */
export function rgbCss(colour: Rgb): string {
  const r = Math.round(clamp(colour.r, 0, 255))
  const g = Math.round(clamp(colour.g, 0, 255))
  const b = Math.round(clamp(colour.b, 0, 255))
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * A colour as an `rgba()` string, with alpha at fixed precision.
 *
 * A non-finite alpha becomes 1 (fully opaque) rather than 0: an overlay that vanishes is
 * an overlay whose absence looks deliberate, whereas one that paints solidly is
 * immediately visible as wrong. Loud beats silent for a value that should never occur.
 */
export function rgbaCss(colour: Rgb, alpha: number): string {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1
  const r = Math.round(clamp(colour.r, 0, 255))
  const g = Math.round(clamp(colour.g, 0, 255))
  const b = Math.round(clamp(colour.b, 0, 255))
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(ALPHA_PRECISION)})`
}

/**
 * The colour of nothing: what fills the backing store before any tile is drawn.
 *
 * Near-black rather than transparent, and deliberately not `#000`. A transparent canvas
 * composites against whatever the page background happens to be, which makes the
 * rendered bytes a function of the page's CSS as well as the world — a determinism
 * hazard for AC-1.3 that would only surface when someone restyled the survey screen.
 */
export const MARS_VOID: Rgb = { r: 18, g: 12, b: 10 }

/**
 * The elevation ramp: shadowed basalt-rust at the datum, wind-scoured pale dust at the
 * summits.
 *
 * MARS IS RED, and specifically it is red because of iron(III) oxide — so every stop
 * here is red-dominant (r > g >= b), and the ramp varies mainly in VALUE rather than
 * hue. Two consequences, both intentional:
 *
 *   - The surface reads as Mars and not as a grey Moon or a false-colour heightmap. A
 *     rainbow ramp would carry more elevation information per pixel and would look like
 *     a GIS export rather than a place.
 *   - Because lightness (not hue) carries elevation, the map stays legible in greyscale
 *     and for a colour-blind player, which leaves hue free to mean something else —
 *     deposit kind, in `DEPOSIT_MARKERS` below.
 *
 * Stops must be listed in ascending `at` order, starting at 0 and ending at 1;
 * `elevationColour` relies on that and `tests/unit/mars-palette.test.ts` pins the
 * monotonic-lightness property so an accidental reordering fails loudly rather than
 * producing a plausible-looking but inverted map.
 */
const DATUM_STOP: ElevationStop = { at: 0, colour: { r: 58, g: 26, b: 18 } }

export const MARS_ELEVATION_STOPS: readonly ElevationStop[] = [
  DATUM_STOP, // shadowed basalt in the low basins
  { at: 0.35, colour: { r: 122, g: 52, b: 32 } }, // iron-oxide regolith
  { at: 0.65, colour: { r: 176, g: 86, b: 48 } }, // sunlit oxide
  { at: 0.85, colour: { r: 206, g: 140, b: 88 } }, // dust-mantled slopes
  { at: 1, colour: { r: 232, g: 196, b: 156 } }, // wind-scoured pale summit dust
]

/**
 * The colour of ground at a normalised elevation, linearly interpolated between stops.
 *
 * Out-of-range and non-finite elevations clamp to an end stop rather than throwing.
 * `Terrain.elevation` is contractually normalised to [0, 1] by `generateTerrain`, so a
 * value outside it means the caller hand-built or truncated the world; a renderer is the
 * wrong place to enforce a data contract, and drawing SOMETHING keeps the map readable
 * while the real problem is found upstream.
 *
 * Walks the stops forward rather than binary-searching them. Five stops on a 64x64 map is
 * 20k trivially-predicted comparisons, and carrying `lower` along as the loop advances
 * means no index arithmetic and therefore no nullable index reads to defend against.
 */
export function elevationColour(elevation: number): Rgb {
  const position = clamp(elevation, 0, 1)

  let lower = DATUM_STOP
  for (const upper of MARS_ELEVATION_STOPS) {
    if (position > upper.at) {
      lower = upper
      continue
    }

    const span = upper.at - lower.at
    // `span` is 0 for the very first stop (where `lower` and `upper` are the same stop)
    // and for any coincident pair a future palette author might write. Both resolve to
    // the lower colour instead of dividing by zero.
    const t = span > 0 ? (position - lower.at) / span : 0
    return {
      r: lower.colour.r + (upper.colour.r - lower.colour.r) * t,
      g: lower.colour.g + (upper.colour.g - lower.colour.g) * t,
      b: lower.colour.b + (upper.colour.b - lower.colour.b) * t,
    }
  }

  // Unreachable while the last stop sits at 1, since `position` is clamped to [0, 1].
  // Present because the function must be total: a stop list that stopped short of 1
  // would otherwise have no answer for the top of the range.
  return lower.colour
}

/**
 * The colour laid over sloping ground: cold, unlit basalt.
 *
 * Deliberately a DARKENING layer applied to steep ground rather than a highlight applied
 * to flat ground. Flat, buildable ground is then the bare iron-oxide base — the default,
 * un-annotated state of the map — so "clean red means you can build here" needs no
 * legend, while cliffs and crater rims read as the exception they are.
 */
export const SLOPE_SHADE: Rgb = { r: 26, g: 20, b: 22 }

/**
 * How hard slope darkens the surface: 1.6 units of alpha per unit of slope.
 *
 * Chosen from the shape of real generated terrain rather than by eye. On a 64x64 map at
 * the default seed, buildability spans roughly [0.67, 0.99] — the fractal heightmap is
 * smooth, so adjacent-tile differences are small and a 1:1 mapping of slope to alpha
 * would compress the whole map into alpha [0.01, 0.33] and read as a flat wash. A gain
 * of 1.6 stretches that to roughly [0.02, 0.54], which is a legible range.
 *
 * The gain also fixes where the shade SATURATES: fully opaque at buildability
 * `1 - 1/1.6 = 0.375`. That number is load-bearing, and it is checked against the sim
 * rather than asserted here: `validateLandingSite` refuses a footprint scoring at or
 * below `MIN_BUILDABLE_SCORE` (0) as `unbuildable`, and 0.375 >= 0, so every tile the sim
 * would refuse renders as solid basalt. `tests/unit/mars-palette.test.ts` pins that
 * inequality directly, so lowering the gain far enough to break it fails the suite —
 * because a refusable tile that merely looked "steep" would be the map lying to the
 * player about a decision it exists to inform.
 */
export const SLOPE_SHADE_GAIN = 1.6

/**
 * The opacity of the slope shade for a tile of the given buildability score.
 *
 * A non-finite score yields 1 — fully opaque basalt. The direction is deliberate: an
 * unknown tile rendered as clean buildable ground invites the player to place a hull the
 * sim will refuse, whereas one rendered as basalt merely under-sells a site. Same
 * false-negative-over-false-positive reasoning as `buildabilityScorerFor` in
 * `src/sim/world.ts`.
 */
export function slopeShadeAlpha(buildability: number): number {
  if (!Number.isFinite(buildability)) return 1
  const slope = 1 - Math.min(1, Math.max(0, buildability))
  return Math.min(1, slope * SLOPE_SHADE_GAIN)
}

/**
 * How a deposit marker is drawn. Shape carries the same information as colour, on
 * purpose — see `DEPOSIT_MARKERS`.
 */
export type DepositMarkerShape = 'diamond' | 'disc' | 'square'

/** The complete visual identity of one deposit kind. */
export interface DepositMarker {
  /** The `MineralDeposit.kind` this marker represents. */
  readonly kind: string
  readonly shape: DepositMarkerShape
  readonly fill: Rgb
  /** Outline colour, so the marker reads on both pale dust and dark basalt. */
  readonly rim: Rgb
}

/**
 * Markers for the deposit kinds the MVP ships, mirroring `DEFAULT_DEPOSIT_KINDS` in
 * `src/sim/buildability.ts`.
 *
 * SHAPE, NOT ONLY COLOUR. The reason `MineralDeposit.kind` exists (aic-m3t) is that the
 * player's landing choice is a trade between the ice chain and the silica chain, and a
 * choice you cannot see is not a choice. Encoding kind in hue alone would fail for a
 * colour-blind player and would also fail for any player at 8 px per tile, where a
 * two-pixel marker has almost no area for hue to register in. Silhouette survives both.
 *
 * The colours are still chosen to mean something: silica is the pale opaline cream Spirit
 * found near Home Plate, ice the cold blue-white of the shallow subsurface ice Phoenix
 * dug into at 68 degrees N. Both are far lighter than any elevation stop, so a marker is
 * never lost against the ground it sits on.
 *
 * DATA, NOT LOGIC. Registering a new resource chain's marker is one entry in this array;
 * `depositMarker` needs no change, and neither does the renderer. That mirrors how the
 * sim treats deposit kinds — `DepositKindSpec` is caller-supplied data precisely so a new
 * resource never requires a source edit — and it is why the lookup below is a scan over
 * this array rather than a `switch` that would have to grow a case.
 */
export const DEPOSIT_MARKERS: readonly DepositMarker[] = [
  {
    kind: 'silica',
    shape: 'diamond',
    fill: { r: 246, g: 240, b: 214 },
    rim: { r: 74, g: 46, b: 26 },
  },
  {
    kind: 'ice',
    shape: 'disc',
    fill: { r: 168, g: 226, b: 240 },
    rim: { r: 22, g: 52, b: 68 },
  },
]

/**
 * Fills used for a deposit kind that has no registered marker.
 *
 * More than one entry so that two unregistered kinds are usually still distinguishable
 * from each other, not merged into a single anonymous blob. `depositMarker` picks between
 * them by hashing the kind, so the choice is stable for a given kind forever — which is
 * what keeps the fallback path inside the determinism guarantee.
 */
export const RESERVE_DEPOSIT_FILLS: readonly Rgb[] = [
  { r: 214, g: 196, b: 132 }, // sulphur-pale
  { r: 190, g: 156, b: 208 }, // violet
  { r: 158, g: 210, b: 168 }, // pale green
  { r: 232, g: 168, b: 128 }, // apricot
]

/** Outline for an unregistered kind's marker: neutral, so no chain is implied. */
const RESERVE_DEPOSIT_RIM: Rgb = { r: 32, g: 28, b: 26 }

/**
 * FNV-1a, 32-bit. A hash and not `Math.random`, obviously, but also not the string
 * length or first character: those collide constantly on short resource names, which
 * would put 'iron' and 'clay' on the same fallback colour.
 */
function hashKind(kind: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < kind.length; i++) {
    hash ^= kind.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * The marker for a deposit kind, always.
 *
 * An unregistered kind gets a square in a hash-selected reserve fill rather than an
 * exception or a skipped draw. `MineralDeposit.kind` is an OPEN string by design — the
 * sim lets a caller register new kinds as data — so a renderer that only knew about
 * today's two would turn tomorrow's resource chain into either a crash or, worse, an
 * invisible deposit the player never learns exists. The distinct SQUARE silhouette says
 * "this map knows about a resource this palette does not", which is exactly the state of
 * affairs and a clear prompt to add an entry to `DEPOSIT_MARKERS`.
 */
export function depositMarker(kind: string): DepositMarker {
  for (const marker of DEPOSIT_MARKERS) {
    if (marker.kind === kind) return marker
  }

  const index = hashKind(kind) % RESERVE_DEPOSIT_FILLS.length
  return {
    kind,
    shape: 'square',
    fill: RESERVE_DEPOSIT_FILLS[index] ?? MARS_VOID,
    rim: RESERVE_DEPOSIT_RIM,
  }
}

// ---------------------------------------------------------------------------
// Colony structures (aic-oby.8) — "you cannot see your own colony"
// ---------------------------------------------------------------------------

/** The fill colour a `StructureType.id` is drawn in. */
export interface StructureMarker {
  readonly kind: string
  readonly fill: Rgb
}

/**
 * Fills for every structure kind the MVP catalog ships, mirroring `DEPOSIT_MARKERS`'
 * pattern exactly and for the same reason: registering a new structure's colour is one
 * entry here, never a change to `render-world.ts` or to the code that calls it.
 *
 * Hue groups by FUNCTION, not by chain, so the player learns a vocabulary rather than
 * seven unrelated colours: power (amber — both the landed reactor hull and a
 * player-built Reactor Unit are the identical hardware, see `colony-start.ts`), life
 * support (green, the habitat), and chain 1's regolith/sinter/shielding line (a warm
 * mineral progression: raw regolith tan, processed plate grey, finished shielding a
 * darker stone). The drone hull is blue, distinct from every industrial colour, because
 * it never occupies the same visual role as anything it stands beside.
 */
export const STRUCTURE_MARKERS: readonly StructureMarker[] = [
  { kind: 'drone-hull', fill: { r: 120, g: 168, b: 214 } },
  { kind: 'reactor-hull', fill: { r: 232, g: 176, b: 74 } },
  { kind: 'reactor-unit', fill: { r: 232, g: 176, b: 74 } },
  { kind: 'habitat-module', fill: { r: 122, g: 196, b: 138 } },
  { kind: 'regolith-hopper', fill: { r: 190, g: 150, b: 96 } },
  { kind: 'sinter-press', fill: { r: 168, g: 166, b: 174 } },
  { kind: 'shield-berm', fill: { r: 108, g: 100, b: 92 } },
]

/**
 * Fills for a structure kind this palette has no entry for, chosen by the same
 * `hashKind` scheme `depositMarker` uses for the identical reason: a colony that has
 * queued a structure a future chain adds must still be VISIBLE — the whole point of
 * this bead — rather than invisible until an author remembers to register it.
 */
export const RESERVE_STRUCTURE_FILLS: readonly Rgb[] = [
  { r: 214, g: 196, b: 132 },
  { r: 190, g: 156, b: 208 },
  { r: 158, g: 210, b: 168 },
  { r: 232, g: 168, b: 128 },
]

/** The fill colour for `kind`, always — registered, or a stable hash-selected reserve. */
export function structureFill(kind: string): Rgb {
  for (const marker of STRUCTURE_MARKERS) {
    if (marker.kind === kind) return marker.fill
  }

  const index = hashKind(kind) % RESERVE_STRUCTURE_FILLS.length
  return RESERVE_STRUCTURE_FILLS[index] ?? MARS_VOID
}

/** The outline every structure tile is stroked in, complete or not. Dark and neutral, so
 * it reads against every fill colour above without implying a kind of its own. */
export const STRUCTURE_OUTLINE: Rgb = { r: 18, g: 14, b: 12 }

/**
 * The fill's opacity while a structure is still under construction: a wash, not a
 * solid — so "not yet built" reads at a glance even before the hatch lines register,
 * and a completed structure (full opacity) is unmistakably different right next to it.
 */
export const STRUCTURE_INCOMPLETE_FILL_ALPHA = 0.35
