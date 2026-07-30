// @vitest-environment jsdom
/**
 * Tests for `<TerrainCanvas>` (`src/app/canvas/TerrainCanvas.tsx`).
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT. jsdom has no 2D canvas implementation, so
 * `getContext('2d')` returns `null` here and NO PIXELS ARE EVER DRAWN in this suite.
 * That makes this file useless for testing the drawing itself — which is exactly why the
 * drawing lives in `render-world.ts` and is tested against a recording painter in
 * `render-world.test.ts`, and why the pixels are asserted in the browser by AC-1.2/AC-1.3.
 *
 * What this file DOES test is the three things the component alone is responsible for,
 * each of which has bitten a canvas component somewhere:
 *
 *   1. The backing store has a non-zero size. AC-1.2 checks the bounding box explicitly
 *      because a zero-area canvas is "visible" to the DOM and draws nothing at all — the
 *      single most common way a canvas mount silently fails.
 *   2. A missing 2D context is survived, not crashed on. `getContext` is nullable in the
 *      type system for real reasons (a lost GPU context, a headless environment, this
 *      very test file), and AC-1.1 fails the whole suite on one uncaught page error.
 *   3. The CSS size equals the backing-store size, which is what keeps AC-1.3's
 *      byte-comparison honest — see the component's own docblock.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Tile } from '../../src/sim/grid'
import type { World } from '../../src/sim/world'
import { generateWorld } from '../../src/sim/world'
import { TerrainCanvas } from '../../src/app/canvas/TerrainCanvas'
import { DEFAULT_TILE_SIZE, worldPixelSize } from '../../src/app/canvas/render-world'

afterEach(() => {
  // Matches tests/unit/app-shell.test.tsx: no global auto-cleanup is configured, so each
  // test clears the document itself or `getByTestId` throws on the duplicate.
  document.body.innerHTML = ''
})

const world = generateWorld(8, 8, 20260730)

function canvas(): HTMLCanvasElement {
  const element = screen.getByTestId('terrain-canvas')
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`terrain-canvas must be a <canvas>, found <${element.tagName.toLowerCase()}>`)
  }
  return element
}

describe('TerrainCanvas', () => {
  it('should render a canvas carrying the acceptance suite’s terrain-canvas testid', () => {
    render(<TerrainCanvas world={world} />)
    expect(canvas().tagName).toBe('CANVAS')
  })

  it('should size the backing store to the whole world, in device pixels', () => {
    render(<TerrainCanvas world={world} />)
    const expected = worldPixelSize(world, DEFAULT_TILE_SIZE)
    expect(canvas().width).toBe(expected.width)
    expect(canvas().height).toBe(expected.height)
  })

  it('should give the canvas a NON-ZERO backing store — the thing AC-1.2 checks', () => {
    render(<TerrainCanvas world={world} />)
    expect(canvas().width).toBeGreaterThan(0)
    expect(canvas().height).toBeGreaterThan(0)
  })

  it('should set the CSS size equal to the backing-store size', () => {
    // One CSS pixel per backing-store pixel means the browser neither up- nor
    // downsamples the canvas, so an element screenshot is the backing store verbatim.
    // Any scaling factor here — including devicePixelRatio — is a resampling step
    // between the render and the bytes AC-1.3 compares.
    render(<TerrainCanvas world={world} />)
    const { width, height } = worldPixelSize(world, DEFAULT_TILE_SIZE)
    expect(canvas().style.width).toBe(`${String(width)}px`)
    expect(canvas().style.height).toBe(`${String(height)}px`)
  })

  it('should honour an explicit tile size', () => {
    render(<TerrainCanvas world={world} tileSize={4} />)
    expect(canvas().width).toBe(8 * 4)
    expect(canvas().height).toBe(8 * 4)
  })

  it('should not throw when the 2D context is unavailable', () => {
    // jsdom IS this case: `getContext('2d')` returns null with no canvas backend
    // installed. The component must narrow that null rather than assert past it — a
    // `getContext('2d')!` here would be an uncaught TypeError on the page, and AC-1.1
    // fails the entire acceptance suite on a single console error.
    expect(() => render(<TerrainCanvas world={world} />)).not.toThrow()
  })

  it('should not throw for a zero tile size, and should report a zero-size canvas', () => {
    // Spec 005 edge case: "A canvas of zero size (hidden container) — must not throw."
    expect(() => render(<TerrainCanvas world={world} tileSize={0} />)).not.toThrow()
    expect(canvas().width).toBe(0)
    expect(canvas().height).toBe(0)
  })

  it('should not throw for a world with no tiles', () => {
    const empty: World = {
      terrain: { width: 0, height: 0, seed: 1, latitude: 40, elevation: [] },
      buildability: { width: 0, height: 0, score: [] },
      deposits: [],
      grid: { width: 0, height: 0, tiles: [] as readonly Tile[] },
    }
    expect(() => render(<TerrainCanvas world={empty} />)).not.toThrow()
    expect(canvas().width).toBe(0)
  })

  // -------------------------------------------------------------------------
  // `fitParent` (aic-oby.8): responsive display without a responsive backing store
  // -------------------------------------------------------------------------

  it('should default to the fixed backing-store CSS size when fitParent is not given', () => {
    // Every caller and every OTHER test in this file predates `fitParent` and must keep
    // rendering byte-for-byte what this component always rendered.
    render(<TerrainCanvas world={world} />)
    const { width, height } = worldPixelSize(world, DEFAULT_TILE_SIZE)
    expect(canvas().style.width).toBe(`${String(width)}px`)
    expect(canvas().style.height).toBe(`${String(height)}px`)
  })

  it('should fill the parent responsively when fitParent is true', () => {
    render(<TerrainCanvas world={world} fitParent />)
    expect(canvas().style.width).toBe('100%')
    expect(canvas().style.height).toBe('100%')
  })

  it('should NOT change the backing store when fitParent is true — only the CSS', () => {
    // The whole point of `fitParent`: the bytes AC-1.3 compares (the backing store) must
    // be identical whether or not the CSS presentation is responsive.
    render(<TerrainCanvas world={world} fitParent />)
    const expected = worldPixelSize(world, DEFAULT_TILE_SIZE)
    expect(canvas().width).toBe(expected.width)
    expect(canvas().height).toBe(expected.height)
  })
})
