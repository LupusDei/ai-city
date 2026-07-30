/**
 * Per-turn resource accounting.
 *
 * Structures produce and consume resources; the ledger nets those flows into a
 * per-resource balance and applies the result to running stockpiles. Electricity
 * is the only MVP constraint, but silica, oxygen, hydrogen, carbon and metals
 * must drop in as DATA later with no logic change here — so, exactly like
 * `catalog.ts`'s `ResourceAmounts`, every resource is addressed by an open
 * string key, never a hardcoded branch. `ResourceFlow` is intentionally just
 * `{ produces, consumes }`: a validated `StructureType` already has that shape,
 * so it satisfies `ResourceFlow` structurally with no adapter, but nothing here
 * imports or depends on `catalog.ts` at runtime — this module accounts for
 * flows, it does not know what produced them.
 *
 * ============================================================================
 * UNITS: every number in this module is a whole base unit —
 *   ENERGY in watt-hours (Wh), MASS in grams (g). Never kW, kWh, kg or tonnes.
 * ----------------------------------------------------------------------------
 * A 5 kW draw over a 25 h shift enters the ledger as `125_000`, not `125`. The
 * conversion belongs to whoever authors the number; nothing in here scales
 * anything. `catalog.ts` (see its base-units block) is where the rule is
 * ENFORCED — amounts must be non-negative integers — and this module is where
 * the payoff is collected: integer sums are exact and, crucially,
 * ORDER-INDEPENDENT, so `computeBalances` netting several structures gives a
 * bit-identical result no matter what order the flows array happens to be in.
 * With float amounts that would be a coin flip on the last bit, and it becomes
 * observable the moment brownouts impose a documented priority order over
 * consumers and a power margin turns on 119.99999 vs 120.
 *
 * This is not a local opinion: `time.ts` makes exactly this argument for the
 * clock and implements it in integer seconds — "a colony sim that cannot replay
 * identically from the same seed is not a colony sim, it is a slot machine"
 * (constitution §1). Same discipline, same reason, one project-wide rule.
 *
 * Consequently this module contains NO division, averaging or percentage
 * arithmetic, and must not grow any: addition and subtraction of integers are
 * closed and exact, division is neither. A future rate/efficiency feature must
 * be expressed as integer numerator and denominator applied at authoring time,
 * not as a float multiplier here. Exactness ceiling: `Number.MAX_SAFE_INTEGER`.
 * ============================================================================
 *
 * Values flowing through this module are assumed already validated
 * (non-negative integers) by whatever authored them — `catalog.ts`'s
 * `createCatalog` is the project's one validation boundary for that, and this
 * module deliberately does not re-check, so there is exactly one place the rule
 * lives. Mirroring `placement.ts`, this module stays pure and never throws: an
 * emergent resource deficit is an ordinary, expected simulation outcome (see
 * `Shortfall`), not a programmer error.
 */

import type { ResourceAmounts } from './catalog'

/**
 * Anything with per-turn produce/consume maps. A validated `StructureType`
 * already has this shape and can be passed directly — no adapter needed. Kept
 * separate from `StructureType` itself so the ledger has zero coupling to how
 * a structure came to exist (catalog, save-file migration, a future test
 * fixture, etc.); it only needs the two resource maps.
 *
 * WHAT IS DELIBERATELY ABSENT: a `StructureType` also carries `buildCost` (a
 * ONE-TIME bill of materials) and `storageCapacity` (a stockpile cap). Neither
 * is a per-turn flow, so neither appears here — and because a structure is
 * accepted STRUCTURALLY, those two fields are simply invisible to this module.
 * That invisibility is load-bearing, not incidental: `buildCost` and `consumes`
 * are both resource debits in the same base units on the same object, and the
 * single most likely bug in the resource-chain work is a bill of materials
 * getting billed every turn. Widening `ResourceFlow` to mention `buildCost`, or
 * reading it anywhere below, would reintroduce exactly that. A build cost is
 * debited ONCE by whoever commits the construction; it must never be routed
 * through per-turn netting. See the one-time-vs-per-turn block in `catalog.ts`.
 */
export interface ResourceFlow {
  readonly produces: ResourceAmounts
  readonly consumes: ResourceAmounts
}

/**
 * Running per-resource totals in base units (Wh / grams), keyed the same
 * open-ended way as `ResourceAmounts`. By construction (see `applyLedger`) every
 * value here is always a `>= 0` integer — a deficit is never represented as a
 * negative stockpile, it is reported alongside as a `Shortfall` instead.
 */
export type Stockpile = Readonly<Record<string, number>>

/**
 * One resource's net production for a turn, before it is applied to any
 * stockpile. `net` can be negative here (consumption outweighing production)
 * — that is expected and meaningful on its own (e.g. "electricity is currently
 * upkeep-negative"), independent of whether the stockpile has enough buffer to
 * absorb it. Whether a negative net becomes a `Shortfall` is decided later, by
 * `applyLedger`, against the running stockpile.
 */
export interface ResourceBalance {
  readonly resource: string
  readonly produced: number
  readonly consumed: number
  readonly net: number
}

/**
 * A typed report that a resource's stockpile ran out this turn: consumption
 * exceeded production plus whatever was already stockpiled. `amount` is the
 * positive magnitude of the gap — how much MORE was needed than was
 * available — never a negative stockpile number. Reporting shortfalls as
 * structured data (which resource, how short) rather than letting a
 * stockpile silently clamp or go negative is the whole point: a caller (UI,
 * AI planner, or a future "colonists start dying" system) can react to
 * exactly what ran out, without re-deriving it from a raw balance.
 */
export interface Shortfall {
  readonly resource: string
  readonly amount: number
}

/**
 * A typed report that a resource was produced but could NOT be carried across the
 * turn boundary, and is therefore gone.
 *
 * The exact mirror of `Shortfall`, and it exists for the identical reason: a surplus
 * that vanishes without a trace is the same class of bug as a stockpile silently
 * going negative. Both are ordinary, expected simulation outcomes reported as
 * structured data so a caller can explain them, and neither is an error.
 *
 * Named for the energy case because that is the motivating one and it is physically
 * literal — surplus electricity is dumped as heat through the radiators, it does not
 * "spill" anywhere. The concept generalises to any flow resource: this is "produced,
 * had nowhere to go".
 */
export interface Vented {
  readonly resource: string
  readonly amount: number
}

/**
 * A typed report that a STOCK resource was produced beyond what the colony can store,
 * and the excess is gone (aic-7f5, spec 002 FR-003, spec 003 FR-004).
 *
 * Reported SEPARATELY from `Vented` rather than merged behind a discriminant, because
 * although both mean "produced, had nowhere to go", the player's response is completely
 * different: vented energy says build a battery, overflowing regolith says build a silo
 * or throttle the mine. A cycle report should be able to say which happened without its
 * reader decoding a reason code.
 */
export interface Overflow {
  readonly resource: string
  readonly amount: number
}

/**
 * How a resource behaves across the turn boundary.
 *
 * RULED BY THE GENERAL (aic-96o): "No storing energy without barriers." Electricity
 * is spent or lost within the turn that generates it, unless an explicit storage
 * structure grants containment. Silica, water, oxygen and regolith are not like that
 * — a pile of regolith is still there next turn whether or not anyone built a silo.
 *
 * So one stockpile model cannot serve every resource, and this is the distinction:
 *
 *   `stock` — carries over freely. The default, and correct for every mass resource.
 *   `flow`  — carries over ONLY up to explicitly granted `storageCapacity`; anything
 *             above that is `Vented` and gone.
 *
 * WHY THIS ARRIVES AS DATA AND NOT AS A BRANCH ON THE RESOURCE NAME: this module's
 * founding contract is that resources are addressed by open string key and never by a
 * hardcoded branch, so that a new resource kind is pure data. A `if (resource ===
 * 'electricity')` here would break that permanently. The caller declares which
 * resources are flows, and `ledger.ts` still does not know that electricity exists.
 * `power.ts` owns that declaration, because `power.ts` owns electricity.
 */
export type AccumulationPolicy = 'stock' | 'flow'

/**
 * Per-resource accumulation rules for one `applyLedger` call.
 *
 * Both members are optional, and an absent policy means "every resource is a stock",
 * which is exactly the behaviour this module had before the flow/stock distinction
 * existed. That default is load-bearing: it keeps every pre-existing caller and test
 * correct without modification, so adopting the policy is opt-in per call site rather
 * than a breaking change nobody can stage.
 */
export interface LedgerPolicy {
  /**
   * Resources that are FLOWS. Anything not named here is a STOCK.
   *
   * A list rather than a full `Record<string, AccumulationPolicy>` because "stock" is
   * the default for the open, unbounded key space — enumerating every stock resource
   * would be impossible, and a map whose absent entries mean "stock" is the same
   * information with more ways to get it wrong.
   */
  readonly flowResources?: readonly string[]
  /**
   * Storage capacity granted by the colony's completed structures, per resource, in
   * base units — the aggregate of every operating structure's
   * `StructureType.storageCapacity`. Consulted for BOTH flows and stocks, with one
   * crucial difference in what ABSENCE means:
   *
   *   - FLOW, absent  -> capacity is ZERO. A flow cannot persist without containment;
   *                      energy with nowhere to go dissipates within the turn.
   *   - STOCK, absent -> capacity is UNBOUNDED. A pile of regolith sits on the ground
   *                      whether or not anyone built a silo.
   *
   * That asymmetry is physical, not a convenience. An EXPLICIT `0` is a real statement
   * in both cases and is distinct from omitting the key — matching `catalog.ts`'s rule
   * that `storageCapacity: { regolith: 0 }` means "handles regolith, buffers none of it".
   *
   * KNOWN TENSION, left deliberately for whoever authors the caps: spec 002 FR-003 says
   * every stockpile MUST have a cap, which implies the stock default should eventually be
   * 0 rather than unbounded. Flipping it is one line here, but it is a BALANCE decision —
   * today no structure declares any capacity, so a 0 default would mean the colony could
   * not hold a single gram of anything and the game would be unplayable.
   */
  readonly storageCapacity?: Stockpile
}

/** The result of running one turn's flows against the prior stockpiles. */
export interface LedgerResult {
  /** Per-resource production/consumption/net for this turn, sorted by resource name. */
  readonly balances: readonly ResourceBalance[]
  /** Stockpiles after applying this turn's net, clamped to never go below zero. */
  readonly stockpiles: Stockpile
  /** Resources whose stockpile would have gone negative this turn, sorted by resource name. */
  readonly shortfalls: readonly Shortfall[]
  /**
   * Flow resources whose surplus could not be contained and is gone, sorted by
   * resource name. Always empty when no flow resource was declared.
   */
  readonly vented: readonly Vented[]
  /**
   * Stock resources produced beyond the colony's storage capacity, sorted by resource
   * name. Always empty when no stock capacity was declared.
   */
  readonly overflow: readonly Overflow[]
}

/** A frozen, reusable empty stockpile — the default when a colony has none yet. */
const EMPTY_STOCKPILE: Stockpile = {}

/** The default policy: every resource is a stock, i.e. the pre-flow/stock behaviour. */
const EMPTY_POLICY: LedgerPolicy = {}

/**
 * All resource keys mentioned by any flow's `produces` or `consumes`, sorted.
 *
 * Sorting here (rather than leaving it to callers) is what keeps resource
 * iteration order deterministic overall: `Object.keys`/`Set` iteration order
 * on freshly-seen string keys is insertion order in practice, but insertion
 * order here is itself just "whatever order the flows array happened to be
 * in" — not a property the sim should ever depend on. Sorting collapses that
 * to a single well-defined order (alphabetical) everywhere it's observable.
 */
function collectSortedResourceKeys(flows: readonly ResourceFlow[]): string[] {
  const keys = new Set<string>()
  for (const flow of flows) {
    for (const key of Object.keys(flow.produces)) keys.add(key)
    for (const key of Object.keys(flow.consumes)) keys.add(key)
  }
  return [...keys].sort()
}

/**
 * Net every flow's production against its consumption, per resource, for one
 * turn. Structures are summed independently per resource — a resource
 * produced by one structure and consumed by another nets together exactly as
 * if a single structure had both flows.
 *
 * An empty `flows` array (an empty colony, or a turn where nothing is built
 * yet) returns `[]`, never `NaN` or a thrown error: there is nothing to net,
 * so there is nothing to report.
 */
export function computeBalances(flows: readonly ResourceFlow[]): readonly ResourceBalance[] {
  const resources = collectSortedResourceKeys(flows)

  return resources.map((resource) => {
    let produced = 0
    let consumed = 0
    for (const flow of flows) {
      // noUncheckedIndexedAccess: an absent key on this specific flow's map is
      // simply "this structure has no opinion on this resource", i.e. 0.
      produced += flow.produces[resource] ?? 0
      consumed += flow.consumes[resource] ?? 0
    }
    return { resource, produced, consumed, net: produced - consumed }
  })
}

/**
 * Run one turn: net `flows` via `computeBalances`, then apply each resource's
 * net to `stockpiles`.
 *
 * A resource stockpile never goes below zero. When a resource's previous
 * stockpile plus this turn's net would be negative, the shortfall (the exact
 * amount short) is recorded in `shortfalls` and the stockpile is clamped to
 * `0` instead of storing the negative value. Resources present in
 * `stockpiles` but untouched by any flow this turn pass through unchanged;
 * resources produced or consumed for the first time are implicitly seeded
 * from a stockpile of `0`.
 *
 * `stockpiles` defaults to empty so a brand-new colony can call this with no
 * second argument. The input `stockpiles` object is never mutated — a fresh
 * object is always returned — so a caller can safely diff old vs. new state.
 *
 * KNOWN GAP — no upper bound yet. Stockpiles are clamped at zero from below but
 * are currently UNBOUNDED from above, even though `StructureTypeSpec` can now
 * declare a `storageCapacity`. Applying that cap needs something this function
 * does not have: the colony's set of completed structures, to sum capacity from.
 * When it is wired up, an overflow MUST be reported as structured data —
 * symmetric with `Shortfall`, e.g. an `Overflow { resource, amount }` — and must
 * not be silently discarded. A surplus that vanishes without a trace is the same
 * class of bug as a stockpile silently going negative, and it will not surface
 * until balance work, by which point the numbers will already be wrong.
 */
export function applyLedger(
  flows: readonly ResourceFlow[],
  stockpiles: Stockpile = EMPTY_STOCKPILE,
  policy: LedgerPolicy = EMPTY_POLICY,
): LedgerResult {
  const balances = computeBalances(flows)
  const balanceByResource = new Map(balances.map((balance) => [balance.resource, balance]))

  // Membership-only use of a Set (never enumerated for order), matching the same
  // idiom in `drones.ts` and `power.ts`. An absent `flowResources` yields an empty
  // set, i.e. "every resource is a stock" — the documented default.
  const flowResources = new Set(policy.flowResources ?? [])
  const grantedCapacity = policy.storageCapacity ?? EMPTY_STOCKPILE

  const resources = new Set<string>([...Object.keys(stockpiles), ...balanceByResource.keys()])
  const sortedResources = [...resources].sort()

  const nextStockpiles: Record<string, number> = {}
  const shortfalls: Shortfall[] = []
  const vented: Vented[] = []
  const overflow: Overflow[] = []

  for (const resource of sortedResources) {
    const previous = stockpiles[resource] ?? 0
    const net = balanceByResource.get(resource)?.net ?? 0
    const raw = previous + net

    if (raw < 0) {
      // A deficit is a deficit regardless of policy: running out is running out, and
      // there is no surplus to discard on a turn that ended short.
      shortfalls.push({ resource, amount: -raw })
      nextStockpiles[resource] = 0
      continue
    }

    // `Math.min` of two integers is an integer, so neither branch below introduces
    // division or a float; the module's no-division discipline survives intact.
    const declaredCapacity = grantedCapacity[resource]

    if (flowResources.has(resource)) {
      // FLOW: carry over only what granted storage can contain. An ABSENT capacity is
      // 0 — the battery-less colony — so the surplus is entirely vented and the
      // stockpile returns to zero every turn, however many turns run.
      const capacity = declaredCapacity ?? 0
      const carried = Math.min(raw, capacity)
      if (raw > carried) vented.push({ resource, amount: raw - carried })
      nextStockpiles[resource] = carried
      continue
    }

    // STOCK: an ABSENT capacity is UNBOUNDED (see `LedgerPolicy.storageCapacity` for
    // why the two defaults differ, and for the FR-003 tension that leaves it this way).
    if (declaredCapacity === undefined) {
      nextStockpiles[resource] = raw
      continue
    }

    const carried = Math.min(raw, declaredCapacity)
    if (raw > carried) overflow.push({ resource, amount: raw - carried })
    nextStockpiles[resource] = carried
  }

  return { balances, stockpiles: nextStockpiles, shortfalls, vented, overflow }
}
