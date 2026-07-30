/**
 * The multi-turn integration / golden-trace harness (aic-a00.7 scaffolding).
 *
 * WHY THIS LANDS BEFORE THE TURN LOOP DOES. The turn loop (aic-a00.6) cannot be
 * written yet: two of the five closed sim-core modules it must compose
 * (`power.ts`, `construction.ts`) do not exist on this branch or on main — see
 * docs/turn-composition-audit.md M1. But the harness a multi-turn test needs is
 * independent of what the step function actually does, so it can be built,
 * tested, and reviewed now against an injected step. Phase 2 supplies the real
 * `resolveTurn` and changes nothing here.
 *
 * That inversion is not just scheduling convenience. The harness's job is to
 * catch nondeterminism in the sim, and a harness that is only ever exercised
 * against the real (hopefully deterministic) sim is never actually observed
 * DETECTING anything. Injecting the step lets `turn-harness.test.ts` feed it a
 * deliberately nondeterministic step and assert that it fails loudly — so the
 * detector is itself under test, not merely assumed to work.
 *
 * Deliberately NOT a vitest suite (no `.test.ts` suffix, so `vitest.config.ts`'s
 * `include: ['tests/**\/*.test.ts']` does not collect it). It is a helper
 * module; `turn-harness.test.ts` is its suite.
 */

import { expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Canonical serialisation
// ---------------------------------------------------------------------------

/**
 * Serialise `value` to a stable, diffable string.
 *
 * Two deliberate decisions, both of which shape what the golden trace can catch:
 *
 *   - OBJECT KEY ORDER IS NORMALISED (keys sorted). Key order is not a value
 *     contract anywhere in this sim — `ledger.ts` sorts its resource keys for
 *     exactly this reason, and a `Stockpile` built by adding resources in a
 *     different order is the SAME stockpile. Normalising means a golden file
 *     stays reviewable and does not fail spuriously when an unrelated change
 *     alters insertion order.
 *   - ARRAY ORDER IS PRESERVED EXACTLY. This is where Map/Set iteration leakage
 *     actually surfaces in this codebase: every ordering the sim treats as
 *     meaningful (`poweredIds`, `shedIds`, `offlineDroneIds`, `balances`, a
 *     `ConstructionQueue`) is an array. So the leak class aic-a00.7 exists to
 *     catch is caught, while the noise class is not.
 *
 * `undefined` inside objects is dropped by `JSON.stringify`, which would make
 * `{a: undefined}` and `{}` indistinguishable; it is mapped to an explicit
 * marker instead so an accidentally-undefined field is visible in a diff rather
 * than silently absent. Non-finite numbers are likewise marked rather than
 * becoming `null` — a `NaN` that appeared in a stockpile must be impossible to
 * miss.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value), null, 2)
}

function canonicalValue(value: unknown): unknown {
  if (value === undefined) return '<undefined>'
  if (typeof value === 'number' && !Number.isFinite(value)) return `<${String(value)}>`
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalValue)

  // A Map or Set reaching a trace snapshot is itself a finding: `JSON.stringify`
  // renders both as `{}`, silently erasing their contents. Surfacing them as a
  // marked, ORDERED list makes the leak visible in the diff instead.
  if (value instanceof Map) {
    return { '<Map>': [...value.entries()].map(([k, v]) => [canonicalValue(k), canonicalValue(v)]) }
  }
  if (value instanceof Set) {
    return { '<Set>': [...value.values()].map(canonicalValue) }
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const out: Record<string, unknown> = {}
  for (const [key, member] of entries) out[key] = canonicalValue(member)
  return out
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

/**
 * One turn of the sim: `(state, turnIndex) -> nextState`.
 *
 * `turnIndex` is the count of turns already taken when the step is invoked (so
 * the first call receives `0`), matching `time.ts`'s `turnsTaken` convention
 * exactly — `turnsRemaining(config, 0)` is a fresh mission. Phase 2's
 * `resolveTurn` is expected to satisfy this signature directly.
 */
export type TurnStep<State> = (state: State, turnIndex: number) => State

/**
 * Reduces a full state to just the part a golden trace should pin.
 *
 * A projection, rather than snapshotting whole state, because a trace that
 * pins EVERYTHING pins the grid's 4,096 tile objects too — the file becomes
 * unreviewable and every unrelated refactor breaks it, which is how golden
 * tests get deleted. Pin the aggregates that are supposed to be stable
 * (stockpiles, turn count, capacity, who was shed) and let the rest move.
 */
export type Projection<State> = (state: State, turnIndex: number) => unknown

/** One recorded turn: the turn index, and the canonicalised projection after it. */
export interface TraceEntry {
  /** Turns taken AFTER this step ran, i.e. `turnIndex + 1`. */
  readonly turn: number
  readonly snapshot: string
}

/** A full recorded run. `label` and `seed` exist so a golden file identifies its own scenario. */
export interface Trace {
  readonly label: string
  readonly seed: number | null
  readonly entries: readonly TraceEntry[]
}

export interface RunTraceOptions<State> {
  readonly label: string
  readonly seed?: number
  /** Fresh initial state. A FACTORY, not a value — see `runTrace`. */
  readonly initial: () => State
  readonly step: TurnStep<State>
  readonly turns: number
  readonly project: Projection<State>
  /**
   * Assert the step neither mutates the state handed to it nor returns that
   * same object (aic-a00.6: "returns a NEW state and does not mutate the
   * input"). On by default: this is the property most likely to be broken by an
   * innocent-looking optimisation, and cheapest to catch here.
   */
  readonly assertNoMutation?: boolean
}

/**
 * Run `step` for `turns` turns, recording a canonical snapshot after each.
 *
 * `initial` is a FACTORY rather than a value on purpose: `expectDeterministic`
 * must be able to start two runs from genuinely independent state, and sharing
 * one mutable initial object between them would let a mutation bug in the step
 * make both runs agree — the two runs would be identically wrong and the check
 * would pass. Threading a factory makes that impossible to get wrong.
 *
 * @throws {RangeError} if `turns` is not a non-negative integer.
 * @throws {Error} if `assertNoMutation` is enabled and the step mutates or
 *   returns its input state, naming the turn on which it happened.
 */
export function runTrace<State>(options: RunTraceOptions<State>): Trace {
  const { label, initial, step, turns, project } = options
  const assertNoMutation = options.assertNoMutation ?? true

  if (!Number.isInteger(turns) || turns < 0) {
    throw new RangeError(`turns must be a non-negative integer, received: ${turns}`)
  }

  const entries: TraceEntry[] = []
  let state = initial()

  for (let turnIndex = 0; turnIndex < turns; turnIndex++) {
    const before = assertNoMutation ? canonicalize(state) : ''
    const previous = state

    state = step(state, turnIndex)

    if (assertNoMutation) {
      if (state === previous) {
        throw new Error(
          `Turn ${turnIndex} returned the SAME state object it was given. A turn must ` +
            'return a new state (aic-a00.6), so that a caller can diff old against new.',
        )
      }
      const after = canonicalize(previous)
      if (after !== before) {
        throw new Error(
          `Turn ${turnIndex} MUTATED the state it was given.\n` +
            `--- before ---\n${before}\n--- after ---\n${after}`,
        )
      }
    }

    entries.push({ turn: turnIndex + 1, snapshot: canonicalize(project(state, turnIndex)) })
  }

  return { label, seed: options.seed ?? null, entries }
}

// ---------------------------------------------------------------------------
// Divergence
// ---------------------------------------------------------------------------

/** Where two traces first stop agreeing. */
export interface Divergence {
  /** The turn number (1-based, as recorded) at which they first differ. */
  readonly turn: number
  readonly expected: string
  readonly actual: string
  /** A ready-to-print explanation naming the diverging turn. */
  readonly message: string
}

/**
 * The FIRST turn at which two traces disagree, or `null` if they agree
 * entirely.
 *
 * First rather than all: once turn 12 diverges, turns 13 onward are almost
 * always consequences, and a failure report listing 260 differing turns buries
 * the one that matters. aic-a00.7 requires the failure message to make the
 * diverging turn obvious, so the harness finds it rather than leaving a human
 * to scan a diff for it.
 *
 * A length mismatch is reported as a divergence at the first missing turn, so
 * "the run stopped early" and "the run produced the wrong value" surface
 * through one code path rather than needing two different assertions.
 */
export function findDivergence(expected: Trace, actual: Trace): Divergence | null {
  const shared = Math.min(expected.entries.length, actual.entries.length)

  for (let index = 0; index < shared; index++) {
    // Safe: `index < shared <= entries.length` for both.
    const expectedEntry = expected.entries[index] as TraceEntry
    const actualEntry = actual.entries[index] as TraceEntry
    if (expectedEntry.snapshot !== actualEntry.snapshot) {
      return {
        turn: expectedEntry.turn,
        expected: expectedEntry.snapshot,
        actual: actualEntry.snapshot,
        message: describeDivergence(expected, actual, expectedEntry.turn, index),
      }
    }
  }

  if (expected.entries.length !== actual.entries.length) {
    const turn = shared + 1
    return {
      turn,
      expected: expected.entries[shared]?.snapshot ?? '<no such turn>',
      actual: actual.entries[shared]?.snapshot ?? '<no such turn>',
      message:
        `Trace length mismatch: expected ${expected.entries.length} turns, got ` +
        `${actual.entries.length}. First missing/extra turn: ${turn}.`,
    }
  }

  return null
}

function describeDivergence(expected: Trace, actual: Trace, turn: number, index: number): string {
  const head =
    `DETERMINISM BROKEN at turn ${turn} (entry ${index} of ${expected.entries.length}).\n` +
    `Scenario "${expected.label}", seed ${String(expected.seed)}.\n` +
    `Turns 1..${turn - 1} matched exactly; turn ${turn} did not.\n`

  const previous = index > 0 ? (expected.entries[index - 1] as TraceEntry).snapshot : null
  const context =
    previous === null
      ? 'This is the FIRST turn, so the divergence is in the initial state or in turn 1 itself.\n'
      : `Last agreeing snapshot (turn ${turn - 1}):\n${previous}\n`

  return (
    head +
    context +
    `\n--- expected (turn ${turn}) ---\n${(expected.entries[index] as TraceEntry).snapshot}\n` +
    `\n--- actual (turn ${turn}) ---\n${(actual.entries[index] as TraceEntry).snapshot}\n` +
    '\nIf this appeared without an intentional sim change, suspect: Math.random, Date.now, ' +
    'new Date, Map/Set iteration order reaching an output, localeCompare, or float ' +
    'accumulation across turns.'
  )
}

/**
 * Assert two traces are identical, failing with the diverging turn named.
 *
 * Uses a bare `expect(...).toBe(...)` on a message string rather than
 * `expect(actual).toEqual(expected)` deliberately: vitest's structural diff on
 * a 278-entry trace is unreadable, whereas this reports exactly one turn and
 * the last turn that still agreed.
 */
export function expectSameTrace(expected: Trace, actual: Trace): void {
  const divergence = findDivergence(expected, actual)
  if (divergence !== null) {
    // `toBe` against the empty string always fails here; the message IS the report.
    expect(divergence.message).toBe('')
  }
  expect(divergence).toBeNull()
}

/**
 * Run the same scenario twice from independent initial state and assert the two
 * traces are identical, returning the (single, canonical) trace.
 *
 * This is the check that catches unseeded randomness, wall-clock reads and
 * iteration-order leakage WITHOUT needing a committed golden file — so it is
 * usable on any scenario, including ones whose expected values nobody has
 * computed by hand yet. The committed golden file (Phase 2) additionally
 * catches a change that is deterministic but wrong; the two are complementary
 * and neither replaces the other.
 */
export function expectDeterministic<State>(options: RunTraceOptions<State>): Trace {
  const first = runTrace(options)
  const second = runTrace(options)
  expectSameTrace(first, second)
  return first
}

// ---------------------------------------------------------------------------
// Golden files
// ---------------------------------------------------------------------------

/**
 * Serialise a trace for committing to the repository.
 *
 * Plain JSON with the snapshots kept as pre-canonicalised strings: the file is
 * line-diffable in review, so a pull request that changes the sim's behaviour
 * SHOWS that change as a diff rather than as an opaque hash mismatch. A golden
 * file whose diff a reviewer cannot read is a golden file that gets regenerated
 * on autopilot the first time it fails.
 */
export function serializeTrace(trace: Trace): string {
  return `${JSON.stringify(trace, null, 2)}\n`
}

/** Parse a golden trace file written by `serializeTrace`. */
export function parseTrace(contents: string): Trace {
  return JSON.parse(contents) as Trace
}

/** Read a committed golden trace. Throws (rather than returning a default) if absent — a missing golden file must never silently pass. */
export function readGoldenTrace(path: string): Trace {
  return parseTrace(readFileSync(path, 'utf8'))
}

/**
 * Write a golden trace.
 *
 * Deliberately NOT called from any test's assertion path, and deliberately not
 * gated behind an env var that a failing CI run could set: a golden trace that
 * regenerates itself when it fails asserts nothing at all. Regeneration is a
 * human action, run on purpose, and reviewed as a diff.
 */
export function writeGoldenTrace(path: string, trace: Trace): void {
  writeFileSync(path, serializeTrace(trace), 'utf8')
}
