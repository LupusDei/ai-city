/**
 * The `<canvas>` the colony is drawn to. A mount, not a renderer.
 *
 * Deliberately a near-twin of `canvas/TerrainCanvas.tsx`, and deliberately NOT that
 * component with a prop added.
 *
 * WHY A SEPARATE COMPONENT RATHER THAN A `structures` PROP ON `TerrainCanvas`. Because
 * `TerrainCanvas` is inside the bytes spec 005's AC-1.3 compares. That test screenshots the
 * survey screen's canvas element and requires it byte-identical across a page reload, and it
 * is stronger than its name — the candidate-site markers are painted over that element, so
 * the marker layer's determinism is inside the same assertion. Any change to that component
 * or to `render-world.ts` risks a failure that presents as a terrain-rendering bug with no
 * visible cause, and `src/app/canvas/` is shared with the survey screen while both screens
 * are being redesigned. A second mount costs about twenty lines and cannot reach that test.
 *
 * The terrain itself is still drawn by exactly one renderer: `renderColony` calls
 * `renderWorld`. This file duplicates a MOUNT, never a picture.
 *
 * Everything `TerrainCanvas`'s docblock says about sizing applies here unchanged and for the
 * same reasons: no `devicePixelRatio` multiplier and no measured container size, so the
 * backing store and the CSS box are the same size and one canvas pixel is one tile pixel.
 */
import { useLayoutEffect, useRef, type JSX } from 'react'

import type { ConstructionQueue } from '../../../sim/construction'
import type { World } from '../../../sim/world'
import { worldPixelSize } from '../../canvas/render-world'
import { OPS_TILE_SIZE, renderColony } from './render-colony'

export interface ColonyCanvasProps {
  /** The surveyed world to draw. Read only; never mutated. */
  readonly world: World
  /** The structures standing on it — `ColonyState.queue`, unchanged. */
  readonly queue: ConstructionQueue
  /** Device pixels per tile. Defaults to {@link OPS_TILE_SIZE}. */
  readonly tileSize?: number
}

/** The colony plate: terrain, deposits and the colony's own structures, on one canvas. */
export function ColonyCanvas({
  world,
  queue,
  tileSize = OPS_TILE_SIZE,
}: ColonyCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = worldPixelSize(world, tileSize)

  // A LAYOUT effect so the plate is never displayed blank for a frame — the same choice
  // `TerrainCanvas` makes, and here it also means the map is painted before the constraint
  // strip above it settles, so the screen does not appear to load in two stages.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    // Narrowed, never asserted: `no-non-null-assertion` is an error in `src/`, and a wrong
    // `!` here would be an uncaught TypeError, which AC-1.1 fails the whole suite on.
    if (canvas === null) return

    const context = canvas.getContext('2d')
    // Genuinely nullable — a lost GPU context, a headless environment, or jsdom, which is
    // how `tests/unit/ops-screen.test.tsx` renders this screen. Drawing nothing is correct:
    // the page stays up and every readout beside the plate still works.
    if (context === null) return

    // A real `CanvasRenderingContext2D` passed straight in, which is the compile-time proof
    // that `Painter2D` has not drifted from the real thing.
    renderColony(context, { world, queue, tileSize })
  }, [world, queue, tileSize])

  return (
    <canvas
      ref={canvasRef}
      data-testid="colony-canvas"
      width={width}
      height={height}
      // Equal to the backing store, in CSS pixels. See the docblock.
      style={{ width: `${String(width)}px`, height: `${String(height)}px`, display: 'block' }}
      role="img"
      aria-label="Colony map: surveyed terrain, mineral deposits and the colony’s structures"
    />
  )
}
