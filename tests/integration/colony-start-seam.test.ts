/**
 * The landing -> colony seam (aic-hfb).
 *
 * WHAT THIS FILE IS FOR. `landing.ts` produced a scored, validated `ReadyLanding` and
 * `turn.ts` consumed a `ColonyState`, and NOTHING converted one into the other. The
 * opening move and the turn loop were two complete systems that never met:
 * `generateWorld`, `evaluateLanding`, `createColony` and `resolveTurn` all had zero
 * production consumers. A unit test on either side of that gap passes, which is exactly
 * how aic-c1p shipped 35% of a landing score running on data nothing produced.
 *
 * ============================================================================
 * THE LOAD-BEARING TEST IS `★ the colony IS the surveyed world`.
 * ----------------------------------------------------------------------------
 * A bridge that called the world generator a SECOND time would look correct, render
 * correctly, and silently discard the player's decision — and it would pass every test
 * that does not explicitly check for it. It is the sim-level equivalent of ★ AC-3.2 in
 * `tests/acceptance/playable-start.spec.ts`.
 *
 * It is asserted by OBJECT IDENTITY, not by value: every grid tile the hulls do not
 * occupy must be the very same `Tile` instance the survey produced. A regenerated world
 * would deep-equal the original whenever the seed matched, so deep equality alone could
 * agree by coincidence — identity cannot. Freshly allocated tiles are never `===` to the
 * surveyed ones, so a re-roll fails this test even when it is seeded identically.
 * ============================================================================
 *
 * Deliberately uses a 37x23 map: an asymmetric, non-default size. A bridge that fell back
 * to its own default grid would produce 64x64 and be caught on dimensions alone, before
 * the identity assertions even run.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SURVIVING_DRONES,
  DRONE_HULL_ID,
  REACTOR_HULL_ID,
  buildColony,
  evaluateLandingOn,
  startMission,
} from '../../src/sim/colony-start'
import { isProjectComplete } from '../../src/sim/construction'
import type { Coord } from '../../src/sim/grid'
import { tileAt } from '../../src/sim/grid'
import type { LandingSelection, ReadyLanding } from '../../src/sim/landing'
import type { MissionConfig } from '../../src/sim/mission'
import { DRONE_TURN_CAPACITY_WH, ELECTRICITY } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE, labourCapacityHours, totalTurns } from '../../src/sim/time'
import { resolveTurn } from '../../src/sim/turn'
import { generateWorld } from '../../src/sim/world'
import type { World } from '../../src/sim/world'

const CONFIG = DEFAULT_TURN_CYCLE
const MISSION: MissionConfig = { turnCycle: CONFIG, incomingWaveSize: 8 }

/** Fixed seed, matching the acceptance suite's, so the two describe the same world. */
const SEED = 20260730
const WIDTH = 37
const HEIGHT = 23

const SELECTION: LandingSelection = {
  droneHullAnchor: { x: 4, y: 4 },
  reactorHullAnchor: { x: 14, y: 12 },
}

function surveyedWorld(): World {
  return generateWorld(WIDTH, HEIGHT, SEED)
}

function ready(world: World, selection: LandingSelection = SELECTION): ReadyLanding {
  const readiness = evaluateLandingOn(world, selection)
  if (readiness.status !== 'ready') {
    throw new Error(`fixture selection was not ready: ${readiness.status}`)
  }
  return readiness
}

function key(coord: Coord): string {
  return `${coord.x},${coord.y}`
}

// ---------------------------------------------------------------------------
// ★ The whole point of the bead
// ---------------------------------------------------------------------------

describe('the landing -> colony seam', () => {
  it('★ should build the colony from the EXACT surveyed world, never a regenerated one', () => {
    const world = surveyedWorld()
    const landing = ready(world)

    const colony = buildColony({ world, landing, mission: MISSION })

    // 1. The grid is the surveyed grid's shape. A bridge falling back to its own default
    //    would be 64x64 here.
    expect(colony.grid.width).toBe(WIDTH)
    expect(colony.grid.height).toBe(HEIGHT)
    expect(colony.grid.tiles).toHaveLength(world.grid.tiles.length)

    // 2. IDENTITY. Every tile outside the two hull footprints must be the SAME OBJECT the
    //    survey produced. This is the assertion a re-roll cannot fake: re-generating from
    //    the same seed yields tiles that are deep-equal but never reference-equal.
    const hullTiles = new Set(
      [...landing.droneHullTiles, ...landing.reactorHullTiles].map(key),
    )
    expect(hullTiles.size).toBe(8)

    let carriedThrough = 0
    for (const [index, tile] of colony.grid.tiles.entries()) {
      const surveyed = world.grid.tiles[index]
      if (hullTiles.has(key(tile))) {
        // A hull tile is legitimately a NEW object — it now records an occupant.
        expect(tile.occupantId).not.toBeNull()
        continue
      }
      expect(tile).toBe(surveyed)
      carriedThrough += 1
    }
    expect(carriedThrough).toBe(world.grid.tiles.length - 8)

    // 3. The deposits the score was computed from are still the caller's, untouched. The
    //    colony does not copy them — `World` remains the static substrate alongside the
    //    mutable colony, which is why the bridge hands it back rather than absorbing it.
    expect(world.deposits).toHaveLength(29)
    expect(world.deposits).toEqual(surveyedWorld().deposits)
  })

  it('★ should keep the surveyed world when starting from a seed, generating it exactly once', () => {
    const result = startMission({
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      selection: SELECTION,
      mission: MISSION,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The returned world is the one an independent survey of the same seed produces...
    expect(result.world).toEqual(surveyedWorld())
    // ...and the colony was built from THAT object, not from a second generation of it.
    // Identity again: if `startMission` generated one world to score and another to
    // build, these tiles would be deep-equal but distinct instances.
    const hullTiles = new Set(
      [...result.landing.droneHullTiles, ...result.landing.reactorHullTiles].map(key),
    )
    for (const [index, tile] of result.colony.grid.tiles.entries()) {
      if (hullTiles.has(key(tile))) continue
      expect(tile).toBe(result.world.grid.tiles[index])
    }
  })

  it('should make the identity assertions discriminating — a different seed IS a different world', () => {
    // Guards the two tests above from being vacuous. If every seed produced the same
    // world, "the colony is the surveyed world" would be trivially true and the ★ tests
    // would prove nothing.
    const a = generateWorld(WIDTH, HEIGHT, SEED)
    const b = generateWorld(WIDTH, HEIGHT, SEED + 1)

    expect(b.deposits).not.toEqual(a.deposits)
    expect(b.terrain.elevation).not.toEqual(a.terrain.elevation)
    // And the surveyed grid tiles are genuinely distinct instances between two surveys,
    // so `toBe` above is a real constraint rather than one satisfied by shared caching.
    expect(generateWorld(WIDTH, HEIGHT, SEED).grid.tiles[0]).not.toBe(a.grid.tiles[0])
  })

  it('should carry the landing score forward, so the choice is not discarded on start', () => {
    const nearSelection: LandingSelection = {
      droneHullAnchor: { x: 4, y: 4 },
      reactorHullAnchor: { x: 6, y: 4 },
    }
    const farSelection: LandingSelection = {
      droneHullAnchor: { x: 0, y: 0 },
      reactorHullAnchor: { x: 35, y: 21 },
    }

    const near = startMission({
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      selection: nearSelection,
      mission: MISSION,
    })
    const far = startMission({
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      selection: farSelection,
      mission: MISSION,
    })

    expect(near.ok).toBe(true)
    expect(far.ok).toBe(true)
    if (!near.ok || !far.ok) return

    // Two hulls side by side must beat two hulls at opposite corners — the separation
    // penalty is real, so the landing choice genuinely differentiates starts.
    expect(near.landing.score).toBeGreaterThan(far.landing.score)
    // And the score a mission starts with is exactly the score the survey screen showed
    // for that selection, not a recomputation that could disagree with it.
    expect(near.landing.score).toBe(ready(surveyedWorld(), nearSelection).score)
  })
})

// ---------------------------------------------------------------------------
// Turn 1, played from a landing selection with no hand-built fixture
// ---------------------------------------------------------------------------

describe('turn 1 from a landing selection', () => {
  it('should resolve the first turn of a colony that was never hand-assembled', () => {
    // The bead's acceptance criterion: no fixture queue, no fixture roster, no fixture
    // grid. A seed and two anchors go in; a resolved turn comes out.
    const started = startMission({
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      selection: SELECTION,
      mission: MISSION,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const { report, state } = resolveTurn(started.colony)

    expect(state.turnsTaken).toBe(1)
    expect(report.turn).toBe(1)

    // Both hulls arrived complete, so they generate/draw from turn 1 and neither consumes
    // any drone labour to get there.
    for (const project of state.queue) {
      expect(isProjectComplete(CONFIG, project)).toBe(true)
    }
    expect(report.completedThisTurn).toEqual([])
    expect(report.labourHoursApplied).toBe(0)

    // The reactor hull is the only generator, and it draws nothing, so it can never be
    // shed — the colony always has its opening power.
    expect(report.electricity.generationWh).toBeGreaterThan(0)
    expect(report.electricity.poweredStructureIds).toContain(REACTOR_HULL_ID)
    expect(report.electricity.poweredStructureIds).toContain(DRONE_HULL_ID)
    expect(report.electricity.shedStructureIds).toEqual([])
    expect(report.electricity.structureDemandWh).toBe(0)

    // One reactor cannot charge a 33-drone fleet: the colony opens in a brownout. Derived
    // from the power module's own constants rather than hand-typed watt-hours.
    const affordableDrones = Math.floor(report.electricity.generationWh / DRONE_TURN_CAPACITY_WH)
    expect(report.electricity.dronesOnShift).toHaveLength(affordableDrones)
    expect(report.electricity.dronesHeldOffline).toHaveLength(
      DEFAULT_SURVIVING_DRONES - affordableDrones,
    )
    expect(report.electricity.brownout).toBe(true)
    expect(report.electricity.labourCapacityHours).toBe(labourCapacityHours(CONFIG, affordableDrones))

    // Labour is produced but there is nothing to build yet, so all of it is lost — the
    // no-storage ruling, reported rather than silently dropped.
    expect(report.labourHoursUnused).toBe(report.electricity.labourCapacityHours)

    // Surplus generation is vented, never banked: electricity is a flow, and the colony
    // starts with no storage structure to grant it any containment. The stockpile carries
    // the key at exactly zero rather than omitting it — nothing crossed the turn boundary.
    expect(report.vented.map((entry) => entry.resource)).toContain(ELECTRICITY)
    expect(state.stockpiles[ELECTRICITY]).toBe(0)
    const ventedElectricity = report.vented.find((entry) => entry.resource === ELECTRICITY)
    expect(ventedElectricity?.amount).toBe(
      report.electricity.generationWh - report.electricity.droneEnergyWh,
    )

    // Nothing that landed houses anybody, and the deadline is 278 turns out.
    expect(report.habitatCapacity).toBe(0)
    expect(report.mission.status).toBe('in-progress')
    expect(report.mission.turnsRemaining).toBe(totalTurns(CONFIG) - 1)
  })

  it('should keep the hulls occupying their tiles across turns', () => {
    const started = startMission({
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      selection: SELECTION,
      mission: MISSION,
    })
    if (!started.ok) throw new Error('fixture did not start')

    let colony = started.colony
    for (let turn = 0; turn < 3; turn += 1) colony = resolveTurn(colony).state

    for (const tile of started.landing.droneHullTiles) {
      expect(tileAt(colony.grid, tile)?.occupantId).toBe(DRONE_HULL_ID)
    }
    for (const tile of started.landing.reactorHullTiles) {
      expect(tileAt(colony.grid, tile)?.occupantId).toBe(REACTOR_HULL_ID)
    }
    expect(colony.turnsTaken).toBe(3)
  })

  it('should replay identically from the same seed, selection and turn count', () => {
    const run = (): unknown => {
      const started = startMission({
        width: WIDTH,
        height: HEIGHT,
        seed: SEED,
        selection: SELECTION,
        mission: MISSION,
      })
      if (!started.ok) throw new Error('fixture did not start')
      let colony = started.colony
      const trace: unknown[] = []
      for (let turn = 0; turn < 5; turn += 1) {
        const resolved = resolveTurn(colony)
        colony = resolved.state
        trace.push({
          turn: resolved.report.turn,
          generationWh: resolved.report.electricity.generationWh,
          dronesOnShift: resolved.report.electricity.dronesOnShift.length,
          cutLine: resolved.report.electricity.cutLine,
          labour: resolved.report.electricity.labourCapacityHours,
          vented: resolved.report.vented,
          stockpiles: colony.stockpiles,
        })
      }
      return trace
    }

    expect(run()).toEqual(run())
  })
})
