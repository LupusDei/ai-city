import { describe, it, expect } from 'vitest'
import {
  TILE_EDGE_METRES,
  TILE_AREA_M2,
  tileAreaForEdgeM2,
  footprintAreaM2,
  arealDensityKgPerM2,
  arealMassKg,
} from '../../src/sim/scale'

/**
 * Physical anchors used across this suite, kept here rather than in the module
 * because they belong to the chains that consume the scale, not to the scale
 * itself. Pinning them in tests is the point: these are the numbers the epic
 * plan quotes, and a test is the only thing that stops them drifting.
 */
/** Starship hull diameter, metres — the anchor that ruled out a 10 m tile. */
const STARSHIP_HULL_DIAMETER_M = 9
/** Landing pad footprint in tiles (2x3). */
const PAD_TILES = 6
/** Habitat footprint in tiles (2x2). */
const HABITAT_TILES = 4
/** Colonists housed by one 2x2 habitat. */
const HABITAT_COLONISTS = 8
/** Pressurised ceiling height, metres. */
const HABITAT_CEILING_M = 3
/** NASA long-duration habitable-volume floor, m3 per crew member. */
const NASA_VOLUME_FLOOR_M3 = 25
/** Regolith berm depth over a habitat, metres. */
const REGOLITH_DEPTH_M = 3
/** Bulk (not grain) density of Martian regolith, kg/m3 — ~1.5 g/cm3. */
const REGOLITH_BULK_DENSITY_KG_M3 = 1500
/** Map edge in tiles. */
const MAP_EDGE_TILES = 64

describe('locked tile scale', () => {
  it('should fix the tile edge at 5 metres', () => {
    // Ratified by the General 2026-07-29. Not a design knob any more.
    expect(TILE_EDGE_METRES).toBe(5)
  })

  it('should derive tile area as the square of the edge, not a hardcoded 25', () => {
    expect(TILE_AREA_M2).toBe(25)
    expect(TILE_AREA_M2).toBe(TILE_EDGE_METRES * TILE_EDGE_METRES)
    expect(TILE_AREA_M2).toBe(tileAreaForEdgeM2(TILE_EDGE_METRES))
  })

  it('should give a 2x3 landing pad that fits the 9 m Starship hull', () => {
    // Anchor 1: pad is 10 m x 15 m at this scale. The hull fits across the
    // short axis with 0.5 m to spare; at a 10 m tile the pad would be 20x30 m,
    // more than three hull-widths wide, which is why 10 m was rejected.
    const padShortAxisM = 2 * TILE_EDGE_METRES
    const padLongAxisM = 3 * TILE_EDGE_METRES
    expect(padShortAxisM).toBe(10)
    expect(padLongAxisM).toBe(15)
    expect(padShortAxisM).toBeGreaterThan(STARSHIP_HULL_DIAMETER_M)
    expect(footprintAreaM2(PAD_TILES)).toBe(150)
  })

  it('should give a 2x2 habitat above NASA’s 25 m3/colonist floor but still austere', () => {
    // Anchor 2: 100 m2 x 3 m ceiling = 300 m3 for 8 colonists = 37.5 m3 each
    // gross, ~31 m3 net of equipment volume. Above the floor, below ISS
    // roominess. A 10 m tile would give 150 m3/colonist gross — a hotel.
    const volumeM3 = footprintAreaM2(HABITAT_TILES) * HABITAT_CEILING_M
    expect(footprintAreaM2(HABITAT_TILES)).toBe(100)
    expect(volumeM3).toBe(300)
    expect(volumeM3 / HABITAT_COLONISTS).toBeGreaterThan(NASA_VOLUME_FLOOR_M3)
    expect(volumeM3 / HABITAT_COLONISTS).toBeLessThan(2 * NASA_VOLUME_FLOOR_M3)
  })

  it('should span 320 m across a 64x64 map', () => {
    // Anchor 4: a realistic early-base footprint, ~10 hectares of buildable land.
    expect(MAP_EDGE_TILES * TILE_EDGE_METRES).toBe(320)
    expect(footprintAreaM2(MAP_EDGE_TILES * MAP_EDGE_TILES)).toBe(102_400)
  })
})

describe('tileAreaForEdgeM2', () => {
  it('should square the edge length for the locked 5 m tile', () => {
    expect(tileAreaForEdgeM2(5)).toBe(25)
  })

  it('should accept a fractional edge such as the 7.5 m fallback', () => {
    // The bead records 7.5 m as the fallback if roomier habitats are wanted, so
    // a non-integer edge must be representable even though the locked value is 5.
    expect(tileAreaForEdgeM2(7.5)).toBe(56.25)
  })

  it('should scale area with the SQUARE of the edge, not linearly', () => {
    // This is the load-bearing property of the whole module: doubling the tile
    // edge quadruples every areal quantity derived from it.
    expect(tileAreaForEdgeM2(10)).toBe(4 * tileAreaForEdgeM2(5))
    expect(tileAreaForEdgeM2(15)).toBe(9 * tileAreaForEdgeM2(5))
    expect(tileAreaForEdgeM2(2.5)).toBe(0.25 * tileAreaForEdgeM2(5))
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ])('should reject a %s edge length with a RangeError', (_label, edge) => {
    expect(() => tileAreaForEdgeM2(edge)).toThrow(RangeError)
  })
})

describe('footprintAreaM2', () => {
  it('should return one tile area for a single tile', () => {
    expect(footprintAreaM2(1)).toBe(25)
  })

  it('should multiply the tile count by the derived tile area', () => {
    // Asserted against TILE_AREA_M2 rather than literal products so the
    // relationship survives a change to the constant.
    for (const tiles of [1, 2, 4, 6, 9, 100]) {
      expect(footprintAreaM2(tiles)).toBe(tiles * TILE_AREA_M2)
    }
  })

  it('should handle a whole-map tile count without precision loss', () => {
    // 1,000,000 tiles = 25,000,000 m2 = 25 km2, far larger than any map we will
    // ship, and still exactly representable.
    expect(footprintAreaM2(1_000_000)).toBe(25_000_000)
    expect(Number.isInteger(footprintAreaM2(1_000_000))).toBe(true)
  })

  it('should return whole square metres at the locked 5 m scale', () => {
    // Integrality is a property of the locked edge (5^2 = 25), not of the
    // function: an override with a fractional edge legitimately yields fractions.
    expect(Number.isInteger(footprintAreaM2(7))).toBe(true)
    expect(Number.isInteger(footprintAreaM2(7, 7.5))).toBe(false)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ])('should reject a %s tile count with a RangeError', (_label, tiles) => {
    expect(() => footprintAreaM2(tiles)).toThrow(RangeError)
  })

  it('should reject a bad tile-edge override with a RangeError', () => {
    expect(() => footprintAreaM2(4, 0)).toThrow(RangeError)
    expect(() => footprintAreaM2(4, -5)).toThrow(RangeError)
    expect(() => footprintAreaM2(4, Number.NaN)).toThrow(RangeError)
  })
})

describe('arealDensityKgPerM2', () => {
  it('should convert 3 m of regolith at 1.5 g/cm3 into 4,500 kg/m2', () => {
    expect(arealDensityKgPerM2(REGOLITH_DEPTH_M, REGOLITH_BULK_DENSITY_KG_M3)).toBe(4500)
  })

  it('should return zero for zero depth (an unshielded surface)', () => {
    // Zero depth is a real physical state — nothing piled on the roof — unlike a
    // zero-tile building, so it is allowed rather than rejected.
    expect(arealDensityKgPerM2(0, REGOLITH_BULK_DENSITY_KG_M3)).toBe(0)
  })

  it('should scale linearly with depth', () => {
    // Depth is a linear dimension, not an areal one: no square law here. Doubling
    // berm depth doubles mass; doubling tile edge quadruples it.
    expect(arealDensityKgPerM2(6, REGOLITH_BULK_DENSITY_KG_M3)).toBe(
      2 * arealDensityKgPerM2(3, REGOLITH_BULK_DENSITY_KG_M3),
    )
  })

  it.each([
    ['negative depth', -1, REGOLITH_BULK_DENSITY_KG_M3],
    ['NaN depth', Number.NaN, REGOLITH_BULK_DENSITY_KG_M3],
    ['infinite depth', Number.POSITIVE_INFINITY, REGOLITH_BULK_DENSITY_KG_M3],
    ['zero density', REGOLITH_DEPTH_M, 0],
    ['negative density', REGOLITH_DEPTH_M, -1500],
    ['NaN density', REGOLITH_DEPTH_M, Number.NaN],
    ['infinite density', REGOLITH_DEPTH_M, Number.POSITIVE_INFINITY],
  ])('should reject %s with a RangeError', (_label, depth, density) => {
    expect(() => arealDensityKgPerM2(depth, density)).toThrow(RangeError)
  })
})

describe('arealMassKg', () => {
  it('should reproduce the 450 t habitat shielding figure from the constants alone', () => {
    // THE pinned number from the epic plan: 4 tiles x 25 m2/tile x 4,500 kg/m2
    // = 450,000 kg = 450 t of bulk regolith over one 2x2 habitat. Every input is
    // derived (depth x density, tiles x TILE_AREA_M2); nothing is hand-entered.
    const kgPerM2 = arealDensityKgPerM2(REGOLITH_DEPTH_M, REGOLITH_BULK_DENSITY_KG_M3)
    expect(arealMassKg(HABITAT_TILES, kgPerM2)).toBe(450_000)
  })

  it('should be zero kilograms for a zero areal density', () => {
    expect(arealMassKg(HABITAT_TILES, 0)).toBe(0)
  })

  it('should scale linearly with tile count', () => {
    expect(arealMassKg(1, 4500)).toBe(112_500)
    expect(arealMassKg(8, 4500)).toBe(2 * arealMassKg(4, 4500))
  })

  it('should handle a colony-scale tile count exactly', () => {
    // 400 tiles (a 20x20 shielded compound) at 4,500 kg/m2 = 45,000 t.
    expect(arealMassKg(400, 4500)).toBe(45_000_000)
    expect(Number.isInteger(arealMassKg(400, 4500))).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['negative', -4],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
  ])('should reject a %s tile count with a RangeError', (_label, tiles) => {
    expect(() => arealMassKg(tiles, 4500)).toThrow(RangeError)
  })

  it.each([
    ['negative', -4500],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
  ])('should reject a %s areal density with a RangeError', (_label, kgPerM2) => {
    expect(() => arealMassKg(HABITAT_TILES, kgPerM2)).toThrow(RangeError)
  })
})

describe('scale sensitivity (the square law)', () => {
  it('should rescale every areal mass by the SQUARE of an edge-length change', () => {
    // Anchor 3, stated as an executable property: the same 2x2 habitat needs
    // 450 t of regolith at a 5 m tile and 1,800 t at a 10 m tile — 4x, not 2x.
    // This is why the areal figures may only ever be derived, never typed in.
    const kgPerM2 = arealDensityKgPerM2(REGOLITH_DEPTH_M, REGOLITH_BULK_DENSITY_KG_M3)
    expect(arealMassKg(HABITAT_TILES, kgPerM2, 5)).toBe(450_000)
    expect(arealMassKg(HABITAT_TILES, kgPerM2, 10)).toBe(1_800_000)
    expect(arealMassKg(HABITAT_TILES, kgPerM2, 10)).toBe(4 * arealMassKg(HABITAT_TILES, kgPerM2, 5))
  })

  it.each([0.5, 1, 1.5, 2, 3, 4])(
    'should move areal quantities by the ratio squared when the edge changes by %sx',
    (ratio) => {
      const rescaledEdge = TILE_EDGE_METRES * ratio
      const tiles = 6
      expect(footprintAreaM2(tiles, rescaledEdge)).toBeCloseTo(
        ratio * ratio * footprintAreaM2(tiles),
        6,
      )
      expect(arealMassKg(tiles, 4500, rescaledEdge)).toBeCloseTo(
        ratio * ratio * arealMassKg(tiles, 4500),
        6,
      )
    },
  )

  it('should leave the solar energy payback period scale-INVARIANT', () => {
    // Non-obvious and worth pinning: silicon cost and energy yield are BOTH
    // areal, so the tile area cancels out of their ratio and the payback period
    // is the same at any tile size. The per-m2 figures below are illustrative
    // stand-ins for the solar chain's ratified values, chosen so the quotient is
    // the 41 turns quoted in the epic plan.
    const siliconCostPerM2 = 82
    const energyYieldPerM2PerTurn = 2
    const paybackTurns = (edgeMetres: number): number =>
      footprintAreaM2(1, edgeMetres) * siliconCostPerM2 /
      (footprintAreaM2(1, edgeMetres) * energyYieldPerM2PerTurn)

    expect(paybackTurns(TILE_EDGE_METRES)).toBe(41)
    for (const edge of [1, 2.5, 5, 7.5, 10, 100]) {
      expect(paybackTurns(edge)).toBe(41)
    }
  })
})
