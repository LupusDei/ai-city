/**
 * Construction queue & build-progress tracking — what makes `buildTurns` MEAN
 * something.
 *
 * The player never places a finished building. They QUEUE one at a validated
 * footprint (via `placement.ts`), and drones spend labour-hours against it,
 * turn over turn, until `catalog.ts`'s `buildTurns` requirement is met. This
 * module owns exactly that progress bookkeeping: a `ConstructionProject` is a
 * placed-but-not-yet-complete structure instance, and a `ConstructionQueue` is
 * an ordered list of them competing for a single shared, scarce resource —
 * this turn's drone labour (see `drones.ts`'s `labourCapacityHours`).
 *
 * Unit of progress: ONE BUILD TURN OF LABOUR. `catalog.ts` describes
 * `buildTurns` as "turns of drone work to complete" but never pins that to a
 * concrete quantity. This module pins it to exactly one drone-shift's worth
 * of labour-hours (`requiredLabourHoursPerBuildTurn`, i.e.
 * `labourCapacityHours(config, 1)` from `time.ts`) rather than inventing an
 * independent constant: "one turn of drone work" then literally means "the
 * work of one drone, on shift, for one turn" — the same unit `drones.ts`
 * already uses to report labour capacity — so the two can never drift apart.
 * A structure's total labour requirement is therefore
 * `buildTurns * requiredLabourHoursPerBuildTurn(config)`, and progress is
 * tracked internally as fractional-safe accumulated labour-hours so surplus
 * labour can flow cleanly between projects (see `advanceConstruction`), while
 * the INTEGER `turnsCompleted` fed to `mission.ts` is only ever derived from
 * that accumulator, never stored as a second, independently-mutated field —
 * there is exactly one source of truth for a project's progress.
 *
 * Meshing with `mission.ts`: `mission.ts` defines `HabitatStructure` as
 * `Pick<StructureType, 'habitatCapacity' | 'buildTurns'> & { turnsCompleted }`
 * specifically so a future construction system's per-instance state could be
 * adapted into it with a one-line mapping. `toHabitatStructure` below is
 * exactly that one-line adapter — this module never re-implements
 * `isStructureComplete` or `totalHabitatCapacity`, it only ever feeds
 * `mission.ts` the shape it already knows how to judge.
 *
 * Meshing with `ledger.ts`: an in-progress structure must occupy its tiles
 * (see `releaseTiles` below, and this module's use of `placement.ts`'s
 * `ValidPlacement`) while contributing ZERO resource flow. `toResourceFlow`
 * encodes that directly: an incomplete project reports empty `produces`/
 * `consumes` maps, so `ledger.ts`'s `computeBalances`/`applyLedger` — which
 * already treat an absent resource key as `0` — need no special case for
 * "under construction" at all.
 *
 * Determinism: this module never uses `Math.random`, `Date.now`, `new Date`,
 * or Map/Set iteration order to decide anything observable. `ConstructionQueue`
 * is a plain array, and `advanceConstruction` allocates labour by walking it
 * with a single `for...of` in array order — see that function's doc for the
 * documented, deterministic priority rule this implements.
 */

import type { Coord, Grid, Tile } from './grid'
import type { StructureType } from './catalog'
import type { ResourceFlow } from './ledger'
import type { PlacementRejection, ValidPlacement } from './placement'
import { applyPlacement, validatePlacement } from './placement'
import type { HabitatStructure } from './mission'
import { labourCapacityHours } from './time'
import type { TurnCycleConfig } from './time'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One structure instance under construction (or already complete but still
 * tracked — see the module doc's note on `turnsCompleted` being derived, not
 * dual-stored).
 *
 * `structureType` is embedded directly (not looked up by id each time) so
 * every function below is a pure function of the project alone, with no
 * hidden catalog dependency or lookup that could fail at the wrong time.
 * `tiles` is carried from the `ValidPlacement` that sited this project, so
 * the project always knows exactly what it occupies without re-deriving
 * footprint offsets or re-querying the grid.
 */
export interface ConstructionProject {
  readonly id: string
  readonly structureType: StructureType
  readonly tiles: readonly Coord[]
  /** Labour-hours accumulated so far, toward `totalLabourHoursRequired`. */
  readonly accumulatedLabourHours: number
}

/**
 * An ordered list of construction projects. A plain `readonly` array, not a
 * wrapper object or a Map: `advanceConstruction`'s labour-priority rule is
 * defined entirely in terms of this array's order (see that function's doc),
 * so the queue's type itself should make "order matters" obvious rather than
 * hiding it behind a keyed structure whose iteration order is not a
 * documented contract.
 */
export type ConstructionQueue = readonly ConstructionProject[]

/** Result of allocating one turn's labour-hours across a `ConstructionQueue`. */
export interface ConstructionAdvanceResult {
  /** The queue with every project's `accumulatedLabourHours` updated. */
  readonly queue: ConstructionQueue
  /** Labour-hours actually applied to some project this call. */
  readonly labourHoursApplied: number
  /**
   * Labour-hours that could not be applied because every project in the
   * queue was already fully funded (or the queue was empty). Reported
   * explicitly — never just implied by `labourHoursApplied` being less than
   * the input — so a caller can distinguish "the whole colony's build queue
   * is fully staffed" from a bug that silently dropped labour.
   */
  readonly labourHoursUnused: number
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertNonEmptyId(id: string, label: string): void {
  if (id.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`)
  }
}

/** @throws {RangeError} if `value` is not a finite, non-negative number. */
function assertValidLabourHours(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `availableLabourHours must be a finite, non-negative number, received: ${value}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Labour-hour <-> build-turn conversion
// ---------------------------------------------------------------------------

/**
 * Labour-hours equivalent to "one turn of drone work" — see the module doc's
 * "Unit of progress" section for why this is `labourCapacityHours(config, 1)`
 * rather than an independent constant.
 *
 * @throws {RangeError} if `config` fails `time.ts`'s own validation
 *   (delegated, not re-implemented here — see `drones.ts` for the identical
 *   pattern).
 */
export function requiredLabourHoursPerBuildTurn(config: TurnCycleConfig): number {
  return labourCapacityHours(config, 1)
}

/**
 * Total labour-hours a structure type needs to reach `buildTurns` full
 * turns of progress.
 *
 * @throws {RangeError} if `config` fails `time.ts`'s own validation.
 */
export function totalLabourHoursRequired(
  structureType: StructureType,
  config: TurnCycleConfig,
): number {
  return structureType.buildTurns * requiredLabourHoursPerBuildTurn(config)
}

// ---------------------------------------------------------------------------
// Project lifecycle
// ---------------------------------------------------------------------------

/**
 * Start tracking a new construction project at zero accumulated labour.
 *
 * Takes a `ValidPlacement` (not a bare tile list) specifically so this
 * function can only ever be called with a placement `placement.ts` has
 * already validated as in-bounds and unoccupied — there is no way to
 * construct a `ConstructionProject` for a footprint that was never checked
 * against the grid. `structureType` is carried through unchanged (not
 * copied): it is already an immutable, validated `StructureType` from
 * `catalog.ts`'s `createCatalog`, so re-copying it here would just be
 * redundant allocation of already-trusted data. `tiles`, in contrast, IS
 * defensively copied: `ValidPlacement.tiles` is caller-visible and mutable at
 * the JS level despite its `readonly` type, and a project's occupied tiles
 * must never change out from under it after creation.
 *
 * @throws {RangeError} if `id` is an empty string.
 */
export function createProject(
  id: string,
  structureType: StructureType,
  placement: ValidPlacement,
): ConstructionProject {
  assertNonEmptyId(id, 'Construction project id')

  return {
    id,
    structureType,
    tiles: placement.tiles.map((coord) => ({ x: coord.x, y: coord.y })),
    accumulatedLabourHours: 0,
  }
}

/** A successful `queueConstruction`: the structure was sited and its progress tracking started. */
export interface QueueConstructionSuccess {
  readonly ok: true
  /** `grid` with `id` now occupying every tile of `structureType`'s footprint at `anchor`. */
  readonly grid: Grid
  /** A freshly created, zero-progress project, ready to `enqueueProject` onto a queue. */
  readonly project: ConstructionProject
}

/**
 * The result of queueing a new construction project: either it was sited
 * successfully, or it was rejected for exactly one of `placement.ts`'s two
 * reasons.
 */
export type QueueConstructionResult = QueueConstructionSuccess | PlacementRejection

/**
 * Validate, site, and start tracking a new construction project in one call —
 * the single production entry point for "the player queues a build here."
 *
 * ## Why this exists, not just "call validatePlacement then applyPlacement"
 *
 * `placement.ts`'s `applyPlacement` was changed (aic-a00.13) to re-validate a
 * `ValidPlacement`'s tiles against whatever `Grid` it is actually applied to,
 * specifically because a caller who validates against one grid and applies
 * to a different (or since-mutated) one previously got a silent no-op: the
 * structure vanished with no error. Construction is the first real caller
 * that chains validate -> apply -> track-progress for every queued build, so
 * it is exactly the place that bug would have resurfaced as "a structure
 * consumes drone labour for its full build duration and then never appears."
 * Bundling all three steps behind one function means there is no call site
 * anywhere in this module (or in a future game-loop caller) that can `.grid`
 * an unnarrowed `ApplyResult`, or create a `ConstructionProject` whose tiles
 * were never actually written into the grid it will be checked against.
 *
 * Both of `placement.ts`'s checks are re-exposed here as the SAME typed
 * `PlacementRejection` — an out-of-bounds or already-occupied anchor is
 * reported exactly as `validatePlacement`/`applyPlacement` would report it,
 * never swallowed or downgraded into "nothing happened."
 *
 * @throws Nothing of its own. `createProject`'s only throw condition (an
 *   empty `id`) is a caller/programmer error, not a placement outcome, and is
 *   deliberately left un-caught here — an empty instance id is exactly as
 *   much a bug when queueing as it would be anywhere else `createProject` is
 *   called directly.
 */
export function queueConstruction(
  grid: Grid,
  id: string,
  structureType: StructureType,
  anchor: Coord,
): QueueConstructionResult {
  const validation = validatePlacement(grid, structureType, anchor)
  if (!validation.ok) return validation

  // `applied.ok` is always `true` here in practice: `applyPlacement` re-checks
  // `validation.tiles` against this SAME, synchronously-unmutated `grid` that
  // `validatePlacement` just checked them against (grids are immutable
  // everywhere in this sim), so its internal re-validation cannot disagree
  // with the one just performed above. The branch is nonetheless required —
  // and left in, untestable-as-unreachable, rather than an unsound cast past
  // it — because `ApplyResult` is a union `queueConstruction` cannot narrow
  // around: `applyPlacement`'s whole raison d'etre (aic-a00.13) is guarding
  // against a caller applying a `ValidPlacement` to a DIFFERENT grid than it
  // was validated against, and only the type checker, not this function's own
  // logic, can prove that misuse is impossible here. Mirrors `placement.ts`'s
  // own documented "untestable-as-unreachable" defensive guard for the same
  // reason (see `ValidPlacement`'s doc comment).
  const applied = applyPlacement(grid, id, validation)
  if (!applied.ok) return applied

  return { ok: true, grid: applied.grid, project: createProject(id, structureType, validation) }
}

/**
 * Add a new project to the END of a queue — i.e. lowest current priority
 * (see `advanceConstruction` for what "priority" means). Modelling new work
 * as joining the back of the line, never jumping ahead of what is already
 * queued, is what makes the priority rule read as an ordinary, learnable
 * construction schedule rather than an implementation detail.
 *
 * @throws {RangeError} if `project.id` already exists somewhere in `queue`.
 *   A duplicate id is a programmer/caller error (the caller is responsible
 *   for issuing unique instance ids, exactly as `drones.ts`'s roster
 *   validation requires unique drone ids) — not an ordinary rejection a
 *   player-facing UI needs a typed reason for, unlike `placement.ts`'s
 *   rejections.
 */
export function enqueueProject(
  queue: ConstructionQueue,
  project: ConstructionProject,
): ConstructionQueue {
  if (queue.some((existing) => existing.id === project.id)) {
    throw new RangeError(`Construction queue already contains project id: "${project.id}"`)
  }
  return [...queue, project]
}

/**
 * Whether `project` has accumulated at least `totalLabourHoursRequired`
 * labour-hours.
 *
 * `>=` rather than `===`, mirroring `mission.ts`'s `isStructureComplete`
 * exactly: a project that has (through some future allocation change)
 * accumulated more than strictly required must still read as complete, not
 * fall through as neither complete nor sensibly incomplete.
 *
 * @throws {RangeError} if `config` fails `time.ts`'s own validation.
 */
export function isProjectComplete(config: TurnCycleConfig, project: ConstructionProject): boolean {
  return project.accumulatedLabourHours >= totalLabourHoursRequired(project.structureType, config)
}

/**
 * The integer number of build turns `project` has completed, for feeding
 * straight into `mission.ts`'s `HabitatStructure.turnsCompleted`.
 *
 * Floors rather than rounds: a partially-funded build turn does not count as
 * a completed one (mirrors `mission.ts`'s own "9/10 contributes zero" rule —
 * partial progress toward the NEXT turn must not be credited early). Clamped
 * to `[0, buildTurns]` so a project that has accumulated more hours than it
 * will ever need (see `isProjectComplete`'s over-accumulation note) reports a
 * sane, bounded `turnsCompleted` rather than a number `mission.ts` would have
 * to additionally clamp itself.
 *
 * @throws {RangeError} if `config` fails `time.ts`'s own validation.
 */
export function turnsCompletedFor(config: TurnCycleConfig, project: ConstructionProject): number {
  const hoursPerTurn = requiredLabourHoursPerBuildTurn(config)
  const rawTurns = Math.floor(project.accumulatedLabourHours / hoursPerTurn)
  return Math.min(project.structureType.buildTurns, Math.max(0, rawTurns))
}

// ---------------------------------------------------------------------------
// Adapters into mission.ts / ledger.ts
// ---------------------------------------------------------------------------

/**
 * Adapt a `ConstructionProject` into the minimal shape `mission.ts` needs to
 * judge it — see the module doc's "Meshing with mission.ts" section. This is
 * the ONLY place construction state is translated for `evaluateMission`;
 * nothing in `mission.ts` needs to change, and nothing here re-implements
 * `mission.ts`'s completion or capacity logic.
 *
 * @throws {RangeError} if `config` fails `time.ts`'s own validation.
 */
export function toHabitatStructure(
  config: TurnCycleConfig,
  project: ConstructionProject,
): HabitatStructure {
  return {
    habitatCapacity: project.structureType.habitatCapacity,
    buildTurns: project.structureType.buildTurns,
    turnsCompleted: turnsCompletedFor(config, project),
  }
}

/** A resource flow of exactly nothing — reused so every incomplete project shares one instance. */
const NO_FLOW: ResourceFlow = { produces: {}, consumes: {} }

/**
 * Adapt a `ConstructionProject` into the `ResourceFlow` shape `ledger.ts`
 * accounts for.
 *
 * THE critical rule this module exists to enforce, in `ledger.ts` terms: an
 * in-progress structure occupies its tiles (see `releaseTiles`/the placement
 * flow) but must contribute exactly zero to the colony's resource balance.
 * Returning `NO_FLOW` for an incomplete project — rather than, say, the
 * structure's real maps scaled by fractional progress — makes that a hard
 * step function matching `mission.ts`'s own "9/10 contributes zero capacity"
 * rule: partial credit is never awarded for partial construction, for
 * capacity OR for resource flow.
 *
 * @throws {RangeError} if `config` fails `time.ts`'s own validation.
 */
export function toResourceFlow(config: TurnCycleConfig, project: ConstructionProject): ResourceFlow {
  if (!isProjectComplete(config, project)) return NO_FLOW
  return { produces: project.structureType.produces, consumes: project.structureType.consumes }
}

/**
 * Every tile occupied by every project in `queue`, complete or not.
 *
 * Flattened via a plain `.flatMap` over the array (never a Set, which would
 * silently deduplicate a caller's own placement bug instead of surfacing it,
 * and would not preserve queue order) — see the module doc's determinism
 * note. Useful for a caller checking overall grid occupancy without walking
 * the queue by hand.
 */
export function occupiedTiles(queue: ConstructionQueue): readonly Coord[] {
  return queue.flatMap((project) => project.tiles)
}

// ---------------------------------------------------------------------------
// Turn advancement
// ---------------------------------------------------------------------------

/**
 * Apply one turn's available labour-hours across `queue`, advancing as many
 * projects as that labour allows.
 *
 * Priority rule (documented, deterministic — never Map/Set iteration order):
 * projects are funded strictly in ARRAY ORDER. The project at index 0 gets
 * first claim on `availableLabourHours`, up to whatever it still needs to
 * reach `totalLabourHoursRequired`; any labour left over falls through to
 * index 1, and so on. A project that is already fully funded (including one
 * with `buildTurns: 0`, pre-placed and complete on arrival) needs zero
 * additional hours, so it is transparently skipped — its "already complete"
 * status is never special-cased, it falls out of the same
 * `needed = max(0, required - accumulated)` arithmetic that governs every
 * other project. This is what "excess work queues rather than being
 * silently dropped" means concretely: labour a project can't absorb is never
 * discarded, it is offered to the next entry in the SAME queue, in the SAME
 * call, before finally being reported as `labourHoursUnused` only if nothing
 * left in the queue can use it.
 *
 * Rationale for "earliest queue position wins" (mirroring `drones.ts`'s
 * documented roster-priority rule): the queue's array order IS the order the
 * player queued builds in, so "the job you started first finishes first" is
 * both the simplest allocation rule to implement deterministically and the
 * one a player can predict without consulting this module's source.
 *
 * Never mutates `queue` or any project in it — a fresh array (and fresh
 * project objects for anything that changed) is always returned, so the
 * SAME input `queue` can be re-run with different labour figures, or twice
 * with identical labour, and both calls see identical starting state (see
 * this function's determinism tests).
 *
 * @throws {RangeError} if `availableLabourHours` is not a finite,
 *   non-negative number, or if `config` fails `time.ts`'s own validation
 *   (surfaced via `totalLabourHoursRequired` on the first project that needs
 *   it — an empty queue with a malformed config therefore does NOT throw,
 *   matching `time.ts`'s own "nothing to validate against" posture).
 */
export function advanceConstruction(
  config: TurnCycleConfig,
  queue: ConstructionQueue,
  availableLabourHours: number,
): ConstructionAdvanceResult {
  assertValidLabourHours(availableLabourHours)

  let remaining = availableLabourHours
  const nextQueue: ConstructionProject[] = []

  // Labour is granted only in WHOLE build-turn units.
  //
  // RULED BY THE GENERAL (aic-chg): "No storing labor at all." Unspent robot-hours
  // are lost at the end of the turn; they are never banked against a project so it
  // can finish a part-funded build-turn later. Taking `Math.min(remaining, needed)`
  // — any amount that fits — would have banked a fraction of a build-turn on the
  // project and carried it across the turn boundary, which is exactly the storage
  // that ruling forbids.
  //
  // It also removes a latent bug at the ROOT rather than patching it.
  // `turnsCompletedFor` divides `accumulatedLabourHours` by this same
  // `hoursPerTurn` and floors it with NO epsilon, while `drones.ts` carries
  // FLOOR_EPSILON for precisely that hazard. As soon as fractional labour entered
  // the system (spec 003's panel cleaning is the first source), a 1e-13 deficit
  // would have floored to one turn less, flipping a finished habitat to incomplete
  // — contributing zero readiness and losing the mission on a rounding error.
  // Because every grant here is an exact multiple, `accumulatedLabourHours` is
  // always an exact multiple, so that quotient is exact and needs no epsilon. The
  // class of error stops existing instead of being compensated for.
  const hoursPerTurn = requiredLabourHoursPerBuildTurn(config)

  for (const project of queue) {
    const totalRequired = totalLabourHoursRequired(project.structureType, config)
    const needed = Math.max(0, totalRequired - project.accumulatedLabourHours)
    // Whole build-turns the remaining labour can fund, then clamped to what the
    // project still needs. `needed` is itself always a whole multiple, because
    // accumulation starts at zero and only ever advances in these units.
    const affordable = Math.floor(remaining / hoursPerTurn) * hoursPerTurn
    const take = Math.min(affordable, needed)
    remaining -= take

    nextQueue.push(
      take === 0
        ? project
        : { ...project, accumulatedLabourHours: project.accumulatedLabourHours + take },
    )
  }

  return {
    queue: nextQueue,
    labourHoursApplied: availableLabourHours - remaining,
    labourHoursUnused: remaining,
  }
}

/**
 * Remove `id` from `queue`, cancelling that project. Callers are also
 * responsible for calling `releaseTiles` with the cancelled project's
 * `tiles` against whatever `Grid` they are tracking — this function only
 * owns queue membership, not grid occupancy, since a `ConstructionQueue`
 * never holds a `Grid` reference (see the module doc: this module stays
 * grid-agnostic except for the one `releaseTiles` helper that exists purely
 * to reverse `placement.ts`'s `applyPlacement`).
 *
 * @throws {RangeError} if `id` is not present in `queue`. A well-behaved
 *   caller only ever cancels an id it already knows is queued (e.g. from a
 *   UI list populated from this same queue), so an unknown id indicates a
 *   caller bug, not an ordinary player-facing rejection — the same
 *   philosophy `enqueueProject`'s duplicate-id check uses.
 */
export function cancelProject(queue: ConstructionQueue, id: string): ConstructionQueue {
  if (!queue.some((project) => project.id === id)) {
    throw new RangeError(`Cannot cancel unknown construction project id: "${id}"`)
  }
  return queue.filter((project) => project.id !== id)
}

/**
 * The counterpart to `placement.ts`'s `applyPlacement`, for freeing tiles
 * when a project is cancelled. `placement.ts` deliberately never grew an
 * "un-place" operation (it only knows how to validate and apply a NEW
 * placement), and `grid.ts` deliberately knows nothing about occupancy
 * semantics beyond "what id, if any, is here" — so the un-placement this
 * module's cancellation flow needs lives here, next to the cancellation
 * logic that is its only caller.
 *
 * Mirrors `applyPlacement`'s exact implementation shape (map every tile,
 * replace only the ones in the target set, keep every other tile's object
 * reference) for the same reason `applyPlacement` itself gives: O(width *
 * height) with no unnecessary allocation, and a single, consistent pattern
 * for "rewrite a subset of grid tiles" that any future reviewer only has to
 * learn once.
 *
 * Tolerant, not throwing, for tiles outside the grid or already unoccupied:
 * cancellation is triggered by this module's own prior state (a project's
 * own recorded `tiles`), never directly by unchecked player input, so a
 * mismatch here would be this module's own bug — surfacing it as a thrown
 * error would not make that bug easier to find, and silently no-op'ing on an
 * out-of-bounds coordinate keeps this function total, matching `grid.ts`'s
 * own `tileAt` convention of returning `undefined` rather than throwing for
 * out-of-bounds coordinates.
 */
export function releaseTiles(grid: Grid, tiles: readonly Coord[]): Grid {
  const targetKeys = new Set(tiles.map((coord) => `${coord.x},${coord.y}`))

  const nextTiles: Tile[] = grid.tiles.map((tile) => {
    if (!targetKeys.has(`${tile.x},${tile.y}`)) return tile
    return { x: tile.x, y: tile.y, occupantId: null }
  })

  return { width: grid.width, height: grid.height, tiles: nextTiles }
}
