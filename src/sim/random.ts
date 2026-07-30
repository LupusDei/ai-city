/**
 * The sim core's single seeded-PRNG construction.
 *
 * This module exists because a deterministic PRNG is a shared primitive, not a
 * per-module implementation detail: `terrain.ts` seeds one from `Terrain.seed` to
 * generate a heightmap, and `buildability.ts` seeds ANOTHER from that same
 * `terrain.seed` to scatter mineral deposits onto that heightmap. Those two draws
 * only stay "in register" — deposits landing where the terrain review actually
 * expects them, on every run and every process — if both call sites resolve to
 * IDENTICAL code, not merely similar code. Two independently maintained copies of
 * this function are a determinism hazard even if they started out
 * byte-for-byte identical, because editing one in isolation (a plausible, easy
 * mistake: "just tune the terrain PRNG a little") silently desyncs deposits from
 * the terrain they sit on. The failure that produces looks like "the map looks
 * wrong" — a content bug — not a code defect, and a golden-trace regression test
 * would cheerfully bake in whichever pair of copies happened to exist when it was
 * recorded. Extracting to one module, imported by both, makes that class of bug
 * impossible to reintroduce by construction: there is nothing left to duplicate.
 * `tests/unit/boundary.test.ts` enforces this mechanically (see its "single
 * source of truth: mulberry32" block) rather than leaving it to code-review
 * vigilance.
 *
 * Like `terrain.ts` and `buildability.ts`, this module is pure data plus pure
 * functions: no rendering, no I/O, no clock, and no `Math.random`/`Date.now`/
 * `new Date` — see `tests/unit/boundary.test.ts`, which enforces that ban
 * automatically for everything under `src/sim/`.
 */

/**
 * mulberry32: a minimal 32-bit seeded PRNG.
 *
 * Chosen over `Math.random()` (unseedable, forbidden in `src/sim` — see the
 * module doc comment) and over a cryptographic RNG (unnecessary weight for
 * terrain "flavour" randomness and mineral scatter) for three properties, all
 * required simultaneously by this project's determinism contract:
 *
 * - It is ~5 lines with NO external dependency, so there is nothing upstream
 *   (library version, native binding, platform Math library quirk) that could
 *   change this function's output out from under the sim core.
 * - Its output is a PURE FUNCTION of the 32-bit seed and the call count alone —
 *   no hidden global state, no wall-clock input, nothing OS- or
 *   process-specific. The same seed, called the same number of times, produces
 *   the same sequence on any run, on any machine, forever. That is the entire
 *   property `generateTerrain` and `generateDeposits` depend on to stay
 *   reproducible and to stay in register with each other.
 * - It is not cryptographically secure, which is irrelevant here: nothing in
 *   this simulation needs unpredictability against an adversary, only
 *   reproducibility against a seed.
 *
 * Returns a closure over its internal state (rather than a global generator)
 * so that two independent callers — e.g. one `generateTerrain` call and one
 * `generateDeposits` call, or two calls racing in the same process — never
 * share, and can never accidentally mutate, each other's sequence.
 */
export function mulberry32(seed: number): () => number {
  // `>>> 0` folds any finite number (including negatives) into an unsigned
  // 32-bit integer, which is the state mulberry32 operates on.
  let state = seed >>> 0
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
