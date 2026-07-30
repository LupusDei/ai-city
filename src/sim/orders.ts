/**
 * Player orders — the input side of the game loop (spec 005 T003).
 *
 * A player affects the colony in exactly one way: by issuing orders. Today that means
 * "queue a build here" and "cancel that build" — this module models both as typed data
 * (`PlayerOrder`) and provides the single function, `applyOrders`, that turns a batch of
 * them into a new state plus one outcome per order.
 *
 * ===========================================================================
 * WHY ORDERS ARE STEP 1 OF THE TURN, NEVER STEP 11
 * ===========================================================================
 * An order the player issues for turn N — "build a habitat here", "cancel that hopper"
 * — must take effect IN turn N. If orders were applied AFTER the rest of resolution,
 * the player would see their instruction take hold one turn later than the UI implied:
 * they click "build", the turn plays out as though they hadn't, and only the NEXT
 * turn's report shows the queue changed. That is not a cosmetic delay, it is a silent
 * one-turn desync between what the player asked for and what the game did — exactly the
 * class of bug a single-turn unit test cannot see (it only shows up as "my order landed
 * on the wrong turn" across a multi-turn trace, which is why
 * `tests/integration/orders-turn-seam.test.ts` asserts it directly rather than trusting
 * this module's own unit tests to imply it).
 *
 * Concretely: this module's output is `turn.ts`'s turn-resolution function's INPUT,
 * never the reverse —
 *
 *     const { state: ordered, outcomes } = applyOrders(state, orders)
 *     const { state: next, report } = resolveOneTurn(ordered)   // src/sim/turn.ts
 *
 * — so a queued build is already sitting in `state.queue`, occupying its footprint on
 * `state.grid`, before `resolveTurn` ever freezes the operational set (spec 005's step
 * 2). `resolveTurn` itself does not take an `orders` parameter and is not changed by
 * this module at all; see its header for the matching half of this contract.
 *
 * ===========================================================================
 * WHY THIS MODULE DOES NOT IMPORT `ColonyState`
 * ===========================================================================
 * `turn.ts`'s `ColonyState` is the project's canonical aggregate, and it is a moving
 * target by design — it has already grown fields (`droneRoster`, `stockpiles`,
 * `offlineStructureIds`, ...) as sibling epics landed, and a player order only ever
 * touches two of them: `grid` and `queue`. Importing the full `ColonyState` type here
 * would create a dependency this module does not need and cannot control the timing
 * of — every unrelated field `ColonyState` gains would be a silent opportunity for this
 * module's signature to drift out of sync with a type it was built against in a
 * different worktree.
 *
 * Instead, `applyOrders` is GENERIC over the minimal structural shape it actually
 * needs, `OrderableColonyState` — the same inverted-dependency pattern `landing.ts`
 * uses for its injected `BuildabilityScorer`: depend on the shape, not the concrete
 * type owned by a module built concurrently elsewhere. Because `ColonyState` already
 * has exactly a `grid: Grid` and a `queue: ConstructionQueue` field, ANY `ColonyState`
 * value satisfies `OrderableColonyState` structurally, with no adapter needed — and
 * because `applyOrders` is generic (`<S extends OrderableColonyState>`), calling it
 * with a real `ColonyState` returns a real `ColonyState` back, every field the caller
 * didn't ask this module to touch carried through unchanged. See the module's WIRING
 * note at the bottom for exactly what a caller needs to do to connect the two today.
 *
 * ===========================================================================
 * THROW VS. TYPED REJECTION — WHERE THE LINE IS, AND WHY IT MOVES AT THIS SEAM
 * ===========================================================================
 * Mirrors `placement.ts`'s and `catalog.ts`'s convention: an ORDINARY outcome of player
 * action is a typed rejection, never a thrown error; a violation of a caller's own
 * internal contract is a thrown error, because throwing for it would just as often be
 * useless — the "caller" that violated the contract is this codebase, not the player.
 *
 * Two decisions below apply that rule in the two directions it can point at THIS seam,
 * and they are NOT symmetric:
 *
 *   - Cancelling an unknown project id is a TYPED REJECTION here, even though
 *     `construction.ts`'s `cancelProject` THROWS for the identical input. That is not a
 *     contradiction: `construction.ts` documents its throw as correct for ITS caller
 *     contract ("a well-behaved caller only ever cancels an id it already knows is
 *     queued"). But THIS module's caller contract is different — a player's cancel
 *     button click is unchecked input arriving from a UI that can legitimately be
 *     stale (the build finished, or was cancelled by a different order in the same
 *     batch, one line above this one, a moment before). A stale click is ordinary
 *     gameplay, not a programmer bug, so this module checks existence itself BEFORE
 *     calling `cancelProject`, and never lets that throw reach a caller.
 *
 *   - A DUPLICATE project id on a queue-build order is left to THROW, via
 *     `enqueueProject`'s existing `RangeError`. Instance ids are assigned by the
 *     CALLING layer (the game engine minting a fresh id per new structure), never
 *     typed or chosen by the player directly, so a collision is a caller/id-generator
 *     bug — exactly the category `construction.ts` already puts it in, and inventing a
 *     second, player-facing vocabulary for the same defect would just teach two
 *     different lessons about the identical mistake.
 *
 * ===========================================================================
 * DETERMINISM
 * ===========================================================================
 * Orders are applied by a single `for...of` over the input array, in that array's
 * order — never sorted, never grouped through a `Map`/`Set` whose iteration order
 * could differ from insertion order in some future refactor (a `Set` is used below
 * only for nothing — this module doesn't need one; see `construction.ts` and
 * `brownout.ts` for the project's established idiom where one IS needed). The
 * player's own ordering of a batch — e.g. queue an id, cancel that SAME id two lines
 * later — is therefore honoured literally, and is exactly what the "queue then cancel
 * in one batch" test below pins.
 *
 * No `Math.random`, `Date.now`, or `new Date` anywhere in this module: every rejection
 * and every state transition is a pure function of `state` and `orders`.
 *
 * ===========================================================================
 * WIRING STILL REQUIRED (do not assume this is connected — it is not)
 * ===========================================================================
 * `applyOrders` has ZERO production callers as of this module landing. Nothing in
 * `src/sim` invokes it, and nothing yet defines where a batch of `PlayerOrder`s comes
 * from (a UI, a test harness, an AI opponent). The composition root that spec 005's
 * T007 builds (`src/sim/resolve.ts`, per `specs/005-core-loop-connectors/tasks.md`) is
 * expected to be the FIRST production caller: it should call
 * `applyOrders(state, orders)` as its literal step 1, thread `outcomes` into whatever
 * it reports back to the caller (alongside `resolveTurn`'s own `CycleReport`), and pass
 * `result.state` — which, called with a real `ColonyState`, IS a real `ColonyState` —
 * straight into `resolveTurn`. No adapter function is needed for that hookup; the
 * generic signature is what makes that true. What IS still needed, and does not exist
 * anywhere yet:
 *
 *   1. A `PlayerOrder[]` SOURCE — nothing produces these today (no UI, no CLI, no test
 *      harness helper). `createColony`'s tests and the golden trace both currently
 *      build a `ColonyState.queue` directly, bypassing orders entirely.
 *   2. The actual call site inside `src/sim/resolve.ts` (T007, not yet built) or
 *      wherever the composition root ends up living.
 *   3. `tests/integration/orders-turn-seam.test.ts` (added alongside this module)
 *      proves the `applyOrders` -> `resolveTurn` handoff is correct TODAY, but it is a
 *      test calling both functions directly — it is not a substitute for #2.
 */

import type { Coord, Grid } from './grid'
import type { StructureType } from './catalog'
import type { ConstructionQueue } from './construction'
import { cancelProject, enqueueProject, queueConstruction, releaseTiles } from './construction'
import type { PlacementRejection } from './placement'

// ---------------------------------------------------------------------------
// The minimal structural shape this module needs — see the module header's
// "WHY THIS MODULE DOES NOT IMPORT ColonyState" section.
// ---------------------------------------------------------------------------

/**
 * The minimal slice of a colony's state that applying orders can read or change.
 *
 * Deliberately NOT `ColonyState` (see module header). Any type with at least these two
 * fields — in particular, the real `ColonyState` in `turn.ts` — satisfies this
 * structurally, with no cast or adapter required at the call site.
 */
export interface OrderableColonyState {
  readonly grid: Grid
  readonly queue: ConstructionQueue
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Queue a new construction project at `anchor`, sited by `structureType`'s footprint. */
export interface QueueBuildOrder {
  readonly kind: 'queue-build'
  /**
   * The new project's instance id, chosen by the CALLER (e.g. a game-engine id
   * generator) — never player-typed. See the module header's throw-vs-reject note for
   * why a duplicate here throws rather than rejecting.
   */
  readonly id: string
  readonly structureType: StructureType
  readonly anchor: Coord
}

/** Cancel an existing, in-progress-or-complete construction project by id. */
export interface CancelBuildOrder {
  readonly kind: 'cancel-build'
  readonly id: string
}

/** Every kind of order a player can issue. Extend this union as new intents are added. */
export type PlayerOrder = QueueBuildOrder | CancelBuildOrder

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** An order that succeeded, echoing the order it applied so a caller can correlate. */
export interface OrderSuccess {
  readonly ok: true
  readonly order: PlayerOrder
}

/**
 * A `queue-build` order rejected for an ordinary, player-facing reason.
 *
 * Reuses `placement.ts`'s `PlacementRejection` verbatim rather than inventing a
 * parallel vocabulary: from a caller's point of view, "this anchor is out of bounds /
 * already occupied" is the identical situation whether it surfaces from validating a
 * placement directly or from queueing a build order over one.
 */
export interface QueueBuildFailure {
  readonly ok: false
  readonly order: QueueBuildOrder
  readonly rejection: PlacementRejection
}

/** A `cancel-build` order whose target project id is not (or no longer) in the queue. */
export interface UnknownProjectRejection {
  readonly ok: false
  readonly reason: 'unknown-project'
  readonly id: string
}

/** A `cancel-build` order rejected because its target project does not exist. */
export interface CancelBuildFailure {
  readonly ok: false
  readonly order: CancelBuildOrder
  readonly rejection: UnknownProjectRejection
}

/** The result of applying exactly one order — success, or a typed, order-specific rejection. */
export type OrderOutcome = OrderSuccess | QueueBuildFailure | CancelBuildFailure

/** The result of applying a whole batch: the new state, and one outcome per input order. */
export interface OrdersApplyResult<S extends OrderableColonyState> {
  /** `state.grid`/`state.queue` folded through every order's effect, in array order. */
  readonly state: S
  /**
   * Exactly one entry per element of the input `orders` array, in the SAME order, so a
   * caller can zip `orders[i]` with `outcomes[i]` without re-deriving which order an
   * outcome belongs to.
   */
  readonly outcomes: readonly OrderOutcome[]
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * Apply a batch of player orders to `state`, in array order, returning the resulting
 * state and one outcome per order.
 *
 * Never mutates `state` (or its `grid`/`queue`): every step below either carries the
 * previous `grid`/`queue` value forward unchanged or replaces it with a fresh value
 * returned by `construction.ts`'s own (already-immutable) functions. An order that is
 * rejected contributes NO partial effect — not a partially-occupied footprint, not a
 * half-removed queue entry — because `queueConstruction` itself only ever returns a new
 * grid on FULL success (see `placement.ts`), and a rejected `cancel-build` never calls
 * `cancelProject`/`releaseTiles` at all.
 *
 * An empty `orders` array is a true no-op: `state` itself (not a copy) is returned, so
 * a caller can rely on referential equality to skip downstream work when nothing was
 * ordered.
 *
 * @throws {RangeError} if a `queue-build` order's `id` is already present in `state`'s
 *   queue, OR is an empty string — both are `construction.ts`'s own programmer-error
 *   convention (`enqueueProject`'s duplicate check, `createProject`'s non-empty check),
 *   deliberately not converted into a typed rejection here. See the module header's
 *   throw-vs-reject section for why. An unknown `cancel-build` target, by contrast,
 *   NEVER throws — see `CancelBuildFailure`.
 */
export function applyOrders<S extends OrderableColonyState>(
  state: S,
  orders: readonly PlayerOrder[],
): OrdersApplyResult<S> {
  if (orders.length === 0) {
    return { state, outcomes: [] }
  }

  let grid = state.grid
  let queue = state.queue
  const outcomes: OrderOutcome[] = []

  for (const order of orders) {
    if (order.kind === 'queue-build') {
      const result = queueConstruction(grid, order.id, order.structureType, order.anchor)
      if (result.ok) {
        grid = result.grid
        queue = enqueueProject(queue, result.project)
        outcomes.push({ ok: true, order })
      } else {
        outcomes.push({ ok: false, order, rejection: result })
      }
      continue
    }

    // order.kind === 'cancel-build'. Checked for existence HERE, before calling
    // `cancelProject`, precisely so an unknown id becomes a typed rejection instead of
    // reaching `cancelProject`'s own `RangeError` — see the module header.
    const target = queue.find((project) => project.id === order.id)
    if (target === undefined) {
      outcomes.push({
        ok: false,
        order,
        rejection: { ok: false, reason: 'unknown-project', id: order.id },
      })
      continue
    }

    queue = cancelProject(queue, order.id)
    grid = releaseTiles(grid, target.tiles)
    outcomes.push({ ok: true, order })
  }

  // No cast needed: `state` already declares `grid`/`queue` as (at least)
  // `Grid`/`ConstructionQueue`, so overwriting them with values of those exact types
  // keeps the spread assignable back to `S` — every other field of `S` passes through
  // this line completely untouched.
  return { state: { ...state, grid, queue }, outcomes }
}
