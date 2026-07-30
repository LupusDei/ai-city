/**
 * The core roster's two authored catalog entries — a buildable Reactor Unit and a
 * buildable Habitat Module (aic-oby.4).
 *
 * WHY THIS SUITE EXISTS. Before this bead, `catalog-data.ts` (chain 1: hopper, press,
 * berm) was the ONLY authored catalog data in production, and none of its three entries
 * carries `habitatCapacity > 0` or generates electricity — by that module's own doc,
 * "there is no habitat catalog entry in production yet". The mission's win condition
 * (`mission.ts`: completed habitat capacity >= incoming wave size) therefore had no
 * buildable path to a win at all, and the design's central "reactors vs habitats" power
 * squeeze had no reactor a player could build either — the only generator was the
 * single pre-placed reactor hull. This module supplies both, as pure data, mirroring the
 * same two structures every multi-turn test fixture in this codebase already assumes
 * (`tests/integration/golden-scenario.ts`, `tests/integration/construction-drift.test.ts`,
 * and a dozen unit-test fixtures use the identical 32 kW/6.4 kW habitat draw and the
 * identical 40 kW reactor).
 *
 * WHAT IS RATIFIED VS. WHAT THIS BEAD TUNES:
 *   - The reactor's rated output (`REACTOR_OUTPUT_WATTS`, `power.ts`) and the habitat's
 *     rated/standby draw (32 kW / 6.4 kW, `catalog.ts`'s own `standbyConsumes` doc,
 *     aic-96o) are RATIFIED figures this module only ever reuses, never restates.
 *   - `buildTurns`, `habitatCapacity` and the footprints are this bead's own balance
 *     data — authored here, asserted here, and the values a balance pass is expected to
 *     retune as measurement dictates (aic-oby.4's own mandate: "every tuned value lives
 *     in data, not code").
 */

import { describe, expect, it } from 'vitest'

import { PRIORITY_DEFAULT, PRIORITY_HABITAT } from '../../src/sim/brownout'
import { createCatalog, getStructureType, listStructureTypes } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import {
  HABITAT_CAPACITY_PER_MODULE,
  HABITAT_MODULE_ID,
  HABITAT_RATED_DRAW_WATTS,
  HABITAT_STANDBY_DRAW_WATTS,
  REACTOR_UNIT_ID,
  coreStructureSpecs,
} from '../../src/sim/catalog-data-core'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'

const CONFIG = DEFAULT_TURN_CYCLE

function types(): readonly StructureType[] {
  return listStructureTypes(createCatalog(coreStructureSpecs(CONFIG)))
}

function type(id: string): StructureType {
  const found = getStructureType(createCatalog(coreStructureSpecs(CONFIG)), id)
  if (found === undefined) throw new Error(`core catalog is missing "${id}"`)
  return found
}

describe('coreStructureSpecs', () => {
  it('should validate both entries through createCatalog in declaration order', () => {
    expect(types().map((entry) => entry.id)).toEqual([REACTOR_UNIT_ID, HABITAT_MODULE_ID])
  })

  describe('reactor-unit', () => {
    it('should generate exactly REACTOR_OUTPUT_WATTS, converted through energyPerTurnWh', () => {
      const reactor = type(REACTOR_UNIT_ID)
      expect(reactor.produces[ELECTRICITY]).toBe(energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG))
    })

    it('should draw no electricity and house no colonists', () => {
      const reactor = type(REACTOR_UNIT_ID)
      expect(reactor.consumes[ELECTRICITY] ?? 0).toBe(0)
      expect(reactor.habitatCapacity).toBe(0)
    })

    it('should use the constant output curve (unaffected by dust storms)', () => {
      // Absent `powerOutputModel` normalises to `CONSTANT_OUTPUT_KIND` — see
      // `catalog.ts`. Asserted by name so a future accidental `powerOutputModel`
      // edit here is caught rather than silently changing the reactor's physics.
      expect(type(REACTOR_UNIT_ID).powerOutputModel).toBe('constant')
    })

    it('should require a positive whole number of build-turns', () => {
      const reactor = type(REACTOR_UNIT_ID)
      expect(Number.isInteger(reactor.buildTurns)).toBe(true)
      expect(reactor.buildTurns).toBeGreaterThan(0)
    })

    it('should cost nothing in materials — the reactor/habitat tension is pure power-vs-labour', () => {
      expect(type(REACTOR_UNIT_ID).buildCost).toEqual({})
    })
  })

  describe('habitat-module', () => {
    it('should draw the ratified 32 kW rated / 6.4 kW standby, converted through energyPerTurnWh', () => {
      const habitat = type(HABITAT_MODULE_ID)
      expect(HABITAT_RATED_DRAW_WATTS).toBe(32_000)
      expect(HABITAT_STANDBY_DRAW_WATTS).toBe(6_400)
      expect(habitat.consumes[ELECTRICITY]).toBe(energyPerTurnWh(HABITAT_RATED_DRAW_WATTS, CONFIG))
      expect(habitat.standbyConsumes[ELECTRICITY]).toBe(
        energyPerTurnWh(HABITAT_STANDBY_DRAW_WATTS, CONFIG),
      )
    })

    it('should generate no electricity', () => {
      expect(type(HABITAT_MODULE_ID).produces[ELECTRICITY] ?? 0).toBe(0)
    })

    it('should house HABITAT_CAPACITY_PER_MODULE colonists once complete', () => {
      expect(type(HABITAT_MODULE_ID).habitatCapacity).toBe(HABITAT_CAPACITY_PER_MODULE)
      expect(HABITAT_CAPACITY_PER_MODULE).toBeGreaterThan(0)
    })

    it('should be shed at PRIORITY_HABITAT — above drone recharge, below life support', () => {
      expect(type(HABITAT_MODULE_ID).priorityClass).toBe(PRIORITY_HABITAT)
    })

    it('should require a positive whole number of build-turns', () => {
      const habitat = type(HABITAT_MODULE_ID)
      expect(Number.isInteger(habitat.buildTurns)).toBe(true)
      expect(habitat.buildTurns).toBeGreaterThan(0)
    })

    it('should cost nothing in materials — the reactor/habitat tension is pure power-vs-labour', () => {
      expect(type(HABITAT_MODULE_ID).buildCost).toEqual({})
    })

    it('should require no deposit and carry no siting restriction', () => {
      expect(type(HABITAT_MODULE_ID).siting).toEqual({})
    })
  })

  it('should give the reactor and the habitat disjoint, anchor-including footprints', () => {
    for (const id of [REACTOR_UNIT_ID, HABITAT_MODULE_ID]) {
      const footprint = type(id).footprint
      expect(footprint.some((offset) => offset.dx === 0 && offset.dy === 0)).toBe(true)
      const keys = new Set(footprint.map(({ dx, dy }) => `${dx},${dy}`))
      expect(keys.size).toBe(footprint.length)
    }
  })

  it('should never accidentally default a reactor into PRIORITY_DEFAULT territory the brownout treats specially', () => {
    // The reactor never draws, so its priorityClass is never consulted by the brownout —
    // this only pins that nothing here has accidentally given it a `consumes` entry
    // that WOULD make its (absent, default) priority matter.
    const reactor = type(REACTOR_UNIT_ID)
    expect(reactor.consumes[ELECTRICITY] ?? 0).toBe(0)
    expect(reactor.priorityClass).toBe(PRIORITY_DEFAULT)
  })
})
