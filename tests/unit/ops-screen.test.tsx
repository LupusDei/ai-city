// @vitest-environment jsdom
/**
 * The Colony Operations screen, rendered against a REAL started colony.
 *
 * TWO THINGS THIS FILE IS FOR, and only two:
 *
 *  1. THE SCREEN RENDERS FROM A `RunningState`. Every testid in the acceptance contract is
 *     present and carries the sim's own figure. The browser suite asserts the same thing,
 *     but it cannot run until the survey screen's routing lands, and a screen that is only
 *     ever exercised end to end is a screen nobody can debug.
 *
 *  2. THE DOUBLE-CLICK GUARD WORKS, AND FOR THE RIGHT REASON. This is the part the adapter
 *     deliberately does not own, and the part the acceptance suite can only observe
 *     weakly — its `dblclick` assertion is `toContainText('2')`, which "3 / 278" would also
 *     satisfy through the 278. So it is pinned here against `turns-remaining`, where 276
 *     and 275 cannot be confused.
 *
 * WHY THE HARNESS BELOW MATTERS. Testing the guard against a parent that never re-renders
 * would prove nothing about a real double click: the in-flight latch alone would swallow the
 * second press. The failure mode the adapter's docblock warns about is two clicks that
 * STRADDLE A REACT COMMIT — after the first, the colony has genuinely advanced and the
 * latch has genuinely cleared, so the second click is a valid intent naming a real turn.
 * `Harness` reproduces exactly that by dispatching through the adapter on every accepted
 * press, which is what the app itself will do. Only `MouseEvent.detail` can refuse that
 * second click, and `detail` is the browser's own count of clicks in one gesture — so no
 * timer, no debounce window, and nothing in this path that reads a clock.
 *
 * `fireEvent` rather than `user-event`: the latter is not a dependency of this project, and
 * `fireEvent` is what lets a test set `detail` explicitly, which is the whole point here.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpsScreen } from '../../src/app/screens/ops/OpsScreen'
import { dispatch } from '../../src/app/state/game-state'
import type { RunningState } from '../../src/app/state/game-state'
import { createGrid } from '../../src/sim/grid'
import type { PlayerOrder } from '../../src/sim/orders'
import { endCycle, startedColony } from '../support/running-colony'

afterEach(() => {
  // No global auto-cleanup is configured (that needs a setup file), so clearing the body by
  // hand keeps each render isolated — otherwise `getByTestId` throws on the duplicate.
  document.body.innerHTML = ''
})

function renderOps(
  state: RunningState,
  onEndCycle: (afterTurnsTaken: number) => void = () => undefined,
  onIssueOrders: (orders: readonly PlayerOrder[]) => void = () => undefined,
): void {
  render(<OpsScreen state={state} onEndCycle={onEndCycle} onIssueOrders={onIssueOrders} />)
}

/**
 * The screen wired to the adapter exactly as the app wires it: one `useState`, one
 * `dispatch`. Nothing about the turn loop is simulated.
 */
function Harness({ initial }: { readonly initial: RunningState }): JSX.Element {
  const [state, setState] = useState<RunningState>(initial)
  return (
    <OpsScreen
      state={state}
      onEndCycle={(afterTurnsTaken) => {
        setState((current) => {
          const next = dispatch(current, { kind: 'end-cycle', afterTurnsTaken })
          if (next.phase !== 'running') throw new Error('end-cycle left the running phase')
          return next
        })
      }}
      onIssueOrders={(orders) => {
        setState((current) => {
          const next = dispatch(current, { kind: 'issue-orders', orders })
          if (next.phase !== 'running') throw new Error('issue-orders left the running phase')
          return next
        })
      }}
    />
  )
}

function text(testId: string): string {
  // `textContent` is non-nullable on an `HTMLElement` (only `Document` and `DocumentType`
  // can return null), so there is nothing to default here — `?? ''` is a lint error.
  return screen.getByTestId(testId).textContent
}

function endCycleButton(): HTMLButtonElement {
  const button = screen.getByTestId('end-cycle')
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('end-cycle must be a <button> so `disabled` genuinely suppresses clicks')
  }
  return button
}

describe('OpsScreen at turn 1', () => {
  it('should render the ops screen container', () => {
    renderOps(startedColony())
    expect(screen.getByTestId('ops-screen')).toBeTruthy()
  })

  it('should report turn 1 of 278 in one readout', () => {
    // AC-3.3 requires this single element to carry BOTH the current turn and the total.
    renderOps(startedColony())
    expect(text('turn-readout')).toContain('1')
    expect(text('turn-readout')).toContain('278')
  })

  it('should report 277 turns remaining', () => {
    renderOps(startedColony())
    expect(text('turns-remaining')).toContain('277')
  })

  it('should report the sim’s power generation and draw', () => {
    renderOps(startedColony())
    expect(text('power-generation')).toBe('1,986,389 Wh')
    expect(text('power-draw')).toBe('9,081,732 Wh')
  })

  it('should report drones on shift out of the roster', () => {
    renderOps(startedColony())
    expect(text('drones-on-shift')).toBe('7 of 33')
  })

  it('should report zero habitat capacity on a fresh colony', () => {
    renderOps(startedColony())
    expect(text('habitat-capacity')).toContain('0')
  })

  it('should report the brownout cut line, because one integer explains the turn', () => {
    renderOps(startedColony())
    expect(text('brownout-cut-line')).toBe('7')
  })

  it('should report vented energy rather than dropping it silently', () => {
    // AC-4.2's reason for existing: under the no-storage ruling this colony vents over a
    // megawatt-hour EVERY turn. A player who cannot see it cannot learn the mechanic.
    renderOps(startedColony())
    expect(text('vented-energy')).toBe('1,029,776 Wh')
  })

  it('should carry the surveyed world’s deposit count and grid dimensions', () => {
    // ★AC-3.2. The elements contain the shared formatter's output and NOTHING else — the
    // acceptance suite compares them to the survey screen's with exact string equality, so
    // a label inside either element fails the test.
    renderOps(startedColony())
    expect(text('deposit-count')).toBe('197')
    expect(text('grid-dimensions')).toBe('64 × 64')
  })

  it('should take the grid dimensions from the COLONY’s grid, not the world’s', () => {
    // Pins a design decision the comment in `OpsScreen.tsx` explains and that nothing else
    // would enforce: both grids render "64 × 64" on a real colony, so only a deliberately
    // divergent one can prove which the screen reads. Reading the colony's grid is what makes
    // ★AC-3.2 able to catch a bridge that built the colony on a fresh default-sized grid
    // instead of the surveyed one — the deposit count alone cannot see that.
    const state = startedColony()
    renderOps({ ...state, colony: { ...state.colony, grid: createGrid(48, 40) } })
    expect(text('grid-dimensions')).toBe('48 × 40')
  })

  it('should report the mission verdict', () => {
    renderOps(startedColony())
    expect(text('mission-verdict')).toBe('Mission in progress')
  })

  it('should offer an enabled End Cycle control', () => {
    renderOps(startedColony())
    expect(endCycleButton().disabled).toBe(false)
  })

  it('should not claim a last cycle before one has resolved', () => {
    renderOps(startedColony())
    expect(screen.queryByTestId('last-cycle-turn')).toBeNull()
  })
})

describe('OpsScreen End Cycle', () => {
  it('should ask the parent to end the turn the player is looking at', () => {
    // The token names the turn the RENDERED state was on, so the adapter's stale-token
    // guard compares against what the player actually saw.
    const onEndCycle = vi.fn()
    const state = startedColony()
    renderOps(state, onEndCycle)

    fireEvent.click(endCycleButton())

    expect(onEndCycle).toHaveBeenCalledTimes(1)
    expect(onEndCycle).toHaveBeenCalledWith(state.colony.turnsTaken)
    expect(onEndCycle).toHaveBeenCalledWith(0)
  })

  it('should advance exactly one turn on a single click', () => {
    // AC-4.1, wired through the adapter: 277 -> 276, not 275.
    render(<Harness initial={startedColony()} />)
    expect(text('turns-remaining')).toContain('277')

    fireEvent.click(endCycleButton(), { detail: 1 })

    expect(text('turn-readout')).toContain('2')
    expect(text('turns-remaining')).toContain('276')
  })

  it('should SWALLOW the second click of a double-click gesture that straddles a commit', () => {
    // THE ONE THING ONLY THIS COMPONENT CAN FIX. By the time this second click arrives the
    // colony HAS advanced and the in-flight latch HAS cleared, so the intent is valid and
    // the adapter would rightly resolve a second turn. `detail === 2` is the only thing
    // that can tell it apart from a deliberate second press, and the browser computed it.
    render(<Harness initial={startedColony()} />)
    const button = endCycleButton()

    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 2 })

    expect(text('turns-remaining')).toContain('276')
    expect(text('turns-remaining')).not.toContain('275')
  })

  it('should swallow the third click of a triple-click gesture too', () => {
    render(<Harness initial={startedColony()} />)
    const button = endCycleButton()

    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 2 })
    fireEvent.click(button, { detail: 3 })

    expect(text('turns-remaining')).toContain('276')
  })

  it('should still advance on two deliberate, separate presses', () => {
    // The guard must not turn End Cycle into a one-shot control: a 278-turn game needs 278
    // presses. Two gestures the browser counted as first clicks are two turns.
    render(<Harness initial={startedColony()} />)

    fireEvent.click(endCycleButton(), { detail: 1 })
    fireEvent.click(endCycleButton(), { detail: 1 })

    expect(text('turns-remaining')).toContain('275')
  })

  it('should disable the control while a resolution is in flight', () => {
    // The other half of the guard, for two clicks landing inside ONE React batch: the
    // colony has not advanced, so a press naming the same turn must not spend a second one.
    // `disabled` makes that visible to the player as well as inert.
    const onEndCycle = vi.fn()
    renderOps(startedColony(), onEndCycle)
    const button = endCycleButton()

    fireEvent.click(button)

    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onEndCycle).toHaveBeenCalledTimes(1)
  })

  it('should re-enable once the colony has advanced past the accepted turn', () => {
    const onEndCycle = vi.fn()
    const noopIssueOrders = (): void => undefined
    const first = startedColony()
    const { rerender } = render(
      <OpsScreen state={first} onEndCycle={onEndCycle} onIssueOrders={noopIssueOrders} />,
    )

    fireEvent.click(endCycleButton())
    expect(endCycleButton().disabled).toBe(true)

    rerender(<OpsScreen state={endCycle(first)} onEndCycle={onEndCycle} onIssueOrders={noopIssueOrders} />)

    expect(endCycleButton().disabled).toBe(false)
    fireEvent.click(endCycleButton())
    expect(onEndCycle).toHaveBeenCalledTimes(2)
    expect(onEndCycle).toHaveBeenNthCalledWith(2, 1)
  })
})

describe('OpsScreen once the mission has concluded', () => {
  const resolved = endCycle(startedColony())
  const concluded: RunningState = { ...resolved, outlook: null }

  it('should refuse a further cycle rather than showing turn 279', () => {
    const onEndCycle = vi.fn()
    renderOps(concluded, onEndCycle)

    expect(endCycleButton().disabled).toBe(true)
    fireEvent.click(endCycleButton())
    expect(onEndCycle).not.toHaveBeenCalled()
  })

  it('should still report the final turn’s figures', () => {
    renderOps(concluded)
    expect(text('turn-readout')).toContain('1')
    expect(text('vented-energy')).toBe('1,029,776 Wh')
  })
})

describe('OpsScreen after a turn has resolved', () => {
  it('should report the turn just ended alongside the one now in progress', () => {
    renderOps(endCycle(startedColony()))
    expect(text('turn-readout')).toContain('2')
    expect(text('turns-remaining')).toContain('276')
    // The record of the PAST, distinct from the forecast: `lastReport`, not `outlook`.
    expect(text('last-cycle-turn')).toBe('1')
  })
})

describe('★AC-4.3 determinism through the render layer', () => {
  it('should render an identical turn-1 display for two independent runs of the same seed', () => {
    // The sim's golden trace proves the sim is deterministic; it cannot prove the render
    // layer introduced no ordering, clock or randomness of its own. The browser suite
    // asserts this on a live page; this is the same property, reachable in milliseconds.
    const capture = (): string => {
      render(<Harness initial={startedColony()} />)
      fireEvent.click(endCycleButton(), { detail: 1 })
      const parts = [
        'turn-readout',
        'turns-remaining',
        'power-generation',
        'power-draw',
        'drones-on-shift',
        'habitat-capacity',
        'vented-energy',
      ].map((id) => `${id}=${text(id)}`)
      document.body.innerHTML = ''
      return parts.join('|')
    }
    expect(capture()).toBe(capture())
  })
})
