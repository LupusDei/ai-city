/**
 * Tests for the golden-trace harness itself.
 *
 * A detector nobody has watched detect anything is not a detector. So the load
 * bearing tests here plant the exact defects aic-a00.7 names — unseeded
 * randomness, a wall-clock read, Map/Set iteration leakage, state mutation —
 * into a fake step function and assert the harness FAILS on them. If the
 * harness were silently broken, those tests would pass a nondeterministic step
 * and fail here, which is the whole point of testing a detector against a
 * planted bug rather than against known-good input.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  canonicalize,
  expectDeterministic,
  expectSameTrace,
  findDivergence,
  parseTrace,
  readGoldenTrace,
  runTrace,
  serializeTrace,
  writeGoldenTrace,
} from './turn-harness'
import type { Trace, TurnStep } from './turn-harness'

/** A minimal stand-in for colony state: enough to have a stockpile and a clock. */
interface FakeState {
  readonly turnsTaken: number
  readonly stockpiles: Readonly<Record<string, number>>
}

const initial = (): FakeState => ({ turnsTaken: 0, stockpiles: { electricity: 0 } })

/** A well-behaved step: pure, integer, returns a new object every time. */
const goodStep: TurnStep<FakeState> = (state) => ({
  turnsTaken: state.turnsTaken + 1,
  stockpiles: { electricity: state.stockpiles.electricity! + 10 },
})

const project = (state: FakeState): unknown => ({
  turnsTaken: state.turnsTaken,
  stockpiles: state.stockpiles,
})

const scenario = { label: 'fake', seed: 1234, initial, step: goodStep, turns: 3, project }

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('canonicalize', () => {
  it('should normalise object key order', () => {
    // Key order is not a value contract anywhere in this sim (ledger.ts sorts its
    // resource keys for the same reason), so two insertion orders must serialise
    // identically or the golden file fails for a non-reason.
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
  })

  it('should preserve array order exactly', () => {
    // The other half of the bargain: arrays are where every meaningful ordering
    // in this codebase lives (poweredIds, shedIds, offlineDroneIds, balances), so
    // an ordering leak must NOT be normalised away.
    expect(canonicalize(['a', 'b'])).not.toBe(canonicalize(['b', 'a']))
  })

  it('should mark undefined rather than dropping it', () => {
    // JSON.stringify drops undefined members, making {a: undefined} and {}
    // indistinguishable — an accidentally-undefined field would vanish silently.
    expect(canonicalize({ a: undefined })).toContain('<undefined>')
    expect(canonicalize({ a: undefined })).not.toBe(canonicalize({}))
  })

  it('should mark non-finite numbers rather than nulling them', () => {
    expect(canonicalize({ x: Number.NaN })).toContain('<NaN>')
    expect(canonicalize({ x: Number.POSITIVE_INFINITY })).toContain('<Infinity>')
    // A NaN stockpile must be impossible to confuse with an absent one.
    expect(canonicalize({ x: Number.NaN })).not.toBe(canonicalize({ x: null }))
  })

  it('should surface a Map or Set instead of erasing it to {}', () => {
    // Plain JSON.stringify renders both as `{}`. A Map reaching a trace snapshot
    // is itself a finding, so it must be visible in the diff.
    expect(canonicalize(new Map([['a', 1]]))).toContain('<Map>')
    expect(canonicalize(new Set(['a']))).toContain('<Set>')
    expect(canonicalize(new Map([['a', 1]]))).not.toBe('{}')
  })

  it('should handle nested structures and primitives', () => {
    expect(canonicalize({ z: [{ b: 1, a: 2 }], y: null })).toBe(
      canonicalize({ y: null, z: [{ a: 2, b: 1 }] }),
    )
    expect(canonicalize(42)).toBe('42')
    expect(canonicalize('s')).toBe('"s"')
  })
})

describe('runTrace', () => {
  it('should record one snapshot per turn, numbered from 1', () => {
    const trace = runTrace(scenario)
    expect(trace.entries.map((entry) => entry.turn)).toEqual([1, 2, 3])
    expect(trace.label).toBe('fake')
    expect(trace.seed).toBe(1234)
    expect(trace.entries[2]!.snapshot).toContain('"electricity": 30')
  })

  it('should pass a turnIndex starting at 0, matching time.ts turnsTaken', () => {
    const seen: number[] = []
    runTrace({
      ...scenario,
      step: (state, turnIndex) => {
        seen.push(turnIndex)
        return goodStep(state, turnIndex)
      },
    })
    expect(seen).toEqual([0, 1, 2])
  })

  it('should record nothing for a zero-turn run', () => {
    // "Resolving an empty colony is a safe no-op" (aic-a00.6) extends to running
    // zero turns: an ordinary starting state, not an error.
    expect(runTrace({ ...scenario, turns: 0 }).entries).toEqual([])
  })

  it('should reject a non-integer or negative turn count', () => {
    expect(() => runTrace({ ...scenario, turns: 1.5 })).toThrow(RangeError)
    expect(() => runTrace({ ...scenario, turns: -1 })).toThrow(RangeError)
  })

  it('should fail when a step returns the same state object it was given', () => {
    // aic-a00.6: resolveTurn "returns a NEW state and does not mutate the input".
    expect(() => runTrace({ ...scenario, step: (state) => state })).toThrow(/SAME state object/)
  })

  it('should fail when a step mutates the state it was given, naming the turn', () => {
    const mutatingStep: TurnStep<FakeState> = (state) => {
      // Deliberate in-place write through the readonly type, exactly as an
      // innocent-looking optimisation would.
      ;(state.stockpiles as Record<string, number>).electricity = 999
      return { turnsTaken: state.turnsTaken + 1, stockpiles: { ...state.stockpiles } }
    }
    expect(() => runTrace({ ...scenario, step: mutatingStep })).toThrow(/MUTATED/)
    expect(() => runTrace({ ...scenario, step: mutatingStep })).toThrow(/Turn 0/)
  })

  it('should skip the mutation check when it is explicitly disabled', () => {
    // An escape hatch is needed for a step that legitimately shares immutable
    // sub-objects by reference (placement.ts keeps untouched Tile references),
    // where an === return is still a real bug but a deep compare is expensive.
    expect(() =>
      runTrace({ ...scenario, step: (state) => state, assertNoMutation: false }),
    ).not.toThrow()
  })

  it('should record only what the projection selects', () => {
    const trace = runTrace({ ...scenario, project: (state) => state.turnsTaken })
    expect(trace.entries[0]!.snapshot).toBe('1')
  })
})

describe('findDivergence', () => {
  it('should return null for two identical traces', () => {
    expect(findDivergence(runTrace(scenario), runTrace(scenario))).toBeNull()
  })

  it('should report the FIRST diverging turn, not every subsequent one', () => {
    // Once turn 2 diverges, turn 3 is a consequence. Reporting all of them buries
    // the one that matters.
    const expected = runTrace(scenario)
    const actual = runTrace({
      ...scenario,
      step: (state, turnIndex) =>
        turnIndex === 1
          ? { turnsTaken: state.turnsTaken + 1, stockpiles: { electricity: 999 } }
          : goodStep(state, turnIndex),
    })

    const divergence = findDivergence(expected, actual)
    expect(divergence).not.toBeNull()
    expect(divergence!.turn).toBe(2)
  })

  it('should make the diverging turn obvious in its message', () => {
    // aic-a00.7 acceptance criterion, asserted rather than hoped for.
    const expected = runTrace(scenario)
    const actual = runTrace({ ...scenario, step: (state) => ({ ...state, turnsTaken: 99 }) })

    const divergence = findDivergence(expected, actual)!
    expect(divergence.message).toContain('DETERMINISM BROKEN at turn 1')
    expect(divergence.message).toContain('Scenario "fake"')
    expect(divergence.message).toContain('seed 1234')
    // Names the usual suspects so a reader is not left guessing.
    expect(divergence.message).toContain('Math.random')
  })

  it('should include the last agreeing snapshot when the divergence is not on turn 1', () => {
    const expected = runTrace(scenario)
    const actual = runTrace({
      ...scenario,
      step: (state, turnIndex) =>
        turnIndex === 2 ? { ...state, turnsTaken: 99 } : goodStep(state, turnIndex),
    })
    expect(findDivergence(expected, actual)!.message).toContain('Last agreeing snapshot (turn 2)')
  })

  it('should report a length mismatch as a divergence at the first missing turn', () => {
    const divergence = findDivergence(runTrace(scenario), runTrace({ ...scenario, turns: 2 }))
    expect(divergence).not.toBeNull()
    expect(divergence!.turn).toBe(3)
    expect(divergence!.message).toContain('Trace length mismatch')
  })
})

describe('expectSameTrace', () => {
  it('should pass for identical traces', () => {
    expect(() => expectSameTrace(runTrace(scenario), runTrace(scenario))).not.toThrow()
  })

  it('should throw a report naming the diverging turn', () => {
    const actual = runTrace({ ...scenario, step: (state) => ({ ...state, turnsTaken: 99 }) })
    expect(() => expectSameTrace(runTrace(scenario), actual)).toThrow(/DETERMINISM BROKEN at turn 1/)
  })
})

describe('expectDeterministic', () => {
  it('should pass for a pure, integer, seeded step', () => {
    expect(() => expectDeterministic(scenario)).not.toThrow()
    expect(expectDeterministic(scenario).entries).toHaveLength(3)
  })

  it('should fail loudly when the step calls Math.random', () => {
    // THE test aic-a00.7 asks for: "introducing Math.random into the sim path
    // demonstrably fails the test". Planted here rather than assumed.
    const randomStep: TurnStep<FakeState> = (state) => ({
      turnsTaken: state.turnsTaken + 1,
      stockpiles: { electricity: Math.random() },
    })
    expect(() => expectDeterministic({ ...scenario, step: randomStep })).toThrow(
      /DETERMINISM BROKEN/,
    )
  })

  it('should fail loudly when the step reads the wall clock', () => {
    const clockStep: TurnStep<FakeState> = (state) => ({
      turnsTaken: state.turnsTaken + 1,
      // performance.now() advances between the harness's two runs; Date.now()
      // has millisecond granularity and could coincide, which would make this
      // test flaky rather than failing.
      stockpiles: { electricity: performance.now() },
    })
    expect(() => expectDeterministic({ ...scenario, step: clockStep })).toThrow(
      /DETERMINISM BROKEN/,
    )
  })

  it('should catch float drift that only appears after several turns', () => {
    // The failure mode `time.ts`'s header exists to prevent, and the reason the
    // harness runs MULTIPLE turns rather than asserting one step: a per-turn
    // error of 0.1 is invisible at turn 1 and wrong by turn 3.
    let bias = 0
    const driftingStep: TurnStep<FakeState> = (state) => {
      bias += 0.1 // module-level state leaking across runs, as a real cache would
      return { turnsTaken: state.turnsTaken + 1, stockpiles: { electricity: 10 + bias } }
    }
    expect(() => expectDeterministic({ ...scenario, step: driftingStep })).toThrow(
      /DETERMINISM BROKEN/,
    )
  })

  it('should start each run from independent state so a mutating step cannot hide', () => {
    // `initial` is a factory precisely so the two runs cannot share a mutable
    // object; if they shared one, a mutation bug would corrupt both runs
    // identically and the comparison would pass.
    const seen: FakeState[] = []
    expectDeterministic({
      ...scenario,
      initial: () => {
        const state = initial()
        seen.push(state)
        return state
      },
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
  })
})

describe('golden trace files', () => {
  function tempPath(name: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'ai-city-golden-'))
    tempDirs.push(dir)
    return join(dir, name)
  }

  it('should round-trip a trace through serialise and parse', () => {
    const trace = runTrace(scenario)
    expect(parseTrace(serializeTrace(trace))).toEqual(trace)
  })

  it('should write a line-diffable file ending in a newline', () => {
    // Reviewability is the requirement: a golden file whose diff nobody can read
    // gets regenerated on autopilot the first time it fails.
    const path = tempPath('trace.json')
    writeGoldenTrace(path, runTrace(scenario))
    const contents = serializeTrace(readGoldenTrace(path))
    expect(contents.endsWith('\n')).toBe(true)
    expect(contents.split('\n').length).toBeGreaterThan(5)
  })

  it('should read back a written golden trace unchanged', () => {
    const path = tempPath('trace.json')
    const trace: Trace = runTrace(scenario)
    writeGoldenTrace(path, trace)
    expect(readGoldenTrace(path)).toEqual(trace)
    expect(() => expectSameTrace(readGoldenTrace(path), runTrace(scenario))).not.toThrow()
  })

  it('should throw rather than silently pass when the golden file is missing', () => {
    // A missing golden file must never read as "nothing to compare, so fine".
    expect(() => readGoldenTrace(tempPath('absent.json'))).toThrow()
  })
})
