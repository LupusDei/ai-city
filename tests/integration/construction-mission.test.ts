/**
 * MANDATORY SEAM TEST (aic-a00.8 / standing rule in .claude/rules/03-testing.md,
 * added after aic-c1p: two modules closed green at 100% coverage and were never
 * wired — one exported a function only its own test imported).
 *
 * This file proves `construction.ts` and `mission.ts` are genuinely CONNECTED,
 * not just two green test suites sitting next to each other. It drives a real
 * habitat structure from queued -> partially built -> complete using ONLY
 * `construction.ts`'s public API (`queueConstruction`, `advanceConstruction`,
 * `toHabitatStructure`), and at each stage feeds the exact structure objects
 * that API produced straight into `evaluateMission` from `mission.ts` — never
 * a hand-built `HabitatStructure` fixture. If a future change to either module
 * silently breaks the adapter between them, this file (not a unit test on
 * either side alone) is what catches it.
 *
 * It also covers the construction <-> placement seam: `queueConstruction`
 * wraps `placement.ts`'s `validatePlacement`/`applyPlacement`, which was
 * changed under aic-a00.13 specifically to stop a validated-but-stale
 * placement from silently vanishing instead of erroring. A queued build that
 * collides with an already-occupied tile must surface a typed rejection here
 * too, not just in construction.ts's own unit tests.
 */
import { describe, it, expect } from 'vitest'
import {
  queueConstruction,
  enqueueProject,
  advanceConstruction,
  toHabitatStructure,
  toResourceFlow,
} from '../../src/sim/construction'
import type { ConstructionQueue } from '../../src/sim/construction'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { createGrid, tileAt } from '../../src/sim/grid'
import { validatePlacement } from '../../src/sim/placement'
import { evaluateMission } from '../../src/sim/mission'
import type { MissionConfig } from '../../src/sim/mission'
import type { TurnCycleConfig } from '../../src/sim/time'

// hoursPerShift = workSeconds / 3600 = 1, so one turn's labour (one drone,
// one shift) == exactly one buildTurn's worth of progress. This keeps
// "drive N turns" and "N labour-hours" the same number, which is what makes
// the 9/10 -> 10/10 transition below readable as a story rather than a pile
// of arithmetic.
const TURN_CYCLE: TurnCycleConfig = {
  workSeconds: 3600,
  rechargeSeconds: 1,
  // Chosen so totalTurns(TURN_CYCLE) is exactly 12: turnDuration = 3601,
  // 12 * 3601 = 43212.
  missionSeconds: 43212,
}
const DEADLINE_TURN = 12

// Real catalog.ts data, not an ad-hoc literal: createCatalog is the project's
// one validation boundary for structure data, so routing this fixture through
// it (rather than typing a bare object as StructureType) proves the seam test
// exercises the same validated shape production code would.
const CATALOG = createCatalog([
  {
    id: 'habitat-basic',
    name: 'Basic Habitat',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 10,
    produces: {},
    consumes: { electricity: 1 },
    habitatCapacity: 4,
  },
])
// A helper (rather than a bare `getStructureType(...)` + narrowing `if`) so
// `HABITAT`'s declared type is `StructureType`, never `StructureType |
// undefined`: TypeScript does not carry a module-scope `if (x === undefined)
// throw` narrowing into functions defined and called later (e.g. the
// `driveToNineTenths` closure below), so leaving `HABITAT` typed as possibly
// `undefined` would force every later use to re-guard it for no real benefit
// -- the catalog lookup either succeeds once, here, or the whole file fails
// fast at import time.
function requireStructureType(id: string): StructureType {
  const type = getStructureType(CATALOG, id)
  if (type === undefined) throw new Error(`fixture catalog missing structure type: "${id}"`)
  return type
}
const HABITAT = requireStructureType('habitat-basic')

const MISSION_CONFIG: MissionConfig = { turnCycle: TURN_CYCLE, incomingWaveSize: 4 }

describe('construction -> mission seam', () => {
  it('should drive a habitat from queued through 9/10 (zero capacity, lost) to 10/10 (full capacity, won), using only construction-produced structures', () => {
    const grid = createGrid(3, 3)

    const queued = queueConstruction(grid, 'hab-1', HABITAT, { x: 1, y: 1 })
    expect(queued.ok).toBe(true)
    if (!queued.ok) return

    let queue: ConstructionQueue = enqueueProject([], queued.project)

    // Apply nine turns of one drone-shift's labour (1 hour == 1 buildTurn here).
    for (let turn = 0; turn < 9; turn++) {
      const result = advanceConstruction(TURN_CYCLE, queue, 1)
      queue = result.queue
    }

    const nineTenthsProject = queue[0]
    if (nineTenthsProject === undefined) throw new Error('project vanished from queue')

    // THE seam: feed construction's own output, unmodified, into mission.ts.
    const nineTenthsStructure = toHabitatStructure(TURN_CYCLE, nineTenthsProject)
    expect(nineTenthsStructure).toEqual({ habitatCapacity: 4, buildTurns: 10, turnsCompleted: 9 })

    const outcomeAt9 = evaluateMission(MISSION_CONFIG, DEADLINE_TURN, [nineTenthsStructure])
    expect(outcomeAt9.status).toBe('lost')
    if (outcomeAt9.status !== 'in-progress') {
      // THE critical game rule, proven end to end: 9/10 build turns contributes
      // ZERO habitat capacity, not partial credit and not its full rating.
      expect(outcomeAt9.habitatCapacity).toBe(0)
    }

    // Also prove the resource-flow half of "in-progress contributes nothing":
    // this habitat nominally consumes electricity once complete, but not yet.
    expect(toResourceFlow(TURN_CYCLE, nineTenthsProject)).toEqual({ produces: {}, consumes: {} })

    // One more turn's labour completes it.
    const finalResult = advanceConstruction(TURN_CYCLE, queue, 1)
    const completeProject = finalResult.queue[0]
    if (completeProject === undefined) throw new Error('project vanished from queue')

    const completeStructure = toHabitatStructure(TURN_CYCLE, completeProject)
    expect(completeStructure).toEqual({ habitatCapacity: 4, buildTurns: 10, turnsCompleted: 10 })

    const outcomeAt10 = evaluateMission(MISSION_CONFIG, DEADLINE_TURN, [completeStructure])
    expect(outcomeAt10.status).toBe('won')
    if (outcomeAt10.status !== 'in-progress') {
      expect(outcomeAt10.habitatCapacity).toBe(4)
    }

    // And the resource flow flips on exactly at completion, not before.
    expect(toResourceFlow(TURN_CYCLE, completeProject)).toEqual({
      produces: {},
      consumes: { electricity: 1 },
    })
  })

  it('should still occupy its tile at 9/10 build turns, blocking a second placement, even though it contributes zero capacity', () => {
    const grid = createGrid(3, 3)
    const queued = queueConstruction(grid, 'hab-1', HABITAT, { x: 0, y: 0 })
    expect(queued.ok).toBe(true)
    if (!queued.ok) return

    const result = advanceConstruction(TURN_CYCLE, [queued.project], 9)
    const partialProject = result.queue[0]
    if (partialProject === undefined) throw new Error('project vanished from queue')

    // Not complete yet...
    expect(toHabitatStructure(TURN_CYCLE, partialProject).turnsCompleted).toBe(9)

    // ...but the grid still shows the tile occupied by this in-progress build.
    expect(tileAt(queued.grid, { x: 0, y: 0 })?.occupantId).toBe('hab-1')

    // A second structure cannot be queued onto the same tile while the first
    // is still under construction: the construction <-> placement seam must
    // surface a typed rejection here, never a silent no-op that would let
    // both "structures" occupy the same tile.
    const blocked = queueConstruction(queued.grid, 'hab-2', HABITAT, { x: 0, y: 0 })
    expect(blocked).toEqual(
      expect.objectContaining({ ok: false, reason: 'occupied', occupantId: 'hab-1' }),
    )
  })

  it('should produce deterministic mission outcomes: replaying the identical construction sequence twice yields deep-equal structures and identical verdicts', () => {
    function driveToNineTenths(): ReturnType<typeof toHabitatStructure> {
      const grid = createGrid(3, 3)
      const queued = queueConstruction(grid, 'hab-1', HABITAT, { x: 1, y: 1 })
      if (!queued.ok) throw new Error('fixture setup failed')

      let queue: ConstructionQueue = enqueueProject([], queued.project)
      for (let turn = 0; turn < 9; turn++) {
        queue = advanceConstruction(TURN_CYCLE, queue, 1).queue
      }
      const project = queue[0]
      if (project === undefined) throw new Error('project vanished from queue')
      return toHabitatStructure(TURN_CYCLE, project)
    }

    const first = driveToNineTenths()
    const second = driveToNineTenths()
    expect(second).toEqual(first)

    const outcomeFirst = evaluateMission(MISSION_CONFIG, DEADLINE_TURN, [first])
    const outcomeSecond = evaluateMission(MISSION_CONFIG, DEADLINE_TURN, [second])
    expect(outcomeSecond).toEqual(outcomeFirst)
  })
})
