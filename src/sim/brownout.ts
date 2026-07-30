/**
 * The brownout total order: who keeps their power when the reactors cannot
 * cover the colony's whole draw.
 *
 * =====================================================================
 * WHY THIS MODULE EXISTS AND NOT `power.ts`'s ALLOCATOR (aic-8eq)
 * =====================================================================
 *
 * `power.ts` (aic-a00.9, closed) already allocates power, and its rule is
 * documented and deterministic. It is nonetheless not the rule the project has
 * since committed to, for two independent reasons, both of which this module
 * exists to correct. Neither is a criticism of that bead's care — both are
 * consequences of decisions taken elsewhere AFTER it closed.
 *
 * 1. IT IS NOT A TOTAL ORDER, AND IT IS NOT MONOTONE.
 *    `allocateStructurePower` walks consumers in the caller's array order with
 *    a "first-fit-continue": a consumer that does not fit in the remaining
 *    budget is shed, but the walk continues, so a cheaper, LOWER-priority
 *    consumer can claim capacity a shed higher-priority one could not use.
 *    Specs 002 (FR-005) and 003 (FR-007), both accepted, instead require
 *    shedding in a documented TOTAL order. These are different rules, and the
 *    difference is not academic:
 *
 *      Press 30,000 (higher priority) and Hopper 12,000 (lower priority).
 *        budget 20,000 -> Press does not fit; Hopper does -> HOPPER RUNS.
 *        budget 30,000 -> Press fits, takes all of it -> HOPPER STOPS.
 *
 *    Under first-fit-continue, building a reactor turns a working factory off.
 *    That is a non-monotonicity, and no cycle report can explain it to a player
 *    ("you have more power than last turn, so your hopper stopped"). Strict
 *    shedding in priority order is monotone by construction: the powered set is
 *    always a PREFIX of the total order, and prefixes only grow as the budget
 *    grows. `tests/unit/brownout.test.ts` pins this as a budget sweep.
 *
 *    The price of strict order is idle generation — 20,000 Wh spare while the
 *    Hopper sits dark in the example above. That is accepted deliberately. In a
 *    game whose entire tension IS the power budget, capacity the player can see
 *    going to waste is a legible, actionable problem ("your next consumer needs
 *    30,000 and you have 20,000"); a bin-packer that silently does something
 *    clever instead is neither explainable nor predictable. Legibility beats
 *    utilisation here, and this is the tradeoff, stated rather than defaulted.
 *
 * 2. PRIORITY WAS THE CALLER'S ARRAY ORDER, WHICH IS NOT A PROPERTY OF THE
 *    COLONY. Two callers holding the same colony but building their arrays
 *    differently got different brownouts, and a golden trace could therefore
 *    pass for one caller and fail for another. Here, a consumer's priority is
 *    `(priorityClass, id)` — both intrinsic to the colony's state — so array
 *    order is not observable at all. Same state, same brownout, always.
 *
 * 3. DRONE RECHARGE IS NOT BELOW EVERY STRUCTURE. `power.ts` powers ALL
 *    structures before drone charging sees any budget, by analogy to real grids
 *    curtailing EV charging before hospitals. The analogy does not survive this
 *    particular colony: it is UNMANNED for the whole mission (ratified), so
 *    there are no hospitals because there are no people, and the drones are not
 *    consumer vehicles — they are the entire workforce. A shed processor costs
 *    one turn of output, and its feedstock keeps accumulating in the stockpile
 *    meanwhile, so the loss is largely recoverable. A drone that misses its
 *    charging window costs one turn of progress on EVERYTHING under
 *    construction, against a hard 278-turn deadline, and that turn never comes
 *    back. So drone recharge sits above every processor, and below only life
 *    support and habitat — which is also exactly the order specs 002/003 ask
 *    for. See `BROWNOUT_PRIORITY_CLASSES`.
 *
 * =====================================================================
 * BINARY IDLE
 * =====================================================================
 * A consumer either receives its FULL demand or receives nothing. There is no
 * fractional-throughput path, by design (spec 002 FR-004, spec 003 FR-006):
 *
 *   - Fractional rates produce fractional outputs, which reintroduces exactly
 *     the float drift the integer-units discipline exists to eliminate — and it
 *     reintroduces it into an ACCUMULATING quantity (a stockpile), which is the
 *     one place `time.ts`'s header identifies as unforgivable.
 *   - "Your furnace made 17.3 kg because it got 58% of its power" is not a
 *     sentence a player can act on. "Your furnace was shed; everything above it
 *     in the priority list took the power" is.
 *
 * The divisible-fleet case is handled by modelling, not by an exception: drone
 * recharge is ONE DEMAND PER DRONE, not one demand for the fleet. Binary idle
 * per drone then yields exactly the floor-division behaviour `drones.ts`'s
 * `computeDroneShift` produces, with none of its float division and no need for
 * its `FLOOR_EPSILON` — integers compare exactly. Any future consumer that
 * genuinely comes in indivisible units should be modelled the same way.
 *
 * =====================================================================
 * UNITS — READ BEFORE WIRING (see docs/turn-composition-audit.md, M8/M18)
 * =====================================================================
 * Demands and the budget are integers in ONE unit chosen by the caller, and
 * this module never converts between units. It is named for watt-hours because
 * spec 003's `resolveBrownout(demands, availableWh)` is the most specific
 * accepted signature, but the allocation is genuinely SCALE-FREE: because every
 * consumer is all-or-nothing for the whole turn, "can the grid carry this load"
 * (watts) and "is there enough energy this turn" (watt-hours) are the same
 * comparison scaled by one constant, and the resulting powered set is identical
 * under either. So a caller working in integer watts, or in spec 002 FR-001's
 * integer watt-seconds, may pass those throughout and read the results in the
 * same unit.
 *
 * That scale-freedom is deliberate, not evasive: specs 002 and 003 currently
 * DISAGREE on the canonical energy unit (watt-seconds vs watt-hours, a factor
 * of 3600), and `aic-5ub` is converting the ledger to integer base units right
 * now. Picking a side here would have to be redone. What this module does
 * guarantee is that whichever unit wins, no rounding happens inside it.
 *
 * =====================================================================
 * DETERMINISM
 * =====================================================================
 * Pure function of its arguments' values. No `Math.random`, no `Date.now`, no
 * `new Date`, and no Map/Set iteration order reaches any output: `Set` is used
 * only for id-uniqueness MEMBERSHIP tests, never enumerated. Id comparison uses
 * UTF-16 code-unit order (`<`/`>`) and explicitly NOT `String.localeCompare`,
 * which depends on the host's locale and ICU version — a golden trace compared
 * across two machines would diverge on exactly that.
 */

// ---------------------------------------------------------------------------
// The total order over consumer classes
// ---------------------------------------------------------------------------

/*
 * Priority is an INTEGER CLASS carried as data, lower meaning higher priority
 * (shed last). Classes are spaced by 100 so a future consumer kind can be
 * slotted between two existing ones without renumbering anything — and, more
 * importantly, so registering a new structure remains a CATALOG DATA change
 * rather than a new code branch here, which is the contract `catalog.ts`'s
 * header sets for the whole sim ("structure types are DATA, never code
 * branches").
 */

/**
 * Life support: the colony's own pressurised, thermally-regulated volume.
 *
 * Highest priority because it is the only load whose interruption is not
 * recoverable by waiting. NOTE, and it is load-bearing: the MVP colony is
 * unmanned, so whether a completed-but-empty habitat draws its rated life
 * support at all is an OPEN QUESTION filed with the General — see
 * docs/turn-composition-audit.md M9. If the answer is "no draw until the wave
 * lands", this class is legitimately empty for the whole MVP, and that is fine:
 * an empty top class costs nothing and the order stays correct for when it is
 * not empty.
 */
export const PRIORITY_LIFE_SUPPORT = 100

/**
 * Habitat systems other than life support proper.
 *
 * Above drone recharge because completed habitat capacity IS the win condition
 * (`mission.ts`'s `evaluateMission`), and spec 002's FR-011 makes readiness a
 * two-factor test — a habitat that cannot hold power is not a habitat you can
 * honestly certify to a wave that has already left Earth.
 */
export const PRIORITY_HABITAT = 200

/**
 * Drone battery recharge — one demand PER DRONE (see the module doc's
 * binary-idle section).
 *
 * Above every processor because drone-hours are the only strictly
 * unrecoverable resource in the game: a shed processor loses one turn of
 * output while its feedstock keeps piling up, but a drone that misses its
 * charging window loses one turn of progress on everything under construction,
 * and the mission has a hard deadline. This reverses aic-a00.9's shipped
 * ordering; the reasoning is in the module doc, point 3.
 */
export const PRIORITY_DRONE_RECHARGE = 300

/**
 * Downstream processors — the bottleneck stage of a resource chain (Sinter
 * Press, Silicon Furnace).
 *
 * Above their own upstream feeders, which reads backwards until you look at the
 * accepted numbers: spec 003's Sifter over-feeds its Furnace roughly 80x
 * (6,000,000 g produced against 75,000 g accepted per turn), and spec 002's
 * Hopper over-feeds its Press roughly 43x (60,000,000 g against 1,400,000 g).
 * Feedstock is therefore abundant and the conversion step is scarce. Shedding
 * the abundant stage costs a stockpile that was overflowing anyway; shedding
 * the scarce stage costs the chain's entire output. So: shed upstream first.
 */
export const PRIORITY_PROCESSOR_DOWNSTREAM = 400

/**
 * Upstream extractors and feeders — the abundant stage (Regolith Hopper,
 * Silica Sifter). See `PRIORITY_PROCESSOR_DOWNSTREAM` for why these are shed
 * before, not after, the stage they feed.
 */
export const PRIORITY_PROCESSOR_UPSTREAM = 500

/**
 * Everything not explicitly classified — the "all others" bucket the specs
 * name at the end of the order.
 *
 * Deliberately last rather than middling: an unclassified consumer is one
 * nobody has reasoned about yet, and the safe default for something nobody has
 * reasoned about is that it loses power before anything that has been. It is
 * also where zero-draw structures land (spec 002's Shield Berm draws 0 W),
 * which costs nothing since a zero demand is never shed.
 */
export const PRIORITY_DEFAULT = 900

/** One entry in the documented total order, for tests, reports and UI alike. */
export interface BrownoutPriorityClass {
  readonly name: string
  readonly priority: number
  /** Why this class sits where it does. Surfaced so a cycle report can explain a shed. */
  readonly rationale: string
}

/**
 * THE DOCUMENTED TOTAL ORDER, highest priority (shed last) first.
 *
 * Exported as data rather than left implicit in the constants above for three
 * reasons: `tests/unit/brownout.test.ts` asserts it really is a strict total
 * order (spec 002 FR-005's "asserted by test"); a cycle report can render
 * "why was I shed" straight from `rationale` without duplicating the reasoning;
 * and a reviewer can read the whole ordering decision in one place.
 */
export const BROWNOUT_PRIORITY_CLASSES: readonly BrownoutPriorityClass[] = [
  {
    name: 'life-support',
    priority: PRIORITY_LIFE_SUPPORT,
    rationale:
      'The only load whose interruption is not recoverable by waiting. Empty for the ' +
      'unmanned MVP if the General rules that a habitat draws nothing until the wave lands.',
  },
  {
    name: 'habitat',
    priority: PRIORITY_HABITAT,
    rationale:
      'Completed habitat capacity is the win condition, and readiness is a built-AND-rated ' +
      'test — a habitat that cannot hold power cannot honestly be certified.',
  },
  {
    name: 'drone-recharge',
    priority: PRIORITY_DRONE_RECHARGE,
    rationale:
      'Drone-hours are the only unrecoverable resource: a shed processor loses one turn of ' +
      'output while its feedstock accumulates, but a lost drone-turn is lost progress on ' +
      'everything under construction, against a fixed deadline.',
  },
  {
    name: 'processor-downstream',
    priority: PRIORITY_PROCESSOR_DOWNSTREAM,
    rationale:
      'The scarce, bottleneck conversion stage. Its upstream feeders over-produce it by 40-80x, ' +
      'so shedding this stage costs the whole chain while shedding its feeder costs an overflow.',
  },
  {
    name: 'processor-upstream',
    priority: PRIORITY_PROCESSOR_UPSTREAM,
    rationale: 'The abundant extraction stage. Cheapest thing in the colony to switch off.',
  },
  {
    name: 'unclassified',
    priority: PRIORITY_DEFAULT,
    rationale:
      'A consumer nobody has reasoned about yet loses power before anything that has been. ' +
      'Also where zero-draw structures land, which is free — a zero demand is never shed.',
  },
]

/**
 * The catch-all class, looked up by NAME once at module load rather than assumed to be
 * the array's last element — so `rationaleForPriority`'s fallback survives even if
 * `BROWNOUT_PRIORITY_CLASSES` is ever reordered. Throws at import time if the
 * 'unclassified' entry is ever removed, rather than letting the fallback silently
 * degrade to `undefined` deep inside a turn resolution — the same "fail loudly at the
 * point of the mistake" instinct the rest of this module already applies to malformed
 * demands.
 */
const UNCLASSIFIED_CLASS: BrownoutPriorityClass = (() => {
  const found = BROWNOUT_PRIORITY_CLASSES.find((entry) => entry.name === 'unclassified')
  if (found === undefined) {
    throw new Error(
      'brownout.ts: BROWNOUT_PRIORITY_CLASSES is missing its "unclassified" catch-all class',
    )
  }
  return found
})()

/**
 * The rationale text for the priority class governing `priority` (aic-svp) — what a
 * player would read to understand WHY a structure carrying this priority was shed,
 * threaded into `turn.ts`'s `CycleReport` as `ShedStructureReport.reason`.
 *
 * Looks up an EXACT match against `BROWNOUT_PRIORITY_CLASSES` first — the case for
 * every MVP structure, whose `catalog.ts` `priorityClass` is always one of the six
 * documented constants. Any other integer — a value a future catalog author places
 * BETWEEN two classes, which is exactly what the "spaced by 100" design in this
 * module's header exists to allow — falls back to the 'unclassified' class's
 * rationale: the same "nobody has reasoned about this yet" logic `PRIORITY_DEFAULT`
 * already states for an ABSENT `priorityClass`, extended here to a present but
 * undocumented one. This is what lets a cycle report always have a rationale to show,
 * for any priority value the catalog could possibly produce, with no throw and no
 * `undefined`.
 */
export function rationaleForPriority(priority: number): string {
  const exact = BROWNOUT_PRIORITY_CLASSES.find((entry) => entry.priority === priority)
  return (exact ?? UNCLASSIFIED_CLASS).rationale
}

// ---------------------------------------------------------------------------
// Demands and results
// ---------------------------------------------------------------------------

/**
 * One consumer's claim on this turn's power.
 *
 * Deliberately NOT a structure: this module accounts for claims on a budget and
 * does not know or care whether a claim comes from a building, a drone's
 * charger, or something not yet invented. That is the same inversion
 * `ledger.ts` uses for `ResourceFlow` — and for the same reason, a caller's
 * richer type satisfies this structurally with no adapter.
 */
export interface PowerDemand {
  /**
   * The consumer INSTANCE id — a drone id, a structure instance id. Must be
   * non-empty and unique within one call, because it is both the tie-break key
   * and how the result names who was shed.
   */
  readonly id: string
  /** Integer priority class; lower is higher priority. See the constants above. */
  readonly priority: number
  /** Full-turn demand, an integer, in the caller's chosen unit (see module doc). */
  readonly wattHours: number
}

/** The result of rationing one turn's generation across a set of demands. */
export interface BrownoutResult {
  /**
   * Consumers that received their FULL demand, in priority order. Always a
   * prefix of the priority order once zero-demand consumers are accounted for
   * — see the module doc's monotonicity argument.
   */
  readonly poweredIds: readonly string[]
  /** Consumers that received nothing, in priority order. Never includes a zero-demand consumer. */
  readonly shedIds: readonly string[]
  /** Sum of every demand, powered or shed. */
  readonly totalDemandWattHours: number
  /** Sum actually delivered — i.e. the demands of `poweredIds`. */
  readonly suppliedWattHours: number
  /**
   * Budget left unspent. Under strict-order shedding this can be non-zero
   * while consumers sit shed; that is the accepted, deliberate cost of a
   * legible order (see the module doc) and is reported precisely so a player or
   * UI can say "you have this much spare and your next consumer needs more".
   */
  readonly unusedWattHours: number
  /** True iff at least one consumer was shed. */
  readonly brownout: boolean
  /**
   * Index, into the priority-ordered demand list, of the first shed consumer —
   * or `null` if nothing was shed. The whole turn's brownout is explainable
   * from this ONE integer: everything before it ran, everything at or after it
   * (bar zero-demand consumers) did not. That is what "explainable" buys.
   */
  readonly cutLine: number | null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Guards an integer that must be >= 0.
 *
 * `Number.isInteger` already rejects `NaN` and `Infinity`, so the one check
 * covers every non-integral case. Throws rather than returning a typed
 * rejection because a fractional or negative power figure is a programmer/data
 * error, never an ordinary simulation outcome — a genuine power SHORTAGE is an
 * ordinary outcome, and it is reported as a `BrownoutResult`, not thrown.
 */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

/**
 * Validates every demand's shape and the pairwise uniqueness of their ids.
 *
 * The `Set` here is used only to test MEMBERSHIP, never enumerated, so no
 * Set iteration order can reach an output. Mirrors `drones.ts`'s
 * `assertValidRoster` and `power.ts`'s `assertUniqueNonEmptyIds` deliberately:
 * one uniqueness idiom across the sim, so a reviewer learns it once.
 *
 * @throws {RangeError} on an empty-string id, a duplicate id, a non-integer
 *   priority, or a `wattHours` that is not a non-negative integer.
 */
function assertValidDemands(demands: readonly PowerDemand[]): void {
  const seen = new Set<string>()

  for (const consumer of demands) {
    if (consumer.id.length === 0) {
      throw new RangeError('Power demand id must be a non-empty string')
    }
    if (seen.has(consumer.id)) {
      throw new RangeError(`Duplicate power demand id: "${consumer.id}"`)
    }
    seen.add(consumer.id)

    // Priority must be an integer so that class equality is exact: two
    // priorities differing by 1e-15 would be an unorderable near-tie that the
    // id tie-break would never be reached to resolve.
    if (!Number.isInteger(consumer.priority)) {
      throw new RangeError(
        `Power demand "${consumer.id}": priority must be an integer, received: ${consumer.priority}`,
      )
    }
    assertNonNegativeInteger(consumer.wattHours, `Power demand "${consumer.id}": wattHours`)
  }
}

// ---------------------------------------------------------------------------
// The order itself
// ---------------------------------------------------------------------------

/**
 * The total order over demands: priority class ascending, then id ascending.
 *
 * A genuine TOTAL order, not merely a deterministic one — it returns `0` only
 * when both the class and the id match, and since ids are validated unique
 * within a call, that can only happen for the very same consumer. That is the
 * property specs 002 FR-005 and 003 FR-007 require, and it is what makes the
 * sort stable-independent: the result does not depend on the input array's
 * order, so no caller's incidental array ordering can be observed downstream.
 *
 * Ids are compared with `<`/`>` (UTF-16 code-unit order) and deliberately NOT
 * with `String.prototype.localeCompare`, whose result depends on the host's
 * locale and ICU version — two machines replaying the same seed would then
 * disagree about who got shed, which is precisely the class of bug the golden
 * trace exists to catch and would instead be caused by.
 */
export function comparePowerDemands(a: PowerDemand, b: PowerDemand): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/**
 * Ration `availableWattHours` across `demands`, shedding in strict reverse
 * priority order.
 *
 * Algorithm, in full: sort a COPY of `demands` by `comparePowerDemands`, then
 * walk it once from highest priority to lowest. Each consumer is powered if it
 * has not been shed and its full demand fits in the remaining budget; from the
 * first consumer that does not fit, every subsequent consumer is shed too
 * — no backfilling (see the module doc for why, and for the monotonicity this
 * buys). A zero-demand consumer is the single exception: it is always powered,
 * never shed, and never moves the cut line, because shedding is the rationing
 * of a scarce good and a consumer that consumes none of it cannot be rationed.
 * Listing it as a brownout victim would make the cycle report untruthful.
 *
 * The input array is never mutated — `toSorted` semantics via a spread copy —
 * so a caller may safely reuse the same array (a drone roster, a UI list) for
 * anything order-sensitive.
 *
 * An empty `demands` list is a safe no-op returning the full budget as unused,
 * matching the "an empty collection is the ordinary starting state of a fresh
 * colony" convention used by `ledger.ts`'s `computeBalances`, `mission.ts`'s
 * `totalHabitatCapacity` and `power.ts`'s `totalGenerationKw`.
 *
 * @throws {RangeError} if `availableWattHours` is not a non-negative integer,
 *   or if any demand fails `assertValidDemands`.
 */
export function resolveBrownout(
  demands: readonly PowerDemand[],
  availableWattHours: number,
): BrownoutResult {
  assertNonNegativeInteger(availableWattHours, 'availableWattHours')
  assertValidDemands(demands)

  const ordered = [...demands].sort(comparePowerDemands)

  const poweredIds: string[] = []
  const shedIds: string[] = []
  let remaining = availableWattHours
  let suppliedWattHours = 0
  let totalDemandWattHours = 0
  let cutLine: number | null = null

  for (let index = 0; index < ordered.length; index++) {
    // Safe: `index` is bounded by `ordered.length` on the line above.
    const consumer = ordered[index] as PowerDemand
    totalDemandWattHours += consumer.wattHours

    // A zero-demand consumer needs nothing, so nothing can be denied it. It is
    // powered unconditionally and does not disturb the cut line.
    if (consumer.wattHours === 0) {
      poweredIds.push(consumer.id)
      continue
    }

    // Strict order: once the cut line is set, everything below it is shed
    // regardless of whether it would individually have fitted. This is the
    // no-backfill rule that makes the powered set a prefix and the allocation
    // monotone in the budget.
    if (cutLine === null && consumer.wattHours <= remaining) {
      poweredIds.push(consumer.id)
      remaining -= consumer.wattHours
      suppliedWattHours += consumer.wattHours
      continue
    }

    if (cutLine === null) cutLine = index
    shedIds.push(consumer.id)
  }

  return {
    poweredIds,
    shedIds,
    totalDemandWattHours,
    suppliedWattHours,
    unusedWattHours: remaining,
    // A brownout is "something got shed", full stop. Deliberately NOT
    // "demand exceeded generation": `power.ts` computes its flag against the
    // FULL drone roster's demand, which makes it permanently true from turn 1
    // — the ratified balance has the player owning ~33 drones and able to
    // charge ~22, so an over-subscribed roster is the intended steady state,
    // not an alarm. A flag that is always on tells a player nothing.
    brownout: shedIds.length > 0,
    cutLine,
  }
}
