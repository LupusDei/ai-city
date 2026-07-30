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

/** The result of running one turn's flows against the prior stockpiles. */
export interface LedgerResult {
  /** Per-resource production/consumption/net for this turn, sorted by resource name. */
  readonly balances: readonly ResourceBalance[]
  /** Stockpiles after applying this turn's net, clamped to never go below zero. */
  readonly stockpiles: Stockpile
  /** Resources whose stockpile would have gone negative this turn, sorted by resource name. */
  readonly shortfalls: readonly Shortfall[]
}

/** A frozen, reusable empty stockpile — the default when a colony has none yet. */
const EMPTY_STOCKPILE: Stockpile = {}

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
 */
export function applyLedger(
  flows: readonly ResourceFlow[],
  stockpiles: Stockpile = EMPTY_STOCKPILE,
): LedgerResult {
  const balances = computeBalances(flows)
  const balanceByResource = new Map(balances.map((balance) => [balance.resource, balance]))

  const resources = new Set<string>([...Object.keys(stockpiles), ...balanceByResource.keys()])
  const sortedResources = [...resources].sort()

  const nextStockpiles: Record<string, number> = {}
  const shortfalls: Shortfall[] = []

  for (const resource of sortedResources) {
    const previous = stockpiles[resource] ?? 0
    const net = balanceByResource.get(resource)?.net ?? 0
    const raw = previous + net

    if (raw < 0) {
      shortfalls.push({ resource, amount: -raw })
      nextStockpiles[resource] = 0
    } else {
      nextStockpiles[resource] = raw
    }
  }

  return { balances, stockpiles: nextStockpiles, shortfalls }
}
