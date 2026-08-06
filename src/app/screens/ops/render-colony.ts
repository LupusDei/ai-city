/**
 * THE COLONY PLATE — the surveyed world with the colony's structures standing on it.
 *
 * ============================================================================
 * WHY THIS EXISTS: THE OPERATIONS SCREEN HAD NO MAP
 * ----------------------------------------------------------------------------
 * The player opens this game by reading terrain. They weigh clean oxide against basalt,
 * measure two hulls against the deposits nearest them, and commit. Then the mission started
 * and the colony they had just sited DID NOT EXIST VISUALLY: the operations screen was four
 * rows of number cards, and every piece of spatial reasoning the survey screen demanded was
 * discarded at the moment it began to matter. The main screen of a city-builder was a
 * financial report.
 *
 * So the plate draws the world the survey scored — the same `World` object, carried across
 * by the adapter — and puts the landed hulls on it. Nothing about the picture is new
 * information; it is the information the player already earned, finally shown to them.
 *
 * ============================================================================
 * IT DELEGATES THE TERRAIN. IT DOES NOT REDRAW IT. (Constitution §8)
 * ----------------------------------------------------------------------------
 * Layers 1-5 — void, elevation, slope shade, graticule, deposits — are `renderWorld`'s,
 * called here unchanged. A second terrain renderer would be a second set of colour
 * decisions to keep in step with `mars-palette.ts`, and the first time they drifted the
 * same world would look like two different planets on two screens of one game.
 *
 * This module adds exactly one layer on top: LAYER 6, the structures.
 *
 * ============================================================================
 * NO GAME LOGIC (constitution §4)
 * ----------------------------------------------------------------------------
 * Every coordinate drawn below is a tile the SIM placed. `ConstructionProject.tiles` is
 * written by `queueConstruction` through the same placement path that will later refuse to
 * build on an occupied tile, so this file never resolves a footprint, never decides where a
 * hull sits and never checks a placement. It multiplies sim tile coordinates by a tile size,
 * which is the same projection `worldPixelSize` performs, and that is the whole of its
 * arithmetic. Delete this file and the simulation is unchanged.
 *
 * ============================================================================
 * DETERMINISM — read `render-world.ts`'s docblock first; the same rules bind here
 * ----------------------------------------------------------------------------
 * Spec 005's AC-1.3 screenshots the SURVEY canvas, not this one, so this layer is not
 * directly inside those bytes. It obeys the same constraints anyway, because "deterministic
 * only where a test happens to look" is not a property, it is a coincidence:
 *
 *   - NO RANDOMNESS, NO CLOCK, NO ANIMATION. One synchronous pass.
 *   - NO TEXT. Not one `fillText`; a structure's meaning is carried by the legend beside
 *     the plate, in ordinary DOM text that fonts may render however they like.
 *   - NO DEVICE-PIXEL-RATIO OR MEASURED SIZE. `ColonyCanvas` sizes the backing store from
 *     the world and the tile size alone, exactly as `TerrainCanvas` does.
 *   - FIXED ITERATION ORDER. Projects in queue order — which `construction.ts` documents as
 *     significant — and tiles in the order the sim resolved the footprint. No `Map`, no
 *     `Set`, no sort.
 *   - FIXED-PRECISION COLOUR STRINGS, via `mars-palette.ts`'s own helpers.
 *
 * `tests/unit/render-colony.test.ts` compares two traces of the same colony for exactly
 * this reason.
 */

import { DRONE_HULL_ID, REACTOR_HULL_ID } from '../../../sim/colony-start'
import type { ConstructionQueue } from '../../../sim/construction'
import type { World } from '../../../sim/world'
import type { Rgb } from '../../canvas/mars-palette'
import { MARS_VOID, rgbCss, rgbaCss } from '../../canvas/mars-palette'
import { DEFAULT_TILE_SIZE, normaliseTileSize, renderWorld } from '../../canvas/render-world'
import type { Painter2D } from '../../canvas/render-world'

/**
 * Device pixels per tile on the operations plate: 9, against the survey's 8.
 *
 * One pixel larger, and the reason is layout rather than taste. The survey screen puts the
 * map beside a narrow assessment column; the operations screen puts it beside a ledger that
 * needs less width than the map deserves, and a 64-tile world at 9 px is 576 px square —
 * which fills the height a 900 px viewport actually has once the masthead, the constraint
 * strip and the footer have taken theirs. A WHOLE number of pixels per tile, always: a
 * fractional tile size is how a grid ends up with rows one pixel taller than their
 * neighbours.
 */
export const OPS_TILE_SIZE = 9

/** How a structure is painted: a body colour and the rim drawn around each of its tiles. */
export interface StructureLivery {
  readonly fill: Rgb
  readonly rim: Rgb
}

/**
 * The two hulls wear the SURVEY SCREEN'S OWN MARKER COLOURS — white for the drone hull,
 * amber for the reactor hull.
 *
 * This is the single most important decision in the file and it is not decoration. The
 * player learned those two marks while placing them; a colony drawn in a fresh palette
 * would make them learn the same two objects twice and would quietly invalidate the survey
 * screen's legend. The values match `styles.ts`'s `.marker[data-hull]` rules and
 * `.legend__swatch--drone` / `--reactor` exactly.
 *
 * They are duplicated as `Rgb` here rather than imported from the stylesheet for the reason
 * `styles.ts` gives for duplicating the palette in the other direction: one side describes
 * canvas fills and the other CSS text, and a conversion layer between them would be a third
 * thing that could be wrong. The eye checks this pair in one glance.
 */
export const DRONE_HULL_LIVERY: StructureLivery = {
  fill: { r: 246, g: 240, b: 226 },
  rim: MARS_VOID,
}

/** The reactor hull's amber, matching `--amber` and the survey screen's reactor marker. */
export const REACTOR_HULL_LIVERY: StructureLivery = {
  fill: { r: 255, g: 200, b: 87 },
  rim: MARS_VOID,
}

/**
 * Everything else the colony ever builds, until it earns a livery of its own.
 *
 * A DEFAULT rather than a skip or a throw. Every structure the player will later place —
 * hoppers, sinter presses, berms, habitats — arrives through this branch on the day it is
 * placeable, and a structure that exists in the simulation but nowhere on the map is a far
 * worse failure than one drawn in a provisional colour. Lit oxide (`--oxide-lit`), so it
 * reads as built rather than as terrain.
 */
export const UNKNOWN_STRUCTURE_LIVERY: StructureLivery = {
  fill: { r: 176, g: 86, b: 48 },
  rim: MARS_VOID,
}

/**
 * Structure bodies are drawn at 0.85 rather than solid.
 *
 * Checked against the rendered image, not reasoned about. Fully opaque, a hull reads as a
 * hole punched in the map and the eye loses the ground it is standing on — which is exactly
 * the relationship the player is trying to judge. At 0.85 the elevation shading beneath
 * still shows through as a tint while the hull stays unambiguously a solid object. Below
 * about 0.7 it starts to look like a highlight rather than a building.
 */
export const STRUCTURE_FILL_ALPHA = 0.85

/**
 * How to paint a structure, by its `StructureType.id`.
 *
 * A lookup, not a rule: it maps an id the sim owns onto a colour this layer owns, and no
 * outcome in `src/sim/` changes with what it returns. The same shape, and the same
 * justification, as `mars-palette.ts`'s `depositMarker(kind)`.
 *
 * The hull ids come from `colony-start.ts`'s own exported constants rather than from string
 * literals here, so renaming a hull is a compile error instead of a hull that silently turns
 * grey.
 */
export function structureLivery(structureId: string): StructureLivery {
  if (structureId === DRONE_HULL_ID) return DRONE_HULL_LIVERY
  if (structureId === REACTOR_HULL_ID) return REACTOR_HULL_LIVERY
  return UNKNOWN_STRUCTURE_LIVERY
}

/** What {@link renderColony} needs: a world to draw and the structures standing on it. */
export interface RenderColonyParams {
  /** The SURVEYED world, by reference from the adapter. Read only; never mutated. */
  readonly world: World
  /** Every structure instance, complete or not — `ColonyState.queue`, unchanged. */
  readonly queue: ConstructionQueue
  /** Device pixels per tile. Defaults to `renderWorld`'s own {@link DEFAULT_TILE_SIZE}. */
  readonly tileSize?: number
}


/**
 * Draw the colony: the surveyed world, then its structures. Never throws.
 *
 * @param painter - A 2D canvas context, or anything structurally like one.
 * @param params - See {@link RenderColonyParams}.
 */
export function renderColony(painter: Painter2D, params: RenderColonyParams): void {
  const { world, tileSize = DEFAULT_TILE_SIZE } = params

  // Layers 1-5, delegated whole. This also performs the transform reset, so the structure
  // layer below inherits a known-clean context exactly as the terrain does.
  renderWorld(painter, world, { tileSize })

  const size = normaliseTileSize(tileSize)
  if (size === 0) return

  // FILLS FIRST, ACROSS EVERY STRUCTURE, THEN RIMS — not fill-and-rim per structure. Two
  // structures on adjacent tiles would otherwise let the second one's body paint over the
  // first one's rim, and the seam between them would disappear on some pairs and not others
  // depending on queue order. Two passes make the layering a property of the code.
  fillStructures(painter, params, size)
  rimStructures(painter, params, size)
}

/** Whether a tile is on the playable grid — the same defence `drawDeposits` applies. */
function onGrid(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.grid.width && y < world.grid.height
}

/** Layer 6a: each structure's body, one rectangle per occupied tile. */
function fillStructures(painter: Painter2D, params: RenderColonyParams, size: number): void {
  const { world, queue } = params
  for (const project of queue) {
    const livery = structureLivery(project.structureType.id)
    painter.fillStyle = rgbaCss(livery.fill, STRUCTURE_FILL_ALPHA)
    for (const tile of project.tiles) {
      if (!onGrid(world, tile.x, tile.y)) continue
      painter.fillRect(tile.x * size, tile.y * size, size, size)
    }
  }
}

/**
 * Layer 6b: a rim around every occupied tile.
 *
 * PER TILE rather than around the footprint's outline, and that is a correctness choice
 * rather than a stylistic one: a footprint is an arbitrary set of offsets (`catalog.ts`
 * imposes no shape on it), so the union of its tiles is not necessarily a rectangle. An
 * outline routine that assumed one would draw the right box for today's 2x2 hulls and a
 * wrong box for the first L-shaped structure. Ruling every tile is always correct, and at
 * nine pixels a tile it reads as a technical plan of the building rather than as noise.
 *
 * Half-pixel coordinates for the same reason `drawGraticule` uses them: a 1 px stroke is
 * centred on its path, so on an integer coordinate it straddles two pixel columns at half
 * intensity each.
 */
function rimStructures(painter: Painter2D, params: RenderColonyParams, size: number): void {
  const { world, queue } = params
  for (const project of queue) {
    const livery = structureLivery(project.structureType.id)
    painter.strokeStyle = rgbCss(livery.rim)
    painter.beginPath()
    for (const tile of project.tiles) {
      if (!onGrid(world, tile.x, tile.y)) continue
      const left = tile.x * size + 0.5
      const top = tile.y * size + 0.5
      const right = left + size - 1
      const bottom = top + size - 1
      painter.moveTo(left, top)
      painter.lineTo(right, top)
      painter.lineTo(right, bottom)
      painter.lineTo(left, bottom)
      painter.closePath()
    }
    painter.stroke()
  }
}
