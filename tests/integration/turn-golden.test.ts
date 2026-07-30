/**
 * Determinism regression harness — the committed golden trace (aic-a00.7).
 *
 * Guards the single most important property of the sim: reproducibility. A fixed
 * scenario runs for a fixed number of turns and the full state trace is asserted
 * against `turn-golden.json`. Any accidental nondeterminism — `Math.random`,
 * `Date.now`, Map/Set iteration order reaching an output, `localeCompare`, float
 * accumulation across turns — breaks this loudly and names the diverging turn.
 *
 * TWO COMPLEMENTARY CHECKS, and neither replaces the other:
 *   - `expectDeterministic` runs the scenario TWICE from independent initial state and
 *     compares. This catches nondeterminism without anyone having computed an expected
 *     value, so it works on any scenario.
 *   - The committed golden additionally catches a change that is perfectly
 *     deterministic but WRONG — a balance tweak, a reordered brownout, a unit slip.
 *
 * The harness itself (`turn-harness.ts`) is separately tested in
 * `turn-harness.test.ts`, which plants `Math.random`, a wall-clock read, cross-run
 * float drift and state mutation into a fake step and asserts the harness catches each
 * one. A detector nobody has watched detect anything is not a detector.
 *
 * REGENERATING THE GOLDEN is a deliberate human action, never automatic — a golden that
 * rewrites itself when it fails asserts nothing. Run:
 *
 *     npx tsx scripts/record-golden-trace.ts
 *
 * and review the resulting diff as the behaviour change it represents. The file is
 * line-diffable JSON precisely so that review is possible; a golden whose diff nobody
 * can read gets regenerated on autopilot the first time it fails.
 *
 * NOTE ON THE PRNG STREAM: the terrain fingerprint below depends on `terrain.seed` and
 * the exact sequence of `mulberry32` draws. `aic-m3t`'s unconditional deposit-kind draw
 * shifted that stream, so deposit positions for a given seed differ from pre-m3t
 * output. This baseline was recorded AFTER m3t. A future change to the draw order will
 * break this test — which is correct, and is the whole point.
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import {
  expectDeterministic,
  expectSameTrace,
  findDivergence,
  readGoldenTrace,
  runTrace,
} from './turn-harness'
import {
  GOLDEN_SCENARIO,
  GOLDEN_TURNS,
  goldenProjection,
  goldenStep,
  initialGoldenState,
} from './golden-scenario'
import type { GoldenSnapshot } from './golden-scenario'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(HERE, 'turn-golden.json')

const scenario = {
  label: GOLDEN_SCENARIO.label,
  seed: GOLDEN_SCENARIO.seed,
  initial: initialGoldenState,
  step: goldenStep,
  turns: GOLDEN_TURNS,
  project: goldenProjection,
}

describe('golden trace', () => {
  it('should match the committed golden trace exactly', () => {
    // THE regression lock. If this fails, either the sim's behaviour changed (review the
    // diff and regenerate deliberately) or determinism broke (fix the sim).
    expectSameTrace(readGoldenTrace(GOLDEN_PATH), runTrace(scenario))
  })

  it('should be reproducible without reference to the committed file', () => {
    // Catches nondeterminism even if the golden were stale or missing.
    expectDeterministic(scenario)
  })

  it('should cover enough turns for cross-turn drift to appear', () => {
    // A one-turn trace cannot show accumulation errors, which are the failure mode the
    // integer discipline exists to prevent. This scenario runs long enough that a
    // per-turn error of one part in 1e15 would be visible.
    const trace = readGoldenTrace(GOLDEN_PATH)
    expect(trace.entries).toHaveLength(GOLDEN_TURNS)
    expect(GOLDEN_TURNS).toBeGreaterThanOrEqual(12)
  })

  it('should exercise a brownout, a recovery, a re-shedding, completions and production', () => {
    // A golden over a scenario where nothing interesting happens locks in nothing. This
    // asserts the SCENARIO still has teeth: if a future balance change made the colony
    // trivially power-rich, the golden would keep passing while silently ceasing to
    // guard the brownout path at all.
    //
    // The recorded arc, and it is a real story: turn 1 opens in a brownout on one
    // reactor; turn 2 sheds the hopper; turn 3 has three reactors and everything runs;
    // then the two habitats come online, outrank drone charging, and push both
    // processors permanently off the grid. Building habitats killed the industry —
    // which is exactly the tension the design is built on.
    // Parsed into a declared type, not left as `any`. An assertion written against an
    // `any` passes happily on a misspelled field, which would silently disable exactly
    // the checks that keep this golden from going toothless.
    const snapshots: GoldenSnapshot[] = readGoldenTrace(GOLDEN_PATH).entries.map(
      (entry) => JSON.parse(entry.snapshot) as GoldenSnapshot,
    )

    const brownoutTurns = snapshots.filter((s) => s.electricity?.brownout === true)
    const cleanTurns = snapshots.filter((s) => s.electricity?.brownout === false)
    expect(brownoutTurns.length).toBeGreaterThan(0)
    expect(cleanTurns.length).toBeGreaterThan(0) // a recovery genuinely happens

    // Structures were shed, so the cut line and the no-backfill rule are exercised.
    expect(snapshots.some((s) => (s.electricity?.shedStructureIds.length ?? 0) > 0)).toBe(true)
    // Completions happened, so the operational freeze is exercised.
    expect(snapshots.some((s) => s.completedThisTurn.length > 0)).toBe(true)

    // Real production reached a stockpile, and habitat capacity was earned.
    const last = snapshots.at(-1)
    expect(last).toBeDefined()
    expect(last?.stockpiles.regolith).toBeGreaterThan(0)
    expect(last?.stockpiles.sinteredPlate).toBeGreaterThan(0)
    expect(last?.habitatCapacity).toBe(16)

    // And electricity never accumulated, over every recorded turn.
    for (const snapshot of snapshots) {
      expect(snapshot.stockpiles.electricity).toBe(0)
    }
  })

  it('should make a planted divergence name the diverging turn', () => {
    // aic-a00.7's acceptance criterion: "the test failure message makes the diverging
    // tick obvious". Proven by PLANTING a divergence at a known turn rather than hoped
    // for — the same negative-control instinct the coverage gate was proven with.
    //
    // Inspects `findDivergence`'s report directly rather than catching what
    // `expectSameTrace` throws, because vitest truncates a long assertion message and
    // the whole point here is the message's CONTENT.
    const golden = readGoldenTrace(GOLDEN_PATH)
    const tampered = {
      ...golden,
      entries: golden.entries.map((entry, index) =>
        index === 4 ? { ...entry, snapshot: `${entry.snapshot}\n"planted": true` } : entry,
      ),
    }

    const divergence = findDivergence(tampered, runTrace(scenario))
    expect(divergence).not.toBeNull()
    expect(divergence!.turn).toBe(5)
    expect(divergence!.message).toContain('DETERMINISM BROKEN at turn 5')
    expect(divergence!.message).toContain('Turns 1..4 matched exactly')
    expect(divergence!.message).toContain('Last agreeing snapshot (turn 4)')
    // Names the usual suspects, so a reader is not left guessing where to look.
    expect(divergence!.message).toContain('Math.random')
    expect(divergence!.message).toContain(GOLDEN_SCENARIO.label)
  })

  it('should fail loudly rather than pass if the golden file went missing', () => {
    // A missing golden must never read as "nothing to compare against, so fine".
    expect(() => readGoldenTrace(join(HERE, 'no-such-golden.json'))).toThrow()
  })
})
