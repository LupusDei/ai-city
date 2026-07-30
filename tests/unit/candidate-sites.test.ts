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
  candidateMarkerBox,
  candidateSites,
  candidateTestId,
  occupantOf,
} from '../../src/app/screens/candidate-sites'
import { createGrid } from '../../src/sim/grid'
import { MAP_DIMENSION } from '../../src/app/state/game-state'

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
