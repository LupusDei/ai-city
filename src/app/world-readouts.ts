/**
 * Shared display formatters for world properties that appear on MORE THAN ONE screen.
 *
 * WHY THIS MODULE EXISTS, and it is not a style preference. The acceptance suite's
 * ★AC-3.2 is the guard that the started colony IS the surveyed world — the browser-level
 * equivalent of the `aic-c1p` defect, where two beads closed green at 100% coverage while
 * 35% of the landing score ran on data no production code produced. It proves the world
 * is carried across the survey → operations transition by reading `deposit-count` and
 * `grid-dimensions` on BOTH screens and comparing them with Playwright's `toHaveText`,
 * which is **exact string equality**.
 *
 * That makes the rendered STRING part of the contract, not just the value. Two screens
 * built by two agents in isolated worktrees would each pick a reasonable format —
 * `64 × 64`, `64x64`, `64 by 64` — and ★AC-3.2 would fail while the bridge was perfect.
 * Worse, it would fail in a way neither screen's owner could diagnose from their own
 * worktree, and it would look like a bridge bug rather than a formatting mismatch.
 *
 * The spec (`specs/005-playable-start/spec.md`) pinned the testids and did NOT pin the
 * format — a real gap, filed as `aic-fxg`. One module both screens import is the fix,
 * because a shared function is enforced by the compiler whereas a literal written into a
 * spec drifts from the code the moment someone edits a component.
 *
 * This is the same lesson as `.claude/rules/03-testing.md`'s seam rule, one layer up:
 * **worktree isolation protects files from each other, not the interfaces between them.**
 *
 * Deliberately sim-agnostic and free of React: pure functions over sim types, so both
 * screens and their unit tests can use them, and so nothing here can drift into game
 * logic. Formatting is presentation; it belongs in `src/app/`, never in `src/sim/`.
 */

import type { Grid } from '../sim/grid'
import type { World } from '../sim/world'

/**
 * The multiplication sign used between grid dimensions: U+00D7 MULTIPLICATION SIGN,
 * with a single space either side.
 *
 * Named rather than inlined because it IS the contract. A future editor who "tidies" this
 * to the ASCII letter `x` would break ★AC-3.2 without touching either screen, and the
 * failure would point at the bridge. The two call sites below are the only places it may
 * appear.
 */
const DIMENSION_SEPARATOR = ' × '

/**
 * Total mineral deposits in a surveyed world, e.g. `"197"`.
 *
 * Takes the whole `World` because deposits live on the world, not the grid — this is the
 * narrowest type that carries them. The asymmetry with `formatGridDimensions` below is
 * deliberate: each function takes exactly the thing it needs and nothing more, which keeps
 * a caller from having to construct a `World` just to render a grid size.
 *
 * IMPORTANT for callers: the returned string must be the ENTIRE text content of the
 * element carrying `data-testid="deposit-count"`. Any label belongs in a sibling element.
 * `<span data-testid="deposit-count">Deposits: 197</span>` fails `toHaveText('197')`.
 */
export function formatDepositCount(world: World): string {
  return String(world.deposits.length)
}

/**
 * Grid dimensions as `"64 × 64"` — width, U+00D7 with surrounding spaces, height.
 *
 * Takes a bare `Grid` rather than a `World` so it works on both screens without either
 * needing to reach for a world it may not hold: the survey screen has
 * `world.grid`, and the operations screen has `colony.grid` — which is the SAME grid
 * object, because the bridge carries it by reference rather than regenerating it. That
 * shared identity is precisely what ★AC-3.2 exists to verify.
 *
 * Same caller requirement as above: this string must be the element's entire text.
 */
export function formatGridDimensions(grid: Grid): string {
  return `${String(grid.width)}${DIMENSION_SEPARATOR}${String(grid.height)}`
}
