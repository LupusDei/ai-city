/**
 * Save and resume a mission (aic-oby.2): turn a `ColonyState` into a versioned string
 * and back, safely.
 *
 * WHY THIS IS CHEAP. `turn.ts`'s own header states the design goal directly:
 * `ColonyState` was built with no `Map`, no `Set`, no `Date`, no class instances and no
 * functions ANYWHERE in its transitive shape — every field is a plain object, array,
 * string, number or boolean. That was a deliberate choice made long before this bead
 * existed, precisely so that `JSON.stringify`/`JSON.parse` would be a legitimate save
 * format rather than a hack. This module cashes that decision in. It does not reshape
 * `ColonyState` and does not add a field to it.
 *
 * THE ONE THING THAT MAKES THIS HARDER THAN "JSON.stringify it": trust. A save file is
 * text that left the process and came back — through a browser's `localStorage`, a
 * disk, a copy-paste, an old version of this game. `JSON.parse` alone answers "is this
 * valid JSON?", not "is this a valid `ColonyState`?", and the gap between those two
 * questions is exactly where a corrupted 278-turn mission would resume silently wrong
 * rather than refuse to load. So every field is walked and range-checked on load,
 * mirroring the integer/shape invariants `catalog.ts`, `grid.ts`, `time.ts`, `ledger.ts`
 * and `generation.ts` already enforce at construction time — this module does not
 * invent new rules, it re-checks the ones that already exist, because a save file did
 * not pass through any of those modules' own constructors to get here.
 *
 * WHY VALIDATION NEVER CALLS `createColony`. `createColony` (`turn.ts`) unconditionally
 * sets `turnsTaken: 0` — exactly right for a NEW colony, exactly wrong for a resumed
 * one. Reusing it here would silently rewind every loaded mission to turn zero while
 * everything else (the queue, the stockpiles) stayed mid-mission, which is a far worse
 * defect than a rejected file: a save that back to a lie about how far the mission has
 * gotten. So this module constructs the `ColonyState` value directly, performing its
 * own uniqueness checks (drone ids, project ids) that mirror `turn.ts`'s
 * `assertUniqueNonEmptyIds` rather than delegating to it.
 *
 * THREE FAILURE MODES, DISTINGUISHED, and each maps to a message a PLAYER can read
 * without a stack trace:
 *   - `truncated`: the text is not even complete JSON — `JSON.parse` hit the end of
 *     the string before finding a matching close (a write interrupted mid-flush, a
 *     copy-paste that lost its tail). Detected by matching V8's own wording for this
 *     specific failure, so a save cut off anywhere still gets its own message rather
 *     than a generic parse error.
 *   - `malformed`: the text parses as JSON but is not a save this module recognises
 *     — wrong top-level shape, a field with the wrong type, a range violation, a
 *     duplicated id. Also the catch-all for anything unanticipated: NOTHING below
 *     ever lets an exception escape to the caller.
 *   - `version-mismatch`: the text is well-formed and carries a real, integer
 *     `formatVersion` — just not this one. Kept distinct from `malformed` because the
 *     player-facing answer is different ("this save is from another version of the
 *     game", not "this save is broken").
 *
 * DETERMINISM: no `Math.random`, `Date.now` or `new Date` anywhere in this module —
 * a save carries no wall-clock metadata, because nothing downstream of it may depend
 * on one. Every numeric field is validated as an exact integer and never rounded,
 * divided or reconstructed from a computation; the value that comes out of
 * `deserializeColony` is drawn field-for-field from the parsed JSON, never
 * recomputed, so there is no float-coercion seam for 1 to become 1.0000000001 through.
 */

import type {
  FootprintOffset,
  ResourceAmounts,
  SitingRequirements,
  StructureType,
} from './catalog'
import type { ConstructionProject, ConstructionQueue } from './construction'
import type { DroneId } from './drones'
import type { GenerationEnvironment, PowerSourceState } from './generation'
import type { Coord, Grid, Tile } from './grid'
import type { MissionConfig } from './mission'
import type { TurnCycleConfig } from './time'
import type { ColonyState } from './turn'

/**
 * The save format's own version, independent of the game's version. Bump this any
 * time a change to this module (or to a field `ColonyState` transitively depends on)
 * would make an OLD save parse into something silently wrong rather than cleanly
 * refused. A save always states the version it was written under; `deserializeColony`
 * refuses anything that does not match this exactly, rather than guessing at
 * forward/backward compatibility no version of this game has been tested against.
 */
export const SAVE_FORMAT_VERSION = 1

/** The on-disk envelope. Never exported as a type consumers construct by hand. */
interface SaveFile {
  readonly formatVersion: number
  readonly colony: ColonyState
}

/**
 * Serialise a colony to a versioned save string.
 *
 * Deliberately does no validation of `colony` itself: the type system already
 * guarantees its caller holds a real `ColonyState`, and re-validating a value this
 * module's own type just produced would be ceremony, not safety. Validation exists
 * for the READ side, where a string of unknown provenance is trusted with nothing.
 */
export function serializeColony(colony: ColonyState): string {
  const save: SaveFile = { formatVersion: SAVE_FORMAT_VERSION, colony }
  return JSON.stringify(save)
}

/** Why a load was refused. See the module header for what distinguishes the three. */
export type SaveLoadFailureKind = 'malformed' | 'truncated' | 'version-mismatch'

export interface SaveLoadFailure {
  readonly ok: false
  readonly kind: SaveLoadFailureKind
  /**
   * Safe to render to the player directly: no stack trace, no `[object Object]`, no
   * raw exception text. Every branch below composes this from known-safe pieces
   * (a fixed sentence plus, at most, an already-validated string or integer).
   */
  readonly message: string
}

export interface SaveLoadSuccess {
  readonly ok: true
  readonly colony: ColonyState
}

export type LoadColonyResult = SaveLoadSuccess | SaveLoadFailure

// ---------------------------------------------------------------------------
// Small, composable runtime guards over `unknown`
// ---------------------------------------------------------------------------

/**
 * Thrown ONLY internally, to unwind out of an arbitrarily deep validation walk in one
 * step. Never allowed to escape this module — every public entry point below catches
 * it (and, as a last line of defence, anything else) and converts it to a typed
 * `SaveLoadFailure`. A private subclass rather than a bare `Error` so the catch site
 * can tell "this is a validation rejection with a player-safe message" apart from a
 * genuine, unanticipated programmer error, without either case ever reaching the
 * caller as an exception.
 */
class ShapeError extends Error {}

/** A short, safe-to-interpolate description of an arbitrary value for an error message. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of length ${value.length}`
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  if (typeof value === 'number' || typeof value === 'boolean') return `${typeof value} ${String(value)}`
  return typeof value
}

/** Raise a `ShapeError` naming the offending field. Return type `never` narrows callers. */
function fail(path: string, detail: string): never {
  throw new ShapeError(`Save data at "${path}" ${detail}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(path, `must be an object, received ${describeValue(value)}`)
  return value
}

function expectArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, `must be an array, received ${describeValue(value)}`)
  return value
}

function expectInteger(value: unknown, path: string): number {
  if (!isInteger(value)) fail(path, `must be an integer, received ${describeValue(value)}`)
  return value
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  const n = expectInteger(value, path)
  if (n < 0) fail(path, `must be a non-negative integer, received ${describeValue(value)}`)
  return n
}

function expectPositiveInteger(value: unknown, path: string): number {
  const n = expectInteger(value, path)
  if (n <= 0) fail(path, `must be a positive integer, received ${describeValue(value)}`)
  return n
}

function expectNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, `must be a non-empty string, received ${describeValue(value)}`)
  }
  return value
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, `must be a boolean, received ${describeValue(value)}`)
  return value
}

/** Rejects a duplicate among already-validated ids, matching `turn.ts`'s own rule. */
function assertNoDuplicates(ids: readonly string[], path: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) fail(path, `contains duplicate id "${id}"`)
    seen.add(id)
  }
}

// ---------------------------------------------------------------------------
// Field-by-field validation, mirroring the invariants each owning module enforces
// ---------------------------------------------------------------------------

/** A resource map: every field non-negative-integer, exactly `catalog.ts`'s own rule. */
function validateAmountRecord(value: unknown, path: string): ResourceAmounts {
  const obj = expectObject(value, path)
  const result: Record<string, number> = {}
  for (const [key, amount] of Object.entries(obj)) {
    if (key.length === 0) fail(path, 'must not contain an empty resource key')
    result[key] = expectNonNegativeInteger(amount, `${path}.${key}`)
  }
  return result
}

function validateFootprint(value: unknown, path: string): readonly FootprintOffset[] {
  const arr = expectArray(value, path)
  if (arr.length === 0) fail(path, 'must contain at least one footprint offset')
  return arr.map((entry, index) => {
    const obj = expectObject(entry, `${path}[${index}]`)
    return {
      dx: expectInteger(obj.dx, `${path}[${index}].dx`),
      dy: expectInteger(obj.dy, `${path}[${index}].dy`),
    }
  })
}

function validateSiting(value: unknown, path: string): SitingRequirements {
  const obj = expectObject(value, path)
  if (!('requiresDeposit' in obj)) return {}
  return { requiresDeposit: expectNonEmptyString(obj.requiresDeposit, `${path}.requiresDeposit`) }
}

function validateStructureType(value: unknown, path: string): StructureType {
  const obj = expectObject(value, path)
  // Field order matches `catalog.ts`'s own `createCatalog` object literal exactly
  // (id, name, footprint, buildTurns, produces, consumes, buildCost, siting,
  // storageCapacity, standbyConsumes, priorityClass, powerOutputModel,
  // habitatCapacity). `JSON.stringify` walks an object's OWN keys in insertion
  // order, so reproducing a "byte-identical" save (this module's own acceptance
  // criterion) depends on this literal matching that one field-for-field — a
  // structurally-equal object built in a different key order re-encodes to a
  // DIFFERENT string, which the round-trip test below pins.
  return {
    id: expectNonEmptyString(obj.id, `${path}.id`),
    name: expectNonEmptyString(obj.name, `${path}.name`),
    footprint: validateFootprint(obj.footprint, `${path}.footprint`),
    buildTurns: expectNonNegativeInteger(obj.buildTurns, `${path}.buildTurns`),
    produces: validateAmountRecord(obj.produces, `${path}.produces`),
    consumes: validateAmountRecord(obj.consumes, `${path}.consumes`),
    buildCost: validateAmountRecord(obj.buildCost, `${path}.buildCost`),
    siting: validateSiting(obj.siting, `${path}.siting`),
    storageCapacity: validateAmountRecord(obj.storageCapacity, `${path}.storageCapacity`),
    standbyConsumes: validateAmountRecord(obj.standbyConsumes, `${path}.standbyConsumes`),
    priorityClass: expectNonNegativeInteger(obj.priorityClass, `${path}.priorityClass`),
    powerOutputModel: expectNonEmptyString(obj.powerOutputModel, `${path}.powerOutputModel`),
    habitatCapacity: expectNonNegativeInteger(obj.habitatCapacity, `${path}.habitatCapacity`),
  }
}

function validateCoord(value: unknown, path: string): Coord {
  const obj = expectObject(value, path)
  return {
    x: expectNonNegativeInteger(obj.x, `${path}.x`),
    y: expectNonNegativeInteger(obj.y, `${path}.y`),
  }
}

function validateConstructionProject(value: unknown, path: string): ConstructionProject {
  const obj = expectObject(value, path)
  const structureType = validateStructureType(obj.structureType, `${path}.structureType`)
  const tilesArr = expectArray(obj.tiles, `${path}.tiles`)
  const tiles = tilesArr.map((tile, index) => validateCoord(tile, `${path}.tiles[${index}]`))
  // Cross-field check: a genuine project's resolved tile list always has exactly one
  // tile per footprint offset (`placement.resolveFootprint`'s own invariant). A save
  // whose tile count disagrees with its own structure type's footprint is corrupt,
  // not merely differently-shaped, and would otherwise silently mis-occupy the grid.
  if (tiles.length !== structureType.footprint.length) {
    fail(
      `${path}.tiles`,
      `must have exactly one tile per footprint offset (expected ${structureType.footprint.length}, received ${tiles.length})`,
    )
  }
  return {
    id: expectNonEmptyString(obj.id, `${path}.id`),
    structureType,
    tiles,
    accumulatedLabourHours: expectNonNegativeInteger(
      obj.accumulatedLabourHours,
      `${path}.accumulatedLabourHours`,
    ),
  }
}

function validateConstructionQueue(value: unknown, path: string): ConstructionQueue {
  const arr = expectArray(value, path)
  const queue = arr.map((entry, index) => validateConstructionProject(entry, `${path}[${index}]`))
  assertNoDuplicates(
    queue.map((project) => project.id),
    path,
  )
  return queue
}

function validateDroneRoster(value: unknown, path: string): readonly DroneId[] {
  const arr = expectArray(value, path)
  const roster = arr.map((entry, index) => expectNonEmptyString(entry, `${path}[${index}]`))
  assertNoDuplicates(roster, path)
  return roster
}

function validateStringArray(value: unknown, path: string): readonly string[] {
  const arr = expectArray(value, path)
  return arr.map((entry, index) => expectNonEmptyString(entry, `${path}[${index}]`))
}

function validatePowerSourceState(
  value: unknown,
  path: string,
): Readonly<Record<string, PowerSourceState>> {
  const obj = expectObject(value, path)
  const result: Record<string, PowerSourceState> = {}
  for (const [key, entry] of Object.entries(obj)) {
    if (key.length === 0) fail(path, 'must not contain an empty structure id key')
    const entryObj = expectObject(entry, `${path}.${key}`)
    result[key] = {
      turnsOperated: expectNonNegativeInteger(entryObj.turnsOperated, `${path}.${key}.turnsOperated`),
    }
  }
  return result
}

function validateEnvironment(value: unknown, path: string): GenerationEnvironment {
  const obj = expectObject(value, path)
  return { dustStorm: expectBoolean(obj.dustStorm, `${path}.dustStorm`) }
}

function validateTurnCycle(value: unknown, path: string): TurnCycleConfig {
  const obj = expectObject(value, path)
  return {
    workSeconds: expectPositiveInteger(obj.workSeconds, `${path}.workSeconds`),
    rechargeSeconds: expectPositiveInteger(obj.rechargeSeconds, `${path}.rechargeSeconds`),
    missionSeconds: expectPositiveInteger(obj.missionSeconds, `${path}.missionSeconds`),
  }
}

function validateMission(value: unknown, path: string): MissionConfig {
  const obj = expectObject(value, path)
  return {
    turnCycle: validateTurnCycle(obj.turnCycle, `${path}.turnCycle`),
    incomingWaveSize: expectNonNegativeInteger(obj.incomingWaveSize, `${path}.incomingWaveSize`),
  }
}

function validateTile(value: unknown, path: string, width: number, index: number): Tile {
  const obj = expectObject(value, path)
  const x = expectNonNegativeInteger(obj.x, `${path}.x`)
  const y = expectNonNegativeInteger(obj.y, `${path}.y`)
  const expectedX = index % width
  const expectedY = Math.floor(index / width)
  // Row-major order (`index = y * width + x`, `grid.ts`'s own layout invariant) is
  // checked directly rather than range-checking `y < height` separately: any tile
  // whose (x, y) matches its row-major position is AUTOMATICALLY within
  // `[0, height)`, because `index` itself only ever ranges over `width * height`
  // values (enforced by the length check in `validateGrid`) — a second range check
  // here would be dead weight repeating what this one already guarantees.
  if (x !== expectedX || y !== expectedY) {
    fail(
      path,
      `is out of row-major order (expected (${expectedX}, ${expectedY}) at this position, received (${x}, ${y}))`,
    )
  }
  const occupantId = obj.occupantId
  if (occupantId !== null && typeof occupantId !== 'string') {
    fail(`${path}.occupantId`, `must be a string or null, received ${describeValue(occupantId)}`)
  }
  if (typeof occupantId === 'string' && occupantId.length === 0) {
    fail(`${path}.occupantId`, 'must not be an empty string (use null for "unoccupied")')
  }
  return { x, y, occupantId }
}

function validateGrid(value: unknown, path: string): Grid {
  const obj = expectObject(value, path)
  const width = expectPositiveInteger(obj.width, `${path}.width`)
  const height = expectPositiveInteger(obj.height, `${path}.height`)
  const tilesArr = expectArray(obj.tiles, `${path}.tiles`)
  if (tilesArr.length !== width * height) {
    fail(
      `${path}.tiles`,
      `must contain exactly width*height=${width * height} tiles, received ${tilesArr.length}`,
    )
  }
  const tiles = tilesArr.map((tile, index) => validateTile(tile, `${path}.tiles[${index}]`, width, index))
  return { width, height, tiles }
}

/**
 * Validate an already-parsed JSON value as a `ColonyState`, with no knowledge of (or
 * opinion about) any enclosing save envelope or format version.
 *
 * Split out from {@link deserializeColony} purely for readability — this half does the
 * actual field-by-field walk, that half owns parsing the string and the envelope's own
 * version. Not exported: `deserializeColony` is the one supported entry point for a
 * value of unknown provenance, so there is exactly one path a save string can take
 * into a `ColonyState`, never two that could quietly drift apart. Any exception
 * surfacing from the validation walk above is caught here and converted to a typed
 * `malformed` result: this function is a boundary a corrupt or hand-edited value can
 * reach, and per this module's contract, it must never throw.
 */
function validateColonyValue(value: unknown): LoadColonyResult {
  try {
    const obj = expectObject(value, 'colony')
    const colony: ColonyState = {
      mission: validateMission(obj.mission, 'colony.mission'),
      turnsTaken: expectNonNegativeInteger(obj.turnsTaken, 'colony.turnsTaken'),
      grid: validateGrid(obj.grid, 'colony.grid'),
      queue: validateConstructionQueue(obj.queue, 'colony.queue'),
      droneRoster: validateDroneRoster(obj.droneRoster, 'colony.droneRoster'),
      stockpiles: validateAmountRecord(obj.stockpiles, 'colony.stockpiles'),
      offlineStructureIds: validateStringArray(obj.offlineStructureIds, 'colony.offlineStructureIds'),
      powerSourceState: validatePowerSourceState(obj.powerSourceState, 'colony.powerSourceState'),
      environment: validateEnvironment(obj.environment, 'colony.environment'),
    }
    return { ok: true, colony }
  } catch (err) {
    // ShapeError carries a player-safe message built entirely from this module's own
    // fixed strings plus already-validated primitives (see `describeValue`). Anything
    // ELSE reaching here is an unanticipated defect in the validator itself — still
    // converted to a typed rejection rather than left to crash the caller, per this
    // module's one non-negotiable contract, but with a generic message rather than
    // trusting an arbitrary `Error#message` to be safe to render.
    const message =
      err instanceof ShapeError
        ? err.message
        : 'Save data could not be understood — its structure does not match a known colony.'
    return { ok: false, kind: 'malformed', message: `This save is damaged and cannot be loaded (${message}).` }
  }
}

/**
 * Substrings V8 (Node, and every browser this game targets) is known to include in a
 * `JSON.parse` `SyntaxError` specifically when the input ends before the JSON value it
 * started could be closed — i.e. the text was cut off, not merely wrong. Matched
 * defensively against several phrasings V8 has used across versions rather than one,
 * because the exact wording is not a stable public contract.
 */
const TRUNCATION_MESSAGE_FRAGMENTS = [
  'Unexpected end of JSON input',
  'Unexpected end of input',
  'Unterminated string in JSON',
] as const

/**
 * V8's newer `JSON.parse` errors (that do not use one of the fixed phrasings above)
 * report a character offset: `"...after property value in JSON at position 60"`.
 * When that offset is exactly the length of the text handed to `JSON.parse`, the
 * parser did not find anything WRONG until it ran out of characters to read — which
 * is exactly what a save cut off mid-write looks like (an interrupted flush ends the
 * text after a complete-looking prefix, never in the middle of an otherwise-valid
 * document). A corruption elsewhere in an otherwise complete-length document almost
 * never lands exactly on the final offset, so this stays a safe, position-based
 * signal rather than a string one.
 */
const TRAILING_POSITION_PATTERN = /at position (\d+)$/

function looksTruncated(err: unknown, inputLength: number): boolean {
  if (!(err instanceof SyntaxError)) return false
  if (TRUNCATION_MESSAGE_FRAGMENTS.some((fragment) => err.message.includes(fragment))) return true
  const match = TRAILING_POSITION_PATTERN.exec(err.message)
  const position = match?.[1]
  if (position === undefined) return false
  return Number(position) === inputLength
}

/**
 * Parse and validate a save string produced by {@link serializeColony} (or rejected
 * with a typed, player-readable reason — see the module header for the three kinds).
 *
 * NEVER THROWS. Every branch below — a JSON syntax error, an unexpected top-level
 * shape, a version this build does not recognise, or a colony value that fails
 * {@link validateColonyValue} — returns a `SaveLoadFailure` instead of propagating an
 * exception. That is the whole point of this function existing rather than a caller
 * writing `JSON.parse` themselves: a save file is untrusted input by definition, and
 * the failure mode this bead cares most about (docs: "silent corruption is the worst
 * possible failure") is only avoided if loading a bad file is IMPOSSIBLE to mistake
 * for loading a good one.
 */
export function deserializeColony(raw: string): LoadColonyResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    if (looksTruncated(err, raw.length)) {
      return {
        ok: false,
        kind: 'truncated',
        message:
          'This save file is incomplete — it looks like saving was interrupted before it finished writing. It cannot be loaded.',
      }
    }
    return {
      ok: false,
      kind: 'malformed',
      message: 'This save file is not readable — it is not valid save data and cannot be loaded.',
    }
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      kind: 'malformed',
      message: 'This save file is not readable — it is not valid save data and cannot be loaded.',
    }
  }

  const formatVersion = parsed.formatVersion
  if (!isInteger(formatVersion)) {
    return {
      ok: false,
      kind: 'malformed',
      message: 'This save file has no valid version number and cannot be loaded.',
    }
  }
  if (formatVersion !== SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      kind: 'version-mismatch',
      message:
        `This save was made with save format ${formatVersion}, but this version of the game ` +
        `reads format ${SAVE_FORMAT_VERSION}. It cannot be loaded here.`,
    }
  }

  return validateColonyValue(parsed.colony)
}
