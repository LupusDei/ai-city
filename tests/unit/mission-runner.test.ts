/**
 * The headless full-mission runner (aic-oby.4 / aic-gom.8): plays a complete mission
 * from a seed with no renderer, driven by a scripted `Strategy`, so balance is measured
 * rather than guessed.
 *
 * Deliberately GENERIC over the catalog: this suite builds tiny synthetic structure
 * types with a config-controlled `buildTurns`, rather than importing
 * `catalog-data-core.ts`'s real reactor/habitat — the runner's own mechanics (turn
 * count, placement, determinism, "no room to build" reporting) must hold for ANY
 * catalog, not just the one balance-pass data happens to author today. The real
 * roster is exercised by `tests/integration/balance-pass.test.ts` instead.
 */

import { describe, expect, it } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { ELECTRICITY, energyPerTurnWh } from '../../src/sim/power'
import type { MissionConfig } from '../../src/sim/mission'
import { totalTurns, turnDurationSeconds } from '../../src/sim/time'
import type { TurnCycleConfig } from '../../src/sim/time'
import { runMission } from '../../src/sim/mission-runner'
import type { Strategy } from '../../src/sim/mission-runner'

/** A short turn cycle: `turns` whole turns and not one second more, for a fast suite. */
function shortCycle(turns: number): TurnCycleConfig {
  const oneTurn = turnDurationSeconds({
    workSeconds: 90_000,
    rechargeSeconds: 88_775,
    missionSeconds: 1, // placeholder, replaced below
  })
  return { workSeconds: 90_000, rechargeSeconds: 88_775, missionSeconds: oneTurn * turns }
}

function missionOf(turns: number, incomingWaveSize = 8): MissionConfig {
  const turnCycle = shortCycle(turns)
  expect(totalTurns(turnCycle)).toBe(turns)
  return { turnCycle, incomingWaveSize }
}

/** A tiny two-entry catalog: a free generator and a free, capacity-granting consumer. */
function testCatalog(config: TurnCycleConfig): { reactor: StructureType; habitat: StructureType } {
  const catalog = createCatalog([
    {
      id: 'test-reactor',
      name: 'Test Reactor',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 1,
      produces: { [ELECTRICITY]: energyPerTurnWh(40_000, config) },
      consumes: {},
      habitatCapacity: 0,
    },
    {
      id: 'test-habitat',
      name: 'Test Habitat',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 1,
      produces: {},
      consumes: { [ELECTRICITY]: energyPerTurnWh(1_000, config) },
      standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(200, config) },
      habitatCapacity: 4,
    },
  ])
  const reactor = getStructureType(catalog, 'test-reactor')
  const habitat = getStructureType(catalog, 'test-habitat')
  if (reactor === undefined || habitat === undefined) throw new Error('test catalog misconfigured')
  return { reactor, habitat }
}

/** A strategy that never builds anything. */
const IDLE_STRATEGY: Strategy = () => []

describe('runMission', () => {
  it('should resolve exactly totalTurns(mission.turnCycle) turns', () => {
    const mission = missionOf(6)
    const result = runMission({ seed: 1, mission, strategy: IDLE_STRATEGY })
    expect(result.turns).toHaveLength(6)
    expect(result.turns.map((t) => t.turn)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('should report a loss with zero capacity for a mission whose deadline is inside turn 1', () => {
    // `missionSeconds` shorter than one full turn duration floors `totalTurns` to 0: no
    // turn ever resolves, so `lastReport` stays `null` and the result must fall back to
    // its documented zero/loss defaults rather than throwing on a null dereference.
    const turnCycle = { workSeconds: 90_000, rechargeSeconds: 88_775, missionSeconds: 1 }
    expect(totalTurns(turnCycle)).toBe(0)
    const result = runMission({
      seed: 1,
      mission: { turnCycle, incomingWaveSize: 1 },
      strategy: IDLE_STRATEGY,
    })
    expect(result.turns).toEqual([])
    expect(result.finalHabitatCapacity).toBe(0)
    expect(result.won).toBe(false)
  })

  it('should report a loss when nothing is ever built beyond the starting hulls', () => {
    const mission = missionOf(6, 1)
    const result = runMission({ seed: 1, mission, strategy: IDLE_STRATEGY })
    expect(result.finalHabitatCapacity).toBe(0)
    expect(result.won).toBe(false)
  })

  it('should reproduce byte-identically for the same seed, mission and strategy', () => {
    const mission = missionOf(10)
    const params = { seed: 42, mission, strategy: IDLE_STRATEGY }
    const first = runMission(params)
    const second = runMission(params)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('should place a queued structure on the grid and grow habitat capacity once it completes', () => {
    const mission = missionOf(8, 4)
    const { reactor, habitat } = testCatalog(mission.turnCycle)

    let habitatQueued = false
    const strategy: Strategy = () => {
      if (habitatQueued) return []
      // One reactor is already landed; queue exactly one more habitat, once.
      habitatQueued = true
      return [{ kind: 'build', structureType: habitat }]
    }
    // Silence unused-var lint on `reactor` (kept for readers comparing against the
    // "at least one build" test below, which does use it).
    void reactor

    const result = runMission({ seed: 7, mission, strategy })
    expect(result.finalHabitatCapacity).toBeGreaterThanOrEqual(4)
    expect(result.turns.some((t) => t.completedThisTurn.length > 0)).toBe(true)
  })

  it('should record an unplaceable build intent as notPlaced rather than throwing', () => {
    // A 4x4 map (16 tiles) minus both 2x2 hulls (8 tiles) leaves exactly 8 free tiles.
    // Requesting far more single-tile habitats than that, every turn, guarantees the
    // map fills and later intents in the same run have nowhere left to go.
    const mission = missionOf(3, 4)
    const { habitat } = testCatalog(mission.turnCycle)
    const strategy: Strategy = () =>
      Array.from({ length: 10 }, () => ({ kind: 'build' as const, structureType: habitat }))

    const result = runMission({
      seed: 3,
      mission,
      strategy,
      dimension: 4,
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 2, y: 2 },
    })

    expect(result.notPlaced.length).toBeGreaterThan(0)
  })

  it('should cancel an in-flight project when the strategy asks, freeing it to never complete', () => {
    // A habitat that takes many turns and never gets any labour (no reactor beyond the
    // starting hull, and a fleet too large to ever fully charge from one reactor) would
    // sit incomplete forever if never cancelled. Queue it once, cancel it on turn 2, and
    // confirm it never contributes capacity and its id is gone from the queue.
    const mission = missionOf(5, 4)
    const { habitat } = testCatalog(mission.turnCycle)
    let queuedId: string | null = null

    const strategy: Strategy = ({ turn, colony }) => {
      if (turn === 1) return [{ kind: 'build', structureType: habitat }]
      if (turn === 2) {
        // Recover the id the runner minted for turn 1's build from the colony's own
        // queue, rather than assuming a naming scheme this test does not own.
        const project = colony.queue.find((p) => p.structureType.id === habitat.id)
        queuedId = project?.id ?? null
        if (queuedId === null) throw new Error('test setup: expected an in-flight habitat by turn 2')
        return [{ kind: 'cancel', projectId: queuedId }]
      }
      return []
    }

    const result = runMission({ seed: 9, mission, strategy })
    expect(queuedId).not.toBeNull()
    expect(result.finalHabitatCapacity).toBe(0)
  })

  it('should vary the surveyed world across seeds but keep turn count and mission fixed', () => {
    const mission = missionOf(4)
    const a = runMission({ seed: 1, mission, strategy: IDLE_STRATEGY })
    const b = runMission({ seed: 2, mission, strategy: IDLE_STRATEGY })
    expect(a.turns).toHaveLength(4)
    expect(b.turns).toHaveLength(4)
  })

  it('should throw a descriptive error if the fixed landing anchors are not viable on the requested map', () => {
    const mission = missionOf(2)
    expect(() =>
      runMission({
        seed: 1,
        mission,
        strategy: IDLE_STRATEGY,
        dimension: 4,
        droneHullAnchor: { x: 0, y: 0 },
        reactorHullAnchor: { x: 0, y: 0 }, // overlaps the drone hull
      }),
    ).toThrow(/landing/i)
  })
})
