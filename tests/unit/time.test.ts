import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TURN_CYCLE,
  DRONE_SHIFT_HOURS,
  DRONE_WORK_SECONDS,
  MARS_SOL_SECONDS,
  MISSION_DEADLINE_SECONDS,
  turnDurationSeconds,
  totalTurns,
  turnsRemaining,
  elapsedSeconds,
  labourCapacityHours,
} from '../../src/sim/time'
import type { TurnCycleConfig } from '../../src/sim/time'

describe('locked constants', () => {
  it('should fix the Mars sol at 88,775 whole seconds (24h 39m 35s)', () => {
    expect(MARS_SOL_SECONDS).toBe(88775)
  })

  it('should fix the drone work shift at 25 hours (90,000 seconds)', () => {
    expect(DRONE_SHIFT_HOURS).toBe(25)
    expect(DRONE_WORK_SECONDS).toBe(90000)
  })

  it('should fix the mission deadline at 577 days (49,852,800 seconds)', () => {
    // 577 d = synodic period (779.9 d) - Starship transit (203 d): the interval
    // from landing until the next colonist wave departs Earth.
    expect(MISSION_DEADLINE_SECONDS).toBe(49_852_800)
  })

  it('should default the config to the locked, reality-grounded values', () => {
    expect(DEFAULT_TURN_CYCLE).toEqual<TurnCycleConfig>({
      workSeconds: 90000,
      rechargeSeconds: 88775,
      missionSeconds: 49_852_800,
    })
  })
})

describe('turnDurationSeconds', () => {
  it('should equal work + recharge in whole seconds for the default cycle', () => {
    expect(turnDurationSeconds(DEFAULT_TURN_CYCLE)).toBe(178775)
  })

  it('should sum a custom config exactly', () => {
    expect(turnDurationSeconds({ workSeconds: 10, rechargeSeconds: 5, missionSeconds: 1000 })).toBe(15)
  })

  it('should return an integer', () => {
    expect(Number.isInteger(turnDurationSeconds(DEFAULT_TURN_CYCLE))).toBe(true)
  })
})

describe('totalTurns', () => {
  it('should be exactly 278 full turns for the locked mission deadline', () => {
    // 49,852,800 / 178,775 = 278.85... -> 278 full turns. This is the number the
    // General ratified; it must never silently drift from 278 again.
    expect(totalTurns(DEFAULT_TURN_CYCLE)).toBe(278)
  })

  it('should floor a partial-turn remainder rather than round', () => {
    expect(totalTurns({ workSeconds: 10, rechargeSeconds: 5, missionSeconds: 44 })).toBe(2)
  })

  it('should return an integer', () => {
    expect(Number.isInteger(totalTurns(DEFAULT_TURN_CYCLE))).toBe(true)
  })
})

describe('turnsRemaining', () => {
  it('should return the full turn count when no turns have been taken', () => {
    expect(turnsRemaining(DEFAULT_TURN_CYCLE, 0)).toBe(278)
  })

  it('should subtract turns taken from the total', () => {
    expect(turnsRemaining(DEFAULT_TURN_CYCLE, 100)).toBe(178)
  })

  it('should reach exactly zero on the final turn', () => {
    expect(turnsRemaining(DEFAULT_TURN_CYCLE, 278)).toBe(0)
  })

  it('should clamp at zero rather than go negative when turnsTaken exceeds the total', () => {
    expect(turnsRemaining(DEFAULT_TURN_CYCLE, 279)).toBe(0)
    expect(turnsRemaining(DEFAULT_TURN_CYCLE, 1_000_000)).toBe(0)
  })

  it('should reject a negative turnsTaken', () => {
    expect(() => turnsRemaining(DEFAULT_TURN_CYCLE, -1)).toThrow(RangeError)
  })

  it('should reject a fractional turnsTaken', () => {
    expect(() => turnsRemaining(DEFAULT_TURN_CYCLE, 1.5)).toThrow(RangeError)
  })

  it('should return an integer', () => {
    expect(Number.isInteger(turnsRemaining(DEFAULT_TURN_CYCLE, 50))).toBe(true)
    expect(Number.isInteger(turnsRemaining(DEFAULT_TURN_CYCLE, 1_000_000))).toBe(true)
  })
})

describe('elapsedSeconds', () => {
  it('should return zero when no turns have been taken', () => {
    expect(elapsedSeconds(DEFAULT_TURN_CYCLE, 0)).toBe(0)
  })

  it('should multiply turn duration by turns taken', () => {
    expect(elapsedSeconds(DEFAULT_TURN_CYCLE, 3)).toBe(178775 * 3)
  })

  it('should reject a negative turnsTaken', () => {
    expect(() => elapsedSeconds(DEFAULT_TURN_CYCLE, -1)).toThrow(RangeError)
  })

  it('should reject a fractional turnsTaken', () => {
    expect(() => elapsedSeconds(DEFAULT_TURN_CYCLE, 2.5)).toThrow(RangeError)
  })

  it('should return an integer', () => {
    expect(Number.isInteger(elapsedSeconds(DEFAULT_TURN_CYCLE, 278))).toBe(true)
  })
})

describe('labourCapacityHours', () => {
  it('should be zero for zero drones (no divide-by-zero, no NaN)', () => {
    expect(labourCapacityHours(DEFAULT_TURN_CYCLE, 0)).toBe(0)
  })

  it('should scale linearly with drone count at 25 robot-hours per drone', () => {
    expect(labourCapacityHours(DEFAULT_TURN_CYCLE, 1)).toBe(25)
    expect(labourCapacityHours(DEFAULT_TURN_CYCLE, 2)).toBe(50)
    expect(labourCapacityHours(DEFAULT_TURN_CYCLE, 10)).toBe(250)
  })

  it('should reject a negative drone count', () => {
    expect(() => labourCapacityHours(DEFAULT_TURN_CYCLE, -1)).toThrow(RangeError)
  })

  it('should reject a fractional drone count', () => {
    expect(() => labourCapacityHours(DEFAULT_TURN_CYCLE, 1.5)).toThrow(RangeError)
  })

  it('should reject a config whose work shift is not a whole number of hours', () => {
    // Guards against the one place a naive implementation could smuggle a float
    // into the clock path: seconds-per-shift that don't divide evenly by 3600.
    expect(() =>
      labourCapacityHours({ workSeconds: 100, rechargeSeconds: 88775, missionSeconds: 1_000_000 }, 1),
    ).toThrow(RangeError)
  })

  it('should return an integer', () => {
    expect(Number.isInteger(labourCapacityHours(DEFAULT_TURN_CYCLE, 7))).toBe(true)
  })
})

describe('config validation', () => {
  it.each([
    ['zero workSeconds', { workSeconds: 0, rechargeSeconds: 1, missionSeconds: 1 }],
    ['negative workSeconds', { workSeconds: -1, rechargeSeconds: 1, missionSeconds: 1 }],
    ['fractional workSeconds', { workSeconds: 1.5, rechargeSeconds: 1, missionSeconds: 1 }],
    ['NaN workSeconds', { workSeconds: Number.NaN, rechargeSeconds: 1, missionSeconds: 1 }],
    ['infinite workSeconds', { workSeconds: Number.POSITIVE_INFINITY, rechargeSeconds: 1, missionSeconds: 1 }],
    ['zero rechargeSeconds', { workSeconds: 1, rechargeSeconds: 0, missionSeconds: 1 }],
    ['negative rechargeSeconds', { workSeconds: 1, rechargeSeconds: -1, missionSeconds: 1 }],
    ['fractional rechargeSeconds', { workSeconds: 1, rechargeSeconds: 1.5, missionSeconds: 1 }],
    ['NaN rechargeSeconds', { workSeconds: 1, rechargeSeconds: Number.NaN, missionSeconds: 1 }],
    ['infinite rechargeSeconds', { workSeconds: 1, rechargeSeconds: Number.POSITIVE_INFINITY, missionSeconds: 1 }],
    ['zero missionSeconds', { workSeconds: 1, rechargeSeconds: 1, missionSeconds: 0 }],
    ['negative missionSeconds', { workSeconds: 1, rechargeSeconds: 1, missionSeconds: -1 }],
    ['fractional missionSeconds', { workSeconds: 1, rechargeSeconds: 1, missionSeconds: 1.5 }],
    ['NaN missionSeconds', { workSeconds: 1, rechargeSeconds: 1, missionSeconds: Number.NaN }],
    ['infinite missionSeconds', { workSeconds: 1, rechargeSeconds: 1, missionSeconds: Number.POSITIVE_INFINITY }],
  ])('should reject %s with a RangeError', (_label, config) => {
    expect(() => turnDurationSeconds(config)).toThrow(RangeError)
    expect(() => totalTurns(config)).toThrow(RangeError)
    expect(() => turnsRemaining(config, 0)).toThrow(RangeError)
    expect(() => elapsedSeconds(config, 0)).toThrow(RangeError)
    expect(() => labourCapacityHours(config, 1)).toThrow(RangeError)
  })

  it('should accept the default config without throwing', () => {
    expect(() => turnDurationSeconds(DEFAULT_TURN_CYCLE)).not.toThrow()
  })
})
