/**
 * Tests for the app shell's seed resolution.
 *
 * The seed is the one input that makes a mission reproducible (spec 005 FR-005), and the
 * spec calls out its failure mode explicitly: "Page loaded with no seed in the URL — must
 * generate one and display it, never crash." So the interesting cases here are all the
 * ways a query string can be wrong, and the guarantee that every one of them still yields
 * a usable seed rather than an exception or a `NaN` on screen.
 */
import { describe, expect, it } from 'vitest'

import { parseSeed, resolveSeed, SEED_SPACE } from '../../src/app/seed'

describe('parseSeed', () => {
  it('should return the seed when the query string carries a valid integer', () => {
    expect(parseSeed('?seed=20260730')).toBe(20260730)
  })

  it('should accept a query string without the leading question mark', () => {
    // `location.search` includes the `?`, but callers that build one by hand often omit
    // it; URLSearchParams tolerates both and this pins that it stays true.
    expect(parseSeed('seed=42')).toBe(42)
  })

  it('should return the seed when it is one of several query parameters', () => {
    expect(parseSeed('?debug=1&seed=7&lang=en')).toBe(7)
  })

  it('should accept zero as a legitimate seed', () => {
    // A falsy-but-valid value: an `if (!seed)` implementation would silently reroll here.
    expect(parseSeed('?seed=0')).toBe(0)
  })

  it('should accept the largest in-range seed', () => {
    expect(parseSeed(`?seed=${SEED_SPACE}`)).toBe(SEED_SPACE)
  })

  it('should return null when there is no query string at all', () => {
    expect(parseSeed('')).toBeNull()
  })

  it('should return null when the seed parameter is absent', () => {
    expect(parseSeed('?debug=1')).toBeNull()
  })

  it.each([
    ['empty', '?seed='],
    ['whitespace only', '?seed=%20%20'],
    ['not a number', '?seed=abc'],
    ['partially numeric', '?seed=12abc'],
    ['fractional', '?seed=1.5'],
    ['negative', '?seed=-1'],
    ['beyond the seed space', `?seed=${SEED_SPACE + 1}`],
  ])('should return null for a %s seed rather than coercing it', (_label, search) => {
    // Number('') is 0 and Number('12abc') is NaN. Coercing either would display a seed
    // the player never asked for and could not reproduce, so both are rejected.
    expect(parseSeed(search)).toBeNull()
  })
})

describe('resolveSeed', () => {
  /** A random source that must not be consulted; calling it fails the test loudly. */
  const forbiddenRandom = (): number => {
    throw new Error('random source consulted despite a valid seed in the URL')
  }

  it('should prefer a valid seed from the URL over generating one', () => {
    expect(resolveSeed('?seed=20260730', forbiddenRandom)).toBe(20260730)
  })

  it('should generate a seed when the URL has none', () => {
    expect(resolveSeed('', () => 0.5)).toBe(Math.floor(0.5 * SEED_SPACE))
  })

  it('should generate a seed when the URL seed is malformed', () => {
    expect(resolveSeed('?seed=not-a-number', () => 0.25)).toBe(Math.floor(0.25 * SEED_SPACE))
  })

  it('should return a non-negative integer for the extremes of the random source', () => {
    // `Math.random()` is [0, 1): 0 is reachable, 1 is not, and both ends must land on a
    // valid integer seed rather than a float or an out-of-range value.
    for (const r of [0, 0.9999999]) {
      const seed = resolveSeed('', () => r)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(SEED_SPACE)
    }
  })
})
