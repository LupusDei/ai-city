/**
 * Seed resolution for the application shell.
 *
 * The seed is the single input that makes a mission reproducible (spec 005, FR-005:
 * "The seed MUST be visible and reproducible from the UI"), so how it is obtained is
 * load-bearing rather than incidental:
 *
 *   - `?seed=<n>` in the URL wins, which is what lets the acceptance suite pin a run.
 *   - Absent or malformed, one is GENERATED. The edge case is explicit in the spec —
 *     "Page loaded with no seed in the URL — must generate one and display it, never
 *     crash" — so a bad seed degrades to a fresh mission, never to an exception.
 *
 * This module lives in `src/app/` and not `src/sim/` on purpose. Reading a URL and
 * calling a random source are both things the sim is forbidden to do
 * (`tests/unit/boundary.test.ts`), so the nondeterminism is confined to the edge here
 * and the sim only ever receives an already-decided number.
 */

/**
 * Exclusive upper bound for a generated seed: 2^31 - 1.
 *
 * Kept inside the signed 32-bit range because the sim's PRNG is seeded from an integer
 * and a value beyond 2^53 would lose precision on the way in — a seed that cannot be
 * round-tripped is not reproducible, which defeats the entire point of showing it.
 */
export const SEED_SPACE = 2_147_483_647

/**
 * Extract a usable seed from a URL query string, or `null` when there is not one.
 *
 * Rejects (rather than coerces) anything that is not a non-negative integer. `Number('')`
 * is `0` and `Number('12abc')` is `NaN`; silently accepting either would display a seed
 * the player did not ask for and could not reproduce.
 *
 * @param search - A query string, with or without the leading `?` (`location.search`).
 * @returns The parsed seed, or `null` if absent or malformed.
 */
export function parseSeed(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed')
  if (raw === null || raw.trim() === '') return null

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > SEED_SPACE) return null

  return value
}

/**
 * Resolve the seed for this session: the URL's seed when valid, otherwise a fresh one.
 *
 * `random` is injected rather than reaching for `Math.random` internally so that this
 * function is total and testable — the only nondeterminism is the argument the caller
 * chooses to pass.
 *
 * @param search - A query string (`location.search`).
 * @param random - Source of randomness in `[0, 1)`; production passes `Math.random`.
 * @returns A non-negative integer seed, always.
 */
export function resolveSeed(search: string, random: () => number): number {
  return parseSeed(search) ?? Math.floor(random() * SEED_SPACE)
}
