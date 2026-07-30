/**
 * Architecture-fitness test for the project's #1 non-negotiable rule: `src/sim` is a
 * framework-agnostic simulation core. It must never import a UI framework, touch a
 * DOM global, or call a nondeterministic API — those are exactly the things that make
 * a simulation core impossible to run headless, replay, or test deterministically.
 *
 * Before this test existed, that rule lived only as a sentence in a README: nothing
 * stopped a future `src/sim/weather.ts` from calling `Math.random()` directly, or a
 * component-shaped helper from creeping in under `src/sim/` and importing `react`.
 * This file makes the rule a CI-enforced property instead of a convention someone has
 * to remember.
 *
 * Design notes:
 * - `mask()` blanks out comments (always) and string/template-literal bodies
 *   (optionally) while preserving every character's position — including newlines —
 *   so that a match's index in the masked text still maps to the correct line number
 *   in the original file. This is what keeps the checker from flagging `Math.random(`
 *   when it only appears inside a comment or an error message string.
 * - Import specifiers are checked against a comments-only mask (banned import paths
 *   are themselves string literals, so we must not blank those out).
 * - DOM-global and nondeterminism checks run against a comments-AND-strings mask, but
 *   template-literal `${...}` interpolations are deliberately left unmasked: real code
 *   can hide there, and a naive masker would give it a free pass.
 * - The walker recurses arbitrarily deep, so `src/sim/` gaining subdirectories later
 *   does not silently shrink the coverage of this test.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(TEST_FILE_DIR, '..', '..')
const SIM_ROOT = join(PROJECT_ROOT, 'src', 'sim')

type Rule = 'banned-import' | 'dom-global' | 'nondeterminism'

interface Violation {
  readonly file: string
  readonly line: number
  readonly rule: Rule
  readonly token: string
}

// ---------------------------------------------------------------------------
// File system walk
// ---------------------------------------------------------------------------

/**
 * Recursively collect every `.ts`/`.tsx` file under `dir`, in no particular order.
 * Recursing (rather than a single-level `readdir`) is what keeps this test valid as
 * `src/sim/` grows subdirectories.
 */
function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
    } else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) {
      files.push(full)
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// Comment / string masking
// ---------------------------------------------------------------------------

/**
 * Replace comments (and, when `maskStrings` is true, string/template-literal bodies)
 * with spaces, character-for-character. The output has the exact same length and the
 * exact same newline positions as `source`, so any index found in the masked text is
 * already a valid index into `source` — no separate coordinate mapping is needed.
 */
function mask(source: string, maskStrings: boolean): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
  let out = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const two = source.slice(i, i + 2)

    if (two === '//') {
      let j = i
      while (j < n && source[j] !== '\n') j++
      out += blank(source.slice(i, j))
      i = j
      continue
    }

    if (two === '/*') {
      let j = i + 2
      while (j < n - 1 && source.slice(j, j + 2) !== '*/') j++
      j = Math.min(j + 2, n)
      out += blank(source.slice(i, j))
      i = j
      continue
    }

    // `!` is safe and load-bearing: the enclosing `while (i < n)` guarantees this
    // index is in range. Leaving it as `string | undefined` mattered — `out += c`
    // below would append the 9-character literal "undefined" on a miss, breaking
    // mask()'s character-for-character length invariant and silently corrupting
    // every index -> line-number lookup downstream.
    const c = source[i]!

    if (maskStrings && (c === '"' || c === "'")) {
      const quote = c
      let j = i + 1
      while (j < n && source[j] !== quote) {
        j += source[j] === '\\' ? 2 : 1
      }
      j = Math.min(j + 1, n)
      out += blank(source.slice(i, j))
      i = j
      continue
    }

    if (maskStrings && c === '`') {
      out += ' '
      let j = i + 1
      while (j < n && source[j] !== '`') {
        if (source[j] === '\\') {
          const escaped = source[j + 1]
          out += escaped === '\n' ? ' \n' : '  '
          j += 2
          continue
        }
        // Leave `${...}` interpolations untouched: they hold real, checkable code.
        if (source[j] === '$' && source[j + 1] === '{') {
          const start = j
          let depth = 1
          j += 2
          while (j < n && depth > 0) {
            if (source[j] === '{') depth++
            else if (source[j] === '}') depth--
            j++
          }
          out += source.slice(start, j)
          continue
        }
        out += source[j] === '\n' ? '\n' : ' '
        j++
      }
      if (j < n) {
        out += ' '
        j++
      }
      i = j
      continue
    }

    out += c
    i++
  }

  return out
}

/** Cumulative start offset of each line (0-indexed), for O(log n) index -> line lookups. */
function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** 1-indexed line number containing `index`, via binary search over `lineStarts`. */
function lineForIndex(lineStarts: readonly number[], index: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if ((lineStarts[mid] as number) <= index) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// `from`/bare-specifier/dynamic-import/require/re-export forms. `[\s\S]*?` (rather than
// `.*?`) so a multi-line named-import list doesn't break the match.
const IMPORT_REGEXES: readonly RegExp[] = [
  /\bimport\s[\s\S]*?\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bexport\s[\s\S]*?\bfrom\s+["']([^"']+)["']/g,
]

function isBannedImport(specifier: string): boolean {
  if (specifier === 'react' || specifier.startsWith('react/')) return true
  if (specifier === 'react-dom' || specifier.startsWith('react-dom/')) return true
  if (specifier.includes('/ui/')) return true
  return false
}

const DOM_GLOBAL_TOKENS: readonly string[] = ['window', 'document', 'navigator', 'localStorage']

const NONDETERMINISM_PATTERNS: readonly { regex: RegExp; token: string }[] = [
  { regex: /\bMath\.random\s*\(/g, token: 'Math.random(' },
  { regex: /\bDate\.now\s*\(/g, token: 'Date.now(' },
  { regex: /\bnew\s+Date\s*\(/g, token: 'new Date(' },
]

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

/**
 * Check a single file's source for boundary violations. `displayPath` is what shows
 * up in violation reports — callers pass a project-relative path for real files.
 */
function checkSource(displayPath: string, source: string): Violation[] {
  const violations: Violation[] = []
  const lineStarts = buildLineStarts(source)

  const commentsOnly = mask(source, false)
  for (const regex of IMPORT_REGEXES) {
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(commentsOnly)) !== null) {
      const specifier = m[1]
      if (specifier !== undefined && isBannedImport(specifier)) {
        violations.push({
          file: displayPath,
          line: lineForIndex(lineStarts, m.index),
          rule: 'banned-import',
          token: specifier,
        })
      }
      if (m.index === regex.lastIndex) regex.lastIndex++
    }
  }

  const fullyMasked = mask(source, true)

  for (const token of DOM_GLOBAL_TOKENS) {
    const regex = new RegExp(`\\b${token}\\b`, 'g')
    let m: RegExpExecArray | null
    while ((m = regex.exec(fullyMasked)) !== null) {
      violations.push({
        file: displayPath,
        line: lineForIndex(lineStarts, m.index),
        rule: 'dom-global',
        token,
      })
    }
  }

  for (const { regex, token } of NONDETERMINISM_PATTERNS) {
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(fullyMasked)) !== null) {
      violations.push({
        file: displayPath,
        line: lineForIndex(lineStarts, m.index),
        rule: 'nondeterminism',
        token,
      })
    }
  }

  // Sort by line: violations are collected rule-by-rule (all banned imports, then all
  // DOM globals, then all nondeterminism calls), so without this a report would jump
  // around the file instead of reading top-to-bottom the way a developer scans it.
  return violations.sort((a, b) => a.line - b.line)
}

/** Read and check a real file on disk, reporting it by its path relative to the repo root. */
function checkFile(absolutePath: string): Violation[] {
  const source = readFileSync(absolutePath, 'utf8')
  return checkSource(relative(PROJECT_ROOT, absolutePath), source)
}

function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.token}`).join('\n')
}

// ---------------------------------------------------------------------------
// Tests: the checker's own correctness (synthetic sources, no disk I/O)
// ---------------------------------------------------------------------------

describe('checkSource', () => {
  it('should report no violations for clean, framework-agnostic source', () => {
    const source = `
      export interface Coord { readonly x: number; readonly y: number }
      export function add(a: number, b: number): number { return a + b }
    `
    expect(checkSource('clean.ts', source)).toEqual([])
  })

  describe('banned imports', () => {
    it.each([
      ["import React from 'react'", 'react'],
      ["import { useState } from 'react'", 'react'],
      ["import ReactDOM from 'react-dom'", 'react-dom'],
      ["import { createRoot } from 'react-dom/client'", 'react-dom/client'],
      ["import { Button } from '../ui/button'", '../ui/button'],
      ["import '../../components/ui/panel'", '../../components/ui/panel'],
      ["export { Widget } from './ui/widget'", './ui/widget'],
    ])('should flag %s', (line, expectedToken) => {
      const violations = checkSource('probe.ts', line)
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'banned-import', token: expectedToken }),
      ])
    })

    it('should flag a dynamic import() of react', () => {
      const violations = checkSource('probe.ts', "const m = await import('react')")
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'banned-import', token: 'react' }),
      ])
    })

    it('should flag a require() of react-dom', () => {
      const violations = checkSource('probe.ts', "const rd = require('react-dom')")
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'banned-import', token: 'react-dom' }),
      ])
    })

    it('should NOT flag an unrelated import whose name merely contains "react"', () => {
      const violations = checkSource('probe.ts', "import { reactor } from './reactor'")
      expect(violations).toEqual([])
    })

    it('should NOT flag an identifier containing "ui" that is not a /ui/ path segment', () => {
      const violations = checkSource('probe.ts', "import { build } from './builder'")
      expect(violations).toEqual([])
    })

    it('should report the correct line number for an import several lines into the file', () => {
      const source = ['const a = 1', 'const b = 2', "import x from 'react'", 'const c = 3'].join(
        '\n',
      )
      const violations = checkSource('probe.ts', source)
      expect(violations).toEqual([
        expect.objectContaining({ line: 3, rule: 'banned-import', token: 'react' }),
      ])
    })
  })

  describe('DOM globals', () => {
    it.each(['window', 'document', 'navigator', 'localStorage'])(
      'should flag a bare reference to %s',
      (token) => {
        const violations = checkSource('probe.ts', `export const w = ${token}`)
        expect(violations).toEqual([expect.objectContaining({ rule: 'dom-global', token })])
      },
    )

    it('should NOT flag identifiers that merely start with a DOM-global name', () => {
      const violations = checkSource('probe.ts', 'const windowSize = 10; const documentId = 1')
      expect(violations).toEqual([])
    })

    it('should flag a DOM global hidden inside a template-literal interpolation', () => {
      const violations = checkSource('probe.ts', 'const msg = `size: ${window.innerWidth}`')
      expect(violations).toEqual([expect.objectContaining({ rule: 'dom-global', token: 'window' })])
    })
  })

  describe('nondeterminism', () => {
    it('should flag Math.random(', () => {
      const violations = checkSource('probe.ts', 'const r = Math.random()')
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'nondeterminism', token: 'Math.random(' }),
      ])
    })

    it('should flag Date.now(', () => {
      const violations = checkSource('probe.ts', 'const t = Date.now()')
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'nondeterminism', token: 'Date.now(' }),
      ])
    })

    it('should flag new Date(', () => {
      const violations = checkSource('probe.ts', 'const d = new Date()')
      expect(violations).toEqual([
        expect.objectContaining({ rule: 'nondeterminism', token: 'new Date(' }),
      ])
    })
  })

  describe('false-positive avoidance (comments and string literals)', () => {
    it('should NOT flag a banned token inside a single-line comment', () => {
      const source = "// TODO: never call Math.random() or import 'react' here"
      expect(checkSource('probe.ts', source)).toEqual([])
    })

    it('should NOT flag a banned token inside a block comment', () => {
      const source = '/* window, document, and new Date( must never appear below */'
      expect(checkSource('probe.ts', source)).toEqual([])
    })

    it('should NOT flag a banned token inside a string literal', () => {
      const source = "const msg = 'window is undefined outside a browser'"
      expect(checkSource('probe.ts', source)).toEqual([])
    })

    it('should NOT flag a banned token inside a template-literal literal text segment', () => {
      const source = 'const msg = `Math.random() is banned here`'
      expect(checkSource('probe.ts', source)).toEqual([])
    })
  })

  describe('edge cases', () => {
    it('should return no violations for an empty file', () => {
      expect(checkSource('empty.ts', '')).toEqual([])
    })

    it('should report every violation, in file order, when a file has several', () => {
      const source = [
        "import React from 'react'",
        'const a = Math.random()',
        'const b = window',
      ].join('\n')
      const violations = checkSource('probe.ts', source)
      expect(violations.map((v) => v.line)).toEqual([1, 2, 3])
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: the directory walker, including recursion into subdirectories
// ---------------------------------------------------------------------------

describe('listSourceFiles', () => {
  let scratchDir: string

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
  })

  it('should find .ts and .tsx files nested in subdirectories, and ignore everything else', () => {
    scratchDir = mkdtempSync(join(tmpdir(), 'boundary-walk-test-'))
    mkdirSync(join(scratchDir, 'nested', 'deeper'), { recursive: true })
    writeFileSync(join(scratchDir, 'top.ts'), '')
    writeFileSync(join(scratchDir, 'notes.md'), '')
    writeFileSync(join(scratchDir, 'nested', 'mid.tsx'), '')
    writeFileSync(join(scratchDir, 'nested', 'deeper', 'leaf.ts'), '')
    writeFileSync(join(scratchDir, 'nested', 'deeper', 'data.json'), '{}')

    const found = listSourceFiles(scratchDir)
      .map((f) => relative(scratchDir, f))
      .sort()

    expect(found).toEqual(['nested/deeper/leaf.ts', 'nested/mid.tsx', 'top.ts'].sort())
  })

  it('should return an empty array for a directory with no source files', () => {
    scratchDir = mkdtempSync(join(tmpdir(), 'boundary-walk-empty-'))
    writeFileSync(join(scratchDir, 'readme.txt'), '')
    expect(listSourceFiles(scratchDir)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The actual gate: every file under src/sim/, right now
// ---------------------------------------------------------------------------

describe('sim/renderer boundary enforcement', () => {
  const simFiles = listSourceFiles(SIM_ROOT)

  // If listSourceFiles() ever silently returned zero files (wrong root, filter bug,
  // directory renamed), every assertion below would pass vacuously. This sanity
  // check makes that failure mode loud instead of silent.
  it('should have found at least the known sim source files', () => {
    const names = simFiles.map((f) => relative(SIM_ROOT, f)).sort()
    expect(names).toEqual(expect.arrayContaining(['catalog.ts', 'grid.ts']))
    expect(simFiles.length).toBeGreaterThanOrEqual(2)
  })

  it(`should contain zero boundary violations across all ${simFiles.length} file(s) scanned under src/sim/`, () => {
    const violations = simFiles.flatMap((f) => checkFile(f))
    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} sim/renderer boundary violation(s):\n` +
          `${formatViolations(violations)}\n\n` +
          'src/sim/ must stay framework-agnostic: no react/react-dom/UI imports, ' +
          'no DOM globals, no nondeterministic calls (Math.random/Date.now/new Date).',
      )
    }
    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Documents the intended state: the currently-shipped sim files pass individually
// ---------------------------------------------------------------------------

describe('shipped sim files conform to the boundary', () => {
  it('should report zero violations for src/sim/grid.ts', () => {
    expect(checkFile(join(SIM_ROOT, 'grid.ts'))).toEqual([])
  })

  it('should report zero violations for src/sim/catalog.ts', () => {
    expect(checkFile(join(SIM_ROOT, 'catalog.ts'))).toEqual([])
  })
})
