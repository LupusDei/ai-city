/**
 * Making the address bar tell the truth about which world is on screen.
 *
 * ============================================================================
 * WHY THIS EXISTS: RELOAD WAS A REROLL, NOT A RETRY
 * ----------------------------------------------------------------------------
 * `resolveSeed` writes nothing. It reads `?seed=` when the player supplied one and generates
 * a seed when they did not — so a player who arrives at `/` gets a world whose only record is
 * a number rendered into the page. Reload that page and the seed is generated again, from a
 * different `Math.random()`, and the world is gone. Not corrupted, not reset: replaced by a
 * different one that looks equally plausible.
 *
 * That turns the browser's own reload button into a destructive action, on the first screen a
 * player ever sees, at the moment they are most likely to press it. FR-005 asks for the seed
 * to be "visible and reproducible from the UI", and displaying it technically satisfies that
 * — reproducing it means reading nine digits off the screen and typing them into the address
 * bar. Pinning it into the URL is what makes the guarantee usable rather than nominal.
 *
 * It also makes spec 005's AC-1.3 honest. That test asserts byte-identical terrain across a
 * reload, and today it passes only because the TEST navigates to `/?seed=20260730`. A player
 * who did not supply a seed had no such guarantee, so the acceptance criterion was true of the
 * test's URL rather than of the application. After this, it is true of both.
 * ============================================================================
 *
 * PURE. This module decides WHAT the URL should be; it does not touch `window.history`. That
 * one call belongs at the composition root (`App.tsx`), which is where the app's other DOM
 * edges live — and keeping the decision separate from the side effect is what lets every case
 * below be a unit test instead of a browser test.
 *
 * `replaceState`, NOT `pushState`, at the call site: pinning a seed is a correction to the
 * current URL, not navigation. `pushState` would put an entry in the history stack, and the
 * player's Back button would then return to the same page with no seed — which regenerates the
 * world, which is the exact defect this module closes.
 */

import { parseSeed } from './seed'

/**
 * The query string that would pin `seed` into `search`, or `null` if there is nothing to do.
 *
 * Returns `null` — rather than the unchanged query — when `search` already carries a VALID
 * seed. That is the signal for the caller to skip the history call entirely: rewriting the URL
 * with itself on every load is a pointless side effect, and a function that cannot say "no
 * change needed" forces its caller to compare strings to find out.
 *
 * Keyed on whether the URL's seed is valid, not on whether it equals `seed`. The two cannot
 * disagree in production — `resolveSeed` prefers the URL's seed whenever it parses — so
 * checking validity is checking the thing that actually matters, and it guarantees this
 * function never overwrites a seed the player typed.
 *
 * A MALFORMED seed IS replaced. `parseSeed` rejects `?seed=12abc` and the session therefore
 * runs on a generated seed, which means the URL is claiming a world that is not on screen.
 * Left alone, it would reproduce nothing; `set` replaces it in place rather than appending, so
 * the result never has two `seed` parameters for `parseSeed` to choose between.
 *
 * Other parameters are preserved. A debug or tile-size flag is not this function's to discard.
 *
 * @param search - A query string, with or without its leading `?` (`location.search`).
 * @param seed - The seed this session is actually running on.
 * @returns A query string beginning with `?`, or `null` when `search` needs no change.
 */
export function pinnedSeedUrl(search: string, seed: number): string | null {
  if (parseSeed(search) !== null) return null

  const params = new URLSearchParams(search)
  params.set('seed', String(seed))
  return `?${params.toString()}`
}
