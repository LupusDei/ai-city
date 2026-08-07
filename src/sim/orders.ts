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
 *   - An UNAFFORDABLE build is a TYPED REJECTION, for the same reason an occupied tile
 *     is: choosing a structure the colony cannot pay for is an ordinary outcome of
 *     player choice, not a defect in anything. See `UnaffordableRejection`.
 *
 * ===========================================================================
 * THIS IS WHERE A BUILD COSTS SOMETHING (aic-8tl.10)
 * ===========================================================================
 * `catalog.ts` gives every structure a `buildCost` — a ONE-TIME bill of materials — and
 * says of it: "Whoever spends a `buildCost` must do it once, at the point construction is
 * committed, and must not route it through the per-turn ledger." `turn.ts` scopes it out
 * of turn resolution and names the owner explicitly: "charged ONCE when construction is
 * committed, which is the caller's `queueConstruction` step, never per-turn here."
 *
 * THIS MODULE IS THAT CALLER, and `applyOrders` is that commit boundary. It is the only
 * place in the sim that reads `buildCost` and the only place that debits it. Before this,
 * nothing did — so a player could queue thirteen habitats on turn 1 for free, which made
 * the silica chain, the regolith chain, the 450 t shield berms and every stockpile cap
 * decorative. A verb that costs nothing is worse than no verb.
 *
 * Three things follow, and each is pinned by test rather than left to good intentions:
 *
 *   - CHARGED EXACTLY ONCE, at commit. Never per turn. `ledger.ts` keeps `ResourceFlow`
 *     as exactly `{ produces, consumes }` so `buildCost` is structurally INVISIBLE to
 *     per-turn netting and cannot be billed again by accident; that invisibility is
 *     load-bearing and must not be widened. A 100-turn test asserts a bill of materials
 *     is charged zero times by the ledger, and it stays true because this module is the
 *     only thing that ever touches the field.
 *
 *   - ATOMIC. Grid, queue and stockpiles move together or not at all. A refused build
 *     leaves all three byte-identical to the input. A colony that paid for a structure it
 *     did not get — or got one it did not pay for — is the worst bug available at this
 *     seam, so the commit is a single unconditional block reached only after every check
 *     has already passed.
 *
 *   - SEQUENTIAL WITHIN A BATCH. `applyOrders` takes an ARRAY, and each order is charged
 *     against the stockpile AS IT STANDS after the previous one — never against the
 *     opening balance. Checking a whole batch against the balance it started with is the
 *     naive implementation that lets a colony buy two structures with the money for one.
 *
 * The affordability rule is also exported on its own, as the pure predicates
 * `checkAffordability` and `canAfford`, because a build tray has to DISABLE what the
 * colony cannot pay for — it must be able to ask before committing, without constructing
 * an order or mutating anything. Both share one implementation with the refusal path, so
 * a greyed-out button and the sim's reason for refusing can never disagree.
 *
 * INTEGER BASE UNITS THROUGHOUT: stockpiles and costs are whole grams and watt-hours,
 * validated once at `catalog.ts`'s boundary. The debit path contains no division,
 * rounding or clamping — only integer subtraction and comparison, which are exact and
 * order-independent. See `catalog.ts`'s base-units block for why that is a project-wide
 * rule and not a local preference.
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
import type { ResourceAmounts, StructureType } from './catalog'
import type { ConstructionQueue } from './construction'
import { cancelProject, enqueueProject, queueConstruction, releaseTiles } from './construction'
import type { Stockpile } from './ledger'
import type { PlacementRejection } from './placement'

// ---------------------------------------------------------------------------
// The minimal structural shape this module needs — see the module header's
// "WHY THIS MODULE DOES NOT IMPORT ColonyState" section.
// ---------------------------------------------------------------------------

/**
 * The minimal slice of a colony's state that applying orders can read or change.
 *
 * Deliberately NOT `ColonyState` (see module header). Any type with at least these three
 * fields — in particular, the real `ColonyState` in `turn.ts` — satisfies this
 * structurally, with no cast or adapter required at the call site.
 *
 * `stockpiles` is REQUIRED, not optional, and that is a deliberate safety choice. An
 * optional stockpile would default to "the colony has nothing" or "the colony has
 * everything", and BOTH readings are a live bug: the first makes every costed structure
 * permanently unbuildable, the second silently restores exactly the free-building defect
 * this field was added to close (aic-8tl.10). A caller that has not decided what the
 * colony owns has not finished wiring up, and should hear about it from the type checker
 * rather than from a playtest.
 */
export interface OrderableColonyState {
  readonly grid: Grid
  readonly queue: ConstructionQueue
  /**
   * What the colony currently owns, in integer base units (Wh / grams) — the balance a
   * `buildCost` is debited from. See `ledger.ts`'s `Stockpile`.
   */
  readonly stockpiles: Stockpile
}

// ---------------------------------------------------------------------------
// Affordability — the one-time bill of materials, asked and answered
// ---------------------------------------------------------------------------

/**
 * One resource the colony cannot cover on a bill of materials, and by how much.
 *
 * Structured data rather than a prose string, for the same reason `ledger.ts`'s
 * `Shortfall` is: "cannot afford" tells a player nothing they can act on, whereas "you
 * are 70 g of regolith short of 100" tells them exactly what to go mine. A UI formats
 * this; it must never have to parse a sentence back into numbers.
 *
 * Carries all four figures — not just the gap — because each answers a different
 * question a build tray actually asks: `required` sizes the bill ("this costs 100"),
 * `available` shows the balance ("you have 30"), and `short` is the gap the player must
 * close ("mine 70 more"). Deriving any of them at the call site would mean the UI
 * re-reading `structureType.buildCost` and the stockpile itself, which is how a readout
 * drifts out of agreement with the rule that produced it.
 *
 * All four are non-negative integers in base units, and `short` is always
 * `required - available` with `available` treated as 0 for a resource the colony has
 * never held. `short` is strictly positive: a resource that IS covered never appears.
 */
export interface ResourceShortfall {
  readonly resource: string
  /** The bill's line item for this resource. */
  readonly required: number
  /** What the colony holds. `0` for a resource with no stockpile entry at all. */
  readonly available: number
  /** `required - available`, always `> 0`. The amount that must still be found. */
  readonly short: number
}

/**
 * A build refused because the colony cannot pay for it.
 *
 * ORDINARY PLAYER OUTCOME, NEVER A THROW — exactly like `placement.ts`'s "that tile is
 * occupied", and for the identical reason set out in this module's throw-vs-reject
 * header: a player choosing a structure they cannot yet afford is gameplay, not a
 * programmer error, and there is nothing a caller could have checked to prevent it that
 * `checkAffordability` does not already expose.
 *
 * Reported as a rejection with a distinct `reason` discriminant so it joins
 * `PlacementRejection`'s existing union cleanly (see {@link QueueBuildRejection}): a
 * caller narrows on `reason` and gets exhaustiveness checking across all three causes.
 *
 * `shortfalls` lists EVERY resource that came up short, sorted by resource name — not
 * merely the first one found. A player short on two materials needs to see two, and
 * sorting keeps the output independent of catalog authoring order, matching
 * `ledger.ts`'s convention for its own sorted reports. Never empty.
 */
export interface UnaffordableRejection {
  readonly ok: false
  readonly reason: 'unaffordable'
  readonly shortfalls: readonly ResourceShortfall[]
}

/** The colony can pay this bill in full. */
export interface Affordable {
  readonly ok: true
}

/**
 * The answer to "could the colony build this right now?" — see {@link checkAffordability}.
 *
 * The failure half is `UnaffordableRejection` VERBATIM, the same value that would land in
 * a `QueueBuildFailure` had the order actually been issued. That reuse is the point: the
 * tray's disabled-state tooltip and the sim's refusal are then guaranteed to say the same
 * thing, because they ARE the same thing.
 */
export type AffordabilityResult = Affordable | UnaffordableRejection

/**
 * Can `stockpiles` cover `structureType`'s one-time bill of materials?
 *
 * THE PREDICATE A BUILD TRAY ASKS BEFORE COMMITTING ANYTHING. Pure, order-free and
 * side-effect-free: it constructs no order, touches no grid, and does not mutate — or
 * even copy — the stockpile it is handed, so a UI may call it on every render for every
 * catalog entry to decide which options to disable.
 *
 * Affordability is `available >= required`, inclusive: a colony that can pay the bill
 * EXACTLY can build the thing and be left with nothing. That boundary is pinned by test,
 * because the alternative (`>`) would strand a colony one gram short of spending its last
 * gram, which is not a rule anyone would choose on purpose.
 *
 * A resource absent from `stockpiles` counts as `0`, never as "unknown" or "unlimited" —
 * the colony holds what it holds. A `buildCost` line item of exactly `0` is free and
 * cannot make anything unaffordable, so it never produces a shortfall; that keeps
 * `{ regolith: 0 }` ("handles regolith, costs none of it") behaving identically to
 * omitting the key, exactly as `catalog.ts` promises.
 *
 * Integer-only: subtraction and comparison of integers, no division anywhere, so the
 * answer is exact and independent of evaluation order (see `catalog.ts`'s base-units
 * block, which is where the integer rule is ENFORCED — this function does not re-check).
 */
export function checkAffordability(
  stockpiles: Stockpile,
  structureType: StructureType,
): AffordabilityResult {
  const shortfalls: ResourceShortfall[] = []

  for (const [resource, required] of Object.entries(structureType.buildCost)) {
    const available = stockpiles[resource] ?? 0
    if (available >= required) continue
    shortfalls.push({ resource, required, available, short: required - available })
  }

  if (shortfalls.length === 0) return { ok: true }

  // Sorted by resource name so the report never depends on the order `buildCost`'s keys
  // happened to be authored in — the same determinism discipline `ledger.ts` applies to
  // its own reports, and the reason this module's header forbids Map/Set iteration order
  // from reaching any output.
  //
  // No equality case in the comparator: `shortfalls` is built by iterating a single
  // object's keys, so two entries can never share a `resource`. A third `=== 0` branch
  // would be unreachable by construction, and an unreachable branch is a line nobody can
  // ever prove correct. Comparing strings directly rather than via `localeCompare`, which
  // is locale-dependent and would make the sort order a property of the host machine.
  shortfalls.sort((a, b) => (a.resource < b.resource ? -1 : 1))
  return { ok: false, reason: 'unaffordable', shortfalls }
}

/**
 * The boolean projection of {@link checkAffordability} — "is this option buildable?".
 *
 * Provided because that is the exact question a tray's `disabled` attribute asks, and
 * threading a `.ok` through every render site is noise. Defined AS a projection of
 * `checkAffordability` rather than as a second, cheaper implementation: two functions
 * answering the same question with two bodies is precisely how a disabled button and the
 * refusal behind it drift into disagreeing, which would present as "the tray let me click
 * it and then the sim said no". One rule, one implementation, one answer.
 */
export function canAfford(stockpiles: Stockpile, structureType: StructureType): boolean {
  return checkAffordability(stockpiles, structureType).ok
}

/**
 * Subtract a bill of materials from a stockpile, returning a NEW stockpile.
 *
 * PRECONDITION: `checkAffordability` has already passed for this exact pair. This
 * function does not re-check, and would happily produce a negative balance if called
 * without that guarantee — which is why it is private to this module and why its single
 * call site sits immediately after the check, with nothing in between (see `applyOrders`).
 * A negative stockpile is representable but meaningless: `ledger.ts` is explicit that a
 * deficit is reported as a `Shortfall`, never as a negative balance.
 *
 * Resources NOT named in the bill pass through untouched, and a line item of exactly `0`
 * is skipped entirely rather than written back as `balance - 0`. Skipping matters for
 * more than speed: it means a free build cannot conjure a phantom `{ regolith: 0 }` key
 * into the stockpile of a colony that has never seen regolith, so "debiting nothing
 * changes nothing" holds for the stockpile's SHAPE and not just its values. When there is
 * nothing at all to debit the input object is returned by reference, matching this
 * module's empty-batch no-op idiom.
 *
 * Integer subtraction only — no division, no rounding, no clamping.
 */
function debitBuildCost(stockpiles: Stockpile, buildCost: ResourceAmounts): Stockpile {
  let debited: Record<string, number> | undefined

  for (const [resource, amount] of Object.entries(buildCost)) {
    if (amount === 0) continue
    debited ??= { ...stockpiles }
    // The `?? 0` is required by `noUncheckedIndexedAccess` and is UNREACHABLE at runtime:
    // this function's precondition is that `checkAffordability` just passed, and a line
    // item with `amount > 0` can only pass if the colony holds at least that much — which
    // means the key exists. Left in as the type checker demands rather than asserted past
    // with a non-null assertion, matching `queueConstruction`'s own documented
    // untestable-as-unreachable guard. If it ever DID fire it would debit from a notional
    // zero, which is the arithmetically correct reading of "the colony has none".
    debited[resource] = (stockpiles[resource] ?? 0) - amount
  }

  return debited ?? stockpiles
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
 * Every ordinary, player-facing reason a `queue-build` order can be refused.
 *
 * Reuses `placement.ts`'s `PlacementRejection` verbatim rather than inventing a
 * parallel vocabulary: from a caller's point of view, "this anchor is out of bounds /
 * already occupied" is the identical situation whether it surfaces from validating a
 * placement directly or from queueing a build order over one.
 *
 * `UnaffordableRejection` joins it as a third member because a build can fail for a
 * reason that has nothing to do with WHERE it was put — the colony simply cannot pay for
 * it (aic-8tl.10). Kept in ONE union, discriminated on `reason`, so a caller writes a
 * single exhaustive switch over `'out-of-bounds' | 'occupied' | 'unaffordable'` and the
 * type checker tells it when a fourth cause appears, instead of a second parallel
 * failure channel it could forget to render.
 */
export type QueueBuildRejection = PlacementRejection | UnaffordableRejection

/** A `queue-build` order rejected for an ordinary, player-facing reason. */
export interface QueueBuildFailure {
  readonly ok: false
  readonly order: QueueBuildOrder
  readonly rejection: QueueBuildRejection
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
  /** `state.grid`/`queue`/`stockpiles` folded through every order's effect, in array order. */
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
  let stockpiles = state.stockpiles
  const outcomes: OrderOutcome[] = []

  for (const order of orders) {
    if (order.kind === 'queue-build') {
      // COST IS CHECKED BEFORE POSITION, deliberately. When a build is both unaffordable
      // AND badly sited the player can only be told one thing first, and "you cannot
      // afford this" is the one that helps: no tile anywhere on the map fixes an empty
      // stockpile, so reporting "occupied" would send the player hunting the grid for a
      // build that could never have happened wherever they clicked. Once the colony CAN
      // pay, the tile genuinely is the remaining problem and the placement rejection is
      // the useful one. Pinned by test so it stays a decision, not an accident.
      const affordability = checkAffordability(stockpiles, order.structureType)
      if (!affordability.ok) {
        outcomes.push({ ok: false, order, rejection: affordability })
        continue
      }

      const result = queueConstruction(grid, order.id, order.structureType, order.anchor)
      if (result.ok) {
        // ATOMIC COMMIT. These three assignments are the only place a build's effects
        // land, they are reached only after BOTH the cost check and the placement check
        // have passed, and nothing between here and the checks can fail — no throw, no
        // further validation. So the colony either gets the structure AND pays for it, or
        // does neither. The half-states this ordering makes unrepresentable are the two
        // worst bugs available here: paying for a structure that was never sited, and
        // siting one that was never paid for.
        grid = result.grid
        queue = enqueueProject(queue, result.project)
        // Charged ONCE, here, at the moment construction is committed — never per turn.
        // `turn.ts` scopes `buildCost` out of turn resolution and names this exact step as
        // its owner, and `ledger.ts` keeps `ResourceFlow` as `{ produces, consumes }` so a
        // bill of materials is structurally invisible to per-turn netting and CANNOT be
        // billed again by accident. This line is the whole of the debit.
        stockpiles = debitBuildCost(stockpiles, order.structureType.buildCost)
        outcomes.push({ ok: true, order })
      } else {
        // Refused on position, after the cost check passed: `queueConstruction` returns a
        // new grid only on FULL success, and `stockpiles` is not touched on this path, so
        // an affordable-but-unplaceable build costs the colony exactly nothing.
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
    // NO REFUND, deliberately. A bill of materials is spent at the moment construction is
    // committed — the regolith is already poured — and nothing in the sim models salvage
    // or deconstruction yield yet. Refunding here would also make "queue then cancel" a
    // free round trip, which is a laundering exploit rather than a mercy. When salvage
    // does land it belongs here, as its own rule with its own recovery rate, not as a
    // silent full rebate.
    outcomes.push({ ok: true, order })
  }

  // No cast needed: `state` already declares `grid`/`queue`/`stockpiles` as (at least)
  // `Grid`/`ConstructionQueue`/`Stockpile`, so overwriting them with values of those exact
  // types keeps the spread assignable back to `S` — every other field of `S` passes
  // through this line completely untouched.
  return { state: { ...state, grid, queue, stockpiles }, outcomes }
}
