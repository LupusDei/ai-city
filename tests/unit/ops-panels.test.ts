/**
 * Tests for `src/app/screens/ops/ops-panels.ts` — the ops screen's SEVERITY layer.
 *
 * WHAT IS ACTUALLY BEING PINNED HERE, and it is not colour. The operations screen used to
 * style "power supplied 1,986,389 Wh against a demand of 9,081,732 Wh" identically to
 * "colony grid 64 x 64", and drew the power bar GREEN while the colony ran at roughly a
 * fifth of its demand. That is not a palette mistake; it is a claim about the game state,
 * and a wrong one. So the question "is this a crisis?" is answered in a tested module and
 * never in a component.
 *
 * THE ANSWER COMES FROM THE SIM'S OWN FACTS AND NEVER FROM AN INVENTED THRESHOLD. The
 * assertions below are written against `electricity.brownout` and the LENGTH of
 * `dronesHeldOffline` — both fields `power.ts` computes — precisely so that no percentage
 * cut-off of the app layer's own devising can creep in. A UI threshold would be a rule
 * `src/sim/` could disagree with, which is the `aic-c1p` defect class wearing a stylesheet.
 *
 * The fixture is a REAL started colony (`tests/support/running-colony.ts`), for the reason
 * that file's header gives: a hand-built `OpsView` would let these tests assert against a
 * shape the sim never emits. Where a state the fixture cannot reach is needed — a colony
 * with no brownout, a concluded mission — it is derived from the real view by overriding
 * one field, so every other field stays the sim's.
 */

import { describe, expect, it } from 'vitest'

import {
  constraintBanner,
  standingStructures,
  ventedTone,
} from '../../src/app/screens/ops/ops-panels'
import { opsView } from '../../src/app/screens/ops/ops-view'
import type { OpsView } from '../../src/app/screens/ops/ops-view'
import { endCycle, startedColony } from '../support/running-colony'

/** The real turn-1 view, or a loud failure — never a hand-built stand-in. */
function view(): OpsView {
  const value = opsView(startedColony())
  if (value === null) throw new Error('the running-colony fixture produced no ops view')
  return value
}

describe('constraintBanner power', () => {
  it('should call the power constraint critical when the sim reports a brownout', () => {
    // Turn 1 of the real colony: one reactor against 33 drones, so `brownout` is true.
    const live = view()
    expect(live.brownout).toBe(true)
    expect(constraintBanner(live).tones.power).toBe('critical')
  })

  it('should call the power constraint nominal when the sim reports no brownout', () => {
    // The ONLY field changed is the sim's own verdict. If the tone were driven by a ratio
    // of supplied to demand invented here, this assertion would fail — which is the point.
    const calm: OpsView = { ...view(), brownout: false }
    expect(constraintBanner(calm).tones.power).toBe('nominal')
  })

  it('should name the brownout in words, so the state is legible without reading the bar', () => {
    expect(constraintBanner(view()).verdicts.power).toBe('Brownout')
  })

  it('should say the grid is stable when nothing was shed', () => {
    expect(constraintBanner({ ...view(), brownout: false }).verdicts.power).toBe('Grid stable')
  })
})

describe('constraintBanner labour', () => {
  it('should call labour critical while any drone is held offline', () => {
    const live = view()
    expect(live.dronesHeldOffline).toBeGreaterThan(0)
    expect(constraintBanner(live).tones.labour).toBe('critical')
  })

  it('should call labour nominal when the whole roster is charged', () => {
    const full: OpsView = { ...view(), dronesHeldOffline: 0 }
    expect(constraintBanner(full).tones.labour).toBe('nominal')
  })

  it('should report the held-offline count with digit grouping', () => {
    // Grouping, not `toLocaleString`: the screen's text must not be a function of locale.
    const many: OpsView = { ...view(), dronesHeldOffline: 1234 }
    expect(constraintBanner(many).verdicts.labour).toBe('1,234 held offline')
  })

  it('should say the roster is fully charged rather than reporting a zero', () => {
    expect(constraintBanner({ ...view(), dronesHeldOffline: 0 }).verdicts.labour).toBe(
      'Full roster on shift',
    )
  })
})

describe('constraintBanner clock', () => {
  it('should call the clock nominal while a cycle can still be run', () => {
    const live = view()
    expect(live.cycleInProgress).toBe(true)
    expect(constraintBanner(live).tones.clock).toBe('nominal')
    expect(constraintBanner(live).verdicts.clock).toBe('Mission running')
  })

  it('should flag the clock once no further cycle will resolve', () => {
    // `cycleInProgress` is `outlook !== null`, which the adapter clears exactly when the
    // mission has concluded — so this is the sim's own end-of-mission signal, not a
    // comparison of turn against total performed here.
    const over: OpsView = { ...view(), cycleInProgress: false }
    expect(constraintBanner(over).tones.clock).toBe('caution')
    expect(constraintBanner(over).verdicts.clock).toBe('Deadline reached')
  })
})

describe('constraintBanner headline', () => {
  it('should lead with the brownout AND what it cost, because they are one crisis', () => {
    expect(constraintBanner(view()).headline).toBe(
      'Brownout — 26 of 33 drones held offline',
    )
  })

  it('should report a brownout that shed structures but no drones', () => {
    const structuresOnly: OpsView = { ...view(), dronesHeldOffline: 0 }
    expect(constraintBanner(structuresOnly).headline).toBe(
      'Brownout — structures shed from the grid',
    )
  })

  it('should report drones held offline even when the sim reports no brownout', () => {
    // Defensive rather than hypothetical: these are two separate sim fields, and a headline
    // that only ever looked at `brownout` would silently drop the second.
    const oddity: OpsView = { ...view(), brownout: false }
    expect(constraintBanner(oddity).headline).toBe('26 of 33 drones held offline')
  })

  it('should have NO headline when nothing is constraining the colony', () => {
    // Null, not an empty string or a cheerful "all systems nominal": a banner that is
    // always present is a banner the player stops reading, and the whole job of this one
    // is to be noticed on the turn it appears.
    const healthy: OpsView = { ...view(), brownout: false, dronesHeldOffline: 0 }
    expect(constraintBanner(healthy).headline).toBeNull()
  })
})

describe('ventedTone', () => {
  it('should caution whenever energy was thrown away', () => {
    expect(ventedTone(1_029_776)).toBe('caution')
  })

  it('should stay nominal when nothing was vented', () => {
    expect(ventedTone(0)).toBe('nominal')
  })

  it('should treat a negative amount as nothing vented rather than as a caution', () => {
    // Unreachable through `ledger.ts`, which never vents a negative amount. Pinned so that
    // a future signed field cannot turn a bookkeeping correction into a warning light.
    expect(ventedTone(-1)).toBe('nominal')
  })
})

describe('standingStructures', () => {
  it('should list both landed hulls with the catalog’s own names', () => {
    // The NAME, not a prettified id. "Reactor Hold (landed)" is `catalog.ts`'s validated
    // display name; a screen that title-cased "reactor-hull" into "Reactor Hull" would be
    // inventing a fact about a structure the simulation already named.
    expect(standingStructures(view())).toEqual([
      { id: 'drone-hull', name: 'Drone Hold (landed)', tileCount: 4, online: true },
      { id: 'reactor-hull', name: 'Reactor Hold (landed)', tileCount: 4, online: true },
    ])
  })

  it('should preserve the queue’s order rather than sorting', () => {
    // `construction.ts` documents array order as the labour-priority order, so the list
    // reads in the order work actually reaches things.
    const live = view()
    expect(standingStructures(live).map((s) => s.id)).toEqual(
      live.queue.map((project) => project.id),
    )
  })

  it('should mark a structure the colony has taken out of service', () => {
    const offline = standingStructures({ ...view(), offlineStructureIds: ['reactor-hull'] })
    expect(offline.map((s) => s.online)).toEqual([true, false])
  })

  it('should treat an offline id that matches nothing as affecting no structure', () => {
    const stray = standingStructures({ ...view(), offlineStructureIds: ['not-a-structure'] })
    expect(stray.every((s) => s.online)).toBe(true)
  })

  it('should return an empty list for a colony with nothing standing', () => {
    // Unreachable through `buildColony`, which always lands both hulls. A total function
    // means the rail renders an empty panel rather than throwing on a future state.
    expect(standingStructures({ ...view(), queue: [] })).toEqual([])
  })
})

describe('the banner over a resolved turn', () => {
  it('should still classify from the sim after a cycle has been taken', () => {
    // Turn 2 of the same colony. Nothing here should depend on which report the view was
    // built from; this is the guard that the classification reads fields rather than
    // remembering a first-turn special case.
    const second = opsView(endCycle(startedColony()))
    if (second === null) throw new Error('no ops view after one cycle')
    expect(constraintBanner(second).tones.power).toBe('critical')
    expect(constraintBanner(second).headline).toBe('Brownout — 26 of 33 drones held offline')
  })
})
