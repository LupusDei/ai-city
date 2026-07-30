/**
 * Tests for the world renderer (`src/app/canvas/render-world.ts`).
 *
 * HOW THIS TESTS A CANVAS WITHOUT A CANVAS. `renderWorld` draws through `Painter2D`, a
 * structural subset of `CanvasRenderingContext2D` containing only the eleven members the
 * renderer actually uses. That seam lets these tests pass a RECORDING painter that
 * appends every style assignment and every draw call to an ordered string trace, and
 * then assert against the trace.
 *
 * The trace is a far stronger instrument than a screenshot for the property that
 * matters here. AC-1.3 requires the terrain to be BYTE-IDENTICAL across a page reload,
 * and a screenshot comparison can only tell you that two images differ — not where the
 * nondeterminism entered. Comparing two traces localises it to a single draw call, runs
 * in milliseconds instead of seconds, and — crucially — fails for `Math.random()`,
 * `Date.now()`, Map/Set iteration order and float-formatting drift alike, because all
 * four show up as a differing argument in the sequence.
 *
 * The screenshot assertion in `tests/acceptance/playable-start.spec.ts` still earns its
 * place: it is the only thing that proves the browser turns this call sequence into
 * pixels at all. These tests prove the call sequence is worth turning into pixels.
 */
import { describe, expect, it } from 'vitest'

import { generateWorld } from '../../src/sim/world'
import type { MineralDeposit } from '../../src/sim/buildability'
import type { Tile } from '../../src/sim/grid'
import type { World } from '../../src/sim/world'
import {
  DEFAULT_TILE_SIZE,
  GRATICULE_MIN_TILE_SIZE,
  GRATICULE_TILE_INTERVAL,
  renderWorld,
  worldPixelSize,
} from '../../src/app/canvas/render-world'
import type { Painter2D, StructureRenderEntry } from '../../src/app/canvas/render-world'
import {
  STRUCTURE_INCOMPLETE_FILL_ALPHA,
  rgbCss,
  rgbaCss,
  structureFill,
} from '../../src/app/canvas/mars-palette'

const SEED = 20260730
const MAP = 64

// ---------------------------------------------------------------------------
// The recording painter
// ---------------------------------------------------------------------------

/** A style value the renderer set. Non-strings are reported, never stringified blindly. */
function styleText(value: string | CanvasGradient | CanvasPattern): string {
  // The renderer is expected to use CSS colour STRINGS only — gradients and patterns
  // carry object identity, and object identity is exactly the sort of thing that is
  // stable within one page load and meaningless across two.
  return typeof value === 'string' ? value : '<non-string-style>'
}

/**
 * A `Painter2D` that records an ordered, human-readable trace of everything done to it.
 *
 * Style ASSIGNMENTS are recorded as well as draw calls, because a renderer that emitted
 * the right rectangles in the wrong colours would otherwise pass every test here.
 */
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
  clearRect(x: number, y: number, w: number, h: number): void {
    this.trace.push(`clearRect(${x},${y},${w},${h})`)
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.trace.push(`fillRect(${x},${y},${w},${h})`)
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
  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.trace.push(`arc(${x},${y},${radius},${start},${end})`)
  }
  fill(): void {
    this.trace.push('fill()')
  }
  stroke(): void {
    this.trace.push('stroke()')
  }
}

function trace(
  world: World,
  tileSize?: number,
  structures?: readonly StructureRenderEntry[],
): readonly string[] {
  const painter = new RecordingPainter()
  renderWorld(painter, world, { tileSize, structures })
  return painter.trace
}

// ---------------------------------------------------------------------------
// Hand-built worlds, for assertions that need to know every tile
// ---------------------------------------------------------------------------

/**
 * A world with hand-chosen elevations, buildability and deposits.
 *
 * Built by hand rather than seeded so that a coordinate assertion can name the exact
 * expected colour and rectangle. `generateWorld` is used for the determinism and scale
 * tests, where the point is precisely that the renderer does not care what the numbers
 * are.
 */
function stubWorld(options: {
  readonly width: number
  readonly height: number
  readonly elevation: readonly number[]
  readonly score: readonly number[]
  readonly deposits?: readonly MineralDeposit[]
}): World {
  const { width, height, elevation, score, deposits = [] } = options
  const tiles: Tile[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) tiles.push({ x, y, occupantId: null })
  }
  return {
    terrain: { width, height, seed: 1, latitude: 40, elevation },
    buildability: { width, height, score },
    deposits,
    grid: { width, height, tiles },
  }
}

/** A 2x2 world, entirely flat (so the shade layer contributes nothing) and empty. */
function flat2x2(): World {
  return stubWorld({
    width: 2,
    height: 2,
    elevation: [0, 0.25, 0.5, 1],
    score: [1, 1, 1, 1],
  })
}

// ---------------------------------------------------------------------------
// worldPixelSize
// ---------------------------------------------------------------------------

describe('worldPixelSize', () => {
  it('should be the grid dimensions scaled by the tile size', () => {
    expect(worldPixelSize(flat2x2(), 8)).toEqual({ width: 16, height: 16 })
  })

  it('should default to DEFAULT_TILE_SIZE when no tile size is given', () => {
    expect(worldPixelSize(flat2x2())).toEqual({
      width: 2 * DEFAULT_TILE_SIZE,
      height: 2 * DEFAULT_TILE_SIZE,
    })
  })

  it('should report a zero size for a non-positive tile size rather than a negative one', () => {
    // A negative canvas width throws in the DOM (`IndexSizeError`); the spec's zero-size
    // container edge case requires the app not to throw, so this degrades to 0x0 and the
    // component simply renders an empty canvas.
    expect(worldPixelSize(flat2x2(), 0)).toEqual({ width: 0, height: 0 })
    expect(worldPixelSize(flat2x2(), -4)).toEqual({ width: 0, height: 0 })
  })

  it('should floor a fractional tile size so the backing store is a whole number of pixels', () => {
    // A fractional backing-store size is silently rounded by the browser, and WHICH way
    // it rounds is not something to leave to a byte-comparison test.
    expect(worldPixelSize(flat2x2(), 8.7)).toEqual({ width: 16, height: 16 })
  })

  it('should report a zero size for a world with no tiles', () => {
    expect(
      worldPixelSize(stubWorld({ width: 0, height: 0, elevation: [], score: [] }), 8),
    ).toEqual({ width: 0, height: 0 })
  })
})

// ---------------------------------------------------------------------------
// Determinism — the primary requirement (AC-1.3)
// ---------------------------------------------------------------------------

describe('renderWorld determinism', () => {
  it('should emit an identical call sequence when the same world is rendered twice', () => {
    const world = generateWorld(MAP, MAP, SEED)
    expect(trace(world)).toEqual(trace(world))
  })

  it('should emit an identical call sequence for two worlds generated from the same seed', () => {
    // This is AC-1.3 at unit level. A page reload does not re-render the same `World`
    // object; it regenerates one from the seed and renders THAT. So the property the
    // acceptance screenshot actually depends on is this one — equal-by-value worlds must
    // produce equal-by-value draw sequences.
    const first = generateWorld(MAP, MAP, SEED)
    const second = generateWorld(MAP, MAP, SEED)
    expect(first).not.toBe(second)
    expect(trace(second)).toEqual(trace(first))
  })

  it('should emit a DIFFERENT call sequence for a different seed', () => {
    // Guards the above from passing vacuously: a renderer that ignored the world and
    // drew a constant field of red would satisfy every determinism assertion here.
    const a = trace(generateWorld(MAP, MAP, SEED))
    const b = trace(generateWorld(MAP, MAP, SEED + 1))
    expect(b).not.toEqual(a)
  })

  it('should not depend on the painter’s incoming state', () => {
    // A canvas context carries ambient state (transform, lineWidth, styles). If the
    // renderer inherited any of it, the second draw of a StrictMode double-invoke — or
    // any future overlay drawn before it — could shift the terrain by a pixel. The
    // renderer therefore resets what it relies on, and the trace proves it: the first
    // calls are a transform reset and a line-width reset regardless of what came before.
    const painter = new RecordingPainter()
    painter.lineWidth = 17
    painter.fillStyle = 'magenta'
    const before = painter.trace.length
    renderWorld(painter, flat2x2(), { tileSize: 8 })
    expect(painter.trace[before]).toBe('setTransform(1,0,0,1,0,0)')
    expect(painter.trace.slice(before)).toContain('lineWidth=1')
  })

  it('should be idempotent — a second render over the first repeats it exactly', () => {
    // React StrictMode deliberately double-invokes effects. A renderer whose second pass
    // differed from its first would make the development build disagree with the
    // production build about what the map looks like.
    const painter = new RecordingPainter()
    const world = flat2x2()
    renderWorld(painter, world, { tileSize: 8 })
    const firstPass = [...painter.trace]
    painter.trace.length = 0
    renderWorld(painter, world, { tileSize: 8 })
    expect(painter.trace).toEqual(firstPass)
  })
})

// ---------------------------------------------------------------------------
// Draw order and layering
// ---------------------------------------------------------------------------

describe('renderWorld layering', () => {
  it('should clear the whole backing store before drawing anything', () => {
    const calls = trace(flat2x2(), 8)
    expect(calls[0]).toBe('setTransform(1,0,0,1,0,0)')
    expect(calls).toContain('clearRect(0,0,16,16)')
    expect(calls.indexOf('clearRect(0,0,16,16)')).toBeLessThan(calls.indexOf('fillRect(0,0,8,8)'))
  })

  it('should paint the whole extent opaque before the tiles, so no pixel is left transparent', () => {
    // A transparent pixel composites against whatever the page background happens to be.
    // That is a determinism hazard the moment anything else on the page changes, and it
    // is invisible in a light-on-light screenshot until it is not.
    const calls = trace(flat2x2(), 8)
    expect(calls.indexOf('fillRect(0,0,16,16)')).toBeLessThan(calls.indexOf('fillRect(0,0,8,8)'))
  })

  it('should draw every elevation tile before any deposit marker', () => {
    // Order is the whole of the determinism contract for overlapping paint. Deposits sit
    // ON the terrain; a terrain tile drawn after a marker would erase it.
    const world = stubWorld({
      width: 2,
      height: 1,
      elevation: [0, 1],
      score: [1, 1],
      deposits: [{ x: 0, y: 0, kind: 'silica', richness: 0.5 }],
    })
    const calls = trace(world, 8)
    const lastTile = calls.lastIndexOf('fillRect(8,0,8,8)')
    const firstMarker = calls.indexOf('beginPath()')
    expect(lastTile).toBeGreaterThanOrEqual(0)
    expect(firstMarker).toBeGreaterThan(lastTile)
  })

  it('should draw the slope shade over the elevation base, not under it', () => {
    // Two tiles, one flat and one a cliff. The cliff's shade rectangle must come after
    // BOTH elevation rectangles: the shade is a separate pass, so a shade drawn tile-by-
    // tile interleaved with the base would be a different (and more fragile) contract.
    const world = stubWorld({
      width: 2,
      height: 1,
      elevation: [0.5, 0.5],
      score: [1, 0],
    })
    const calls = trace(world, 8)
    const baseRects = calls.filter((c) => c === 'fillRect(8,0,8,8)')
    expect(baseRects).toHaveLength(2) // one elevation base, one shade, same rectangle
    expect(calls.indexOf('fillRect(0,0,8,8)')).toBeLessThan(calls.lastIndexOf('fillRect(8,0,8,8)'))
  })

  it('should skip the shade entirely for a fully buildable tile', () => {
    // Alpha 0 paints nothing, so issuing the call would be pure waste — and, more to the
    // point, a zero-alpha fill is indistinguishable from a bug in a screenshot.
    //
    // 2x1 rather than 1x1 so the tile rectangle cannot be confused with the full-extent
    // background rectangle, which on a 1x1 map is the very same call.
    const world = stubWorld({ width: 2, height: 1, elevation: [0.5, 0.5], score: [1, 1] })
    const calls = trace(world, 8)
    expect(calls.filter((c) => c === 'fillRect(0,0,8,8)')).toHaveLength(1)
    expect(calls.filter((c) => c === 'fillRect(8,0,8,8)')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The elevation base
// ---------------------------------------------------------------------------

describe('renderWorld elevation base', () => {
  it('should draw one rectangle per tile at the tile’s grid position', () => {
    const calls = trace(flat2x2(), 8)
    for (const rect of [
      'fillRect(0,0,8,8)',
      'fillRect(8,0,8,8)',
      'fillRect(0,8,8,8)',
      'fillRect(8,8,8,8)',
    ]) {
      expect(calls).toContain(rect)
    }
  })

  it('should visit tiles in row-major order', () => {
    // Row-major matches the sim's own storage order (`index = y * width + x`) and every
    // other iteration in the codebase. Fixing it here is what makes the draw sequence a
    // function of the world alone.
    const calls = trace(flat2x2(), 8)
    const order = calls.filter((c) => c.startsWith('fillRect(') && c !== 'fillRect(0,0,16,16)')
    expect(order).toEqual([
      'fillRect(0,0,8,8)',
      'fillRect(8,0,8,8)',
      'fillRect(0,8,8,8)',
      'fillRect(8,8,8,8)',
    ])
  })

  it('should give different elevations different fill colours', () => {
    const world = stubWorld({ width: 2, height: 1, elevation: [0, 1], score: [1, 1] })
    const calls = trace(world, 8)
    const fills = calls.filter((c) => c.startsWith('fillStyle='))
    // Background + two tiles, and the two tiles must not agree.
    expect(fills).toHaveLength(3)
    expect(fills[1]).not.toBe(fills[2])
  })

  it('should scale exactly with the tile size, without distorting the grid', () => {
    // The bead's own acceptance criterion ("resizing does not distort the grid"): every
    // coordinate at 16 px per tile is exactly twice its 8 px counterpart, so the map is
    // uniformly scaled rather than stretched on one axis.
    const world = flat2x2()
    const small = trace(world, 8).filter((c) => c.startsWith('fillRect('))
    const large = trace(world, 16).filter((c) => c.startsWith('fillRect('))
    expect(large).toHaveLength(small.length)
    const doubled = small.map((call) =>
      call.replace(/-?\d+(\.\d+)?/g, (n) => String(Number(n) * 2)),
    )
    expect(large).toEqual(doubled)
  })
})

// ---------------------------------------------------------------------------
// The graticule
// ---------------------------------------------------------------------------

describe('renderWorld graticule', () => {
  it('should rule a line at every graticule interval, but not at the outer edges', () => {
    const size = GRATICULE_TILE_INTERVAL * 2
    const world = stubWorld({
      width: size,
      height: size,
      elevation: new Array<number>(size * size).fill(0.5),
      score: new Array<number>(size * size).fill(1),
    })
    const tileSize = GRATICULE_MIN_TILE_SIZE
    const step = GRATICULE_TILE_INTERVAL * tileSize
    const calls = trace(world, tileSize)
    // One interior line on each axis for a two-interval map. The border is the canvas
    // edge already; ruling it would be a half-pixel line clipped to half its width.
    expect(calls).toContain(`moveTo(${step + 0.5},0)`)
    expect(calls).toContain(`moveTo(0,${step + 0.5})`)
    expect(calls.filter((c) => c.startsWith('moveTo('))).toHaveLength(2)
  })

  it('should offset lines by half a pixel so a 1px rule lands on one pixel row', () => {
    const size = GRATICULE_TILE_INTERVAL * 2
    const world = stubWorld({
      width: size,
      height: size,
      elevation: new Array<number>(size * size).fill(0.5),
      score: new Array<number>(size * size).fill(1),
    })
    const step = GRATICULE_TILE_INTERVAL * GRATICULE_MIN_TILE_SIZE
    // Without the +0.5, a 1px stroke straddles two pixel rows at half intensity each —
    // which is both blurry and a needless source of resampling differences.
    expect(trace(world, GRATICULE_MIN_TILE_SIZE)).toContain(`lineTo(${step + 0.5},${size * GRATICULE_MIN_TILE_SIZE})`)
  })

  it('should omit the graticule when tiles are too small for it to read', () => {
    const size = GRATICULE_TILE_INTERVAL * 2
    const world = stubWorld({
      width: size,
      height: size,
      elevation: new Array<number>(size * size).fill(0.5),
      score: new Array<number>(size * size).fill(1),
    })
    const calls = trace(world, GRATICULE_MIN_TILE_SIZE - 1)
    expect(calls.filter((c) => c.startsWith('moveTo('))).toHaveLength(0)
  })

  it('should omit the graticule for a map smaller than one interval', () => {
    const calls = trace(flat2x2(), 8)
    expect(calls.filter((c) => c === 'stroke()')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

describe('renderWorld deposits', () => {
  const twoKinds = (): World =>
    stubWorld({
      width: 4,
      height: 1,
      elevation: [0.5, 0.5, 0.5, 0.5],
      score: [1, 1, 1, 1],
      deposits: [
        { x: 0, y: 0, kind: 'silica', richness: 0.1 },
        { x: 2, y: 0, kind: 'ice', richness: 0.9 },
      ],
    })

  it('should draw one marker per deposit', () => {
    expect(trace(twoKinds(), 8).filter((c) => c === 'beginPath()')).toHaveLength(2)
  })

  it('should draw silica and ice with visibly different geometry', () => {
    // The point of aic-m3t's typed deposits: a player choosing between a silica site and
    // an ice site must be able to see which is which. Different colours alone are not
    // enough, so this asserts the SHAPE calls differ too — `arc` for one, a polygon path
    // for the other.
    const calls = trace(twoKinds(), 8)
    const shapeOps = calls.filter((c) => c.startsWith('arc(') || c.startsWith('lineTo('))
    expect(shapeOps.some((c) => c.startsWith('arc('))).toBe(true)
    expect(shapeOps.some((c) => c.startsWith('lineTo('))).toBe(true)
  })

  it('should both fill and stroke each marker so it reads on pale dust and dark basalt alike', () => {
    const calls = trace(twoKinds(), 8)
    expect(calls.filter((c) => c === 'fill()')).toHaveLength(2)
    expect(calls.filter((c) => c === 'stroke()')).toHaveLength(2)
  })

  it('should centre each marker on its tile', () => {
    const calls = trace(twoKinds(), 8)
    // The ice deposit is at tile (2, 0), so its centre is (2*8 + 4, 0*8 + 4).
    expect(calls.some((c) => c.startsWith('arc(20,4,'))).toBe(true)
  })

  it('should draw deposits in array order', () => {
    // `generateDeposits` builds its array in row-major order, so array order IS a stable
    // property of the seed. Sorting or bucketing them here would be a second, redundant
    // ordering to keep deterministic for no gain.
    const calls = trace(twoKinds(), 8)
    const firstPolygon = calls.findIndex((c) => c.startsWith('lineTo('))
    const firstArc = calls.findIndex((c) => c.startsWith('arc('))
    expect(firstPolygon).toBeGreaterThanOrEqual(0)
    expect(firstArc).toBeGreaterThan(firstPolygon)
  })

  it('should draw a marker for an unregistered deposit kind rather than skipping it', () => {
    const world = stubWorld({
      width: 1,
      height: 1,
      elevation: [0.5],
      score: [1],
      deposits: [{ x: 0, y: 0, kind: 'perchlorate', richness: 0.5 }],
    })
    expect(trace(world, 8).filter((c) => c === 'beginPath()')).toHaveLength(1)
  })

  it('should skip a deposit whose coordinates fall outside the grid', () => {
    // Defence in depth against a malformed or hand-built world: a marker painted outside
    // the backing store is invisible, but one painted at a negative coordinate is not
    // something to discover from a screenshot diff.
    const world = stubWorld({
      width: 1,
      height: 1,
      elevation: [0.5],
      score: [1],
      deposits: [
        { x: -1, y: 0, kind: 'silica', richness: 0.5 },
        { x: 0, y: 9, kind: 'ice', richness: 0.5 },
      ],
    })
    expect(trace(world, 8).filter((c) => c === 'beginPath()')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Structures (aic-oby.8: "the colony is invisible")
// ---------------------------------------------------------------------------

describe('renderWorld structures', () => {
  it('should draw nothing extra when no structures are given — the survey screen’s path', () => {
    // Backward compatibility is the whole point of `structures` being optional: every
    // call site and test that predates this option must render byte-for-byte what it
    // always rendered.
    const world = flat2x2()
    expect(trace(world, 8)).toEqual(trace(world, 8, []))
  })

  it('should draw a filled rectangle at a complete structure’s tile', () => {
    const world = flat2x2()
    const structures: StructureRenderEntry[] = [
      { kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: true },
    ]
    const calls = trace(world, 8, structures)
    expect(calls).toContain(`fillStyle=${rgbCss(structureFill('habitat-module'))}`)
    expect(calls).toContain('fillRect(0,0,8,8)')
  })

  it('should draw every structure tile, not only the anchor', () => {
    const world = stubWorld({ width: 2, height: 2, elevation: [0, 0, 0, 0], score: [1, 1, 1, 1] })
    const structures: StructureRenderEntry[] = [
      {
        kind: 'habitat-module',
        tiles: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
        complete: true,
      },
    ]
    const calls = trace(world, 8, structures)
    for (const rect of [
      'fillRect(0,0,8,8)',
      'fillRect(8,0,8,8)',
      'fillRect(0,8,8,8)',
      'fillRect(8,8,8,8)',
    ]) {
      // Once for elevation, once for the structure.
      expect(calls.filter((c) => c === rect)).toHaveLength(2)
    }
  })

  it('should fill a COMPLETE structure fully opaque', () => {
    const world = flat2x2()
    const structures: StructureRenderEntry[] = [
      { kind: 'reactor-unit', tiles: [{ x: 0, y: 0 }], complete: true },
    ]
    const calls = trace(world, 8, structures)
    expect(calls).toContain(`fillStyle=${rgbCss(structureFill('reactor-unit'))}`)
    expect(calls).not.toContain(
      `fillStyle=${rgbaCss(structureFill('reactor-unit'), STRUCTURE_INCOMPLETE_FILL_ALPHA)}`,
    )
  })

  it('should fill an IN-PROGRESS structure at reduced alpha, distinctly from a complete one', () => {
    const world = flat2x2()
    const structures: StructureRenderEntry[] = [
      { kind: 'reactor-unit', tiles: [{ x: 0, y: 0 }], complete: false },
    ]
    const calls = trace(world, 8, structures)
    expect(calls).toContain(
      `fillStyle=${rgbaCss(structureFill('reactor-unit'), STRUCTURE_INCOMPLETE_FILL_ALPHA)}`,
    )
    expect(calls).not.toContain(`fillStyle=${rgbCss(structureFill('reactor-unit'))}`)
  })

  it('should draw a hatch stroke through an in-progress structure but not a complete one', () => {
    // "Outline/hatch" — the visual distinction the bead's own acceptance criterion asks
    // for. A complete structure is stroked for its outline only; an incomplete one is
    // stroked for the outline AND a diagonal hatch, so it strokes strictly more.
    const world = flat2x2()
    const completeStrokes = trace(world, 8, [
      { kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: true },
    ]).filter((c) => c === 'stroke()').length
    const incompleteStrokes = trace(world, 8, [
      { kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: false },
    ]).filter((c) => c === 'stroke()').length
    expect(incompleteStrokes).toBeGreaterThan(completeStrokes)
  })

  it('should stroke every structure tile’s outline in the same dark, neutral colour regardless of kind', () => {
    const world = flat2x2()
    const calls = trace(world, 8, [
      { kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: true },
      { kind: 'reactor-unit', tiles: [{ x: 1, y: 0 }], complete: false },
    ])
    const outlineStyles = new Set(calls.filter((c) => c.startsWith('strokeStyle=')))
    // Both structures share the one outline colour, so at most one distinct strokeStyle
    // is ever assigned for the structure layer (the graticule, on this small a map, sets
    // none — see "should omit the graticule for a map smaller than one interval").
    expect(outlineStyles.size).toBe(1)
  })

  it('should give two different structure kinds visibly different fills', () => {
    const world = stubWorld({ width: 2, height: 1, elevation: [0.5, 0.5], score: [1, 1] })
    const calls = trace(world, 8, [
      { kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: true },
      { kind: 'reactor-unit', tiles: [{ x: 1, y: 0 }], complete: true },
    ])
    expect(calls).toContain(`fillStyle=${rgbCss(structureFill('habitat-module'))}`)
    expect(calls).toContain(`fillStyle=${rgbCss(structureFill('reactor-unit'))}`)
    expect(structureFill('habitat-module')).not.toEqual(structureFill('reactor-unit'))
  })

  it('should draw structures in array order, over the terrain and deposits beneath them', () => {
    const world = stubWorld({
      width: 1,
      height: 1,
      elevation: [0.5],
      score: [1],
      deposits: [{ x: 0, y: 0, kind: 'silica', richness: 0.5 }],
    })
    const calls = trace(world, 8, [{ kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: true }])
    const lastDepositFill = calls.lastIndexOf('fill()')
    const structureFillCall = calls.lastIndexOf(`fillStyle=${rgbCss(structureFill('habitat-module'))}`)
    expect(structureFillCall).toBeGreaterThan(lastDepositFill)
  })

  it('should skip a structure tile whose coordinates fall outside the grid', () => {
    // Defence in depth, mirroring `drawDeposits`'s identical guard: a hand-built or
    // stale colony could name a tile outside the current grid.
    const world = stubWorld({ width: 1, height: 1, elevation: [0.5], score: [1] })
    const calls = trace(world, 8, [
      { kind: 'habitat-module', tiles: [{ x: -1, y: 0 }, { x: 0, y: 9 }], complete: true },
    ])
    expect(calls).not.toContain(`fillStyle=${rgbCss(structureFill('habitat-module'))}`)
  })

  it('should draw an unregistered structure kind rather than skipping it', () => {
    const world = flat2x2()
    const calls = trace(world, 8, [
      { kind: 'future-chain-structure', tiles: [{ x: 0, y: 0 }], complete: true },
    ])
    expect(calls).toContain(`fillStyle=${rgbCss(structureFill('future-chain-structure'))}`)
  })

  it('should draw nothing for a zero-size canvas even with structures given', () => {
    const calls = trace(flat2x2(), 0, [
      { kind: 'habitat-module', tiles: [{ x: 0, y: 0 }], complete: true },
    ])
    expect(calls).toEqual(['setTransform(1,0,0,1,0,0)'])
  })
})

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

describe('renderWorld edge cases', () => {
  it('should draw nothing but reset the transform for a zero-size canvas', () => {
    // Spec 005 edge case: "A canvas of zero size (hidden container) — must not throw."
    const calls = trace(flat2x2(), 0)
    expect(calls).toEqual(['setTransform(1,0,0,1,0,0)'])
  })

  it('should draw nothing for a world with no tiles', () => {
    const world = stubWorld({ width: 0, height: 0, elevation: [], score: [] })
    expect(trace(world, 8)).toEqual(['setTransform(1,0,0,1,0,0)'])
  })

  it('should not throw on a world whose elevation array is short', () => {
    // A truncated array yields `undefined` at the missing indices. Without a fallback
    // that becomes `rgb(NaN, NaN, NaN)`, which paints nothing at all — a blank canvas
    // that looks exactly like a renderer that never ran.
    const world = stubWorld({ width: 2, height: 1, elevation: [0.5], score: [1, 1] })
    const calls = trace(world, 8)
    expect(calls).toContain('fillRect(8,0,8,8)')
    expect(calls.some((c) => c.includes('NaN'))).toBe(false)
  })

  it('should not throw on a world whose buildability array is short', () => {
    const world = stubWorld({ width: 2, height: 1, elevation: [0.5, 0.5], score: [1] })
    const calls = trace(world, 8)
    expect(calls.some((c) => c.includes('NaN'))).toBe(false)
    // A tile with no buildability data fails DARK, matching `slopeShadeAlpha`: unknown
    // ground must not read as ready to build on.
    expect(calls.filter((c) => c === 'fillRect(8,0,8,8)')).toHaveLength(2)
  })

  it('should render a 1x1 world', () => {
    const world = stubWorld({ width: 1, height: 1, elevation: [0.5], score: [1] })
    expect(trace(world, 8)).toContain('fillRect(0,0,8,8)')
  })
})
