// @vitest-environment jsdom
/**
 * The Surface Survey screen, at unit level.
 *
 * WHAT THIS FILE IS FOR, given `tests/acceptance/playable-start.spec.ts` is the definition
 * of done. The acceptance suite is the only thing that can answer "can a person start this
 * game", and it takes a minute per run in a real browser. This file pins the same contract
 * in milliseconds so a broken testid, a control that is enabled when it must not be, or a
 * score readout wired to the wrong field fails locally instead of in a browser run — and it
 * localises the failure to a component rather than to a click in a flow.
 *
 * It deliberately asserts the ACCEPTANCE CONTRACT's testids by name. They are the contract
 * (see that spec's header); duplicating them here is what makes a rename fail twice, which
 * is the correct number of times for a rename that would break the definition of done.
 *
 * STATE COMES FROM THE ADAPTER, NEVER FROM A HAND-BUILT LITERAL. Every fixture below is
 * built by `beginSurvey` and driven by `dispatch`, so the component is exercised against the
 * real `SurveyingState` shapes a player can actually produce. A hand-written state object
 * would let this file pass while the screen mis-read a field the sim actually populates
 * differently — which is `aic-c1p`'s failure mode reproduced in a test.
 *
 * Note that `.tsx` is excluded from the coverage gate (see `vitest.config.ts`), so nothing
 * here is chasing a coverage number. Every assertion is here because it can catch something.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SurveyScreen } from '../../src/app/screens/SurveyScreen'
import { candidateSites, candidateTestId } from '../../src/app/screens/candidate-sites'
import { PENDING_READOUT } from '../../src/app/screens/survey-readouts'
import { MAP_DIMENSION, beginSurvey, dispatch } from '../../src/app/state/game-state'
import { createGrid } from '../../src/sim/grid'
import type { SurveyingState } from '../../src/app/state/game-state'
import { formatDepositCount, formatGridDimensions } from '../../src/app/world-readouts'

const SEED = 20260730

/** The lattice the screen will offer for the ratified map, in the order it offers it. */
const LATTICE = candidateSites(createGrid(MAP_DIMENSION, MAP_DIMENSION))

/** The opening state: a surveyed world, nothing committed. */
function surveying(): SurveyingState {
  return beginSurvey({ seed: SEED })
}

/**
 * Drive the real adapter through `n` candidate selections, using the same lattice the screen
 * renders — so the fixtures are exactly the states a player's clicks produce.
 */
function afterSelecting(...latticeIndexes: readonly number[]): SurveyingState {
  let state: SurveyingState = surveying()
  for (const index of latticeIndexes) {
    const site = LATTICE[index]
    if (site === undefined) throw new Error(`No candidate at lattice index ${index}`)
    const next = dispatch(state, { kind: 'select-site', anchor: site.anchor })
    if (next.phase !== 'surveying') throw new Error('select-site must not leave the survey phase')
    state = next
  }
  return state
}

function renderScreen(state: SurveyingState): {
  onSelectSite: ReturnType<typeof vi.fn>
  onClearSelection: ReturnType<typeof vi.fn>
  onBeginMission: ReturnType<typeof vi.fn>
} {
  const onSelectSite = vi.fn()
  const onClearSelection = vi.fn()
  const onBeginMission = vi.fn()
  render(
    <SurveyScreen
      state={state}
      onSelectSite={onSelectSite}
      onClearSelection={onClearSelection}
      onBeginMission={onBeginMission}
    />,
  )
  return { onSelectSite, onClearSelection, onBeginMission }
}

afterEach(() => {
  // No global cleanup file is configured, so each render is isolated by hand — otherwise a
  // second render would leave two survey screens in the document and `getByTestId` would
  // throw on the duplicate.
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// US1 — what the screen shows before the player does anything
// ---------------------------------------------------------------------------

describe('SurveyScreen — the surveyed world (US1)', () => {
  it('should render the survey screen container and the terrain canvas', () => {
    renderScreen(surveying())
    expect(screen.getByTestId('survey-screen')).toBeTruthy()
    expect(screen.getByTestId('terrain-canvas')).toBeTruthy()
  })

  it('should show the seed as the readout’s entire text (FR-005)', () => {
    renderScreen(surveying())
    expect(screen.getByTestId('seed-readout').textContent).toBe(String(SEED))
  })

  it('should show the deposit count as exactly the shared formatter’s string (★AC-3.2)', () => {
    const state = surveying()
    renderScreen(state)
    // Exact, not `toContain`: ★AC-3.2 compares this element across the phase change with
    // Playwright's `toHaveText`, which is whole-text equality. A label inside this element
    // would fail there and nowhere else.
    expect(screen.getByTestId('deposit-count').textContent).toBe(formatDepositCount(state.world))
  })

  it('should show the grid dimensions as exactly the shared formatter’s string (★AC-3.2)', () => {
    const state = surveying()
    renderScreen(state)
    expect(screen.getByTestId('grid-dimensions').textContent).toBe(
      formatGridDimensions(state.world.grid),
    )
  })

  it('should not render an empty deposit count, which would make ★AC-3.2 vacuous', () => {
    renderScreen(surveying())
    expect(screen.getByTestId('deposit-count').textContent).not.toBe('')
  })
})

// ---------------------------------------------------------------------------
// The candidate lattice
// ---------------------------------------------------------------------------

describe('SurveyScreen — candidate touchdown points', () => {
  it('should offer one marker per lattice site, with the contract testid', () => {
    renderScreen(surveying())
    for (const site of LATTICE) {
      expect(screen.getByTestId(candidateTestId(site.anchor))).toBeTruthy()
    }
  })

  it('should render the markers in the lattice’s own row-major order', () => {
    // The acceptance suite selects candidates POSITIONALLY (`nth(0)`, `nth(2)`), so DOM
    // order is part of the contract, not an implementation detail.
    renderScreen(surveying())
    const rendered = [...document.querySelectorAll('[data-testid^="candidate-site"]')].map((el) =>
      el.getAttribute('data-testid'),
    )
    expect(rendered).toEqual(LATTICE.map((site) => candidateTestId(site.anchor)))
  })

  it('should leave the FIRST marker enabled, because AC-2.1 and AC-2.4 click it unfiltered', () => {
    // Those two tests use `[data-testid^="candidate-site"]` with NO `:not([disabled])`
    // filter and click `.first()`. A disabled first marker would hang them on a click that
    // can never land.
    renderScreen(surveying())
    const first = document.querySelector('[data-testid^="candidate-site"]')
    expect(first).toBeInstanceOf(HTMLButtonElement)
    expect(first?.hasAttribute('disabled')).toBe(false)
  })

  it('should enable every marker on the ratified map, where no footprint hangs off the edge', () => {
    renderScreen(surveying())
    const disabled = [...document.querySelectorAll('[data-testid^="candidate-site"]')].filter(
      (el) => el.hasAttribute('disabled'),
    )
    expect(disabled).toEqual([])
  })

  it('should dispatch the clicked candidate’s own anchor, not a recomputed one', () => {
    const { onSelectSite } = renderScreen(surveying())
    const target = LATTICE[5]
    if (target === undefined) throw new Error('lattice too small for this test')
    screen.getByTestId(candidateTestId(target.anchor)).click()
    expect(onSelectSite).toHaveBeenCalledWith(target.anchor)
  })

  it('should keep an already-chosen candidate clickable, so AC-2.3 can refuse it', () => {
    // AC-2.3 clicks one candidate TWICE to provoke `overlapping-hulls`. If the first click
    // disabled that marker, the suite's `:not([disabled])` locator would silently resolve
    // `nth(0)` to a DIFFERENT marker and the second click would be a legal placement.
    const state = afterSelecting(0)
    const { onSelectSite } = renderScreen(state)
    const marker = screen.getByTestId(candidateTestId(LATTICE[0]?.anchor ?? { x: 0, y: 0 }))
    expect(marker.hasAttribute('disabled')).toBe(false)
    marker.click()
    expect(onSelectSite).toHaveBeenCalledTimes(1)
  })

  it('should mark the chosen candidate as the hull that occupies it', () => {
    renderScreen(afterSelecting(0))
    const marker = screen.getByTestId(candidateTestId(LATTICE[0]?.anchor ?? { x: 0, y: 0 }))
    expect(marker.getAttribute('aria-pressed')).toBe('true')
    expect(marker.getAttribute('aria-label')).toMatch(/drone hull/)
  })

  it('should make every candidate inert once both hulls are committed', () => {
    // `withNextHull` returns null with both slots full, so a further `select-site` is a no-op
    // in the adapter. A live control that silently does nothing is worse than a disabled one
    // that explains itself — and the explicit `clear-selection` control below is what keeps
    // this a completed state rather than a dead end.
    renderScreen(afterSelecting(0, 1))
    const markers = [...document.querySelectorAll('[data-testid^="candidate-site"]')]
    expect(markers.every((el) => el.hasAttribute('disabled'))).toBe(true)
  })

  it('should say on screen why the candidates are locked, not merely disable them', () => {
    renderScreen(afterSelecting(0, 1))
    expect(screen.getByTestId('survey-screen').textContent).toMatch(/locked/i)
  })

  it('should offer an out-of-bounds candidate disabled rather than clickable', () => {
    // `evaluateLanding` cannot refuse a single anchor, so an illegal FIRST anchor would be
    // accepted and only surface on the second click, blamed on the wrong hull. Never
    // offering it is the fix.
    const state = beginSurvey({ seed: SEED, dimension: 12 })
    const { onSelectSite } = renderScreen(state)
    const illegal = candidateSites(state.world.grid).filter((site) => !site.legal)
    expect(illegal.length).toBeGreaterThan(0)
    for (const site of illegal) {
      const marker = screen.getByTestId(candidateTestId(site.anchor))
      expect(marker.hasAttribute('disabled')).toBe(true)
    }
    expect(onSelectSite).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// US2 — the score, the refusals, and the begin control
// ---------------------------------------------------------------------------

describe('SurveyScreen — the landing assessment (US2)', () => {
  it('should render all four score readouts non-empty after a single selection (AC-2.1)', () => {
    renderScreen(afterSelecting(0))
    for (const id of [
      'site-score',
      'score-buildability',
      'score-deposit-proximity',
      'score-hull-separation',
    ]) {
      expect(screen.getByTestId(id).textContent).not.toBe('')
    }
  })

  it('should show the pending placeholder, not a fabricated number, for one hull', () => {
    renderScreen(afterSelecting(0))
    expect(screen.getByTestId('site-score').textContent).toBe(PENDING_READOUT)
  })

  it('should show the sim’s own total once both hulls are committed', () => {
    const state = afterSelecting(0, 1)
    if (state.readiness.status !== 'ready') throw new Error('fixture should be ready')
    renderScreen(state)
    expect(screen.getByTestId('site-score').textContent).toBe(
      state.readiness.breakdown.total.toFixed(1),
    )
  })

  it('should show DIFFERENT totals for two different pairs — the ★AC-2.2 property', () => {
    // The load-bearing assertion of the whole story, pinned here too: a constant or
    // hardcoded score satisfies every other test in this file.
    const pairA = afterSelecting(0, 1)
    renderScreen(pairA)
    const scoreA = screen.getByTestId('site-score').textContent
    document.body.innerHTML = ''

    const pairB = afterSelecting(0, 2)
    renderScreen(pairB)
    const scoreB = screen.getByTestId('site-score').textContent

    expect(scoreA).not.toBe(scoreB)
  })

  it('should render each score component from its own breakdown field', () => {
    const state = afterSelecting(0, 1)
    if (state.readiness.status !== 'ready') throw new Error('fixture should be ready')
    const { breakdown } = state.readiness
    renderScreen(state)
    // Read against the sim's values, not against literals: a screen that showed
    // `depositProximity` in the buildability slot would pass a literal-based assertion
    // written from the same mistake.
    expect(screen.getByTestId('score-buildability').textContent).toBe(
      `${(breakdown.buildability * 100).toFixed(0)}%`,
    )
    expect(screen.getByTestId('score-deposit-proximity').textContent).toBe(
      `${(breakdown.depositProximity * 100).toFixed(0)}%`,
    )
    expect(screen.getByTestId('score-hull-separation').textContent).toBe(
      `${(breakdown.hullSeparationPenalty * 100).toFixed(0)}%`,
    )
  })

  it('should report zero hulls placed before any selection (AC-2.4)', () => {
    renderScreen(surveying())
    expect(screen.getByTestId('hulls-placed').textContent).toContain('0')
  })

  it('should report one hull placed after one selection (AC-2.4)', () => {
    renderScreen(afterSelecting(0))
    expect(screen.getByTestId('hulls-placed').textContent).toContain('1')
  })

  it('should disable Begin Mission until the sim calls the landing ready (AC-2.4)', () => {
    renderScreen(surveying())
    expect(screen.getByTestId<HTMLButtonElement>('begin-mission').disabled).toBe(true)
  })

  it('should keep Begin Mission disabled with only one hull down (AC-2.4)', () => {
    renderScreen(afterSelecting(0))
    expect(screen.getByTestId<HTMLButtonElement>('begin-mission').disabled).toBe(true)
  })

  it('should say which hulls are still missing while Begin Mission is disabled (AC-2.4)', () => {
    renderScreen(afterSelecting(0))
    expect(screen.getByTestId('survey-screen').textContent).toContain('reactor hull')
  })

  it('should enable Begin Mission and forward the intent once the landing is ready', () => {
    const state = afterSelecting(0, 1)
    if (state.readiness.status !== 'ready') throw new Error('fixture should be ready')
    const { onBeginMission } = renderScreen(state)
    const begin = screen.getByTestId<HTMLButtonElement>('begin-mission')
    expect(begin.disabled).toBe(false)
    begin.click()
    expect(onBeginMission).toHaveBeenCalledTimes(1)
  })

  it('should not render a rejection panel when nothing has been refused', () => {
    renderScreen(afterSelecting(0))
    expect(screen.queryByTestId('rejection-reason')).toBeNull()
  })

  it('should surface the sim’s typed reason VERBATIM when a site is refused (FR-006)', () => {
    // Same tile twice: the reachable refusal, and the one AC-2.3 provokes.
    const state = afterSelecting(0, 0)
    expect(state.rejection?.reason).toBe('overlapping-hulls')
    renderScreen(state)
    expect(screen.getByTestId('rejection-reason').textContent).toContain('overlapping-hulls')
  })

  it('should still report one hull placed after a refusal (AC-2.3)', () => {
    // A refused selection is not committed, so the count must not move.
    renderScreen(afterSelecting(0, 0))
    expect(screen.getByTestId('hulls-placed').textContent).toContain('1')
  })

  it('should point at the offending tile alongside the verbatim reason', () => {
    renderScreen(afterSelecting(0, 0))
    const panel = screen.getByTestId('rejection-reason').textContent
    const anchor = LATTICE[0]?.anchor
    if (anchor === undefined) throw new Error('lattice too small for this test')
    expect(panel).toContain(`(${anchor.x}, ${anchor.y})`)
  })

  it('should keep the score pending while a refusal stands, never showing a stale total', () => {
    renderScreen(afterSelecting(0, 0))
    expect(screen.getByTestId('site-score').textContent).toBe(PENDING_READOUT)
  })
})

// ---------------------------------------------------------------------------
// Re-plotting: the escape hatch that makes the committed selection recoverable
// ---------------------------------------------------------------------------

describe('SurveyScreen — re-plotting a committed landing', () => {
  it('should not offer a reset before anything has been committed', () => {
    // Nothing to undo, so no control: an enabled reset over an empty selection is noise, and
    // a disabled one is worse — it advertises a capability the player cannot use or need.
    renderScreen(surveying())
    expect(screen.queryByTestId('clear-selection')).toBeNull()
  })

  it('should offer a reset as soon as ONE hull is committed', () => {
    // A first anchor is as committed, and as regrettable, as a second.
    renderScreen(afterSelecting(0))
    expect(screen.getByTestId('clear-selection')).toBeTruthy()
  })

  it('should offer a reset once both hulls are committed and the markers have locked', () => {
    renderScreen(afterSelecting(0, 1))
    expect(screen.getByTestId('clear-selection')).toBeTruthy()
  })

  it('should offer a reset while a refusal stands', () => {
    renderScreen(afterSelecting(0, 0))
    expect(screen.getByTestId('clear-selection')).toBeTruthy()
  })

  it('should forward exactly one clear-selection intent per click', () => {
    const { onClearSelection, onSelectSite } = renderScreen(afterSelecting(0, 1))
    screen.getByTestId('clear-selection').click()
    expect(onClearSelection).toHaveBeenCalledTimes(1)
    // Resetting is not a selection: a reset that also placed a hull would silently spend the
    // player's first click of the new attempt.
    expect(onSelectSite).not.toHaveBeenCalled()
  })

  it('should return to the opening state after the adapter clears the selection', () => {
    // Driven through the real adapter, so this pins the screen against the state
    // `clear-selection` actually produces rather than one written by hand.
    const cleared = dispatch(afterSelecting(0, 1), { kind: 'clear-selection' })
    if (cleared.phase !== 'surveying') throw new Error('clear-selection must stay in survey')
    renderScreen(cleared)
    expect(screen.getByTestId('hulls-placed').textContent).toContain('0')
    expect(screen.getByTestId('site-score').textContent).toBe(PENDING_READOUT)
    expect(screen.getByTestId<HTMLButtonElement>('begin-mission').disabled).toBe(true)
    expect(screen.queryByTestId('clear-selection')).toBeNull()
    const markers = [...document.querySelectorAll('[data-testid^="candidate-site"]')]
    expect(markers.some((el) => el.hasAttribute('disabled'))).toBe(false)
  })

  it('should keep showing the SAME surveyed world after a reset (the aic-c1p guard)', () => {
    // A reset that re-rolled the world would be deep-equal and visually identical, so only
    // the readouts that describe the world can catch it at this level — and the adapter pins
    // the object identity itself.
    const before = afterSelecting(0, 1)
    const cleared = dispatch(before, { kind: 'clear-selection' })
    if (cleared.phase !== 'surveying') throw new Error('clear-selection must stay in survey')
    renderScreen(cleared)
    expect(screen.getByTestId('deposit-count').textContent).toBe(formatDepositCount(before.world))
    expect(screen.getByTestId('grid-dimensions').textContent).toBe(
      formatGridDimensions(before.world.grid),
    )
    expect(screen.getByTestId('seed-readout').textContent).toBe(String(SEED))
  })
})
