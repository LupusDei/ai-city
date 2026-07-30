/**
 * The square-grid world model for the colony surface.
 *
 * This module is deliberately substrate-agnostic: it knows about tiles,
 * coordinates and occupancy, and nothing about what is built on them or why.
 * It is pure data plus pure functions — no rendering, no I/O, no clock.
 */

/** A discrete tile coordinate. Both components must be non-negative integers. */
export interface Coord {
  readonly x: number
  readonly y: number
}

/** A single grid cell. `occupantId` is the id of the structure occupying it, or null. */
export interface Tile {
  readonly x: number
  readonly y: number
  readonly occupantId: string | null
}

/**
 * A rectangular grid of tiles stored row-major (`index = y * width + x`).
 *
 * A plain array is used rather than a Map or nested arrays specifically so that
 * iteration order is fixed and total — a precondition of a deterministic sim.
 */
export interface Grid {
  readonly width: number
  readonly height: number
  readonly tiles: readonly Tile[]
}

/**
 * Upper bound on either dimension.
 *
 * This is a denial-of-service guard, not a game-design limit: `createGrid` eagerly
 * allocates `width * height` tile objects, so an absurd dimension from a corrupt save
 * or a malformed config would exhaust memory before any validation downstream could
 * reject it. Raise it deliberately if the design ever calls for larger maps.
 */
export const MAX_GRID_DIMENSION = 512

function assertValidDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_GRID_DIMENSION) {
    throw new RangeError(
      `Grid ${name} must be an integer in [1, ${MAX_GRID_DIMENSION}], received: ${value}`,
    )
  }
}

/**
 * Create an empty grid with every tile unoccupied.
 *
 * @throws {RangeError} if either dimension is not an integer in [1, MAX_GRID_DIMENSION].
 *   Invalid dimensions are a programmer/config error rather than ordinary player input,
 *   so this throws. Player-originated failures (e.g. an illegal build placement) must
 *   instead return a typed result and never throw.
 */
export function createGrid(width: number, height: number): Grid {
  assertValidDimension(width, 'width')
  assertValidDimension(height, 'height')

  const tiles: Tile[] = new Array<Tile>(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = { x, y, occupantId: null }
    }
  }

  return { width, height, tiles }
}

/**
 * Whether a coordinate addresses a real tile of this grid.
 *
 * Fractional and non-finite coordinates are rejected: a half-tile is not a tile,
 * and allowing one would silently truncate into a valid index.
 */
export function isInBounds(grid: Grid, coord: Coord): boolean {
  const { x, y } = coord
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < grid.width &&
    y < grid.height
  )
}

/** The tile at `coord`, or `undefined` if the coordinate is not on the grid. O(1). */
export function tileAt(grid: Grid, coord: Coord): Tile | undefined {
  if (!isInBounds(grid, coord)) return undefined
  return grid.tiles[coord.y * grid.width + coord.x]
}
