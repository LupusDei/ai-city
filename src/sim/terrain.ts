/**
 * Deterministic Martian elevation heightmap generation.
 *
 * This is the first place nondeterminism could enter the simulation, so it is
 * sealed deliberately: every random value used here is drawn from a PRNG seeded
 * explicitly by the caller. `Math.random`, `Date.now`, `new Date`, and iteration
 * over Object/Map/Set (whose key order is not a value contract) are all forbidden
 * in this module for exactly that reason — none of them can be reproduced
 * byte-for-byte on a different run or a different process.
 *
 * Like grid.ts, this module is pure data plus pure functions: no rendering, no
 * I/O, no clock.
 */

import type { Coord } from './grid'
import { MAX_GRID_DIMENSION } from './grid'

/**
 * A generated heightmap, row-major (`index = y * width + x`) to match `Grid`.
 *
 * `elevation` values are normalised to the closed interval [0, 1]. `seed` is
 * carried on the result (rather than discarded after generation) so two
 * `Terrain` values produced from the same inputs are trivially deep-equal, and
 * so downstream code/tests can confirm which seed produced a given map without
 * threading it through separately. `latitude` is carried for the same reason —
 * see its own doc comment for why it is a single map-level number.
 */
export interface Terrain {
  readonly width: number
  readonly height: number
  readonly seed: number
  /**
   * The latitude of the map's CENTRE, in degrees, negative south, in [-90, 90].
   *
   * Deliberately ONE number for the whole map rather than a per-tile array. A
   * colony map is on the order of 320 m across (64 tiles at 5 m each). Mars'
   * mean radius is ~3,389.5 km, so a degree of latitude is ~59 km and the entire
   * map spans roughly 0.005 degrees — about 20 arcseconds. Every consumer of
   * latitude in this simulation (shallow-ice availability, solar insolation)
   * varies over TENS of degrees, so a per-tile latitude array would be ~4,000
   * numbers encoding a difference no rule can act on: false precision, plus a
   * second width/height-shaped array to keep in sync with the first for nothing.
   *
   * Latitude is metadata that travels WITH the heightmap, not an input to it —
   * `generateTerrain` never feeds it to the noise. That is load-bearing: it lets
   * a caller slide the landing latitude and re-type the map's resources (see
   * `generateDeposits`) without reshuffling its shape, so the player reads one
   * axis changing rather than a whole new world.
   */
  readonly latitude: number
  readonly elevation: readonly number[]
}

/**
 * Default map centre latitude: 40 degrees north.
 *
 * Chosen to match where real Mars mission planning keeps landing — Arcadia
 * Planitia, ~40 degrees N — and for exactly the same reason: it is the
 * compromise band. It is poleward of the ~35-40 degree limit for accessible
 * shallow subsurface ice (NASA's SWIM ice-consistency mapping; see
 * `ICE_MIN_ABS_LATITUDE_DEG` in buildability.ts), while staying far enough
 * equatorward that solar insolation is still workable.
 *
 * A default is needed at all so the existing three-argument `generateTerrain`
 * call sites keep working; picking the compromise band means the DEFAULT map
 * does not silently disable a resource chain, which either extreme would.
 */
export const DEFAULT_MAP_LATITUDE_DEG = 40

function assertValidDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_GRID_DIMENSION) {
    throw new RangeError(
      `Terrain ${name} must be an integer in [1, ${MAX_GRID_DIMENSION}], received: ${value}`,
    )
  }
}

/**
 * Validate a map-level latitude in degrees.
 *
 * Exported (unlike `assertValidDimension`) because latitude is validated at more
 * than one boundary: here when a `Terrain` is generated, and again in
 * `buildability.ts` when one is consumed, since a hand-built `Terrain` can carry
 * any number at all. One shared assertion keeps the [-90, 90] rule and its error
 * message from drifting apart between those two sites.
 *
 * `Number.isFinite` is not redundant with the range comparison: `NaN < -90` and
 * `NaN > 90` are both false, so a range check written as two comparisons would
 * admit `NaN` silently and poison every downstream `Math.abs(latitude)`
 * comparison into a quiet "no" rather than a loud failure.
 *
 * Fractional degrees are accepted on purpose — a landing site is not obliged to
 * sit on a whole degree — so there is no integer check here, unlike dimensions.
 *
 * @throws {RangeError} if `value` is not a finite number of degrees in [-90, 90].
 */
export function assertValidMapLatitude(value: number, label: string): void {
  if (!Number.isFinite(value) || value < -90 || value > 90) {
    throw new RangeError(
      `${label} must be a finite number of degrees in [-90, 90] (negative south), received: ${value}`,
    )
  }
}

/**
 * mulberry32: a minimal 32-bit seeded PRNG.
 *
 * Chosen over `Math.random()` (unseedable, forbidden here) and over a
 * cryptographic RNG (unnecessary weight for terrain "flavour" randomness) because
 * it is ~5 lines, has no external dependency, and its output is fully determined
 * by the 32-bit seed and call count — exactly the byte-for-byte reproducibility
 * this module requires. It is not cryptographically secure, which is irrelevant
 * for generating a heightmap.
 *
 * Returns a closure over its internal state rather than a global generator so
 * that two calls to `generateTerrain` never share (and can never accidentally
 * mutate) each other's sequence.
 *
 * Exported so `buildability.ts` can key its own deterministic draws off the same
 * construction. It previously held a verbatim copy of this function purely
 * because this module did not export it; a second copy of a determinism
 * primitive is a copy that can drift, and a future reviewer auditing
 * reproducibility should have exactly one small algorithm to trust.
 */
export function mulberry32(seed: number): () => number {
  // `>>> 0` folds any finite number (including negatives) into an unsigned
  // 32-bit integer, which is the state mulberry32 operates on.
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cubic smoothstep: eases interpolation so lattice cell seams are not visible. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * A rectangular lattice of independent random values, one octave's worth of
 * "control points" for value noise.
 *
 * Built as a flat `Float64Array` filled in a fixed row-major loop — never a
 * Map/Set/object whose key order is not a value contract — so the exact same
 * sequence of PRNG draws happens in the exact same order on every run.
 */
function buildLattice(cellsX: number, cellsY: number, rand: () => number): Float64Array {
  const lattice = new Float64Array((cellsX + 1) * (cellsY + 1))
  for (let ly = 0; ly <= cellsY; ly++) {
    for (let lx = 0; lx <= cellsX; lx++) {
      lattice[ly * (cellsX + 1) + lx] = rand()
    }
  }
  return lattice
}

/**
 * Bilinear value-noise sample at a continuous lattice-space coordinate, with
 * smoothstep-eased interpolation so adjacent cells blend rather than tile visibly.
 */
function sampleLattice(
  lattice: Float64Array,
  cellsX: number,
  cellsY: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  // Clamp rather than wrap: the caller-side coordinate is always within
  // [0, cellsX] / [0, cellsY] by construction, but clamping keeps this function
  // safe at the exact upper boundary (x === cellsX) without a special case there.
  const x1 = Math.min(x0 + 1, cellsX)
  const y1 = Math.min(y0 + 1, cellsY)
  const tx = smoothstep(x - x0)
  const ty = smoothstep(y - y0)

  const stride = cellsX + 1
  const v00 = lattice[y0 * stride + x0] as number
  const v10 = lattice[y0 * stride + x1] as number
  const v01 = lattice[y1 * stride + x0] as number
  const v11 = lattice[y1 * stride + x1] as number

  const top = lerp(v00, v10, tx)
  const bottom = lerp(v01, v11, tx)
  return lerp(top, bottom, ty)
}

/** One layer of the fractal sum: a lattice resolution paired with its weight. */
interface Octave {
  readonly cellsX: number
  readonly cellsY: number
  readonly amplitude: number
}

/**
 * Octave schedule for the fractal (layered) noise sum.
 *
 * Each octave doubles the lattice resolution of the previous one and halves its
 * amplitude (a standard fractal-Brownian-motion falloff), so coarse octaves
 * establish broad landforms and finer octaves add detail without dominating the
 * shape. Four octaves is enough to read as terrain rather than a single blurry
 * blob, without the cost or complexity of a general-purpose octave count.
 */
function buildOctaves(width: number, height: number): readonly Octave[] {
  // Base lattice cell size of ~8 tiles keeps the coarsest octave's landforms
  // multiple tiles wide even on a large map, while `Math.max(1, ...)` keeps it
  // well-defined (at least one cell) on maps smaller than 8 tiles across.
  const baseCellsX = Math.max(1, Math.round(width / 8))
  const baseCellsY = Math.max(1, Math.round(height / 8))
  const octaves: Octave[] = []
  let amplitude = 1
  for (let i = 0; i < 4; i++) {
    octaves.push({
      cellsX: baseCellsX * 2 ** i,
      cellsY: baseCellsY * 2 ** i,
      amplitude,
    })
    amplitude *= 0.5
  }
  return octaves
}

/**
 * Generate a deterministic Martian elevation heightmap.
 *
 * The same `(width, height, seed, latitude)` tuple always produces a
 * deeply-equal `Terrain`, on any run or process, because every random draw flows
 * from a single `mulberry32` instance seeded exactly once at the top of this
 * function.
 *
 * Algorithm: layered (fractal) value noise. A coarse lattice of random control
 * points is generated per octave, smoothstep-interpolated to a continuous
 * surface, and octaves are summed with falling amplitude (see `buildOctaves`).
 * The raw sum is then min-max normalised to [0, 1] so the output range is exact
 * regardless of octave count or amplitude choices.
 *
 * `latitude` is an OPTIONAL trailing parameter (defaulting to
 * {@link DEFAULT_MAP_LATITUDE_DEG}) rather than a required one, so every existing
 * three-argument call site keeps compiling and keeps producing the same
 * elevations. It is deliberately NOT fed to the noise: two terrains differing
 * only in latitude have byte-identical `elevation` arrays. See the `latitude`
 * field on {@link Terrain} for why that matters.
 *
 * @throws {RangeError} if either dimension is not an integer in
 *   [1, MAX_GRID_DIMENSION] — mirrors `createGrid`'s validation in grid.ts, since
 *   a terrain is generated for exactly one grid and must obey the same bound.
 * @throws {RangeError} if `latitude` is not a finite number of degrees in
 *   [-90, 90].
 */
export function generateTerrain(
  width: number,
  height: number,
  seed: number,
  latitude: number = DEFAULT_MAP_LATITUDE_DEG,
): Terrain {
  assertValidDimension(width, 'width')
  assertValidDimension(height, 'height')
  assertValidMapLatitude(latitude, 'Terrain latitude')

  const rand = mulberry32(seed)
  const octaves = buildOctaves(width, height)
  // Each octave's lattice must be built (consuming PRNG draws) in a fixed order
  // before any tile is sampled, so the draw sequence depends only on
  // (width, height, seed) and never on sampling order.
  const lattices = octaves.map((octave) => buildLattice(octave.cellsX, octave.cellsY, rand))

  const tileCount = width * height
  const raw = new Float64Array(tileCount)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0
      for (let i = 0; i < octaves.length; i++) {
        const octave = octaves[i] as Octave
        const lattice = lattices[i] as Float64Array
        const lx = (x / width) * octave.cellsX
        const ly = (y / height) * octave.cellsY
        value += sampleLattice(lattice, octave.cellsX, octave.cellsY, lx, ly) * octave.amplitude
      }
      const index = y * width + x
      raw[index] = value
      if (value < min) min = value
      if (value > max) max = value
    }
  }

  const range = max - min
  const elevation = new Array<number>(tileCount)
  for (let i = 0; i < tileCount; i++) {
    const value = raw[i] as number
    // A degenerate (min === max) raw range only arises on a 1x1 terrain, where
    // there is exactly one lattice sample and thus no variation to normalise.
    // Mid-range (0.5) is the only value that isn't an arbitrary choice of
    // endpoint in that case.
    elevation[i] = range > 0 ? (value - min) / range : 0.5
  }

  return { width, height, seed, latitude, elevation }
}

/**
 * The elevation at `coord`, or `undefined` if the coordinate is not on this
 * terrain. Mirrors `tileAt`'s out-of-bounds convention in grid.ts exactly, so
 * callers that already know that convention need to learn nothing new here.
 */
export function elevationAt(terrain: Terrain, coord: Coord): number | undefined {
  const { x, y } = coord
  const inBounds =
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < terrain.width && y < terrain.height
  if (!inBounds) return undefined
  return terrain.elevation[y * terrain.width + x]
}
