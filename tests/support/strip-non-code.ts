/**
 * SECURITY-ADJACENT INFRASTRUCTURE — read this before touching it.
 *
 * `tests/integration/composition-audit.test.ts` decides whether an exported
 * function is "wired" by textually searching sibling files for `name(`. That
 * regex has no idea what a comment or a string literal is, so it used to count
 * TWO kinds of thing as a real call: an actual call expression, AND any prose
 * that merely happens to look like one.
 *
 * Concretely (`aic-7mb`): `orders.ts`'s JSDoc header contained a
 * `resolveTurn(ordered)` pseudocode example. The ratchet read the whole file as
 * one blob of text, found the string `resolveTurn(`, and marked `turn.resolveTurn`
 * as having a production caller. That is a false WIRED — and the same mechanism
 * runs in reverse: a fake call typed into a comment could just as easily paper
 * over a genuine orphan, silently disabling the one gate this project has that
 * catches unwired modules (`aic-c1p`, `aic-8eq`).
 *
 * `stripNonCode` closes that hole by blanking every span of source text that
 * cannot execute — comments and string/template literal bodies — before the
 * caller-detection regex ever sees it. What survives is exactly the text a JS
 * engine would treat as code.
 *
 * CHOICE OF APPROACH (and why not a real parser):
 * A full TypeScript-aware scan (`ts.createScanner`) was considered and rejected
 * for this job. Getting template-literal re-scanning right through that API
 * requires reproducing the parser's brace-depth bookkeeping (calling
 * `reScanTemplateToken` at the correct nesting depth) — real complexity, for a
 * corpus (`src/sim/**\/*.ts`) that, as of this writing, contains no regex
 * literals and no nested template literals. A hand-rolled single-pass character
 * scan is a few dozen lines, is straightforward to read top to bottom, and
 * handles every construct that actually appears in this codebase. Constitution
 * §8: the simplest thing that genuinely works, not the most general thing that
 * could conceivably be needed. If the corpus grows nested templates or regex
 * literals, upgrade this to the compiler API then — see LIMITATIONS below for
 * how this scanner fails in that case (loudly, not silently).
 *
 * WHAT THIS DOES:
 *   - `// ...`            line comments, blanked to end of line.
 *   - `/* ... *\/`         block comments, including JSDoc (`/** ... *\/`).
 *   - `'...'` / `"..."`   string literals, blanked, escapes honoured.
 *   - `` `...` ``          template literals, blanked WHOLESALE — including any
 *                          `${ }` substitution — see LIMITATIONS.
 * Everything else (identifiers, keywords, operators, real call expressions) is
 * passed through byte-for-byte, which is what lets the existing caller-count
 * regex keep working unmodified on the result.
 *
 * LIMITATIONS (deliberate, and safe-side):
 *   1. A real call written INSIDE a template substitution, e.g.
 *      `` `${resolveTurn(x)}` ``, is blanked along with the rest of the
 *      template and will NOT be counted as a caller. This is the one case
 *      where this scanner can produce a false ORPHAN for a genuinely wired
 *      export. That is the safe direction: it fails LOUD (the ratchet test
 *      breaks, a human looks) rather than failing silent (a comment quietly
 *      satisfying the gate). No such call exists in `src/sim` today — verified
 *      by inspection when this was written.
 *   2. A template literal that itself contains a nested, un-escaped backtick
 *      (a template literal inside a `${ }` substitution) will cause this
 *      scanner to treat the inner backtick as the outer literal's closing
 *      delimiter. Not present in this codebase today. If it is ever
 *      introduced, prefer the compiler-API rewrite described above over
 *      patching this scanner into a hand-rolled parser.
 *   3. Regex literals (`/foo/`) are not specially recognised. None exist under
 *      `src/sim` (verified by grep when this was written), so this does not
 *      currently cause misdetection. A regex literal containing `//`, a quote,
 *      or a backtick could, in principle, be mis-scanned.
 */

/**
 * Removes every comment and every string/template literal BODY from `source`,
 * leaving real code untouched. See the module doc comment above for exactly
 * what is and is not handled.
 */
export function stripNonCode(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const c = source.charAt(i)
    const next = source.charAt(i + 1)

    // Line comment: everything up to (not including) the next newline is inert.
    // An apostrophe, an unmatched quote, a paren — none of it is code, and none
    // of it re-enters the scan.
    if (c === '/' && next === '/') {
      const newlineAt = source.indexOf('\n', i)
      i = newlineAt === -1 ? n : newlineAt
      continue
    }

    // Block comment, including JSDoc (`/** ... */` is just a block comment
    // whose body happens to start with an extra `*`). JS/TS block comments do
    // not nest, so the first `*/` always closes it.
    if (c === '/' && next === '*') {
      const closeAt = source.indexOf('*/', i + 2)
      i = closeAt === -1 ? n : closeAt + 2
      continue
    }

    // String or template literal. All three quote characters share one
    // escape-aware scanner; see `skipQuoted` and LIMITATIONS above for the
    // template-literal caveats.
    if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(source, i, c)
      continue
    }

    out += c
    i += 1
  }

  return out
}

/**
 * Advances past a quoted literal that opens at `source[openIndex]` (which MUST
 * be `quote`), honouring backslash escapes so an escaped quote — `\'`, `\"`,
 * `` \` ``, or an escaped backslash immediately before a real closing quote —
 * never terminates the literal early.
 *
 * Returns the index of the first character AFTER the matching closing quote,
 * or `source.length` if the literal is unterminated. Unterminated input is
 * malformed TypeScript (would fail `tsc` long before this test runs); rather
 * than throw, this fails open and treats the remainder of the file as
 * literal content, which is the conservative choice for a detector whose job
 * is to avoid manufacturing false callers.
 */
function skipQuoted(source: string, openIndex: number, quote: string): number {
  const n = source.length
  let j = openIndex + 1
  while (j < n) {
    const ch = source.charAt(j)
    if (ch === '\\') {
      j += 2 // the backslash and the character it escapes are both inert
      continue
    }
    if (ch === quote) return j + 1
    j += 1
  }
  return n
}
