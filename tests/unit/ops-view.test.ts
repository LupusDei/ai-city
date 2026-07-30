/**
 * The ops screen's view selector — every number the Colony Operations screen displays,
 * chosen (never computed) from the adapter's state.
 *
 * WHY A `.ts` MODULE RATHER THAN LOGIC IN THE COMPONENT. Two reasons, both structural:
 *   - `src/app/**\/*.tsx` is excluded from the coverage gate and pure `.ts` under
 *     `src/app/` is not. Anything non-trivial in the `.tsx` would be quietly outside the
 *     80/70/60 threshold, which is how `aic-c1p` happened.
 *   - Constitution §4 forbids game logic in components. Keeping the selection in one
 *     tested function makes "does this screen invent any arithmetic of its own?" a
 *     question a reader can answer by reading 80 lines, not a whole screen.
 *
 * THE PROPERTY THESE TESTS ACTUALLY PIN. Not "the fields are present" — a view model over
 * a hand-written fixture would satisfy that while displaying figures the sim never
 * produces. Every assertion below is either (a) against the value on the adapter's own
 * state, so a selector reading the wrong field fails, or (b) against a golden figure from
 * the real seed, so a selector that silently starts deriving instead of selecting fails.
 * Both halves matter: (a) catches wiring, (b) catches arithmetic.
 */

import { describe, expect, it } from 'vitest'

import {
  formatWattHours,
  groupDigits,
  lastCycleSummary,
  missionVerdictText,
  opsView,
  ventedElectricityWh,
} from '../../src/app/screens/ops/ops-view'
import type { RunningState } from '../../src/app/state/game-state'
import { endCycle, startedColony } from '../support/running-colony'

/**
 * The golden turn-1 figures for `FIXTURE_SEED`, taken from the sim, not invented.
 *
 * Pinned as literals on purpose. Cross-checking the view against `state.outlook` proves
 * the selector reads the right FIELD; only a literal proves it does not quietly compute
 * something that happens to agree with a field on this one state.
 */
const GOLDEN = {
  turn: 1,
  totalTurns: 278,
  turnsRemaining: 277,
  generationWh: 1_986_389,
  powerDrawWh: 9_081_732,
  suppliedWh: 1_926_428,
  idleCapacityWh: 59_961,
  dronesOnShift: 7,
  droneRosterSize: 33,
  habitatCapacity: 0,
  cutLine: 7,
  ventedElectricityWh: 1_029_776,
  depositCount: 197,
} as const

/** A view is always available on a state the adapter produced; this narrows for the tests. */
function viewOf(state: RunningState): NonNullable<ReturnType<typeof opsView>> {
  const view = opsView(state)
  if (view === null) throw new Error('opsView returned null for an adapter-produced state')
  return view
}

describe('groupDigits', () => {
  it('should group thousands with commas', () => {
    expect(groupDigits(1_986_389)).toBe('1,986,389')
  })

  it('should leave a value below a thousand alone', () => {
    expect(groupDigits(0)).toBe('0')
    expect(groupDigits(999)).toBe('999')
  })

  it('should group on the exact thousand boundary', () => {
    expect(groupDigits(1000)).toBe('1,000')
  })

  it('should not depend on the host locale', () => {
    // `toLocaleString` would render "1 986 389" or "1.986.389" depending on the machine.
    // ★AC-4.3 compares two renders for string equality, and a locale-sensitive readout
    // would be a determinism hole that only shows up on someone else's computer.
    expect(groupDigits(1_234_567)).toBe('1,234,567')
  })

  it('should keep a negative sign outside the grouping', () => {
    // No sim figure is negative today. Asserted anyway because a formatter that emits
    // "-,123" on the first signed quantity added is a defect nobody would predict.
    expect(groupDigits(-1234)).toBe('-1,234')
  })
})

describe('formatWattHours', () => {
  it('should render a grouped watt-hour figure with its unit', () => {
    expect(formatWattHours(1_029_776)).toBe('1,029,776 Wh')
  })

  it('should render zero rather than an empty string', () => {
    // AC-4.2: "a number the player cannot see is a mechanic the player cannot learn."
    // Zero vented is information — it says the colony wasted nothing this turn.
    expect(formatWattHours(0)).toBe('0 Wh')
  })
})

describe('ventedElectricityWh', () => {
  it('should find the electricity entry in the ledger’s vented list', () => {
    expect(ventedElectricityWh([{ resource: 'electricity', amount: 867_719 }])).toBe(867_719)
  })

  it('should report zero when nothing was vented', () => {
    expect(ventedElectricityWh([])).toBe(0)
  })

  it('should ignore a vented resource that is not electricity', () => {
    expect(ventedElectricityWh([{ resource: 'oxygen', amount: 5 }])).toBe(0)
  })
})

describe('missionVerdictText', () => {
  it('should say the mission is under way while it is in progress', () => {
    expect(missionVerdictText({ status: 'in-progress', turnsRemaining: 277 })).toBe(
      'Mission in progress',
    )
  })

  it('should name the win and the capacity that earned it', () => {
    expect(
      missionVerdictText({
        status: 'won',
        turnsRemaining: 0,
        habitatCapacity: 6,
        incomingWaveSize: 6,
      }),
    ).toBe('Mission accomplished — habitat capacity 6 of 6 colonists')
  })

  it('should name the loss and the shortfall that caused it', () => {
    expect(
      missionVerdictText({
        status: 'lost',
        turnsRemaining: 0,
        habitatCapacity: 0,
        incomingWaveSize: 6,
      }),
    ).toBe('Mission failed — habitat capacity 0 of 6 colonists')
  })
})

describe('opsView at turn 1, before any turn has resolved', () => {
  const state = startedColony()
  const view = viewOf(state)

  it('should report turn 1 of 278 with 277 remaining', () => {
    // AC-3.3 and AC-4.1. Note what is NOT happening: nothing here adds one to
    // `colony.turnsTaken`. The turn number and the turns remaining are sim fields on the
    // forecast report, which is the whole reason `RunningState.outlook` exists.
    expect(view.turn).toBe(GOLDEN.turn)
    expect(view.totalTurns).toBe(GOLDEN.totalTurns)
    expect(view.turnsRemaining).toBe(GOLDEN.turnsRemaining)
    expect(state.colony.turnsTaken).toBe(0)
  })

  it('should report the sim’s own power figures for the turn in progress', () => {
    expect(view.generationWh).toBe(state.outlook?.electricity.generationWh)
    expect(view.powerDrawWh).toBe(state.outlook?.electricity.totalDemandWh)
    expect(view.suppliedWh).toBe(state.outlook?.electricity.suppliedWh)
    expect(view.idleCapacityWh).toBe(state.outlook?.electricity.unusedWh)

    expect(view.generationWh).toBe(GOLDEN.generationWh)
    expect(view.powerDrawWh).toBe(GOLDEN.powerDrawWh)
    expect(view.suppliedWh).toBe(GOLDEN.suppliedWh)
    expect(view.idleCapacityWh).toBe(GOLDEN.idleCapacityWh)
  })

  it('should report drones on shift out of the whole roster', () => {
    expect(view.dronesOnShift).toBe(GOLDEN.dronesOnShift)
    expect(view.droneRosterSize).toBe(GOLDEN.droneRosterSize)
    expect(view.droneRosterSize).toBe(state.colony.droneRoster.length)
  })

  it('should report zero habitat capacity on a fresh colony', () => {
    expect(view.habitatCapacity).toBe(GOLDEN.habitatCapacity)
  })

  it('should report the brownout and its single explaining cut line', () => {
    // `brownout.ts` chose strict-order shedding over first-fit precisely so that ONE
    // integer explains the whole turn: everything above the line ran, everything at or
    // below it did not.
    expect(view.brownout).toBe(true)
    expect(view.cutLine).toBe(GOLDEN.cutLine)
  })

  it('should report vented energy, which the no-storage ruling makes unavoidable', () => {
    expect(view.ventedElectricityWh).toBe(GOLDEN.ventedElectricityWh)
  })

  it('should report a cycle in progress, so End Cycle is available', () => {
    expect(view.cycleInProgress).toBe(true)
    expect(view.turnsTaken).toBe(0)
  })

  it('should report the mission as still in progress', () => {
    expect(view.mission.status).toBe('in-progress')
  })

  it('should carry the surveyed world, so the deposit count matches the survey screen', () => {
    // ★AC-3.2's unit-level half: the world travels alongside the colony rather than being
    // regenerated, so this count is the SURVEYED one.
    expect(view.world).toBe(state.world)
    expect(view.world.deposits.length).toBe(GOLDEN.depositCount)
  })
})

describe('opsView after one turn has resolved', () => {
  const state = endCycle(startedColony())
  const view = viewOf(state)

  it('should advance to turn 2 with 276 remaining', () => {
    // AC-4.1's assertion, at the selector level.
    expect(view.turn).toBe(2)
    expect(view.turnsRemaining).toBe(276)
    expect(state.colony.turnsTaken).toBe(1)
  })

  it('should read the forecast for the NEW turn, not the report of the old one', () => {
    expect(view.turn).toBe(state.outlook?.turn)
    expect(view.turn).not.toBe(state.lastReport?.turn)
  })
})

describe('opsView once the mission has concluded', () => {
  /**
   * `outlook === null` is the adapter's signal that no further turn will be resolved. The
   * screen must still show the final figures, so the selector falls back to `lastReport`.
   *
   * Built by nulling `outlook` on a state the adapter produced rather than by resolving
   * 278 real turns: the fallback is a property of the SELECTOR, and 278 turn resolutions
   * would test the sim's clock instead while making this file a hundred times slower.
   */
  const resolved = endCycle(startedColony())
  const concluded: RunningState = { ...resolved, outlook: null }
  const view = viewOf(concluded)

  it('should report the last resolved turn rather than nothing at all', () => {
    expect(view.turn).toBe(resolved.lastReport?.turn)
    expect(view.turn).toBe(1)
  })

  it('should refuse a further cycle', () => {
    expect(view.cycleInProgress).toBe(false)
  })

  it('should still report the power and vented figures of the final turn', () => {
    expect(view.generationWh).toBe(GOLDEN.generationWh)
    expect(view.ventedElectricityWh).toBe(GOLDEN.ventedElectricityWh)
  })
})

describe('opsView with no report at all', () => {
  it('should return null rather than invent figures', () => {
    // Unreachable through the adapter — `beginMission` always sets an outlook and
    // `advanceCycle` always sets a lastReport — so this is the total-function branch, kept
    // so the screen has a defined behaviour instead of reading through a null.
    const state: RunningState = { ...startedColony(), outlook: null, lastReport: null }
    expect(opsView(state)).toBeNull()
  })
})

describe('lastCycleSummary', () => {
  it('should report nothing before the first turn has resolved', () => {
    // `lastReport` is null on a fresh colony: nothing has happened yet, and showing a
    // forecast under a "last cycle" heading would be a lie about the past.
    expect(lastCycleSummary(startedColony())).toBeNull()
  })

  it('should report what the resolved turn actually did', () => {
    const state = endCycle(startedColony())
    const summary = lastCycleSummary(state)
    expect(summary).not.toBeNull()
    expect(summary?.turn).toBe(1)
    expect(summary?.labourHoursApplied).toBe(state.lastReport?.labourHoursApplied)
    expect(summary?.labourHoursUnused).toBe(state.lastReport?.labourHoursUnused)
    expect(summary?.completedThisTurn).toEqual([])
    expect(summary?.ventedElectricityWh).toBe(GOLDEN.ventedElectricityWh)
    expect(summary?.cutLine).toBe(GOLDEN.cutLine)
  })
})

describe('determinism through the selector (★AC-4.3’s unit-level half)', () => {
  it('should produce an identical view for two independent runs of the same seed', () => {
    // The sim's golden trace proves the sim is deterministic. This proves the selector
    // adds no ordering, clock or randomness of its own — which is the gap ★AC-4.3 names
    // and the only part of it a unit test can reach.
    expect(opsView(endCycle(startedColony()))).toEqual(opsView(endCycle(startedColony())))
  })
})
