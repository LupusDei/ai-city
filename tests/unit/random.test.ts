/**
 * Unit tests for the sim core's single seeded-PRNG construction.
 *
 * `mulberry32` is the shared determinism primitive `terrain.ts` and
 * `buildability.ts` both depend on to stay in register with each other (see
 * `src/sim/random.ts`'s module doc comment). These tests pin down the exact
 * behavioural contract other modules rely on — same seed produces the same
 * sequence forever, independent closures never share state, output always
 * lands in [0, 1) — and anchor a handful of literal output values so an
 * accidental change to the mixing algorithm itself (not just to a caller) is
 * caught here first, rather than surfacing later as "the map looks wrong" in
 * `terrain.test.ts`, `buildability.test.ts`, or the golden trace.
 */
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../src/sim/random'

describe('mulberry32', () => {
  describe('determinism', () => {
    it('should produce the identical sequence from two independent generators seeded alike', () => {
      const a = mulberry32(42)
      const b = mulberry32(42)
      const seqA = Array.from({ length: 20 }, () => a())
      const seqB = Array.from({ length: 20 }, () => b())
      expect(seqA).toEqual(seqB)
    })

    it('should produce a different sequence for a different seed', () => {
      const a = mulberry32(1)
      const b = mulberry32(2)
      const seqA = Array.from({ length: 10 }, () => a())
      const seqB = Array.from({ length: 10 }, () => b())
      expect(seqA).not.toEqual(seqB)
    })

    it('should keep two generators independent: advancing one must not perturb the other', () => {
      const a = mulberry32(7)
      const b = mulberry32(7)
      // Advance `a` several draws ahead of `b`.
      a()
      a()
      a()
      // `b` must still be at its own first draw, unaffected by `a`'s advances —
      // proves state is captured in each closure, not shared module-level state.
      const bFirst = b()
      const freshFirst = mulberry32(7)()
      expect(bFirst).toBe(freshFirst)
    })
  })

  describe('output range', () => {
    it.each([0, 1, -1, 42, -999, 2 ** 31, 2 ** 32 - 1, 0xdeadbeef])(
      'should always yield values in the half-open interval [0, 1) for seed %s',
      (seed) => {
        const rand = mulberry32(seed)
        for (let i = 0; i < 500; i++) {
          const value = rand()
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThan(1)
          expect(Number.isFinite(value)).toBe(true)
          expect(Number.isNaN(value)).toBe(false)
        }
      },
    )
  })

  describe('seed folding (`>>> 0` semantics)', () => {
    it('should treat a seed and that seed plus 2^32 identically (unsigned 32-bit wraparound)', () => {
      const a = mulberry32(5)
      const b = mulberry32(5 + 2 ** 32)
      expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()))
    })

    it('should treat seed 0 and seed 2^32 identically', () => {
      const a = mulberry32(0)
      const b = mulberry32(2 ** 32)
      expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()))
    })

    it('should fold a negative seed into an unsigned 32-bit integer rather than throwing', () => {
      expect(() => mulberry32(-7)).not.toThrow()
      // -7 folded via `>>> 0` is 2**32 - 7; confirm that is genuinely what runs.
      const a = mulberry32(-7)
      const b = mulberry32(2 ** 32 - 7)
      expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()))
    })

    it('should truncate a fractional seed toward zero before folding (ToUint32 semantics)', () => {
      const a = mulberry32(3.9)
      const b = mulberry32(3)
      expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()))
    })
  })

  describe('regression anchors (pin the exact mixing algorithm)', () => {
    // These literals were captured directly from the shipped implementation. They
    // are not a claim about "correct" random numbers — they exist so that an
    // accidental future edit to the mixing step (a changed constant, a swapped
    // shift amount, a reordered XOR) fails HERE, immediately and specifically,
    // instead of showing up as an unexplained diff in terrain elevation or
    // deposit placement three modules away.
    it('should reproduce the exact first five draws for seed 0', () => {
      const rand = mulberry32(0)
      const values = Array.from({ length: 5 }, () => rand())
      expect(values).toEqual([
        0.26642920868471265,
        0.0003297457005828619,
        0.2232720274478197,
        0.1462021479383111,
        0.46732782293111086,
      ])
    })

    it('should reproduce the exact first five draws for seed 42', () => {
      const rand = mulberry32(42)
      const values = Array.from({ length: 5 }, () => rand())
      expect(values).toEqual([
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
        0.6697340414393693,
        0.17481389874592423,
      ])
    })

    it('should reproduce the exact first five draws for seed -7', () => {
      const rand = mulberry32(-7)
      const values = Array.from({ length: 5 }, () => rand())
      expect(values).toEqual([
        0.43306733411736786,
        0.32539576734416187,
        0.5442695003002882,
        0.48018999374471605,
        0.048719558166339993,
      ])
    })
  })

  describe('closure shape', () => {
    it('should return a callable with no required arguments', () => {
      const rand = mulberry32(1)
      expect(typeof rand).toBe('function')
      expect(rand.length).toBe(0)
    })

    it('should return a NEW closure (and therefore a fresh sequence) on every call to mulberry32', () => {
      const first = mulberry32(9)
      const firstDraw = first()
      // A second call to mulberry32 with the same seed must restart the sequence,
      // not continue whatever internal state a previous closure reached.
      const second = mulberry32(9)
      expect(second()).toBe(firstDraw)
    })
  })
})
