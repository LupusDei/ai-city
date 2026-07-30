import { describe, it, expect } from 'vitest'
import {
  isStructureComplete,
  totalHabitatCapacity,
  evaluateMission,
} from '../../src/sim/mission'
import type { HabitatStructure, MissionConfig, MissionOutcome } from '../../src/sim/mission'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import type { TurnCycleConfig } from '../../src/sim/time'

/** A short, hand-picked cycle so tests don't have to wait 278 turns to hit a deadline. */
const SHORT_CYCLE: TurnCycleConfig = { workSeconds: 10, rechargeSeconds: 5, missionSeconds: 44 }
// turnDuration = 15, totalTurns = floor(44/15) = 2 -> deadline turn is 2.

function structure(
  habitatCapacity: number,
  buildTurns: number,
  turnsCompleted: number,
): HabitatStructure {
  return { habitatCapacity, buildTurns, turnsCompleted }
}

describe('isStructureComplete', () => {
  it('should return true when turnsCompleted equals buildTurns (happy path)', () => {
    expect(isStructureComplete(structure(4, 10, 10))).toBe(true)
  })

  it('should return false when turnsCompleted is one short of buildTurns (9/10 partial build)', () => {
    // The single most important behaviour in this module: a habitat one turn away
    // from completion houses nobody. It must never be treated as complete.
    expect(isStructureComplete(structure(4, 10, 9))).toBe(false)
  })

  it('should return true when turnsCompleted exceeds buildTurns (defensive over-build)', () => {
    expect(isStructureComplete(structure(4, 10, 11))).toBe(true)
  })

  it('should return true for a pre-placed structure with buildTurns 0', () => {
    expect(isStructureComplete(structure(4, 0, 0))).toBe(true)
  })

  it('should return false when turnsCompleted is zero and buildTurns is positive', () => {
    expect(isStructureComplete(structure(4, 10, 0))).toBe(false)
  })

  it('should reject a negative buildTurns', () => {
    expect(() => isStructureComplete(structure(4, -1, 0))).toThrow(RangeError)
  })

  it('should reject a negative turnsCompleted', () => {
    expect(() => isStructureComplete(structure(4, 10, -1))).toThrow(RangeError)
  })

  it('should reject a fractional buildTurns', () => {
    expect(() => isStructureComplete(structure(4, 1.5, 1))).toThrow(RangeError)
  })

  it('should reject a fractional turnsCompleted', () => {
    expect(() => isStructureComplete(structure(4, 10, 1.5))).toThrow(RangeError)
  })
})

describe('totalHabitatCapacity', () => {
  it('should return zero for an empty structure list (no crash)', () => {
    expect(totalHabitatCapacity([])).toBe(0)
  })

  it('should sum habitatCapacity across multiple completed structures', () => {
    expect(totalHabitatCapacity([structure(4, 10, 10), structure(6, 5, 5)])).toBe(10)
  })

  it('should contribute ZERO for a habitat at 9/10 build turns', () => {
    // Game-breaking-bug regression guard: a partially built habitat must not
    // inflate capacity even by its own amount, let alone count as housing anyone.
    expect(totalHabitatCapacity([structure(4, 10, 9)])).toBe(0)
  })

  it('should count completed structures while excluding incomplete ones in the same list', () => {
    expect(totalHabitatCapacity([structure(4, 10, 10), structure(6, 10, 9)])).toBe(4)
  })

  it('should return zero when every structure is incomplete', () => {
    expect(totalHabitatCapacity([structure(4, 10, 0), structure(6, 5, 2)])).toBe(0)
  })

  it('should treat a non-habitat structure (habitatCapacity 0) as contributing zero even when complete', () => {
    expect(totalHabitatCapacity([structure(0, 3, 3)])).toBe(0)
  })

  it('should reject a negative habitatCapacity', () => {
    expect(() => totalHabitatCapacity([structure(-1, 10, 10)])).toThrow(RangeError)
  })
})

describe('evaluateMission', () => {
  const waveSize6: MissionConfig = { turnCycle: DEFAULT_TURN_CYCLE, incomingWaveSize: 6 }

  it('should report in-progress before the deadline (turn 0)', () => {
    const outcome = evaluateMission(waveSize6, 0, [])
    expect(outcome.status).toBe('in-progress')
    expect(outcome.turnsRemaining).toBe(278)
  })

  it('should still be in-progress one turn before the deadline (turn 277)', () => {
    const outcome = evaluateMission(waveSize6, 277, [structure(6, 1, 1)])
    expect(outcome.status).toBe('in-progress')
    expect(outcome.turnsRemaining).toBe(1)
  })

  it('should resolve exactly at the deadline turn (turn 278)', () => {
    const outcome = evaluateMission(waveSize6, 278, [structure(6, 1, 1)])
    expect(outcome.status).not.toBe('in-progress')
    expect(outcome.turnsRemaining).toBe(0)
  })

  it('should WIN when capacity exactly equals the incoming wave size (boundary: equal)', () => {
    const outcome = evaluateMission(waveSize6, 278, [structure(6, 1, 1)])
    expect(outcome.status).toBe('won')
  })

  it('should LOSE when capacity is exactly one under the incoming wave size (boundary: one under)', () => {
    const outcome = evaluateMission(waveSize6, 278, [structure(5, 1, 1)])
    expect(outcome.status).toBe('lost')
  })

  it('should WIN when capacity is exactly one over the incoming wave size (boundary: one over)', () => {
    const outcome = evaluateMission(waveSize6, 278, [structure(7, 1, 1)])
    expect(outcome.status).toBe('won')
  })

  it('should LOSE with zero structures and zero capacity, not crash', () => {
    const outcome = evaluateMission(waveSize6, 278, [])
    expect(outcome.status).toBe('lost')
    if (outcome.status !== 'in-progress') {
      expect(outcome.habitatCapacity).toBe(0)
    }
  })

  it('should exclude a partially-built (9/10) habitat from the win/lose capacity check', () => {
    // Integration-level guard for the same rule tested in isolation above: a habitat
    // one turn from completion must not tip a loss into a win at the deadline.
    const waveSize4: MissionConfig = { turnCycle: DEFAULT_TURN_CYCLE, incomingWaveSize: 4 }
    const outcome = evaluateMission(waveSize4, 278, [structure(4, 10, 9), structure(3, 1, 1)])
    expect(outcome.status).toBe('lost')
    if (outcome.status !== 'in-progress') {
      expect(outcome.habitatCapacity).toBe(3)
    }
  })

  it('should use the deadline and wave size from config, not a hardcoded literal', () => {
    // A short, custom turn cycle and a small custom wave size: if the deadline (278)
    // or wave size were baked into the logic, this would misbehave.
    const config: MissionConfig = { turnCycle: SHORT_CYCLE, incomingWaveSize: 2 }
    expect(evaluateMission(config, 1, [structure(2, 1, 1)]).status).toBe('in-progress')
    expect(evaluateMission(config, 2, [structure(2, 1, 1)]).status).toBe('won')
    expect(evaluateMission(config, 2, [structure(1, 1, 1)]).status).toBe('lost')
  })

  it('should remain resolved (idempotent) for turns taken past the deadline', () => {
    const outcome = evaluateMission(waveSize6, 300, [structure(6, 1, 1)])
    expect(outcome.status).toBe('won')
    expect(outcome.turnsRemaining).toBe(0)
  })

  it('should report turnsRemaining consistent with time.ts at an arbitrary mid-mission turn', () => {
    const outcome = evaluateMission(waveSize6, 100, [])
    expect(outcome.status).toBe('in-progress')
    expect(outcome.turnsRemaining).toBe(178)
  })

  it('should reject a negative incomingWaveSize', () => {
    const config: MissionConfig = { turnCycle: DEFAULT_TURN_CYCLE, incomingWaveSize: -1 }
    expect(() => evaluateMission(config, 0, [])).toThrow(RangeError)
  })

  it('should reject a fractional incomingWaveSize', () => {
    const config: MissionConfig = { turnCycle: DEFAULT_TURN_CYCLE, incomingWaveSize: 1.5 }
    expect(() => evaluateMission(config, 0, [])).toThrow(RangeError)
  })

  it('should reject a negative turnsTaken (delegated to the time.ts clock)', () => {
    expect(() => evaluateMission(waveSize6, -1, [])).toThrow(RangeError)
  })

  it('should reject an invalid turnCycle config (delegated to the time.ts clock)', () => {
    const badConfig: MissionConfig = {
      turnCycle: { workSeconds: 0, rechargeSeconds: 1, missionSeconds: 1 },
      incomingWaveSize: 1,
    }
    expect(() => evaluateMission(badConfig, 0, [])).toThrow(RangeError)
  })

  it('should reject a negative habitatCapacity found among the structures at resolution', () => {
    expect(() => evaluateMission(waveSize6, 278, [structure(-1, 1, 1)])).toThrow(RangeError)
  })

  it('should type-narrow: resolved outcomes carry habitatCapacity and incomingWaveSize, in-progress does not', () => {
    const inProgress: MissionOutcome = evaluateMission(waveSize6, 0, [])
    expect(inProgress.status).toBe('in-progress')
    // No further fields asserted here; the discriminated union is what TypeScript
    // enforces at compile time -- this test exists to exercise the exported type.
  })
})
