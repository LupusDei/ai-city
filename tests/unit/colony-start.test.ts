/**
 * Unit tests for the landing -> colony bridge (aic-hfb).
 *
 * The load-bearing property — "the colony is built from the EXACT surveyed world, never
 * a regenerated one" — is asserted at the seam level in
 * `tests/integration/colony-start-seam.test.ts`. This file covers the bridge's own rules:
 * hull representation, grid occupancy, the starting roster, and every way the inputs can
 * be wrong.
 *
 * Worlds here are mostly SYNTHETIC and deliberately flat, because several rules under
 * test (a hull fitting exactly at the grid edge, a world too small for two hulls) need
 * buildability to be a controlled constant rather than whatever the noise generator
 * produced. They are still real `World` values assembled from the real
 * `computeBuildability`, not hand-typed score arrays.
 */

import { describe, expect, it } from 'vitest'

import { computeBuildability } from '../../src/sim/buildability'
import type { MineralDeposit } from '../../src/sim/buildability'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { queueConstruction } from '../../src/sim/construction'
import {
  DEFAULT_SURVIVING_DRONES,
  DRONE_HULL_ID,
  REACTOR_HULL_ID,
  buildColony,
  evaluateLandingOn,
  startMission,
} from '../../src/sim/colony-start'
import { createGrid, tileAt } from '../../src/sim/grid'
import type { Coord } from '../../src/sim/grid'
import { HULL_FOOTPRINT, resolveHullFootprint } from '../../src/sim/landing'
import type { LandingSelection, ReadyLanding } from '../../src/sim/landing'
import type { MissionConfig } from '../../src/sim/mission'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_MAP_LATITUDE_DEG } from '../../src/sim/terrain'
import type { Terrain } from '../../src/sim/terrain'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import type { World } from '../../src/sim/world'

const CONFIG = DEFAULT_TURN_CYCLE
const MISSION: MissionConfig = { turnCycle: CONFIG, incomingWaveSize: 8 }

/**
 * A world with perfectly flat terrain, so `computeBuildability` scores every tile at 1
 * and no assertion below depends on where the noise generator happened to put a slope.
 */
function flatWorld(
  width: number,
  height: number,
  deposits: readonly MineralDeposit[] = [],
): World {
  const terrain: Terrain = {
    width,
    height,
    seed: 7,
    latitude: DEFAULT_MAP_LATITUDE_DEG,
    elevation: new Array<number>(width * height).fill(0.5),
  }
  return {
    terrain,
    buildability: computeBuildability(terrain),
    deposits,
    grid: createGrid(width, height),
  }
}

function selection(droneHullAnchor: Coord | null, reactorHullAnchor: Coord | null): LandingSelection {
  return { droneHullAnchor, reactorHullAnchor }
}

/** Evaluate a selection and assert it is ready, returning the `ReadyLanding`. */
function readyLanding(world: World, sel: LandingSelection): ReadyLanding {
  const readiness = evaluateLandingOn(world, sel)
  if (readiness.status !== 'ready') {
    throw new Error(`expected a ready landing, got "${readiness.status}"`)
  }
  return readiness
}

/** A one-tile structure type, for proving a hull's tiles are genuinely occupied. */
function probeType(): StructureType {
  const catalog = createCatalog([
    {
      id: 'probe',
      name: 'Probe',
      footprint: [{ dx: 0, dy: 0 }],
      buildTurns: 1,
      produces: {},
      consumes: {},
      habitatCapacity: 0,
    },
  ])
  const found = getStructureType(catalog, 'probe')
  if (found === undefined) throw new Error('probe type missing')
  return found
}

// ---------------------------------------------------------------------------
// buildColony — happy path
// ---------------------------------------------------------------------------

describe('buildColony', () => {
  it('should place both hulls as complete, pre-placed structures when given a ready landing', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))

    const colony = buildColony({ world, landing, mission: MISSION })

    expect(colony.queue.map((project) => project.id)).toEqual([DRONE_HULL_ID, REACTOR_HULL_ID])
    for (const project of colony.queue) {
      // buildTurns 0 is what "arrived complete" means — construction.ts documents that
      // case explicitly, so no parallel notion of a pre-placed structure is invented.
      expect(project.structureType.buildTurns).toBe(0)
      expect(project.accumulatedLabourHours).toBe(0)
      // The crew ship was lost: nothing that landed houses anybody.
      expect(project.structureType.habitatCapacity).toBe(0)
    }
    expect(colony.turnsTaken).toBe(0)
    expect(colony.mission).toBe(MISSION)
    expect(colony.offlineStructureIds).toEqual([])
  })

  it('should occupy exactly the landing tiles the site validation already approved', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 3, y: 4 }, { x: 10, y: 11 }))

    const colony = buildColony({ world, landing, mission: MISSION })
    const [droneHull, reactorHull] = colony.queue

    // The project's tiles must be the SAME tiles the score was computed over. If the
    // catalog footprint and the landing footprint could differ, the colony would occupy
    // ground the player was never shown.
    expect(droneHull?.tiles).toEqual(landing.droneHullTiles)
    expect(reactorHull?.tiles).toEqual(landing.reactorHullTiles)

    for (const tile of landing.droneHullTiles) {
      expect(tileAt(colony.grid, tile)?.occupantId).toBe(DRONE_HULL_ID)
    }
    for (const tile of landing.reactorHullTiles) {
      expect(tileAt(colony.grid, tile)?.occupantId).toBe(REACTOR_HULL_ID)
    }
    // Every hull tile, and nothing else.
    const occupied = colony.grid.tiles.filter((tile) => tile.occupantId !== null)
    expect(occupied).toHaveLength(HULL_FOOTPRINT.length * 2)
  })

  it('should report hull tiles as occupied so a later structure cannot be built on one', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))
    const colony = buildColony({ world, landing, mission: MISSION })

    // Every tile of both hulls must refuse a new placement — not just the anchor.
    for (const tile of [...landing.droneHullTiles, ...landing.reactorHullTiles]) {
      const result = queueConstruction(colony.grid, `probe-${tile.x}-${tile.y}`, probeType(), tile)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('occupied')
    }
    // A free tile still accepts one, so the check above is not vacuously refusing everything.
    const free = queueConstruction(colony.grid, 'probe-free', probeType(), { x: 14, y: 14 })
    expect(free.ok).toBe(true)
  })

  it('should give the reactor hull one reactor unit of generation and the drone hull none', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))
    const colony = buildColony({ world, landing, mission: MISSION })

    const droneHull = colony.queue.find((project) => project.id === DRONE_HULL_ID)
    const reactorHull = colony.queue.find((project) => project.id === REACTOR_HULL_ID)

    // Derived from the reality-grounded wattage, never a hand-typed watt-hour figure.
    expect(reactorHull?.structureType.produces[ELECTRICITY]).toBe(
      energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG),
    )
    expect(droneHull?.structureType.produces).toEqual({})
    // Neither hull draws: a landed hold has no rated process load.
    expect(reactorHull?.structureType.consumes).toEqual({})
    expect(droneHull?.structureType.consumes).toEqual({})
  })

  it('should populate a drone roster whose ascending id order matches ascending drone number', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))
    const colony = buildColony({ world, landing, mission: MISSION })

    expect(colony.droneRoster).toHaveLength(DEFAULT_SURVIVING_DRONES)
    expect(new Set(colony.droneRoster).size).toBe(DEFAULT_SURVIVING_DRONES)
    // Drone charge priority is ASCENDING ID, so the ids must be zero-padded: without
    // padding "drone-10" sorts before "drone-9" and the roster's documented priority
    // silently stops matching its numbering.
    expect([...colony.droneRoster].sort()).toEqual([...colony.droneRoster])
    // No drone id may collide with a hull id — both become grid consumers in one call.
    expect(colony.droneRoster).not.toContain(DRONE_HULL_ID)
  })

  it('should start with an empty stockpile by default and accept an explicit one', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))

    expect(buildColony({ world, landing, mission: MISSION }).stockpiles).toEqual({})

    const seeded = buildColony({
      world,
      landing,
      mission: MISSION,
      stockpiles: { regolith: 40_000_000 },
      droneRoster: ['drone-a', 'drone-b'],
    })
    expect(seeded.stockpiles).toEqual({ regolith: 40_000_000 })
    expect(seeded.droneRoster).toEqual(['drone-a', 'drone-b'])
  })

  // -------------------------------------------------------------------------
  // buildColony — error paths
  // -------------------------------------------------------------------------

  it('should throw when handed a fabricated landing whose two hulls overlap', () => {
    // A genuine ReadyLanding cannot overlap — the test below proves site validation
    // refuses it. This asserts that BYPASSING that validation fails loudly rather than
    // silently double-occupying a tile and losing one hull.
    const world = flatWorld(16, 16)
    const tiles = resolveHullFootprint({ x: 4, y: 4 })
    const fabricated: ReadyLanding = {
      status: 'ready',
      score: 50,
      breakdown: {
        buildability: 1,
        depositProximity: 0,
        hullSeparationPenalty: 0,
        total: 50,
      },
      droneHullTiles: tiles,
      reactorHullTiles: tiles,
    }

    expect(() => buildColony({ world, landing: fabricated, mission: MISSION })).toThrow(
      /reactor-hull/,
    )
    expect(() => buildColony({ world, landing: fabricated, mission: MISSION })).toThrow(/occupied/)
  })

  it('should throw when a landing tile list is not a hull footprint', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))
    const truncated: ReadyLanding = {
      ...landing,
      droneHullTiles: [{ x: 2, y: 2 }],
    }

    expect(() => buildColony({ world, landing: truncated, mission: MISSION })).toThrow(RangeError)
    expect(() => buildColony({ world, landing: truncated, mission: MISSION })).toThrow(
      /drone-hull/,
    )
  })

  it('should throw when the surveyed grid already has something on a hull tile', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))

    // A World whose grid is not pristine — e.g. a reloaded save. The bridge must refuse
    // rather than quietly drop the hull.
    const claimed = queueConstruction(world.grid, 'squatter', probeType(), { x: 2, y: 2 })
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    const dirty: World = { ...world, grid: claimed.grid }

    expect(() => buildColony({ world: dirty, landing, mission: MISSION })).toThrow(/drone-hull/)
  })

  it('should refuse a landing that was validated against a DIFFERENT, larger world', () => {
    // The hazard placement.ts exists to guard: tiles validated against one grid, applied to
    // another. A caller who surveys 24x24, then hands the bridge a 12x12 world, must get a
    // loud failure — not a hull that silently never appears (which is the exact bug
    // `applyPlacement` was hardened against in aic-a00.13).
    const surveyed = flatWorld(24, 24)
    const landing = readyLanding(surveyed, selection({ x: 2, y: 2 }, { x: 18, y: 18 }))
    const smaller = flatWorld(12, 12)

    expect(() => buildColony({ world: smaller, landing, mission: MISSION })).toThrow(
      /reactor-hull/,
    )
    expect(() => buildColony({ world: smaller, landing, mission: MISSION })).toThrow(
      /out-of-bounds/,
    )
  })

  it('should reject a duplicated drone id rather than defer it to the first turn', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))

    expect(() =>
      buildColony({ world, landing, mission: MISSION, droneRoster: ['d-1', 'd-1'] }),
    ).toThrow(RangeError)
  })

  // -------------------------------------------------------------------------
  // buildColony — edge cases
  // -------------------------------------------------------------------------

  it('should place a hull that fits exactly at the far grid corner', () => {
    const world = flatWorld(8, 8)
    // (6,6) is the last anchor a 2x2 hull fits at on an 8x8 grid.
    const landing = readyLanding(world, selection({ x: 0, y: 0 }, { x: 6, y: 6 }))
    const colony = buildColony({ world, landing, mission: MISSION })

    expect(tileAt(colony.grid, { x: 7, y: 7 })?.occupantId).toBe(REACTOR_HULL_ID)
    expect(tileAt(colony.grid, { x: 0, y: 0 })?.occupantId).toBe(DRONE_HULL_ID)
    expect(colony.grid.width).toBe(8)
    expect(colony.grid.height).toBe(8)
  })

  it('should be deterministic — the same world and landing produce an identical colony', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))

    const first = buildColony({ world, landing, mission: MISSION })
    const second = buildColony({ world, landing, mission: MISSION })

    expect(second).toEqual(first)
  })

  it('should never mutate the surveyed world it is given', () => {
    const world = flatWorld(16, 16)
    const landing = readyLanding(world, selection({ x: 2, y: 2 }, { x: 8, y: 8 }))
    const before = structuredClone(world)

    buildColony({ world, landing, mission: MISSION })

    expect(world).toEqual(before)
    // The surveyed grid in particular must still be pristine, or a second landing
    // attempt on the same world would report tiles as occupied.
    expect(world.grid.tiles.every((tile) => tile.occupantId === null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// evaluateLandingOn
// ---------------------------------------------------------------------------

describe('evaluateLandingOn', () => {
  it('should score a legal selection as ready', () => {
    const world = flatWorld(16, 16)
    const readiness = evaluateLandingOn(world, selection({ x: 2, y: 2 }, { x: 9, y: 9 }))

    expect(readiness.status).toBe('ready')
    if (readiness.status !== 'ready') return
    expect(readiness.score).toBe(readiness.breakdown.total)
    expect(readiness.breakdown.buildability).toBe(1)
    expect(readiness.droneHullTiles).toEqual(resolveHullFootprint({ x: 2, y: 2 }))
  })

  it('should feed the world deposits into the proximity component', () => {
    // The aic-c1p property at this layer: a world WITH deposits must score differently
    // from an identical world without them. If the adapter dropped the deposit list, both
    // would score the same and 35% of the site score would be dead weight again.
    const bare = flatWorld(16, 16)
    const rich = flatWorld(16, 16, [{ x: 3, y: 3, kind: 'silica', richness: 0.9 }])
    const sel = selection({ x: 2, y: 2 }, { x: 9, y: 9 })

    const bareScore = evaluateLandingOn(bare, sel)
    const richScore = evaluateLandingOn(rich, sel)
    expect(bareScore.status).toBe('ready')
    expect(richScore.status).toBe('ready')
    if (bareScore.status !== 'ready' || richScore.status !== 'ready') return

    expect(bareScore.breakdown.depositProximity).toBe(0)
    expect(richScore.breakdown.depositProximity).toBeGreaterThan(0)
    expect(richScore.score).toBeGreaterThan(bareScore.score)
  })

  it('should reject two hulls dropped on the same tile — an overlapping landing is never ready', () => {
    // This is the "overlap is impossible by construction" proof: the only way to obtain a
    // ReadyLanding is through this function, and this function refuses an overlap.
    const world = flatWorld(16, 16)
    const readiness = evaluateLandingOn(world, selection({ x: 4, y: 4 }, { x: 4, y: 4 }))

    expect(readiness.status).toBe('rejected')
    if (readiness.status !== 'rejected') return
    expect(readiness.rejection.reason).toBe('overlapping-hulls')
  })

  it('should reject a hull whose footprint hangs off the grid edge', () => {
    const world = flatWorld(8, 8)
    // x = 7 leaves no room for the footprint's dx = 1 column.
    const readiness = evaluateLandingOn(world, selection({ x: 0, y: 0 }, { x: 7, y: 6 }))

    expect(readiness.status).toBe('rejected')
    if (readiness.status !== 'rejected') return
    expect(readiness.rejection.reason).toBe('out-of-bounds')
  })

  it('should report which hulls are still missing when the selection is incomplete', () => {
    const world = flatWorld(16, 16)

    const none = evaluateLandingOn(world, selection(null, null))
    expect(none.status).toBe('incomplete')
    if (none.status === 'incomplete') {
      expect(none.missingHulls).toEqual([DRONE_HULL_ID, REACTOR_HULL_ID])
    }

    const half = evaluateLandingOn(world, selection({ x: 2, y: 2 }, null))
    expect(half.status).toBe('incomplete')
    if (half.status === 'incomplete') expect(half.missingHulls).toEqual([REACTOR_HULL_ID])
  })
})

// ---------------------------------------------------------------------------
// startMission
// ---------------------------------------------------------------------------

describe('startMission', () => {
  it('should survey, land and build a colony in one call', () => {
    const result = startMission({
      width: 24,
      height: 24,
      seed: 20260730,
      selection: selection({ x: 2, y: 2 }, { x: 12, y: 12 }),
      mission: MISSION,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.colony.queue.map((project) => project.id)).toEqual([
      DRONE_HULL_ID,
      REACTOR_HULL_ID,
    ])
    expect(result.landing.status).toBe('ready')
    expect(result.world.grid.width).toBe(24)
    expect(result.colony.grid.width).toBe(24)
    expect(result.colony.grid.height).toBe(24)
  })

  it('should return the surveyed world even when the landing is refused', () => {
    // The world must come back on BOTH branches. A caller forced to re-survey after a
    // rejected click would re-roll the map under the player mid-decision.
    const result = startMission({
      width: 24,
      height: 24,
      seed: 20260730,
      selection: selection({ x: 5, y: 5 }, { x: 5, y: 5 }),
      mission: MISSION,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.readiness.status).toBe('rejected')
    expect(result.world.grid.width).toBe(24)
    expect(result.world.deposits.length).toBeGreaterThanOrEqual(0)
  })

  it('should refuse to start on a world too small for two hulls', () => {
    // A 3x3 grid fits one 2x2 hull but leaves nowhere for a second that does not overlap
    // it, so no selection on it can ever be ready. Bounds and overlap are checked before
    // buildability, so this holds whatever the terrain looks like.
    for (const anchors of [
      selection({ x: 0, y: 0 }, { x: 1, y: 1 }),
      selection({ x: 0, y: 0 }, { x: 1, y: 0 }),
      selection({ x: 1, y: 1 }, { x: 0, y: 0 }),
      selection({ x: 0, y: 0 }, { x: 2, y: 2 }),
    ]) {
      const result = startMission({
        width: 3,
        height: 3,
        seed: 4,
        selection: anchors,
        mission: MISSION,
      })
      expect(result.ok).toBe(false)
    }
  })

  it('should report an incomplete selection without generating a colony', () => {
    const result = startMission({
      width: 16,
      height: 16,
      seed: 11,
      selection: selection({ x: 2, y: 2 }, null),
      mission: MISSION,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.readiness.status).toBe('incomplete')
  })

  it('should be deterministic for the same seed and selection', () => {
    const params = {
      width: 24,
      height: 24,
      seed: 20260730,
      selection: selection({ x: 2, y: 2 }, { x: 12, y: 12 }),
      mission: MISSION,
    }

    expect(startMission(params)).toEqual(startMission(params))
  })

  it('should pass deposit options through to the survey', () => {
    // Otherwise the parameter is decorative: a caller could tune deposit density and the
    // world would ignore it, which is the same "wired to nothing" defect at a smaller scale.
    const base = {
      width: 24,
      height: 24,
      seed: 20260730,
      selection: selection({ x: 2, y: 2 }, { x: 12, y: 12 }),
      mission: MISSION,
    }

    const barren = startMission({ ...base, depositOptions: { density: 0 } })
    const rich = startMission({ ...base, depositOptions: { density: 1 } })

    expect(barren.world.deposits).toHaveLength(0)
    expect(rich.world.deposits.length).toBeGreaterThan(0)
    // And the option genuinely reaches the SCORE, not just the world: with no deposits
    // anywhere, proximity contributes nothing.
    expect(barren.ok).toBe(true)
    expect(rich.ok).toBe(true)
    if (!barren.ok || !rich.ok) return
    expect(barren.landing.breakdown.depositProximity).toBe(0)
    expect(rich.landing.breakdown.depositProximity).toBeGreaterThan(0)
  })

  it('should propagate a malformed dimension as a thrown error, not a rejection', () => {
    // A bad dimension is a config/programmer error, not player input — world.ts throws
    // for it and this bridge must not soften that into an ordinary landing rejection.
    expect(() =>
      startMission({
        width: 0,
        height: 16,
        seed: 1,
        selection: selection({ x: 0, y: 0 }, { x: 4, y: 4 }),
        mission: MISSION,
      }),
    ).toThrow(RangeError)
  })
})
