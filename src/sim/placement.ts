/**
 * Placement & multi-tile footprint validation.
 *
 * This module is the boundary between "a player wants to put structure X at
 * tile Y" and the grid's occupancy state. It deliberately knows about both
 * `grid.ts` (tiles, bounds, occupancy) and `catalog.ts` (footprint offsets)
 * but stays pure — no I/O, no clock, no mutation of its inputs. Every
 * rejection here is ordinary player error (bad click, blocked tile), never a
 * programmer error, so nothing in this module throws.
 */

import type { Coord, Grid, Tile } from './grid'
import { tileAt } from './grid'
import type { StructureType } from './catalog'

/**
 * A placement rejected because the footprint would not sit entirely inside
 * the grid. `tile` is the specific offending absolute coordinate — not just
 * the anchor — so callers (and tests) can pinpoint exactly which part of the
 * footprint hung off the edge.
 */
export interface OutOfBoundsRejection {
  readonly ok: false
  readonly reason: 'out-of-bounds'
  readonly tile: Coord
}

/**
 * A placement rejected because a footprint tile is already occupied.
 *
 * `occupantId` is carried through from the blocking tile because "occupied"
 * alone is rarely actionable for a caller (e.g. a UI toast, or an AI agent
 * deciding whether to demolish first) — knowing *what* is in the way is.
 */
export interface OccupiedRejection {
  readonly ok: false
  readonly reason: 'occupied'
  readonly tile: Coord
  readonly occupantId: string
}

/** A placement that failed validation, with a distinct typed reason per cause. */
export type PlacementRejection = OutOfBoundsRejection | OccupiedRejection

/**
 * A placement that passed validation, carrying every absolute tile the
 * structure would occupy (not merely the anchor) so `applyPlacement` never
 * has to re-derive or re-validate them.
 */
export interface PlacementSuccess {
  readonly ok: true
  readonly tiles: readonly Coord[]
}

/**
 * The result of validating a placement.
 *
 * A discriminated union rather than a thrown error: an illegal placement
 * (out of bounds, occupied) is an ordinary, expected outcome of a player
 * clicking somewhere invalid, not an exceptional program state. Throwing
 * would force every caller (UI, AI planner, tests) into try/catch for a
 * routine branch.
 */
export type PlacementResult = PlacementSuccess | PlacementRejection

/**
 * A placement known — at the type level — to have passed validation.
 *
 * `applyPlacement` accepts only this narrowed type, not the full
 * `PlacementResult`. That makes "apply an unvalidated or rejected placement"
 * a compile error instead of a runtime branch this module would otherwise
 * need a defensive (and untestable-as-unreachable) guard for.
 */
export type ValidPlacement = Extract<PlacementResult, { ok: true }>

/**
 * Resolve a structure type's footprint offsets against an anchor coordinate
 * into absolute tile coordinates.
 *
 * Pure coordinate arithmetic, deliberately grid-agnostic: it never consults
 * the grid, so it can't itself reject anything. Bounds and occupancy are
 * `validatePlacement`'s job — keeping this function total (never fails) makes
 * it trivial to reuse anywhere absolute footprint tiles are needed, including
 * preview/ghost rendering of a placement that hasn't been validated yet.
 */
export function resolveFootprint(
  structureType: StructureType,
  anchor: Coord,
): readonly Coord[] {
  return structureType.footprint.map(({ dx, dy }) => ({
    x: anchor.x + dx,
    y: anchor.y + dy,
  }))
}

/**
 * Validate placing `structureType` anchored at `anchor` on `grid`.
 *
 * Checks bounds and occupancy for every resolved footprint tile — not just
 * the anchor. Partial overlap (anchor free, some other footprint tile
 * occupied) is the case a naive anchor-only check would miss, so this walks
 * the full tile list and rejects on the first tile that fails either check.
 *
 * Bounds and occupancy are checked together per tile via `tileAt`, which
 * returns `undefined` for an out-of-bounds coordinate: that lets one pass
 * over the footprint cover both failure modes without a separate bounds-only
 * pre-pass duplicating `isInBounds` logic.
 *
 * Never throws for an invalid placement — see `PlacementResult`.
 */
export function validatePlacement(
  grid: Grid,
  structureType: StructureType,
  anchor: Coord,
): PlacementResult {
  const tiles = resolveFootprint(structureType, anchor)

  for (const coord of tiles) {
    const tile: Tile | undefined = tileAt(grid, coord)
    if (tile === undefined) {
      return { ok: false, reason: 'out-of-bounds', tile: coord }
    }
    if (tile.occupantId !== null) {
      return { ok: false, reason: 'occupied', tile: coord, occupantId: tile.occupantId }
    }
  }

  return { ok: true, tiles }
}

/**
 * Apply an already-validated placement, returning a NEW grid with
 * `structureId` written into every one of the placement's footprint tiles.
 *
 * Requiring a `ValidPlacement` (rather than re-checking `ok` here) means
 * there is no runtime "what if this wasn't actually valid" branch to write,
 * test, or silently get wrong — the type system is the guard. The input
 * `grid` is never mutated: a fresh tiles array is built, and only tiles
 * inside the footprint get a fresh `Tile` object. Tiles outside the
 * footprint keep their original object reference (they are immutable by
 * contract per `grid.ts`), so this is O(width * height) with no unnecessary
 * allocation for large grids with small footprints.
 *
 * `structureId` is an opaque identifier chosen by the caller (e.g. a
 * per-instance id), independent of `structureType.id` — this module does not
 * assume the two coincide.
 */
export function applyPlacement(
  grid: Grid,
  structureId: string,
  placement: ValidPlacement,
): Grid {
  const footprintKeys = new Set(placement.tiles.map((coord) => `${coord.x},${coord.y}`))

  const tiles = grid.tiles.map((tile) => {
    if (!footprintKeys.has(`${tile.x},${tile.y}`)) return tile
    return { x: tile.x, y: tile.y, occupantId: structureId }
  })

  return { width: grid.width, height: grid.height, tiles }
}
