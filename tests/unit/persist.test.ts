/**
 * Tests for save/load (aic-oby.2).
 *
 * The two tests that matter most in this file are NOT the field-by-field ones:
 *
 *   - "resuming a saved colony resolves identically to never having stopped" is the
 *     one the bead calls "the real test" — round-tripping a blob proves the encoder
 *     works, this proves the GAME survives being put down and picked up.
 *   - "would fail if a save dropped powerSourceState" is a deliberate mutation test:
 *     it manufactures the exact defect a naive save format would produce (silently
 *     losing per-instance solar soiling history) and shows the resume-and-continue
 *     comparison catches it. If this test ever stopped failing on that mutation, the
 *     real test above would have gone toothless without anyone noticing.
 */

import { describe, expect, it, vi } from 'vitest'

import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { queueConstruction } from '../../src/sim/construction'
import type { ConstructionQueue } from '../../src/sim/construction'
import { SOLAR_DECAY_KIND } from '../../src/sim/generation'
import { createGrid } from '../../src/sim/grid'
import type { Grid } from '../../src/sim/grid'
import type { MissionConfig } from '../../src/sim/mission'
import { SAVE_FORMAT_VERSION, deserializeColony, serializeColony } from '../../src/sim/persist'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'

const CONFIG = DEFAULT_TURN_CYCLE
const MISSION: MissionConfig = { turnCycle: CONFIG, incomingWaveSize: 6 }

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/**
 * A catalog with a genuine solar generator (`SOLAR_DECAY_KIND`) alongside a plain
 * constant reactor and a habitat with a multi-turn build. `powerSourceState` only
 * matters for a structure whose output CURVE reads it — a constant reactor would
 * round-trip fine even if this field were silently dropped, which is precisely why
 * the golden trace elsewhere in this repo does not exercise this bead's failure mode.
 */
const CATALOG = createCatalog([
  {
    id: 'solar-array',
    name: 'Photovoltaic Array',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: energyPerTurnWh(80_000, CONFIG) },
    consumes: {},
    powerOutputModel: SOLAR_DECAY_KIND,
    habitatCapacity: 0,
  },
  {
    id: 'reactor',
    name: 'Fission Surface Power Unit',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'habitat',
    name: 'Habitat Module',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 4,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(4_000, CONFIG) },
    habitatCapacity: 4,
  },
  {
    id: 'sifter',
    name: 'Regolith Sifter',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 0,
    produces: {},
    consumes: {},
    siting: { requiresDeposit: 'silica' },
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

/**
 * A colony with an operating solar array (so `powerSourceState` accrues real soiling
 * history), a plain reactor, a drone roster, and an in-progress habitat build (so
 * `accumulatedLabourHours` and `queue` order have something to diverge on too).
 */
function freshColony(): ColonyState {
  let grid: Grid = createGrid(4, 4)
  let queue: ConstructionQueue = []

  const site = (id: string, typeId: string, x: number, y: number): void => {
    const result = queueConstruction(grid, id, type(typeId), { x, y })
    if (!result.ok) throw new Error(`test setup: could not site ${id}: ${result.reason}`)
    grid = result.grid
    queue = [...queue, result.project]
  }

  site('solar-1', 'solar-array', 0, 0)
  site('reactor-1', 'reactor', 1, 0)
  site('habitat-1', 'habitat', 2, 0)

  return createColony(MISSION, {
    grid,
    queue,
    droneRoster: ['drone-00', 'drone-01', 'drone-02'],
    stockpiles: { regolith: 1_000 },
  })
}

/** Resolve `n` turns in sequence, returning only the final state. */
function advance(colony: ColonyState, turns: number): ColonyState {
  let state = colony
  for (let i = 0; i < turns; i++) state = resolveTurn(state).state
  return state
}

function expectOk(result: ReturnType<typeof deserializeColony>): ColonyState {
  if (!result.ok) throw new Error(`expected ok, got ${result.kind}: ${result.message}`)
  return result.colony
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe('serializeColony / deserializeColony — round trip', () => {
  it('should reproduce a byte-identical colony for a fresh, empty colony', () => {
    const colony = createColony(MISSION)
    const raw = serializeColony(colony)
    const loaded = expectOk(deserializeColony(raw))
    expect(loaded).toEqual(colony)
    // Re-encoding the loaded value must produce the SAME bytes, not merely a
    // deep-equal object — this is what "byte-identical" actually pins.
    expect(serializeColony(loaded)).toBe(raw)
  })

  it('should reproduce a byte-identical colony after several turns of real play', () => {
    const colony = advance(freshColony(), 5)
    const raw = serializeColony(colony)
    const loaded = expectOk(deserializeColony(raw))
    expect(loaded).toEqual(colony)
    expect(serializeColony(loaded)).toBe(raw)
  })

  it('should carry the save format version', () => {
    const raw = serializeColony(createColony(MISSION))
    const parsed: unknown = JSON.parse(raw)
    expect(parsed).toMatchObject({ formatVersion: SAVE_FORMAT_VERSION })
  })

  it('should preserve every integer field as an exact integer, never coerced to a float', () => {
    const colony = advance(freshColony(), 7)
    const loaded = expectOk(deserializeColony(serializeColony(colony)))

    expect(Number.isInteger(loaded.turnsTaken)).toBe(true)
    for (const project of loaded.queue) {
      expect(Number.isInteger(project.accumulatedLabourHours)).toBe(true)
    }
    for (const amount of Object.values(loaded.stockpiles)) {
      expect(Number.isInteger(amount)).toBe(true)
    }
    for (const state of Object.values(loaded.powerSourceState)) {
      expect(Number.isInteger(state.turnsOperated)).toBe(true)
    }
    // The specific field this bead calls out by name: dropping or float-coercing
    // this is exactly the defect that would silently reset solar soiling on load.
    expect(loaded.powerSourceState['solar-1']).toEqual(colony.powerSourceState['solar-1'])
  })

  it('should preserve a non-empty offlineStructureIds list', () => {
    const base = freshColony()
    const colony: ColonyState = { ...base, offlineStructureIds: ['reactor-1'] }
    const loaded = expectOk(deserializeColony(serializeColony(colony)))
    expect(loaded.offlineStructureIds).toEqual(['reactor-1'])
  })

  it('should preserve a structure type siting requirement (siting.requiresDeposit)', () => {
    let grid: Grid = createGrid(2, 2)
    const sited = queueConstruction(grid, 'sifter-1', type('sifter'), { x: 0, y: 0 })
    if (!sited.ok) throw new Error(`test setup failed: ${sited.reason}`)
    grid = sited.grid
    const colony = createColony(MISSION, { grid, queue: [sited.project] })

    const loaded = expectOk(deserializeColony(serializeColony(colony)))
    expect(loaded.queue[0]?.structureType.siting).toEqual({ requiresDeposit: 'silica' })
  })
})

// ---------------------------------------------------------------------------
// THE REAL TEST: resume-and-continue equivalence
// ---------------------------------------------------------------------------

describe('resuming a saved colony resolves identically to never having stopped', () => {
  it('should match an uninterrupted run turn-for-turn after saving, loading and continuing', () => {
    const SAVE_AT_TURN = 6
    const FURTHER_TURNS = 10

    const opening = freshColony()

    // The control: never interrupted.
    const uninterrupted = advance(opening, SAVE_AT_TURN + FURTHER_TURNS)

    // The experiment: stop at SAVE_AT_TURN, round-trip through a save string, then
    // resolve the SAME remaining number of turns from the reloaded colony.
    const savedAtMidpoint = advance(opening, SAVE_AT_TURN)
    const raw = serializeColony(savedAtMidpoint)
    const resumed = expectOk(deserializeColony(raw))
    const afterResume = advance(resumed, FURTHER_TURNS)

    expect(afterResume).toEqual(uninterrupted)
  })

  it('should keep matching across a save/load performed on EVERY turn, not just once', () => {
    // A stronger version of the test above: save and reload at every step, so a
    // defect that only shows up on a specific turn (e.g. the turn soiling first
    // crosses an integer basis-point boundary) cannot hide between two save points.
    let uninterrupted = freshColony()
    let roundTripped = freshColony()

    for (let turn = 0; turn < 12; turn++) {
      uninterrupted = resolveTurn(uninterrupted).state
      const stepped = resolveTurn(roundTripped).state
      roundTripped = expectOk(deserializeColony(serializeColony(stepped)))
      expect(roundTripped).toEqual(uninterrupted)
    }
  })

  it('would catch a save that silently dropped powerSourceState', () => {
    // This is the mutation test the bead explicitly asks for: manufacture the exact
    // defect described ("a save that loses powerSourceState would pass the first
    // test and fail this one") and show that THIS suite's comparison strategy
    // actually detects it, rather than merely asserting it exists.
    const SAVE_AT_TURN = 6
    const FURTHER_TURNS = 10

    const opening = freshColony()
    const uninterrupted = advance(opening, SAVE_AT_TURN + FURTHER_TURNS)

    const savedAtMidpoint = advance(opening, SAVE_AT_TURN)
    // Sanity precondition for the mutation to mean anything: the solar array must
    // actually have accrued nonzero operating history by this point, and dropping
    // it must actually change next turn's generation (soiling must be non-trivial).
    expect(savedAtMidpoint.powerSourceState['solar-1']?.turnsOperated).toBeGreaterThan(0)

    // The defect under test: a hypothetical broken loader that reconstructs every
    // field correctly EXCEPT powerSourceState, which resets to "never operated".
    // This does not go through `deserializeColony` at all — it simulates what a
    // buggy save FORMAT would produce, to prove the comparison below is sensitive
    // to exactly this field.
    const brokenlyResumed: ColonyState = { ...savedAtMidpoint, powerSourceState: {} }
    const afterBrokenResume = advance(brokenlyResumed, FURTHER_TURNS)

    expect(afterBrokenResume).not.toEqual(uninterrupted)
    // Sharper still: pin WHERE it diverges, so this test fails for the reason it
    // claims to, not merely "some field differs somewhere".
    expect(afterBrokenResume.powerSourceState['solar-1']).not.toEqual(
      uninterrupted.powerSourceState['solar-1'],
    )
  })
})

// ---------------------------------------------------------------------------
// Failure modes: malformed, truncated, wrong-version — never a crash
// ---------------------------------------------------------------------------

describe('deserializeColony — rejects bad input without crashing', () => {
  it('should reject unparsable text as malformed', () => {
    const result = deserializeColony('this is not json at all {{{')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.message).not.toContain('undefined')
    expect(result.message).not.toContain('[object')
  })

  it('should reject valid JSON that is not an object as malformed', () => {
    for (const raw of ['42', '"hello"', 'true', 'null', '[]']) {
      const result = deserializeColony(raw)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.kind).toBe('malformed')
    }
  })

  it('should reject an object missing formatVersion as malformed', () => {
    const result = deserializeColony(JSON.stringify({ colony: {} }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
  })

  it('should reject a colony missing a required field as malformed, naming the field', () => {
    const raw = serializeColony(createColony(MISSION))
    const parsed = JSON.parse(raw) as { formatVersion: number; colony: Record<string, unknown> }
    delete parsed.colony.stockpiles
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
    expect(result.message).toContain('stockpiles')
  })

  it('should reject a colony with a duplicate drone id as malformed', () => {
    const raw = serializeColony(
      createColony(MISSION, { droneRoster: ['drone-00'] }),
    )
    const parsed = JSON.parse(raw) as { formatVersion: number; colony: Record<string, unknown> }
    parsed.colony.droneRoster = ['drone-00', 'drone-00']
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
  })

  it('should reject a colony with a non-integer stockpile amount as malformed', () => {
    const raw = serializeColony(
      createColony(MISSION, { stockpiles: { regolith: 5 } }),
    )
    const parsed = JSON.parse(raw) as { formatVersion: number; colony: Record<string, unknown> }
    parsed.colony.stockpiles = { regolith: 5.5 }
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
  })

  it('should reject a truncated save as truncated, not malformed', () => {
    const raw = serializeColony(advance(freshColony(), 3))
    // Cut the text off partway through — a write interrupted mid-flush is the
    // realistic shape of this failure, and slicing a valid JSON string almost
    // always breaks it before a matching close is found.
    const truncated = raw.slice(0, Math.floor(raw.length / 2))
    const result = deserializeColony(truncated)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('truncated')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('should reject a save missing its final character as truncated', () => {
    const raw = serializeColony(createColony(MISSION))
    const result = deserializeColony(raw.slice(0, -1))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('truncated')
  })

  it('should reject a save from a newer/older format as version-mismatch', () => {
    const raw = serializeColony(createColony(MISSION))
    const parsed = JSON.parse(raw) as { formatVersion: number; colony: unknown }
    parsed.formatVersion = SAVE_FORMAT_VERSION + 1
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('version-mismatch')
    expect(result.message).toContain(String(SAVE_FORMAT_VERSION + 1))
    expect(result.message).toContain(String(SAVE_FORMAT_VERSION))
  })

  it('should reject formatVersion 0 as version-mismatch, not treat it as falsy/absent', () => {
    const raw = serializeColony(createColony(MISSION))
    const parsed = JSON.parse(raw) as { formatVersion: number; colony: unknown }
    parsed.formatVersion = 0
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('version-mismatch')
  })

  it('should never throw for any of the above — every case returns, none propagates', () => {
    const badInputs = [
      '',
      '{',
      '{"formatVersion": 1}',
      '{"formatVersion": "1", "colony": {}}',
      JSON.stringify({ formatVersion: 1, colony: null }),
      JSON.stringify({ formatVersion: 1, colony: 42 }),
    ]
    for (const raw of badInputs) {
      expect(() => deserializeColony(raw)).not.toThrow()
    }
  })
})

describe('deserializeColony — deeper shape checks', () => {
  it('should reject a colony whose grid tiles are out of row-major order', () => {
    const raw = serializeColony(createColony(MISSION))
    const parsed = JSON.parse(raw) as { colony: { grid: { tiles: unknown[] } } }
    const tiles = parsed.colony.grid.tiles as { x: number; y: number; occupantId: null }[]
    const first = tiles[0]
    const second = tiles[1]
    if (first === undefined || second === undefined) throw new Error('test grid too small')
    // Swap two tiles so position 0 no longer holds (0, 0).
    tiles[0] = second
    tiles[1] = first
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
  })

  it('should reject a queue entry whose tile count disagrees with its own footprint', () => {
    const raw = serializeColony(advance(freshColony(), 1))
    const parsed = JSON.parse(raw) as {
      colony: { queue: { tiles: unknown[] }[] }
    }
    const project = parsed.colony.queue[0]
    if (project === undefined) throw new Error('test queue is empty')
    project.tiles = [...project.tiles, { x: 99, y: 99 }]
    const result = deserializeColony(JSON.stringify(parsed))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
  })
})

/**
 * One targeted test per remaining validation branch this suite had not yet exercised
 * — boundary conditions and error paths per the project's testing mandate, not
 * because any of these are expected in practice, but because an untested guard is
 * exactly as good as no guard at all until something proves it fires.
 */
describe('deserializeColony — every validation guard fires (boundary and error paths)', () => {
  function parseSave(raw: string): { colony: Record<string, unknown> } {
    return JSON.parse(raw) as { colony: Record<string, unknown> }
  }

  function expectMalformed(raw: string): void {
    const result = deserializeColony(raw)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('malformed')
  }

  it('should reject a colony whose mission is an array, not an object', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    parsed.colony.mission = []
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a colony whose turnsTaken is an object, not a number', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    parsed.colony.turnsTaken = {}
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a colony whose queue is a string, not an array', () => {
    const parsed = parseSave(serializeColony(advance(freshColony(), 1)))
    parsed.colony.queue = 'nope'
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a project with negative accumulatedLabourHours', () => {
    const parsed = parseSave(serializeColony(advance(freshColony(), 1)))
    const queue = parsed.colony.queue as { accumulatedLabourHours: number }[]
    const project = queue[0]
    if (project === undefined) throw new Error('test queue is empty')
    project.accumulatedLabourHours = -1
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a turn cycle with a zero (non-positive) workSeconds', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    const mission = parsed.colony.mission as { turnCycle: { workSeconds: number } }
    mission.turnCycle.workSeconds = 0
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a drone roster containing an empty string id', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION, { droneRoster: ['drone-00'] })))
    parsed.colony.droneRoster = ['']
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject an environment whose dustStorm is a string, not a boolean', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    const environment = parsed.colony.environment as Record<string, unknown>
    environment.dustStorm = 'yes'
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a stockpile with an empty resource key', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION, { stockpiles: { regolith: 1 } })))
    parsed.colony.stockpiles = { '': 5 }
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a structure type with an empty footprint array', () => {
    const parsed = parseSave(serializeColony(advance(freshColony(), 1)))
    const queue = parsed.colony.queue as { structureType: { footprint: unknown[] } }[]
    const project = queue[0]
    if (project === undefined) throw new Error('test queue is empty')
    project.structureType.footprint = []
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject powerSourceState with an empty structure id key', () => {
    const parsed = parseSave(serializeColony(advance(freshColony(), 1)))
    parsed.colony.powerSourceState = { '': { turnsOperated: 0 } }
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a grid tile whose occupantId is a number, not a string or null', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    const grid = parsed.colony.grid as { tiles: { occupantId: unknown }[] }
    const tile = grid.tiles[0]
    if (tile === undefined) throw new Error('test grid is empty')
    tile.occupantId = 42
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a grid tile whose occupantId is an empty string', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    const grid = parsed.colony.grid as { tiles: { occupantId: unknown }[] }
    const tile = grid.tiles[0]
    if (tile === undefined) throw new Error('test grid is empty')
    tile.occupantId = ''
    expectMalformed(JSON.stringify(parsed))
  })

  it('should reject a grid whose tile count disagrees with width*height', () => {
    const parsed = parseSave(serializeColony(createColony(MISSION)))
    const grid = parsed.colony.grid as { tiles: unknown[] }
    grid.tiles = grid.tiles.slice(0, -1)
    expectMalformed(JSON.stringify(parsed))
  })

  it('should report a generic, safe message if validation throws something other than the module\'s own ShapeError', () => {
    // Every documented rejection above carries a `ShapeError` with a path-qualified
    // message built entirely from this module's own fixed strings. This proves the
    // OTHER branch: if something entirely unanticipated went wrong inside the
    // validation walk — a genuine programmer error, not a bad save — the result is
    // STILL a typed, safe-to-render rejection, never a raw `Error#message` (which
    // could contain anything) and never an uncaught exception.
    const spy = vi.spyOn(Object, 'entries').mockImplementationOnce(() => {
      throw new TypeError('an unrelated internal defect, not a validation rejection')
    })
    try {
      const raw = serializeColony(createColony(MISSION, { stockpiles: { regolith: 1 } }))
      const result = deserializeColony(raw)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.kind).toBe('malformed')
      expect(result.message).not.toContain('an unrelated internal defect')
    } finally {
      spy.mockRestore()
    }
  })

  it('should report malformed (not truncated) if JSON.parse ever throws something other than a SyntaxError', () => {
    // JSON.parse is documented to only ever throw SyntaxError for a parse failure; this
    // defends against an exotic engine (or a future spec change) doing otherwise,
    // proving the fallback path is "malformed", never a crash and never mis-reported
    // as "truncated".
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new TypeError('not actually a JSON syntax error')
    })
    try {
      const result = deserializeColony('irrelevant, JSON.parse is mocked')
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.kind).toBe('malformed')
    } finally {
      spy.mockRestore()
    }
  })
})
