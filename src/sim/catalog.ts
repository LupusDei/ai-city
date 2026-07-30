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
 */

/** A tile offset relative to a structure's anchor tile. */
export interface FootprintOffset {
  readonly dx: number
  readonly dy: number
}

/**
 * Per-turn resource amounts, keyed by resource kind.
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

/** The raw, caller-supplied shape. Validated by `createCatalog`. */
export interface StructureTypeSpec {
  readonly id: string
  readonly name: string
  /** Tiles occupied, relative to the anchor. Must include the anchor `(0,0)`. */
  readonly footprint: readonly FootprintOffset[]
  /** Turns of drone work to complete. `0` means pre-placed (e.g. a landed starship). */
  readonly buildTurns: number
  readonly produces: ResourceAmounts
  readonly consumes: ResourceAmounts
  /** Colonists this structure can house once complete. `0` for non-habitat structures. */
  readonly habitatCapacity: number
}

/** A validated structure type. Structurally identical to the spec, but trusted. */
export type StructureType = StructureTypeSpec

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
 * Validate one `produces`/`consumes` map.
 *
 * Amounts must be non-negative INTEGERS in base units (Wh / grams) — the same
 * discipline `time.ts` applies to the clock, for the same reason; see the
 * base-units block at the top of this file. Enforced with the shared
 * `assertNonNegativeInteger` rather than a bespoke check so there is exactly one
 * definition of "whole unit" in the module.
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

function validateAndFreeze(specification: StructureTypeSpec): StructureType {
  const { id } = specification

  if (id.length === 0) {
    throw new RangeError('Structure id must be a non-empty string')
  }

  validateFootprint(id, specification.footprint)
  assertNonNegativeInteger(specification.buildTurns, `Structure "${id}": buildTurns`)
  assertNonNegativeInteger(
    specification.habitatCapacity,
    `Structure "${id}": habitatCapacity`,
  )
  validateResourceAmounts(id, specification.produces, 'produces')
  validateResourceAmounts(id, specification.consumes, 'consumes')

  // Defensive copy of every mutable member: a catalog that aliases caller-owned
  // arrays or objects can be corrupted after it has already been validated.
  return {
    ...specification,
    footprint: specification.footprint.map(({ dx, dy }) => ({ dx, dy })),
    produces: { ...specification.produces },
    consumes: { ...specification.consumes },
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
