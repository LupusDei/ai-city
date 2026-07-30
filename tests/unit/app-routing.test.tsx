// @vitest-environment jsdom
/**
 * The composition root: phase routing, intent dispatch, and the seed pinned into the URL.
 *
 * This is the file that proves the survey screen is WIRED, not merely written. Every defect
 * this project has shipped — `aic-c1p`, `aic-8eq`, `aic-ck0` — was a fully covered module
 * connected to nothing, so a component test that renders a screen against a hand-built state
 * proves strictly less than it appears to. Here the screen is driven through `App`'s real
 * `dispatch`, by clicking real DOM, so a callback plumbed to the wrong intent fails.
 *
 * `tests/unit/app-shell.test.tsx` covers the seed readout itself and is deliberately left
 * alone: it was written as the toolchain proof for `aic-8tl.6` and it still passes unchanged,
 * which is the useful signal that replacing the shell with the real screen did not move the
 * ground under it.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../src/app/App'
import { candidateSites, candidateTestId } from '../../src/app/screens/candidate-sites'
import { MAP_DIMENSION } from '../../src/app/state/game-state'
import { createGrid } from '../../src/sim/grid'

const SEED = 20260730
const SEARCH = `?seed=${String(SEED)}`

const LATTICE = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))

/** The nth candidate marker in the lattice's own order — the order the DOM renders it in. */
function marker(index: number): HTMLElement {
  const site = LATTICE[index]
  if (site === undefined) throw new Error(`No candidate at lattice index ${index}`)
  return screen.getByTestId(candidateTestId(site.anchor))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('App — phase routing', () => {
  it('should open on the survey screen, never on a running mission', () => {
    render(<App search={SEARCH} random={() => 0} />)
    expect(screen.getByTestId('survey-screen')).toBeTruthy()
    expect(screen.queryByTestId('ops-screen')).toBeNull()
  })

  it('should present no half-started mission on a fresh mount mid-survey (AC-edge)', () => {
    // A reload is a fresh mount. `GameState` is a union on `phase`, so a colony alongside an
    // incomplete selection is not a state this can produce — but the acceptance suite checks
    // it at the browser level, and this is the same property one layer down.
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    document.body.innerHTML = ''
    render(<App search={SEARCH} random={() => 0} />)
    expect(screen.getByTestId('survey-screen')).toBeTruthy()
    expect(screen.getByTestId('hulls-placed').textContent).toContain('0')
    expect(screen.queryByTestId('ops-screen')).toBeNull()
  })

  it('should replace the survey with Colony Operations once the mission begins (AC-3.1)', () => {
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    fireEvent.click(screen.getByTestId('begin-mission'))
    expect(screen.getByTestId('ops-screen')).toBeTruthy()
    // REPLACE, not stack. A survey left mounted over a live colony is the "browser back
    // resurrects a stale survey" edge case the phase union exists to make impossible.
    expect(screen.queryByTestId('survey-screen')).toBeNull()
  })

  it('should carry the SURVEYED world into the started colony (★AC-3.2)', () => {
    // The aic-c1p guard at the composition root. A bridge that generated a fresh world on
    // start would render every screen correctly and still be wrong; the only way to catch it
    // is to carry an observable property across the transition.
    render(<App search={SEARCH} random={() => 0} />)
    const surveyedDeposits = screen.getByTestId('deposit-count').textContent
    const surveyedGrid = screen.getByTestId('grid-dimensions').textContent
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    fireEvent.click(screen.getByTestId('begin-mission'))
    expect(screen.getByTestId('deposit-count').textContent).toBe(surveyedDeposits)
    expect(screen.getByTestId('grid-dimensions').textContent).toBe(surveyedGrid)
  })

  it('should advance exactly one turn per End Cycle press (AC-4.1)', () => {
    // Pins that `afterTurnsTaken` is forwarded UNCHANGED. If this file re-derived the token
    // from the latest state, the adapter's stale-token guard would compare a number against
    // itself and could never refuse anything.
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    fireEvent.click(screen.getByTestId('begin-mission'))
    expect(screen.getByTestId('turn-readout').textContent).toBe('1 / 278')
    fireEvent.click(screen.getByTestId('end-cycle'))
    expect(screen.getByTestId('turn-readout').textContent).toBe('2 / 278')
  })
})

describe('App — dispatching the landing decision', () => {
  it('should commit a hull when a candidate marker is clicked', () => {
    render(<App search={SEARCH} random={() => 0} />)
    expect(screen.getByTestId('hulls-placed').textContent).toContain('0')
    fireEvent.click(marker(0))
    expect(screen.getByTestId('hulls-placed').textContent).toContain('1')
  })

  it('should score the landing through the sim once both hulls are committed', () => {
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    expect(screen.getByTestId('site-score').textContent).toMatch(/^\d+\.\d$/)
    expect(screen.getByTestId<HTMLButtonElement>('begin-mission').disabled).toBe(false)
  })

  it('should produce DIFFERENT scores for different pairs, end to end (★AC-2.2)', () => {
    // The load-bearing property, asserted through the real click path rather than against a
    // fixture: a screen wired to a constant would pass every other test in this file.
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    const first = screen.getByTestId('site-score').textContent

    document.body.innerHTML = ''
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(2))
    const second = screen.getByTestId('site-score').textContent

    expect(first).not.toBe(second)
  })

  it('should surface the sim’s verbatim refusal for the same tile twice (AC-2.3)', () => {
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(0))
    expect(screen.getByTestId('rejection-reason').textContent).toContain('overlapping-hulls')
    // A refused selection is not committed, so the count must not move.
    expect(screen.getByTestId('hulls-placed').textContent).toContain('1')
  })

  it('should refuse to begin a mission that the sim has not called ready', () => {
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    const begin = screen.getByTestId<HTMLButtonElement>('begin-mission')
    expect(begin.disabled).toBe(true)
    fireEvent.click(begin)
    // Belt and braces: even if the click landed, `dispatch` refuses `begin-mission` unless
    // the landing is ready.
    expect(screen.getByTestId('survey-screen')).toBeTruthy()
  })

  it('should return to an empty selection when the landing is re-plotted', () => {
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    fireEvent.click(screen.getByTestId('clear-selection'))
    expect(screen.getByTestId('hulls-placed').textContent).toContain('0')
    expect(screen.getByTestId<HTMLButtonElement>('begin-mission').disabled).toBe(true)
  })

  it('should keep the SAME surveyed world across a re-plot (the aic-c1p guard)', () => {
    // A re-plot that re-rolled the world would be deep-equal and visually identical. The
    // adapter pins the object identity; this pins that the screen the player is looking at
    // still describes the same world after the reset.
    render(<App search={SEARCH} random={() => 0} />)
    const deposits = screen.getByTestId('deposit-count').textContent
    const grid = screen.getByTestId('grid-dimensions').textContent
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    fireEvent.click(screen.getByTestId('clear-selection'))
    expect(screen.getByTestId('deposit-count').textContent).toBe(deposits)
    expect(screen.getByTestId('grid-dimensions').textContent).toBe(grid)
  })

  it('should let a re-plotted landing be scored again, and identically', () => {
    // Determinism through the UI: the same pair on the same world must score the same after a
    // reset. A screen holding any state of its own would be the thing that broke this.
    render(<App search={SEARCH} random={() => 0} />)
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    const before = screen.getByTestId('site-score').textContent
    fireEvent.click(screen.getByTestId('clear-selection'))
    fireEvent.click(marker(0))
    fireEvent.click(marker(1))
    expect(screen.getByTestId('site-score').textContent).toBe(before)
  })
})

describe('App — pinning the seed into the URL', () => {
  it('should leave a URL that already carries a valid seed untouched', () => {
    window.history.replaceState(null, '', `/${SEARCH}`)
    render(<App search={SEARCH} random={() => 0} />)
    expect(window.location.search).toBe(SEARCH)
  })

  it('should write a generated seed into the URL, so reload is a retry not a reroll', () => {
    window.history.replaceState(null, '', '/')
    render(<App search="" random={() => 0.5} />)
    const expected = screen.getByTestId('seed-readout').textContent
    expect(expected).not.toBe('')
    expect(window.location.search).toBe(`?seed=${expected}`)
  })

  it('should pin a seed the URL claimed but malformed', () => {
    window.history.replaceState(null, '', '/?seed=nope')
    render(<App search="?seed=nope" random={() => 0.25} />)
    const shown = screen.getByTestId('seed-readout').textContent
    expect(window.location.search).toBe(`?seed=${shown}`)
  })

  it('should pin a URL whose seed reproduces the world actually on screen', () => {
    window.history.replaceState(null, '', '/')
    render(<App search="" random={() => 0.75} />)
    const pinnedSeed = new URLSearchParams(window.location.search).get('seed')
    expect(pinnedSeed).toBe(screen.getByTestId('seed-readout').textContent)
  })
})
