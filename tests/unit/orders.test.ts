/**
 * Tests for `src/sim/orders.ts` — the player-intent layer (spec 005 T003).
 *
 * The behaviours that matter most, per the bead's acceptance criteria:
 *   - an invalid queue order rejects typed, and mutates NOTHING (`state.grid`/`queue`
 *     stay byte-identical to the input);
 *   - a cancel of an unknown project id rejects typed, never throws (the seam bug this
 *     module exists to fix — `construction.ts`'s `cancelProject` throws for exactly
 *     this, correctly, for ITS caller contract, but a player's UI can race against its
 *     own state and must not crash the turn over it);
 *   - orders apply in ARRAY order, and a batch keeps going after a failure, reporting
 *     one outcome per order so partial success is observable, never silent;
 *   - an empty order list is a true no-op.
 */

import { describe, expect, it } from 'vitest'

import { applyOrders } from '../../src/sim/orders'
import type { CancelBuildOrder, OrderableColonyState, PlayerOrder, QueueBuildOrder } from '../../src/sim/orders'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { createGrid, tileAt } from '../../src/sim/grid'
import { enqueueProject, occupiedTiles, queueConstruction } from '../../src/sim/construction'
import type { ConstructionQueue } from '../../src/sim/construction'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  {
    id: 'pad-basic',
    name: 'Basic Pad',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 5,
    produces: { electricity: 2 },
    consumes: {},
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

const HAB = type('habitat-basic')
const PAD = type('pad-basic')

/** A minimal `OrderableColonyState` — exactly the two fields orders.ts needs. */
function state(overrides: Partial<OrderableColonyState> = {}): OrderableColonyState {
  return { grid: createGrid(4, 4), queue: [], ...overrides }
}

function queueOrder(id: string, structureType: StructureType, x: number, y: number): QueueBuildOrder {
  return { kind: 'queue-build', id, structureType, anchor: { x, y } }
}

function cancelOrder(id: string): CancelBuildOrder {
  return { kind: 'cancel-build', id }
}

/** A colony state with one project already queued at (0,0), for cancel-path tests. */
function stateWithQueuedProject(id: string, structureType: StructureType, x = 0, y = 0): OrderableColonyState {
  const grid = createGrid(4, 4)
  const result = queueConstruction(grid, id, structureType, { x, y })
  if (!result.ok) throw new Error(`fixture setup failed: ${result.reason}`)
  const queue: ConstructionQueue = enqueueProject([], result.project)
  return { grid: result.grid, queue }
}

// ---------------------------------------------------------------------------
// Queue-build orders
// ---------------------------------------------------------------------------

describe('applyOrders — queue-build', () => {
  it('should site a new project and occupy its footprint tile when the position is valid', () => {
    const before = state()
    const result = applyOrders(before, [queueOrder('hab-1', HAB, 1, 1)])

    expect(result.outcomes).toEqual([{ ok: true, order: queueOrder('hab-1', HAB, 1, 1) }])
    expect(result.state.queue).toHaveLength(1)
    expect(result.state.queue[0]?.id).toBe('hab-1')
    expect(tileAt(result.state.grid, { x: 1, y: 1 })?.occupantId).toBe('hab-1')
  })

  it('should return a typed out-of-bounds rejection for a position outside the grid, and mutate NOTHING', () => {
    const before = state()
    const result = applyOrders(before, [queueOrder('hab-1', HAB, 99, 99)])

    expect(result.outcomes).toHaveLength(1)
    const outcome = result.outcomes[0]
    expect(outcome).toBeDefined()
    if (outcome === undefined || outcome.ok) throw new Error('expected a rejection')
    if (outcome.order.kind !== 'queue-build') throw new Error('expected a queue-build outcome')
    expect(outcome.rejection.reason).toBe('out-of-bounds')

    // Completely unmutated: same grid, same (empty) queue as the input state.
    expect(result.state.grid).toEqual(before.grid)
    expect(result.state.queue).toEqual([])
  })

  it('should return a typed occupied rejection for a position already claimed, and mutate NOTHING further', () => {
    const before = stateWithQueuedProject('hab-1', HAB, 0, 0)
    const result = applyOrders(before, [queueOrder('hab-2', PAD, 0, 0)])

    const outcome = result.outcomes[0]
    if (outcome === undefined || outcome.ok) throw new Error('expected a rejection')
    if (outcome.order.kind !== 'queue-build') throw new Error('expected a queue-build outcome')
    expect(outcome.rejection).toEqual({ ok: false, reason: 'occupied', tile: { x: 0, y: 0 }, occupantId: 'hab-1' })

    // Still exactly the one project from before — the rejected order added nothing.
    expect(result.state.queue).toHaveLength(1)
    expect(result.state.queue[0]?.id).toBe('hab-1')
  })

  it('should never throw for an ordinary invalid position', () => {
    const before = state()
    expect(() => applyOrders(before, [queueOrder('hab-1', HAB, -1, -1)])).not.toThrow()
  })

  it('should throw for a duplicate project id — a caller/programmer error, matching construction.ts', () => {
    const before = stateWithQueuedProject('dup', HAB, 0, 0)
    expect(() => applyOrders(before, [queueOrder('dup', PAD, 1, 1)])).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// Cancel-build orders
// ---------------------------------------------------------------------------

describe('applyOrders — cancel-build', () => {
  it('should remove the cancelled project from the queue and free its tiles', () => {
    const before = stateWithQueuedProject('hab-1', HAB, 2, 2)
    const result = applyOrders(before, [cancelOrder('hab-1')])

    expect(result.outcomes).toEqual([{ ok: true, order: cancelOrder('hab-1') }])
    expect(result.state.queue).toEqual([])
    expect(tileAt(result.state.grid, { x: 2, y: 2 })?.occupantId).toBeNull()
  })

  it('should return a typed rejection — not a crash — when cancelling a project that does not exist', () => {
    const before = state()
    expect(() => applyOrders(before, [cancelOrder('ghost')])).not.toThrow()

    const result = applyOrders(before, [cancelOrder('ghost')])
    expect(result.outcomes).toEqual([
      {
        ok: false,
        order: cancelOrder('ghost'),
        rejection: { ok: false, reason: 'unknown-project', id: 'ghost' },
      },
    ])
    // Nothing to mutate in the first place, but assert it explicitly anyway.
    expect(result.state.grid).toEqual(before.grid)
    expect(result.state.queue).toEqual(before.queue)
  })

  it('should leave every OTHER project untouched when cancelling one of several', () => {
    const grid = createGrid(4, 4)
    const first = queueConstruction(grid, 'a', HAB, { x: 0, y: 0 })
    if (!first.ok) throw new Error('fixture failed')
    const second = queueConstruction(first.grid, 'b', PAD, { x: 1, y: 0 })
    if (!second.ok) throw new Error('fixture failed')
    const queue = enqueueProject(enqueueProject([], first.project), second.project)

    const result = applyOrders({ grid: second.grid, queue }, [cancelOrder('a')])

    expect(result.state.queue.map((p) => p.id)).toEqual(['b'])
    expect(tileAt(result.state.grid, { x: 0, y: 0 })?.occupantId).toBeNull()
    expect(tileAt(result.state.grid, { x: 1, y: 0 })?.occupantId).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// Batch semantics: order, partial success, no-op
// ---------------------------------------------------------------------------

describe('applyOrders — batch semantics', () => {
  it('should be a safe no-op for an empty order list, returning an equivalent (even referentially identical) state', () => {
    const before = state()
    const result = applyOrders(before, [])

    expect(result.outcomes).toEqual([])
    expect(result.state).toBe(before)
  })

  it('should apply orders in ARRAY order, not any other order', () => {
    // Two queue orders that both target the SAME tile: whichever is FIRST in the array
    // must win, proving the sequence is array order and not, say, sorted by id.
    // 'zeta' sorts after 'alpha' by id, but is listed FIRST in the array — if this
    // module ever accidentally sorted or otherwise reordered before applying, 'alpha'
    // would win instead, and this assertion would catch it.
    const before = state()
    const result = applyOrders(before, [queueOrder('zeta', PAD, 0, 0), queueOrder('alpha', HAB, 0, 0)])

    expect(result.outcomes[0]).toEqual({ ok: true, order: queueOrder('zeta', PAD, 0, 0) })
    const secondOutcome = result.outcomes[1]
    if (secondOutcome === undefined || secondOutcome.ok) throw new Error('expected the second order to be rejected')
    if (secondOutcome.order.kind !== 'queue-build') throw new Error('expected a queue-build outcome')
    expect(secondOutcome.rejection.reason).toBe('occupied')
    expect(result.state.queue.map((p) => p.id)).toEqual(['zeta'])
  })

  it('should apply every VALID order in a batch even when one order is invalid, and report exactly which failed and why', () => {
    const before = state()
    const orders: PlayerOrder[] = [
      queueOrder('hab-1', HAB, 0, 0),
      queueOrder('hab-2', HAB, 99, 99), // invalid: out of bounds
      queueOrder('pad-1', PAD, 1, 1),
    ]

    const result = applyOrders(before, orders)

    expect(result.outcomes.map((o) => o.ok)).toEqual([true, false, true])
    expect(result.state.queue.map((p) => p.id)).toEqual(['hab-1', 'pad-1'])

    const failure = result.outcomes[1]
    if (failure === undefined || failure.ok) throw new Error('expected the second outcome to be a failure')
    if (failure.order.kind !== 'queue-build') throw new Error('expected a queue-build outcome')
    expect(failure.rejection.reason).toBe('out-of-bounds')
  })

  it('should apply a queue order and a later cancel of the SAME id within one batch, in sequence', () => {
    const before = state()
    const result = applyOrders(before, [queueOrder('hab-1', HAB, 0, 0), cancelOrder('hab-1')])

    expect(result.outcomes).toEqual([
      { ok: true, order: queueOrder('hab-1', HAB, 0, 0) },
      { ok: true, order: cancelOrder('hab-1') },
    ])
    expect(result.state.queue).toEqual([])
    expect(tileAt(result.state.grid, { x: 0, y: 0 })?.occupantId).toBeNull()
  })

  it('should never mutate the grid or queue object identity it was given, even across a mixed batch', () => {
    const before = stateWithQueuedProject('keep', PAD, 3, 3)
    applyOrders(before, [
      queueOrder('hab-1', HAB, 0, 0),
      cancelOrder('does-not-exist'),
      queueOrder('bad', HAB, -5, -5),
    ])

    // The ORIGINAL state object's fields are untouched by any of this — orders.ts only
    // ever produces new grid/queue values, never edits the ones it was handed.
    expect(before.queue).toHaveLength(1)
    expect(before.queue[0]?.id).toBe('keep')
    expect(tileAt(before.grid, { x: 3, y: 3 })?.occupantId).toBe('keep')
    expect(tileAt(before.grid, { x: 0, y: 0 })?.occupantId).toBeNull()
  })

  it('should preserve every field of a richer caller state that structurally extends OrderableColonyState', () => {
    interface RicherState extends OrderableColonyState {
      readonly turnsTaken: number
      readonly label: string
    }
    const richer: RicherState = { grid: createGrid(4, 4), queue: [], turnsTaken: 7, label: 'colony-a' }

    const result = applyOrders(richer, [queueOrder('hab-1', HAB, 0, 0)])

    expect(result.state.turnsTaken).toBe(7)
    expect(result.state.label).toBe('colony-a')
    expect(result.state.queue).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// occupiedTiles sanity — confirms orders.ts and construction.ts agree on occupancy
// ---------------------------------------------------------------------------

describe('applyOrders — occupancy agrees with construction.ts', () => {
  it('should leave grid occupancy and queue.tiles consistent after a queue then cancel', () => {
    const before = state()
    const queued = applyOrders(before, [queueOrder('hab-1', HAB, 2, 2)])
    expect(occupiedTiles(queued.state.queue)).toEqual([{ x: 2, y: 2 }])

    const cancelled = applyOrders(queued.state, [cancelOrder('hab-1')])
    expect(occupiedTiles(cancelled.state.queue)).toEqual([])
    expect(tileAt(cancelled.state.grid, { x: 2, y: 2 })?.occupantId).toBeNull()
  })
})
