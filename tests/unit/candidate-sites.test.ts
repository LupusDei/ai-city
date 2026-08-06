/**
 * The survey screen's candidate lattice — the pure half of "where may the player click".
 *
 * WHY THIS IS TESTED AT ALL, given it is UI affordance rather than game rule. Because it
 * is the one place where an out-of-bounds hull anchor can be OFFERED to the player, and
 * `evaluateLanding` cannot help: it only validates once BOTH anchors are down, so an
 * illegal first anchor is silently accepted and only surfaces on the second click,
 * reported against the wrong hull. Pre-filtering here is what makes every offered site a
 * site the sim will accept, and this file is what pins that.
 */

import { describe, expect, it } from 'vitest'

import {
  CANDIDATE_LATTICE_OFFSET,
  CANDIDATE_LATTICE_SPACING,
  GROUND_INK_CEILING,
  GROUND_INK_FLOOR,
  candidateGrounds,
  candidateMarkerBox,
  candidateSites,
  candidateTestId,
  groundInk,
  groundTickLength,
  occupantOf,
} from '../../src/app/screens/candidate-sites'
import { SURVEY_TILE_SIZE } from '../../src/app/screens/survey-styles'
import { createGrid } from '../../src/sim/grid'
import { buildabilityScorerFor } from '../../src/sim/world'
import { MAP_DIMENSION, beginSurvey } from '../../src/app/state/game-state'

describe('candidateSites', () => {
  it('should offer one site per lattice cell on the ratified 64x64 map', () => {
    const sites = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))
    // 64 / 8 = 8 cells per axis.
    expect(sites).toHaveLength(64)
  })

  it('should place the first anchor at the lattice offset', () => {
    const sites = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))
    expect(sites[0]?.anchor).toEqual({
      x: CANDIDATE_LATTICE_OFFSET,
      y: CANDIDATE_LATTICE_OFFSET,
    })
  })

  it('should order sites row-major, matching the sim’s own tile ordering', () => {
    const sites = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))
    expect(sites.slice(0, 3).map((s) => s.anchor)).toEqual([
      { x: 3, y: 3 },
      { x: 3 + CANDIDATE_LATTICE_SPACING, y: 3 },
      { x: 3 + 2 * CANDIDATE_LATTICE_SPACING, y: 3 },
    ])
  })

  it('should mark every site on the ratified map legal, so none is offered disabled', () => {
    const sites = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))
    expect(sites.every((s) => s.legal)).toBe(true)
  })

  it('should mark a site whose 2x2 footprint hangs off the edge as illegal', () => {
    // A 12-wide grid puts the second lattice anchor at x=11, whose footprint needs x=12.
    const sites = candidateSites(createGrid(12, 12))
    const hanging = sites.filter((s) => !s.legal)
    expect(hanging.length).toBeGreaterThan(0)
    expect(hanging.every((s) => s.anchor.x === 11 || s.anchor.y === 11)).toBe(true)
  })

  it('should carry the resolved footprint tiles so a caller never re-derives them', () => {
    const sites = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))
    expect(sites[0]?.tiles).toEqual([
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ])
  })

  it('should return an empty lattice for a grid smaller than the offset', () => {
    expect(candidateSites(createGrid(2, 2))).toEqual([])
  })

  it('should be a pure function of the grid — two calls agree by value', () => {
    const grid = createGrid(MAP_DIMENSION, MAP_DIMENSION)
    expect(candidateSites(grid)).toEqual(candidateSites(grid))
  })

  it('should honour an explicit spacing and offset', () => {
    const sites = candidateSites(createGrid(20, 20), { spacing: 10, offset: 0 })
    expect(sites.map((s) => s.anchor)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ])
  })

  it('should refuse a non-positive spacing rather than looping forever', () => {
    expect(() => candidateSites(createGrid(8, 8), { spacing: 0 })).toThrow(RangeError)
    expect(() => candidateSites(createGrid(8, 8), { spacing: -4 })).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// Ground quality — the reason one candidate is worth preferring to another
// ---------------------------------------------------------------------------

/**
 * WHY A LATTICE MARKER CARRIES A GROUND READING AT ALL.
 *
 * Sixty-four identically-drawn markers are not a decision, they are a shrug: the player has
 * no basis on which to prefer any of them. The basis EXISTS — the map already shades
 * buildability as a darkening toward basalt, and the legend says so — but a marker that
 * looks the same everywhere throws it away.
 *
 * AND THIS IS NOT GAME LOGIC (constitution §4). `render-world.ts` already reads
 * `buildabilityAt` to shade each tile, and rendering a sim value as ink is presentation, not
 * a rule. These functions read the SIM'S OWN aggregator — `buildabilityScorerFor`, the exact
 * function `colony-start.ts` hands to `scoreLandingSite` — over the sim's own resolved
 * footprint. Nothing here invents a weighting, compares two candidates, ranks them, sorts
 * them or decides which is best. It reads one number per footprint and turns it into ink,
 * and if the sim ever changes how a footprint is aggregated, this changes with it.
 */
describe('candidateGrounds', () => {
  const world = beginSurvey({ seed: 20260730 }).world

  it('should return one reading per candidate, in the lattice’s own order', () => {
    const sites = candidateSites(world.grid)
    expect(candidateGrounds(sites, world.buildability)).toHaveLength(sites.length)
  })

  it('should return the SIM’s own footprint aggregate, not an average of its own', () => {
    // Read against `buildabilityScorerFor` itself rather than against a literal: a function
    // that averaged the four tiles would pass a hand-written expectation derived from the
    // same mistake, and averaging is exactly the bug the sim's minimum-aggregation exists
    // to prevent (five flat tiles must not carry a cliff tile).
    const sites = candidateSites(world.grid)
    const score = buildabilityScorerFor(world.buildability)
    const grounds = candidateGrounds(sites, world.buildability)
    for (const [index, site] of sites.entries()) {
      expect(grounds[index]).toBe(score(site.tiles))
    }
  })

  it('should give genuinely different readings across the lattice', () => {
    // The property that makes the markers non-interchangeable. A constant reading would
    // satisfy every other assertion here and leave the screen exactly as it was.
    const grounds = candidateGrounds(candidateSites(world.grid), world.buildability)
    expect(new Set(grounds).size).toBeGreaterThan(1)
  })

  it('should keep every reading inside the sim’s [0, 1] buildability range', () => {
    const grounds = candidateGrounds(candidateSites(world.grid), world.buildability)
    for (const ground of grounds) {
      expect(ground).toBeGreaterThanOrEqual(0)
      expect(ground).toBeLessThanOrEqual(1)
    }
  })

  it('should be a pure function of its arguments — two calls agree', () => {
    const sites = candidateSites(world.grid)
    expect(candidateGrounds(sites, world.buildability)).toEqual(
      candidateGrounds(sites, world.buildability),
    )
  })

  it('should return an empty list for an empty lattice', () => {
    expect(candidateGrounds([], world.buildability)).toEqual([])
  })
})

describe('groundInk', () => {
  it('should draw ground at or below the floor at the faintest ink', () => {
    expect(groundInk(GROUND_INK_FLOOR)).toBe(groundInk(0))
  })

  it('should draw ground at or above the ceiling at the strongest ink', () => {
    expect(groundInk(GROUND_INK_CEILING)).toBe(groundInk(1))
  })

  it('should rise monotonically with buildability, so better ground is never fainter', () => {
    // The one property the encoding must have. Anything non-monotonic would actively
    // mislead — a player would read a worse site as the better one.
    const steps = [0.7, 0.75, 0.8, 0.85, 0.9]
    const inks = steps.map((g) => Number(groundInk(g)))
    for (let i = 1; i < inks.length; i++) {
      expect(inks[i] ?? 0).toBeGreaterThan(inks[i - 1] ?? 0)
    }
  })

  it('should separate the tightly-clustered middle of the real range visibly', () => {
    // Measured: footprint buildability across the lattice spans about [0.70, 0.92] with the
    // interquartile band inside [0.81, 0.85]. A naive [0, 1] mapping would compress every
    // marker on the map into a tenth of the ink range and read as a flat wash — the same
    // compression `SLOPE_SHADE_GAIN` exists to fix for the terrain underneath.
    const low = Number(groundInk(0.75))
    const high = Number(groundInk(0.88))
    expect(high - low).toBeGreaterThan(0.35)
  })

  it('should emit a fixed-precision string, so the ink cannot drift between two loads', () => {
    // AC-1.3 compares the marker layer byte for byte across a reload. Float formatting is
    // the same hazard `mars-palette.ts` fixes its colour strings for.
    expect(groundInk(0.8123456789)).toMatch(/^\d\.\d{3}$/)
  })

  it('should never emit an ink outside [0, 1], whatever it is handed', () => {
    for (const ground of [-5, 0, 0.5, 1, 12]) {
      const ink = Number(groundInk(ground))
      expect(ink).toBeGreaterThanOrEqual(0)
      expect(ink).toBeLessThanOrEqual(1)
    }
  })

  it('should treat an unknown reading as the faintest ink, never the strongest', () => {
    // Same false-negative-over-false-positive direction as `slopeShadeAlpha`: unknown
    // ground must not advertise itself as the best site on the map.
    expect(groundInk(Number.NaN)).toBe(groundInk(0))
  })
})

describe('groundTickLength', () => {
  it('should draw the shortest arms on ground at or below the floor', () => {
    expect(groundTickLength(GROUND_INK_FLOOR)).toBe(groundTickLength(0))
  })

  it('should draw the longest arms on ground at or above the ceiling', () => {
    expect(groundTickLength(GROUND_INK_CEILING)).toBe(groundTickLength(1))
  })

  it('should never shorten as buildability rises', () => {
    const lengths = [0.7, 0.75, 0.8, 0.85, 0.9].map(groundTickLength)
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i] ?? 0).toBeGreaterThanOrEqual(lengths[i - 1] ?? 0)
    }
  })

  it('should actually vary across the real range, not collapse to one length', () => {
    const lengths = [0.7, 0.78, 0.86, 0.92].map(groundTickLength)
    expect(new Set(lengths).size).toBeGreaterThan(2)
  })

  it('should emit only whole pixels, because a half pixel is a resampled edge', () => {
    // AC-1.3 compares the marker layer byte for byte. Whole-pixel geometry is the rule the
    // marker box already obeys, and a fractional tick would put the reticle's arms on a
    // different subpixel grid than the canvas beneath them.
    for (const ground of [0, 0.71, 0.777, 0.8391, 0.9, 1]) {
      expect(Number.isInteger(groundTickLength(ground))).toBe(true)
    }
  })

  it('should stay inside the footprint it annotates, at every reading', () => {
    // Two arms plus a gap must fit across a 2x2 footprint at the survey's tile size, or the
    // corner brackets meet in the middle and the reticle becomes the filled box it replaced.
    for (const ground of [0, 0.5, 0.8, 1]) {
      expect(groundTickLength(ground) * 2).toBeLessThan(SURVEY_TILE_SIZE * 2)
    }
  })

  it('should treat an unknown reading as the shortest arms, never the longest', () => {
    expect(groundTickLength(Number.NaN)).toBe(groundTickLength(0))
  })
})

describe('candidateTestId', () => {
  it('should build the acceptance contract’s suffixed testid', () => {
    expect(candidateTestId({ x: 3, y: 11 })).toBe('candidate-site-3-11')
  })

  it('should distinguish two anchors that differ only by axis', () => {
    expect(candidateTestId({ x: 3, y: 11 })).not.toBe(candidateTestId({ x: 11, y: 3 }))
  })

  it('should still prefix-match the suite’s selector for the origin anchor', () => {
    expect(candidateTestId({ x: 0, y: 0 }).startsWith('candidate-site')).toBe(true)
  })
})

describe('occupantOf', () => {
  it('should report no occupant for an empty selection', () => {
    expect(
      occupantOf({ droneHullAnchor: null, reactorHullAnchor: null }, { x: 3, y: 3 }),
    ).toBeNull()
  })

  it('should name the drone hull at its own anchor', () => {
    expect(
      occupantOf({ droneHullAnchor: { x: 3, y: 3 }, reactorHullAnchor: null }, { x: 3, y: 3 }),
    ).toBe('drone-hull')
  })

  it('should name the reactor hull at its own anchor', () => {
    expect(
      occupantOf(
        { droneHullAnchor: { x: 3, y: 3 }, reactorHullAnchor: { x: 11, y: 3 } },
        { x: 11, y: 3 },
      ),
    ).toBe('reactor-hull')
  })

  it('should report no occupant for an anchor neither hull sits on', () => {
    expect(
      occupantOf(
        { droneHullAnchor: { x: 3, y: 3 }, reactorHullAnchor: { x: 11, y: 3 } },
        { x: 19, y: 3 },
      ),
    ).toBeNull()
  })
})

describe('candidateMarkerBox', () => {
  it('should cover exactly the hull footprint plus the touch margin', () => {
    const box = candidateMarkerBox({ x: 3, y: 3 }, 8)
    // Footprint is 2 tiles = 16px, inset by the margin on every side.
    expect(box.footprintSize).toBe(16)
    expect(box.size).toBeGreaterThan(box.footprintSize)
    expect(box.left).toBe(3 * 8 - (box.size - box.footprintSize) / 2)
    expect(box.top).toBe(3 * 8 - (box.size - box.footprintSize) / 2)
  })

  it('should scale with the tile size', () => {
    const small = candidateMarkerBox({ x: 2, y: 2 }, 4)
    const large = candidateMarkerBox({ x: 2, y: 2 }, 16)
    expect(large.footprintSize).toBe(small.footprintSize * 4)
    expect(large.left).toBeGreaterThan(small.left)
  })

  it('should keep the last lattice marker inside the rendered map', () => {
    const box = candidateMarkerBox({ x: 59, y: 59 }, 8)
    expect(box.left + box.size).toBeLessThanOrEqual(MAP_DIMENSION * 8)
    expect(box.top + box.size).toBeLessThanOrEqual(MAP_DIMENSION * 8)
  })

  it('should never produce a negative offset for the first lattice marker', () => {
    const box = candidateMarkerBox({ x: CANDIDATE_LATTICE_OFFSET, y: CANDIDATE_LATTICE_OFFSET }, 8)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
  })
})
