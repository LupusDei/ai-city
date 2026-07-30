/**
 * The composition root: one seed, one world, one dispatcher, and the routing between phases.
 *
 * ============================================================================
 * WHAT THIS FILE OWNS, AND IT IS DELIBERATELY VERY LITTLE
 * ----------------------------------------------------------------------------
 * Three things, and nothing else:
 *
 *   1. THE SEED. Decided once, in lazy state, via `./seed` — the one module allowed to be
 *      random. Recomputing it on a render would break AC-1.3 the moment anything re-renders.
 *   2. THE GAME STATE. `beginSurvey` once, then every change through `dispatch`. This is the
 *      only file in the app that holds sim-derived state, so there is exactly one answer to
 *      "what is happening" and no screen can hold a second.
 *   3. WHICH SCREEN IS ON. A switch on `game.phase`, which is a discriminated union — so
 *      "survey with a live colony" and "a colony with a half-finished selection" are not
 *      states this file has to remember to exclude; they are unrepresentable.
 *
 * It renders no readout of its own. Every player gesture becomes exactly one `GameAction`
 * here, and `tests/unit/app-boundary.test.ts` is the gate that keeps every other file in
 * `src/app/` from finding a second way to change sim state (FR-004).
 *
 * NO GAME LOGIC (constitution §4). This file calls `beginSurvey` and `dispatch` and nothing
 * else from the sim. It does not read a score, decide a legality or format a figure.
 * ============================================================================
 *
 * ============================================================================
 * THE SEED IS PINNED INTO THE URL, SO RELOAD IS A RETRY AND NOT A REROLL
 * ----------------------------------------------------------------------------
 * `resolveSeed` generates a seed when the URL has none and writes nothing back, which made the
 * browser's own reload button destructive: a player who arrived at `/` and reloaded got a
 * DIFFERENT world, with no way back to the one they had been surveying. `pinnedSeedUrl` decides
 * the corrected query and the single `history.replaceState` below applies it.
 *
 * It also makes AC-1.3 honest rather than incidental: that test asserts identical terrain
 * across a reload and passes today only because the test itself navigates to `/?seed=...`.
 * After this the guarantee holds for a player who supplied nothing. `pinnedSeedUrl` returns
 * null whenever the URL already carries a valid seed, so it is a genuine no-op for every
 * acceptance test that supplies one and cannot perturb that comparison in either direction.
 * ============================================================================
 *
 * ============================================================================
 * THE END-CYCLE TOKEN IS PASSED THROUGH UNCHANGED, AND THAT IS THE WHOLE GUARD
 * ----------------------------------------------------------------------------
 * `OpsScreen` hands `onEndCycle` the `colony.turnsTaken` it ACTUALLY RENDERED, and this file
 * forwards that number into the intent without recomputing it. That is deliberate and it is
 * load-bearing: the adapter refuses an `end-cycle` whose `afterTurnsTaken` does not match the
 * colony's current turn, so the token has to describe the turn the player was looking at when
 * they pressed the button. Reading `game.colony.turnsTaken` here instead would defeat it —
 * this closure would read whatever the latest state says, which is exactly the value the guard
 * is trying to detect a divergence from.
 *
 * Two guards, in two places, refusing two different things: the screen's own guard swallows the
 * second half of a physical double-click, and the adapter's token guard refuses a REPEATED
 * intent (a stale closure, a replayed event, StrictMode's double invoke). Neither substitutes
 * for the other, and neither belongs in this file.
 * ============================================================================
 */
import { type JSX, useCallback, useEffect, useState } from 'react'

import type { Coord } from '../sim/grid'
import type { PlayerOrder } from '../sim/orders'
import { OpsScreen } from './screens/ops/OpsScreen'
import { SurveyScreen } from './screens/SurveyScreen'
import { resolveSeed } from './seed'
import { pinnedSeedUrl } from './seed-url'
import { beginSurvey, dispatch } from './state/game-state'
import type { GameAction, GameState } from './state/game-state'
import { PAGE_STYLES } from './styles'

export interface AppProps {
  /** URL query string (`location.search`), injected so the shell stays testable. */
  readonly search: string
  /**
   * Source of randomness for a generated seed. Defaults to `Math.random`; tests pass a
   * fixed function so the fallback path is deterministic.
   */
  readonly random?: () => number
}

/**
 * Root component. Resolves the session seed once, surveys one world from it, and routes.
 *
 * Both pieces of state are LAZY (`useState(() => ...)`) rather than computed in the render
 * body. A seed recomputed per render would produce a different world on the second render;
 * a world regenerated per render would be wasted work at best and a map that changes
 * underneath a mid-decision player at worst. `beginSurvey` is documented as
 * exactly-once-per-session for that reason.
 */
export function App({ search, random = Math.random }: AppProps): JSX.Element {
  const [seed] = useState(() => resolveSeed(search, random))
  const [game, setGame] = useState<GameState>(() => beginSurvey({ seed }))

  /**
   * The one place a player gesture becomes a sim state change.
   *
   * Uses the updater form so the reducer reads the CURRENT state rather than the one captured
   * when the handler was created. A stale closure here would let two gestures in one React
   * batch both apply to the pre-batch state — which for `end-cycle` is precisely the
   * double-fire the adapter's `afterTurnsTaken` token exists to refuse, and there is no reason
   * to make that guard do work the dispatcher can avoid creating.
   */
  const act = useCallback((action: GameAction) => {
    setGame((current) => dispatch(current, action))
  }, [])

  const selectSite = useCallback(
    (anchor: Coord) => {
      act({ kind: 'select-site', anchor })
    },
    [act],
  )
  const clearSelection = useCallback(() => {
    act({ kind: 'clear-selection' })
  }, [act])
  const startMission = useCallback(() => {
    act({ kind: 'begin-mission' })
  }, [act])
  const endCycle = useCallback(
    // Forwarded UNCHANGED — see this file's header. The number is the turn the ops screen
    // rendered, and re-deriving it here would disarm the adapter's stale-token guard.
    (afterTurnsTaken: number) => {
      act({ kind: 'end-cycle', afterTurnsTaken })
    },
    [act],
  )
  const issueOrders = useCallback(
    (orders: readonly PlayerOrder[]) => {
      act({ kind: 'issue-orders', orders })
    },
    [act],
  )

  // The app's only history call. `replaceState`, never `pushState`: pinning the seed is a
  // correction to the current URL, not navigation — a pushed entry would give the player a
  // Back button that returns to the seedless URL and regenerates the world.
  useEffect(() => {
    const pinned = pinnedSeedUrl(search, seed)
    if (pinned === null) return
    window.history.replaceState(null, '', pinned)
  }, [search, seed])

  return (
    <>
      {/* Page-level tokens and ground, rendered in EVERY phase — so the page does not lose
          its background when the survey screen unmounts, and so the operations screen
          inherits the same visual language without owning a copy of it. */}
      <style>{PAGE_STYLES}</style>
      {game.phase === 'surveying' ? (
        <SurveyScreen
          state={game}
          onSelectSite={selectSite}
          onClearSelection={clearSelection}
          onBeginMission={startMission}
        />
      ) : (
        <OpsScreen state={game} onEndCycle={endCycle} onIssueOrders={issueOrders} />
      )}
    </>
  )
}
