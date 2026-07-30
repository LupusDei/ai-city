/**
 * Unit tests for `weather.ts` (aic-oby.3) — the seeded dust-storm scheduler.
 *
 * `tests/integration/weather-seam.test.ts` proves the seam through `resolveTurn` in a
 * real colony; this file proves the generator and `advanceWeather` correct in
 * isolation, including every boundary the module's own validation guards.
 */

import { describe, expect, it } from 'vitest'

import { CALM_ENVIRONMENT } from '../../src/sim/generation'
import { createColony } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import {
  DEFAULT_STORM_MAX_DURATION_TURNS,
  DEFAULT_STORM_MIN_DURATION_TURNS,
  DEFAULT_WEATHER_TUNING,
  advanceWeather,
  generateStormTimeline,
} from '../../src/sim/weather'
import type { StormEvent, WeatherTuning } from '../../src/sim/weather'

const MISSION = { turnCycle: DEFAULT_TURN_CYCLE, incomingWaveSize: 1 }

function freshColony(overrides: Partial<ColonyState> = {}): ColonyState {
  return { ...createColony(MISSION), ...overrides }
}

// A tuning that forces a storm to start on the very first turn checked, every time —
// used wherever a test needs a GUARANTEED storm without depending on a lucky seed.
function guaranteedStormTuning(durationTurns: number): WeatherTuning {
  return {
    stormOnsetProbabilityPerTurn: 1,
    minStormDurationTurns: durationTurns,
    maxStormDurationTurns: durationTurns,
  }
}

describe('generateStormTimeline — determinism (aic-oby.3 acceptance: identical seed -> identical timeline)', () => {
  it('should return a deep-equal timeline for the same seed, called twice', () => {
    const first = generateStormTimeline(20260730, 400)
    const second = generateStormTimeline(20260730, 400)
    expect(first).toEqual(second)
    // Not merely equal — proving the generator allocates independently each call,
    // never memoising or sharing mutable state across calls.
    expect(first).not.toBe(second)
  })

  it('should return a DIFFERENT timeline for a different seed, over a horizon long enough to matter', () => {
    const a = generateStormTimeline(1, 2000)
    const b = generateStormTimeline(2, 2000)
    expect(a).not.toEqual(b)
  })

  it('should be independent of call order — generating seed B first does not change seed A\'s result', () => {
    // Guards against a shared/global PRNG stream leaking between calls, a hazard the
    // module header explicitly disclaims ("no reference to... any other seed's stream").
    const bFirst = generateStormTimeline(2, 2000)
    const aAfterB = generateStormTimeline(1, 2000)
    const aAlone = generateStormTimeline(1, 2000)
    expect(aAfterB).toEqual(aAlone)
    expect(bFirst).not.toEqual(aAlone)
  })
})

describe('generateStormTimeline — shape and boundaries', () => {
  it('should return an empty timeline for a zero-turn horizon', () => {
    expect(generateStormTimeline(1, 0)).toEqual([])
  })

  it('should return an empty timeline when onset probability is exactly 0', () => {
    const tuning: WeatherTuning = {
      stormOnsetProbabilityPerTurn: 0,
      minStormDurationTurns: 1,
      maxStormDurationTurns: 1,
    }
    expect(generateStormTimeline(20260730, 1000, tuning)).toEqual([])
  })

  it('should start a storm on turn 1 when onset probability is exactly 1', () => {
    const timeline = generateStormTimeline(20260730, 50, guaranteedStormTuning(3))
    expect(timeline[0]).toEqual({ startTurn: 1, endTurn: 3 })
  })

  it('should produce every event with startTurn <= endTurn, both within [1, horizonTurns]', () => {
    const horizon = 3000
    const timeline = generateStormTimeline(99, horizon)
    expect(timeline.length).toBeGreaterThan(0) // non-vacuous at the default tuning
    for (const event of timeline) {
      expect(event.startTurn).toBeGreaterThanOrEqual(1)
      expect(event.endTurn).toBeGreaterThanOrEqual(event.startTurn)
      expect(event.endTurn).toBeLessThanOrEqual(horizon)
    }
  })

  it('should keep every event within the tuned duration bounds, except when clipped by the horizon', () => {
    const horizon = 5000
    const timeline = generateStormTimeline(7, horizon, DEFAULT_WEATHER_TUNING)
    for (const event of timeline) {
      const duration = event.endTurn - event.startTurn + 1
      const clippedByHorizon = event.endTurn === horizon
      if (!clippedByHorizon) {
        expect(duration).toBeGreaterThanOrEqual(DEFAULT_STORM_MIN_DURATION_TURNS)
        expect(duration).toBeLessThanOrEqual(DEFAULT_STORM_MAX_DURATION_TURNS)
      } else {
        expect(duration).toBeLessThanOrEqual(DEFAULT_STORM_MAX_DURATION_TURNS)
      }
    }
  })

  it('should never produce two overlapping storms (a new one may start the turn after the last ends)', () => {
    const timeline = generateStormTimeline(2026, 6000, DEFAULT_WEATHER_TUNING)
    for (let i = 1; i < timeline.length; i++) {
      const previous = timeline[i - 1] as StormEvent
      const current = timeline[i] as StormEvent
      expect(current.startTurn).toBeGreaterThan(previous.endTurn)
    }
  })

  it('should clip a storm that would run past the horizon rather than reporting an unreachable turn', () => {
    // Onset guaranteed on turn 1, duration 30 turns, horizon only 10 turns.
    const tuning = guaranteedStormTuning(DEFAULT_STORM_MAX_DURATION_TURNS)
    const timeline = generateStormTimeline(1, 10, tuning)
    expect(timeline).toEqual([{ startTurn: 1, endTurn: 10 }])
  })
})

describe('generateStormTimeline — input validation', () => {
  it('should reject a negative horizon', () => {
    expect(() => generateStormTimeline(1, -1)).toThrow(RangeError)
  })

  it('should reject a non-integer horizon', () => {
    expect(() => generateStormTimeline(1, 1.5)).toThrow(RangeError)
  })

  it('should reject an onset probability outside [0, 1]', () => {
    expect(() =>
      generateStormTimeline(1, 10, { ...DEFAULT_WEATHER_TUNING, stormOnsetProbabilityPerTurn: 1.1 }),
    ).toThrow(RangeError)
    expect(() =>
      generateStormTimeline(1, 10, { ...DEFAULT_WEATHER_TUNING, stormOnsetProbabilityPerTurn: -0.1 }),
    ).toThrow(RangeError)
  })

  it('should reject a non-positive minimum duration', () => {
    expect(() =>
      generateStormTimeline(1, 10, { ...DEFAULT_WEATHER_TUNING, minStormDurationTurns: 0 }),
    ).toThrow(RangeError)
  })

  it('should reject a maximum duration shorter than the minimum', () => {
    expect(() =>
      generateStormTimeline(1, 10, {
        ...DEFAULT_WEATHER_TUNING,
        minStormDurationTurns: 10,
        maxStormDurationTurns: 5,
      }),
    ).toThrow(RangeError)
  })

  it('should reject a non-integer duration bound', () => {
    expect(() =>
      generateStormTimeline(1, 10, { ...DEFAULT_WEATHER_TUNING, minStormDurationTurns: 2.5 }),
    ).toThrow(RangeError)
  })
})

describe('advanceWeather', () => {
  it('should set dustStorm=false for a turn no event covers', () => {
    const colony = freshColony()
    const timeline: readonly StormEvent[] = [{ startTurn: 5, endTurn: 8 }]
    const advanced = advanceWeather(colony, timeline) // turnsTaken 0 -> checking turn 1
    expect(advanced.environment).toEqual(CALM_ENVIRONMENT)
  })

  it('should set dustStorm=true for a turn an event covers', () => {
    const colony = freshColony({ turnsTaken: 4 })
    const timeline: readonly StormEvent[] = [{ startTurn: 5, endTurn: 8 }]
    const advanced = advanceWeather(colony, timeline) // checking turn 5
    expect(advanced.environment).toEqual({ dustStorm: true })
  })

  it('should treat both the start turn and the end turn as active (inclusive on both ends)', () => {
    const timeline: readonly StormEvent[] = [{ startTurn: 5, endTurn: 8 }]
    expect(advanceWeather(freshColony({ turnsTaken: 4 }), timeline).environment.dustStorm).toBe(true)
    expect(advanceWeather(freshColony({ turnsTaken: 7 }), timeline).environment.dustStorm).toBe(true)
    // One turn before the start, and one after the end, are both calm.
    expect(advanceWeather(freshColony({ turnsTaken: 3 }), timeline).environment.dustStorm).toBe(false)
    expect(advanceWeather(freshColony({ turnsTaken: 8 }), timeline).environment.dustStorm).toBe(false)
  })

  it('should check the UPCOMING turn (turnsTaken + 1), not the one just completed', () => {
    const timeline: readonly StormEvent[] = [{ startTurn: 1, endTurn: 1 }]
    // A colony with turnsTaken=0 is about to resolve turn 1, which the event covers.
    expect(advanceWeather(freshColony({ turnsTaken: 0 }), timeline).environment.dustStorm).toBe(true)
    // A colony with turnsTaken=1 has already resolved turn 1 and is about to resolve
    // turn 2, which the event does not cover.
    expect(advanceWeather(freshColony({ turnsTaken: 1 }), timeline).environment.dustStorm).toBe(false)
  })

  it('should leave every other field of the colony untouched (same queue, grid, stockpiles by reference)', () => {
    const colony = freshColony()
    const advanced = advanceWeather(colony, [])
    expect(advanced.queue).toBe(colony.queue)
    expect(advanced.grid).toBe(colony.grid)
    expect(advanced.stockpiles).toBe(colony.stockpiles)
    expect(advanced.mission).toBe(colony.mission)
    expect(advanced.turnsTaken).toBe(colony.turnsTaken)
  })

  it('should return CALM_ENVIRONMENT itself (by reference) when no storm is active, matching the rest of the sim\'s default', () => {
    const advanced = advanceWeather(freshColony(), [])
    expect(advanced.environment).toBe(CALM_ENVIRONMENT)
  })

  it('should be a pure function: calling it twice with the same inputs yields deep-equal, independently allocated results', () => {
    const colony = freshColony({ turnsTaken: 4 })
    const timeline: readonly StormEvent[] = [{ startTurn: 5, endTurn: 8 }]
    const first = advanceWeather(colony, timeline)
    const second = advanceWeather(colony, timeline)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })

  it('should reject a colony whose turnsTaken is not a non-negative integer', () => {
    const colony = freshColony({ turnsTaken: -1 })
    expect(() => advanceWeather(colony, [])).toThrow(RangeError)
  })

  it('should reject a timeline event with endTurn before startTurn', () => {
    const colony = freshColony()
    expect(() => advanceWeather(colony, [{ startTurn: 5, endTurn: 4 }])).toThrow(RangeError)
  })

  it('should reject a timeline event with a non-positive startTurn', () => {
    const colony = freshColony()
    expect(() => advanceWeather(colony, [{ startTurn: 0, endTurn: 4 }])).toThrow(RangeError)
  })
})
