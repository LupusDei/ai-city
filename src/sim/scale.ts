/**
 * The physical scale of the grid: how many real metres one tile spans, and the
 * conversions from tile counts to real areal and mass quantities.
 *
 * This module exists because the grid had no physical scale anywhere in code or
 * spec, and every reality-grounded quantity the General asked for is areal or
 * volumetric — solar W/m2, shielding kg/m2, habitat m3 per colonist. None of
 * them can be stated, let alone validated against real engineering figures,
 * until a tile has a size. It is the load-bearing constant the three resource
 * chains hang off, in the same way `time.ts` is the load-bearing constant for
 * the turn cycle.
 *
 * THE PROPERTY THAT MATTERS: areal quantities scale with the SQUARE of the tile
 * edge, so a change to `TILE_EDGE_METRES` must move every derived figure by the
 * square of the ratio, with nothing hand-edited. That is why no areal number
 * (not 25 m2, not 450 t) is ever written as a literal anywhere — each one is
 * computed here from the single constant, and `tests/unit/scale.test.ts` proves
 * the square law holds by re-deriving the same figures at other edge lengths.
 *
 * Units are named in every identifier (`_METRES`, `_M2`, `KgPerM2`) because the
 * failure mode this module is here to prevent is a unit mix-up — a linear metre
 * multiplied where a square metre was meant is a 5x error that still typechecks.
 */

/**
 * Length of one tile edge, in metres. THE single source of truth for scale.
 *
 * RATIFIED BY THE GENERAL 2026-07-29: 1 tile = 5 m. This is locked; do not
 * re-derive it. The derivation is recorded here because the next person to read
 * this file will ask why 5 and not 10, and the answer is four independent
 * physical anchors that all agree, plus one design argument:
 *
 *   1. STARSHIP FITS THE PAD. The landed Starship is 9 m in diameter. A 2x3
 *      hull pad at 5 m is 10 m x 15 m — the hull clears the short axis with
 *      0.5 m to spare, which is a pad, not a parking lot. At a 10 m tile the
 *      same 2x3 pad is 20 m x 30 m: three hull-widths across, absurd.
 *   2. HABITAT VOLUME LANDS IN THE REALISTIC BAND. A 2x2 habitat is 100 m2,
 *      which at a 3 m ceiling is 300 m3, or ~31 m3 per colonist for a crew of
 *      8 once equipment volume is netted out. That is above NASA's ~25 m3
 *      long-duration floor and still austere — correct for a first colony. At a
 *      10 m tile it would be ~124 m3 per colonist, roomier per head than the
 *      ISS, which is not the story this sim tells.
 *   3. SHIELDING MASS STAYS TRACTABLE. Burying one 2x2 habitat under 3 m of
 *      bulk regolith is 450 t (see `arealMassKg`) — a hard but achievable
 *      drone-hauling target. At a 10 m tile it is 1,800 t, punishing to the
 *      point where the shielding mechanic stops being a decision and becomes a
 *      wall. This is the square law biting: 4x the mass for 2x the tile.
 *   4. THE MAP IS A PLAUSIBLE BASE. A 64x64 map spans 320 m, about 10 hectares
 *      — a realistic early-base footprint. 640 m would be a small town.
 *
 * And the design argument: tile size IS placement resolution. A 5 m tile gives
 * four times as many layout decisions per hectare as a 10 m tile, and layout
 * decisions are the game.
 *
 * The bead records 7.5 m as the fallback if roomier habitats are ever wanted,
 * which is why the helpers below accept an edge-length override rather than
 * hard-wiring this constant into their arithmetic.
 */
export const TILE_EDGE_METRES = 5

/**
 * Guards a physical quantity as strictly positive and finite.
 *
 * Fractional values are allowed — unlike the integer discipline in `time.ts`,
 * metres and densities are continuous, and the documented 7.5 m fallback edge
 * must be representable. Zero is rejected for the quantities that use this
 * guard: a zero-length tile edge collapses the grid to a point and would make
 * every areal figure zero, and a zero-density material is not a material. Both
 * are config errors rather than meaningful scenarios. `Number.isFinite` rejects
 * `NaN` and both infinities, so an infinite edge cannot silently produce an
 * infinite mass. `units` is passed in so the error names the right unit — a
 * kg/m3 density reported as "metres" is precisely the confusion this module
 * exists to prevent.
 */
function assertPositiveFinite(value: number, name: string, units: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite ${units} value, received: ${value}`)
  }
}

/**
 * Guards a tile count as a strictly positive integer.
 *
 * Tiles are discrete, so a fractional count is always a caller bug — most
 * likely an area in square metres passed where a tile count was expected, which
 * is exactly the unit mix-up this module is meant to catch. Zero is rejected
 * too: "the footprint of nothing" is not a quantity any caller legitimately
 * needs, and accepting it would let a mis-sized or unplaced building return a
 * plausible-looking 0 kg build cost instead of failing. Callers aggregating
 * over a colony should sum per-building results — an empty sum is already 0 —
 * rather than passing 0 here. `Number.isInteger` returns `false` for `NaN` and
 * both infinities, so all three are rejected by the same check.
 */
function assertPositiveTileCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer number of tiles, received: ${value}`)
  }
}

/**
 * Guards a physical quantity that may legitimately be zero.
 *
 * Used for berm depth and areal mass density, where zero is a real physical
 * state — an unshielded roof has 0 m of cover and 0 kg/m2 of mass, and a caller
 * asking for the mass of "no covering" should get 0 kg back rather than an
 * exception. That is the opposite call from tile counts and edge lengths above,
 * where zero is a config error. Negatives are nonsense, and infinities are
 * rejected here so they cannot propagate into the ledger as an unpayable cost.
 */
function assertNonNegativeFinite(value: number, name: string, units: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite ${units} value, received: ${value}`)
  }
}

/**
 * Area of a single tile, in square metres, for an arbitrary tile edge length.
 *
 * This is the ONE place the square law is written down. Everything areal in the
 * sim routes through it, so if the exponent were ever wrong it would be wrong
 * in exactly one place and every test in the suite would say so.
 *
 * @throws {RangeError} if `edgeMetres` is not a positive finite number.
 */
export function tileAreaForEdgeM2(edgeMetres: number): number {
  assertPositiveFinite(edgeMetres, 'edgeMetres', 'metre')
  return edgeMetres * edgeMetres
}

/**
 * Area of one tile at the locked scale: 5 m x 5 m = 25 m2.
 *
 * DERIVED, never hardcoded. If `TILE_EDGE_METRES` changes, this follows by the
 * square of the ratio automatically, along with everything computed from it.
 */
export const TILE_AREA_M2 = tileAreaForEdgeM2(TILE_EDGE_METRES)

/**
 * Real-world footprint, in square metres, of a building occupying `tileCount`
 * tiles.
 *
 * Examples at the locked scale: a 2x3 landing pad (6 tiles) is 150 m2; a 2x2
 * habitat (4 tiles) is 100 m2; a full 64x64 map (4,096 tiles) is 102,400 m2.
 *
 * @param tileCount number of tiles occupied — a positive integer.
 * @param tileEdgeMetres tile edge to measure against. Defaults to the locked
 *   `TILE_EDGE_METRES`; overridable so scale-sensitivity checks (and any future
 *   move to the 7.5 m fallback) can re-derive figures without editing this
 *   module or duplicating the square law in a test.
 * @throws {RangeError} if `tileCount` is not a positive integer or
 *   `tileEdgeMetres` is not a positive finite number.
 */
export function footprintAreaM2(tileCount: number, tileEdgeMetres: number = TILE_EDGE_METRES): number {
  assertPositiveTileCount(tileCount, 'tileCount')
  return tileCount * tileAreaForEdgeM2(tileEdgeMetres)
}

/**
 * Areal mass density, in kg/m2, of a layer `depthMetres` deep whose bulk
 * density is `bulkDensityKgPerM3`.
 *
 * The bridge between how the shielding mechanic is specified in physical terms
 * ("3 m of regolith") and what `arealMassKg` consumes (kg/m2), so no consumer
 * has to hardcode 4,500. Note the asymmetry with the square law above: depth is
 * a LINEAR dimension, so doubling berm depth doubles the mass, whereas doubling
 * the tile edge quadruples it.
 *
 * Density must be the BULK density of loose regolith (~1,500 kg/m3, i.e.
 * ~1.5 g/cm3), not the grain density of the mineral (~2,900 kg/m3): drones pile
 * unconsolidated material with void space, they do not cast solid rock. Using
 * grain density would overstate every berm by ~90%.
 *
 * @throws {RangeError} if `depthMetres` is negative or non-finite, or
 *   `bulkDensityKgPerM3` is not a positive finite number.
 */
export function arealDensityKgPerM2(depthMetres: number, bulkDensityKgPerM3: number): number {
  // Depth allows zero (nothing piled yet) but density does not: a zero-density
  // material is not a material, and treating it as one would silently make an
  // unshielded habitat look shielded for free.
  assertNonNegativeFinite(depthMetres, 'depthMetres', 'metre')
  assertPositiveFinite(bulkDensityKgPerM3, 'bulkDensityKgPerM3', 'kg/m3')
  return depthMetres * bulkDensityKgPerM3
}

/**
 * Total mass, in kilograms, of a covering of areal density `kgPerM2` spread
 * over `tileCount` tiles.
 *
 * This is what the shielding chain consumes. Worked example, and the number the
 * epic plan quotes: 3 m of bulk regolith is 3 m x 1,500 kg/m3 = 4,500 kg/m2, so
 * a 4-tile (2x2) habitat needs 4 x 25 m2 x 4,500 kg/m2 = 450,000 kg = 450 t.
 * `tests/unit/scale.test.ts` re-derives that 450 t from the constants so the
 * figure is pinned by a test rather than by this comment.
 *
 * The square law is what makes the tile-scale decision expensive here: the same
 * habitat at a 10 m tile needs 1,800 t, four times as much for twice the edge.
 *
 * @param tileCount number of covered tiles — a positive integer.
 * @param kgPerM2 areal mass density of the covering; 0 is allowed and yields 0.
 * @param tileEdgeMetres tile edge to measure against; defaults to the locked scale.
 * @throws {RangeError} if `tileCount` is not a positive integer, `kgPerM2` is
 *   negative or non-finite, or `tileEdgeMetres` is not a positive finite number.
 */
export function arealMassKg(
  tileCount: number,
  kgPerM2: number,
  tileEdgeMetres: number = TILE_EDGE_METRES,
): number {
  assertNonNegativeFinite(kgPerM2, 'kgPerM2', 'kg/m2')
  return footprintAreaM2(tileCount, tileEdgeMetres) * kgPerM2
}

/**
 * SCALE INVARIANCE OF SOLAR PAYBACK — recorded here because it is genuinely
 * useful and genuinely non-obvious, and because someone will otherwise re-derive
 * it every time the tile size is questioned.
 *
 * The solar payback period is the silicon cost of a panel divided by the energy
 * it yields per turn. BOTH are areal: cost is (kg silicon per m2) x area, yield
 * is (W per m2) x area. The area — and therefore the tile scale — cancels out of
 * the ratio entirely, so payback is 41 turns at a 5 m tile, at a 10 m tile, and
 * at any other tile size. It is invariant.
 *
 * The practical consequence: areal MASSES (shielding, build costs) must all be
 * re-derived if `TILE_EDGE_METRES` ever changes, but the solar payback mechanic
 * is robust to that decision and needs no rebalancing. Any RATIO of two areal
 * quantities shares this property; any single areal quantity does not.
 * `tests/unit/scale.test.ts` proves the invariance across a range of edge lengths.
 */
