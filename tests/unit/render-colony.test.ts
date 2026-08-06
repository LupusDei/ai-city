/**
 * Tests for `src/app/screens/ops/render-colony.ts` — the colony plate.
 *
 * WHY THIS MODULE EXISTS AT ALL. The operations screen had no map. The player spends the
 * opening minute reading terrain, weighing deposits against buildable ground and committing
 * two hulls to a chosen spot, and then arrived at a page of number cards where the colony
 * they had just sited did not appear. This renderer puts it back: the surveyed world, drawn
 * by the SAME `renderWorld` the survey screen uses, with the landed hulls on top of it.
 *
 * HOW A CANVAS IS TESTED WITHOUT A CANVAS — the technique is `render-world.test.ts`'s and
 * the reasoning is that file's. `renderColony` draws through `Painter2D`, so a RECORDING
 * painter can capture an ordered trace of every style assignment and draw call, and the
 * assertions run against the trace. Two renders compared as traces prove determinism and
 * localise any divergence to a single call, which a screenshot comparison cannot.
 *
 * WHAT THE TRACE ASSERTIONS ARE REALLY FOR. Not pixel-peeping: they pin the two properties
 * a screenshot would not explain if it regressed —
 *   1. THE TERRAIN IS DRAWN FIRST AND THE HULLS SECOND. Reverse them and the hulls vanish
 *      under the ground with no error anywhere.
 *   2. THE HULLS ARE AT THE TILES THE SIM PUT THEM ON. A plate that drew a hull one tile
 *      off, or at a hard-coded position, is the `aic-c1p` defect in pixels: a picture
 *      assembled from data the simulation never produced.
 */

import { describe, expect, it } from 'vitest'

import {
  DRONE_HULL_LIVERY,
  REACTOR_HULL_LIVERY,
  STRUCTURE_FILL_ALPHA,
  UNKNOWN_STRUCTURE_LIVERY,
  renderColony,
  structureLivery,
} from '../../src/app/screens/ops/render-colony'
import { rgbCss, rgbaCss } from '../../src/app/canvas/mars-palette'
import type { Painter2D } from '../../src/app/canvas/render-world'
import { DRONE_HULL_ID, REACTOR_HULL_ID } from '../../src/sim/colony-start'
import type { ConstructionQueue } from '../../src/sim/construction'
import { startedColony } from '../support/running-colony'

const TILE = 9

// ---------------------------------------------------------------------------
// The recording painter
// ---------------------------------------------------------------------------

/** Non-string styles are reported rather than blindly stringified — see render-world.test.ts. */
function styleText(value: string | CanvasGradient | CanvasPattern): string {
  return typeof value === 'string' ? value : '<non-string-style>'
}

/** A `Painter2D` that records an ordered, readable trace of everything done to it. */
class RecordingPainter implements Painter2D {
  readonly trace: string[] = []

  #fillStyle: string | CanvasGradient | CanvasPattern = '#000000'
  #strokeStyle: string | CanvasGradient | CanvasPattern = '#000000'
  #lineWidth = 1

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.#fillStyle
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#fillStyle = value
    this.trace.push(`fillStyle=${styleText(value)}`)
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.#strokeStyle
  }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#strokeStyle = value
    this.trace.push(`strokeStyle=${styleText(value)}`)
  }

  get lineWidth(): number {
    return this.#lineWidth
  }
  set lineWidth(value: number) {
    this.#lineWidth = value
    this.trace.push(`lineWidth=${value}`)
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.trace.push(`setTransform(${a},${b},${c},${d},${e},${f})`)
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.trace.push(`clearRect(${x},${y},${width},${height})`)
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.trace.push(`fillRect(${x},${y},${width},${height})`)
  }
  beginPath(): void {
    this.trace.push('beginPath()')
  }
  moveTo(x: number, y: number): void {
    this.trace.push(`moveTo(${x},${y})`)
  }
  lineTo(x: number, y: number): void {
    this.trace.push(`lineTo(${x},${y})`)
  }
  closePath(): void {
    this.trace.push('closePath()')
  }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.trace.push(`arc(${x},${y},${radius},${startAngle},${endAngle})`)
  }
  fill(): void {
    this.trace.push('fill()')
  }
  stroke(): void {
    this.trace.push('stroke()')
  }
}

/** The real colony's world and queue — never a hand-built stand-in. See running-colony.ts. */
function colony(): { world: ReturnType<typeof startedColony>['world']; queue: ConstructionQueue } {
  const state = startedColony()
  return { world: state.world, queue: state.colony.queue }
}

function paint(tileSize: number = TILE): RecordingPainter {
  const painter = new RecordingPainter()
  const { world, queue } = colony()
  renderColony(painter, { world, queue, tileSize })
  return painter
}

// ---------------------------------------------------------------------------

describe('structureLivery', () => {
  it('should give the drone hull the survey screen’s own drone-hull mark colour', () => {
    // The two screens must teach ONE symbol set: the mark the player clicked to place the
    // drone hull is the mark they see standing on the colony. A second palette here would
    // silently un-teach the survey screen's legend.
    expect(structureLivery(DRONE_HULL_ID)).toBe(DRONE_HULL_LIVERY)
  })

  it('should give the reactor hull the survey screen’s reactor-hull mark colour', () => {
    expect(structureLivery(REACTOR_HULL_ID)).toBe(REACTOR_HULL_LIVERY)
  })

  it('should fall back to a neutral livery for a structure it has no colour for', () => {
    // Every structure the player will later build arrives through this branch. Drawing it
    // in a default colour is right; throwing, or skipping it, would mean a structure that
    // exists in the simulation and nowhere on the map.
    expect(structureLivery('regolith-hopper')).toBe(UNKNOWN_STRUCTURE_LIVERY)
  })

  it('should not mistake an empty id for a hull', () => {
    expect(structureLivery('')).toBe(UNKNOWN_STRUCTURE_LIVERY)
  })
})

describe('renderColony layering', () => {
  it('should draw the terrain before any structure, so no hull is buried under the ground', () => {
    const { trace } = paint()
    // The renderer's first act is its transform reset; the plate's structures cannot
    // precede it or they would be drawn under every terrain tile that follows.
    expect(trace[0]).toBe('setTransform(1,0,0,1,0,0)')
    const firstHullFill = trace.indexOf(`fillStyle=${rgbaCss(DRONE_HULL_LIVERY.fill, STRUCTURE_FILL_ALPHA)}`)
    const lastTerrainCall = trace.lastIndexOf('clearRect(0,0,576,576)')
    expect(firstHullFill).toBeGreaterThan(lastTerrainCall)
    expect(firstHullFill).toBeGreaterThan(-1)
  })

  it('should still draw the surveyed world when the colony has no structures at all', () => {
    // An empty queue must not mean an empty map. The terrain is the survey's result and is
    // true whether or not anything is standing on it.
    const painter = new RecordingPainter()
    const { world } = colony()
    renderColony(painter, { world, queue: [], tileSize: TILE })
    expect(painter.trace).toContain('clearRect(0,0,576,576)')
    expect(painter.trace).not.toContain(
      `fillStyle=${rgbaCss(DRONE_HULL_LIVERY.fill, STRUCTURE_FILL_ALPHA)}`,
    )
  })
})

describe('renderColony hull placement', () => {
  it('should fill every tile the sim says the drone hull occupies, and only those', () => {
    // The fixture lands the drone hull at (10, 10) and HULL_FOOTPRINT is the 2x2 block, so
    // at 9 px per tile the plate must paint exactly (90,90), (99,90), (90,99), (99,99).
    const { trace } = paint()
    for (const [x, y] of [
      [90, 90],
      [99, 90],
      [90, 99],
      [99, 99],
    ]) {
      expect(trace).toContain(`fillRect(${x},${y},9,9)`)
    }
  })

  it('should fill the reactor hull at its own anchor, not the drone hull’s', () => {
    // (30, 30) -> 270 px. A plate that drew both hulls from one anchor would pass every
    // assertion above and still be wrong about the colony.
    const { trace } = paint()
    expect(trace).toContain('fillRect(270,270,9,9)')
    expect(trace).toContain('fillRect(279,279,9,9)')
  })

  it('should scale hull positions with the tile size rather than hard-coding them', () => {
    const { trace } = paint(4)
    expect(trace).toContain('fillRect(40,40,4,4)')
    expect(trace).toContain('fillRect(120,120,4,4)')
  })

  it('should rim each hull tile so the footprint reads against the terrain beneath it', () => {
    const { trace } = paint()
    // MARS_VOID, which is the rim colour every livery shares — the same near-black the
    // renderer fills the backing store with, so a hull is outlined against its own ground.
    expect(trace).toContain(`strokeStyle=${rgbCss(DRONE_HULL_LIVERY.rim)}`)
    // Half-pixel geometry, exactly as the graticule uses: a 1 px stroke centred on an
    // integer coordinate straddles two pixel columns at half intensity.
    expect(trace).toContain('moveTo(90.5,90.5)')
  })

  it('should draw every rim after every fill, so no rim is covered by a neighbour', () => {
    const { trace } = paint()
    const lastFill = trace.lastIndexOf('fillRect(279,279,9,9)')
    const firstRim = trace.indexOf('moveTo(90.5,90.5)')
    expect(firstRim).toBeGreaterThan(lastFill)
  })
})

describe('renderColony robustness', () => {
  it('should draw nothing and never throw for a zero tile size', () => {
    // Spec 005's hidden-container edge case, inherited from `renderWorld`.
    const painter = new RecordingPainter()
    const { world, queue } = colony()
    expect(() => {
      renderColony(painter, { world, queue, tileSize: 0 })
    }).not.toThrow()
    expect(painter.trace).toEqual(['setTransform(1,0,0,1,0,0)'])
  })

  it('should not throw on a nonsensical tile size', () => {
    const painter = new RecordingPainter()
    const { world, queue } = colony()
    expect(() => {
      renderColony(painter, { world, queue, tileSize: Number.NaN })
    }).not.toThrow()
  })

  it('should skip a structure standing outside the grid instead of drawing off-canvas', () => {
    // Defence in depth for a hand-built or imported colony, matching `drawDeposits`. A
    // structure at a negative coordinate is not something to discover from a screenshot.
    const painter = new RecordingPainter()
    const { world, queue } = colony()
    const first = queue[0]
    if (first === undefined) throw new Error('the fixture colony has no structures')
    const stray: ConstructionQueue = [{ ...first, tiles: [{ x: -1, y: -1 }, { x: 9999, y: 0 }] }]
    renderColony(painter, { world, queue: stray, tileSize: TILE })
    expect(painter.trace).not.toContain('fillRect(-9,-9,9,9)')
    expect(painter.trace.some((call) => call.startsWith('fillRect(89991'))).toBe(false)
  })

  it('should default to a tile size rather than requiring one', () => {
    const painter = new RecordingPainter()
    const { world, queue } = colony()
    renderColony(painter, { world, queue })
    expect(painter.trace).toContain('clearRect(0,0,512,512)')
  })
})

describe('renderColony determinism', () => {
  it('should produce an identical trace for two renders of the same colony', () => {
    // The same property `render-world.test.ts` pins for the terrain, extended over the
    // structure layer: no clock, no randomness, no Map or Set iteration order.
    expect(paint().trace).toEqual(paint().trace)
  })
})
