/**
 * Tests for the Mars surface palette (`src/app/canvas/mars-palette.ts`).
 *
 * This module is pure colour arithmetic, which makes it the half of the renderer that
 * unit tests can pin down exactly. The properties that matter are not "is this colour
 * pretty" but:
 *
 *   - TOTALITY. Every input, including the malformed ones a hand-built or truncated
 *     world can produce, yields a usable CSS colour rather than `rgb(NaN, NaN, NaN)`.
 *     A NaN colour silently paints nothing, which on a canvas looks exactly like a
 *     renderer that was never called.
 *   - DETERMINISM. Same input, same string, every call — including the fallback path
 *     for deposit kinds this palette has never heard of. AC-1.3 (byte-identical
 *     terrain across a reload) is only as strong as the weakest link in the render
 *     path, and a `Math.random()`-flavoured fallback colour would be that link.
 *   - DISTINGUISHABILITY. `silica` and `ice` must differ in BOTH shape and fill. The
 *     entire point of `MineralDeposit.kind` (aic-m3t) is that a player choosing a
 *     landing site can tell the two chains apart at a glance; two markers that differ
 *     only in hue would fail that for a colour-blind player.
 */
import { describe, expect, it } from 'vitest'

import { MIN_BUILDABLE_SCORE } from '../../src/sim/landing'
import {
  DEPOSIT_MARKERS,
  MARS_ELEVATION_STOPS,
  SLOPE_SHADE_GAIN,
  depositMarker,
  elevationColour,
  rgbCss,
  rgbaCss,
  slopeShadeAlpha,
} from '../../src/app/canvas/mars-palette'

const lowest = MARS_ELEVATION_STOPS[0]!
const highest = MARS_ELEVATION_STOPS[MARS_ELEVATION_STOPS.length - 1]!

describe('rgbCss', () => {
  it('should format a colour as an integer rgb() triple', () => {
    expect(rgbCss({ r: 12, g: 34, b: 56 })).toBe('rgb(12, 34, 56)')
  })

  it('should round fractional channels so the output never carries float noise', () => {
    // A fractional channel would stringify differently for values that are
    // arithmetically equal but reached by different routes (0.1+0.2 vs 0.3), which is
    // exactly the kind of drift a byte-comparison screenshot test catches late and
    // expensively.
    expect(rgbCss({ r: 12.4, g: 34.5, b: 56.6 })).toBe('rgb(12, 35, 57)')
  })

  it('should clamp channels outside [0, 255] rather than emitting an invalid colour', () => {
    expect(rgbCss({ r: -20, g: 300, b: 128 })).toBe('rgb(0, 255, 128)')
  })

  it('should substitute 0 for a non-finite channel instead of emitting NaN', () => {
    expect(rgbCss({ r: Number.NaN, g: 10, b: Number.POSITIVE_INFINITY })).toBe('rgb(0, 10, 255)')
  })
})

describe('rgbaCss', () => {
  it('should format a colour and alpha as an rgba() quadruple at fixed precision', () => {
    expect(rgbaCss({ r: 1, g: 2, b: 3 }, 0.5)).toBe('rgba(1, 2, 3, 0.500)')
  })

  it('should emit alpha at a fixed precision so equal alphas always stringify equally', () => {
    expect(rgbaCss({ r: 0, g: 0, b: 0 }, 1 / 3)).toBe('rgba(0, 0, 0, 0.333)')
  })

  it('should clamp alpha into [0, 1]', () => {
    expect(rgbaCss({ r: 0, g: 0, b: 0 }, -1)).toBe('rgba(0, 0, 0, 0.000)')
    expect(rgbaCss({ r: 0, g: 0, b: 0 }, 4)).toBe('rgba(0, 0, 0, 1.000)')
  })

  it('should treat a non-finite alpha as fully opaque rather than emitting NaN', () => {
    expect(rgbaCss({ r: 0, g: 0, b: 0 }, Number.NaN)).toBe('rgba(0, 0, 0, 1.000)')
  })
})

describe('elevationColour', () => {
  it('should return the lowest stop at elevation 0', () => {
    expect(elevationColour(0)).toEqual(lowest.colour)
  })

  it('should return the highest stop at elevation 1', () => {
    expect(elevationColour(1)).toEqual(highest.colour)
  })

  it('should interpolate between the two stops bracketing the elevation', () => {
    // Halfway between the first two stops must be the channel-wise midpoint: proof the
    // ramp is a genuine interpolation and not a step function that snaps to stops.
    const a = MARS_ELEVATION_STOPS[0]!
    const b = MARS_ELEVATION_STOPS[1]!
    expect(elevationColour((a.at + b.at) / 2)).toEqual({
      r: (a.colour.r + b.colour.r) / 2,
      g: (a.colour.g + b.colour.g) / 2,
      b: (a.colour.b + b.colour.b) / 2,
    })
  })

  it('should be monotonically lighter with elevation across the whole ramp', () => {
    // The palette's one legibility promise: high ground reads as dust-pale, low ground
    // as shadowed rust. A stop typo that inverted a pair would still produce a pretty
    // gradient and a completely misleading map.
    let previous = -1
    for (let i = 0; i <= 20; i++) {
      const { r, g, b } = elevationColour(i / 20)
      const luminance = r + g + b
      expect(luminance).toBeGreaterThan(previous)
      previous = luminance
    }
  })

  it('should clamp elevations outside [0, 1] to the end stops', () => {
    expect(elevationColour(-5)).toEqual(lowest.colour)
    expect(elevationColour(5)).toEqual(highest.colour)
  })

  it('should treat a non-finite elevation as the lowest stop rather than producing NaN', () => {
    expect(elevationColour(Number.NaN)).toEqual(lowest.colour)
  })

  it('should be a red-dominant palette at every elevation — Mars, not the Moon', () => {
    for (let i = 0; i <= 10; i++) {
      const { r, g, b } = elevationColour(i / 10)
      expect(r).toBeGreaterThan(g)
      expect(g).toBeGreaterThanOrEqual(b)
    }
  })
})

describe('slopeShadeAlpha', () => {
  it('should return 0 for perfectly flat, fully buildable ground', () => {
    // Alpha 0 means the shade layer paints nothing, so flat ground shows the bare
    // iron-oxide base: "clean red reads as buildable".
    expect(slopeShadeAlpha(1)).toBe(0)
  })

  it('should darken in proportion to slope for partially buildable ground', () => {
    expect(slopeShadeAlpha(0.9)).toBeCloseTo(0.1 * SLOPE_SHADE_GAIN, 10)
  })

  it('should saturate at fully opaque for ground at or below the sim’s unbuildable line', () => {
    // The load-bearing link between the picture and the rule: `validateLandingSite`
    // rejects a footprint scoring at or below MIN_BUILDABLE_SCORE as `unbuildable`, so
    // every such tile MUST render as solid basalt. If the gain were ever lowered so
    // that saturation happened BELOW the sim's threshold, a rejectable tile would look
    // merely steep and the map would invite the player into an illegal choice.
    expect(slopeShadeAlpha(MIN_BUILDABLE_SCORE)).toBe(1)
    const saturationScore = 1 - 1 / SLOPE_SHADE_GAIN
    expect(saturationScore).toBeGreaterThanOrEqual(MIN_BUILDABLE_SCORE)
    expect(slopeShadeAlpha(saturationScore)).toBeCloseTo(1, 10)
  })

  it('should clamp rather than exceed 1 for a below-range score', () => {
    expect(slopeShadeAlpha(-3)).toBe(1)
  })

  it('should clamp rather than go negative for an above-range score', () => {
    expect(slopeShadeAlpha(2)).toBe(0)
  })

  it('should treat a non-finite score as fully unbuildable', () => {
    // Fail dark, not fail light. An unknown tile that renders as clean buildable ground
    // invites the player to place a hull the sim will refuse; one that renders as
    // basalt merely under-sells a site.
    expect(slopeShadeAlpha(Number.NaN)).toBe(1)
  })
})

describe('depositMarker', () => {
  it('should give silica a registered marker of its own', () => {
    const marker = depositMarker('silica')
    expect(marker.kind).toBe('silica')
    expect(DEPOSIT_MARKERS).toContain(marker)
  })

  it('should give ice a registered marker of its own', () => {
    const marker = depositMarker('ice')
    expect(marker.kind).toBe('ice')
    expect(DEPOSIT_MARKERS).toContain(marker)
  })

  it('should distinguish silica from ice by SHAPE as well as colour', () => {
    const silica = depositMarker('silica')
    const ice = depositMarker('ice')
    expect(silica.shape).not.toBe(ice.shape)
    expect(silica.fill).not.toEqual(ice.fill)
  })

  it('should return a usable marker for a kind the palette has never heard of', () => {
    // Deposit kinds are DATA in the sim (`DepositKindSpec`), addable without touching
    // sim source. A renderer that threw — or drew nothing — on an unregistered kind
    // would turn that extensibility into a crash or an invisible resource.
    const marker = depositMarker('perchlorate')
    expect(marker.shape).toBe('square')
    expect(marker.kind).toBe('perchlorate')
  })

  it('should return the SAME fallback marker for the same unknown kind every call', () => {
    expect(depositMarker('perchlorate')).toEqual(depositMarker('perchlorate'))
  })

  it('should spread unknown kinds across more than one fallback fill', () => {
    // Not a promise of zero collisions — a hash over a small reserve palette cannot
    // make one — but a promise that the fallback is keyed off the kind at all, rather
    // than collapsing every future resource onto one indistinguishable marker.
    const fills = new Set(
      ['iron', 'perchlorate', 'basalt', 'clay', 'sulphate', 'nitrate'].map((k) =>
        rgbCss(depositMarker(k).fill),
      ),
    )
    expect(fills.size).toBeGreaterThan(1)
  })

  it('should not throw on an empty kind string', () => {
    expect(depositMarker('').shape).toBe('square')
  })
})
