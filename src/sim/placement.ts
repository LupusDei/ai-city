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
 * Check every tile in `tiles` against `grid`'s CURRENT bounds and occupancy,
 * returning the first rejection encountered, or `undefined` if all of them
 * are real, free tiles of `grid` right now.
 *
 * Factored out so `validatePlacement` (checking a freshly resolved footprint
 * for the first time) and `applyPlacement` (re-checking an already-validated
 * placement's tiles against the grid it is actually being applied to) share
 * one bounds+occupancy check instead of two copies that could silently drift
 * apart. See `applyPlacement`'s doc comment for why the second call site
 * exists at all.
 */
function firstRejection(grid: Grid, tiles: readonly Coord[]): PlacementRejection | undefined {
  for (const coord of tiles) {
    const tile: Tile | undefined = tileAt(grid, coord)
    if (tile === undefined) {
      return { ok: false, reason: 'out-of-bounds', tile: coord }
    }
    if (tile.occupantId !== null) {
      return { ok: false, reason: 'occupied', tile: coord, occupantId: tile.occupantId }
    }
  }
  return undefined
}

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

  const rejection = firstRejection(grid, tiles)
  if (rejection !== undefined) return rejection

  return { ok: true, tiles }
}

/** A successful apply, carrying the new grid with the structure written in. */
export interface ApplySuccess {
  readonly ok: true
  readonly grid: Grid
}

/**
 * The result of applying a placement.
 *
 * The failure half reuses `PlacementRejection` verbatim rather than inventing
 * a parallel "apply failed" vocabulary: from a caller's point of view, "this
 * placement's tiles are no longer free on the grid I'm applying it to" is the
 * identical situation `validatePlacement` already reports for "these tiles
 * were never free to begin with" — same reasons, same `tile`/`occupantId`
 * payload, same handling (surface it, let the caller decide whether to
 * revalidate, notify the player, or drop the queued action).
 */
export type ApplyResult = ApplySuccess | PlacementRejection

/**
 * Apply an already-validated placement, returning a NEW grid with
 * `structureId` written into every one of the placement's footprint tiles —
 * or a typed rejection if the tiles are no longer valid on `grid`.
 *
 * ## Why `ValidPlacement` is not enough on its own
 *
 * `ValidPlacement` proves a placement passed bounds+occupancy checks against
 * SOME grid, at the moment it was checked. It carries no reference to WHICH
 * grid — grids are plain, id-less value objects by design (see `grid.ts`) —
 * so the type system cannot stop a caller from validating against one grid
 * and applying to a different one: a stale copy, a save/loaded grid, a
 * smaller grid, or the same grid after something else has since claimed one
 * of the footprint tiles. `placement.tiles` is just a list of `{x, y}`
 * coordinates, and coordinates from grid A are frequently also valid-looking
 * coordinates on grid B — nothing about the shape of the data reveals the
 * mismatch.
 *
 * Previously this function trusted `placement.tiles` unconditionally and
 * matched footprint membership by `"x,y"` string key against `grid.tiles`.
 * When the keys didn't correspond to an occupied tile on the ACTUAL target
 * grid — e.g. because that grid was smaller and the coordinate was never a
 * real tile on it at all — every footprint tile fell through to the
 * "unchanged" branch of the map, and the function returned what was, for all
 * practical purposes, a copy of the input grid: no exception, no altered
 * return type, no signal of any kind. A structure the caller believed it had
 * placed simply never appeared, with nothing left behind to diagnose why.
 *
 * ## The fix
 *
 * `applyPlacement` now re-checks every one of `placement.tiles` against the
 * grid it is ACTUALLY being applied to — the same bounds+occupancy check
 * `validatePlacement` does (see `firstRejection`), just without re-resolving
 * the footprint since `placement.tiles` already IS that resolved list. If any
 * tile is no longer a real, free tile of `grid`, this returns a typed
 * `PlacementRejection` instead of a `Grid`. Because `ApplyResult` is a union
 * with no field in common between its two members, the compiler refuses to
 * let a caller read `.grid` without first narrowing on `.ok` — extending, at
 * the apply step, the exact "misuse is a compile error, not a runtime
 * branch" guarantee `ValidPlacement` already gives at the validate step. This
 * re-check is genuinely reachable (any caller validating against one grid and
 * applying to another exercises it) rather than defensive padding: it only
 * ever fires when a placement's tiles have, in fact, gone stale.
 *
 * When `grid` IS the one the placement was validated against (or an
 * unrelated grid that coincidentally still has every footprint tile free),
 * this succeeds exactly as before — the check does not reject placements
 * that remain genuinely valid, it only refuses to silently apply ones that
 * no longer are.
 *
 * The input `grid` is never mutated: on success, a fresh tiles array is
 * built, and only tiles inside the footprint get a fresh `Tile` object. Tiles
 * outside the footprint keep their original object reference (they are
 * immutable by contract per `grid.ts`), so this is O(width * height) with no
 * unnecessary allocation for large grids with small footprints, plus a
 * negligible O(footprint size) re-check pass.
 *
 * `structureId` is an opaque identifier chosen by the caller (e.g. a
 * per-instance id), independent of `structureType.id` — this module does not
 * assume the two coincide.
 */
export function applyPlacement(
  grid: Grid,
  structureId: string,
  placement: ValidPlacement,
): ApplyResult {
  const rejection = firstRejection(grid, placement.tiles)
  if (rejection !== undefined) return rejection

  const footprintKeys = new Set(placement.tiles.map((coord) => `${coord.x},${coord.y}`))

  const tiles = grid.tiles.map((tile) => {
    if (!footprintKeys.has(`${tile.x},${tile.y}`)) return tile
    return { x: tile.x, y: tile.y, occupantId: structureId }
  })

  return { ok: true, grid: { width: grid.width, height: grid.height, tiles } }
}
