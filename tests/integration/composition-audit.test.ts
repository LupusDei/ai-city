/**
 * Architecture-fitness test: the composition ratchet.
 *
 * WHY THIS EXISTS. This project's most expensive defect class is not a wrong
 * calculation — it is a module that is never wired to anything. It has now happened
 * three times:
 *
 *   1. `aic-c1p` — `generateDeposits` had exactly ONE caller, its own unit test.
 *      `landing.ts` never imported `buildability.ts`. Deposit proximity carried 35%
 *      of the landing-site score, driven by data no production code produced. Two
 *      beads closed green at 100% coverage over it.
 *   2. `aic-8eq` — the same thing, systemically: EVERY top-level sim operation had
 *      zero production callers. Ten excellent modules, 100% coverage, and the game
 *      could not run a single turn.
 *   3. `aic-ck0` — `scale.ts` orphaned ONE COMMIT after `aic-8eq` closed, which means
 *      spec 002's "berm cost derived from the tile-edge constant" would pass today
 *      with a hand-typed literal.
 *
 * A unit test on either side of a missing seam passes. Coverage cannot see it either:
 * an orphaned module can sit at 100% coverage forever, because its own tests cover it
 * perfectly. So neither of the two gates this project already trusts can detect the
 * defect, which is exactly why it recurred twice after being found and fixed once.
 *
 * This test closes that. It is a RATCHET, not a purity gate: the orphan set is allowed
 * to shrink freely and is NOT allowed to grow. Adding a new unwired export fails here
 * and forces a conscious decision — wire it, or add it below with a reason.
 *
 * Deliberately NOT a lint rule: linters reason about one file at a time, and this is a
 * whole-graph property.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { stripNonCode } from '../support/strip-non-code'

const SIM_DIR = join(import.meta.dirname, '../../src/sim')
const SRC_DIR = join(import.meta.dirname, '../../src')

/**
 * Exports with no production consumer that are ACCEPTED, each for a stated reason.
 *
 * Two legitimate categories, and the distinction matters — conflating them is how a
 * real orphan hides behind a plausible one:
 *
 *   PUBLIC API AWAITING ITS CALLER — the outermost entry points. `resolveTurn` is the
 *   sim's front door; it is *supposed* to be called by an application layer, and that
 *   layer does not exist yet (`aic-hfb`). These are correct today and must NOT be
 *   removed to satisfy this test.
 *
 *   GENUINE ORPHANS, tracked — helpers whose intended consumer is a chain bead not yet
 *   built. `scale.*` is the live example (`aic-ck0`): chain 1's Shield Berm is meant to
 *   derive its 450 t from `arealMassKg`, and until it does, the derivation is
 *   decorative. These SHOULD disappear from this list over time. If one is still here
 *   when its chain lands, the chain hand-typed a literal instead.
 */
const ACCEPTED_ORPHANS: readonly string[] = [
  // Called only from inside `landing.ts` itself (by `evaluateLanding`), and this audit
  // counts cross-file callers only — so these are orphans by its definition, not by design.
  'landing.scoreLandingSite',
  'landing.validateLandingSite',
  'catalog.listStructureTypes',

  // --- Chain 1's authored catalog data, awaiting the build menu (aic-d8y.1.2) ---
  // `catalog-data.ts` IS the player's build menu, and the sim/UI adapter that offers a
  // build menu (aic-8tl.5) does not exist yet — so this is the "public API awaiting its
  // caller" category, not a helper nobody wired. It is not pre-placed into the starting
  // colony on purpose: chain 1 is buildable, not landed. When the adapter lands, this
  // entry must be DELETED rather than left here.
  'catalog-data.chainOneStructureSpecs',

  'colony-start.startMission',

  // --- Intended consumer is a chain bead not yet built ---
  //
  // TWO ENTRIES LEFT THIS LIST IN aic-d8y.1.2, and that ratchet movement IS what closed
  // aic-ck0. `src/sim/catalog-data.ts` derives the Shield Berm's 450 t of fill and 7.5 t
  // of crust — and the Regolith Hopper's pile cap — through `scale.arealMassKg` and
  // `scale.arealDensityKgPerM2`, so those two now have a real production consumer:
  //   scale.arealMassKg, scale.arealDensityKgPerM2
  // Do not re-add either without deleting the derivation that wired them; a hand-typed
  // 450_000_000 is precisely what aic-ck0 says would otherwise pass every test.
  //
  // The two below are now reached IN PRODUCTION, but only from inside `scale.ts` itself
  // (`arealMassKg` -> `footprintAreaM2` -> `tileAreaForEdgeM2`), and this audit counts
  // cross-file callers only — so they are orphans by its definition rather than by design,
  // the same category as `landing.scoreLandingSite` above. They are no longer decorative:
  // the square law they implement is what makes the berm cost move with the tile edge.
  // Balance-pass surfaces (aic-oby.4): measurement and scripted-strategy code. Their
  // production caller is scripts/balance-report.ts, which is outside src/ and therefore
  // invisible to this scan; tests/integration/balance-pass.test.ts is the gate that
  // proves they genuinely run.
  'catalog-data-core.coreStructureSpecs',
  'mission-runner.runMission',
  'balance-strategies.createBalanceStrategies',
  'scale.tileAreaForEdgeM2',
  'scale.footprintAreaM2',
  'buildability.eligibleDepositKinds', // chains 2 and 3 deposit-gated siting
  'construction.createProject',
  'construction.occupiedTiles',
  'construction.requiredLabourHoursPerBuildTurn',
  'construction.totalLabourHoursRequired',
  'construction.turnsCompletedFor',
  'ledger.computeBalances',
  'brownout.comparePowerDemands',
  'placement.resolveFootprint',
  'time.elapsedSeconds',

  // --- Arrived with stetmann's power-source and orders work; consumer pending ---
  // aic-5lq removed the hardcoded reactor constant in favour of a registry. The
  // registry's writer is authored catalog data, so nothing calls it yet.
  'generation.registerOutputModel',
]

interface Audit {
  readonly orphans: readonly string[]
  readonly wired: readonly string[]
}

/**
 * Reads every `.ts` file directly under `src/sim` from disk. Split out from
 * `auditModules` (the actual audit logic) so that logic can be unit-tested
 * against synthetic in-memory fixtures without touching the filesystem — see
 * the "caller detection ignores comments and strings" tests below.
 */
function readSimSources(): ReadonlyMap<string, string> {
  const files = readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts'))
  const source = new Map<string, string>()
  for (const file of files) source.set(file, readFileSync(join(SIM_DIR, file), 'utf8'))
  return source
}

/**
 * Every production file that could legitimately CALL a sim export — the whole of
 * `src/`, recursively, including `.tsx`.
 *
 * `aic-8tl.1` exposed a real hole in this gate, and it was mine. The audit read
 * `src/sim/` for both halves — exports AND callers — so the application layer was
 * invisible to it. The consequence was worse than a missed orphan: spec 005 defines
 * "the engine has ignition" (SC-003) as `generateWorld`, `evaluateLanding`,
 * `createColony` and `resolveTurn` LEAVING the allowlist, and as originally written
 * they never could. `App.tsx` calling `generateWorld` is exactly the wiring the
 * project has failed to achieve three times, and the gate measuring that wiring
 * would have reported "still orphaned" forever while the game visibly worked.
 *
 * A gate that cannot observe success is as broken as one that cannot observe
 * failure — it just fails quietly instead of loudly.
 *
 * The asymmetry is deliberate: only `src/sim/` exports are AUDITED (the sim is what
 * must not rot into unreachable code), but a caller anywhere under `src/` counts.
 */
function readProductionSources(): ReadonlyMap<string, string> {
  const source = new Map<string, string>()
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const key = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, key)
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        source.set(key, readFileSync(path, 'utf8'))
      }
    }
  }
  walk(SRC_DIR, '')
  return source
}

/**
 * The audit itself, over an arbitrary `filename -> source text` map.
 *
 * `aic-7mb`: this used to run its regexes over RAW file text, so a call-shaped
 * string inside a comment or a string/template literal (a JSDoc pseudocode
 * example, say) was indistinguishable from a real call expression — which is
 * exactly backwards for a gate whose entire job is telling "wired" from "not".
 * Every file is passed through `stripNonCode` first, which blanks comment and
 * string/template-literal bodies while leaving real code untouched (see
 * `tests/support/strip-non-code.ts` for the scanner and its documented
 * limitations). Both halves of the audit — which names are exported, and which
 * names are called — run on that stripped text, so a fake export declaration or
 * a fake call hidden in prose can affect neither.
 */
function auditModules(
  source: ReadonlyMap<string, string>,
  callerSource: ReadonlyMap<string, string> = source,
): Audit {
  const codeOnly = new Map<string, string>()
  for (const [file, text] of source) codeOnly.set(file, stripNonCode(text))
  const callerCode = new Map<string, string>()
  for (const [file, text] of callerSource) callerCode.set(file, stripNonCode(text))

  const orphans: string[] = []
  const wired: string[] = []

  for (const [file, text] of codeOnly) {
    const moduleName = file.slice(0, -3)
    // Exported FUNCTIONS only. Types have no runtime call site, and constants are
    // frequently and legitimately re-exported for tests, so including either would
    // drown the signal this test exists to preserve.
    for (const match of text.matchAll(/^export (?:async )?function\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = match[1]
      if (name === undefined) continue
      let callers = 0
      for (const [otherFile, otherText] of callerCode) {
        // Skip the defining file. Caller keys are `src/`-relative ("sim/scale.ts")
        // while export keys are bare ("scale.ts"), so compare by suffix.
        if (otherFile === file || otherFile.endsWith(`/${file}`)) continue
        // A call, not a mention: the name followed by an open paren. Import lines and
        // prose references do not match, which is what keeps a comment about a
        // deleted function from making it look alive.
        callers += [...otherText.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length
      }
      ;(callers > 0 ? wired : orphans).push(`${moduleName}.${name}`)
    }
  }
  return { orphans: orphans.sort(), wired: wired.sort() }
}

function auditComposition(): Audit {
  return auditModules(readSimSources(), readProductionSources())
}

describe('composition audit (the ratchet)', () => {
  it('should not introduce a NEW export with no production consumer', () => {
    const { orphans } = auditComposition()
    const unexpected = orphans.filter((o) => !ACCEPTED_ORPHANS.includes(o))
    // If this fails, you added an exported function that nothing in src/ calls.
    // Wire it to a real caller, or add it to ACCEPTED_ORPHANS with the reason.
    // Do NOT add it silently — that is precisely how aic-c1p and aic-8eq happened.
    expect(unexpected).toEqual([])
  })

  it('should keep ACCEPTED_ORPHANS honest — no stale entries', () => {
    const { orphans, wired } = auditComposition()
    // An accepted orphan that has since been wired must be REMOVED from the list.
    // A stale allowlist is how a ratchet quietly stops ratcheting: the list grows to
    // cover everything and the test becomes decorative.
    const nowWired = ACCEPTED_ORPHANS.filter((o) => wired.includes(o))
    expect(nowWired).toEqual([])
    // An accepted orphan that no longer exists at all must also be removed.
    const gone = ACCEPTED_ORPHANS.filter((o) => !orphans.includes(o) && !wired.includes(o))
    expect(gone).toEqual([])
  })

  it('should have the turn loop genuinely composed from the modules it orchestrates', () => {
    // The positive assertion, and the one that actually says "the game runs". These
    // were ALL orphaned before aic-a00.6: the trunk existing is what this checks.
    const { wired } = auditComposition()
    for (const required of [
      'ledger.applyLedger',
      'power.resolveElectricity',
      'construction.advanceConstruction',
      'mission.evaluateMission',
      'brownout.resolveBrownout',
    ]) {
      expect(wired).toContain(required)
    }
  })
})

/**
 * `aic-7mb`: caller detection must tell a real call apart from a call-shaped
 * string of prose. These run `auditModules` directly against small synthetic
 * fixtures — two-file maps that never touch disk — so each scenario is
 * isolated from the real (and constantly-changing) `src/sim` tree. The real
 * tree is still exercised by the `describe` block above; these pin the
 * specific defect and its fix.
 */
describe('composition audit — the app layer counts as a caller (aic-8tl.1)', () => {
  // Regression test for a hole in THIS GATE, found by the canvas-renderer bead.
  // The audit originally read src/sim/ for BOTH halves — exports and callers — so the
  // application layer was invisible to it. That is worse than a missed orphan: spec
  // 005's SC-003 defines "the engine has ignition" as four sim entry points LEAVING
  // the allowlist, and as written they never could, because the app calling them did
  // not count. A gate that cannot observe success is as broken as one that cannot
  // observe failure; it just fails quietly instead of loudly.
  it('should count a call from a .tsx app file as production wiring', () => {
    const { wired, orphans } = auditModules(
      new Map([['world.ts', 'export function generateWorld(): number {\n  return 1\n}\n']]),
      new Map([
        ['sim/world.ts', 'export function generateWorld(): number {\n  return 1\n}\n'],
        ['app/App.tsx', "import { generateWorld } from '../sim/world'\nconst w = generateWorld()\n"],
      ]),
    )
    expect(wired).toContain('world.generateWorld')
    expect(orphans).not.toContain('world.generateWorld')
  })

  it('should still see an export with no caller anywhere in src as an orphan', () => {
    // Non-vacuity: proves the test above is not passing simply because everything
    // now looks wired.
    const { orphans } = auditModules(
      new Map([['world.ts', 'export function generateWorld(): number {\n  return 1\n}\n']]),
      new Map([
        ['sim/world.ts', 'export function generateWorld(): number {\n  return 1\n}\n'],
        ['app/App.tsx', "const unrelated = 1\n"],
      ]),
    )
    expect(orphans).toContain('world.generateWorld')
  })

  it('should not count the defining file as its own caller across differing key shapes', () => {
    // Export keys are bare ("world.ts"); caller keys are src-relative
    // ("sim/world.ts"). A naive equality check would fail to skip the definition and
    // report every export as wired to itself — silently disabling the whole gate.
    const body = 'export function generateWorld(): number {\n  return generateWorld()\n}\n'
    const { orphans } = auditModules(new Map([['world.ts', body]]), new Map([['sim/world.ts', body]]))
    expect(orphans).toContain('world.generateWorld')
  })
})

describe('composition audit — caller detection ignores comments and literals (aic-7mb)', () => {
  it('should NOT count a call appearing only inside a // comment as wiring', () => {
    const { orphans, wired } = auditModules(
      new Map([
        ['a.ts', 'export function target() { return 1 }'],
        ['b.ts', '// target() looks like a call but is only a code note\nexport function other() { return 2 }'],
      ]),
    )
    expect(orphans).toContain('a.target')
    expect(wired).not.toContain('a.target')
  })

  it('should NOT count a call appearing only inside a /* */ block comment as wiring', () => {
    const { orphans, wired } = auditModules(
      new Map([
        ['a.ts', 'export function target() { return 1 }'],
        ['b.ts', '/* target() commented out during debugging */\nexport function other() { return 2 }'],
      ]),
    )
    expect(orphans).toContain('a.target')
    expect(wired).not.toContain('a.target')
  })

  it('should NOT count a call appearing only inside a JSDoc pseudocode example as wiring — the exact aic-7mb shape', () => {
    // This reproduces the real defect: orders.ts's header carried a
    // `resolveTurn(ordered)` worked example, and the ratchet counted it as a
    // production call site for `turn.resolveTurn`.
    const b = [
      '/**',
      ' * Example usage:',
      ' *   const outcome = target(ordered)',
      ' */',
      'export function other() { return 2 }',
    ].join('\n')
    const { orphans, wired } = auditModules(
      new Map([['a.ts', 'export function target() { return 1 }'], ['b.ts', b]]),
    )
    expect(orphans).toContain('a.target')
    expect(wired).not.toContain('a.target')
  })

  it('should NOT count a call appearing only inside a single- or double-quoted string as wiring', () => {
    const { orphans, wired } = auditModules(
      new Map([
        ['a.ts', 'export function target() { return 1 }'],
        [
          'b.ts',
          [
            "const single = 'please call target() manually'",
            'const double = "please call target() manually"',
            'export function other() { return 2 }',
          ].join('\n'),
        ],
      ]),
    )
    expect(orphans).toContain('a.target')
    expect(wired).not.toContain('a.target')
  })

  it('should NOT count a call appearing only inside a template literal as wiring', () => {
    const { orphans, wired } = auditModules(
      new Map([
        ['a.ts', 'export function target() { return 1 }'],
        ['b.ts', 'const msg = `please call target() manually`\nexport function other() { return 2 }'],
      ]),
    )
    expect(orphans).toContain('a.target')
    expect(wired).not.toContain('a.target')
  })

  it('should still count a REAL call as wiring — the fix does not create false orphans', () => {
    const { orphans, wired } = auditModules(
      new Map([
        ['a.ts', 'export function target() { return 1 }'],
        ['b.ts', 'import { target } from "./a"\nexport function other() { return target() }'],
      ]),
    )
    expect(wired).toContain('a.target')
    expect(orphans).not.toContain('a.target')
  })

  it('should still count a real call when the SAME file also contains a decoy in a comment and a string', () => {
    // Belt and braces: a file that has both the noise (comment + string decoy)
    // AND the real call must still resolve to wired, proving the stripping
    // does not accidentally eat the genuine call site too.
    const b = [
      '// target() as a note-to-self',
      'const msg = "target() in prose"',
      'import { target } from "./a"',
      'export function other() { return target() }',
    ].join('\n')
    const { orphans, wired } = auditModules(new Map([['a.ts', 'export function target() { return 1 }'], ['b.ts', b]]))
    expect(wired).toContain('a.target')
    expect(orphans).not.toContain('a.target')
  })
})
