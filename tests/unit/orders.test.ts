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

import { applyOrders, canAfford, checkAffordability } from '../../src/sim/orders'
import type {
  CancelBuildOrder,
  OrderOutcome,
  OrderableColonyState,
  PlayerOrder,
  QueueBuildFailure,
  QueueBuildOrder,
} from '../../src/sim/orders'
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
  // A one-resource bill of materials — the simplest thing that can be too expensive.
  {
    id: 'costly',
    name: 'Costly Structure',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 3,
    produces: {},
    consumes: {},
    buildCost: { regolith: 100 },
    habitatCapacity: 0,
  },
  // Two resources, so a rejection has to name BOTH of them when both are short.
  {
    id: 'costly-two',
    name: 'Two-Resource Structure',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 3,
    produces: {},
    consumes: {},
    // Authored deliberately out of alphabetical order, so a test asserting sorted
    // shortfalls proves sorting rather than accidentally agreeing with authoring order.
    buildCost: { silicon: 40, regolith: 100 },
    habitatCapacity: 0,
  },
  // The SAME bill as `costly-two`, authored in the opposite (alphabetical) order. Paired
  // with it, this proves the shortfall sort is a property of the rule and not of the order
  // the catalog author happened to type the keys in.
  {
    id: 'costly-two-sorted',
    name: 'Two-Resource Structure, Authored Sorted',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 3,
    produces: {},
    consumes: {},
    buildCost: { regolith: 100, silicon: 40 },
    habitatCapacity: 0,
  },
  // An explicit ZERO line item — "handles regolith, costs none of it" — which must be
  // indistinguishable from being free and must never spawn a phantom stockpile key.
  {
    id: 'zero-cost-line',
    name: 'Zero Line Item',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 1,
    produces: {},
    consumes: {},
    buildCost: { regolith: 0 },
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
const COSTLY = type('costly')
const COSTLY_TWO = type('costly-two')
const COSTLY_TWO_SORTED = type('costly-two-sorted')
const ZERO_LINE = type('zero-cost-line')

/** A minimal `OrderableColonyState` — exactly the three fields orders.ts needs. */
function state(overrides: Partial<OrderableColonyState> = {}): OrderableColonyState {
  return { grid: createGrid(4, 4), queue: [], stockpiles: {}, ...overrides }
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
  return { grid: result.grid, queue, stockpiles: {} }
}

/**
 * Narrow an outcome to a `queue-build` rejection, or fail the test saying why not.
 *
 * Discriminates on the REJECTION's own `reason` rather than on `order.kind`: the two
 * fields are correlated in practice but TypeScript cannot prove it across a union, so
 * narrowing the order does not narrow its sibling rejection. Excluding the one
 * cancel-only reason does, and without a cast.
 */
function queueBuildRejection(outcome: OrderOutcome | undefined): QueueBuildFailure['rejection'] {
  if (outcome === undefined) throw new Error('expected an outcome, got none')
  if (outcome.ok) throw new Error('expected a rejection, got a success')
  const { rejection } = outcome
  if (rejection.reason === 'unknown-project') throw new Error('expected a queue-build outcome')
  return rejection
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

    const result = applyOrders({ grid: second.grid, queue, stockpiles: {} }, [cancelOrder('a')])

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
    const richer: RicherState = {
      grid: createGrid(4, 4),
      queue: [],
      stockpiles: {},
      turnsTaken: 7,
      label: 'colony-a',
    }

    const result = applyOrders(richer, [queueOrder('hab-1', HAB, 0, 0)])

    expect(result.state.turnsTaken).toBe(7)
    expect(result.state.label).toBe('colony-a')
    expect(result.state.queue).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Affordability predicate — the pure, order-free question the build tray asks
// BEFORE it ever constructs an order (aic-8tl.10).
// ---------------------------------------------------------------------------

describe('checkAffordability', () => {
  it('should accept a free structure against an empty stockpile', () => {
    // The overwhelmingly common MVP case: most structures have no bill of materials
    // at all, and `{}` buildCost must never be mistaken for "unaffordable".
    expect(checkAffordability({}, HAB)).toEqual({ ok: true })
  })

  it('should accept a cost exactly equal to the stockpile — affordability is >=, not >', () => {
    // The boundary that decides whether spending your last gram is legal. It is:
    // a colony that can pay the bill exactly has paid the bill.
    expect(checkAffordability({ regolith: 100 }, COSTLY)).toEqual({ ok: true })
  })

  it('should reject with the resource, the requirement, the balance AND the gap when short', () => {
    // "Cannot afford" is useless to a player. WHICH resource and HOW MUCH is actionable,
    // and it must be structured data, never a prose string a UI has to parse back.
    expect(checkAffordability({ regolith: 30 }, COSTLY)).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [{ resource: 'regolith', required: 100, available: 30, short: 70 }],
    })
  })

  it('should treat a resource the colony has never held as a balance of zero, not as absent', () => {
    expect(checkAffordability({}, COSTLY)).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [{ resource: 'regolith', required: 100, available: 0, short: 100 }],
    })
  })

  it('should report EVERY short resource, sorted by name — not just the first one found', () => {
    // A player short on two things needs to see two things. Sorted by resource name so
    // the output never depends on catalog authoring order (`costly-two` deliberately
    // authors silicon before regolith); matches `ledger.ts`'s sorted-report convention.
    expect(checkAffordability({}, COSTLY_TWO)).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [
        { resource: 'regolith', required: 100, available: 0, short: 100 },
        { resource: 'silicon', required: 40, available: 0, short: 40 },
      ],
    })
  })

  it('should sort shortfalls identically no matter what order the catalog authored the bill in', () => {
    // `costly-two` authors silicon-then-regolith; `costly-two-sorted` authors the same bill
    // regolith-then-silicon. Identical output is the determinism claim: a rejection is a
    // function of the RULE, never of `Object.entries` iteration order over authored data.
    expect(checkAffordability({}, COSTLY_TWO_SORTED)).toEqual(checkAffordability({}, COSTLY_TWO))
    expect(checkAffordability({}, COSTLY_TWO_SORTED)).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [
        { resource: 'regolith', required: 100, available: 0, short: 100 },
        { resource: 'silicon', required: 40, available: 0, short: 40 },
      ],
    })
  })

  it('should report ONLY the short resource when the colony can cover the rest of the bill', () => {
    expect(checkAffordability({ regolith: 1_000, silicon: 10 }, COSTLY_TWO)).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [{ resource: 'silicon', required: 40, available: 10, short: 30 }],
    })
  })

  it('should treat an explicit ZERO line item as free, even against an empty stockpile', () => {
    expect(checkAffordability({}, ZERO_LINE)).toEqual({ ok: true })
  })

  it('should never mutate the stockpile it is asked about', () => {
    // The whole point of a predicate the tray can call on every render.
    const stockpiles = { regolith: 30 }
    checkAffordability(stockpiles, COSTLY)
    expect(stockpiles).toEqual({ regolith: 30 })
  })
})

describe('canAfford', () => {
  it('should return true for an affordable build', () => {
    expect(canAfford({ regolith: 100 }, COSTLY)).toBe(true)
  })

  it('should return false for an unaffordable build', () => {
    expect(canAfford({ regolith: 99 }, COSTLY)).toBe(false)
  })

  it('should agree with checkAffordability on every case, being defined in terms of it', () => {
    // Two functions answering the same question can drift; these must not, which is why
    // `canAfford` is a projection of `checkAffordability` and not a second implementation.
    const cases: readonly [Record<string, number>, StructureType][] = [
      [{}, HAB],
      [{}, COSTLY],
      [{ regolith: 100 }, COSTLY],
      [{ regolith: 100 }, COSTLY_TWO],
      [{ regolith: 100, silicon: 40 }, COSTLY_TWO],
      [{}, ZERO_LINE],
    ]
    for (const [stockpiles, structureType] of cases) {
      expect(canAfford(stockpiles, structureType)).toBe(checkAffordability(stockpiles, structureType).ok)
    }
  })
})

// ---------------------------------------------------------------------------
// Debiting a build cost at the commit boundary — the thing that makes a verb
// cost something (aic-8tl.10). `turn.ts` names THIS module as the owner.
// ---------------------------------------------------------------------------

describe('applyOrders — buildCost debiting', () => {
  it('should debit the bill of materials from the stockpile when a build is committed', () => {
    const before = state({ stockpiles: { regolith: 250 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])

    expect(result.outcomes[0]?.ok).toBe(true)
    expect(result.state.stockpiles).toEqual({ regolith: 150 })
  })

  it('should debit every resource in a multi-resource bill, and leave unrelated resources alone', () => {
    const before = state({ stockpiles: { regolith: 250, silicon: 100, water: 7 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY_TWO, 1, 1)])

    expect(result.state.stockpiles).toEqual({ regolith: 150, silicon: 60, water: 7 })
  })

  it('should charge a bill of materials exactly ONCE per committed build, not per tile or per turn', () => {
    const before = state({ stockpiles: { regolith: 250 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])
    // 250 - 100 = 150. Charged twice this would read 50; charged zero times, 250.
    expect(result.state.stockpiles.regolith).toBe(150)
  })

  it('should leave the stockpile untouched for a free structure', () => {
    const before = state({ stockpiles: { regolith: 250 } })
    const result = applyOrders(before, [queueOrder('hab-1', HAB, 1, 1)])

    expect(result.state.stockpiles).toEqual({ regolith: 250 })
  })

  it('should not spawn a phantom zero-balance key for an explicit zero line item', () => {
    // Debiting nothing must change nothing — including the SHAPE of the stockpile.
    const before = state({ stockpiles: {} })
    const result = applyOrders(before, [queueOrder('z-1', ZERO_LINE, 1, 1)])

    expect(result.state.stockpiles).toEqual({})
  })

  it('should allow a build that spends the stockpile down to exactly zero', () => {
    const before = state({ stockpiles: { regolith: 100 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])

    expect(result.outcomes[0]?.ok).toBe(true)
    expect(result.state.stockpiles).toEqual({ regolith: 0 })
    expect(result.state.queue.map((p) => p.id)).toEqual(['c-1'])
  })

  it('should never mutate the stockpile object it was handed', () => {
    const stockpiles = { regolith: 250 }
    const before = state({ stockpiles })
    applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])

    expect(stockpiles).toEqual({ regolith: 250 })
    expect(before.stockpiles).toEqual({ regolith: 250 })
  })

  it('should keep every stockpile balance a non-negative integer — no division in the debit path', () => {
    const before = state({ stockpiles: { regolith: 250, silicon: 100 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY_TWO, 1, 1)])

    for (const amount of Object.values(result.state.stockpiles)) {
      expect(Number.isInteger(amount)).toBe(true)
      expect(amount).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Refusing what the colony cannot pay for — a typed rejection, never a throw,
// and ATOMIC: grid, queue AND stockpiles all completely untouched.
// ---------------------------------------------------------------------------

describe('applyOrders — unaffordable builds', () => {
  it('should REFUSE an unaffordable build with a typed rejection naming the shortfall', () => {
    const before = state({ stockpiles: { regolith: 30 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])

    expect(queueBuildRejection(result.outcomes[0])).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [{ resource: 'regolith', required: 100, available: 30, short: 70 }],
    })
  })

  it('should never THROW for an unaffordable build — it is ordinary player choice, like an occupied tile', () => {
    const before = state({ stockpiles: {} })
    expect(() => applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])).not.toThrow()
  })

  it('should be ATOMIC: a refused build leaves grid, queue AND stockpiles completely untouched', () => {
    // The worst possible bug here is a partially-applied build — a colony that paid for
    // a structure it did not get, or got one it did not pay for. All three must move
    // together or not at all.
    const before = state({ stockpiles: { regolith: 30 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 1, 1)])

    expect(result.state.stockpiles).toEqual({ regolith: 30 })
    expect(result.state.queue).toEqual([])
    expect(result.state.grid).toEqual(before.grid)
    expect(tileAt(result.state.grid, { x: 1, y: 1 })?.occupantId).toBeNull()
    // And the INPUT state is untouched too.
    expect(before.stockpiles).toEqual({ regolith: 30 })
    expect(before.queue).toEqual([])
  })

  it('should NOT debit anything when the bill is only partially affordable', () => {
    // The specific atomicity trap: paying for the silicon you could cover while being
    // refused for the regolith you could not. All or nothing.
    const before = state({ stockpiles: { regolith: 10, silicon: 1_000 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY_TWO, 1, 1)])

    expect(result.outcomes[0]?.ok).toBe(false)
    expect(result.state.stockpiles).toEqual({ regolith: 10, silicon: 1_000 })
  })

  it('should refuse on COST before position, so a player is not sent hunting for a better tile', () => {
    // When a build is both unaffordable AND badly sited, cost is the report that helps:
    // no tile on the map fixes an empty stockpile, but a full stockpile makes the tile
    // the real problem. A deliberate, pinned precedence rather than an accident.
    const before = stateWithQueuedProject('blocker', HAB, 0, 0)
    const result = applyOrders({ ...before, stockpiles: {} }, [queueOrder('c-1', COSTLY, 0, 0)])

    expect(queueBuildRejection(result.outcomes[0]).reason).toBe('unaffordable')
  })

  it('should still report an ordinary placement rejection when the colony CAN afford the build', () => {
    const before = stateWithQueuedProject('blocker', HAB, 0, 0)
    const result = applyOrders({ ...before, stockpiles: { regolith: 1_000 } }, [
      queueOrder('c-1', COSTLY, 0, 0),
    ])

    expect(queueBuildRejection(result.outcomes[0]).reason).toBe('occupied')
    // Refused for position — so nothing was charged for it either.
    expect(result.state.stockpiles).toEqual({ regolith: 1_000 })
  })

  it('should not charge for a build rejected on POSITION', () => {
    const before = state({ stockpiles: { regolith: 1_000 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 99, 99)])

    expect(queueBuildRejection(result.outcomes[0]).reason).toBe('out-of-bounds')
    expect(result.state.stockpiles).toEqual({ regolith: 1_000 })
  })
})

// ---------------------------------------------------------------------------
// Sequential batch accounting — each order is committed against the stockpile
// AS IT STANDS after the previous one, never against the opening balance.
// ---------------------------------------------------------------------------

describe('applyOrders — a batch spends sequentially, never against the opening balance', () => {
  it('should debit the first build and REFUSE the second when the colony can only afford one', () => {
    // THE overspend bug: a naive implementation checks every order against the opening
    // balance, sees 150 >= 100 twice, and lets the colony buy two structures with the
    // money for one. Each order must be charged against what is left after the last.
    const before = state({ stockpiles: { regolith: 150 } })
    const result = applyOrders(before, [
      queueOrder('c-1', COSTLY, 0, 0),
      queueOrder('c-2', COSTLY, 1, 1),
    ])

    expect(result.outcomes.map((o) => o.ok)).toEqual([true, false])
    expect(result.state.queue.map((p) => p.id)).toEqual(['c-1'])
    // 150 - 100 = 50 spent once, NOT twice (which would be -50, or a clamped 0).
    expect(result.state.stockpiles).toEqual({ regolith: 50 })

    // And the refusal is measured against the POST-first-build balance of 50, not 150.
    expect(queueBuildRejection(result.outcomes[1])).toEqual({
      ok: false,
      reason: 'unaffordable',
      shortfalls: [{ resource: 'regolith', required: 100, available: 50, short: 50 }],
    })
    expect(tileAt(result.state.grid, { x: 1, y: 1 })?.occupantId).toBeNull()
  })

  it('should permit exactly as many builds as the colony can pay for, in array order', () => {
    const before = state({ stockpiles: { regolith: 300 } })
    const result = applyOrders(before, [
      queueOrder('c-1', COSTLY, 0, 0),
      queueOrder('c-2', COSTLY, 1, 1),
      queueOrder('c-3', COSTLY, 2, 2),
      queueOrder('c-4', COSTLY, 3, 3),
    ])

    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true, true, false])
    expect(result.state.queue.map((p) => p.id)).toEqual(['c-1', 'c-2', 'c-3'])
    expect(result.state.stockpiles).toEqual({ regolith: 0 })
  })

  it('should let a refused build be followed by an affordable cheaper one in the same batch', () => {
    // A refusal must not poison the rest of the batch — the existing partial-success
    // contract, now extended to the cost path.
    const before = state({ stockpiles: { regolith: 50 } })
    const result = applyOrders(before, [
      queueOrder('c-1', COSTLY, 0, 0), // refused: 50 < 100
      queueOrder('hab-1', HAB, 1, 1), // free, must still go through
    ])

    expect(result.outcomes.map((o) => o.ok)).toEqual([false, true])
    expect(result.state.queue.map((p) => p.id)).toEqual(['hab-1'])
    expect(result.state.stockpiles).toEqual({ regolith: 50 })
  })

  it('should NOT refund a build cost when a later order in the same batch cancels the project', () => {
    // Deliberate and pinned: a bill of materials is spent at commit. The regolith is
    // already poured. Refunding on cancel would make "queue then cancel" a free way to
    // launder resources, and nothing in the sim models salvage yet.
    const before = state({ stockpiles: { regolith: 250 } })
    const result = applyOrders(before, [queueOrder('c-1', COSTLY, 0, 0), cancelOrder('c-1')])

    expect(result.outcomes.map((o) => o.ok)).toEqual([true, true])
    expect(result.state.queue).toEqual([])
    expect(result.state.stockpiles).toEqual({ regolith: 150 })
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
