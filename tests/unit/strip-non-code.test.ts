import { describe, expect, it } from 'vitest'

import { stripNonCode } from '../support/strip-non-code'

/**
 * Unit tests for the comment/string-stripping scanner that backs the
 * composition ratchet (`aic-7mb`). These pin the exact behaviour the ratchet
 * depends on: comments and string/template bodies must disappear, and every
 * other byte of real code must survive untouched, so a caller-detection regex
 * run on the result only ever sees things a JS engine would actually execute.
 */
describe('stripNonCode', () => {
  it('should return code unchanged when there is nothing to strip', () => {
    const source = 'function foo() { return bar(1, 2) }'
    expect(stripNonCode(source)).toBe(source)
  })

  it('should blank a line comment while keeping the code before it on the same line', () => {
    const source = 'const x = bar()  // call bar() again here\nconst y = 2'
    const stripped = stripNonCode(source)
    expect(stripped).toContain('const x = bar()')
    expect(stripped).toContain('const y = 2')
    expect(stripped).not.toContain('call bar() again')
  })

  it('should blank a line comment that is the only thing on its own line', () => {
    const source = '// resolveTurn(ordered) — pseudocode, not a call\nfunction real() {}'
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(ordered)')
    expect(stripped).toContain('function real() {}')
  })

  it('should not let an apostrophe inside a line comment be mistaken for a string opening', () => {
    // If the scanner opened a string at the apostrophe, everything after it —
    // including the real call on the next line — would be swallowed as string
    // content. It must not be.
    const source = "// don't call resolveTurn() here\nconst z = bar()"
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn')
    expect(stripped).toContain('const z = bar()')
  })

  it('should blank a block comment', () => {
    const source = '/* fooBar(1) is not real */ function real() { return baz() }'
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('fooBar(1)')
    expect(stripped).toContain('function real() { return baz() }')
  })

  it('should blank a multi-line JSDoc block containing a pseudocode call, reproducing the orders.ts defect', () => {
    // This is the exact shape of the real aic-7mb bug: a JSDoc header with a
    // worked example that looks exactly like a production call.
    const source = [
      '/**',
      ' * Example usage:',
      ' *   const result = resolveTurn(ordered)',
      ' */',
      'export function applyOrders() { return true }',
    ].join('\n')
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(ordered)')
    expect(stripped).toContain('export function applyOrders() { return true }')
  })

  it('should blank a single-quoted string literal', () => {
    const source = "const msg = 'call resolveTurn(x) to finish'\nreal()"
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(x)')
    expect(stripped).toContain('real()')
  })

  it('should blank a double-quoted string literal', () => {
    const source = 'const msg = "call resolveTurn(x) to finish"\nreal()'
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(x)')
    expect(stripped).toContain('real()')
  })

  it('should not treat "//" inside a double-quoted string as the start of a line comment', () => {
    // If it did, everything from that "//" to end of line — including a real
    // call later on the same line — would be wrongly discarded.
    const source = 'const url = "http://example.com"; real()'
    const stripped = stripNonCode(source)
    expect(stripped).toContain('real()')
  })

  it('should not treat "//" inside a single-quoted string as the start of a line comment', () => {
    const source = "const url = 'http://example.com'; real()"
    const stripped = stripNonCode(source)
    expect(stripped).toContain('real()')
  })

  it('should blank a template literal body, including any call-like text inside it', () => {
    const source = 'const msg = `call resolveTurn(x) please`\nreal()'
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(x)')
    expect(stripped).toContain('real()')
  })

  it('should handle a template literal spanning multiple lines without breaking the scan', () => {
    const source = ['const msg = `line one', 'line two with resolveTurn(x)', 'line three`', 'real()'].join(
      '\n',
    )
    expect(() => stripNonCode(source)).not.toThrow()
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(x)')
    expect(stripped).toContain('real()')
  })

  it('should honour an escaped quote inside a string so the literal does not terminate early', () => {
    // Without escape handling, the scanner would see the string as closing at
    // the `\'`, leaving `s not real` as bare code and `resolveTurn(x)` exposed
    // as an unquoted, matchable call.
    const source = "const msg = 'it\\'s not real: resolveTurn(x)'\nreal()"
    const stripped = stripNonCode(source)
    expect(stripped).not.toContain('resolveTurn(x)')
    expect(stripped).toContain('real()')
  })

  it('should honour an escaped backslash immediately before a real closing quote', () => {
    // "a\\" in source is the two-character string `a\`, followed by a REAL
    // closing quote — a parity case that trips up naive escape handling.
    const source = 'const path = "a\\\\"\nreal()'
    const stripped = stripNonCode(source)
    expect(stripped).toContain('real()')
  })

  it('should fail open on an unterminated block comment instead of throwing', () => {
    const source = '/* never closed resolveTurn(x)'
    expect(() => stripNonCode(source)).not.toThrow()
    expect(stripNonCode(source)).not.toContain('resolveTurn(x)')
  })

  it('should fail open on an unterminated string instead of throwing', () => {
    const source = "const msg = 'never closed resolveTurn(x)"
    expect(() => stripNonCode(source)).not.toThrow()
    expect(stripNonCode(source)).not.toContain('resolveTurn(x)')
  })

  it('should preserve a real call expression standing alone as code', () => {
    const source = 'resolveTurn(ordered)'
    expect(stripNonCode(source)).toBe('resolveTurn(ordered)')
  })
})
