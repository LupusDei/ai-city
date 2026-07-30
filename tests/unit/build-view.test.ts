/**
 * The build tray, placement, build-queue and order-outcome selectors (aic-oby.7).
 *
 * Built against a REAL `RunningState` (`tests/support/running-colony.ts`), never a
 * hand-shaped fixture — the same discipline `ops-view.test.ts` documents and for the
 * identical reason: a view model over a hand-written object would let a selector read
 * a field the sim never actually populates.
 */

import { describe, expect, it } from 'vitest'

import {
  anchorBox,
  buildAnchorTestId,
  buildMenu,
  buildOrderId,
  buildQueue,
  cancelBuildOrder,
  lastOrderOutcome,
  orderOutcomeReadout,
  queueBuildOrder,
} from '../../src/app/screens/ops/build-view'
import { dispatch } from '../../src/app/state/game-state'
import type { RunningState } from '../../src/app/state/game-state'
import { getStructureType, listStructureTypes } from '../../src/sim/catalog'
import { HABITAT_MODULE_ID, REACTOR_UNIT_ID } from '../../src/sim/catalog-data-core'
import { REGOLITH_HOPPER_ID } from '../../src/sim/catalog-data'
import type { PlayerOrder } from '../../src/sim/orders'
import { startedColony } from '../support/running-colony'

/** A tile far from both landed hulls (at (10,10) and (30,30)) and inside the 64x64 grid. */
const FREE_ANCHOR = { x: 0, y: 0 } as const
const OCCUPIED_ANCHOR = { x: 10, y: 10 } as const // the drone hull's own anchor
const OUT_OF_BOUNDS_ANCHOR = { x: 1000, y: 1000 } as const

function issue(state: RunningState, orders: readonly PlayerOrder[]): RunningState {
  const next = dispatch(state, { kind: 'issue-orders', orders })
  if (next.phase !== 'running') throw new Error('issue-orders left the running phase')
  return next
}

function hopperType(state: RunningState) {
  const found = getStructureType(state.catalog, REGOLITH_HOPPER_ID)
  if (found === undefined) throw new Error('fixture catalog is missing the Regolith Hopper')
  return found
}

function habitatType(state: RunningState) {
  const found = getStructureType(state.catalog, HABITAT_MODULE_ID)
  if (found === undefined) throw new Error('fixture catalog is missing the Habitat Module')
  return found
}

describe('buildMenu', () => {
  it('should list every structure in the catalog, generically — not a hardcoded id list', () => {
    const state = startedColony()
    const menu = buildMenu(state.catalog)
    const catalogIds = listStructureTypes(state.catalog).map((type) => type.id)
    expect(menu.map((entry) => entry.id)).toEqual(catalogIds)
  })

  it('should include the reactor and the habitat — the mission-critical structures', () => {
    const state = startedColony()
    const ids = buildMenu(state.catalog).map((entry) => entry.id)
    expect(ids).toContain(REACTOR_UNIT_ID)
    expect(ids).toContain(HABITAT_MODULE_ID)
  })

  it('should report the habitat’s real footprint, build turns and power draw', () => {
    const state = startedColony()
    const habitat = buildMenu(state.catalog).find((entry) => entry.id === HABITAT_MODULE_ID)
    expect(habitat).toBeDefined()
    expect(habitat?.footprintTiles).toBe(4)
    // Read from the catalog rather than a literal. This test originally hardcoded 6,
    // which was an untuned placeholder; the balance pass (aic-oby.4) measured the real
    // figure at 80 and the assertion then failed for the RIGHT reason. Pinning a
    // balance-owned number here would make every future retune break a UI test that
    // does not care about the value — only that the tray reports what the sim says.
    expect(habitat?.buildTurns).toBe(habitatType(state).buildTurns)
    expect(habitat?.buildTurns).toBeGreaterThan(0)
    expect(habitat?.powerDrawWh).toBe(habitatType(state).consumes.electricity)
    expect(habitat?.powerDrawWh).toBeGreaterThan(0)
  })

  it('should report an empty build cost for a structure that is free to build', () => {
    const state = startedColony()
    const reactor = buildMenu(state.catalog).find((entry) => entry.id === REACTOR_UNIT_ID)
    expect(reactor?.buildCost).toEqual([])
  })

  it('should report a non-empty build cost for a materially-gated structure', () => {
    const state = startedColony()
    const berm = buildMenu(state.catalog).find((entry) => entry.id === 'shield-berm')
    expect(berm?.buildCost.length).toBeGreaterThan(0)
    expect(berm?.buildCost.every((line) => line.amount > 0)).toBe(true)
  })
})

describe('buildOrderId', () => {
  it('should be a pure function of the structure id and the anchor', () => {
    expect(buildOrderId('regolith-hopper', { x: 3, y: 4 })).toBe(
      buildOrderId('regolith-hopper', { x: 3, y: 4 }),
    )
  })

  it('should differ for two different anchors of the same structure', () => {
    expect(buildOrderId('regolith-hopper', { x: 3, y: 4 })).not.toBe(
      buildOrderId('regolith-hopper', { x: 3, y: 5 }),
    )
  })

  it('should differ for two different structures at the same anchor', () => {
    expect(buildOrderId('regolith-hopper', { x: 3, y: 4 })).not.toBe(
      buildOrderId('sinter-press', { x: 3, y: 4 }),
    )
  })

  it('should never collide across a cancel-then-requeue at the same anchor', () => {
    // The module header's central claim, exercised through the real orders pipeline
    // rather than only argued about: queue, cancel, queue again — same type, same
    // anchor — and the second queue must succeed rather than throwing a duplicate-id
    // RangeError.
    let state = startedColony()
    const type = hopperType(state)
    const id = buildOrderId(type.id, FREE_ANCHOR)

    state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])
    expect(buildQueue(state).some((entry) => entry.id === id)).toBe(true)

    state = issue(state, [cancelBuildOrder(id)])
    expect(buildQueue(state).some((entry) => entry.id === id)).toBe(false)

    expect(() => {
      state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])
    }).not.toThrow()
    expect(buildQueue(state).some((entry) => entry.id === id)).toBe(true)
    expect(lastOrderOutcome(state)?.ok).toBe(true)
  })
})

describe('buildAnchorTestId', () => {
  it('should name the tile it belongs to', () => {
    expect(buildAnchorTestId({ x: 3, y: 4 })).toBe('build-anchor-3-4')
  })
})

describe('anchorBox', () => {
  it('should size and position a tile purely from its coordinate and the tile size', () => {
    expect(anchorBox({ x: 2, y: 5 }, 8)).toEqual({ left: 16, top: 40, size: 8 })
  })

  it('should place adjacent tiles edge to edge with no gap and no overlap', () => {
    const a = anchorBox({ x: 2, y: 0 }, 8)
    const b = anchorBox({ x: 3, y: 0 }, 8)
    expect(a.left + a.size).toBe(b.left)
  })
})

describe('buildQueue', () => {
  it('should be empty on a fresh colony — only the two landed hulls exist', () => {
    expect(buildQueue(startedColony())).toEqual([])
  })

  it('should exclude the two landed hulls even though they are ConstructionProjects too', () => {
    const state = startedColony()
    const ids = buildQueue(state).map((entry) => entry.id)
    expect(ids).not.toContain('drone-hull')
    expect(ids).not.toContain('reactor-hull')
  })

  it('should show a freshly queued structure as incomplete with turnsRemaining === buildTurns', () => {
    let state = startedColony()
    const type = hopperType(state)
    state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])

    const entry = buildQueue(state).find((candidate) => candidate.name === type.name)
    expect(entry).toBeDefined()
    expect(entry?.complete).toBe(false)
    expect(entry?.turnsCompleted).toBe(0)
    expect(entry?.turnsRemaining).toBe(type.buildTurns)
  })

  it('should mark a project complete once it has accumulated enough labour-hours', () => {
    // The Regolith Hopper takes 2 build turns; end enough cycles for the fixture's
    // drone fleet to fund it.
    let state = startedColony()
    const type = hopperType(state)
    state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])

    for (let i = 0; i < 6 && !buildQueue(state).find((e) => e.name === type.name)?.complete; i++) {
      const resolved = dispatch(state, { kind: 'end-cycle', afterTurnsTaken: state.colony.turnsTaken })
      if (resolved.phase !== 'running') throw new Error('end-cycle left the running phase')
      state = resolved
    }

    const entry = buildQueue(state).find((candidate) => candidate.name === type.name)
    expect(entry?.complete).toBe(true)
    expect(entry?.turnsRemaining).toBe(0)
    expect(entry?.turnsCompleted).toBe(entry?.buildTurns)
  })
})

describe('queueBuildOrder / cancelBuildOrder', () => {
  it('should carry the structure type and anchor straight into the order', () => {
    const state = startedColony()
    const type = hopperType(state)
    const order = queueBuildOrder(type, FREE_ANCHOR)
    expect(order).toEqual({
      kind: 'queue-build',
      id: buildOrderId(type.id, FREE_ANCHOR),
      structureType: type,
      anchor: FREE_ANCHOR,
    })
  })

  it('should build a cancel order carrying only the id', () => {
    expect(cancelBuildOrder('some-id')).toEqual({ kind: 'cancel-build', id: 'some-id' })
  })
})

describe('orderOutcomeReadout', () => {
  it('should describe a successful queue-build in plain language', () => {
    let state = startedColony()
    const type = habitatType(state)
    state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])
    const outcome = lastOrderOutcome(state)
    expect(outcome).not.toBeNull()
    const readout = orderOutcomeReadout(outcome!)
    expect(readout.ok).toBe(true)
    expect(readout.code).toBeNull()
    expect(readout.message).toContain('Habitat Module')
    expect(readout.message).toContain('(0, 0)')
  })

  it('should surface "occupied" verbatim, with the occupant named, for an occupied tile', () => {
    let state = startedColony()
    const type = hopperType(state)
    state = issue(state, [queueBuildOrder(type, OCCUPIED_ANCHOR)])
    const outcome = lastOrderOutcome(state)
    const readout = orderOutcomeReadout(outcome!)
    expect(readout.ok).toBe(false)
    expect(readout.code).toBe('occupied')
    expect(readout.message.toLowerCase()).toContain('occupied')
    expect(readout.message).toContain('drone-hull')
  })

  it('should surface "out-of-bounds" verbatim for a footprint hanging off the map', () => {
    let state = startedColony()
    const type = hopperType(state)
    state = issue(state, [queueBuildOrder(type, OUT_OF_BOUNDS_ANCHOR)])
    const outcome = lastOrderOutcome(state)
    const readout = orderOutcomeReadout(outcome!)
    expect(readout.ok).toBe(false)
    expect(readout.code).toBe('out-of-bounds')
    expect(readout.message.toLowerCase()).toContain('off the map')
  })

  it('should surface "unknown-project" verbatim for cancelling something that is not queued', () => {
    let state = startedColony()
    state = issue(state, [cancelBuildOrder('nothing-queued-with-this-id')])
    const outcome = lastOrderOutcome(state)
    const readout = orderOutcomeReadout(outcome!)
    expect(readout.ok).toBe(false)
    expect(readout.code).toBe('unknown-project')
    expect(readout.message).toContain('nothing-queued-with-this-id')
  })

  it('should describe a successful cancel in plain language', () => {
    let state = startedColony()
    const type = hopperType(state)
    const id = buildOrderId(type.id, FREE_ANCHOR)
    state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])
    state = issue(state, [cancelBuildOrder(id)])
    const outcome = lastOrderOutcome(state)
    const readout = orderOutcomeReadout(outcome!)
    expect(readout.ok).toBe(true)
    expect(readout.message).toContain(id)
  })
})

describe('lastOrderOutcome', () => {
  it('should be null before any order has been issued', () => {
    expect(lastOrderOutcome(startedColony())).toBeNull()
  })

  it('should be null again after a turn resolves — outcomes describe the turn just ended', () => {
    let state = startedColony()
    const type = hopperType(state)
    state = issue(state, [queueBuildOrder(type, FREE_ANCHOR)])
    expect(lastOrderOutcome(state)).not.toBeNull()

    const resolved = dispatch(state, { kind: 'end-cycle', afterTurnsTaken: state.colony.turnsTaken })
    if (resolved.phase !== 'running') throw new Error('end-cycle left the running phase')
    expect(lastOrderOutcome(resolved)).toBeNull()
  })

  it('should report the LAST outcome of a batch, not the first', () => {
    let state = startedColony()
    const hopper = hopperType(state)
    const press = getStructureType(state.catalog, 'sinter-press')
    if (press === undefined) throw new Error('fixture catalog is missing the Sinter Press')

    state = issue(state, [
      queueBuildOrder(hopper, FREE_ANCHOR),
      queueBuildOrder(press, { x: 5, y: 5 }),
    ])
    const outcome = lastOrderOutcome(state)
    expect(outcome?.ok).toBe(true)
    expect(outcome?.ok && outcome.order.kind === 'queue-build' && outcome.order.structureType.id).toBe(
      'sinter-press',
    )
  })
})
