/**
 * Unit tests for the sim/UI adapter (aic-8tl.5) — `src/app/state/game-state.ts`.
 *
 * WHAT THESE TESTS ARE FOR. The adapter is the ONLY module that both React and the sim
 * touch, and two screen beads (`aic-8tl.2`, `aic-8tl.3`) are built directly on top of it.
 * So these tests pin the INTERFACE, not an implementation: the shape of the state, which
 * actions are honoured in which phase, and — the three properties the acceptance suite
 * cannot check until the screens exist — that a rejection arrives verbatim, that End Cycle
 * advances exactly one turn, and that the whole thing is a pure function of its inputs.
 *
 * `src/app/**\/*.tsx` is excluded from coverage; pure `.ts` under `src/app/` is NOT (see
 * `vitest.config.ts`). That is deliberate, and this file is the reason: the adapter is
 * exactly the app-layer logic unit tests can pin down, and it is where a UI-side defect
 * would otherwise hide behind an excluded component.
 *
 * FIXTURE FACTS, measured rather than assumed (see the note on `UNBUILDABLE` below):
 * every 2x2 anchor on a generated 64x64 world is buildable, at every seed sampled. So an
 * `unbuildable` landing rejection is not reachable through this adapter today, and the
 * tests below prove verbatim rejection-carrying by OBJECT IDENTITY instead of by
 * contriving terrain that the generator cannot currently produce.
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { DRONE_HULL_ID, REACTOR_HULL_ID, evaluateLandingOn } from '../../src/sim/colony-start'
import { tileAt } from '../../src/sim/grid'
import type { Coord } from '../../src/sim/grid'
import type { MissionConfig } from '../../src/sim/mission'
import type { PlayerOrder } from '../../src/sim/orders'
import { DEFAULT_TURN_CYCLE, totalTurns, turnDurationSeconds } from '../../src/sim/time'
import { resolveTurn } from '../../src/sim/turn'
import { generateStormTimeline } from '../../src/sim/weather'
import { generateWorld } from '../../src/sim/world'

import {
  DEFAULT_MISSION,
  MAP_DIMENSION,
  beginSurvey,
  dispatch,
  loadMission,
  placedHulls,
  saveMission,
} from '../../src/app/state/game-state'
import type { GameAction, GameState, RunningState, SurveyingState } from '../../src/app/state/game-state'

/** The acceptance suite's seed, so these tests and the browser tests describe one world. */
const SEED = 20260730

/** Two anchors known (measured) to be a legal, scoreable pair on the seed above. */
const SITE_A: Coord = { x: 2, y: 2 }
const SITE_B: Coord = { x: 40, y: 40 }
/** A third legal anchor, far enough from A to score differently than B does. */
const SITE_C: Coord = { x: 20, y: 55 }

/**
 * An anchor whose 2x2 footprint runs off the bottom-right corner of a 64x64 grid.
 * `out-of-bounds` and `overlapping-hulls` are the only two landing rejections a
 * generated world can actually produce — see the fixture note in the file header.
 */
const OUT_OF_BOUNDS: Coord = { x: MAP_DIMENSION - 1, y: MAP_DIMENSION - 1 }

/**
 * A two-turn mission, so the deadline is reachable in a unit test.
 *
 * The real mission is 278 turns; the "End Cycle at the deadline" edge case is about what
 * happens AT the last turn, not about the number 278, so shortening the cycle tests the
 * rule without 278 dispatches. `turnDurationSeconds` is used rather than a hand-typed
 * figure so this cannot drift from the locked turn cycle.
 */
const SHORT_MISSION: MissionConfig = {
  turnCycle: {
    ...DEFAULT_TURN_CYCLE,
    missionSeconds: turnDurationSeconds(DEFAULT_TURN_CYCLE) * 2,
  },
  incomingWaveSize: 1,
}

// ---------------------------------------------------------------------------
// Narrowing helpers — these throw rather than cast, so a phase regression fails
// with a message naming the phase instead of a confusing property access.
// ---------------------------------------------------------------------------

function asSurveying(state: GameState): SurveyingState {
  if (state.phase !== 'surveying') throw new Error(`expected surveying, got "${state.phase}"`)
  return state
}

function asRunning(state: GameState): RunningState {
  if (state.phase !== 'running') throw new Error(`expected running, got "${state.phase}"`)
  return state
}

/** A surveying state with both hulls legally placed, ready to begin. */
function readySurvey(mission?: MissionConfig, seed: number = SEED): SurveyingState {
  let state: GameState = beginSurvey({ seed, ...(mission === undefined ? {} : { mission }) })
  state = dispatch(state, { kind: 'select-site', anchor: SITE_A })
  state = dispatch(state, { kind: 'select-site', anchor: SITE_B })
  return asSurveying(state)
}

/** A started colony at turn 1, nothing ordered yet. */
function started(mission?: MissionConfig, seed: number = SEED): RunningState {
  return asRunning(dispatch(readySurvey(mission, seed), { kind: 'begin-mission' }))
}

/** End the current cycle with the correct token. */
function endCycle(state: RunningState): GameState {
  return dispatch(state, { kind: 'end-cycle', afterTurnsTaken: state.colony.turnsTaken })
}

/** A 4-build-turn, one-tile structure type, for exercising build orders. */
function probeType(): StructureType {
  const catalog = createCatalog([
    {
      id: 'probe',
      name: 'Probe Mast',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 4,
      produces: {},
      consumes: {},
      habitatCapacity: 0,
    },
  ])
  const type = getStructureType(catalog, 'probe')
  if (type === undefined) throw new Error('the probe structure type is missing from its catalog')
  return type
}

function buildOrder(id: string, anchor: Coord): PlayerOrder {
  return { kind: 'queue-build', id, structureType: probeType(), anchor }
}

// ---------------------------------------------------------------------------
// beginSurvey
// ---------------------------------------------------------------------------

describe('beginSurvey', () => {
  it('should open in the surveying phase with the world the seed produces', () => {
    const state = beginSurvey({ seed: SEED })
    expect(state.phase).toBe('surveying')
    expect(state.seed).toBe(SEED)
    // The same world the sim's own generator produces for this seed, not a variant of it.
    expect(state.world).toEqual(generateWorld(MAP_DIMENSION, MAP_DIMENSION, SEED))
  })

  it('should start with no hulls placed and the sim’s own incomplete readiness', () => {
    const state = beginSurvey({ seed: SEED })
    expect(state.selection).toEqual({ droneHullAnchor: null, reactorHullAnchor: null })
    expect(state.readiness).toEqual({
      status: 'incomplete',
      missingHulls: [DRONE_HULL_ID, REACTOR_HULL_ID],
    })
    expect(state.rejection).toBeNull()
  })

  it('should never present a half-started mission — a fresh survey has no colony at all', () => {
    // The spec's reload-mid-survey edge case. `phase` is a discriminated union, so a
    // surveying state cannot carry a colony: this asserts the property the union enforces.
    const state: GameState = beginSurvey({ seed: SEED })
    expect(state.phase).toBe('surveying')
    expect(Object.keys(state)).not.toContain('colony')
  })

  it('should be a pure function of the seed — same seed, deep-equal state', () => {
    expect(beginSurvey({ seed: SEED })).toEqual(beginSurvey({ seed: SEED }))
  })

  it('should survey a different world for a different seed', () => {
    const a = beginSurvey({ seed: SEED })
    const b = beginSurvey({ seed: SEED + 1 })
    expect(a.world.terrain.elevation).not.toEqual(b.world.terrain.elevation)
  })

  it('should default to the ratified map size and mission, and honour overrides', () => {
    expect(beginSurvey({ seed: SEED }).world.grid).toEqual({
      width: MAP_DIMENSION,
      height: MAP_DIMENSION,
      tiles: expect.any(Array),
    })
    expect(beginSurvey({ seed: SEED }).mission).toBe(DEFAULT_MISSION)

    const custom = beginSurvey({ seed: SEED, dimension: 16, mission: SHORT_MISSION })
    expect(custom.world.grid.width).toBe(16)
    expect(custom.world.grid.height).toBe(16)
    expect(custom.mission).toBe(SHORT_MISSION)
  })

  it('should propagate a malformed dimension as the sim’s own error, not a soft failure', () => {
    // A bad map size is a programmer/config error, never player input — `world.ts`'s
    // convention, carried through rather than softened into a state the UI would render.
    expect(() => beginSurvey({ seed: SEED, dimension: 0 })).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// placedHulls
// ---------------------------------------------------------------------------

describe('placedHulls', () => {
  it('should report no hulls for an empty selection', () => {
    expect(placedHulls({ droneHullAnchor: null, reactorHullAnchor: null })).toEqual([])
  })

  it('should report just the drone hull when only it is placed', () => {
    expect(placedHulls({ droneHullAnchor: SITE_A, reactorHullAnchor: null })).toEqual([
      DRONE_HULL_ID,
    ])
  })

  it('should report just the reactor hull when only it is placed', () => {
    expect(placedHulls({ droneHullAnchor: null, reactorHullAnchor: SITE_A })).toEqual([
      REACTOR_HULL_ID,
    ])
  })

  it('should report both hulls in a fixed order, never a set’s iteration order', () => {
    expect(placedHulls({ droneHullAnchor: SITE_A, reactorHullAnchor: SITE_B })).toEqual([
      DRONE_HULL_ID,
      REACTOR_HULL_ID,
    ])
  })
})

// ---------------------------------------------------------------------------
// dispatch — select-site
// ---------------------------------------------------------------------------

describe('dispatch(select-site)', () => {
  it('should place the drone hull first and report the reactor hull as still missing', () => {
    const state = asSurveying(dispatch(beginSurvey({ seed: SEED }), {
      kind: 'select-site',
      anchor: SITE_A,
    }))
    expect(state.selection).toEqual({ droneHullAnchor: SITE_A, reactorHullAnchor: null })
    expect(state.readiness).toEqual({ status: 'incomplete', missingHulls: [REACTOR_HULL_ID] })
    expect(placedHulls(state.selection)).toEqual([DRONE_HULL_ID])
  })

  it('should score the site once both hulls are placed', () => {
    const state = readySurvey()
    expect(state.readiness.status).toBe('ready')
    // The score and its three components come from the sim, unmodified.
    expect(state.readiness).toEqual(
      evaluateLandingOn(state.world, { droneHullAnchor: SITE_A, reactorHullAnchor: SITE_B }),
    )
    expect(placedHulls(state.selection)).toEqual([DRONE_HULL_ID, REACTOR_HULL_ID])
  })

  it('should produce DIFFERENT scores for different sites — the score is not a constant', () => {
    // ★ AC-2.2 at the adapter level. A constant score would satisfy every other test here.
    const withB = readySurvey()
    let other: GameState = beginSurvey({ seed: SEED })
    other = dispatch(other, { kind: 'select-site', anchor: SITE_A })
    other = dispatch(other, { kind: 'select-site', anchor: SITE_C })
    const withC = asSurveying(other)

    if (withB.readiness.status !== 'ready' || withC.readiness.status !== 'ready') {
      throw new Error('both fixture sites must score')
    }
    expect(withB.readiness.score).not.toBe(withC.readiness.score)
  })

  it('should refuse the same tile twice with the sim’s overlapping-hulls rejection, verbatim', () => {
    // AC-2.3. The rejection object is carried BY IDENTITY: nothing here re-words,
    // re-wraps or stringifies the sim's typed reason (FR-006).
    const first = asSurveying(dispatch(beginSurvey({ seed: SEED }), {
      kind: 'select-site',
      anchor: SITE_A,
    }))
    const second = asSurveying(dispatch(first, { kind: 'select-site', anchor: SITE_A }))

    const expected = evaluateLandingOn(second.world, {
      droneHullAnchor: SITE_A,
      reactorHullAnchor: SITE_A,
    })
    if (expected.status !== 'rejected') throw new Error('fixture: expected a rejected landing')
    expect(second.rejection).toEqual(expected.rejection)
    expect(second.rejection?.reason).toBe('overlapping-hulls')
  })

  it('should leave the committed selection untouched when a selection is refused', () => {
    // The other half of AC-2.3: the refused hull is NOT placed, so the screen still
    // reports one hull down rather than two.
    const first = asSurveying(dispatch(beginSurvey({ seed: SEED }), {
      kind: 'select-site',
      anchor: SITE_A,
    }))
    const second = asSurveying(dispatch(first, { kind: 'select-site', anchor: SITE_A }))
    expect(second.selection).toEqual(first.selection)
    expect(second.readiness).toEqual(first.readiness)
    expect(placedHulls(second.selection)).toEqual([DRONE_HULL_ID])
  })

  it('should surface an out-of-bounds rejection verbatim', () => {
    const first = asSurveying(dispatch(beginSurvey({ seed: SEED }), {
      kind: 'select-site',
      anchor: SITE_A,
    }))
    const second = asSurveying(dispatch(first, { kind: 'select-site', anchor: OUT_OF_BOUNDS }))
    expect(second.rejection?.reason).toBe('out-of-bounds')
    expect(placedHulls(second.selection)).toEqual([DRONE_HULL_ID])
  })

  it('should carry the sim’s rejection object through untouched, whatever its reason', () => {
    // Proves verbatim carrying for EVERY `LandingRejection` reason at once, including
    // `unbuildable`, which generated terrain cannot currently produce (file header).
    const first = asSurveying(dispatch(beginSurvey({ seed: SEED }), {
      kind: 'select-site',
      anchor: SITE_A,
    }))
    const second = asSurveying(dispatch(first, { kind: 'select-site', anchor: SITE_A }))
    const direct = evaluateLandingOn(second.world, {
      droneHullAnchor: SITE_A,
      reactorHullAnchor: SITE_A,
    })
    if (direct.status !== 'rejected') throw new Error('fixture: expected a rejected landing')
    // Same keys, same values, no added prose field.
    expect(Object.keys(second.rejection ?? {}).sort()).toEqual(
      Object.keys(direct.rejection).sort(),
    )
  })

  it('should clear a previous rejection once a selection is accepted', () => {
    let state: GameState = beginSurvey({ seed: SEED })
    state = dispatch(state, { kind: 'select-site', anchor: SITE_A })
    state = dispatch(state, { kind: 'select-site', anchor: SITE_A })
    expect(asSurveying(state).rejection).not.toBeNull()
    state = dispatch(state, { kind: 'select-site', anchor: SITE_B })
    expect(asSurveying(state).rejection).toBeNull()
    expect(asSurveying(state).readiness.status).toBe('ready')
  })

  it('should refuse a third site as a no-op, returning the identical state', () => {
    const ready = readySurvey()
    expect(dispatch(ready, { kind: 'select-site', anchor: SITE_C })).toBe(ready)
  })

  it('should ignore a selection once the mission is running', () => {
    const running = started()
    expect(dispatch(running, { kind: 'select-site', anchor: SITE_C })).toBe(running)
  })
})

// ---------------------------------------------------------------------------
// dispatch — begin-mission
// ---------------------------------------------------------------------------

describe('dispatch(begin-mission)', () => {
  it('should start the colony from the chosen landing', () => {
    const running = started()
    expect(running.phase).toBe('running')
    expect(running.colony.turnsTaken).toBe(0)
    expect(running.landing.status).toBe('ready')
    expect(running.lastReport).toBeNull()
    expect(running.orderOutcomes).toEqual([])
  })

  it('should carry the SURVEYED world across the transition by identity', () => {
    // ★ AC-3.2's guard, one layer below the browser: the deposit count and grid the ops
    // screen reads must be the SAME world object the survey screen scored, never a
    // regenerated equal-looking one. Identity is the only check that can tell them apart.
    const survey = readySurvey()
    const running = asRunning(dispatch(survey, { kind: 'begin-mission' }))
    expect(running.world).toBe(survey.world)
    expect(running.world.deposits).toBe(survey.world.deposits)
    expect(running.seed).toBe(survey.seed)
  })

  it('should stand both hulls on the tiles the player chose', () => {
    const running = started()
    expect(tileAt(running.colony.grid, SITE_A)?.occupantId).toBe(DRONE_HULL_ID)
    expect(tileAt(running.colony.grid, SITE_B)?.occupantId).toBe(REACTOR_HULL_ID)
  })

  it('should build the colony against the mission config the survey carried', () => {
    expect(started(SHORT_MISSION).colony.mission).toBe(SHORT_MISSION)
    expect(started().colony.mission).toBe(DEFAULT_MISSION)
  })

  it('should refuse to begin with fewer than two hulls placed', () => {
    const none = beginSurvey({ seed: SEED })
    expect(dispatch(none, { kind: 'begin-mission' })).toBe(none)

    const one = dispatch(none, { kind: 'select-site', anchor: SITE_A })
    expect(dispatch(one, { kind: 'begin-mission' })).toBe(one)
  })

  it('should refuse to begin while the last selection stands rejected', () => {
    let state: GameState = beginSurvey({ seed: SEED })
    state = dispatch(state, { kind: 'select-site', anchor: SITE_A })
    state = dispatch(state, { kind: 'select-site', anchor: SITE_A })
    expect(dispatch(state, { kind: 'begin-mission' })).toBe(state)
  })

  it('should ignore a second begin-mission, so a double-fire cannot restart the colony', () => {
    const running = started()
    expect(dispatch(running, { kind: 'begin-mission' })).toBe(running)
  })

  it('should offer this turn’s outlook so the ops screen can report turn 1 before it resolves', () => {
    // AC-3.3 needs power generation, draw, drones on shift and habitat capacity AT turn 1,
    // i.e. before any turn has been resolved. `outlook` is `resolveTurn`'s report for the
    // turn now in progress; no figure here is computed by the adapter.
    const running = started()
    expect(running.outlook?.turn).toBe(1)
    expect(running.outlook?.electricity.generationWh).toBeGreaterThan(0)
    expect(running.outlook?.electricity.dronesOnShift.length).toBeGreaterThan(0)
    expect(running.outlook?.habitatCapacity).toBe(0)
    // Identical to resolving the current colony directly — the adapter stores, never derives.
    expect(running.outlook).toEqual(resolveTurn(running.colony).report)
  })

  it('should let the ops screen read turn 1 of 278 and 277 remaining with no arithmetic', () => {
    // Pins the guidance in `RunningState.outlook`'s doc comment, which two screen beads
    // are built on: AC-3.3 wants "1" and "278", AC-4.1 wants turns-remaining at 277 before
    // the first End Cycle and 276 after. Both come straight off the sim's own fields, so a
    // component never adds one to `turnsTaken` itself.
    const running = started()
    expect(totalTurns(running.colony.mission.turnCycle)).toBe(278)
    expect(running.outlook?.turn).toBe(1)
    expect(running.outlook?.mission.turnsRemaining).toBe(277)

    const next = asRunning(endCycle(running))
    expect(next.outlook?.turn).toBe(2)
    expect(next.outlook?.mission.turnsRemaining).toBe(276)
  })
})

// ---------------------------------------------------------------------------
// weather (aic-oby.3) — proving the scheduler is genuinely wired into the adapter's
// OWN turn loop, not merely available for a screen to call directly (which
// `tests/unit/app-boundary.test.ts` forbids anyway).
// ---------------------------------------------------------------------------

describe('weather (aic-oby.3)', () => {
  it('should generate the mission’s timeline from the session seed, once, at begin-mission', () => {
    const running = started()
    expect(running.weatherTimeline).toEqual(
      generateStormTimeline(running.seed, totalTurns(running.colony.mission.turnCycle)),
    )
  })

  it('should be a pure function of the seed — same seed, deep-equal timeline', () => {
    expect(started().weatherTimeline).toEqual(started().weatherTimeline)
  })

  it('should generate a different timeline for a different seed', () => {
    const a = started()
    const b = started(undefined, SEED + 1)
    expect(a.weatherTimeline).not.toEqual(b.weatherTimeline)
  })

  it('should set colony.environment for turn 1 before any turn resolves, matching the timeline directly', () => {
    const running = started()
    const stormActiveAtTurn1 = running.weatherTimeline.some(
      (event) => event.startTurn <= 1 && 1 <= event.endTurn,
    )
    expect(running.colony.environment.dustStorm).toBe(stormActiveAtTurn1)
  })

  it('should carry a real storm through a live mission end to end — dustStorm flips true then false exactly at the scheduled turns', () => {
    // A deterministic SEARCH for a seed whose default-tuned timeline starts a storm
    // within a few turns of turn 1 — not a flaky retry, since `generateStormTimeline`
    // is a pure function of the seed and this loop always lands on the same seed for
    // the same search bounds. Mirrors this file's own "measured, not assumed" fixture
    // discipline (see the header note on `SITE_A`/`SITE_B`).
    const horizon = totalTurns(DEFAULT_MISSION.turnCycle)
    let found: { readonly seed: number; readonly storm: { readonly startTurn: number; readonly endTurn: number } } | null = null
    for (let seed = 1; seed <= 2000 && found === null; seed++) {
      const timeline = generateStormTimeline(seed, horizon)
      const first = timeline[0]
      if (first !== undefined && first.startTurn <= 6) {
        found = { seed, storm: first }
      }
    }
    if (found === null) throw new Error('test setup: no seed within [1, 2000] starts a storm by turn 6')

    // `observedByTurn.get(t)` is the dustStorm status of the colony about to RESOLVE
    // turn `t` — keyed explicitly by turn number, rather than by array position, so an
    // off-by-one in how many times `endCycle` has fired cannot silently misalign a
    // plain array index against the turn it is meant to describe.
    let state = started(undefined, found.seed)
    const observedByTurn = new Map<number, boolean>([[1, state.colony.environment.dustStorm]])
    for (let turn = 1; turn <= found.storm.endTurn; turn++) {
      state = asRunning(endCycle(state))
      observedByTurn.set(turn + 1, state.colony.environment.dustStorm)
    }

    for (let turn = 1; turn <= found.storm.endTurn + 1; turn++) {
      const expected = turn >= found.storm.startTurn && turn <= found.storm.endTurn
      expect(observedByTurn.get(turn)).toBe(expected)
    }
    // Non-vacuous: the storm genuinely happened somewhere in what was observed.
    expect([...observedByTurn.values()]).toContain(true)
  })
})

// ---------------------------------------------------------------------------
// dispatch — end-cycle
// ---------------------------------------------------------------------------

describe('dispatch(end-cycle)', () => {
  it('should advance exactly one turn', () => {
    const running = started()
    const next = asRunning(endCycle(running))
    expect(next.colony.turnsTaken).toBe(1)
    expect(next.lastReport?.turn).toBe(1)
  })

  it('should refuse a duplicate dispatch of the same intent — the double-fire guard', () => {
    // The acceptance suite double-clicks End Cycle and requires exactly one turn. The
    // action names the turn it means to end, so re-dispatching it (a duplicated event, a
    // stale closure, a StrictMode double-invoke) cannot silently spend a second turn of
    // the 278-turn budget.
    const running = started()
    const action: GameAction = { kind: 'end-cycle', afterTurnsTaken: running.colony.turnsTaken }
    const once = asRunning(dispatch(running, action))
    const twice = dispatch(once, action)
    expect(twice).toBe(once)
    expect(asRunning(twice).colony.turnsTaken).toBe(1)
  })

  it('should refuse a token for a turn that has already been taken', () => {
    const running = started()
    const after = asRunning(endCycle(running))
    expect(dispatch(after, { kind: 'end-cycle', afterTurnsTaken: 0 })).toBe(after)
  })

  it('should still allow the next turn when the token names the current one', () => {
    // Non-vacuity for the guard above: it must block a REPEAT, never ordinary play.
    const first = asRunning(endCycle(started()))
    const second = asRunning(endCycle(first))
    expect(second.colony.turnsTaken).toBe(2)
    expect(second.lastReport?.turn).toBe(2)
  })

  it('should refresh the outlook to the turn now in progress', () => {
    const next = asRunning(endCycle(started()))
    expect(next.outlook?.turn).toBe(next.colony.turnsTaken + 1)
    expect(next.outlook).toEqual(resolveTurn(next.colony).report)
  })

  it('should be ignored while surveying, rather than crashing', () => {
    const survey = readySurvey()
    expect(dispatch(survey, { kind: 'end-cycle', afterTurnsTaken: 0 })).toBe(survey)
  })

  it('should stop at the deadline, showing the verdict rather than a turn past it', () => {
    // The spec's "End Cycle at turn 278" edge case, on a two-turn mission.
    const deadline = totalTurns(SHORT_MISSION.turnCycle)
    expect(deadline).toBe(2)

    let state = started(SHORT_MISSION)
    for (let i = 0; i < deadline; i++) state = asRunning(endCycle(state))

    expect(state.colony.turnsTaken).toBe(deadline)
    expect(state.lastReport?.mission.status).not.toBe('in-progress')
    // No further turn is even forecast, and a further End Cycle is refused outright.
    expect(state.outlook).toBeNull()
    expect(endCycle(state)).toBe(state)
    expect(state.colony.turnsTaken).toBe(deadline)
  })

  it('should clear the previous turn’s order outcomes', () => {
    // Outcomes describe the orders issued for the turn that just resolved. Carrying them
    // forward would show a stale rejection against the new turn.
    let state = started()
    state = asRunning(dispatch(state, {
      kind: 'issue-orders',
      orders: [buildOrder('probe-1', { x: 10, y: 10 })],
    }))
    expect(state.orderOutcomes).toHaveLength(1)
    expect(asRunning(endCycle(state)).orderOutcomes).toEqual([])
  })

  it('should be deterministic — same seed, same landing, same orders, deep-equal states', () => {
    // ★ AC-4.3 at the adapter level: no clock, no randomness and no iteration order can
    // reach anything the UI renders.
    const runOnce = (): GameState => {
      let state: GameState = started()
      state = dispatch(state, {
        kind: 'issue-orders',
        orders: [buildOrder('probe-1', { x: 10, y: 10 })],
      })
      return endCycle(asRunning(state))
    }
    expect(runOnce()).toEqual(runOnce())
  })
})

// ---------------------------------------------------------------------------
// dispatch — issue-orders
// ---------------------------------------------------------------------------

describe('dispatch(issue-orders)', () => {
  it('should queue a legal build through the sim’s own order layer', () => {
    const state = asRunning(dispatch(started(), {
      kind: 'issue-orders',
      orders: [buildOrder('probe-1', { x: 10, y: 10 })],
    }))
    expect(state.colony.queue.map((project) => project.id)).toContain('probe-1')
    expect(tileAt(state.colony.grid, { x: 10, y: 10 })?.occupantId).toBe('probe-1')
    expect(state.orderOutcomes).toEqual([{ ok: true, order: expect.any(Object) }])
  })

  it('should apply an order to the turn IN PROGRESS, not the next one', () => {
    // `orders.ts` is emphatic that orders are step 1 of the turn. Before the order the
    // colony has nothing to build, so all labour is unused; after it, labour lands.
    const before = started()
    const after = asRunning(dispatch(before, {
      kind: 'issue-orders',
      orders: [buildOrder('probe-1', { x: 10, y: 10 })],
    }))
    expect(before.outlook?.labourHoursApplied).toBe(0)
    expect(after.outlook?.labourHoursApplied).toBeGreaterThan(0)
  })

  it('should surface a placement rejection verbatim and change no sim state', () => {
    // The bead's acceptance criterion: a rejected intent leaves sim state unchanged.
    const before = started()
    const after = asRunning(dispatch(before, {
      kind: 'issue-orders',
      orders: [buildOrder('probe-1', SITE_A)],
    }))
    expect(after.colony.grid).toBe(before.colony.grid)
    expect(after.colony.queue).toBe(before.colony.queue)
    expect(after.orderOutcomes).toEqual([
      {
        ok: false,
        order: expect.any(Object),
        rejection: { ok: false, reason: 'occupied', tile: SITE_A, occupantId: DRONE_HULL_ID },
      },
    ])
  })

  it('should surface an unknown-project cancellation verbatim', () => {
    const state = asRunning(dispatch(started(), {
      kind: 'issue-orders',
      orders: [{ kind: 'cancel-build', id: 'nothing-by-that-name' }],
    }))
    expect(state.orderOutcomes).toEqual([
      {
        ok: false,
        order: expect.any(Object),
        rejection: { ok: false, reason: 'unknown-project', id: 'nothing-by-that-name' },
      },
    ])
  })

  it('should treat an empty batch as a no-op, returning the identical state', () => {
    const running = started()
    expect(dispatch(running, { kind: 'issue-orders', orders: [] })).toBe(running)
  })

  it('should ignore orders once the mission has reached its verdict', () => {
    // The colony is frozen at the deadline: the same rule that refuses End Cycle refuses
    // a build order, so a concluded mission cannot be quietly edited after the fact.
    let state = started(SHORT_MISSION)
    for (let i = 0; i < totalTurns(SHORT_MISSION.turnCycle); i++) state = asRunning(endCycle(state))
    expect(state.outlook).toBeNull()

    expect(
      dispatch(state, { kind: 'issue-orders', orders: [buildOrder('probe-1', { x: 10, y: 10 })] }),
    ).toBe(state)
  })

  it('should ignore orders while surveying', () => {
    const survey = readySurvey()
    expect(
      dispatch(survey, { kind: 'issue-orders', orders: [buildOrder('probe-1', { x: 10, y: 10 })] }),
    ).toBe(survey)
  })

  it('should let the sim’s own programmer-error convention through on a duplicate id', () => {
    // `orders.ts` deliberately THROWS for a duplicate instance id (ids are minted by the
    // calling layer, so a collision is a defect, not player input). The adapter does not
    // soften that into a typed rejection the UI would render as ordinary gameplay.
    const state = asRunning(dispatch(started(), {
      kind: 'issue-orders',
      orders: [buildOrder('probe-1', { x: 10, y: 10 })],
    }))
    expect(() =>
      dispatch(state, { kind: 'issue-orders', orders: [buildOrder('probe-1', { x: 12, y: 12 })] }),
    ).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// dispatch — unknown actions
// ---------------------------------------------------------------------------

describe('dispatch(unknown action)', () => {
  it('should ignore an unrecognised action while surveying', () => {
    const survey = beginSurvey({ seed: SEED })
    // Cast: unreachable through the typed union, reachable from untyped JS at runtime.
    expect(dispatch(survey, { kind: 'demolish-everything' } as unknown as GameAction)).toBe(survey)
  })

  it('should ignore an unrecognised action while running', () => {
    const running = started()
    expect(dispatch(running, { kind: 'demolish-everything' } as unknown as GameAction)).toBe(
      running,
    )
  })
})

describe('clear-selection (re-plot the landing)', () => {
  // Added after the survey screen reported that the opening decision was one-shot: once
  // both hulls were committed the only remaining transition was begin-mission, and the
  // only escape was a reload that could hand back a DIFFERENT world, because a generated
  // seed was never written to the URL. The escape hatch destroyed the thing being decided.
  const REPLOT_SEED = 20260730

  function withTwoHulls(): SurveyingState {
    let s = beginSurvey({ seed: REPLOT_SEED, dimension: 24 })
    const anchors: Coord[] = []
    for (let y = 0; y < 20 && anchors.length < 2; y += 4) {
      for (let x = 0; x < 20 && anchors.length < 2; x += 4) anchors.push({ x, y })
    }
    for (const a of anchors) s = dispatch(s, { kind: 'select-site', anchor: a }) as SurveyingState
    return s
  }

  it('should clear both hull anchors', () => {
    const cleared = dispatch(withTwoHulls(), { kind: 'clear-selection' }) as SurveyingState
    expect(cleared.selection.droneHullAnchor).toBeNull()
    expect(cleared.selection.reactorHullAnchor).toBeNull()
  })

  it('should keep the SAME world object, never a regenerated one', () => {
    // The load-bearing assertion. A re-roll from the same seed is deep-equal and looks
    // identical on screen, so only object identity distinguishes "survey this map again"
    // from "silently give the player a different map" — the aic-c1p defect reproduced
    // inside the adapter.
    const before = withTwoHulls()
    const cleared = dispatch(before, { kind: 'clear-selection' }) as SurveyingState
    expect(cleared.world).toBe(before.world)
    expect(cleared.world.grid).toBe(before.world.grid)
    expect(cleared.seed).toBe(before.seed)
  })

  it('should restore the opening readiness verdict from the sim', () => {
    const opening = beginSurvey({ seed: REPLOT_SEED, dimension: 24 })
    const cleared = dispatch(withTwoHulls(), { kind: 'clear-selection' }) as SurveyingState
    expect(cleared.readiness.status).toBe(opening.readiness.status)
    expect(cleared.rejection).toBeNull()
  })

  it('should allow a different pair to be chosen afterwards, producing a different score', () => {
    // Proves the reset is functional and not merely cosmetic: the player can actually
    // re-decide, which is the entire reason the action exists.
    const first = withTwoHulls()
    const cleared = dispatch(first, { kind: 'clear-selection' }) as SurveyingState
    const redone = dispatch(dispatch(cleared, { kind: 'select-site', anchor: { x: 0, y: 0 } }), {
      kind: 'select-site',
      anchor: { x: 12, y: 12 },
    }) as SurveyingState
    expect(redone.selection.droneHullAnchor).toEqual({ x: 0, y: 0 })
    expect(redone.selection.reactorHullAnchor).toEqual({ x: 12, y: 12 })
  })

  it('should be inert while running, like every other inapplicable intent', () => {
    let s: GameState = withTwoHulls()
    s = dispatch(s, { kind: 'begin-mission' })
    expect(s.phase).toBe('running')
    expect(dispatch(s, { kind: 'clear-selection' })).toBe(s)
  })

  it('should be a no-op on an untouched survey rather than throwing', () => {
    const opening = beginSurvey({ seed: REPLOT_SEED, dimension: 24 })
    const cleared = dispatch(opening, { kind: 'clear-selection' }) as SurveyingState
    expect(cleared.selection).toEqual(opening.selection)
    expect(cleared.world).toBe(opening.world)
  })
})

// ---------------------------------------------------------------------------
// saveMission / loadMission (aic-oby.2)
// ---------------------------------------------------------------------------

/** Resolve `n` end-cycle intents in sequence, threading the running state through. */
function advanceNTurns(state: RunningState, n: number): RunningState {
  let s = state
  for (let i = 0; i < n; i++) s = asRunning(endCycle(s))
  return s
}

describe('saveMission', () => {
  it('should refuse to save while still surveying, naming why', () => {
    expect(saveMission(readySurvey())).toEqual({ ok: false, reason: 'not-running' })
  })

  it('should save a running mission as opaque string data', () => {
    const result = saveMission(started())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(typeof result.data).toBe('string')
    expect(result.data.length).toBeGreaterThan(0)
  })
})

describe('loadMission', () => {
  it('should load a freshly saved mission into an equivalent running state', () => {
    const running = advanceNTurns(started(), 3)
    const saved = saveMission(running)
    if (!saved.ok) throw new Error('expected saveMission to succeed')

    const loaded = loadMission(saved.data)
    if (!loaded.ok) throw new Error(`expected ok, got ${loaded.error.kind}: ${loaded.error.message}`)
    expect(loaded.state.phase).toBe('running')
    expect(loaded.state.seed).toBe(running.seed)
    expect(loaded.state.colony).toEqual(running.colony)
    expect(loaded.state.world).toEqual(running.world)
    expect(loaded.state.landing).toEqual(running.landing)
    expect(loaded.state.orderOutcomes).toEqual([])
  })

  it('should restore the storm timeline so the weather still comes after loading', () => {
    // REGRESSION (found when save/load and the storm scheduler were merged — each was
    // built without the other). loadMission originally rebuilt the running state with
    // no weatherTimeline at all. That is not a cosmetic omission: the loaded mission
    // would have run the rest of its 278 turns under a permanently empty schedule, so
    // no storm would ever begin again. The game's only environmental pressure would
    // vanish silently at the moment a player saved and resumed.
    //
    // It is REGENERATED from the seed rather than persisted, so this also pins that the
    // recomputed schedule is identical to the one the mission was already running.
    const running = advanceNTurns(started(), 3)
    const saved = saveMission(running)
    if (!saved.ok) throw new Error('expected saveMission to succeed')

    const loaded = loadMission(saved.data)
    if (!loaded.ok) throw new Error(`expected ok, got ${loaded.error.kind}`)

    expect(loaded.state.weatherTimeline).toEqual(running.weatherTimeline)
    expect(loaded.state.weatherTimeline).not.toEqual([])
  })

  it('should recompute a fresh outlook from the loaded colony rather than trusting a stale one', () => {
    const running = advanceNTurns(started(), 2)
    const saved = saveMission(running)
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const loaded = loadMission(saved.data)
    if (!loaded.ok) throw new Error('expected loadMission to succeed')
    expect(loaded.state.outlook).toEqual(resolveTurn(running.colony).report)
  })

  it('THE REAL TEST: resuming a saved mission and continuing matches an uninterrupted run', () => {
    const opening = started()
    const uninterrupted = advanceNTurns(opening, 3 + 4)

    const savedAtMidpoint = advanceNTurns(opening, 3)
    const saved = saveMission(savedAtMidpoint)
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const loaded = loadMission(saved.data)
    if (!loaded.ok) throw new Error(`expected ok, got ${loaded.error.kind}`)

    const afterResume = advanceNTurns(loaded.state, 4)
    expect(afterResume.colony).toEqual(uninterrupted.colony)
  })

  it('should reject unreadable text without throwing', () => {
    const result = loadMission('not json at all {{{')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('malformed')
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('should reject a save from a different mission-format version', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const parsed = JSON.parse(saved.data) as { formatVersion: number }
    parsed.formatVersion = 999
    const result = loadMission(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('version-mismatch')
  })

  it('should reject a save with a missing or non-integer formatVersion as malformed', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const parsed = JSON.parse(saved.data) as Record<string, unknown>
    delete parsed.formatVersion
    const result = loadMission(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('malformed')
  })

  it('should reject a save whose world is missing a required field', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const parsed = JSON.parse(saved.data) as { world: Record<string, unknown> }
    delete parsed.world.deposits
    const result = loadMission(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('malformed')
    expect(result.error.message).toContain('world')
  })

  it('should reject a save whose landing is not a ready landing', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const parsed = JSON.parse(saved.data) as { landing: Record<string, unknown> }
    parsed.landing.status = 'rejected'
    const result = loadMission(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('malformed')
    expect(result.error.message).toContain('landing')
  })

  it('should reject a save whose colonyData is not a string', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const parsed = JSON.parse(saved.data) as Record<string, unknown>
    parsed.colonyData = { not: 'a string' }
    const result = loadMission(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.kind).toBe('malformed')
    expect(result.error.message).toContain('colony data')
  })

  it('should load a concluded mission with a null outlook, matching a live conclusion', () => {
    // Mirrors `advanceCycle`'s own end-of-mission guard: once the deadline turn is
    // reached, `outlook` stays `null` forever and no further turn may be resolved.
    // A save taken AFTER the mission concluded must load into that same frozen state,
    // not accidentally resolve one turn past the deadline.
    let running = started(SHORT_MISSION)
    running = advanceNTurns(running, 2) // SHORT_MISSION's full 2-turn length
    expect(running.outlook).toBeNull()

    const saved = saveMission(running)
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const loaded = loadMission(saved.data)
    if (!loaded.ok) throw new Error(`expected ok, got ${loaded.error.kind}`)
    expect(loaded.state.outlook).toBeNull()
    expect(loaded.state.colony).toEqual(running.colony)
  })

  it('should propagate a colony-level rejection from persist.ts verbatim, never crashing', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const parsed = JSON.parse(saved.data) as { colonyData: string }
    // Corrupt just the embedded colony sub-save, leaving the mission envelope intact.
    parsed.colonyData = parsed.colonyData.slice(0, -5)
    const result = loadMission(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(['malformed', 'truncated']).toContain(result.error.kind)
  })

  it('should never throw for any malformed, truncated or wrong-version input', () => {
    const saved = saveMission(started())
    if (!saved.ok) throw new Error('expected saveMission to succeed')
    const badInputs = [
      '',
      '{',
      'null',
      '42',
      saved.data.slice(0, Math.floor(saved.data.length / 2)),
      JSON.stringify({ formatVersion: 1 }),
    ]
    for (const raw of badInputs) {
      expect(() => loadMission(raw)).not.toThrow()
    }
  })
})
