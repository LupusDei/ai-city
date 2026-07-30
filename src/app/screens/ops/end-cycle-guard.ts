/**
 * The End Cycle button's own refusal rules — the half of "exactly one turn per press" that
 * the sim/UI adapter deliberately does NOT own.
 *
 * ============================================================================
 * WHY THIS EXISTS WHEN THE ADAPTER ALREADY GUARDS
 * ----------------------------------------------------------------------------
 * `state/game-state.ts`'s `advanceCycle` refuses a REPEATED intent: an `end-cycle` action
 * carries `afterTurnsTaken`, the turn it means to end, and dispatch refuses it unless that
 * is the turn the colony is actually on. Re-applying one action object is therefore
 * idempotent, which covers a duplicated handler, a stale closure firing twice, React
 * StrictMode double-invoking a reducer, and two clicks landing in a single React batch.
 *
 * It does NOT cover the case spec 005's AC-edge tests. A `dblclick` whose two `click`
 * events straddle a React commit produces two DIFFERENT intents, each naming the turn it
 * saw — and as that module's own docblock says, two turns is the correct reading of two
 * independent clicks. By the time the second click arrives the colony HAS advanced and the
 * token HAS moved on, so the intent is valid and the adapter is right to honour it. If the
 * button must swallow the second half of a double-click, that belongs to the button.
 *
 * This is the button's part, and it is two independent rules for two independent failures:
 *
 *   1. THE IN-FLIGHT LATCH — for two presses inside one React commit. Once a press naming
 *      turn N has been accepted, no further press is accepted until the colony has advanced
 *      past N. This is also what makes the control visibly `disabled` while a resolution is
 *      in flight, which is a UI promise as much as a guard.
 *
 *   2. THE GESTURE COUNT — for two presses that straddle a commit. `MouseEvent.detail` is
 *      the number of clicks the BROWSER counted as belonging to this one gesture: 1 for a
 *      single click, 2 for the second click of a double-click, 3 for a triple. A count
 *      above one means "this is a repeat of a gesture already acted on", and the browser
 *      decided that, using platform double-click timing this code neither reads nor
 *      depends on.
 *
 * ============================================================================
 * NO TIMERS. THAT IS A REQUIREMENT, NOT A PREFERENCE.
 * ----------------------------------------------------------------------------
 * The obvious implementation is a debounce window — ignore a press within N ms of the last
 * one. Two reasons it is wrong here. Spec 005's ★AC-4.3 requires the same seed, landing and
 * orders to render an identical turn 1, which forbids this path from introducing time at
 * all; and a test that races a debounce window is flaky by construction, so the acceptance
 * criterion would stop meaning anything.
 *
 * Everything below is a pure function of integers and booleans. No `Date.now`, no
 * `setTimeout`, no `Math.random`, no DOM. Reading `detail` off an event is exactly as pure
 * as reading its coordinates: the browser already computed it before the handler ran.
 *
 * WHY A `.ts` MODULE AND NOT AN `if` IN THE COMPONENT. `src/app/**\/*.tsx` is excluded from
 * the coverage gate; pure `.ts` under `src/app/` is not. A guard living in the component
 * would be the one piece of this feature outside the 80/70/60 threshold — and it is the
 * piece whose failure silently spends a turn from a 278-turn budget.
 */

/**
 * Whether End Cycle can be pressed at all, independent of any particular press.
 *
 * The narrowest input the `disabled` attribute needs, so the component can compute it at
 * render time when no event exists yet.
 */
export interface EndCycleAvailability {
  /** The colony's `turnsTaken` as currently rendered. */
  readonly turnsTaken: number
  /**
   * Whether a further turn will be resolved at all — the adapter's `outlook !== null`.
   *
   * `null` there is the single signal that the mission has reached a verdict, which is
   * spec 005's "End Cycle at turn 278 must show the mission verdict, not turn 279". Passed
   * in as a boolean rather than read from state here so this module stays a pure predicate
   * over values and never learns the shape of `RunningState`.
   */
  readonly cycleInProgress: boolean
  /**
   * The `turnsTaken` named by the most recent press this guard accepted, or `null` if none
   * has been. The component holds it; this module only compares it.
   */
  readonly acceptedForTurnsTaken: number | null
}

/** One press of End Cycle: its availability, plus what the browser said about the gesture. */
export interface EndCyclePress extends EndCycleAvailability {
  /**
   * `MouseEvent.detail` — the browser's count of clicks in this gesture.
   *
   * `1` for an ordinary click, `2` for the second click of a double-click, `3` for the
   * third of a triple. `0` for a click no pointer generated: a programmatic
   * `dispatchEvent`, and — the case that matters to real players — a button activated from
   * the keyboard.
   */
  readonly clickCount: number
}

/**
 * The lowest click count that means "a repeat of a gesture already acted on".
 *
 * Named rather than inlined because the boundary is the rule: anything at or above this is
 * refused, and `0` and `1` are both first presses (see {@link EndCyclePress.clickCount}).
 */
const REPEAT_CLICK_COUNT = 2

/**
 * Whether a turn resolution asked for by an earlier press has not yet landed.
 *
 * True exactly when the accepted press named the turn the colony is STILL on. `null` is
 * never equal to a number, so "nothing accepted yet" is correctly not in flight.
 *
 * Keyed on the colony's own turn counter rather than on a separate boolean that some
 * `useEffect` has to remember to clear: the sim advancing the clock IS the event that ends
 * the flight, so the two cannot disagree and there is no reset to forget. A latch cleared
 * by anything else would leave a 278-turn game one press from a permanently dead button.
 */
export function isResolutionInFlight(
  acceptedForTurnsTaken: number | null,
  turnsTaken: number,
): boolean {
  return acceptedForTurnsTaken === turnsTaken
}

/**
 * Whether the End Cycle control should be live — the value of `!disabled`.
 *
 * Disabled for the two reasons a player would want distinguished, and the screen labels
 * them separately: the mission is over, or the turn they just asked for is still resolving.
 */
export function isEndCycleEnabled(availability: EndCycleAvailability): boolean {
  if (!availability.cycleInProgress) return false
  return !isResolutionInFlight(availability.acceptedForTurnsTaken, availability.turnsTaken)
}

/**
 * Whether this press should be turned into an `end-cycle` intent.
 *
 * The union of both rules. Order is immaterial — a refused press is a no-op either way —
 * but availability is checked first so a press on a control the player can see is disabled
 * is refused for the reason they can see, not for its click count.
 */
export function acceptsEndCycle(press: EndCyclePress): boolean {
  if (!isEndCycleEnabled(press)) return false
  return press.clickCount < REPEAT_CLICK_COUNT
}
