/**
 * Everything the build tray, the placement overlay and the build queue panel display —
 * SELECTED (never computed) from the adapter's state and the sim's own build-progress
 * primitives (aic-oby.7).
 *
 * ============================================================================
 * THIS MODULE SELECTS. IT DOES NOT DECIDE. (Constitution §4, spec 005 FR-002)
 * ----------------------------------------------------------------------------
 * `ops-view.ts`'s own header explains why this lives in a `.ts` module rather than in a
 * component (coverage, and auditability of "does this screen invent a number?"); the
 * same reasoning applies here verbatim. Two things below are NOT a plain field copy,
 * and both are legitimate for the same reason `ops-view.ts`'s `totalTurns` read is:
 *
 *   - `turnsCompletedFor(config, project)` — a PURE sim function (`construction.ts`),
 *     not a re-derivation of it. This module has no opinion about how a build turn
 *     accrues; it asks the sim and stores the answer.
 *   - `buildTurns - turnsCompleted` — the one subtraction in this file. There is no
 *     sim-exposed "turns remaining for this project" field to read instead (unlike the
 *     MISSION's `turnsRemaining`, which `ops-view.ts` reads straight off `CycleReport`
 *     for exactly this reason), so the two operands — both already-decided sim
 *     integers — are combined here. This is arithmetic on a DISPLAY VALUE with no
 *     threshold, comparison or business rule in it, not a decision a screen could get
 *     wrong differently from the sim: `turnsCompletedFor` and `buildTurns` are the only
 *     two facts in the world that determine it, and both come from the sim unchanged.
 *
 * ============================================================================
 * WHY THE BUILD MENU IS GENERIC OVER THE CATALOG, NEVER A HARDCODED ID LIST
 * ----------------------------------------------------------------------------
 * `buildMenu` calls `catalog.listStructureTypes` and maps EVERY entry it returns. There
 * is no `if (id === 'regolith-hopper')` anywhere in this file, and there must never be
 * one: `catalog.ts` rejects unknown fields, `generation.ts` registers curves by name,
 * resource keys are open strings — this project's whole convention is that build
 * CONTENT is data. A build tray that had to be edited every time a chain added a
 * structure would be the one place that convention broke. `game-state.ts`'s
 * `buildableStructureSpecs` is the one place new chains are concatenated in; this file
 * never needs to change when one is.
 *
 * ============================================================================
 * DETERMINISTIC INSTANCE IDS, NOT A COUNTER OR `crypto.randomUUID`
 * ----------------------------------------------------------------------------
 * `orders.ts` requires the CALLER to mint a `QueueBuildOrder`'s instance id, and warns
 * that a duplicate is a thrown `RangeError`, not a typed rejection — so the id scheme
 * must be collision-proof, not merely "usually fine". `buildOrderId` uses
 * `${structureTypeId}@${x}:${y}` — a pure function of the order's own content, with no
 * clock, counter or randomness anywhere in this module (matching the sim's own
 * determinism discipline, even though an id string is never replayed through a golden
 * trace). This is PROVABLY collision-free, not just probably: `catalog.ts` requires
 * every footprint to include its own anchor offset `(0, 0)`, so two structures whose
 * footprints are both still standing can never share an anchor tile — the anchor tile
 * itself is always occupied by whichever was placed there first. So the only way a NEW
 * `queue-build` order at `(x, y)` for `structureTypeId` can succeed at all is if no
 * SURVIVING queue entry already occupies `(x, y)` — which means no surviving entry can
 * carry this exact id already. A cancelled project's id is removed from the queue
 * before this scheme could ever reuse it, so re-queuing the same type at a since-freed
 * anchor is safe too. `tests/unit/build-view.test.ts` pins this reasoning directly.
 */

import type { StructureCatalog, StructureType } from '../../../sim/catalog'
import { listStructureTypes } from '../../../sim/catalog'
import { DRONE_HULL_ID, REACTOR_HULL_ID } from '../../../sim/colony-start'
import { turnsCompletedFor } from '../../../sim/construction'
import type { Coord } from '../../../sim/grid'
import type {
  CancelBuildFailure,
  CancelBuildOrder,
  OrderOutcome,
  QueueBuildFailure,
  QueueBuildOrder,
} from '../../../sim/orders'
import { electricityWh } from '../../../sim/power'
import type { RunningState } from '../../state/game-state'

// ---------------------------------------------------------------------------
// The build tray
// ---------------------------------------------------------------------------

/** One line of the bill of materials, in menu order (the catalog's own field order). */
export interface BuildCostLine {
  readonly resource: string
  readonly amount: number
}

/** Everything the build tray shows for one buildable structure. */
export interface BuildMenuEntry {
  readonly structureType: StructureType
  readonly id: string
  readonly name: string
  /** Tiles the footprint occupies — "how big is this on the ground". */
  readonly footprintTiles: number
  readonly buildTurns: number
  /** Rated operating draw, in watt-hours per turn. `0` for a structure that draws nothing. */
  readonly powerDrawWh: number
  /** Empty for a structure that costs nothing in materials to build (the common MVP case). */
  readonly buildCost: readonly BuildCostLine[]
}

/**
 * The whole build tray, in the catalog's own declaration order — never sorted, never
 * grouped through a `Map`/`Set` whose iteration order is not a documented contract.
 */
export function buildMenu(catalog: StructureCatalog): readonly BuildMenuEntry[] {
  return listStructureTypes(catalog).map((structureType) => ({
    structureType,
    id: structureType.id,
    name: structureType.name,
    footprintTiles: structureType.footprint.length,
    buildTurns: structureType.buildTurns,
    powerDrawWh: electricityWh(structureType.consumes),
    buildCost: Object.entries(structureType.buildCost).map(([resource, amount]) => ({
      resource,
      amount,
    })),
  }))
}

// ---------------------------------------------------------------------------
// Placement — one order, one deterministic id
// ---------------------------------------------------------------------------

/**
 * The instance id a `queue-build` order for `structureTypeId` anchored at `anchor` gets.
 * See the module header for why this scheme can never collide with a surviving queue
 * entry.
 */
export function buildOrderId(structureTypeId: string, anchor: Coord): string {
  return `${structureTypeId}@${String(anchor.x)}:${String(anchor.y)}`
}

/** Build the one `PlayerOrder` a placement click issues. */
export function queueBuildOrder(structureType: StructureType, anchor: Coord): QueueBuildOrder {
  return {
    kind: 'queue-build',
    id: buildOrderId(structureType.id, anchor),
    structureType,
    anchor,
  }
}

/** Build the one `PlayerOrder` a cancel click issues. */
export function cancelBuildOrder(id: string): CancelBuildOrder {
  return { kind: 'cancel-build', id }
}

// ---------------------------------------------------------------------------
// Placement geometry — one clickable tile per grid cell, over the SAME canvas the
// survey screen already draws (`TerrainCanvas`), reusing its idiom rather than
// inventing a second one: an absolutely-positioned control, sized and positioned from
// tile coordinates and the tile size ALONE, never from a measured element. See
// `candidate-sites.ts`'s `candidateMarkerBox` for the identical constraint and why.
// ---------------------------------------------------------------------------

/** The acceptance contract's testid for the placement anchor at `(x, y)`. */
export function buildAnchorTestId(anchor: Coord): string {
  return `build-anchor-${String(anchor.x)}-${String(anchor.y)}`
}

/** One tile's absolute box within the rendered map, in device pixels. */
export interface AnchorBox {
  readonly left: number
  readonly top: number
  readonly size: number
}

/**
 * Where tile `anchor`'s placement control sits over a map drawn at `tileSize` device
 * pixels per tile. Unlike a survey candidate marker, this box is exactly one tile with
 * no touch-margin inflation: adjacent placement tiles must sit edge to edge with no
 * gap and no overlap, covering the whole grid the sim will validate a placement against.
 */
export function anchorBox(anchor: Coord, tileSize: number): AnchorBox {
  return { left: anchor.x * tileSize, top: anchor.y * tileSize, size: tileSize }
}

// ---------------------------------------------------------------------------
// The build queue
// ---------------------------------------------------------------------------

/** Instance ids of the two landed hulls — never buildable, so never shown as a "build". */
const NON_BUILDABLE_IDS: ReadonlySet<string> = new Set([DRONE_HULL_ID, REACTOR_HULL_ID])

/** Everything the build queue panel shows for one queued (or completed) structure. */
export interface QueueEntryView {
  readonly id: string
  readonly name: string
  readonly buildTurns: number
  readonly turnsCompleted: number
  /** `0` once complete. See the module header for why this is a subtraction, not a sim field. */
  readonly turnsRemaining: number
  readonly complete: boolean
}

/**
 * The player's build queue: every structure instance except the two landed hulls, in
 * queue order (the order the player queued them in — `construction.ts`'s own priority
 * rule), oldest first.
 */
export function buildQueue(state: RunningState): readonly QueueEntryView[] {
  const config = state.colony.mission.turnCycle

  return state.colony.queue
    .filter((project) => !NON_BUILDABLE_IDS.has(project.structureType.id))
    .map((project) => {
      const turnsCompleted = turnsCompletedFor(config, project)
      const { buildTurns } = project.structureType
      return {
        id: project.id,
        name: project.structureType.name,
        buildTurns,
        turnsCompleted,
        turnsRemaining: Math.max(0, buildTurns - turnsCompleted),
        complete: turnsCompleted >= buildTurns,
      }
    })
}

// ---------------------------------------------------------------------------
// Order outcomes, in plain language — FR-006, verbatim typed reason alongside it
// ---------------------------------------------------------------------------

/** One order outcome, ready to render: the sim's own code, and a readable sentence. */
export interface OrderOutcomeReadout {
  readonly ok: boolean
  /** The sim's own typed reason verbatim (FR-006), or `null` for a success. */
  readonly code: string | null
  readonly message: string
}

/**
 * Narrows a failed `OrderOutcome` to `QueueBuildFailure` by its order's own `kind`.
 *
 * A user-defined type predicate, not a plain `if`, because TypeScript's discriminated-
 * union narrowing does not follow a NESTED discriminant (`outcome.order.kind`) back up
 * to the outer `OrderOutcome` union on its own — `outcome.rejection`'s type would
 * otherwise stay the full `PlacementRejection | UnknownProjectRejection` inside the
 * branch below. Asserting the correlation once, here, is more honest than an `as` cast
 * at every call site.
 */
function isQueueBuildFailure(outcome: OrderOutcome): outcome is QueueBuildFailure {
  return !outcome.ok && outcome.order.kind === 'queue-build'
}

/** See {@link isQueueBuildFailure}. The other half of the same correlation. */
function isCancelBuildFailure(outcome: OrderOutcome): outcome is CancelBuildFailure {
  return !outcome.ok && outcome.order.kind === 'cancel-build'
}

/**
 * Translate one `OrderOutcome` into something a player can read, without softening or
 * replacing the sim's own typed reason — it is carried alongside the sentence, in
 * `code`, exactly as `SurveyScreen`'s `Refusal` carries `LandingRejection.reason`
 * verbatim next to its own prose.
 */
export function orderOutcomeReadout(outcome: OrderOutcome): OrderOutcomeReadout {
  if (outcome.ok) {
    if (outcome.order.kind === 'queue-build') {
      const { anchor, structureType } = outcome.order
      return {
        ok: true,
        code: null,
        message: `Queued ${structureType.name} at (${String(anchor.x)}, ${String(anchor.y)}).`,
      }
    }
    return { ok: true, code: null, message: `Cancelled build "${outcome.order.id}".` }
  }

  if (isQueueBuildFailure(outcome)) {
    const { rejection } = outcome
    if (rejection.reason === 'out-of-bounds') {
      return {
        ok: false,
        code: rejection.reason,
        message:
          `Part of that footprint is off the map, at ` +
          `(${String(rejection.tile.x)}, ${String(rejection.tile.y)}).`,
      }
    }
    return {
      ok: false,
      code: rejection.reason,
      message:
        `That tile is already occupied by "${rejection.occupantId}", at ` +
        `(${String(rejection.tile.x)}, ${String(rejection.tile.y)}).`,
    }
  }

  if (isCancelBuildFailure(outcome)) {
    return {
      ok: false,
      code: outcome.rejection.reason,
      message: `There is no queued build "${outcome.rejection.id}" left to cancel.`,
    }
  }

  // Unreachable: `OrderOutcome` is exactly `OrderSuccess | QueueBuildFailure |
  // CancelBuildFailure`, and every branch above covers one. Kept rather than asserted
  // past, matching this codebase's documented "untestable-as-unreachable" convention
  // (`placement.ts`, `construction.ts`) — an ERROR in `src/`, not a silent `any`.
  throw new Error('orderOutcomeReadout: unreachable order outcome shape')
}

/** The most recent order outcome, or `null` if none has been issued this turn. */
export function lastOrderOutcome(state: RunningState): OrderOutcome | null {
  return state.orderOutcomes.at(-1) ?? null
}
