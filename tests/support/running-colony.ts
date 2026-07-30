/**
 * A REAL started colony, for the tests of the screens that display one.
 *
 * WHY A REAL ONE RATHER THAN A MOCK. `aic-c1p` shipped a landing score at 100% coverage
 * while 35% of it ran on data nothing produced; `aic-8eq` shipped ten modules at 100%
 * coverage that could not run a turn. Both were possible because the fixtures were
 * hand-written objects shaped like the type rather than values the sim actually emits. A
 * `RunningState` assembled by hand would let an ops-screen test assert a field name the
 * sim never populates — which is the exact defect class the acceptance suite's ★AC-3.2
 * exists to catch one layer up. So this builds a colony the way the app does: through
 * `beginSurvey` and `dispatch`, with no mocking anywhere.
 *
 * It is cheap (a world generation and one or two pure turn resolutions) and deterministic:
 * one seed, fixed anchors, no clock and no randomness. `tests/03-testing.md`'s mocking rule
 * — "mock data must match actual CLI/API output, not just TypeScript type definitions" —
 * is satisfied in the strongest available form: the data IS the sim's output.
 *
 * Lives in `tests/support/` because two test files need it (`ops-view.test.ts` and
 * `ops-screen.test.tsx`) and a fixture duplicated between them is a fixture that drifts.
 */

import { beginSurvey, dispatch } from '../../src/app/state/game-state'
import type { GameState, RunningState } from '../../src/app/state/game-state'

/** The seed the acceptance suite uses, so unit and browser tests describe one world. */
export const FIXTURE_SEED = 20260730

/**
 * Two anchors known to be legal on this seed and far enough apart to score well.
 *
 * Not read off the survey screen's candidate list on purpose: that list belongs to another
 * screen, and a fixture that depended on it would couple these tests to its layout.
 */
const DRONE_HULL_ANCHOR = { x: 10, y: 10 } as const
const REACTOR_HULL_ANCHOR = { x: 30, y: 30 } as const

/**
 * A colony at turn 1: landed, nothing resolved yet, `lastReport` still null.
 *
 * @throws {Error} if the fixture fails to reach the running phase — which would mean the
 *   anchors above stopped being legal, and every assertion built on this would otherwise
 *   be silently testing a surveying state instead.
 */
export function startedColony(seed: number = FIXTURE_SEED): RunningState {
  let game: GameState = beginSurvey({ seed })
  game = dispatch(game, { kind: 'select-site', anchor: DRONE_HULL_ANCHOR })
  game = dispatch(game, { kind: 'select-site', anchor: REACTOR_HULL_ANCHOR })
  game = dispatch(game, { kind: 'begin-mission' })

  if (game.phase !== 'running') {
    throw new Error(
      `running-colony fixture failed to start a mission on seed ${seed}: still ${game.phase}`,
    )
  }
  return game
}

/** Resolve one turn, through the adapter's own guard, exactly as the screen does. */
export function endCycle(state: RunningState): RunningState {
  const next = dispatch(state, {
    kind: 'end-cycle',
    afterTurnsTaken: state.colony.turnsTaken,
  })
  if (next.phase !== 'running') throw new Error('end-cycle left the running phase')
  return next
}
