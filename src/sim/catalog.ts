/**
 * The data-driven structure catalog.
 *
 * Structure types are DATA, never code branches. Adding a new structure — or a new
 * resource kind such as silica, oxygen or hydrogen — must require only a new catalog
 * entry, with no change to simulation logic. `createCatalog` is the boundary where
 * that untrusted data is validated once, so the rest of the sim can treat catalog
 * contents as known-good.
 *
 * ============================================================================
 * RESOURCE BASE UNITS — READ THIS BEFORE AUTHORING ANY CATALOG ENTRY
 * ----------------------------------------------------------------------------
 *   ENERGY is watt-hours (Wh).   NOT kW, NOT kWh.
 *   MASS   is grams (g).         NOT kg, NOT tonnes.
 *   Every amount is a NON-NEGATIVE INTEGER. There is no half a watt-hour.
 *
 *   So: a 5 kW draw sustained over a 25 h drone shift is `125_000`, not `125`
 *   and certainly not `5`. A 300 kg regolith hopper is `300_000`, not `300`.
 *   If a figure you were handed is in kW/kWh/kg, MULTIPLY BY 1000 before it
 *   enters a `produces`/`consumes` map — that conversion belongs at the point
 *   of authorship, never inside the sim.
 * ----------------------------------------------------------------------------
 * WHY (this is one project-wide rule, not a local opinion):
 *   `time.ts` already makes the same argument for the clock and implements it in
 *   integer seconds — "a colony sim that cannot replay identically from the same
 *   seed is not a colony sim, it is a slot machine" (constitution §1). Integers
 *   add and multiply exactly; floats do not, and float sums are ORDER-DEPENDENT.
 *   That is not academic here: the moment brownouts impose a documented priority
 *   order over consumers, a power-margin check starts hinging on whether a sum
 *   landed on 119.99999 or 120, and the answer depends on which structure was
 *   summed first. Integer base units make the question unaskable.
 *
 *   Choosing a small enough base unit is what lets the rule cost nothing: any
 *   quantity a designer would naturally write as a fraction of a kilowatt-hour
 *   or a kilogram is a whole number of watt-hours or grams. `validateResourceAmounts`
 *   enforces it at this one boundary, so `ledger.ts` can do exact arithmetic
 *   without re-validating anything.
 *
 *   Exactness ceiling: `Number.MAX_SAFE_INTEGER` (~9e15 Wh = 9 PWh). Colony-scale
 *   figures sit ~8 orders of magnitude below it, so this is a documented boundary
 *   rather than a practical constraint.
 * ============================================================================
 *
 * ============================================================================
 * ONE-TIME COST vs PER-TURN FLOW — THE OTHER THING TO GET RIGHT
 * ----------------------------------------------------------------------------
 * A structure carries THREE resource maps that all look alike (same type, same
 * base units, same integer rule) and mean completely different things. Charging
 * one where another belongs is the single most likely bug in the resource-chain
 * work, so the distinction is spelled out once, here:
 *
 *   `buildCost`        ONE-TIME.  Debited ONCE, at construction. A bill of
 *                      materials. "This Photovoltaic Array costs 20 kg of
 *                      silicon to BUILD" -> `{ silicon: 20_000 }`.
 *   `consumes`         PER-TURN.  Debited EVERY TURN the structure operates.
 *                      An operating draw. "This Sinter Plant eats 40 kg of
 *                      regolith A TURN" -> `{ regolith: 40_000 }`.
 *   `storageCapacity`  NEITHER.   Not a debit at all. A CAP — the most of a
 *                      resource this structure lets the colony hold.
 *
 * The read-aloud test: `buildCost` completes "...to build one", `consumes`
 * completes "...per turn, forever", `storageCapacity` completes "...can be
 * stored here at once". If a number does not fit exactly one of those
 * sentences, it is in the wrong map.
 *
 * A resource may legitimately appear in several: a Sinter Plant can cost 5 kg
 * of regolith to build AND eat 40 kg a turn AND buffer 300 kg. Those are three
 * independent facts, and nothing anywhere may merge or substitute them.
 *
 * The distinction is enforced STRUCTURALLY, not by convention. `ledger.ts`
 * defines per-turn netting over `ResourceFlow`, which is exactly
 * `{ produces, consumes }` — so a `StructureType` satisfies it while
 * `buildCost` and `storageCapacity` are invisible to the ledger and CANNOT be
 * charged per-turn by accident. Whoever spends a `buildCost` must do it once,
 * at the point construction is committed, and must not route it through the
 * per-turn ledger. See the matching block in `ledger.ts`.
 * ============================================================================
 */

// `brownout.ts` owns the meaning of a priority class; this module only stores the
// one a structure declares. Importing just the default keeps the normalise-optionals
// contract honest (exactly one place decides what "unclassified" means) without this
// module gaining any knowledge of the ordering rule itself. `brownout.ts` imports
// nothing, so there is no cycle.
import { PRIORITY_DEFAULT } from './brownout'

/** A tile offset relative to a structure's anchor tile. */
export interface FootprintOffset {
  readonly dx: number
  readonly dy: number
}

/**
 * Resource amounts keyed by resource kind.
 *
 * Deliberately UNTIMED: this type says "how much of what", never "how often".
 * The same shape carries a per-turn flow (`produces`/`consumes`), a one-time
 * bill of materials (`buildCost`) and a stockpile cap (`storageCapacity`), and
 * WHICH of those a given map is comes entirely from the field it sits in — see
 * the one-time-vs-per-turn block at the top of this file. A `PerTurnAmounts`
 * alias would have made three of the four fields lie.
 *
 * Deliberately an open string-keyed record rather than a closed union: the MVP only
 * constrains `electricity`, but silica/oxygen/hydrogen/carbon/metals must drop in as
 * data later. Keys are validated at load, so downstream code can rely on them being
 * non-empty strings mapped to non-negative integers.
 *
 * UNITS: watt-hours for energy, grams for mass — always whole numbers. See the
 * base-units block at the top of this file. The type cannot express that (a
 * branded integer type would infect every arithmetic site in the sim for no
 * determinism benefit, since `createCatalog` already rejects non-integers), so
 * the guarantee is a validated runtime invariant, not a compile-time one.
 */
export type ResourceAmounts = Readonly<Record<string, number>>

/**
 * Where a structure is allowed to stand, beyond the generic bounds and occupancy
 * checks `placement.ts` already applies to every structure.
 *
 * Every member is OPTIONAL, and absence means "no requirement of that kind". The
 * overwhelming majority of structures can go on any buildable tile, so a
 * structure with no siting constraints is simply `{}` — requiring every catalog
 * entry to declare an empty siting block would be ceremony that buys nothing.
 *
 * A nested object rather than a flat `requiresDeposit` field on the spec because
 * this is the first of a family: slope limits, latitude bands, minimum distance
 * from a neighbour and "must abut a road" are all the same kind of statement, and
 * they belong grouped under one namespace rather than accreting as loose
 * top-level fields.
 */
export interface SitingRequirements {
  /**
   * The structure may only be placed on a `MineralDeposit` whose `kind` equals
   * this value — "site this Sifter on a SILICA deposit". Absent (the common case)
   * means the structure has no deposit requirement at all.
   *
   * An OPEN string key, exactly like `MineralDeposit.kind` in `buildability.ts`
   * and for the same reason: a new deposit kind must be addable as DATA. A closed
   * union here would mean every invented kind needed a source edit in this file,
   * which is the coupling both modules exist to avoid. Validated as a non-empty
   * string at the `createCatalog` boundary, matching how `eligibleDepositKinds`
   * validates the kind registry itself; whether the named kind is actually
   * REGISTERED in a given world is not knowable here and is not checked.
   *
   * This module holds the requirement, never the check. `catalog.ts` knows
   * nothing about grids, tiles or deposits, so enforcing this at placement time —
   * including the genuine design question of whether the deposit must lie under
   * the ANCHOR or merely under some footprint tile — belongs to the placement
   * rule that consumes this field, not here.
   */
  readonly requiresDeposit?: string
}

/** The raw, caller-supplied shape. Validated by `createCatalog`. */
export interface StructureTypeSpec {
  readonly id: string
  readonly name: string
  /** Tiles occupied, relative to the anchor. Must include the anchor `(0,0)`. */
  readonly footprint: readonly FootprintOffset[]
  /** Turns of drone work to complete. `0` means pre-placed (e.g. a landed starship). */
  readonly buildTurns: number
  /** PER-TURN output while operating. See the one-time-vs-per-turn block above. */
  readonly produces: ResourceAmounts
  /**
   * PER-TURN operating draw while running — NOT what the structure costs to
   * build. That is {@link StructureTypeSpec.buildCost}. See the
   * one-time-vs-per-turn block at the top of this file before touching either.
   */
  readonly consumes: ResourceAmounts
  /**
   * ONE-TIME bill of materials: what it costs to BUILD one, debited once when
   * construction is committed — NOT a recurring draw. That is
   * {@link StructureTypeSpec.consumes}.
   *
   *   Photovoltaic Array -> `{ silicon: 20_000 }`         (20 kg of silicon, once)
   *   Shield Berm        -> `{ regolith: 450_000_000,
   *                            sinteredPlate: 7_500_000 }` (450 t + 7.5 t, once)
   *
   * This field is what makes a production chain a game rather than a rising
   * number: without it there is nowhere to record what a structure costs, so
   * refined output can never be SPENT on anything. Amounts are non-negative
   * integers in base units, same rule as every other resource map.
   *
   * Optional for authoring — most MVP structures are free to build, and absence
   * normalises to `{}` on the validated {@link StructureType}, so consumers never
   * write `?? {}`. Absent and `{}` mean exactly the same thing ("free").
   */
  readonly buildCost?: ResourceAmounts
  /**
   * Placement constraints. Optional: absent means "may be built on any buildable
   * tile", which is the common case. Normalised to `{}` on the validated
   * {@link StructureType}, so consumers read `type.siting.requiresDeposit`
   * without optional chaining.
   */
  readonly siting?: SitingRequirements
  /**
   * How much of each resource this structure lets the colony STOCKPILE — a cap,
   * not a flow and not a cost. Nothing is debited or credited by this field.
   *
   * Unbounded accumulation removes every logistics decision from the game: with
   * infinite storage there is never a reason to build a hopper, throttle a mine,
   * or prioritise a haul. Caps are what make those choices exist.
   *
   * Optional; absent or `{}` means "stores nothing". A cap of exactly `0` for a
   * named resource is deliberately distinct from omitting the key — it states
   * "this structure handles regolith but buffers none of it", which a
   * just-in-time hauling rule needs to be able to say. Non-negative integers in
   * base units.
   *
   * NOTE: this is the DECLARATION of a cap. Aggregating caps across a colony's
   * completed structures and deciding what happens to an overflow is turn
   * resolution's job, not the catalog's — and when that lands, an overflow must
   * be reported as structured data (symmetric with `ledger.ts`'s `Shortfall`),
   * because a silently discarded surplus is exactly the bug this field exists to
   * make impossible.
   */
  readonly storageCapacity?: ResourceAmounts
  /**
   * PER-TURN draw while COMPLETE but not productive — the "idling" cost, as
   * distinct from {@link StructureTypeSpec.consumes}, which is the rated draw while
   * actually operating.
   *
   * RATIFIED BY THE GENERAL (aic-96o). An empty habitat draws neither nothing nor
   * full rated, but a reduced standby figure of ~20% of rated. Two independent
   * derivations agreed, which is why it is a figure and not a guess: fractionating
   * the load (crew-dependent O2 generation, CO2 scrubbing, water recycling,
   * humidity, lighting and food prep all fall to ~0 when empty, while thermal
   * control, avionics, monitoring and trickle power for valves and pumps persist)
   * gives ~20% -> 6.4 kW of a 32 kW rated module; and independently, holding a
   * ~320 m2 envelope at +10 C against -60 C ambient at U ~ 0.3 W/m2K gives 6.7 kW.
   *
   * WHY IT IS DATA AND NOT A FRACTION THE SIM APPLIES: computing "20% of rated" at
   * runtime means a division and a rounding inside the sim, which the base-units
   * block above forbids for exactly the determinism reason stated there. The
   * conversion belongs at authorship, like every other unit conversion here. The
   * cost of that choice is that the two maps could drift, so `validateStandbyConsumes`
   * enforces the one invariant that matters: standby may never EXCEED rated for any
   * resource, and may not name a resource the structure does not consume at all.
   *
   * SHIELDING DEPENDENCE IS NOT MODELLED YET, and this is the hook for it. The same
   * thermal calculation run on a BURIED habitat is striking: 3 m of regolith at
   * k ~ 0.15 W/mK is U = 0.05 W/m2K alone, in series with a 0.20 W/m2K wall giving
   * an effective ~0.04 — so shielding cuts the standby heating bill to roughly 20%
   * of unshielded, ~0.9 kW. Burying a habitat for radiation also pays for itself in
   * heat. Expressing that needs the `rated`/shielded flag that spec 002's Shield
   * Berm introduces (FR-010/FR-011), which does not exist yet; when it does, this
   * becomes a second authored standby map selected on shielded-ness, NOT a runtime
   * multiplier. Tracked separately — see the bead filed from aic-96o.
   *
   * Optional; absent or `{}` means "draws nothing when not productive". An explicit
   * `0` for a consumed resource is deliberately distinct from omitting the key: it
   * states "this structure's entire load is crew-dependent", which a habitat with no
   * standby heat requirement needs to be able to say. Non-negative integers in base
   * units, same rule as every other resource map.
   */
  readonly standbyConsumes?: ResourceAmounts
  /**
   * This structure's slot in the brownout total order — see `brownout.ts`, which
   * owns what the values MEAN and exports the named classes to author against
   * (`PRIORITY_LIFE_SUPPORT`, `PRIORITY_HABITAT`, `PRIORITY_DRONE_RECHARGE`,
   * `PRIORITY_PROCESSOR_DOWNSTREAM`, `PRIORITY_PROCESSOR_UPSTREAM`).
   *
   * Lower is higher priority, i.e. shed LAST. Authored as data rather than derived
   * in code because deriving it would mean a branch on structure id somewhere, which
   * is precisely the coupling this module exists to prevent — registering a new
   * consumer in the brownout order must stay a catalog edit.
   *
   * This replaces the previous arrangement, in which `power.ts` took priority from
   * the CALLER'S ARRAY POSITION. That made brownout outcomes a function of caller
   * bookkeeping rather than of colony state, so two callers holding the same colony
   * could get different brownouts and a golden trace could pass for one and fail for
   * the other (docs/turn-composition-audit.md B6).
   *
   * Optional; absent normalises to `PRIORITY_DEFAULT`, which is LAST. Defaulting to
   * last rather than middling is deliberate: a consumer nobody has classified should
   * lose power before anything that has been reasoned about.
   *
   * This module holds the declaration, never the ordering rule — exactly as it holds
   * `siting` without knowing anything about grids or deposits.
   */
  readonly priorityClass?: number
  /** Colonists this structure can house once complete. `0` for non-habitat structures. */
  readonly habitatCapacity: number
}

/**
 * A validated structure type: the same information as the spec, but trusted, and
 * with the optional authoring conveniences resolved.
 *
 * `buildCost`, `siting` and `storageCapacity` are OPTIONAL on the spec and
 * REQUIRED here — `createCatalog` normalises an absent one to `{}`. That
 * asymmetry is the point. Authoring stays terse (write a field only when it means
 * something) while every CONSUMER gets exactly one shape to read, so no
 * downstream code needs `type.buildCost ?? {}` or `type.siting?.requiresDeposit`
 * — and no consumer can accidentally treat "author omitted it" differently from
 * "author wrote `{}`", since those are the same statement. `produces` and
 * `consumes` have always worked this way (required, authored as `{}`); after
 * validation the optional fields match them exactly.
 *
 * `priorityClass` follows the same rule with a non-`{}` default: absent normalises
 * to `PRIORITY_DEFAULT`, so no consumer writes `type.priorityClass ?? DEFAULT` and
 * no two consumers can pick different defaults.
 *
 * Still assignable to `StructureTypeSpec`, so a validated type can be fed back
 * into `createCatalog` (e.g. a save-file round trip) without adaptation.
 */
export interface StructureType extends StructureTypeSpec {
  readonly buildCost: ResourceAmounts
  readonly siting: SitingRequirements
  readonly storageCapacity: ResourceAmounts
  readonly standbyConsumes: ResourceAmounts
  readonly priorityClass: number
}

/**
 * A validated, immutable set of structure types.
 *
 * Backed by a Map built in declaration order: Map preserves insertion order, so
 * iteration is deterministic — a precondition of the whole simulation.
 */
export interface StructureCatalog {
  readonly types: ReadonlyMap<string, StructureType>
}

/**
 * The project's one non-negative-integer guard. Shared by `buildTurns`,
 * `habitatCapacity` AND every resource amount, deliberately: those are all
 * whole-unit quantities for the same determinism reason, and a second
 * near-identical guard would be the thing that eventually drifts.
 *
 * Rejects fractions, negatives, `NaN` and both infinities (`Number.isInteger` is
 * false for all three of the latter).
 */
function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received: ${value}`)
  }
}

function validateFootprint(id: string, footprint: readonly FootprintOffset[]): void {
  if (footprint.length === 0) {
    throw new RangeError(`Structure "${id}": footprint must contain at least one tile`)
  }

  const seen = new Set<string>()
  let hasAnchor = false

  for (const { dx, dy } of footprint) {
    // Fractional or non-finite offsets would silently corrupt tile indexing.
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new RangeError(
        `Structure "${id}": footprint offsets must be integers, received: (${dx}, ${dy})`,
      )
    }

    const key = `${dx},${dy}`
    if (seen.has(key)) {
      throw new RangeError(`Structure "${id}": duplicate footprint offset (${dx}, ${dy})`)
    }
    seen.add(key)

    if (dx === 0 && dy === 0) hasAnchor = true
  }

  if (!hasAnchor) {
    // Without this, a structure could be "placed" on a tile it does not occupy,
    // decoupling the placement anchor from occupancy accounting.
    throw new RangeError(`Structure "${id}": footprint must include the anchor (0, 0)`)
  }
}

/**
 * Validate ANY resource-amounts map — `produces`, `consumes`, `buildCost` or
 * `storageCapacity`. One function for all four deliberately: the integer base-unit
 * rule is a property of an AMOUNT, identical whether that amount is charged per
 * turn, charged once, or never charged at all. Four near-identical guards would be
 * the thing that eventually drifts, and a `buildCost` that quietly accepted 0.5 g
 * would break the determinism argument just as thoroughly as a `consumes` that did.
 *
 * Amounts must be non-negative INTEGERS in base units (Wh / grams) — the same
 * discipline `time.ts` applies to the clock, for the same reason; see the
 * base-units block at the top of this file. Enforced with the shared
 * `assertNonNegativeInteger` rather than a bespoke check so there is exactly one
 * definition of "whole unit" in the module.
 *
 * `label` is the field name and becomes part of the thrown message as
 * `<label>.<resource>`, so a failure says WHICH of the four maps was wrong — the
 * difference between "buildCost.silicon must be a non-negative integer" and an
 * error the author has to go guess at.
 *
 * Note what is NOT constrained: the resource KEY space stays open. A brand-new
 * resource kind is still pure data — the integer rule is a property of amounts,
 * never a whitelist of known resources.
 */
function validateResourceAmounts(id: string, amounts: ResourceAmounts, label: string): void {
  for (const [resource, amount] of Object.entries(amounts)) {
    if (resource.length === 0) {
      throw new RangeError(`Structure "${id}": ${label} has an empty resource key`)
    }
    assertNonNegativeInteger(amount, `Structure "${id}": ${label}.${resource}`)
  }
}

/**
 * Validate a `siting` block.
 *
 * `requiresDeposit` is checked only for PRESENCE-and-non-emptiness, matching how
 * `eligibleDepositKinds` validates a deposit-kind registry: the key space is open,
 * so the one thing knowable here is that an empty kind can never match any
 * deposit. Left unchecked, an empty string would present as "this structure can
 * never be placed anywhere, and nobody can say why" — a runtime mystery instead of
 * a load-time defect.
 *
 * Absent is legal and is the common case; it is not defaulted to some sentinel
 * kind, because "no requirement" and "requires kind X" are genuinely different
 * statements.
 */
function validateSiting(id: string, siting: SitingRequirements): void {
  const { requiresDeposit } = siting
  if (requiresDeposit !== undefined && requiresDeposit.length === 0) {
    throw new RangeError(
      `Structure "${id}": siting.requiresDeposit must be a non-empty string when present, ` +
        `received: ${JSON.stringify(requiresDeposit)}`,
    )
  }
}

/**
 * Validate a `standbyConsumes` map against the rated `consumes` it must be a subset
 * of.
 *
 * Two rules, both of which exist because the 20%-of-rated relationship lives in
 * AUTHORED DATA rather than in runtime arithmetic (see
 * `StructureTypeSpec.standbyConsumes` for why), and authored data can be wrong in
 * ways no amount-level check would notice — both figures are perfectly valid
 * integers on their own:
 *
 *   1. Standby may never EXCEED rated for a resource. A structure cannot cost more
 *      to idle than to run. Catches the transposition (32,000 standby against 6,400
 *      rated), which would otherwise produce a colony where switching a habitat off
 *      costs more power than running it.
 *   2. Standby may not name a resource the structure does not consume AT ALL. A rated
 *      draw of zero means "never draws this", so a positive standby figure for it is
 *      incoherent — and this is the exact shape a mistyped resource key takes
 *      (`electricty`), which rule 1 alone would let through as 5 > 0.
 *
 * Amount-level integer validation is NOT repeated here; `validateResourceAmounts`
 * already did it, so this function only checks the cross-field relationship.
 */
function validateStandbyConsumes(
  id: string,
  standbyConsumes: ResourceAmounts,
  consumes: ResourceAmounts,
): void {
  for (const [resource, standby] of Object.entries(standbyConsumes)) {
    const rated = consumes[resource] ?? 0
    if (standby > rated) {
      throw new RangeError(
        `Structure "${id}": standbyConsumes.${resource} (${standby}) must not exceed ` +
          `consumes.${resource} (${rated}) — a structure cannot cost more to idle than to run` +
          (rated === 0
            ? '. This structure does not consume that resource at all; check for a typo in the key.'
            : ''),
      )
    }
  }
}

function validateAndFreeze(specification: StructureTypeSpec): StructureType {
  const { id } = specification

  if (id.length === 0) {
    throw new RangeError('Structure id must be a non-empty string')
  }

  // Resolve the optional authoring fields ONCE, before validation, so the value
  // that gets validated is exactly the value that gets stored. Validating
  // `specification.buildCost` and separately defaulting it in the return object
  // would leave room for the two to disagree.
  const buildCost = specification.buildCost ?? {}
  const siting = specification.siting ?? {}
  const storageCapacity = specification.storageCapacity ?? {}
  const standbyConsumes = specification.standbyConsumes ?? {}
  const priorityClass = specification.priorityClass ?? PRIORITY_DEFAULT

  validateFootprint(id, specification.footprint)
  assertNonNegativeInteger(specification.buildTurns, `Structure "${id}": buildTurns`)
  assertNonNegativeInteger(
    specification.habitatCapacity,
    `Structure "${id}": habitatCapacity`,
  )
  assertNonNegativeInteger(priorityClass, `Structure "${id}": priorityClass`)
  validateResourceAmounts(id, specification.produces, 'produces')
  validateResourceAmounts(id, specification.consumes, 'consumes')
  validateResourceAmounts(id, buildCost, 'buildCost')
  validateResourceAmounts(id, storageCapacity, 'storageCapacity')
  validateResourceAmounts(id, standbyConsumes, 'standbyConsumes')
  validateStandbyConsumes(id, standbyConsumes, specification.consumes)
  validateSiting(id, siting)

  // Defensive copy of every mutable member: a catalog that aliases caller-owned
  // arrays or objects can be corrupted after it has already been validated —
  // including corrupted into a state that could never have passed validation, such
  // as a negative buildCost. Every map below is copied, not just the pre-existing
  // ones, and one authored object shared across two entries yields two independent
  // copies. `siting` is flat today so a spread copies it fully; if it ever gains a
  // nested member (a slope range, a latitude band) this copy must deepen with it.
  return {
    ...specification,
    footprint: specification.footprint.map(({ dx, dy }) => ({ dx, dy })),
    produces: { ...specification.produces },
    consumes: { ...specification.consumes },
    buildCost: { ...buildCost },
    siting: { ...siting },
    storageCapacity: { ...storageCapacity },
    standbyConsumes: { ...standbyConsumes },
    priorityClass,
  }
}

/**
 * Validate raw structure specs and build an immutable catalog.
 *
 * @throws {RangeError} if any spec is malformed. Catalog data is authored content,
 *   not player input, so a malformed entry is a build-time defect and fails loudly
 *   rather than degrading at runtime.
 */
export function createCatalog(specs: readonly StructureTypeSpec[]): StructureCatalog {
  const types = new Map<string, StructureType>()

  for (const specification of specs) {
    const validated = validateAndFreeze(specification)
    if (types.has(validated.id)) {
      throw new RangeError(`Duplicate structure id in catalog: "${validated.id}"`)
    }
    types.set(validated.id, validated)
  }

  return { types }
}

/** The structure type registered under `id`, or `undefined` if there is none. O(1). */
export function getStructureType(
  catalog: StructureCatalog,
  id: string,
): StructureType | undefined {
  return catalog.types.get(id)
}

/** All structure types, in declaration order. */
export function listStructureTypes(catalog: StructureCatalog): readonly StructureType[] {
  return [...catalog.types.values()]
}
