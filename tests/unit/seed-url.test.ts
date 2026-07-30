/**
 * Pinning a generated seed into the URL, so reload is a RETRY and not a REROLL.
 *
 * THE DEFECT THIS CLOSES. `resolveSeed` only writes a seed into the URL when the player
 * supplied one. A player who arrives at `/`, is given a generated world, surveys it and then
 * reloads — for any reason at all, not just to reconsider a landing — gets a DIFFERENT world.
 * The seed is displayed, so FR-005's "visible and reproducible" is technically met, but
 * reproducing it means retyping a nine-digit number into the address bar. In practice the
 * page's own reload button destroys the thing the player was looking at.
 *
 * It also makes spec 005's AC-1.3 honest. That test asserts identical terrain across a
 * reload, and today it only passes because the TEST supplies `?seed=` — the property would
 * not hold for a player who did not. Pinning the seed makes the guarantee real rather than an
 * artefact of how the test navigates.
 */

import { describe, expect, it } from 'vitest'

import { pinnedSeedUrl } from '../../src/app/seed-url'
import { parseSeed } from '../../src/app/seed'

describe('pinnedSeedUrl', () => {
  it('should return a seeded query for a URL that carries no seed', () => {
    expect(pinnedSeedUrl('', 20260730)).toBe('?seed=20260730')
  })

  it('should return null when the URL already carries that exact seed', () => {
    // Nothing to pin, so nothing to write: a caller must be able to skip the history call
    // entirely rather than replacing the URL with itself on every load.
    expect(pinnedSeedUrl('?seed=20260730', 20260730)).toBeNull()
  })

  it('should return null when the URL carries any valid seed, whatever the session uses', () => {
    // `resolveSeed` prefers the URL's seed, so these cannot actually disagree in production.
    // Returning null on the strength of the URL being already-valid — rather than of the two
    // matching — keeps this function from ever fighting the address bar.
    expect(pinnedSeedUrl('?seed=1234', 1234)).toBeNull()
  })

  it('should pin a seed over a malformed one, which resolveSeed ignored anyway', () => {
    // `parseSeed` rejects this, so the session is running on a GENERATED seed while the URL
    // claims something else. Leaving it would make the address bar an outright lie.
    expect(parseSeed('?seed=12abc')).toBeNull()
    expect(pinnedSeedUrl('?seed=12abc', 55)).toBe('?seed=55')
  })

  it('should pin a seed over an out-of-range one', () => {
    expect(pinnedSeedUrl('?seed=-1', 55)).toBe('?seed=55')
  })

  it('should preserve every other query parameter, in order', () => {
    expect(pinnedSeedUrl('?debug=1&tile=12', 7)).toBe('?debug=1&tile=12&seed=7')
  })

  it('should replace a malformed seed in place rather than appending a second one', () => {
    const pinned = pinnedSeedUrl('?seed=nope&debug=1', 7)
    expect(pinned).toBe('?seed=7&debug=1')
    // A second `seed` parameter would make `parseSeed` read whichever came first, which is
    // how a URL ends up reproducing a different world than the one on screen.
    expect([...new URLSearchParams(pinned ?? '').getAll('seed')]).toEqual(['7'])
  })

  it('should produce a query that parseSeed round-trips back to the same seed', () => {
    // The whole point: the pinned URL must actually reproduce this session.
    const pinned = pinnedSeedUrl('', 20260730)
    expect(pinned).not.toBeNull()
    expect(parseSeed(pinned ?? '')).toBe(20260730)
  })

  it('should handle a query string given without its leading question mark', () => {
    expect(pinnedSeedUrl('debug=1', 7)).toBe('?debug=1&seed=7')
  })

  it('should be idempotent — pinning an already-pinned URL is a no-op', () => {
    const first = pinnedSeedUrl('', 42)
    expect(first).toBe('?seed=42')
    expect(pinnedSeedUrl(first ?? '', 42)).toBeNull()
  })
})
