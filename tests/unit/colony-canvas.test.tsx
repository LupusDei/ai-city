// @vitest-environment jsdom
/**
 * Tests for `<ColonyCanvas>` (`src/app/screens/ops/ColonyCanvas.tsx`).
 *
 * THE SAME SCOPE, AND THE SAME LIMIT, AS `terrain-canvas.test.tsx`. jsdom has no 2D canvas
 * implementation, so `getContext('2d')` returns `null` here and NO PIXELS ARE DRAWN in this
 * file at all. That is why the drawing lives in `render-colony.ts` and is tested against a
 * recording painter, and why this file tests only the three things the MOUNT is responsible
 * for: a non-zero backing store, a survivable null context, and a CSS box equal to the
 * backing store.
 *
 * The third is the one worth stating for THIS canvas specifically. `renderColony` places a
 * structure at `tile.x * tileSize`, so any scaling between the backing store and the CSS box
 * — a `devicePixelRatio` multiplier being the usual culprit — would put the hulls somewhere
 * other than where the player can see the terrain they were sited on. On this screen a
 * mis-scaled canvas is not a blurry picture; it is a map that lies about where the colony is.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ColonyCanvas } from '../../src/app/screens/ops/ColonyCanvas'
import { OPS_TILE_SIZE } from '../../src/app/screens/ops/render-colony'
import { worldPixelSize } from '../../src/app/canvas/render-world'
import { startedColony } from '../support/running-colony'

afterEach(() => {
  // No global auto-cleanup is configured, so each test clears the document itself or
  // `getByTestId` throws on the duplicate.
  document.body.innerHTML = ''
})

/** A REAL started colony — see `running-colony.ts` on why nothing here is hand-built. */
const colony = startedColony()

function canvas(): HTMLCanvasElement {
  const element = screen.getByTestId('colony-canvas')
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`colony-canvas must be a <canvas>, found <${element.tagName.toLowerCase()}>`)
  }
  return element
}

function renderPlate(tileSize?: number): void {
  render(<ColonyCanvas world={colony.world} queue={colony.colony.queue} tileSize={tileSize} />)
}

describe('ColonyCanvas', () => {
  it('should render a canvas under its own testid, not the survey screen’s', () => {
    // A DISTINCT testid, and that matters: AC-1.3 screenshots `terrain-canvas` and compares
    // the bytes across a reload. A second element sharing that id would put this screen's
    // canvas inside the survey screen's contract for no reason at all.
    renderPlate()
    expect(canvas().tagName).toBe('CANVAS')
    expect(screen.queryByTestId('terrain-canvas')).toBeNull()
  })

  it('should size the backing store to the whole world, in device pixels', () => {
    renderPlate()
    const expected = worldPixelSize(colony.world, OPS_TILE_SIZE)
    expect(canvas().width).toBe(expected.width)
    expect(canvas().height).toBe(expected.height)
  })

  it('should default to the operations tile size, which is larger than the survey’s', () => {
    // The map is the hero on this screen. 64 tiles at 9 px is 576 px square.
    renderPlate()
    expect(canvas().width).toBe(64 * OPS_TILE_SIZE)
    expect(canvas().width).toBeGreaterThan(0)
  })

  it('should set the CSS size equal to the backing-store size', () => {
    // One CSS pixel per backing-store pixel. Any scaling factor here would move every
    // structure away from the terrain it stands on — see this file's header.
    renderPlate()
    const { width, height } = worldPixelSize(colony.world, OPS_TILE_SIZE)
    expect(canvas().style.width).toBe(`${String(width)}px`)
    expect(canvas().style.height).toBe(`${String(height)}px`)
  })

  it('should honour an explicit tile size', () => {
    renderPlate(4)
    expect(canvas().width).toBe(64 * 4)
    expect(canvas().height).toBe(64 * 4)
  })

  it('should not throw when the 2D context is unavailable', () => {
    // jsdom IS this case. The component must narrow the null rather than assert past it: a
    // `getContext('2d')!` would be an uncaught TypeError on the page, and AC-1.1 fails the
    // entire acceptance suite on a single console error.
    expect(() => {
      renderPlate()
    }).not.toThrow()
  })

  it('should not throw for a zero tile size, and should report a zero-size canvas', () => {
    expect(() => {
      renderPlate(0)
    }).not.toThrow()
    expect(canvas().width).toBe(0)
    expect(canvas().height).toBe(0)
  })

  it('should not throw for a colony with nothing standing on it', () => {
    // An empty queue must not mean an empty mount. The terrain is true whether or not
    // anything is built on it.
    expect(() => {
      render(<ColonyCanvas world={colony.world} queue={[]} />)
    }).not.toThrow()
    expect(canvas().width).toBe(64 * OPS_TILE_SIZE)
  })
})
