/**
 * THE BUILD TRAY — what the colony can build, what it costs, and where it may go.
 *
 * ============================================================================
 * WHY THIS EXISTS: THE GAME HAD NO VERBS
 * ----------------------------------------------------------------------------
 * Driving the real UI for 25 consecutive turns produced 25 identical readouts — drones 7 of
 * 33, capacity 0, vented 1,029,776 Wh — while the screen itself reported "175 h with no
 * project to absorb it · completed: nothing" every single cycle. The colony was handed 175
 * robot-hours a turn and had nowhere to spend them, so no decision after the landing site
 * had any effect and the 278-turn budget was a countdown the player watched.
 *
 * Every piece needed already existed and was tested: `catalog-data.ts` authored the three
 * chain-1 structures, `orders.ts` accepted a `queue-build` and debited its bill of
 * materials, and the adapter already routed an `issue-orders` intent. Nothing connected them
 * to a control. This module is that connection's THINKING half; `OpsScreen.tsx` is its
 * layout half.
 *
 * ============================================================================
 * IT ASKS THE SIM EVERY QUESTION. IT ANSWERS NONE OF THEM. (Constitution §4, FR-002)
 * ----------------------------------------------------------------------------
 * Three judgements could plausibly have been made here, and all three are delegated:
 *
 *   - CAN THE COLONY AFFORD THIS? `orders.canAfford`, and the shortfall detail from
 *     `orders.checkAffordability`. NOT a comparison written here against `buildCost`.
 *     `orders.ts` defines `canAfford` AS `checkAffordability(...).ok` precisely so a greyed
 *     button and the sim's refusal cannot drift apart; re-deriving either here would
 *     reintroduce exactly the second opinion that pairing is meant to prevent.
 *   - MAY THIS STRUCTURE STAND ON THIS TILE? `placement.validatePlacement`, per tile, over
 *     the structure's whole footprint. NOT an occupancy check written here. That matters
 *     for more than purity: a footprint is an arbitrary set of offsets, so the interesting
 *     failure is the PARTIAL overlap — anchor free, some other footprint tile taken — which
 *     an anchor-only check invented here would wave through and the sim would then refuse.
 *   - IS THIS PROJECT FINISHED? `construction.isProjectComplete`, which is itself defined in
 *     terms of `mission.isStructureComplete`. NOT an `accumulatedLabourHours` comparison.
 *
 * What this module genuinely owns is WORDING and IDENTITY: turning the sim's typed answers
 * into strings a player can act on, and minting a project id. Nothing below changes what the
 * simulation would do.
 *
 * ============================================================================
 * THE PROJECT ID IS DERIVED FROM THE ANCHOR, AND THAT IS A CORRECTNESS CHOICE
 * ----------------------------------------------------------------------------
 * `orders.ts` requires a caller-chosen instance id and THROWS a `RangeError` on a duplicate
 * — deliberately, because ids are minted by the calling layer, so a collision is a defect in
 * the id generator rather than player input. A throw here is an uncaught exception in a
 * click handler and a blank page, so the generator has to be right rather than lucky.
 *
 * It must also add no nondeterminism: spec 005's ★AC-4.3 requires the same seed, landing and
 * orders to render an identical turn 1, so `Math.random` and `Date.now` are both unavailable
 * to it — the same rule that governs the adapter and `src/app/seed.ts`.
 *
 * The obvious deterministic scheme is an ORDINAL — count the projects of this type and add
 * one — and it is broken. Queue two hoppers (`hopper-1`, `hopper-2`), cancel the first, and
 * the count is 1 again, so the next mint is `hopper-2`: a duplicate, and a thrown RangeError
 * on an ordinary sequence of player actions.
 *
 * `${structureType.id}-${x}-${y}` cannot collide, and the reason is a property of the sim
 * rather than a convention: `catalog.ts` requires every footprint to include its anchor
 * `(0, 0)`, so a queued project always OCCUPIES its own anchor tile, and `queueConstruction`
 * refuses to place anything on an occupied tile. Two live projects therefore can never share
 * an anchor. Cancelling frees both the tile and the id together, so re-queueing on a
 * released tile is safe by the same argument.
 *
 * ============================================================================
 * WHY A `.ts` MODULE RATHER THAN LOGIC INSIDE THE COMPONENT
 * ----------------------------------------------------------------------------
 * `vitest.config.ts` excludes `src/app/**\/*.tsx` from the coverage gate and pointedly does
 * NOT exclude pure `.ts` under `src/app/` — the same reason `ops-view.ts` and `ops-panels.ts`
 * exist. Everything here is a pure function of its arguments: no clock, no randomness, no
 * locale, no DOM. Digit grouping comes from `ops-view.ts`'s `groupDigits` for the reason its
 * docblock gives.
 */

import type { ConstructionQueue } from '../../../sim/construction'
import { isProjectComplete } from '../../../sim/construction'
import { createCatalog, listStructureTypes } from '../../../sim/catalog'
import type { StructureCatalog, StructureType } from '../../../sim/catalog'
import { chainOneStructureSpecs } from '../../../sim/catalog-data'
import type { Coord, Grid } from '../../../sim/grid'
import type { Stockpile } from '../../../sim/ledger'
import { canAfford, checkAffordability } from '../../../sim/orders'
import type { OrderOutcome, QueueBuildOrder } from '../../../sim/orders'
import { validatePlacement } from '../../../sim/placement'
import { ELECTRICITY } from '../../../sim/power'
import type { TurnCycleConfig } from '../../../sim/time'
import { groupDigits } from './ops-view'

// ---------------------------------------------------------------------------
// The menu itself
// ---------------------------------------------------------------------------

/**
 * The structures the player may build, validated.
 *
 * `chainOneStructureSpecs` returns RAW specs and this runs them through `createCatalog`,
 * which is the project's one validation boundary — `catalog-data.ts`'s own docblock is
 * explicit that returning a pre-built catalog from there would either duplicate that
 * boundary or hide it, and that a caller assembling a full build menu needs to concatenate
 * chains before validating anything. This is that caller. When chain 2 lands, it is
 * concatenated HERE, and nothing else in this module changes.
 *
 * `config` is threaded rather than defaulted because a structure's PHYSICAL fact is its draw
 * in watts, while `consumes.electricity` is watt-hours per TURN — so every figure in the
 * menu is a function of how long a turn is. Reading a default cycle here would silently
 * misprice the whole menu for a scenario running a different one.
 *
 * @throws {RangeError} if the authored catalog data is malformed — `createCatalog`'s own
 *   loud-and-early convention, propagated unchanged. Catalog content is authored, not player
 *   input, so this is a build-time defect and must not be softened into a rendered menu with
 *   a structure quietly missing from it.
 */
export function buildCatalog(config: TurnCycleConfig): StructureCatalog {
  return createCatalog(chainOneStructureSpecs(config))
}

/** One shortfall line, already worded for a player. See {@link BuildOption.shortfall}. */
export interface ShortfallLine {
  readonly resource: string
  /** e.g. `"needs 450,000,000 g regolith, holds 0"`. */
  readonly text: string
}

/** One option in the tray: a structure, its price, and whether it can be paid for. */
export interface BuildOption {
  /** The catalog id, e.g. `regolith-hopper`. */
  readonly id: string
  /** The acceptance contract's testid: `build-option-<catalog id>`. */
  readonly testId: string
  /** `catalog.ts`'s validated display name. Never derived from the id. */
  readonly name: string
  /** Carried so a click can build an order without a second catalog lookup. */
  readonly structureType: StructureType
  /** e.g. `"2 turns of drone work"`, or the material-gated case. */
  readonly labourLabel: string
  /** e.g. `"595,917 Wh/turn"`, or `"draws nothing"`. */
  readonly drawLabel: string
  /** e.g. `"free to build"` or `"450,000,000 g regolith · 11,000,000 g sinteredPlate"`. */
  readonly costLabel: string
  /** `orders.canAfford`, verbatim. The tray's `disabled` attribute IS this field. */
  readonly affordable: boolean
  /**
   * Why it cannot be paid for, or `[]` when it can.
   *
   * Sourced from `checkAffordability`'s structured `shortfalls`, never from prose. "Cannot
   * afford" tells a player nothing they can act on; "needs 450,000,000 g regolith, holds 0"
   * tells them exactly what to go mine. `orders.ts` carries all four figures for precisely
   * this reason, so a readout never has to parse a sentence back into numbers.
   */
  readonly shortfall: readonly ShortfallLine[]
}

/**
 * A resource amount as the player reads it: `"450,000,000 g"`, `"595,917 Wh"`.
 *
 * Grams for mass and watt-hours for energy are the sim's base units END TO END (see
 * `catalog.ts`'s base-units block). Converting to tonnes or kWh would mean dividing a sim
 * figure inside the app layer, which is the arithmetic this whole layer is built not to do —
 * and it would put a rounding decision between the bill the player reads and the bill
 * `applyOrders` actually charges.
 */
export function formatAmount(resource: string, amount: number): string {
  return `${groupDigits(amount)} ${resource === ELECTRICITY ? 'Wh' : 'g'}`
}

/** `"450,000,000 g regolith · 11,000,000 g sinteredPlate"`, or `"free to build"`. */
function costLabelFor(structureType: StructureType): string {
  const entries = Object.entries(structureType.buildCost)
  // A line item of exactly `0` is free and `catalog.ts` promises it behaves identically to
  // omitting the key, so it must not produce a "0 g" line the player would read as a price.
  const priced = entries.filter(([, amount]) => amount > 0)
  if (priced.length === 0) return 'free to build'
  // Sorted by resource name, matching `checkAffordability`'s own sort, so the bill and the
  // shortfall beneath it list their resources in the same order.
  return priced
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([resource, amount]) => `${formatAmount(resource, amount)} ${resource}`)
    .join(' · ')
}

/** `"2 turns of drone work"`, or the berm's material-gated case. */
function labourLabelFor(structureType: StructureType): string {
  // `catalog.ts`: `buildTurns: 0` means "needs no drone-hours". For the Shield Berm that is
  // the whole design — it is MATERIAL-gated, not labour-gated — so saying "0 turns" would
  // read as "instant" when the truth is the opposite.
  if (structureType.buildTurns === 0) return 'no drone work — material-gated'
  const plural = structureType.buildTurns === 1 ? 'turn' : 'turns'
  return `${groupDigits(structureType.buildTurns)} ${plural} of drone work`
}

/** `"595,917 Wh/turn"`, or `"draws nothing"`. */
function drawLabelFor(structureType: StructureType): string {
  const draw = structureType.consumes[ELECTRICITY] ?? 0
  if (draw === 0) return 'draws nothing'
  return `${groupDigits(draw)} Wh/turn`
}

/**
 * Every option the tray offers, in the catalog's own declaration order.
 *
 * ORDER IS THE CATALOG'S, never sorted here. `catalog.ts` backs the registry with a Map
 * built in declaration order specifically so iteration is deterministic, and
 * `catalog-data.ts` authors chain 1 "in menu order: Hopper, Press, Berm". Re-sorting would
 * discard an ordering the data already decided, and it is the order the acceptance suite
 * indexes positionally.
 *
 * Safe to call on every render: `canAfford` and `checkAffordability` are documented as pure,
 * order-free and side-effect-free for exactly this use.
 */
export function buildOptions(
  catalog: StructureCatalog,
  stockpiles: Stockpile,
): readonly BuildOption[] {
  return listStructureTypes(catalog).map((structureType) => {
    const affordability = checkAffordability(stockpiles, structureType)
    return {
      id: structureType.id,
      testId: `build-option-${structureType.id}`,
      name: structureType.name,
      structureType,
      labourLabel: labourLabelFor(structureType),
      drawLabel: drawLabelFor(structureType),
      costLabel: costLabelFor(structureType),
      // The sim's own predicate, not `affordability.ok` re-read — see the module header on
      // why the tray must not grow a second opinion about the same question.
      affordable: canAfford(stockpiles, structureType),
      shortfall: affordability.ok
        ? []
        : affordability.shortfalls.map((entry) => ({
            resource: entry.resource,
            text:
              `needs ${formatAmount(entry.resource, entry.required)} ${entry.resource}, ` +
              `holds ${groupDigits(entry.available)}`,
          })),
    }
  })
}

/** The option the player has armed, or `null`. A lookup, so the layout never scans a list. */
export function selectedOption(
  options: readonly BuildOption[],
  selectedId: string | null,
): BuildOption | null {
  if (selectedId === null) return null
  return options.find((option) => option.id === selectedId) ?? null
}

// ---------------------------------------------------------------------------
// Where it may stand
// ---------------------------------------------------------------------------

/** One tile the player may aim at, and the sim's verdict on putting THIS structure there. */
export interface PlacementTarget {
  readonly x: number
  readonly y: number
  /** The acceptance contract's testid: `build-target-<x>-<y>`. */
  readonly testId: string
  /** `validatePlacement(...).ok`, verbatim. The tile button's `disabled` IS `!legal`. */
  readonly legal: boolean
  /**
   * The sim's own rejection discriminant (`out-of-bounds` / `occupied`), or `null` when the
   * placement is legal. Carried through UNTOUCHED, never re-worded: FR-006 requires illegal
   * actions to surface the sim's typed reason rather than a generic message.
   */
  readonly reason: string | null
}

/**
 * The sim's verdict on anchoring `structureType` at every tile of `grid`, row-major.
 *
 * WHY EVERY TILE, INCLUDING THE ILLEGAL ONES. An unbuildable tile is offered as a DISABLED
 * target rather than omitted, because "an inert control that explains itself beats a live one
 * that does nothing" — and because an omitted tile is indistinguishable from a tile the tray
 * forgot about. The player can see the shape of what is blocked.
 *
 * ROW-MAJOR, matching the sim's own tile storage order, so the DOM order of the targets and
 * the sim's tile order are one sequence — the same contract `candidate-sites.ts` keeps for
 * the survey screen's markers.
 *
 * Every verdict is `validatePlacement`'s, which walks the structure's WHOLE footprint rather
 * than its anchor. See the module header on why the partial-overlap case makes that the
 * difference between a tray that agrees with the sim and one that argues with it.
 */
export function placementTargets(
  grid: Grid,
  structureType: StructureType,
): readonly PlacementTarget[] {
  const targets: PlacementTarget[] = []
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const verdict = validatePlacement(grid, structureType, { x, y })
      targets.push({
        x,
        y,
        testId: `build-target-${String(x)}-${String(y)}`,
        legal: verdict.ok,
        reason: verdict.ok ? null : verdict.reason,
      })
    }
  }
  return targets
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

/**
 * The `queue-build` order for putting `structureType` at `anchor`, id and all.
 *
 * The id is `${structureType.id}-${x}-${y}` and cannot collide with a live project — see the
 * module header for the argument, which rests on `catalog.ts`'s anchor-in-footprint rule
 * rather than on a convention this module could forget.
 *
 * Pure and deterministic: no clock, no randomness. ★AC-4.3 requires the same seed, landing
 * and orders to render an identical turn 1, and an id minted from a timestamp would put the
 * wall clock into the game's state.
 */
export function queueBuildOrder(structureType: StructureType, anchor: Coord): QueueBuildOrder {
  return {
    kind: 'queue-build',
    id: `${structureType.id}-${String(anchor.x)}-${String(anchor.y)}`,
    structureType,
    anchor,
  }
}

/**
 * How many queued projects are not yet finished.
 *
 * `isProjectComplete` is the sim's predicate, defined in terms of `mission.isStructureComplete`
 * — the project's single completion rule (aic-zw6). Counting `accumulatedLabourHours` against
 * a requirement here would be a second, drifting copy of it.
 */
export function underConstructionCount(
  config: TurnCycleConfig,
  queue: ConstructionQueue,
): number {
  return queue.filter((project) => !isProjectComplete(config, project)).length
}

// ---------------------------------------------------------------------------
// What the colony holds
// ---------------------------------------------------------------------------

/** One material the build menu deals in, and what the colony currently holds of it. */
export interface StockpileReadout {
  readonly resource: string
  /** The acceptance contract's testid: `stockpile-<resource>`. */
  readonly testId: string
  /** Base units, from `ColonyState.stockpiles`. Absent means `0` — the colony holds what it holds. */
  readonly amount: number
  /** `"0 g"`, `"60,000,000 g"`. See {@link formatAmount}. */
  readonly text: string
}

/**
 * Every material the build menu is priced and paid in, with the colony's balance.
 *
 * THE RESOURCE LIST COMES FROM THE CATALOG, NOT FROM THE STOCKPILE. A colony that has never
 * mined anything has an EMPTY `stockpiles` object, so deriving the list from its keys would
 * show the player nothing at all on turn 1 — precisely when they are deciding what to build
 * and most need to know that regolith is the thing the Shield Berm is priced in and that
 * they have none. The materials a menu deals in are a property of the menu.
 *
 * A resource absent from `stockpiles` reads as `0`, never as unknown — the same rule
 * `checkAffordability` applies, so the balance shown and the balance charged agree.
 *
 * Sorted by resource name, matching `checkAffordability`'s and `ledger.ts`'s convention, so
 * the readout never depends on catalog authoring order.
 */
export function stockpileReadouts(
  catalog: StructureCatalog,
  stockpiles: Stockpile,
): readonly StockpileReadout[] {
  const resources = new Set<string>()
  for (const structureType of listStructureTypes(catalog)) {
    // Priced in it, or produces it: both make it a material the player is managing.
    // Electricity is deliberately excluded — under the no-storage ruling it is vented every
    // turn rather than stockpiled, and `ops-panels.ts` already reports it as vented energy.
    for (const resource of Object.keys(structureType.buildCost)) resources.add(resource)
    for (const resource of Object.keys(structureType.produces)) resources.add(resource)
  }
  resources.delete(ELECTRICITY)

  // Sorted into a plain array before mapping: a Set's iteration order is insertion order,
  // which would make this output depend on catalog authoring order. `orders.ts`'s header
  // forbids Map/Set iteration order from reaching any output, and the same discipline
  // applies on this side of the boundary.
  return [...resources]
    .sort((a, b) => (a < b ? -1 : 1))
    .map((resource) => {
      const amount = stockpiles[resource] ?? 0
      return {
        resource,
        testId: `stockpile-${resource}`,
        amount,
        text: formatAmount(resource, amount),
      }
    })
}

// ---------------------------------------------------------------------------
// When the sim says no
// ---------------------------------------------------------------------------

/**
 * The sim's reason for refusing the most recent batch of orders, or `null` if it refused none.
 *
 * CARRIES THE SIM'S OWN DISCRIMINANT VERBATIM (`out-of-bounds`, `occupied`, `unaffordable`,
 * `unknown-project`) rather than a friendly paraphrase, because FR-006 requires exactly that:
 * "illegal actions MUST surface the sim's typed rejection reason verbatim, not a generic
 * message". The prose around it is context, and the discriminant is the payload.
 *
 * Reports the FIRST refusal rather than all of them. The tray commits one order per click, so
 * a batch cannot carry two; reporting a list would be a shape nothing can currently produce,
 * and an unreachable branch is a line nobody can prove correct.
 */
export function rejectionText(outcomes: readonly OrderOutcome[]): string | null {
  // TypeScript infers a type predicate from this arrow, so `refused` narrows to the two
  // failure shapes on its own — a second `refused.ok` guard here is provably dead code and
  // the linter says so.
  const refused = outcomes.find((outcome) => !outcome.ok)
  if (refused === undefined) return null

  const { rejection } = refused
  if (rejection.reason === 'unaffordable') {
    const shortfalls = rejection.shortfalls
      .map((entry) => `${formatAmount(entry.resource, entry.short)} ${entry.resource} short`)
      .join(', ')
    return `Refused — unaffordable: ${shortfalls}`
  }
  if (rejection.reason === 'unknown-project') {
    return `Refused — unknown-project: ${rejection.id}`
  }
  // `out-of-bounds` / `occupied`, both of which carry the offending tile.
  const { tile } = rejection
  const where = `at ${String(tile.x)}, ${String(tile.y)}`
  if (rejection.reason === 'occupied') {
    return `Refused — occupied ${where} by ${rejection.occupantId}`
  }
  return `Refused — out-of-bounds ${where}`
}
