import { describe, it, expect } from 'vitest'
import {
  requiredLabourHoursPerBuildTurn,
  totalLabourHoursRequired,
  createProject,
  queueConstruction,
  enqueueProject,
  isProjectComplete,
  turnsCompletedFor,
  toHabitatStructure,
  toResourceFlow,
  occupiedTiles,
  advanceConstruction,
  cancelProject,
  releaseTiles,
} from '../../src/sim/construction'
import type { ConstructionProject, ConstructionQueue } from '../../src/sim/construction'
import { createCatalog } from '../../src/sim/catalog'
import type { StructureType, StructureTypeSpec } from '../../src/sim/catalog'
import { createGrid, tileAt } from '../../src/sim/grid'
import type { Grid } from '../../src/sim/grid'
import { validatePlacement } from '../../src/sim/placement'
import type { ValidPlacement } from '../../src/sim/placement'
import type { TurnCycleConfig } from '../../src/sim/time'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * hoursPerShift = workSeconds / 3600 = 1: one labour-hour == one build turn's
 * worth of progress, which makes the 9/10-vs-10/10 style assertions read as
 * plainly as they do in mission.test.ts (accumulated hours == turnsCompleted).
 */
const TEST_CYCLE: TurnCycleConfig = {
  workSeconds: 3600,
  rechargeSeconds: 1,
  missionSeconds: 100_000_000,
}

const HAB_SPEC: StructureTypeSpec = {
  id: 'habitat-basic',
  name: 'Basic Habitat',
  footprint: [{ dx: 0, dy: 0 }],
  buildTurns: 10,
  produces: {},
  consumes: { electricity: 1 },
  habitatCapacity: 4,
}

const PAD_SPEC: StructureTypeSpec = {
  id: 'pad-basic',
  name: 'Basic Pad',
  footprint: [{ dx: 0, dy: 0 }],
  buildTurns: 5,
  produces: { electricity: 2 },
  consumes: {},
  habitatCapacity: 0,
}

const catalog = createCatalog([HAB_SPEC, PAD_SPEC])
const HAB: StructureType = catalog.types.get('habitat-basic') as StructureType
const PAD: StructureType = catalog.types.get('pad-basic') as StructureType

function freshGrid(): Grid {
  return createGrid(4, 4)
}

function placeAt(grid: Grid, structureType: StructureType, x: number, y: number): ValidPlacement {
  const result = validatePlacement(grid, structureType, { x, y })
  if (!result.ok) throw new Error(`fixture placement failed: ${result.reason}`)
  return result
}

function projectAt(
  id: string,
  structureType: StructureType,
  grid: Grid,
  x: number,
  y: number,
): { project: ConstructionProject; grid: Grid } {
  const result = queueConstruction(grid, id, structureType, { x, y })
  if (!result.ok) throw new Error(`fixture queueConstruction failed: ${result.reason}`)
  return { project: result.project, grid: result.grid }
}

// ---------------------------------------------------------------------------
// requiredLabourHoursPerBuildTurn / totalLabourHoursRequired
// ---------------------------------------------------------------------------

describe('requiredLabourHoursPerBuildTurn', () => {
  it('should equal one drone-shift of labour hours for the given config (happy path)', () => {
    expect(requiredLabourHoursPerBuildTurn(TEST_CYCLE)).toBe(1)
  })

  it('should scale with a longer work shift', () => {
    const longShift: TurnCycleConfig = { ...TEST_CYCLE, workSeconds: 3600 * 25 }
    expect(requiredLabourHoursPerBuildTurn(longShift)).toBe(25)
  })

  it('should reject an invalid turn cycle config (delegated to time.ts)', () => {
    const bad: TurnCycleConfig = { workSeconds: 0, rechargeSeconds: 1, missionSeconds: 1 }
    expect(() => requiredLabourHoursPerBuildTurn(bad)).toThrow(RangeError)
  })
})

describe('totalLabourHoursRequired', () => {
  it('should multiply buildTurns by hours-per-build-turn (happy path)', () => {
    expect(totalLabourHoursRequired(HAB, TEST_CYCLE)).toBe(10)
  })

  it('should be zero for a pre-placed structure with buildTurns 0 (edge case)', () => {
    const instant: StructureType = { ...HAB, buildTurns: 0 }
    expect(totalLabourHoursRequired(instant, TEST_CYCLE)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// queueConstruction
// ---------------------------------------------------------------------------

describe('queueConstruction', () => {
  it('should site the structure on the grid and start a zero-progress project (happy path)', () => {
    const grid = freshGrid()
    const result = queueConstruction(grid, 'hab-1', HAB, { x: 0, y: 0 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(tileAt(result.grid, { x: 0, y: 0 })?.occupantId).toBe('hab-1')
    expect(result.project.accumulatedLabourHours).toBe(0)
    expect(result.project.tiles).toEqual([{ x: 0, y: 0 }])
  })

  it('should not mutate the input grid (purity)', () => {
    const grid = freshGrid()
    queueConstruction(grid, 'hab-1', HAB, { x: 0, y: 0 })
    expect(tileAt(grid, { x: 0, y: 0 })?.occupantId).toBeNull()
  })

  it('should surface a typed out-of-bounds rejection rather than silently losing the build (error path)', () => {
    const grid = freshGrid()
    const result = queueConstruction(grid, 'hab-1', HAB, { x: 999, y: 999 })
    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'out-of-bounds' }),
    )
  })

  it('should surface a typed occupied rejection when the tile is already taken (error path)', () => {
    const grid = freshGrid()
    const first = queueConstruction(grid, 'hab-1', HAB, { x: 0, y: 0 })
    if (!first.ok) throw new Error('fixture setup failed')

    const second = queueConstruction(first.grid, 'hab-2', PAD, { x: 0, y: 0 })
    expect(second).toEqual(
      expect.objectContaining({ ok: false, reason: 'occupied', occupantId: 'hab-1' }),
    )
  })

  it('should never silently no-op: a rejected queueConstruction leaves no project to track (regression guard for aic-a00.13)', () => {
    const grid = freshGrid()
    const first = queueConstruction(grid, 'hab-1', HAB, { x: 0, y: 0 })
    if (!first.ok) throw new Error('fixture setup failed')

    const second = queueConstruction(first.grid, 'hab-2', PAD, { x: 0, y: 0 })
    // The critical regression this guards against: before aic-a00.13's fix, an
    // applyPlacement/grid mismatch could silently produce "nothing happened" —
    // no rejection AND no tracked project. Here we assert the rejection is
    // explicit (`ok: false`), which is what makes it impossible for a caller
    // to mistake this for a successfully queued, silently-invisible build.
    expect(second.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe('createProject', () => {
  it('should start a project at zero accumulated labour with the given tiles (happy path)', () => {
    const grid = freshGrid()
    const placement = placeAt(grid, HAB, 1, 1)
    const project = createProject('hab-1', HAB, placement)

    expect(project.id).toBe('hab-1')
    expect(project.structureType).toBe(HAB)
    expect(project.tiles).toEqual([{ x: 1, y: 1 }])
    expect(project.accumulatedLabourHours).toBe(0)
  })

  it('should defensively copy the placement tiles (edge case: caller mutation after creation)', () => {
    const grid = freshGrid()
    const placement = placeAt(grid, HAB, 2, 2)
    const project = createProject('hab-2', HAB, placement)

    // Mutate the array the placement exposed; the project's own tiles must be unaffected.
    ;(placement.tiles as { x: number; y: number }[])[0] = { x: 9, y: 9 }

    expect(project.tiles).toEqual([{ x: 2, y: 2 }])
  })

  it('should reject an empty-string id (error path)', () => {
    const grid = freshGrid()
    const placement = placeAt(grid, HAB, 0, 0)
    expect(() => createProject('', HAB, placement)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// enqueueProject
// ---------------------------------------------------------------------------

describe('enqueueProject', () => {
  it('should append a project to an empty queue (happy path)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const queue = enqueueProject([], project)
    expect(queue).toEqual([project])
  })

  it('should append to the END of an existing queue, preserving FIFO order', () => {
    const grid = freshGrid()
    const { project: a } = projectAt('a', HAB, grid, 0, 0)
    const { project: b } = projectAt('b', PAD, grid, 1, 0)
    const queue = enqueueProject(enqueueProject([], a), b)
    expect(queue.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('should reject a duplicate project id (error path)', () => {
    const grid = freshGrid()
    const { project: a } = projectAt('dup', HAB, grid, 0, 0)
    const { project: aAgain } = projectAt('dup', PAD, grid, 1, 0)
    const queue = enqueueProject([], a)
    expect(() => enqueueProject(queue, aAgain)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// isProjectComplete / turnsCompletedFor
// ---------------------------------------------------------------------------

describe('isProjectComplete / turnsCompletedFor', () => {
  it('should report zero progress and incomplete for a freshly queued project (happy path)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    expect(turnsCompletedFor(TEST_CYCLE, project)).toBe(0)
    expect(isProjectComplete(TEST_CYCLE, project)).toBe(false)
  })

  it('should be incomplete at 9/10 accumulated labour hours (THE critical boundary)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const nineTenths: ConstructionProject = { ...project, accumulatedLabourHours: 9 }
    expect(turnsCompletedFor(TEST_CYCLE, nineTenths)).toBe(9)
    expect(isProjectComplete(TEST_CYCLE, nineTenths)).toBe(false)
  })

  it('should be complete at exactly buildTurns worth of accumulated hours (boundary: equal)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const done: ConstructionProject = { ...project, accumulatedLabourHours: 10 }
    expect(turnsCompletedFor(TEST_CYCLE, done)).toBe(10)
    expect(isProjectComplete(TEST_CYCLE, done)).toBe(true)
  })

  it('should clamp turnsCompleted at buildTurns for over-accumulated labour (defensive edge case)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const over: ConstructionProject = { ...project, accumulatedLabourHours: 999 }
    expect(turnsCompletedFor(TEST_CYCLE, over)).toBe(10)
    expect(isProjectComplete(TEST_CYCLE, over)).toBe(true)
  })

  it('should treat a pre-placed structure (buildTurns 0) as immediately complete (edge case)', () => {
    const grid = freshGrid()
    const instant: StructureType = { ...HAB, buildTurns: 0 }
    const { project } = projectAt('instant', instant, grid, 0, 0)
    expect(turnsCompletedFor(TEST_CYCLE, project)).toBe(0)
    expect(isProjectComplete(TEST_CYCLE, project)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toHabitatStructure
// ---------------------------------------------------------------------------

describe('toHabitatStructure', () => {
  it('should map habitatCapacity, buildTurns and turnsCompleted for an in-progress project (happy path)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const partial: ConstructionProject = { ...project, accumulatedLabourHours: 9 }
    expect(toHabitatStructure(TEST_CYCLE, partial)).toEqual({
      habitatCapacity: 4,
      buildTurns: 10,
      turnsCompleted: 9,
    })
  })

  it('should map a completed project to a HabitatStructure that isStructureComplete-style checks accept', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const done: ConstructionProject = { ...project, accumulatedLabourHours: 10 }
    expect(toHabitatStructure(TEST_CYCLE, done)).toEqual({
      habitatCapacity: 4,
      buildTurns: 10,
      turnsCompleted: 10,
    })
  })

  it('should map a non-habitat structure (habitatCapacity 0) through unchanged (edge case)', () => {
    const grid = freshGrid()
    const { project } = projectAt('pad-1', PAD, grid, 0, 0)
    expect(toHabitatStructure(TEST_CYCLE, project).habitatCapacity).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// toResourceFlow
// ---------------------------------------------------------------------------

describe('toResourceFlow', () => {
  it('should produce and consume NOTHING while a project is incomplete (critical rule, happy path)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const partial: ConstructionProject = { ...project, accumulatedLabourHours: 9 }
    expect(toResourceFlow(TEST_CYCLE, partial)).toEqual({ produces: {}, consumes: {} })
  })

  it('should expose the structure type\'s real produces/consumes once complete (happy path)', () => {
    const grid = freshGrid()
    const { project } = projectAt('pad-1', PAD, grid, 0, 0)
    const done: ConstructionProject = { ...project, accumulatedLabourHours: 5 }
    expect(toResourceFlow(TEST_CYCLE, done)).toEqual({
      produces: { electricity: 2 },
      consumes: {},
    })
  })

  it('should treat a pre-placed (buildTurns 0) structure as producing from turn zero (edge case)', () => {
    const grid = freshGrid()
    const instant: StructureType = { ...PAD, buildTurns: 0 }
    const { project } = projectAt('instant', instant, grid, 0, 0)
    expect(toResourceFlow(TEST_CYCLE, project)).toEqual({ produces: { electricity: 2 }, consumes: {} })
  })
})

// ---------------------------------------------------------------------------
// occupiedTiles
// ---------------------------------------------------------------------------

describe('occupiedTiles', () => {
  it('should return an empty array for an empty queue (edge case)', () => {
    expect(occupiedTiles([])).toEqual([])
  })

  it('should flatten tiles across every project in the queue, complete or not (happy path)', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0)
    const { project: b } = projectAt('b', PAD, grid2, 1, 1)
    expect(occupiedTiles([a, b])).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
  })
})

// ---------------------------------------------------------------------------
// advanceConstruction
// ---------------------------------------------------------------------------

describe('advanceConstruction', () => {
  it('should apply available labour hours to a single project (happy path)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const result = advanceConstruction(TEST_CYCLE, [project], 4)

    expect(result.queue[0]?.accumulatedLabourHours).toBe(4)
    expect(result.labourHoursApplied).toBe(4)
    expect(result.labourHoursUnused).toBe(0)
  })

  it('should complete a project exactly when buildTurns worth of labour has been applied cumulatively', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    let queue: ConstructionQueue = [project]

    for (let turn = 0; turn < 9; turn++) {
      const result = advanceConstruction(TEST_CYCLE, queue, 1)
      queue = result.queue
      expect(isProjectComplete(TEST_CYCLE, queue[0] as ConstructionProject)).toBe(false)
    }

    const finalResult = advanceConstruction(TEST_CYCLE, queue, 1)
    queue = finalResult.queue
    expect(isProjectComplete(TEST_CYCLE, queue[0] as ConstructionProject)).toBe(true)
  })

  it('should not overshoot a project\'s required labour hours (edge case: surplus after completion)', () => {
    const grid = freshGrid()
    const { project } = projectAt('hab-1', HAB, grid, 0, 0)
    const result = advanceConstruction(TEST_CYCLE, [project], 999)

    expect(result.queue[0]?.accumulatedLabourHours).toBe(10)
    expect(result.labourHoursApplied).toBe(10)
    expect(result.labourHoursUnused).toBe(989)
  })

  it('should cascade unused labour from a fully-satisfied project to the NEXT queued project', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0) // needs 10
    const { project: b } = projectAt('b', PAD, grid2, 1, 0) // needs 5
    const result = advanceConstruction(TEST_CYCLE, [a, b], 12)

    expect(result.queue[0]?.accumulatedLabourHours).toBe(10) // a: fully funded
    expect(result.queue[1]?.accumulatedLabourHours).toBe(2) // b: gets the 2 hours left over
    expect(result.labourHoursApplied).toBe(12)
    expect(result.labourHoursUnused).toBe(0)
  })

  it('should give a project already at 100% zero further labour, passing everything to the next', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0)
    const alreadyDone: ConstructionProject = { ...a, accumulatedLabourHours: 10 }
    const { project: b } = projectAt('b', PAD, grid2, 1, 0)
    const result = advanceConstruction(TEST_CYCLE, [alreadyDone, b], 3)

    expect(result.queue[0]?.accumulatedLabourHours).toBe(10) // untouched
    expect(result.queue[1]?.accumulatedLabourHours).toBe(3) // gets it all
  })

  it('should respect queue ORDER: whichever project is FIRST gets priority for scarce labour', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0) // needs 10
    const { project: b } = projectAt('b', PAD, grid2, 1, 0) // needs 5

    const aFirst = advanceConstruction(TEST_CYCLE, [a, b], 5)
    expect(aFirst.queue[0]?.accumulatedLabourHours).toBe(5) // a took it all
    expect(aFirst.queue[1]?.accumulatedLabourHours).toBe(0) // b got nothing

    const bFirst = advanceConstruction(TEST_CYCLE, [b, a], 5)
    expect(bFirst.queue[0]?.accumulatedLabourHours).toBe(5) // b (now first) fully funded
    expect(bFirst.queue[1]?.accumulatedLabourHours).toBe(0) // a (now second) got nothing
  })

  it('should advance nothing, and not crash or lose the queue, when available labour is zero', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0)
    const { project: b } = projectAt('b', PAD, grid2, 1, 0)
    const result = advanceConstruction(TEST_CYCLE, [a, b], 0)

    expect(result.queue).toEqual([a, b])
    expect(result.labourHoursApplied).toBe(0)
    expect(result.labourHoursUnused).toBe(0)
  })

  it('should handle an empty queue without crashing, reporting all labour as unused', () => {
    const result = advanceConstruction(TEST_CYCLE, [], 7)
    expect(result.queue).toEqual([])
    expect(result.labourHoursUnused).toBe(7)
    expect(result.labourHoursApplied).toBe(0)
  })

  it('should reject a negative availableLabourHours (error path)', () => {
    expect(() => advanceConstruction(TEST_CYCLE, [], -1)).toThrow(RangeError)
  })

  it('should reject a non-finite availableLabourHours (error path)', () => {
    expect(() => advanceConstruction(TEST_CYCLE, [], Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => advanceConstruction(TEST_CYCLE, [], Number.NaN)).toThrow(RangeError)
  })

  it('should be deterministic: identical config, queue and labour yield deep-equal results every run', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0)
    const { project: b } = projectAt('b', PAD, grid2, 1, 0)
    const queue: ConstructionQueue = [a, b]

    const first = advanceConstruction(TEST_CYCLE, queue, 6)
    const second = advanceConstruction(TEST_CYCLE, queue, 6)

    expect(second).toEqual(first)
    // Confirm the run above did not mutate the shared input queue (a precondition
    // of the two calls being genuinely independent, not accidentally reusing state).
    expect(queue).toEqual([a, b])
  })
})

// ---------------------------------------------------------------------------
// cancelProject
// ---------------------------------------------------------------------------

describe('cancelProject', () => {
  it('should remove the matching project, preserving order of the rest (happy path)', () => {
    const grid = freshGrid()
    const { project: a, grid: grid2 } = projectAt('a', HAB, grid, 0, 0)
    const { project: b } = projectAt('b', PAD, grid2, 1, 0)
    const { project: c } = projectAt('c', PAD, grid2, 2, 0)
    const queue: ConstructionQueue = [a, b, c]

    expect(cancelProject(queue, 'b').map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('should reject cancelling an id that is not in the queue (error path)', () => {
    const grid = freshGrid()
    const { project: a } = projectAt('a', HAB, grid, 0, 0)
    expect(() => cancelProject([a], 'does-not-exist')).toThrow(RangeError)
  })

  it('should return an empty queue when cancelling the only project (edge case)', () => {
    const grid = freshGrid()
    const { project: a } = projectAt('a', HAB, grid, 0, 0)
    expect(cancelProject([a], 'a')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// releaseTiles
// ---------------------------------------------------------------------------

describe('releaseTiles', () => {
  it('should clear occupantId for exactly the given tiles, leaving others untouched (happy path)', () => {
    const grid = freshGrid()
    const { project, grid: occupiedGrid } = projectAt('hab-1', HAB, grid, 1, 1)

    expect(tileAt(occupiedGrid, { x: 1, y: 1 })?.occupantId).toBe('hab-1')

    const released = releaseTiles(occupiedGrid, project.tiles)
    expect(tileAt(released, { x: 1, y: 1 })?.occupantId).toBeNull()
    // Every other tile is unaffected.
    for (const tile of released.tiles) {
      if (tile.x === 1 && tile.y === 1) continue
      expect(tile.occupantId).toBeNull()
    }
  })

  it('should allow re-placement on a freed tile after release (round-trip with placement.ts)', () => {
    const grid = freshGrid()
    const { project, grid: occupiedGrid } = projectAt('hab-1', HAB, grid, 0, 0)

    const blocked = validatePlacement(occupiedGrid, PAD, { x: 0, y: 0 })
    expect(blocked.ok).toBe(false)

    const released = releaseTiles(occupiedGrid, project.tiles)
    const nowAllowed = validatePlacement(released, PAD, { x: 0, y: 0 })
    expect(nowAllowed.ok).toBe(true)
  })

  it('should not crash when releasing tiles that are already unoccupied (edge case)', () => {
    const grid = freshGrid()
    const released = releaseTiles(grid, [{ x: 0, y: 0 }])
    expect(tileAt(released, { x: 0, y: 0 })?.occupantId).toBeNull()
  })

  it('should not crash on an out-of-bounds tile coordinate (defensive edge case)', () => {
    const grid = freshGrid()
    expect(() => releaseTiles(grid, [{ x: 999, y: 999 }])).not.toThrow()
  })

  it('should not mutate the input grid (purity)', () => {
    const grid = freshGrid()
    const { project, grid: occupiedGrid } = projectAt('hab-1', HAB, grid, 0, 0)
    releaseTiles(occupiedGrid, project.tiles)
    expect(tileAt(occupiedGrid, { x: 0, y: 0 })?.occupantId).toBe('hab-1')
  })
})

describe('no storing labour (aic-chg) — whole build-turns only', () => {
  // RULED BY THE GENERAL: "No storing labor at all." Unspent robot-hours are lost at
  // end of turn; they are never banked on a project so it can finish a build-turn
  // later. Labour is therefore applied only in WHOLE build-turn units, and any
  // remainder is reported unused rather than accumulated.
  //
  // This also removes a real bug at the root rather than patching it.
  // `turnsCompletedFor` floors `accumulatedLabourHours / hoursPerTurn` with NO
  // epsilon, while `drones.ts` added FLOOR_EPSILON for exactly that hazard. Once
  // fractional labour entered (spec 003's panel cleaning), a 1e-13 deficit would
  // have flipped a habitat to incomplete, contributing zero capacity and losing the
  // mission. Constraining progress to whole multiples makes the quotient exact, so
  // no epsilon is needed — the class of error stops existing.
  const perTurn = requiredLabourHoursPerBuildTurn(TEST_CYCLE)

  function padProject() {
    const grid = freshGrid()
    return projectAt('p1', PAD, grid, 0, 0).project
  }

  it('should not bank a partial build-turn across turns', () => {
    const result = advanceConstruction(TEST_CYCLE, [padProject()], perTurn * 1.5)
    expect(result.labourHoursApplied).toBe(perTurn)
    expect(result.labourHoursUnused).toBeCloseTo(perTurn * 0.5, 9)
    expect(turnsCompletedFor(TEST_CYCLE, result.queue[0]!)).toBe(1)
  })

  it('should make no progress at all on labour below one whole build-turn', () => {
    const result = advanceConstruction(TEST_CYCLE, [padProject()], perTurn * 0.99)
    expect(result.labourHoursApplied).toBe(0)
    expect(result.labourHoursUnused).toBeCloseTo(perTurn * 0.99, 9)
    expect(turnsCompletedFor(TEST_CYCLE, result.queue[0]!)).toBe(0)
  })

  it('should keep accumulated labour an exact multiple of one build-turn', () => {
    let queue: ConstructionQueue = [padProject()]
    for (let turn = 0; turn < 4; turn += 1) {
      queue = advanceConstruction(TEST_CYCLE, queue, perTurn * 1.7).queue
      expect(queue[0]!.accumulatedLabourHours % perTurn).toBe(0)
    }
  })

  it('should leave no floor() quotient that would need an epsilon', () => {
    const result = advanceConstruction(TEST_CYCLE, [padProject()], perTurn * 2)
    const acc = result.queue[0]!.accumulatedLabourHours
    expect(Number.isInteger(acc / perTurn)).toBe(true)
    expect(turnsCompletedFor(TEST_CYCLE, result.queue[0]!)).toBe(2)
  })

  it('should not accumulate past what a project required', () => {
    // PAD needs 5 build-turns. Fund 8; only 5 may be taken.
    const result = advanceConstruction(TEST_CYCLE, [padProject()], perTurn * 8)
    expect(result.labourHoursApplied).toBe(perTurn * 5)
    expect(result.labourHoursUnused).toBe(perTurn * 3)
    expect(isProjectComplete(TEST_CYCLE, result.queue[0]!)).toBe(true)
  })
})
