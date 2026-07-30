/**
 * The data-driven structure catalog.
 *
 * Structure types are DATA, never code branches. Adding a new structure — or a new
 * resource kind such as silica, oxygen or hydrogen — must require only a new catalog
 * entry, with no change to simulation logic. `createCatalog` is the boundary where
 * that untrusted data is validated once, so the rest of the sim can treat catalog
 * contents as known-good.
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
 * non-empty strings mapped to finite non-negative numbers.
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

function validateResourceAmounts(id: string, amounts: ResourceAmounts, label: string): void {
  for (const [resource, amount] of Object.entries(amounts)) {
    if (resource.length === 0) {
      throw new RangeError(`Structure "${id}": ${label} has an empty resource key`)
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(
        `Structure "${id}": ${label}.${resource} must be a finite non-negative number, received: ${amount}`,
      )
    }
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
