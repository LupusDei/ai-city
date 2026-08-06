/**
 * Formatting for the survey screen's readouts — everything the screen DISPLAYS about a
 * landing decision, and nothing it DECIDES.
 *
 * Constitution §4 / spec 005 FR-002: no game logic in components. Every number below
 * arrives already computed by the sim (via the adapter's `LandingReadiness`) and is only
 * ever turned into a string here. Nothing in this module compares a score, ranks a site,
 * or forms an opinion about legality — if a test in this file ever needs to assert an
 * arithmetic RESULT rather than an arithmetic RENDERING, that is the signal that logic has
 * leaked out of `src/sim/` and into the app.
 *
 * The module is plain `.ts` rather than living inside the component for the same reason
 * `render-world.ts` is: `src/app/**\/*.tsx` is excluded from the coverage gate and pure
 * `.ts` under `src/app/` is not, so the formatting stays inside the 80/70/60 thresholds.
 */

import { describe, expect, it } from 'vitest'

import {
  PENDING_READOUT,
  candidateMarkerLabel,
  formatHullsPlaced,
  formatMissingHulls,
  formatTile,
  hullLabel,
  landingStatusLine,
  nextHull,
  rejectionReadout,
  scoreReadout,
} from '../../src/app/screens/survey-readouts'
import type { LandingReadiness, LandingRejection } from '../../src/sim/landing'

/** A `ready` readiness with hand-chosen components, so the assertions read as arithmetic. */
const READY: LandingReadiness = {
  status: 'ready',
  score: 55.1902,
  breakdown: {
    buildability: 0.804,
    depositProximity: 0.8278,
    hullSeparationPenalty: 0.3478,
    total: 55.1902,
  },
  droneHullTiles: [{ x: 3, y: 3 }],
  reactorHullTiles: [{ x: 11, y: 3 }],
}

const NOTHING_PLACED: LandingReadiness = {
  status: 'incomplete',
  missingHulls: ['drone-hull', 'reactor-hull'],
}

const ONE_PLACED: LandingReadiness = {
  status: 'incomplete',
  missingHulls: ['reactor-hull'],
}

describe('scoreReadout', () => {
  it('should render a ready landing’s total to one decimal place', () => {
    expect(scoreReadout(READY).total).toBe('55.2')
  })

  it('should render each of the three components as a whole percentage', () => {
    const readout = scoreReadout(READY)
    expect(readout.buildability).toBe('80%')
    expect(readout.depositProximity).toBe('83%')
    expect(readout.hullSeparation).toBe('35%')
  })

  it('should mark a ready landing as not pending', () => {
    expect(scoreReadout(READY).pending).toBe(false)
  })

  it('should render every field as the pending placeholder while the selection is incomplete', () => {
    // `evaluateLanding` cannot score a single anchor — a one-hull selection is `incomplete`
    // and carries no breakdown at all — so the screen shows a placeholder rather than
    // inventing a number the sim did not produce.
    const readout = scoreReadout(ONE_PLACED)
    expect(readout.pending).toBe(true)
    for (const field of [
      readout.total,
      readout.buildability,
      readout.depositProximity,
      readout.hullSeparation,
    ]) {
      expect(field).toBe(PENDING_READOUT)
    }
  })

  it('should render a non-empty placeholder, never an empty string', () => {
    // AC-2.1 asserts all four readouts are non-empty after the FIRST click, when only one
    // hull is down. An empty placeholder would fail it, and — worse — would read as a
    // missing element rather than an absent value.
    expect(PENDING_READOUT).not.toBe('')
    expect(scoreReadout(NOTHING_PLACED).total.length).toBeGreaterThan(0)
  })

  it('should treat a rejected landing as pending too — a refused site has no score', () => {
    const rejected: LandingReadiness = {
      status: 'rejected',
      rejection: { ok: false, reason: 'overlapping-hulls', tile: { x: 3, y: 3 } },
    }
    expect(scoreReadout(rejected).pending).toBe(true)
    expect(scoreReadout(rejected).total).toBe(PENDING_READOUT)
  })

  it('should render a zero total as a number rather than as pending', () => {
    const floored: LandingReadiness = {
      ...READY,
      score: 0,
      breakdown: { buildability: 0, depositProximity: 0, hullSeparationPenalty: 0, total: 0 },
    }
    const readout = scoreReadout(floored)
    expect(readout.pending).toBe(false)
    expect(readout.total).toBe('0.0')
    expect(readout.buildability).toBe('0%')
  })
})

describe('formatHullsPlaced', () => {
  it('should report zero placed hulls in a way that contains a literal 0', () => {
    expect(formatHullsPlaced(0)).toContain('0')
  })

  it('should report one placed hull in a way that contains a literal 1', () => {
    expect(formatHullsPlaced(1)).toContain('1')
  })

  it('should name the total number of hulls the mission has', () => {
    expect(formatHullsPlaced(2)).toBe('2 / 2')
  })
})

describe('hullLabel', () => {
  it('should give the drone hull a human-readable name', () => {
    expect(hullLabel('drone-hull')).toBe('drone hull')
  })

  it('should give the reactor hull a human-readable name', () => {
    expect(hullLabel('reactor-hull')).toBe('reactor hull')
  })

  it('should never return the raw dashed identifier', () => {
    expect(hullLabel('drone-hull')).not.toContain('-')
  })
})

describe('formatMissingHulls', () => {
  it('should join two missing hulls with “and”', () => {
    expect(formatMissingHulls(['drone-hull', 'reactor-hull'])).toBe('drone hull and reactor hull')
  })

  it('should name a single missing hull on its own', () => {
    expect(formatMissingHulls(['reactor-hull'])).toBe('reactor hull')
  })

  it('should render nothing missing as an empty string', () => {
    expect(formatMissingHulls([])).toBe('')
  })
})

describe('landingStatusLine', () => {
  it('should say which hulls are still awaited while the selection is incomplete', () => {
    expect(landingStatusLine(NOTHING_PLACED)).toContain('drone hull and reactor hull')
  })

  it('should name only the hull that is actually missing', () => {
    const line = landingStatusLine(ONE_PLACED)
    expect(line).toContain('reactor hull')
    expect(line).not.toContain('drone hull')
  })

  it('should confirm a scored site once both hulls are committed', () => {
    expect(landingStatusLine(READY)).toMatch(/scored/i)
  })

  it('should tell the player to choose again when the committed site was refused', () => {
    const rejected: LandingReadiness = {
      status: 'rejected',
      rejection: { ok: false, reason: 'overlapping-hulls', tile: { x: 3, y: 3 } },
    }
    expect(landingStatusLine(rejected)).toMatch(/refus/i)
  })
})

describe('nextHull', () => {
  it('should name the drone hull first, matching the order the adapter fills slots', () => {
    expect(nextHull(NOTHING_PLACED)).toBe('drone-hull')
  })

  it('should name the reactor hull once the drone hull is down', () => {
    expect(nextHull(ONE_PLACED)).toBe('reactor-hull')
  })

  it('should name no hull once the landing is complete', () => {
    // Both slots are full, so a further click commits nothing — which is precisely why
    // the screen disables the markers rather than leaving them live.
    expect(nextHull(READY)).toBeNull()
  })

  it('should name no hull while a committed site stands refused', () => {
    // A `rejected` readiness carries no `missingHulls`, so there is no honest answer to
    // "what would the next click place". Null rather than a guess.
    const rejected: LandingReadiness = {
      status: 'rejected',
      rejection: { ok: false, reason: 'overlapping-hulls', tile: { x: 3, y: 3 } },
    }
    expect(nextHull(rejected)).toBeNull()
  })

  it('should read the SIM’s own missingHulls rather than assuming an order', () => {
    // If the sim ever reported the reactor hull as the only one missing, this must follow
    // it — the screen must never hold a second opinion about what the landing still owes.
    const reactorFirst: LandingReadiness = {
      status: 'incomplete',
      missingHulls: ['reactor-hull', 'drone-hull'],
    }
    expect(nextHull(reactorFirst)).toBe('reactor-hull')
  })

  it('should survive an incomplete readiness that names no missing hull at all', () => {
    // Unreachable through `evaluateLanding`, reachable from a hand-built state. An empty
    // list must read as "nothing to place", never as `undefined` leaking into the DOM.
    const empty: LandingReadiness = { status: 'incomplete', missingHulls: [] }
    expect(nextHull(empty)).toBeNull()
  })
})

describe('candidateMarkerLabel', () => {
  const ANCHOR = { x: 11, y: 27 }

  it('should name the tile a marker stands on', () => {
    const label = candidateMarkerLabel({ anchor: ANCHOR, occupant: null, legal: true, next: null })
    expect(label).toContain('(11, 27)')
  })

  it('should say WHICH hull a click would commit, so the gesture is not a mystery', () => {
    // The screen places the drone hull first and then the reactor hull, and before this
    // the player had no way to know which one their next click was spending.
    const label = candidateMarkerLabel({
      anchor: ANCHOR,
      occupant: null,
      legal: true,
      next: 'drone-hull',
    })
    expect(label).toContain('drone hull')
  })

  it('should name the reactor hull when that is the one the next click fills', () => {
    const label = candidateMarkerLabel({
      anchor: ANCHOR,
      occupant: null,
      legal: true,
      next: 'reactor-hull',
    })
    expect(label).toContain('reactor hull')
    expect(label).not.toContain('drone hull')
  })

  it('should report an already-committed hull rather than what a click would do', () => {
    const label = candidateMarkerLabel({
      anchor: ANCHOR,
      occupant: 'reactor-hull',
      legal: true,
      next: null,
    })
    expect(label).toMatch(/reactor hull/)
    expect(label).toMatch(/committed/i)
  })

  it('should prefer the occupant over the next-hull hint when both apply', () => {
    // A marker can be occupied while another hull is still awaited. What it IS beats what
    // clicking it would do — and clicking it would be refused as an overlap anyway.
    const label = candidateMarkerLabel({
      anchor: ANCHOR,
      occupant: 'drone-hull',
      legal: true,
      next: 'reactor-hull',
    })
    expect(label).toMatch(/committed/i)
  })

  it('should explain an illegal anchor rather than merely being disabled', () => {
    const label = candidateMarkerLabel({
      anchor: ANCHOR,
      occupant: null,
      legal: false,
      next: 'drone-hull',
    })
    expect(label).toMatch(/outside the survey grid/i)
  })

  it('should say why a marker is inert once the landing is complete', () => {
    // AC-2.4's sibling in spirit: a disabled control that does not explain itself is how a
    // first-time player gets stuck. The visual lock is stated on screen; this is the same
    // fact for a screen reader, which cannot see the fade.
    const label = candidateMarkerLabel({ anchor: ANCHOR, occupant: null, legal: true, next: null })
    expect(label).toMatch(/re-plot/i)
  })

  it('should give two different tiles two different labels', () => {
    const a = candidateMarkerLabel({ anchor: { x: 3, y: 3 }, occupant: null, legal: true, next: null })
    const b = candidateMarkerLabel({ anchor: { x: 3, y: 11 }, occupant: null, legal: true, next: null })
    expect(a).not.toBe(b)
  })
})

describe('formatTile', () => {
  it('should render a tile as an ordered pair', () => {
    expect(formatTile({ x: 3, y: 11 })).toBe('(3, 11)')
  })

  it('should keep x first, so two transposed tiles read differently', () => {
    expect(formatTile({ x: 3, y: 11 })).not.toBe(formatTile({ x: 11, y: 3 }))
  })

  it('should render the origin tile without dropping either coordinate', () => {
    expect(formatTile({ x: 0, y: 0 })).toBe('(0, 0)')
  })
})

describe('rejectionReadout', () => {
  it('should carry an out-of-bounds reason verbatim, with its hull and offending tile', () => {
    const rejection: LandingRejection = {
      ok: false,
      reason: 'out-of-bounds',
      hull: 'reactor-hull',
      tile: { x: 64, y: 3 },
    }
    expect(rejectionReadout(rejection)).toEqual({
      reason: 'out-of-bounds',
      hull: 'reactor-hull',
      tile: { x: 64, y: 3 },
    })
  })

  it('should read an unbuildable rejection’s anchor as the tile to point at', () => {
    const rejection: LandingRejection = {
      ok: false,
      reason: 'unbuildable',
      hull: 'drone-hull',
      anchor: { x: 12, y: 40 },
    }
    expect(rejectionReadout(rejection)).toEqual({
      reason: 'unbuildable',
      hull: 'drone-hull',
      tile: { x: 12, y: 40 },
    })
  })

  it('should report no hull for an overlap, which is a property of the pair', () => {
    const rejection: LandingRejection = {
      ok: false,
      reason: 'overlapping-hulls',
      tile: { x: 3, y: 3 },
    }
    expect(rejectionReadout(rejection)).toEqual({
      reason: 'overlapping-hulls',
      hull: null,
      tile: { x: 3, y: 3 },
    })
  })

  it('should never reword the sim’s reason literal (FR-006)', () => {
    // The whole point of FR-006: the screen renders `out-of-bounds` /`unbuildable` /
    // `overlapping-hulls` as the sim named them, not a generic "invalid site" message.
    for (const reason of ['out-of-bounds', 'unbuildable', 'overlapping-hulls'] as const) {
      const rejection = (
        reason === 'overlapping-hulls'
          ? { ok: false, reason, tile: { x: 1, y: 1 } }
          : reason === 'unbuildable'
            ? { ok: false, reason, hull: 'drone-hull', anchor: { x: 1, y: 1 } }
            : { ok: false, reason, hull: 'drone-hull', tile: { x: 1, y: 1 } }
      ) as LandingRejection
      expect(rejectionReadout(rejection).reason).toBe(reason)
    }
  })
})
