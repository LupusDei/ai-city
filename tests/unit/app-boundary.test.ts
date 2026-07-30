/**
 * Architecture-fitness test for spec 005 FR-004 and `aic-8tl.5`'s acceptance criterion:
 * "an automated check fails if any component imports sim internals directly".
 *
 * WHAT THIS ENFORCES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * FR-004 says all player actions go through a single intent-dispatch surface "so the UI
 * never mutates sim state directly". That is a rule about STATE TRANSITIONS, not about
 * every sim import: FR-002 in the same spec REQUIRES the app to derive what it displays
 * from the sim modules, so a component reading `time.totalTurns(config)` or
 * `grid.tileAt(grid, coord)` to format a readout is the spec working as intended, not a
 * violation. A gate that banned every sim import from `.tsx` would force the adapter to
 * grow a formatting layer — and "no game logic in components" would be traded for a pile
 * of game logic in the adapter, which is worse: it would be logic nothing in `src/sim/`
 * could test.
 *
 * So the line this test draws is the one FR-004 actually draws. Exactly one directory,
 * `src/app/state/`, may call the sim functions that CREATE OR CHANGE sim state. Everything
 * else under `src/app/` may read and format, and must dispatch an intent to change
 * anything. The consequence is the property the bead asks for: a rejected intent, a
 * resolved turn and a started colony all have exactly one code path, so there is nowhere
 * for a second, divergent one to appear.
 *
 * WHY A TEST RATHER THAN A LINT RULE. Same reason as `tests/integration/composition-audit.test.ts`:
 * a linter reasons about one file at a time, and "which directory is allowed to do this"
 * is a property of the tree.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { stripNonCode } from '../support/strip-non-code'

const PROJECT_ROOT = join(import.meta.dirname, '..', '..')
const APP_DIR = join(PROJECT_ROOT, 'src', 'app')

/**
 * The one directory allowed to call a sim state transition — the adapter's home.
 * `src/`-relative and POSIX-shaped, matched against the keys built by `readAppSources`.
 */
const ADAPTER_DIR = 'app/state/'

/**
 * Sim functions that CREATE OR CHANGE simulation state, or that decide the outcome of a
 * player action. Calling one of these is, by definition, driving the sim rather than
 * displaying it — which is the adapter's job and nobody else's.
 *
 * Grouped by what a stray call would actually break:
 *
 *   THE SESSION'S WORLD. `generateWorld` must run exactly once per seed. A second caller
 *   re-rolls the map underneath a player mid-decision (AC-1.3, and the `aic-c1p` defect
 *   class one layer up).
 *
 *   THE LANDING DECISION. The adapter stores the sim's `LandingReadiness` on state. A
 *   component that re-evaluated it would be a second source of truth for the score and
 *   the rejection the player is looking at.
 *
 *   THE COLONY AND THE TURN LOOP. Starting a colony and resolving a turn are the two
 *   transitions the whole spec is about. `resolveTurn` in particular must stay behind the
 *   exactly-one-turn guard in `dispatch`; a component calling it directly would sidestep
 *   that guard and silently spend turns from a 278-turn budget.
 *
 *   ORDERS AND CONSTRUCTION. `applyOrders` is the typed intent layer; the
 *   `construction.ts` functions are what it is built from. A component reaching past it
 *   would be reimplementing order validation, which is exactly what FR-004 forbids.
 */
const SIM_TRANSITIONS: readonly string[] = [
  // The session's world
  'generateWorld',
  // The landing decision
  'evaluateLanding',
  'evaluateLandingOn',
  'validateLandingSite',
  'scoreLandingSite',
  // The colony and the turn loop
  'createColony',
  'buildColony',
  'startMission',
  'resolveTurn',
  // Orders and construction
  'applyOrders',
  'queueConstruction',
  'enqueueProject',
  'cancelProject',
  'releaseTiles',
  'advanceConstruction',
  // The turn loop's own sub-steps, for completeness: a component that assembled these
  // itself would be reimplementing turn resolution rather than reading its report.
  'resolveElectricity',
  'resolveBrownout',
  'applyLedger',
  'evaluateMission',
]

/**
 * One offending call site, located to the FILE rather than to a line.
 *
 * Deliberately no line number: `stripNonCode` DELETES comment and literal spans rather
 * than blanking them in place, so an index into its output does not map back to a line in
 * the original. The two ways to recover one — a second, position-preserving masker
 * (duplicating scanner logic this repo has already learned not to duplicate) or a fuzzy
 * re-scan of the raw text — are both worse than telling the developer the file and the
 * call and letting `grep -n` do the rest. Detection itself is exact; only the coordinate
 * is coarse.
 */
interface Violation {
  readonly file: string
  readonly call: string
  /** How many times this file calls it. */
  readonly count: number
}

// ---------------------------------------------------------------------------
// The checker
// ---------------------------------------------------------------------------

/** Every `.ts`/`.tsx` file under `src/app`, keyed by its `src/`-relative POSIX path. */
function readAppSources(): ReadonlyMap<string, string> {
  const sources = new Map<string, string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const key = relative(join(PROJECT_ROOT, 'src'), path).split(sep).join('/')
        sources.set(key, readFileSync(path, 'utf8'))
      }
    }
  }
  walk(APP_DIR)
  return sources
}

function isAdapter(file: string): boolean {
  return file.startsWith(ADAPTER_DIR)
}

/**
 * Find calls to a sim state transition outside the adapter directory.
 *
 * Runs on `stripNonCode`'d text — the same scanner the composition ratchet uses — so a
 * function name mentioned in a doc comment or a string is not mistaken for a call.
 */
function auditAppSources(sources: ReadonlyMap<string, string>): Violation[] {
  const violations: Violation[] = []

  for (const [file, source] of sources) {
    if (isAdapter(file)) continue
    const code = stripNonCode(source)
    for (const name of SIM_TRANSITIONS) {
      // A call, not a mention: the name followed by an open paren. An `import` line does
      // not match, and an unused import is already a lint error, so import-only detection
      // would add nothing this does not cover.
      const count = [...code.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length
      if (count > 0) violations.push({ file, call: name, count })
    }
  }

  // Sorted by file then call name — never by `Map` iteration order — so the report reads
  // the same way on every machine.
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.call.localeCompare(b.call))
}

function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `  src/${v.file}  calls ${v.call}()${v.count > 1 ? ` (x${v.count})` : ''}`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// The checker's own correctness, on synthetic sources
// ---------------------------------------------------------------------------

describe('auditAppSources', () => {
  it('should flag a component that resolves a turn itself', () => {
    const violations = auditAppSources(
      new Map([['app/OpsScreen.tsx', "import { resolveTurn } from '../sim/turn'\nresolveTurn(colony)\n"]]),
    )
    expect(violations).toEqual([{ file: 'app/OpsScreen.tsx', call: 'resolveTurn', count: 1 }])
  })

  it('should NOT flag the same call inside the adapter directory', () => {
    const violations = auditAppSources(
      new Map([['app/state/game-state.ts', 'resolveTurn(colony)\n']]),
    )
    expect(violations).toEqual([])
  })

  it('should NOT flag a read-only sim call a component is entitled to make', () => {
    // FR-002 requires components to derive what they display from the sim. Formatting a
    // turn counter or reading a tile is that requirement being met, not a violation.
    const violations = auditAppSources(
      new Map([
        [
          'app/OpsScreen.tsx',
          'const total = totalTurns(config)\nconst left = turnsRemaining(config, taken)\nconst t = tileAt(grid, coord)\n',
        ],
      ]),
    )
    expect(violations).toEqual([])
  })

  it('should NOT flag a transition named only in a comment or a string', () => {
    const violations = auditAppSources(
      new Map([
        [
          'app/SurveyScreen.tsx',
          '// dispatch an intent instead of calling resolveTurn(colony)\nconst hint = "never call resolveTurn(colony) here"\n',
        ],
      ]),
    )
    expect(violations).toEqual([])
  })

  it('should report every distinct violating call in a file, sorted by name', () => {
    const violations = auditAppSources(
      new Map([
        [
          'app/SurveyScreen.tsx',
          'generateWorld(64, 64, seed)\nconst x = 1\nbuildColony(params)\nbuildColony(other)\n',
        ],
      ]),
    )
    expect(violations).toEqual([
      { file: 'app/SurveyScreen.tsx', call: 'buildColony', count: 2 },
      { file: 'app/SurveyScreen.tsx', call: 'generateWorld', count: 1 },
    ])
  })

  it('should return nothing for an app tree with no sim calls at all', () => {
    expect(auditAppSources(new Map([['app/Shell.tsx', 'export const x = 1\n']]))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The actual gate, over src/app/ as it stands right now
// ---------------------------------------------------------------------------

describe('the UI never mutates sim state directly (FR-004)', () => {
  const sources = readAppSources()

  it('should have found the app sources, so the assertions below are not vacuous', () => {
    expect([...sources.keys()]).toEqual(
      expect.arrayContaining(['app/App.tsx', 'app/state/game-state.ts']),
    )
  })

  it('should contain zero sim state transitions outside src/app/state/', () => {
    const violations = auditAppSources(sources)
    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} sim state transition(s) called outside the adapter:\n` +
          `${formatViolations(violations)}\n\n` +
          'spec 005 FR-004: every player action goes through the ONE intent-dispatch\n' +
          'surface in src/app/state/game-state.ts, so the UI never mutates sim state\n' +
          'directly. To fix this:\n' +
          '  - to CHANGE something, dispatch an intent:\n' +
          '        setGame((current) => dispatch(current, { kind: "end-cycle", ... }))\n' +
          '    adding a new action to `GameAction` if none of them fits;\n' +
          '  - to DISPLAY something, read it off the state the adapter already stores\n' +
          '    (world, colony, landing, readiness, rejection, lastReport, outlook,\n' +
          '    orderOutcomes) — those ARE the sim\'s own values, stored unchanged;\n' +
          '  - PURE READS are fine here and are not on this list: time.totalTurns,\n' +
          '    time.turnsRemaining, grid.tileAt, world.depositCoords and friends.\n' +
          'Do not widen ADAPTER_DIR or delete a name from SIM_TRANSITIONS to get past\n' +
          'this — that removes the property the gate exists to hold.',
      )
    }
    expect(violations).toEqual([])
  })

  it('should have the adapter genuinely driving the sim — the positive half', () => {
    // A gate that can only observe failure is half a gate: if the adapter ever stopped
    // calling these, `src/app/` would trivially satisfy the rule above while the game
    // stopped working. This is also a second lock on spec 005's SC-003 ("the engine has
    // ignition"), alongside the composition ratchet.
    const adapter = [...sources]
      .filter(([file]) => isAdapter(file))
      .map(([, source]) => stripNonCode(source))
      .join('\n')

    for (const required of [
      'generateWorld',
      'evaluateLandingOn',
      'buildColony',
      'resolveTurn',
      'applyOrders',
    ]) {
      expect(adapter).toMatch(new RegExp(`\\b${required}\\s*\\(`))
    }
  })
})
