/**
 * Integration test for the electricity seam: catalog -> power -> brownout -> drones
 * -> labour -> construction, and catalog -> power -> ledger.
 *
 * WHY THIS FILE EXISTS (aic-96o). It replaces `power-drones.test.ts`, which proved
 * that power and drones agreed on kW. They no longer trade in kW, and the deeper
 * problem it could not have caught was that `ledger.ts` and `power.ts` BOTH owned
 * electricity, in different units, with contradictory semantics, and neither imported
 * the other (docs/turn-composition-audit.md B1).
 *
 * Every number here originates in a REAL `createCatalog` entry and flows through the
 * real modules. Nothing is a hand-written fixture, because a fixture is exactly what
 * let the previous gap hide: a unit test on either side of a missing seam passes.
 *
 * The four conflicts this file is the standing guard for:
 *   1. ONE HOME — a structure's draw is `consumes.electricity`, and there is no second
 *      field anywhere that could disagree with it.
 *   2. NO STORING ENERGY WITHOUT BARRIERS — electricity cannot accumulate across turns
 *      unless a battery grants containment.
 *   3. ONE UNIT — integer watt-hours end to end, no kW.
 *   4. BINARY IDLE — a shed consumer consumes NONE of its inputs, not "as much as was
 *      left".
 */

import { describe, expect, it } from 'vitest'

import {
  PRIORITY_HABITAT,
  PRIORITY_PROCESSOR_DOWNSTREAM,
  PRIORITY_PROCESSOR_UPSTREAM,
} from '../../src/sim/brownout'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { advanceConstruction, createProject, requiredLabourHoursPerBuildTurn } from '../../src/sim/construction'
import type { ConstructionQueue } from '../../src/sim/construction'
import { DRONE_GRID_ENERGY_WH } from '../../src/sim/drones'
import { createGrid } from '../../src/sim/grid'
import { applyLedger } from '../../src/sim/ledger'
import type { ResourceFlow, Stockpile } from '../../src/sim/ledger'
import { validatePlacement } from '../../src/sim/placement'
import {
  DRONE_TURN_CAPACITY_WH,
  ELECTRICITY,
  REACTOR_OUTPUT_WATTS,
  electricityDrawWh,
  electricityLedgerPolicy,
  electricityWh,
  energyPerTurnWh,
  resolveElectricity,
} from '../../src/sim/power'
import type { GridParticipant } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'

const CONFIG = DEFAULT_TURN_CYCLE

/**
 * The colony catalog, authored the way a designer actually would: real wattages
 * converted ONCE with `energyPerTurnWh`, never hand-typed watt-hours.
 */
const CATALOG = createCatalog([
  {
    id: 'reactor',
    name: 'Fission Surface Power Unit',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    buildTurns: 4,
    // Generation is CATALOG DATA, not a module constant times a count (audit E1).
    produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'habitat',
    name: 'Habitat Module',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
    ],
    buildTurns: 6,
    produces: {},
    // Rated 32 kW for 8 colonists; standby 20% of that, per the General's ruling.
    consumes: { [ELECTRICITY]: energyPerTurnWh(32_000, CONFIG) },
    standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(6_400, CONFIG) },
    priorityClass: PRIORITY_HABITAT,
    habitatCapacity: 8,
  },
  {
    id: 'hopper',
    name: 'Regolith Hopper',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 3,
    produces: { regolith: 60_000_000 },
    consumes: { [ELECTRICITY]: energyPerTurnWh(12_000, CONFIG) },
    priorityClass: PRIORITY_PROCESSOR_UPSTREAM,
    habitatCapacity: 0,
  },
  {
    id: 'press',
    name: 'Sinter Press',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 6,
    produces: { sinteredPlate: 1_200_000 },
    consumes: { [ELECTRICITY]: energyPerTurnWh(30_000, CONFIG), regolith: 1_400_000 },
    priorityClass: PRIORITY_PROCESSOR_DOWNSTREAM,
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

/**
 * Build a grid participant from REAL catalog data — the adapter the turn loop will use.
 *
 * This is the whole point of the seam: `producesWh` and `consumesWh` are read out of
 * the catalog, never authored a second time. There is no `drawKw` to disagree with.
 */
function toParticipant(
  id: string,
  typeId: string,
  options: { operating?: boolean; standby?: boolean } = {},
): GridParticipant {
  const structureType = type(typeId)
  return {
    id,
    producesWh: electricityWh(structureType.produces),
    consumesWh: electricityDrawWh(structureType, options.standby ?? false),
    priority: structureType.priorityClass,
    operating: options.operating ?? true,
  }
}

function roster(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `drone-${String(i).padStart(2, '0')}`)
}

describe('electricity seam: one home for a structure’s draw', () => {
  it('should drive the brownout from catalog consumes.electricity alone', () => {
    // The exact production path the old design never had: the number the designer
    // authored is the number that rations power. No second field, no conversion.
    const result = resolveElectricity({
      config: CONFIG,
      participants: [toParticipant('r-1', 'reactor'), toParticipant('press-1', 'press')],
      droneRoster: [],
    })

    expect(result.generationWh).toBe(electricityWh(type('reactor').produces))
    expect(result.structureDemandWh).toBe(electricityWh(type('press').consumes))
    expect(result.poweredStructureIds).toContain('press-1')
  })

  it('should charge a habitat its standby draw, not its rated draw, while unmanned', () => {
    // The General's ruling, exercised end to end. The MVP colony is unmanned for the
    // whole mission, so every habitat is in standby every turn — and the difference is
    // large enough to matter: 32 kW versus 6.4 kW is five drones' worth of capacity.
    const rated = resolveElectricity({
      config: CONFIG,
      participants: [toParticipant('hab-1', 'habitat', { standby: false })],
      droneRoster: [],
    })
    const standby = resolveElectricity({
      config: CONFIG,
      participants: [toParticipant('hab-1', 'habitat', { standby: true })],
      droneRoster: [],
    })

    // 20% of rated, to within one watt-hour. NOT exactly `rated / 5`: each figure is
    // converted from watts to whole watt-hours independently, so the two roundings
    // land 1 Wh apart (1,589,110 against 1,589,111). That is the documented cost of
    // authoring both numbers as data rather than dividing at runtime, and it is the
    // right trade — a runtime division would put a float in the ledger path, while a
    // 1 Wh discrepancy on a 1.59 MWh figure is 6 parts per billion and cannot affect
    // any brownout outcome (the smallest meaningful step is a drone's 275,204 Wh).
    expect(rated.structureDemandWh - standby.structureDemandWh * 5).toBe(1)
    expect(standby.structureDemandWh).toBe(energyPerTurnWh(6_400, CONFIG))
  })

  it('should let a new consumer join the brownout order as catalog data only', () => {
    // The data-driven acceptance criterion. Registering a brand-new consumer in the
    // priority order must require no source edit anywhere — if this test ever needs
    // one, the design has regressed to the hardcoded branch catalog.ts forbids.
    const extended = createCatalog([
      {
        id: 'invented-smelter',
        name: 'Invented Smelter',
        footprint: [{ dx: 0, dy: 0 }],
        buildTurns: 2,
        produces: { unobtainium: 5 },
        consumes: { [ELECTRICITY]: energyPerTurnWh(9_000, CONFIG) },
        priorityClass: PRIORITY_PROCESSOR_DOWNSTREAM,
        habitatCapacity: 0,
      },
    ])
    const smelter = getStructureType(extended, 'invented-smelter')!

    const result = resolveElectricity({
      config: CONFIG,
      participants: [
        toParticipant('r-1', 'reactor'),
        {
          id: 'smelter-1',
          producesWh: electricityWh(smelter.produces),
          consumesWh: electricityDrawWh(smelter, false),
          priority: smelter.priorityClass,
          operating: true,
        },
      ],
      droneRoster: [],
    })
    expect(result.poweredStructureIds).toContain('smelter-1')
    expect(result.brownout).toBe(false)
  })
})

describe('electricity seam: no storing energy without barriers', () => {
  /** The ledger flows for exactly the structures the grid actually powered. */
  function ledgerFlows(
    poweredIds: readonly string[],
    instances: readonly { id: string; typeId: string }[],
    droneEnergyWh: number,
  ): ResourceFlow[] {
    const flows: ResourceFlow[] = instances
      .filter((instance) => poweredIds.includes(instance.id))
      .map((instance) => type(instance.typeId))

    // Drone recharge is a real electricity draw with no structure behind it, so it
    // enters the ledger as its own flow. Note this is the ACTUAL energy taken, not
    // the turn capacity reserved — see power.ts's turn-capacity block.
    if (droneEnergyWh > 0) flows.push({ produces: {}, consumes: { [ELECTRICITY]: droneEnergyWh } })
    return flows
  }

  const instances = [
    { id: 'r-1', typeId: 'reactor' },
    { id: 'hopper-1', typeId: 'hopper' },
  ]

  it('should leave zero electricity stockpiled after a surplus turn', () => {
    const grid = resolveElectricity({
      config: CONFIG,
      participants: instances.map((i) => toParticipant(i.id, i.typeId)),
      droneRoster: roster(2),
    })
    const ledger = applyLedger(
      ledgerFlows(grid.poweredStructureIds, instances, grid.droneEnergyWh),
      {},
      electricityLedgerPolicy(0),
    )

    expect(ledger.stockpiles[ELECTRICITY]).toBe(0)
    expect(ledger.shortfalls).toEqual([])
  })

  it('should report the whole unused surplus as vented, never silently dropped', () => {
    const grid = resolveElectricity({
      config: CONFIG,
      participants: instances.map((i) => toParticipant(i.id, i.typeId)),
      droneRoster: roster(2),
    })
    const ledger = applyLedger(
      ledgerFlows(grid.poweredStructureIds, instances, grid.droneEnergyWh),
      {},
      electricityLedgerPolicy(0),
    )

    // The accounting identity across the seam: everything generated was either drawn
    // by something or vented. If this fails, watt-hours are being created or destroyed
    // between the two modules — the exact class of bug two separate owners caused.
    const drawn = electricityWh(type('hopper').consumes) + grid.droneEnergyWh
    const vented = ledger.vented.find((entry) => entry.resource === ELECTRICITY)
    expect(vented?.amount).toBe(grid.generationWh - drawn)
    expect(drawn + vented!.amount).toBe(grid.generationWh)
  })

  it('should never accumulate electricity across 278 turns without a battery', () => {
    // THE ruling, over the full mission. A single-turn test cannot show this: the
    // failure mode is a stockpile that creeps up turn after turn until the player can
    // run the whole colony off banked energy.
    let stockpiles: Stockpile = {}
    const policy = electricityLedgerPolicy(0)

    for (let turn = 0; turn < 278; turn++) {
      const grid = resolveElectricity({
        config: CONFIG,
        participants: instances.map((i) => toParticipant(i.id, i.typeId)),
        droneRoster: roster(2),
      })
      stockpiles = applyLedger(
        ledgerFlows(grid.poweredStructureIds, instances, grid.droneEnergyWh),
        stockpiles,
        policy,
      ).stockpiles
    }

    expect(stockpiles[ELECTRICITY]).toBe(0)
    // Mass resources are stocks and DO accumulate — 278 turns of hopper output.
    expect(stockpiles.regolith).toBe(60_000_000 * 278)
  })

  it('should carry energy across the turn boundary when a battery grants containment', () => {
    // Batteries are the "barrier". They do not smooth day/night — a turn spans 2.014
    // sols — they are the only route to cross-turn energy, which is what makes them
    // strategic rather than redundant.
    const grid = resolveElectricity({
      config: CONFIG,
      participants: instances.map((i) => toParticipant(i.id, i.typeId)),
      droneRoster: roster(2),
    })
    const capacity = 500_000
    const ledger = applyLedger(
      ledgerFlows(grid.poweredStructureIds, instances, grid.droneEnergyWh),
      {},
      electricityLedgerPolicy(capacity),
    )

    expect(ledger.stockpiles[ELECTRICITY]).toBe(capacity)
    expect(ledger.vented[0]!.amount).toBeLessThan(grid.generationWh)
  })
})

describe('electricity seam: binary idle', () => {
  it('should consume none of a shed structure’s inputs', () => {
    // Spec 002 FR-004 / spec 003 FR-006, and the fourth conflict from the audit. The
    // Press eats 1,400,000 g of regolith a turn — but only when it RUNS. Starved of
    // power it must consume ZERO, not drain the pile to whatever was left, which is
    // what `applyLedger`'s clamp-and-report path would have done if the shed consumer's
    // flow had reached it.
    const instances = [{ id: 'press-1', typeId: 'press' }]
    const grid = resolveElectricity({
      config: CONFIG,
      // No generation at all, so the Press is shed.
      participants: instances.map((i) => toParticipant(i.id, i.typeId)),
      droneRoster: [],
    })
    expect(grid.shedStructureIds).toEqual(['press-1'])

    // Only POWERED structures contribute flows. The shed Press contributes nothing.
    const flows = instances
      .filter((i) => grid.poweredStructureIds.includes(i.id))
      .map((i) => type(i.typeId))
    const ledger = applyLedger(flows, { regolith: 5_000_000 }, electricityLedgerPolicy(0))

    expect(ledger.stockpiles.regolith).toBe(5_000_000) // untouched
    expect(ledger.stockpiles.sinteredPlate).toBeUndefined() // produced nothing
    expect(ledger.shortfalls).toEqual([])
  })

  it('should run a structure fully or not at all, never at a reduced rate', () => {
    // One watt-hour short is as idle as no power at all. There is no fractional path.
    const pressDraw = electricityWh(type('press').consumes)
    const instances = [{ id: 'press-1', typeId: 'press' }]

    for (const [generation, expectedRunning] of [
      [pressDraw, true],
      [pressDraw - 1, false],
    ] as const) {
      const grid = resolveElectricity({
        config: CONFIG,
        participants: [
          { id: 'gen-1', producesWh: generation, consumesWh: 0, priority: 0, operating: true },
          ...instances.map((i) => toParticipant(i.id, i.typeId)),
        ],
        droneRoster: [],
      })
      const flows = instances
        .filter((i) => grid.poweredStructureIds.includes(i.id))
        .map((i) => type(i.typeId))
      const ledger = applyLedger(flows, { regolith: 5_000_000 }, electricityLedgerPolicy(0))

      // Full output or none. Nothing in between is representable.
      expect(ledger.stockpiles.sinteredPlate ?? 0).toBe(expectedRunning ? 1_200_000 : 0)
    }
  })
})

describe('electricity seam: power and labour are one constraint', () => {
  it('should turn fewer reactors into fewer drones into less construction progress', () => {
    // THE ratified core mechanic, proven across five modules rather than asserted in a
    // comment: catalog -> power -> brownout -> drones -> labour -> construction.
    const grid = createGrid(32, 32)
    const habitatType = type('habitat')
    const hoursPerBuildTurn = requiredLabourHoursPerBuildTurn(CONFIG)

    // A queue deep enough to absorb every labour-hour three reactors can buy. With a
    // single project the comparison saturates — one habitat needs only 150 labour-hours
    // and even ONE reactor funds 175 — so the chain would look flat for the wrong
    // reason. The queue, not the power, must be the thing that isn't binding.
    const queue: ConstructionQueue = Array.from({ length: 12 }, (_, i) => {
      const placement = validatePlacement(grid, habitatType, { x: (i % 6) * 3, y: Math.floor(i / 6) * 3 })
      if (!placement.ok) throw new Error(`test setup: habitat ${i} did not fit`)
      return createProject(`hab-${i}`, habitatType, placement)
    })

    function progressAfterOneTurn(reactorCount: number): number {
      const participants = Array.from({ length: reactorCount }, (_, i) =>
        toParticipant(`r-${i}`, 'reactor'),
      )
      const electricity = resolveElectricity({
        config: CONFIG,
        participants,
        droneRoster: roster(40),
      })
      const advanced = advanceConstruction(CONFIG, queue, electricity.labourCapacityHours)
      // Total progress across the whole queue: labour is offered down the queue in
      // order, so this is exactly what the turn bought.
      return advanced.queue.reduce((sum, project) => sum + project.accumulatedLabourHours, 0)
    }

    const withOne = progressAfterOneTurn(1)
    const withTwo = progressAfterOneTurn(2)
    const withThree = progressAfterOneTurn(3)

    // Strictly more power buys strictly more progress — the co-binding, monotone.
    expect(withOne).toBeGreaterThan(0)
    expect(withTwo).toBeGreaterThan(withOne)
    expect(withThree).toBeGreaterThan(withTwo)

    // And every grant is a whole number of build-turns (aic-chg: no storing labour).
    for (const progress of [withOne, withTwo, withThree]) {
      expect(progress % hoursPerBuildTurn).toBe(0)
    }
  })

  it('should tie the drone ceiling to the ratified reactor and drone figures', () => {
    // The proof that makes the whole design work, executed. If either the reactor
    // output or the drone recharge figure drifts, this fails.
    const three = resolveElectricity({
      config: CONFIG,
      participants: roster(3).map((_, i) => toParticipant(`r-${i}`, 'reactor')),
      droneRoster: roster(40),
    })
    expect(three.dronesOnShift).toHaveLength(21)

    // One habitat in standby costs less than one drone's reservation, so the ceiling
    // barely moves — which is exactly why the General's "reduced standby" ruling
    // keeps the game survivable where full rated would not.
    const withStandbyHabitat = resolveElectricity({
      config: CONFIG,
      participants: [
        ...roster(3).map((_, i) => toParticipant(`r-${i}`, 'reactor')),
        toParticipant('hab-1', 'habitat', { standby: true }),
      ],
      droneRoster: roster(40),
    })
    expect(withStandbyHabitat.dronesOnShift).toHaveLength(20)

    // At FULL rated draw the same habitat would have cost six drones, not one.
    const withRatedHabitat = resolveElectricity({
      config: CONFIG,
      participants: [
        ...roster(3).map((_, i) => toParticipant(`r-${i}`, 'reactor')),
        toParticipant('hab-1', 'habitat', { standby: false }),
      ],
      droneRoster: roster(40),
    })
    expect(withRatedHabitat.dronesOnShift).toHaveLength(15)
  })

  it('should never let drone capacity exceed what the reservation model allows', () => {
    // Guards the factor-of-two error directly: if anything ever compares per-turn
    // ENERGY instead of turn CAPACITY, this doubles and fails.
    const generation = DRONE_TURN_CAPACITY_WH * 7
    const result = resolveElectricity({
      config: CONFIG,
      participants: [{ id: 'gen-1', producesWh: generation, consumesWh: 0, priority: 0, operating: true }],
      droneRoster: roster(40),
    })
    expect(result.dronesOnShift).toHaveLength(7)
    // And the energy actually drawn is strictly less than the capacity reserved.
    expect(result.droneEnergyWh).toBe(DRONE_GRID_ENERGY_WH * 7)
    expect(result.droneEnergyWh).toBeLessThan(generation)
  })
})

describe('electricity seam: determinism across the whole seam', () => {
  it('should reproduce an identical grid and ledger from identical state', () => {
    const instances = [
      { id: 'r-1', typeId: 'reactor' },
      { id: 'hopper-1', typeId: 'hopper' },
      { id: 'press-1', typeId: 'press' },
    ]
    const run = (): unknown => {
      const grid = resolveElectricity({
        config: CONFIG,
        participants: instances.map((i) => toParticipant(i.id, i.typeId)),
        droneRoster: roster(5),
      })
      const flows = instances
        .filter((i) => grid.poweredStructureIds.includes(i.id))
        .map((i) => type(i.typeId))
      return { grid, ledger: applyLedger(flows, { regolith: 10_000_000 }, electricityLedgerPolicy(0)) }
    }
    expect(run()).toEqual(run())
  })
})
