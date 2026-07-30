/**
 * Tests for the power-generation abstraction (aic-a00.18).
 *
 * These are the module's own public contract — one curve per registered kind, the
 * registry's extension and failure modes, and the per-instance state helper. The
 * cross-module seam (catalog -> generation -> turn.ts's frozen operational set ->
 * brownout) is `tests/integration/generation-seam.test.ts`, deliberately not faked
 * here with a hand-rolled `StructureType`-shaped object per
 * `.claude/rules/03-testing.md`'s "do not mock the module under test" — every fixture
 * below goes through the real `createCatalog` validation boundary.
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import {
  CALM_ENVIRONMENT,
  CONSTANT_OUTPUT_KIND,
  INITIAL_POWER_SOURCE_STATE,
  RADIOISOTOPE_DECAY_KIND,
  RADIOISOTOPE_DECAY_PPM_PER_TURN,
  SOLAR_DECAY_KIND,
  SOLAR_SOILING_CAP_BASIS_POINTS,
  SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN,
  SOLAR_STORM_RETENTION_BASIS_POINTS,
  advancePowerSourceState,
  currentOutputWh,
  registerOutputModel,
} from '../../src/sim/generation'
import type { GenerationEnvironment, PowerSourceState } from '../../src/sim/generation'

/** A minimal, valid generator spec — a bare footprint, no consumption, no cost. */
function generatorSpec(id: string, ratedWh: number, powerOutputModel?: string) {
  return {
    id,
    name: id,
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { electricity: ratedWh },
    consumes: {},
    habitatCapacity: 0,
    ...(powerOutputModel === undefined ? {} : { powerOutputModel }),
  }
}

function typeFor(id: string, ratedWh: number, powerOutputModel?: string): StructureType {
  const catalog = createCatalog([generatorSpec(id, ratedWh, powerOutputModel)])
  const found = getStructureType(catalog, id)
  if (found === undefined) throw new Error(`test setup: catalog is missing "${id}"`)
  return found
}

function state(turnsOperated: number): PowerSourceState {
  return { turnsOperated }
}

const STORM: GenerationEnvironment = { dustStorm: true }

describe('currentOutputWh — constant (the default, and the reactor case)', () => {
  it('should return the rated figure unchanged when no powerOutputModel is authored', () => {
    const reactor = typeFor('reactor', 125_000)
    expect(reactor.powerOutputModel).toBe(CONSTANT_OUTPUT_KIND)
    expect(currentOutputWh(reactor, state(0), CALM_ENVIRONMENT)).toBe(125_000)
  })

  it('should stay unchanged across any amount of operating history', () => {
    const reactor = typeFor('reactor', 125_000)
    expect(currentOutputWh(reactor, state(277), CALM_ENVIRONMENT)).toBe(125_000)
  })

  it('should stay unchanged during a dust storm', () => {
    const reactor = typeFor('reactor', 125_000)
    expect(currentOutputWh(reactor, state(50), STORM)).toBe(125_000)
  })

  it('should behave identically when powerOutputModel is authored explicitly as "constant"', () => {
    const reactor = typeFor('reactor', 125_000, CONSTANT_OUTPUT_KIND)
    expect(currentOutputWh(reactor, state(999), STORM)).toBe(125_000)
  })

  it('should resolve a pure consumer (rated 0) to 0, exactly as electricityWh did before this field existed', () => {
    const consumer = typeFor('press', 0)
    expect(currentOutputWh(consumer, state(10), CALM_ENVIRONMENT)).toBe(0)
  })
})

describe('currentOutputWh — solarDecay (spec 003)', () => {
  const RATED = 100_000

  it('should produce the full rated figure on its first operating turn (turnsOperated 0)', () => {
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    expect(currentOutputWh(array, state(0), CALM_ENVIRONMENT)).toBe(RATED)
  })

  it('should lose exactly the documented basis points per turn of soiling', () => {
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    // 1 turn * 40 bp = 0.40% loss = 400 Wh off 100,000.
    expect(SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN).toBe(40)
    expect(currentOutputWh(array, state(1), CALM_ENVIRONMENT)).toBe(99_600)
  })

  it('should cap cumulative soiling loss rather than decaying to zero', () => {
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    const turnsToCap = SOLAR_SOILING_CAP_BASIS_POINTS / SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN
    const atCap = RATED * (1 - SOLAR_SOILING_CAP_BASIS_POINTS / 10_000)
    expect(currentOutputWh(array, state(turnsToCap), CALM_ENVIRONMENT)).toBe(atCap)
  })

  it('should hold at the cap rather than losing further beyond it (the boundary the proposal calls out explicitly)', () => {
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    const turnsToCap = SOLAR_SOILING_CAP_BASIS_POINTS / SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN
    const atCap = currentOutputWh(array, state(turnsToCap), CALM_ENVIRONMENT)
    const wayPastCap = currentOutputWh(array, state(turnsToCap + 1_000), CALM_ENVIRONMENT)
    expect(wayPastCap).toBe(atCap)
  })

  it('should reduce output further during a dust storm, on top of any soiling', () => {
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    // No soiling yet (turn 0): storm alone retains the documented fraction.
    const expected = Math.round((RATED * SOLAR_STORM_RETENTION_BASIS_POINTS) / 10_000)
    expect(currentOutputWh(array, state(0), STORM)).toBe(expected)
  })

  it('should compose soiling and storm multiplicatively, not just apply whichever is larger', () => {
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    const turnsToCap = SOLAR_SOILING_CAP_BASIS_POINTS / SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN
    const afterSoilingOnly = currentOutputWh(array, state(turnsToCap), CALM_ENVIRONMENT)
    const afterBoth = currentOutputWh(array, state(turnsToCap), STORM)
    const expected = Math.round((afterSoilingOnly * SOLAR_STORM_RETENTION_BASIS_POINTS) / 10_000)
    expect(afterBoth).toBe(expected)
    // A storm on an already-soiled array must cost strictly more than storm alone.
    expect(afterBoth).toBeLessThan(Math.round((RATED * SOLAR_STORM_RETENTION_BASIS_POINTS) / 10_000))
  })

  it('should always return a non-negative integer, never a fraction', () => {
    const array = typeFor('solar-array', 7, SOLAR_DECAY_KIND) // a rated figure that does not divide evenly
    const result = currentOutputWh(array, state(3), STORM)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBeGreaterThanOrEqual(0)
  })
})

describe('currentOutputWh — radioisotopeDecay (invented for this bead, per REQUIREMENT 2)', () => {
  const RATED = 1_000_000

  it('should produce the full rated figure on its first operating turn', () => {
    const rtg = typeFor('rtg', RATED, RADIOISOTOPE_DECAY_KIND)
    expect(currentOutputWh(rtg, state(0), CALM_ENVIRONMENT)).toBe(RATED)
  })

  it('should lose exactly the documented parts-per-million per turn', () => {
    const rtg = typeFor('rtg', RATED, RADIOISOTOPE_DECAY_KIND)
    const expected = Math.round((RATED * (1_000_000 - RADIOISOTOPE_DECAY_PPM_PER_TURN)) / 1_000_000)
    expect(currentOutputWh(rtg, state(1), CALM_ENVIRONMENT)).toBe(expected)
  })

  it('should decay far more slowly than a solar array over the same history — the whole point of a second kind', () => {
    const rtg = typeFor('rtg', RATED, RADIOISOTOPE_DECAY_KIND)
    const array = typeFor('solar-array', RATED, SOLAR_DECAY_KIND)
    const turns = 100
    const rtgOutput = currentOutputWh(rtg, state(turns), CALM_ENVIRONMENT)
    const arrayOutput = currentOutputWh(array, state(turns), CALM_ENVIRONMENT)
    expect(rtgOutput).toBeGreaterThan(arrayOutput)
  })

  it('should be completely unaffected by a dust storm — proving environment is opt-in per curve, not applied by the resolver', () => {
    const rtg = typeFor('rtg', RATED, RADIOISOTOPE_DECAY_KIND)
    const calm = currentOutputWh(rtg, state(40), CALM_ENVIRONMENT)
    const storm = currentOutputWh(rtg, state(40), STORM)
    expect(storm).toBe(calm)
  })

  it('should never go negative even after enough turns to exhaust the isotope mathematically', () => {
    const rtg = typeFor('rtg', RATED, RADIOISOTOPE_DECAY_KIND)
    const farFuture = Math.ceil(1_000_000 / RADIOISOTOPE_DECAY_PPM_PER_TURN) + 1_000
    expect(currentOutputWh(rtg, state(farFuture), CALM_ENVIRONMENT)).toBe(0)
  })
})

describe('registerOutputModel — the extension point (REQUIREMENT 5)', () => {
  it('should let a brand-new kind be added with no change to this module\'s exported surface', () => {
    registerOutputModel('unit-test-invented-kind', (ratedWh, s) => ratedWh + s.turnsOperated)
    const invented = typeFor('invented', 500, 'unit-test-invented-kind')
    expect(currentOutputWh(invented, state(0), CALM_ENVIRONMENT)).toBe(500)
    expect(currentOutputWh(invented, state(7), CALM_ENVIRONMENT)).toBe(507)
  })

  it('should reject an empty kind name', () => {
    expect(() => registerOutputModel('', () => 0)).toThrow(RangeError)
  })

  it('should reject registering the same kind twice', () => {
    registerOutputModel('unit-test-duplicate-guard', () => 0)
    expect(() => registerOutputModel('unit-test-duplicate-guard', () => 0)).toThrow(
      /already registered/,
    )
  })
})

describe('currentOutputWh — failure modes', () => {
  it('should throw naming the structure and the kind when powerOutputModel names nothing registered', () => {
    const orphaned = typeFor('mystery', 100, 'unit-test-never-registered-kind')
    expect(() => currentOutputWh(orphaned, state(0), CALM_ENVIRONMENT)).toThrow(
      /mystery.*unit-test-never-registered-kind/s,
    )
  })

  it('should reject a curve that returns a negative watt-hour figure', () => {
    registerOutputModel('unit-test-negative-curve', () => -1)
    const broken = typeFor('broken-negative', 100, 'unit-test-negative-curve')
    expect(() => currentOutputWh(broken, state(0), CALM_ENVIRONMENT)).toThrow(RangeError)
  })

  it('should reject a curve that returns a fractional watt-hour figure', () => {
    registerOutputModel('unit-test-fractional-curve', () => 1.5)
    const broken = typeFor('broken-fractional', 100, 'unit-test-fractional-curve')
    expect(() => currentOutputWh(broken, state(0), CALM_ENVIRONMENT)).toThrow(RangeError)
  })
})

describe('advancePowerSourceState', () => {
  it('should increment turnsOperated by exactly one', () => {
    expect(advancePowerSourceState(state(0))).toEqual({ turnsOperated: 1 })
    expect(advancePowerSourceState(state(41))).toEqual({ turnsOperated: 42 })
  })

  it('should not mutate the state it was given', () => {
    const input = state(5)
    const frozen = Object.freeze({ ...input })
    expect(() => advancePowerSourceState(frozen)).not.toThrow()
    expect(frozen.turnsOperated).toBe(5)
  })

  it('should reject a negative turnsOperated', () => {
    expect(() => advancePowerSourceState({ turnsOperated: -1 })).toThrow(RangeError)
  })

  it('should reject a non-integer turnsOperated', () => {
    expect(() => advancePowerSourceState({ turnsOperated: 1.5 })).toThrow(RangeError)
  })
})

describe('INITIAL_POWER_SOURCE_STATE and CALM_ENVIRONMENT', () => {
  it('should describe a freshly commissioned source with no history', () => {
    expect(INITIAL_POWER_SOURCE_STATE).toEqual({ turnsOperated: 0 })
  })

  it('should describe no active environmental conditions', () => {
    expect(CALM_ENVIRONMENT).toEqual({ dustStorm: false })
  })
})
