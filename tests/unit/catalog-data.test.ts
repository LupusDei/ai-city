/**
 * Chain 1's three authored catalog entries (aic-d8y.1.2, spec 002 FR-006/007/008).
 *
 * WHAT THIS SUITE IS ACTUALLY GUARDING, beyond "the numbers are the numbers":
 *
 *   1. THE ENTRIES ARE DATA. Every assertion here runs the specs through the REAL
 *      `createCatalog`, so if an entry ever needed a code branch to be legal, that
 *      would show up as a validation failure here rather than as a special case
 *      three modules away (FR-002).
 *   2. THE BERM COST IS DERIVED, NOT TYPED. `aic-ck0`'s whole point: a hand-typed
 *      450,000,000 would satisfy "the berm costs 450 t" forever. Two things are
 *      needed to close that, and both live here — the authored cost must EQUAL the
 *      `scale.ts` derivation, and it must MOVE when the tile edge moves (SC-003).
 *      The third leg is `tests/integration/composition-audit.test.ts`: `scale.ts`
 *      leaving `ACCEPTED_ORPHANS` is what proves the production module really calls
 *      the derivation rather than merely agreeing with it.
 *   3. THE 40x OVER-FEED SURVIVES TUNING. It is the chain's whole lesson (digging is
 *      nearly free, heat is ruinous), so a future balance pass that destroys it must
 *      fail loudly rather than silently make the Press stop being the bottleneck.
 */

import { describe, expect, it } from 'vitest'

import {
  PRIORITY_DEFAULT,
  PRIORITY_PROCESSOR_DOWNSTREAM,
  PRIORITY_PROCESSOR_UPSTREAM,
} from '../../src/sim/brownout'
import { createCatalog, getStructureType, listStructureTypes } from '../../src/sim/catalog'
import type { StructureType, StructureTypeSpec } from '../../src/sim/catalog'
import {
  BERM_CRUST_DEPTH_METRES,
  BERM_FILL_DEPTH_METRES,
  HOPPER_DRAW_WATTS,
  HOPPER_HEAP_DEPTH_METRES,
  HOPPER_HEAP_TILES,
  HOPPER_REGOLITH_PER_TURN_G,
  PRESS_PLATE_PER_TURN_G,
  PRESS_REGOLITH_PER_TURN_G,
  REGOLITH,
  REGOLITH_BULK_DENSITY_KG_PER_M3,
  REGOLITH_HOPPER_ID,
  SHIELDED_MODULE_TILES,
  SHIELD_BERM_ID,
  SINTERED_CRUST_DENSITY_KG_PER_M3,
  SINTERED_PLATE,
  SINTER_PRESS_DRAW_WATTS,
  SINTER_PRESS_ID,
  chainOneStructureSpecs,
} from '../../src/sim/catalog-data'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { TILE_EDGE_METRES, arealDensityKgPerM2, arealMassKg } from '../../src/sim/scale'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'

const CONFIG = DEFAULT_TURN_CYCLE

/** Grams per kilogram. Spelled out because every mass figure below is a base-unit gram. */
const GRAMS_PER_KG = 1000

/** The three specs, validated through the production boundary — the only way this suite reads them. */
function types(): readonly StructureType[] {
  return listStructureTypes(createCatalog(chainOneStructureSpecs(CONFIG)))
}

function type(id: string): StructureType {
  const found = getStructureType(createCatalog(chainOneStructureSpecs(CONFIG)), id)
  if (found === undefined) throw new Error(`chain 1 catalog is missing "${id}"`)
  return found
}

function spec(id: string): StructureTypeSpec {
  const found = chainOneStructureSpecs(CONFIG).find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`chain 1 specs are missing "${id}"`)
  return found
}

/** A footprint as a comparable set of `"dx,dy"` keys. */
function offsets(structure: StructureType): ReadonlySet<string> {
  return new Set(structure.footprint.map(({ dx, dy }) => `${dx},${dy}`))
}

describe('chainOneStructureSpecs', () => {
  it('should validate all three entries through createCatalog in declaration order', () => {
    expect(types().map((entry) => entry.id)).toEqual([
      REGOLITH_HOPPER_ID,
      SINTER_PRESS_ID,
      SHIELD_BERM_ID,
    ])
  })

  it('should express every resource amount as a non-negative integer in base units', () => {
    for (const entry of types()) {
      for (const map of [
        entry.produces,
        entry.consumes,
        entry.buildCost,
        entry.storageCapacity,
        entry.standbyConsumes,
      ]) {
        for (const [resource, amount] of Object.entries(map)) {
          expect(Number.isInteger(amount), `${entry.id}.${resource} = ${amount}`).toBe(true)
          expect(amount).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('should survive a round trip back through createCatalog — no unknown or aliased fields', () => {
    // A validated `StructureType` is assignable to `StructureTypeSpec`, so re-validating
    // it exercises `validateNoUnknownProperties` against the exact object shape this
    // module produces. A stray field would throw here rather than ride through silently.
    expect(() => createCatalog(types())).not.toThrow()
  })

  it('should reject a malformed Hopper variant at the catalog boundary', () => {
    const malformed: StructureTypeSpec = {
      ...spec(REGOLITH_HOPPER_ID),
      produces: { [REGOLITH]: -1 },
    }
    expect(() => createCatalog([malformed])).toThrow(RangeError)
  })

  it('should reject a malformed Press variant at the catalog boundary', () => {
    const malformed: StructureTypeSpec = {
      ...spec(SINTER_PRESS_ID),
      // Half a gram of regolith a turn: exactly the fractional amount the integer
      // base-unit rule exists to refuse.
      consumes: { [REGOLITH]: 1_400_000.5 },
    }
    expect(() => createCatalog([malformed])).toThrow(RangeError)
  })

  it('should reject a malformed Berm variant at the catalog boundary', () => {
    const berm = spec(SHIELD_BERM_ID)
    const malformed: StructureTypeSpec = {
      ...berm,
      footprint: [...berm.footprint, { dx: 0, dy: 0 }],
    }
    expect(() => createCatalog([malformed])).toThrow(/duplicate footprint offset/i)
  })

  it('should reject a malformed turn-cycle config, delegating to time.ts', () => {
    expect(() =>
      chainOneStructureSpecs({ workSeconds: 0, rechargeSeconds: 88_775, missionSeconds: 1 }),
    ).toThrow(RangeError)
  })

  it('should reject a non-positive tile edge, delegating to scale.ts', () => {
    expect(() => chainOneStructureSpecs(CONFIG, 0)).toThrow(RangeError)
    expect(() => chainOneStructureSpecs(CONFIG, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('should be a pure function of its arguments — two calls agree exactly', () => {
    expect(chainOneStructureSpecs(CONFIG)).toEqual(chainOneStructureSpecs(CONFIG))
  })
})

describe('Regolith Hopper (FR-006)', () => {
  it('should occupy exactly one tile, its own anchor', () => {
    expect(type(REGOLITH_HOPPER_ID).footprint).toEqual([{ dx: 0, dy: 0 }])
  })

  it('should take 2 build turns', () => {
    expect(type(REGOLITH_HOPPER_ID).buildTurns).toBe(2)
  })

  it('should draw 12 kW converted once into whole watt-hours per turn', () => {
    // 12,000 W * 178,775 s / 3,600 s/h = 595,916.67 Wh -> 595,917 Wh.
    // NOT 12,000: a turn is 49.6597 h, not one hour.
    expect(HOPPER_DRAW_WATTS).toBe(12_000)
    expect(type(REGOLITH_HOPPER_ID).consumes[ELECTRICITY]).toBe(
      energyPerTurnWh(HOPPER_DRAW_WATTS, CONFIG),
    )
    expect(type(REGOLITH_HOPPER_ID).consumes[ELECTRICITY]).toBe(595_917)
  })

  it('should produce exactly 60 t of regolith per turn and nothing else', () => {
    // 60 t * 1,000 kg/t * 1,000 g/kg = 60,000,000 g.
    expect(HOPPER_REGOLITH_PER_TURN_G).toBe(60_000_000)
    expect(type(REGOLITH_HOPPER_ID).produces).toEqual({ [REGOLITH]: 60_000_000 })
  })

  it('should consume electricity only — no feedstock, so no input starvation', () => {
    expect(Object.keys(type(REGOLITH_HOPPER_ID).consumes)).toEqual([ELECTRICITY])
  })

  it('should require no mineral deposit — Martian soil is regolith everywhere', () => {
    // FR-006. Absence IS the statement: `siting` normalises to `{}`, and a player who
    // lands badly can still shield a habitat.
    expect(type(REGOLITH_HOPPER_ID).siting).toEqual({})
    expect(type(REGOLITH_HOPPER_ID).siting.requiresDeposit).toBeUndefined()
  })

  it('should sit in the upstream processor brownout class — the first thing shed', () => {
    expect(type(REGOLITH_HOPPER_ID).priorityClass).toBe(PRIORITY_PROCESSOR_UPSTREAM)
  })

  it('should house nobody and draw no standby load', () => {
    expect(type(REGOLITH_HOPPER_ID).habitatCapacity).toBe(0)
    expect(type(REGOLITH_HOPPER_ID).standbyConsumes).toEqual({})
  })

  it('should cap the regolith pile at its areal spoil-heap capacity', () => {
    // 9 tiles (its own plus the eight-tile apron) * 25 m2 = 225 m2, heaped to 2 m of
    // loose regolith at 1,500 kg/m3 = 3,000 kg/m2 -> 675,000 kg = 675,000,000 g.
    expect(HOPPER_HEAP_TILES).toBe(9)
    expect(HOPPER_HEAP_DEPTH_METRES).toBe(2)
    expect(type(REGOLITH_HOPPER_ID).storageCapacity[REGOLITH]).toBe(
      arealMassKg(
        HOPPER_HEAP_TILES,
        arealDensityKgPerM2(HOPPER_HEAP_DEPTH_METRES, REGOLITH_BULK_DENSITY_KG_PER_M3),
      ) * GRAMS_PER_KG,
    )
    expect(type(REGOLITH_HOPPER_ID).storageCapacity[REGOLITH]).toBe(675_000_000)
  })

  it('should hold at least one whole berm of fill, so a lone Hopper can shield a habitat', () => {
    // SC-001 has one Hopper supplying one berm. If the cap were below the berm's fill
    // cost the chain would deadlock at full-and-overflowing, and no test on either side
    // of that seam would notice.
    const cap = type(REGOLITH_HOPPER_ID).storageCapacity[REGOLITH] ?? 0
    const bermFill = type(SHIELD_BERM_ID).buildCost[REGOLITH] ?? 0
    expect(cap).toBeGreaterThanOrEqual(bermFill)
  })

  it('should fill its own pile in a whole number of turns short of the mission', () => {
    // 675,000,000 / 60,000,000 = 11.25 turns, so overflow is reachable in ordinary play
    // (turn 12) rather than being a theoretical branch nobody ever exercises.
    const cap = type(REGOLITH_HOPPER_ID).storageCapacity[REGOLITH] ?? 0
    expect(Math.ceil(cap / HOPPER_REGOLITH_PER_TURN_G)).toBe(12)
  })
})

describe('Sinter Press (FR-007)', () => {
  it('should occupy an L of exactly 3 tiles including its anchor', () => {
    const press = type(SINTER_PRESS_ID)
    expect(press.footprint).toHaveLength(3)
    expect(offsets(press).has('0,0')).toBe(true)
    // No duplicates: a set of the same size as the list.
    expect(offsets(press).size).toBe(3)
  })

  it('should be a genuine L rather than three tiles in a line', () => {
    const press = type(SINTER_PRESS_ID)
    const distinctX = new Set(press.footprint.map(({ dx }) => dx))
    const distinctY = new Set(press.footprint.map(({ dy }) => dy))
    // A straight tromino has one distinct row or one distinct column; an L has two of each.
    expect(distinctX.size).toBeGreaterThan(1)
    expect(distinctY.size).toBeGreaterThan(1)
  })

  it('should take 6 build turns', () => {
    expect(type(SINTER_PRESS_ID).buildTurns).toBe(6)
  })

  it('should draw 30 kW converted once into whole watt-hours per turn', () => {
    // 30,000 W * 178,775 s / 3,600 s/h = 1,489,791.67 Wh -> 1,489,792 Wh.
    expect(SINTER_PRESS_DRAW_WATTS).toBe(30_000)
    expect(type(SINTER_PRESS_ID).consumes[ELECTRICITY]).toBe(
      energyPerTurnWh(SINTER_PRESS_DRAW_WATTS, CONFIG),
    )
    expect(type(SINTER_PRESS_ID).consumes[ELECTRICITY]).toBe(1_489_792)
  })

  it('should turn 1.4 t of regolith into 1.2 t of plate per turn', () => {
    expect(type(SINTER_PRESS_ID).consumes[REGOLITH]).toBe(1_400_000)
    expect(type(SINTER_PRESS_ID).produces).toEqual({ [SINTERED_PLATE]: 1_200_000 })
    expect(PRESS_REGOLITH_PER_TURN_G).toBe(1_400_000)
    expect(PRESS_PLATE_PER_TURN_G).toBe(1_200_000)
  })

  it('should lose mass across the process rather than creating it', () => {
    // 200,000 g a turn leaves as adsorbed volatiles and fines. A process that produced
    // MORE mass than it consumed would be a perpetual-motion machine, and the only
    // check that catches it is this comparison.
    expect(PRESS_PLATE_PER_TURN_G).toBeLessThan(PRESS_REGOLITH_PER_TURN_G)
  })

  it('should sit ABOVE its own feeder in the brownout order', () => {
    expect(type(SINTER_PRESS_ID).priorityClass).toBe(PRIORITY_PROCESSOR_DOWNSTREAM)
    // Lower is higher priority: the scarce conversion stage is shed AFTER the abundant
    // extraction stage that over-feeds it. See brownout.ts.
    expect(type(SINTER_PRESS_ID).priorityClass).toBeLessThan(
      type(REGOLITH_HOPPER_ID).priorityClass,
    )
  })

  it('should house nobody', () => {
    expect(type(SINTER_PRESS_ID).habitatCapacity).toBe(0)
  })
})

describe('Shield Berm (FR-008)', () => {
  it('should occupy a 12-tile skirt whose hole is exactly the module it shields', () => {
    const berm = type(SHIELD_BERM_ID)
    expect(berm.footprint).toHaveLength(12)
    expect(offsets(berm).size).toBe(12)
    expect(offsets(berm).has('0,0')).toBe(true)
    // The ring spans a 4x4 block; the four interior tiles are where the 2x2 habitat
    // stands, so the berm never overlaps the module it rates.
    for (const hole of ['1,1', '2,1', '1,2', '2,2']) {
      expect(offsets(berm).has(hole)).toBe(false)
    }
    for (const dx of [0, 1, 2, 3]) {
      for (const dy of [0, 1, 2, 3]) {
        const interior = dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2
        expect(offsets(berm).has(`${dx},${dy}`)).toBe(!interior)
      }
    }
  })

  it('should be material-gated, not labour-gated, and draw no power', () => {
    const berm = type(SHIELD_BERM_ID)
    expect(berm.buildTurns).toBe(0)
    expect(berm.consumes).toEqual({})
    expect(berm.produces).toEqual({})
    expect(berm.habitatCapacity).toBe(0)
  })

  it('should land in the unclassified brownout class, which is free for a zero-draw structure', () => {
    expect(type(SHIELD_BERM_ID).priorityClass).toBe(PRIORITY_DEFAULT)
  })

  it('should DERIVE its 450 t of fill from the tile edge, 3 m of cover and bulk density', () => {
    // 4 tiles * 25 m2 = 100 m2 of module to cover; 3 m of loose regolith at
    // 1,500 kg/m3 = 4,500 kg/m2; 100 * 4,500 = 450,000 kg = 450,000,000 g.
    expect(SHIELDED_MODULE_TILES).toBe(4)
    expect(BERM_FILL_DEPTH_METRES).toBe(3)
    expect(type(SHIELD_BERM_ID).buildCost[REGOLITH]).toBe(
      arealMassKg(
        SHIELDED_MODULE_TILES,
        arealDensityKgPerM2(BERM_FILL_DEPTH_METRES, REGOLITH_BULK_DENSITY_KG_PER_M3),
      ) * GRAMS_PER_KG,
    )
    expect(type(SHIELD_BERM_ID).buildCost[REGOLITH]).toBe(450_000_000)
  })

  it('should DERIVE its 11 t sintered crust the same way', () => {
    // 0.05 m * 1,500 kg/m3 = 75 kg/m2; 100 m2 -> 7,500 kg = 7,500,000 g.
    expect(BERM_CRUST_DEPTH_METRES).toBe(0.05)
    expect(type(SHIELD_BERM_ID).buildCost[SINTERED_PLATE]).toBe(
      Math.round(
        arealMassKg(
          SHIELDED_MODULE_TILES,
          arealDensityKgPerM2(BERM_CRUST_DEPTH_METRES, SINTERED_CRUST_DENSITY_KG_PER_M3),
        ) * GRAMS_PER_KG,
      ),
    )
    expect(type(SHIELD_BERM_ID).buildCost[SINTERED_PLATE]).toBe(11_000_000)
  })

  it('should QUADRUPLE both costs when the tile edge doubles (SC-003)', () => {
    // The square law, asserted on the authored entry rather than on scale.ts alone: a
    // hand-typed 450,000,000 could not move at all, which is exactly what aic-ck0 says
    // would otherwise pass every test in the suite.
    const atDouble = chainOneStructureSpecs(CONFIG, TILE_EDGE_METRES * 2)
    const berm = atDouble.find((entry) => entry.id === SHIELD_BERM_ID)
    expect(berm).toBeDefined()
    expect(berm?.buildCost?.[REGOLITH]).toBe(450_000_000 * 4)
    expect(berm?.buildCost?.[SINTERED_PLATE]).toBe(11_000_000 * 4)
  })

  it('should HALVE both costs when the tile edge halves — the law holds in both directions', () => {
    const atHalf = chainOneStructureSpecs(CONFIG, TILE_EDGE_METRES / 2)
    const berm = atHalf.find((entry) => entry.id === SHIELD_BERM_ID)
    expect(berm?.buildCost?.[REGOLITH]).toBe(450_000_000 / 4)
    expect(berm?.buildCost?.[SINTERED_PLATE]).toBe(11_000_000 / 4)
  })

  it('should leave the Hopper and Press untouched by the tile edge — only areal costs scale', () => {
    const atDouble = chainOneStructureSpecs(CONFIG, TILE_EDGE_METRES * 2)
    const hopper = atDouble.find((entry) => entry.id === REGOLITH_HOPPER_ID)
    expect(hopper?.produces[REGOLITH]).toBe(HOPPER_REGOLITH_PER_TURN_G)
    expect(hopper?.consumes[ELECTRICITY]).toBe(energyPerTurnWh(HOPPER_DRAW_WATTS, CONFIG))
  })

  it('should use BULK density, not mineral grain density — grain would overstate it by ~93%', () => {
    // Drones pile unconsolidated material with void space; they do not cast solid rock.
    // Grain density (~2,900 kg/m3) would bill 870 t for the same 3 m of cover.
    expect(REGOLITH_BULK_DENSITY_KG_PER_M3).toBe(1500)
    const grainCost =
      arealMassKg(SHIELDED_MODULE_TILES, arealDensityKgPerM2(BERM_FILL_DEPTH_METRES, 2900)) *
      GRAMS_PER_KG
    expect(grainCost).toBe(870_000_000)
    expect(type(SHIELD_BERM_ID).buildCost[REGOLITH]).toBeLessThan(grainCost)
  })

  it('should cost a whole number of Hopper-turns and Press-turns to supply', () => {
    // 450,000,000 / 60,000,000 = 7.5 Hopper-turns; 11,000,000 / 1,200,000 = 9.17
    // Press-turns. Asserted as ceilings because a partial turn still costs a whole turn
    // of production (the General's "no storing labour" ruling — a part-funded turn is
    // not banked).
    //
    // The crust figure was CORRECTED from 7.5 t under aic-to6.3: spec 002 originally used
    // 1,500 kg/m3, the bulk density of loose fines, for a SINTERED plate — my error when
    // writing that spec, since sintering is exactly the process that removes that
    // porosity. At the corrected 2,200 kg/m3 the PRESS becomes the bottleneck (10 turns
    // against the Hopper's 8), which is the chain's whole thesis: digging is nearly free,
    // heat is ruinous. The wrong number had made them look "nicely matched".
    const fill = type(SHIELD_BERM_ID).buildCost[REGOLITH] ?? 0
    const crust = type(SHIELD_BERM_ID).buildCost[SINTERED_PLATE] ?? 0
    expect(Math.ceil(fill / HOPPER_REGOLITH_PER_TURN_G)).toBe(8)
    expect(Math.ceil(crust / PRESS_PLATE_PER_TURN_G)).toBe(10)
  })
})

describe('the emergent 40x over-feed (the chain lesson)', () => {
  it('should have one Hopper over-feed one Press by more than 40x', () => {
    // 60,000,000 / 1,400,000 = 42.86x. Digging costs ~0.01 kWh/kg; sintering costs
    // ~1.2 kWh/kg (a 0.244 kWh/kg thermodynamic floor at ~20% efficiency). Two orders
    // of magnitude, which is why Presses are the bottleneck and dirt never is.
    //
    // Asserted with integer multiplication rather than division so the guard itself
    // cannot drift on a rounding: 60,000,000 > 40 * 1,400,000 = 56,000,000.
    expect(HOPPER_REGOLITH_PER_TURN_G).toBeGreaterThan(40 * PRESS_REGOLITH_PER_TURN_G)
    expect(type(REGOLITH_HOPPER_ID).produces[REGOLITH]).toBeGreaterThan(
      40 * (type(SINTER_PRESS_ID).consumes[REGOLITH] ?? 0),
    )
  })

  it('should make heat, not haulage, the expensive half of the chain', () => {
    // Per gram moved vs per gram sintered, in watt-hours of the same turn: the Press
    // costs 2.5x the Hopper's power for 1/43rd of its throughput.
    const hopperWh = type(REGOLITH_HOPPER_ID).consumes[ELECTRICITY] ?? 0
    const pressWh = type(SINTER_PRESS_ID).consumes[ELECTRICITY] ?? 0
    expect(pressWh).toBeGreaterThan(hopperWh * 2)
  })

  it('should cost 105% of one reactor to run the pair (SC-001)', () => {
    const hopperWh = type(REGOLITH_HOPPER_ID).consumes[ELECTRICITY] ?? 0
    const pressWh = type(SINTER_PRESS_ID).consumes[ELECTRICITY] ?? 0
    const reactorWh = energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG)
    // 595,917 + 1,489,792 = 2,085,709 Wh against a reactor's 1,986,389 Wh.
    expect(hopperWh + pressWh).toBe(2_085_709)
    expect(hopperWh + pressWh).toBeGreaterThan(reactorWh)
    expect(hopperWh + pressWh).toBeLessThan(reactorWh * 2)
  })
})
