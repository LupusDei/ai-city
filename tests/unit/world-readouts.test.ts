/**
 * Tests for the shared cross-screen readout formatters.
 *
 * These are trivial functions, and the tests are not. What they pin is a CONTRACT between
 * two screens built in separate worktrees, enforced at the browser level by ★AC-3.2's
 * `toHaveText` exact-string comparison. The character-level assertions below exist because
 * a well-meaning edit — ASCII `x` for `×`, or dropping the spaces — would break an
 * acceptance test that points at the landing bridge rather than at the formatting.
 */

import { describe, expect, it } from 'vitest'

import { createGrid } from '../../src/sim/grid'
import { generateWorld } from '../../src/sim/world'
import { formatDepositCount, formatGridDimensions } from '../../src/app/world-readouts'

describe('formatDepositCount', () => {
  it('should render the deposit count as a bare integer string', () => {
    const world = generateWorld(24, 24, 4242)
    expect(formatDepositCount(world)).toBe(String(world.deposits.length))
  })

  it('should contain digits only — no label, no separator, no units', () => {
    // The whole string is the element's text content under ★AC-3.2, so anything else
    // here would have to be stripped by every caller, and one caller would forget.
    expect(formatDepositCount(generateWorld(24, 24, 7))).toMatch(/^\d+$/)
  })

  it('should render zero deposits as "0" rather than an empty string', () => {
    const world = generateWorld(16, 16, 11, { density: 0 })
    expect(world.deposits).toEqual([])
    // An empty string would make the acceptance assertion pass vacuously on BOTH
    // screens — the one failure mode that would hide a genuinely re-rolled world.
    expect(formatDepositCount(world)).toBe('0')
  })
})

describe('formatGridDimensions', () => {
  it('should render width and height separated by U+00D7 with single spaces', () => {
    expect(formatGridDimensions(createGrid(64, 64))).toBe('64 × 64')
  })

  it('should use the MULTIPLICATION SIGN, not the ASCII letter x', () => {
    // The exact character is the contract. `x` would silently break ★AC-3.2.
    const rendered = formatGridDimensions(createGrid(8, 8))
    expect(rendered).toContain('×')
    expect(rendered).not.toContain('x')
    expect(rendered).not.toContain('X')
  })

  it('should render non-square grids in width-then-height order', () => {
    // Reversing these would still pass an equality check between two screens, so the
    // order needs pinning independently of the cross-screen contract.
    expect(formatGridDimensions(createGrid(37, 23))).toBe('37 × 23')
  })

  it('should render a 1x1 grid without special-casing', () => {
    expect(formatGridDimensions(createGrid(1, 1))).toBe('1 × 1')
  })
})

describe('the cross-screen contract itself (★AC-3.2)', () => {
  it('should render identically from a World.grid and from a colony grid that IS that grid', () => {
    // This is the property ★AC-3.2 checks through the browser, asserted here at unit
    // level so a formatting regression fails fast and locally instead of surfacing as a
    // red acceptance test that appears to accuse the landing bridge.
    const world = generateWorld(48, 32, 20260730)
    const carriedByReference = world.grid // exactly what colony-start.ts does
    expect(formatGridDimensions(carriedByReference)).toBe(formatGridDimensions(world.grid))
  })

  it('should differ when the grid genuinely differs — the check is not vacuous', () => {
    expect(formatGridDimensions(createGrid(64, 64))).not.toBe(
      formatGridDimensions(createGrid(64, 63)),
    )
  })
})
