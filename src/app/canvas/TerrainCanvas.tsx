/**
 * The `<canvas>` the surveyed world is drawn to, and DELIBERATELY nothing else.
 *
 * This component is a mount, not a renderer. It owns a canvas ref, obtains a 2D context,
 * and hands both it and the world to `renderWorld`. It contains no drawing code, no
 * colour, no geometry and — constitution §4 — no game logic whatsoever. The split is not
 * decoration:
 *
 *   - `src/app/**\/*.tsx` is excluded from the coverage gate; pure `.ts` under `src/app/`
 *     is not. Keeping the logic in `render-world.ts` keeps it inside the 80/70/60 gate
 *     instead of quietly outside it.
 *   - It is what makes AC-1.3 (byte-identical terrain across a reload) testable against a
 *     recording context in milliseconds, rather than only through a browser screenshot.
 *
 * WHY THERE IS NO devicePixelRatio SCALING HERE. Multiplying the backing store by
 * `devicePixelRatio` and scaling it back down in CSS is the standard recipe for a crisp
 * canvas, and it is wrong for this one. It makes the rendered bytes a function of the
 * display, and it inserts a browser resampling step between the render and the bytes
 * AC-1.3 compares. Instead the backing store and the CSS box are the SAME size, so one
 * canvas pixel is one tile pixel — crisp by construction, with nothing between the draw
 * calls and the pixels. `render-world.ts`'s docblock lists the rest of the determinism
 * constraints this obeys.
 *
 * WHY THE SIZE IS NOT MEASURED FROM THE CONTAINER. A measured size depends on layout,
 * which depends on font loading and scrollbar presence, both of which can settle
 * differently between two loads of the same page. The canvas is therefore sized from the
 * world and the tile size alone. Resizing the window does not distort the map because
 * nothing about the map is a function of the window.
 *
 * ============================================================================
 * `fitParent` (aic-oby.8) — RESPONSIVE DISPLAY WITHOUT A RESPONSIVE BACKING STORE
 * ----------------------------------------------------------------------------
 * The General played the live build on a phone: "Grid is slightly off screen and I can't
 * tell where I am placing items." The map's BACKING STORE cannot become viewport-sized —
 * that is exactly the "WHY THE SIZE IS NOT MEASURED FROM THE CONTAINER" constraint above,
 * because a phone's viewport width is layout, and layout is precisely what AC-1.3 forbids
 * the rendered bytes from depending on.
 *
 * So `fitParent` changes only the CSS PRESENTATION, never the backing store: with it set,
 * the canvas's `width`/`height` ATTRIBUTES (what `renderWorld` draws to, and what AC-1.3
 * compares) stay exactly `worldPixelSize(world, tileSize)`, and only the CSS `width`/
 * `height` become `100%` of whatever box the caller places the canvas in. A responsive
 * caller (`OpsScreen.tsx`'s build panel) gives that box a `max-width` capped at the
 * intrinsic pixel size and an `aspect-ratio` matching it, so on a wide screen the box
 * resolves to EXACTLY the intrinsic size (pixel-for-pixel identical to the non-responsive
 * path, and therefore no different for AC-1.3) and only shrinks, proportionally, once the
 * viewport is narrower than the map — which is precisely a phone.
 *
 * Defaults to `false`, so every caller that does not opt in (`SurveyScreen.tsx`, and every
 * existing test) renders byte-for-byte what this component always rendered.
 */
import { useLayoutEffect, useRef, type CSSProperties, type JSX } from 'react'

import type { World } from '../../sim/world'
import { DEFAULT_TILE_SIZE, renderWorld, worldPixelSize } from './render-world'
import type { StructureRenderEntry } from './render-world'

export interface TerrainCanvasProps {
  /** The surveyed world to draw. Read only; never mutated. */
  readonly world: World
  /** Device pixels per tile. Defaults to {@link DEFAULT_TILE_SIZE}. */
  readonly tileSize?: number
  /**
   * The colony to draw over the terrain — every placed structure, complete or not. See
   * `render-world.ts`'s `StructureRenderEntry`. Defaults to none, which is exactly what
   * the survey screen (no colony exists yet) wants.
   */
  readonly structures?: readonly StructureRenderEntry[]
  /**
   * Fill the parent element's box responsively instead of the backing store's own fixed
   * pixel size. See the header above: this changes CSS presentation only. Defaults to
   * `false`.
   */
  readonly fitParent?: boolean
}

/**
 * The terrain canvas carrying the acceptance suite's `terrain-canvas` testid.
 *
 * AC-1.2 asserts this element is visible AND has a non-zero bounding box, because a
 * zero-area canvas is "visible" to the DOM while drawing nothing at all — the most common
 * way a canvas mount fails silently. The box is non-zero because `worldPixelSize` derives
 * it from the world's own grid dimensions.
 */
export function TerrainCanvas({
  world,
  tileSize = DEFAULT_TILE_SIZE,
  structures,
  fitParent = false,
}: TerrainCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = worldPixelSize(world, tileSize)

  // A LAYOUT effect, not a passive one: it runs after the DOM is updated but BEFORE the
  // browser paints, so the canvas is never displayed blank for a frame. That is a
  // correctness point for AC-1.3 and not just polish — a screenshot taken in that frame
  // on one load and after it on the next would differ by the entire picture.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    // Narrowed, never asserted. `no-non-null-assertion` is an error in `src/`, and a
    // wrong `!` here would be an uncaught TypeError on the page — which AC-1.1 fails the
    // whole acceptance suite on.
    if (canvas === null) return

    const context = canvas.getContext('2d')
    // `getContext` is genuinely nullable: a lost GPU context, a headless environment, or
    // jsdom (which is how `tests/unit/terrain-canvas.test.tsx` exercises this branch).
    // Rendering nothing is the correct response — the page stays up and the rest of the
    // survey screen still works.
    if (context === null) return

    // The compile-time proof that `Painter2D` has not drifted from the real context: a
    // real `CanvasRenderingContext2D` is passed straight in, so a missing or mistyped
    // member fails `npm run typecheck`.
    renderWorld(context, world, { tileSize, structures })
  }, [world, tileSize, structures])

  // `fitParent`: CSS presentation only — see the `fitParent` header above. The `width`/
  // `height` ATTRIBUTES just below (the backing store AC-1.3 compares) are unaffected
  // either way.
  const style: CSSProperties = fitParent
    ? { width: '100%', height: '100%', display: 'block' }
    : { width: `${String(width)}px`, height: `${String(height)}px`, display: 'block' }

  return (
    <canvas
      ref={canvasRef}
      data-testid="terrain-canvas"
      width={width}
      height={height}
      style={style}
      role="img"
      aria-label="Martian surface survey: elevation shading, buildability and mineral deposits"
    />
  )
}
