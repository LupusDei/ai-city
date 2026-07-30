/**
 * MANDATORY SEAM TEST (`.claude/rules/03-testing.md`; pattern established by
 * `tests/integration/construction-mission.test.ts` after `aic-c1p` — two modules can
 * each be green at 100% unit coverage and still never be wired together).
 *
 * `src/sim/orders.ts` and `src/sim/turn.ts` were built in separate worktrees against a
 * shared but unenforced contract: `turn.ts`'s `resolveTurn` header says player orders
 * "are applied BEFORE this function, not inside it," and `orders.ts`'s header says its
 * output IS `resolveTurn`'s input. Neither file imports the other, so nothing but a
 * test that calls BOTH, in the composed sequence, can prove that contract actually
 * holds — that a real `ColonyState` produced by `createColony` satisfies orders.ts's
 * `OrderableColonyState` with no adapter, and that the result of `applyOrders` is a
 * value `resolveTurn` accepts unmodified.
 *
 * The property this file exists to prove, precisely: an order issued for turn N takes
 * effect DURING turn N's resolution, not turn N+1. That is the entire reason spec 005
 * puts orders at step 1 instead of step 11 (`src/sim/turn.ts`'s header, "ordering note
 * 1"), and it is a claim about SEQUENCE that no unit test on either side of the seam —
 * `orders.test.ts` never calls `resolveTurn`; `turn.test.ts` never calls `applyOrders`
 * — can observe.
 */
import { describe, expect, it } from 'vitest'

import { PRIORITY_HABITAT } from '../../src/sim/brownout'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { createProject, requiredLabourHoursPerBuildTurn } from '../../src/sim/construction'
import type { ConstructionProject } from '../../src/sim/construction'
import { createGrid } from '../../src/sim/grid'
import type { CancelBuildOrder, QueueBuildOrder } from '../../src/sim/orders'
import { applyOrders } from '../../src/sim/orders'
import { validatePlacement } from '../../src/sim/placement'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'

// Same fixture shape as tests/unit/turn.test.ts's proven-working reactor+habitat+roster
// setup — reused deliberately so this seam test exercises realistic, already-validated
// numbers rather than a bespoke fixture that happens to compile.
const CONFIG = DEFAULT_TURN_CYCLE
const HOURS_PER_BUILD_TURN = requiredLabourHoursPerBuildTurn(CONFIG)

const CATALOG = createCatalog([
  {
    id: 'reactor',
    name: 'Fission Surface Power Unit',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 4,
    produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'habitat',
    name: 'Habitat Module',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 6,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(32_000, CONFIG) },
    standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(6_400, CONFIG) },
    priorityClass: PRIORITY_HABITAT,
    habitatCapacity: 8,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

const REACTOR = type('reactor')
const HABITAT = type('habitat')

/** A pre-completed construction project, sited on its OWN throwaway grid (tiles only). */
function completedProject(id: string, structureType: StructureType, x: number): ConstructionProject {
  const placement = validatePlacement(createGrid(24, 24), structureType, { x, y: 0 })
  if (!placement.ok) throw new Error(`fixture: ${id} did not fit`)
  const fresh = createProject(id, structureType, placement)
  return { ...fresh, accumulatedLabourHours: structureType.buildTurns * HOURS_PER_BUILD_TURN }
}

function roster(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `drone-${String(i).padStart(2, '0')}`)
}

/** A powered colony: one complete reactor, a full drone roster, an empty real grid. */
function poweredColony(): ColonyState {
  return createColony(
    { turnCycle: CONFIG, incomingWaveSize: 8 },
    { grid: createGrid(24, 24), queue: [completedProject('r-1', REACTOR, 0)], droneRoster: roster(40) },
  )
}

describe('orders -> turn seam', () => {
  it('should let a queue-build order issued for turn 1 receive labour DURING turn 1, proving orders take effect the same turn they are issued', () => {
    const state0 = poweredColony()
    const order: QueueBuildOrder = {
      kind: 'queue-build',
      id: 'hab-1',
      structureType: HABITAT,
      anchor: { x: 5, y: 5 },
    }

    // THE seam: feed applyOrders's own output straight into resolveTurn, exactly as
    // orders.ts's header prescribes.
    const { state: ordered, outcomes } = applyOrders(state0, [order])
    expect(outcomes).toEqual([{ ok: true, order }])
    // Sited on the real colony grid before resolution ever runs — not merely queued.
    expect(ordered.queue.some((p) => p.id === 'hab-1')).toBe(true)

    const { state: next, report } = resolveTurn(ordered)

    expect(report.turn).toBe(1)
    const habitat = next.queue.find((p) => p.id === 'hab-1')
    expect(habitat).toBeDefined()
    // The critical assertion: labour reached this project DURING turn 1, the exact
    // turn the order was issued for — not zero (which is what "applied a turn late"
    // would look like).
    expect(habitat?.accumulatedLabourHours).toBeGreaterThan(0)
    expect(habitat?.accumulatedLabourHours).toBe(report.labourHoursApplied)
  })

  it('should NOT grant that same turn of labour if orders are (incorrectly) applied AFTER resolution instead of before', () => {
    // The contrast this whole seam exists to rule out: composing the two functions in
    // the WRONG order silently delays the order's effect by one turn, exactly as
    // orders.ts's module header describes. This is the bug class, made concrete.
    const state0 = poweredColony()
    const order: QueueBuildOrder = {
      kind: 'queue-build',
      id: 'hab-1',
      structureType: HABITAT,
      anchor: { x: 5, y: 5 },
    }

    const wronglyResolvedFirst = resolveTurn(state0)
    expect(wronglyResolvedFirst.report.turn).toBe(1)
    // Turn 1 ran with no knowledge of the order at all.
    expect(wronglyResolvedFirst.state.queue.some((p) => p.id === 'hab-1')).toBe(false)

    const appliedAfterTheFact = applyOrders(wronglyResolvedFirst.state, [order])
    const habitat = appliedAfterTheFact.state.queue.find((p) => p.id === 'hab-1')
    // The habitat now exists, but turn 1's labour has already been spent and gone —
    // it received NONE of it, unlike the correctly-ordered composition above.
    expect(habitat?.accumulatedLabourHours).toBe(0)
  })

  it('should exclude a cancelled project from the very turn its cancellation was ordered for', () => {
    const state0 = poweredColony()
    const partialHabitat: ConstructionProject = {
      ...completedProject('hab-1', HABITAT, 5),
      // Not complete: one build-turn in, several still needed.
      accumulatedLabourHours: HOURS_PER_BUILD_TURN,
    }
    const stateWithPartialBuild: ColonyState = { ...state0, queue: [...state0.queue, partialHabitat] }

    const order: CancelBuildOrder = { kind: 'cancel-build', id: 'hab-1' }
    const { state: ordered, outcomes } = applyOrders(stateWithPartialBuild, [order])
    expect(outcomes).toEqual([{ ok: true, order }])
    expect(ordered.queue.some((p) => p.id === 'hab-1')).toBe(false)

    const { state: next, report } = resolveTurn(ordered)

    // Cancelled before resolution ever saw it: no completion, no labour, gone for good.
    expect(next.queue.some((p) => p.id === 'hab-1')).toBe(false)
    expect(report.completedThisTurn).toEqual([])
  })

  it('should surface an invalid queue-build order as a typed rejection at this seam too, never a thrown error', () => {
    const state0 = poweredColony()
    const badOrder: QueueBuildOrder = {
      kind: 'queue-build',
      id: 'hab-1',
      structureType: HABITAT,
      anchor: { x: -1, y: -1 },
    }

    expect(() => applyOrders(state0, [badOrder])).not.toThrow()
    const { state: ordered, outcomes } = applyOrders(state0, [badOrder])
    expect(outcomes).toEqual([
      { ok: false, order: badOrder, rejection: { ok: false, reason: 'out-of-bounds', tile: { x: -1, y: -1 } } },
    ])

    // Rejected before resolution: resolveTurn never sees a phantom project.
    const { state: next } = resolveTurn(ordered)
    expect(next.queue.some((p) => p.id === 'hab-1')).toBe(false)
  })
})
