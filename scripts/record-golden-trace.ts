/**
 * Record the golden trace for `tests/integration/turn-golden.test.ts` (aic-a00.7).
 *
 *     npx tsx scripts/record-golden-trace.ts
 *
 * WHY THIS IS A SCRIPT AND NOT A FLAG ON THE TEST. A golden trace that regenerates
 * itself when it fails asserts nothing at all — and if regeneration were gated behind
 * an environment variable, a CI run could set it and the guard would evaporate exactly
 * when it mattered. Regeneration is a deliberate human action whose output is reviewed
 * as a diff, so it lives outside the test process entirely.
 *
 * The scenario is imported from `tests/integration/golden-scenario.ts`, the same module
 * the test replays, so a recorded golden can never describe a different colony than the
 * one being asserted.
 *
 * WHEN TO RUN IT: only after an INTENDED behaviour change, and then read the diff. A
 * changed line is a changed game rule. If the diff surprises you, the sim changed in a
 * way you did not mean and the fix is in `src/sim`, not here.
 */

import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GOLDEN_SCENARIO,
  GOLDEN_TURNS,
  goldenProjection,
  goldenStep,
  initialGoldenState,
} from '../tests/integration/golden-scenario'
import { runTrace, writeGoldenTrace } from '../tests/integration/turn-harness'

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = join(HERE, '..', 'tests', 'integration', 'turn-golden.json')

const trace = runTrace({
  label: GOLDEN_SCENARIO.label,
  seed: GOLDEN_SCENARIO.seed,
  initial: initialGoldenState,
  step: goldenStep,
  turns: GOLDEN_TURNS,
  project: goldenProjection,
})

writeGoldenTrace(GOLDEN_PATH, trace)

// eslint-disable-next-line no-console -- a recording script's whole job is to report what it wrote
console.log(
  `Recorded ${trace.entries.length} turns of "${trace.label}" (seed ${String(trace.seed)}) to ${GOLDEN_PATH}`,
)
