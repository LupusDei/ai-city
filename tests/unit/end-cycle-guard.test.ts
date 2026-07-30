/**
 * The End Cycle button's own guard — the half of the exactly-one-turn property that the
 * adapter deliberately does NOT own.
 *
 * WHY THIS EXISTS AT ALL. `game-state.ts`'s `advanceCycle` already refuses a REPEATED
 * intent: an `end-cycle` action names the turn it means to end, so re-applying the same
 * action object is idempotent. That covers a duplicated handler, a stale closure, a
 * StrictMode double-invoke and two clicks landing in one React batch. It explicitly does
 * NOT cover a `dblclick` whose two `click` events straddle a React commit: those are two
 * DIFFERENT intents, each naming the turn it saw, and the adapter's own docblock says two
 * turns is the correct reading of two independent clicks. Spec 005's AC-edge nevertheless
 * requires a double-click to advance exactly one turn, so that refusal belongs to the
 * button — and this is it.
 *
 * NO TIMERS, AND THAT IS THE POINT. ★AC-4.3 requires the same seed, landing and orders to
 * render an identical turn 1, which forbids this path from introducing time; a debounce
 * window would also make the acceptance test flaky by construction. So the discrimination
 * is `MouseEvent.detail` — the BROWSER's own count of how many clicks belong to this one
 * gesture. The browser already computed it, using platform double-click timing we neither
 * see nor depend on. Our code reads an integer off an event, which is as pure as reading
 * the coordinates off it.
 */

import { describe, expect, it } from 'vitest'

import {
  acceptsEndCycle,
  isEndCycleEnabled,
  isResolutionInFlight,
} from '../../src/app/screens/ops/end-cycle-guard'

/** A first, ordinary single click on a fresh colony at turn 1 (`turnsTaken` 0). */
const FIRST_PRESS = {
  clickCount: 1,
  turnsTaken: 0,
  cycleInProgress: true,
  acceptedForTurnsTaken: null,
} as const

describe('isResolutionInFlight', () => {
  it('should report nothing in flight when no press has been accepted yet', () => {
    expect(isResolutionInFlight(null, 0)).toBe(false)
  })

  it('should report a resolution in flight when the accepted press named the current turn', () => {
    // The player asked to end turn 1 and the colony has not advanced past it yet.
    expect(isResolutionInFlight(0, 0)).toBe(true)
  })

  it('should report nothing in flight once the colony has advanced past the accepted turn', () => {
    expect(isResolutionInFlight(0, 1)).toBe(false)
  })
})

describe('isEndCycleEnabled', () => {
  it('should be enabled on a fresh colony with a cycle in progress', () => {
    expect(isEndCycleEnabled(FIRST_PRESS)).toBe(true)
  })

  it('should be disabled while a resolution is in flight', () => {
    expect(isEndCycleEnabled({ ...FIRST_PRESS, acceptedForTurnsTaken: 0 })).toBe(false)
  })

  it('should be disabled once the mission has concluded', () => {
    // `outlook === null` is the adapter's single signal that no further turn will be
    // resolved — spec 005's "End Cycle at turn 278 shows the verdict, not turn 279".
    expect(isEndCycleEnabled({ ...FIRST_PRESS, cycleInProgress: false })).toBe(false)
  })

  it('should be enabled again once the colony has advanced past the accepted turn', () => {
    expect(isEndCycleEnabled({ ...FIRST_PRESS, acceptedForTurnsTaken: 0, turnsTaken: 1 })).toBe(
      true,
    )
  })
})

describe('acceptsEndCycle', () => {
  it('should accept an ordinary first single click', () => {
    expect(acceptsEndCycle(FIRST_PRESS)).toBe(true)
  })

  it('should REFUSE the second click of one double-click gesture', () => {
    // THE acceptance criterion this module exists for. `detail` is 2 on the second click
    // of a double click, decided by the browser, so nothing here measures time.
    expect(acceptsEndCycle({ ...FIRST_PRESS, clickCount: 2 })).toBe(false)
  })

  it('should REFUSE the third click of a triple click', () => {
    expect(acceptsEndCycle({ ...FIRST_PRESS, clickCount: 3 })).toBe(false)
  })

  it('should accept a press whose click count the environment did not set', () => {
    // `detail` is 0 for a programmatically dispatched click (and for a keyboard-activated
    // button). Refusing those would make the button unusable from the keyboard — an
    // accessibility regression — and would silently break any non-mouse activation. Only a
    // count the browser itself raised ABOVE one means "this is a repeat of one gesture".
    expect(acceptsEndCycle({ ...FIRST_PRESS, clickCount: 0 })).toBe(true)
  })

  it('should REFUSE a press that arrives while a resolution is in flight', () => {
    // Two clicks inside ONE React batch: the colony has not advanced, so the press names
    // a turn we have already asked to end. Belt to the adapter's braces.
    expect(acceptsEndCycle({ ...FIRST_PRESS, acceptedForTurnsTaken: 0 })).toBe(false)
  })

  it('should REFUSE a press once the mission has concluded', () => {
    expect(acceptsEndCycle({ ...FIRST_PRESS, cycleInProgress: false })).toBe(false)
  })

  it('should accept the next turn’s first click after the colony advanced', () => {
    expect(
      acceptsEndCycle({ ...FIRST_PRESS, acceptedForTurnsTaken: 0, turnsTaken: 1 }),
    ).toBe(true)
  })
})
