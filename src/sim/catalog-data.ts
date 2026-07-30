/**
 * AUTHORED CATALOG DATA for resource chain 1 — regolith and the shielded habitat
 * (spec 002, `aic-d8y.1.2`).
 *
 * This module is DATA, and that is its entire contract. It contains no simulation rule,
 * no branch on a structure id, and nothing the turn loop calls per turn: it converts
 * reality-grounded figures (kilowatts, tonnes, metres of cover) into the integer base
 * units `createCatalog` accepts, ONCE, at the point of authorship — exactly as
 * `colony-start.ts` already does for the two landed hulls, and for the same reason. Every
 * conversion below is written out as arithmetic in a comment so a reviewer can check it
 * without recomputing it.
 *
 * ============================================================================
 * WHY THERE IS NO NEW CODE ANYWHERE ELSE (spec 002 FR-002)
 * ----------------------------------------------------------------------------
 * Adding these three structures required no change to `placement.ts`, `ledger.ts`,
 * `brownout.ts` or `turn.ts`, and that is the property the chain exists to prove:
 *
 *   - The Hopper PRODUCES because `turn.ts` already routes every powered, complete
 *     structure's `produces`/`consumes` into `applyLedger`.
 *   - It DRAWS because `power.ts` already reads `consumes.electricity`.
 *   - It is SHED FIRST because `brownout.ts` already orders consumers by the
 *     `priorityClass` a catalog entry declares.
 *   - Its pile is CAPPED because `turn.ts` already sums `storageCapacity` across
 *     operating structures and `ledger.ts` already reports the excess as `Overflow`.
 *   - Its L-shaped and ring-shaped siblings PLACE because `placement.ts` already
 *     resolves an arbitrary footprint tile by tile.
 *
 * `regolith` and `sinteredPlate` needed no registration anywhere: `ResourceAmounts` is an
 * open string-keyed record precisely so an invented resource kind is pure data (see
 * `catalog.ts`). If anything in `src/sim` ever grows an `if (id === 'regolith-hopper')`,
 * that is the defect this module was written to make unnecessary.
 * ============================================================================
 *
 * ============================================================================
 * THE BERM COST IS DERIVED FROM THE TILE EDGE, NOT TYPED (FR-008, `aic-ck0`)
 * ----------------------------------------------------------------------------
 * `scale.ts` existed for a full epic with ZERO production consumers, which meant spec
 * 002's acceptance criterion "berm cost derived from the tile-edge constant" would have
 * passed with a hand-typed `450_000_000`. This module is the consumer that closes that:
 * the berm's fill and crust are computed through `arealMassKg`/`arealDensityKgPerM2`, so
 * a change to `TILE_EDGE_METRES` moves them by the square of the ratio with nothing
 * hand-edited.
 *
 * Three separate things enforce it, because any one alone is defeatable:
 *   1. `tests/unit/catalog-data.test.ts` asserts the authored cost EQUALS the derivation.
 *      (A hand-typed literal would also pass this.)
 *   2. The same suite calls `chainOneStructureSpecs(config, TILE_EDGE_METRES * 2)` and
 *      asserts both costs quadruple. (A literal cannot move; this catches it.)
 *   3. `tests/integration/composition-audit.test.ts` — `scale.arealMassKg` and
 *      `scale.arealDensityKgPerM2` LEAVING `ACCEPTED_ORPHANS` is what proves a production
 *      module genuinely calls the derivation rather than merely agreeing with its answer.
 * ============================================================================
 *
 * WHO CONSUMES THIS, AND WHO DOES NOT YET. These specs are the player's BUILD MENU. The
 * adapter that offers a build menu to the UI (`aic-8tl.5`) does not exist yet, so this
 * module has no production caller today — the same honest state `colony-start.ts`'s own
 * entry points are in, and it is recorded in the composition ratchet's allowlist rather
 * than left for someone to discover. The starting colony deliberately does NOT get these
 * structures: chain 1 is buildable, not pre-placed.
 *
 * Determinism: pure functions of their arguments' values. No `Math.random`, no clock, no
 * I/O, no mutation. The only division and the only rounding happen inside `power.ts`'s
 * `energyPerTurnWh` and this module's own `arealMassGrams`, each once, at the point of
 * authorship — never in a per-turn path.
 */

import {
  PRIORITY_PROCESSOR_DOWNSTREAM,
  PRIORITY_PROCESSOR_UPSTREAM,
} from './brownout'
import type { FootprintOffset, ResourceAmounts, StructureTypeSpec } from './catalog'
import { ELECTRICITY, energyPerTurnWh } from './power'
import { TILE_EDGE_METRES, arealDensityKgPerM2, arealMassKg } from './scale'
import type { TurnCycleConfig } from './time'

// ---------------------------------------------------------------------------
// Resource keys
// ---------------------------------------------------------------------------

/**
 * The canonical resource key for bulk regolith, denominated in GRAMS.
 *
 * Exported for the same reason `power.ts` exports `ELECTRICITY`: the resource key space is
 * deliberately open, so `catalog.ts` validates that a key is a non-empty string and cannot
 * possibly catch a typo. A second spelling anywhere silently splits the resource into two
 * that never net against each other, and no test would fail. One spelling, one home.
 */
export const REGOLITH = 'regolith'

/** The canonical resource key for sintered plate, denominated in GRAMS. See {@link REGOLITH}. */
export const SINTERED_PLATE = 'sinteredPlate'

// ---------------------------------------------------------------------------
// Structure ids
// ---------------------------------------------------------------------------

/** Catalog id of the Regolith Hopper. */
export const REGOLITH_HOPPER_ID = 'regolith-hopper'
/** Catalog id of the Sinter Press. */
export const SINTER_PRESS_ID = 'sinter-press'
/** Catalog id of the Shield Berm. */
export const SHIELD_BERM_ID = 'shield-berm'

// ---------------------------------------------------------------------------
// Physical constants behind the authored figures
// ---------------------------------------------------------------------------

/** Grams per kilogram. Named so no conversion below is a bare `* 1000`. */
const GRAMS_PER_KILOGRAM = 1000

/**
 * BULK density of loose Martian regolith: ~1,500 kg/m³ (~1.5 g/cm³).
 *
 * This must be the bulk density of unconsolidated material, NOT the ~2,900 kg/m³ grain
 * density of the basaltic minerals it is made of — drones heap loose fines with void
 * space between them, they do not cast solid rock. Using grain density would overstate
 * every berm by ~93% (870 t instead of 450 t for the same 3 m of cover), and it would
 * still typecheck, still be an integer, and still look plausible. `scale.ts`'s
 * `arealDensityKgPerM2` documents the same trap from the other side.
 */
export const REGOLITH_BULK_DENSITY_KG_PER_M3 = 1500

/**
 * Density used for the berm's sintered crust: 1,500 kg/m³.
 *
 * RATIFIED FIGURE, and deliberately a SEPARATE constant from
 * {@link REGOLITH_BULK_DENSITY_KG_PER_M3} even though the two currently agree, because
 * they are different physical claims about different materials and a future correction to
 * one must not silently move the other.
 *
 * PHYSICS NOTE, flagged rather than silently "fixed": real sintered basaltic plate would
 * be denser than loose fines — 2,000–2,900 kg/m³ depending on how much porosity survives.
 *
 * CORRECTED to 2,200 (aic-to6.3). Spec 002 originally specified 1,500 kg/m³ here, which was
 * MY ERROR when writing that spec: 1,500 is the bulk density of loose piled fines, and
 * sintering is precisely the process that removes that porosity. A sintered plate cannot
 * have the density of the dust it was made from. 2,200 is the low-porosity end of the real
 * range, appropriate for a thin microwave-sintered cap rather than a cast slab.
 *
 * The standing order is physics first, except where game mechanics and fun override — and
 * here they do not conflict, they AGREE. The wrong number made the chain read as "7.5
 * Hopper-turns of digging against 6.2 Press-turns of pressing", which I described in the
 * proposal as nicely matched. The correct number makes it 7.5 against 9.2, so the PRESS is
 * the bottleneck — which is the chain's entire thesis: digging is nearly free, heat is
 * ruinous. Correct physics tells the intended story better than my error did.
 *
 * Found by the implementing agent, which kept 7.5 t rather than changing a spec figure on
 * its own authority and filed aic-to6.3 so it could be decided. That was the right call.
 */
export const SINTERED_CRUST_DENSITY_KG_PER_M3 = 2200

/**
 * Depth of bulk regolith a Shield Berm piles over the module it shields: 3 m.
 *
 * Mars surface radiation is ~0.64 mSv/day (RAD on Curiosity, ~230 mSv/yr). That is a
 * hazard engineered around with MASS, not with a thicker wall, and ~3 m of regolith is the
 * commonly-cited depth for cutting surface dose to roughly terrestrial background. Depth
 * is LINEAR in the resulting mass, unlike the tile edge, which is quadratic.
 */
export const BERM_FILL_DEPTH_METRES = 3

/**
 * Depth of the berm's sintered crust: 0.05 m.
 *
 * The crust holds the loose fill against dust mobilisation and slow slope creep. NOT
 * against wind loading: the Martian atmosphere is ~610 Pa and carries very little force,
 * so anyone sizing this against terrestrial wind pressure would over-build it by orders of
 * magnitude.
 */
export const BERM_CRUST_DEPTH_METRES = 0.05

/**
 * Tiles of habitat one berm shields: 4, i.e. one 2x2 module.
 *
 * The berm's MASS is dimensioned by the area it must COVER (the module's 100 m² of roof),
 * while its FOOTPRINT is the skirt the fill physically sits on — see
 * {@link SHIELD_BERM_FOOTPRINT}. Those are genuinely different areas and conflating them
 * is the easy mistake here.
 *
 * A CONSTANT rather than a read of the habitat's own footprint length because there is no
 * habitat catalog entry in production yet (only the golden scenario's test fixture). When
 * one lands, this must become `habitat.footprint.length` so the two cannot drift — a berm
 * sized for a 2x2 applied to a 2x3 module would under-shield it and nothing would say so.
 */
export const SHIELDED_MODULE_TILES = 4

/**
 * Tiles of ground the Regolith Hopper heaps its spoil across: 9 — its own tile plus the
 * eight adjacent.
 *
 * The Hopper occupies one tile; the PILE does not fit on one tile, and pretending it does
 * would make the cap absurdly small. A 3x3 apron is 15 m x 15 m of working ground around
 * a digging machine, which is modest.
 */
export const HOPPER_HEAP_TILES = 9

/**
 * Average depth of the Hopper's spoil heap: 2 m.
 *
 * CHOSEN AGAINST THE ANGLE OF REPOSE, not for convenience. Dry granular basaltic fines
 * stand at ~35–45°. A square-pyramidal heap on a 15 m base at 40° peaks at
 * 7.5 m x tan40° = 6.3 m and therefore AVERAGES ~2.1 m over its footprint, so 2 m is a
 * heap that will actually stand up. 3 m (the berm depth) would have needed bunding or a
 * steeper face than loose regolith holds, and would have been a physics error hiding
 * behind a tidy-looking reuse of another constant.
 */
export const HOPPER_HEAP_DEPTH_METRES = 2

// ---------------------------------------------------------------------------
// Ratified throughput and draw figures
// ---------------------------------------------------------------------------

/** Regolith Hopper operating draw: 12 kW, i.e. 30% of one 40 kWe reactor unit. */
export const HOPPER_DRAW_WATTS = 12_000

/**
 * Regolith Hopper throughput: 60 t of bulk regolith per turn.
 *
 * 60 t x 1,000 kg/t x 1,000 g/kg = 60,000,000 g. Moving a kilogram of dirt costs
 * ~0.01 kWh, which is why this figure is enormous next to the Press's: over a 49.66 h turn
 * a 12 kW machine has ~596 kWh to spend, and haulage is nearly free.
 */
export const HOPPER_REGOLITH_PER_TURN_G = 60_000_000

/** Sinter Press operating draw: 30 kW, i.e. 75% of one 40 kWe reactor unit. */
export const SINTER_PRESS_DRAW_WATTS = 30_000

/**
 * Sinter Press feedstock: 1.4 t of regolith per turn. 1.4 t -> 1,400,000 g.
 *
 * Sintering regolith to ~1,100 °C has a thermodynamic floor of 0.244 kWh/kg (specific
 * heat ~0.8 kJ/kg·K over an 1,100 K rise); at a realistic ~20% process efficiency that is
 * ~1.2 kWh/kg, and a 30 kW machine over a 49.66 h turn has ~1,490 kWh — hence ~1.2 t of
 * output, and this is what makes the Press the bottleneck rather than the Hopper.
 */
export const PRESS_REGOLITH_PER_TURN_G = 1_400_000

/**
 * Sinter Press output: 1.2 t of sintered plate per turn. 1.2 t -> 1,200,000 g.
 *
 * Deliberately LESS than {@link PRESS_REGOLITH_PER_TURN_G}: ~200 kg a turn leaves as
 * adsorbed volatiles and lost fines. A process whose output mass exceeded its input mass
 * would be a perpetual-motion machine, and the only thing that catches that is comparing
 * the two figures — which `tests/unit/catalog-data.test.ts` does.
 */
export const PRESS_PLATE_PER_TURN_G = 1_200_000

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** The Hopper: one tile, its own anchor. */
const REGOLITH_HOPPER_FOOTPRINT: readonly FootprintOffset[] = [{ dx: 0, dy: 0 }]

/**
 * The Press: an L of three tiles.
 *
 *     X .
 *     X X
 *
 * Three tiles that are not collinear, which is the whole point of specifying an L rather
 * than a 1x3 — it exercises `placement.ts`'s per-tile footprint resolution on a shape with
 * a concave corner, and it is the shape spec 002 names.
 */
const SINTER_PRESS_FOOTPRINT: readonly FootprintOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
]

/**
 * The Berm: a 12-tile skirt ringing a 4x4 block whose 2x2 interior is the habitat.
 *
 *     X X X X        (0,0) is the ring's top-left corner and the berm's anchor.
 *     X . . X        The four interior tiles are NOT part of the footprint: the
 *     X . . X        habitat already stands on them, so the berm places around it
 *     X X X X        with no overlap and no new placement rule.
 *
 * WHY A REAL FOOTPRINT AND NOT A FLAG ON THE HABITAT: 450 t of fill has to sit somewhere,
 * and a boolean would be honest about nothing — it would cost no ground, block no layout,
 * and make shielding free in the only currency (space) the player is actually managing.
 *
 * The ADJACENCY RULE — that the ring's hole must coincide with a completed habitat's four
 * tiles — is spec 002 FR-010 and belongs to the phase that implements rating (`aic-d8y.4`).
 * This module declares the shape; it does not enforce the relationship, exactly as
 * `catalog.ts` holds `siting.requiresDeposit` without knowing what a deposit is.
 */
const SHIELD_BERM_FOOTPRINT: readonly FootprintOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 2, dy: 0 },
  { dx: 3, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 3, dy: 1 },
  { dx: 0, dy: 2 },
  { dx: 3, dy: 2 },
  { dx: 0, dy: 3 },
  { dx: 1, dy: 3 },
  { dx: 2, dy: 3 },
  { dx: 3, dy: 3 },
]

// ---------------------------------------------------------------------------
// The one conversion this module owns
// ---------------------------------------------------------------------------

/**
 * Mass, in whole GRAMS, of a layer `depthMetres` deep at `bulkDensityKgPerM3` spread over
 * `tileCount` tiles of `tileEdgeMetres` ground.
 *
 * The single bridge between `scale.ts` (which works in metres and kilograms, because that
 * is how the physics is specified) and `catalog.ts` (which demands whole grams). Both
 * halves are delegated: `arealDensityKgPerM2` turns depth-and-density into kg/m², and
 * `arealMassKg` applies the square law to the tile count. Nothing here re-implements
 * either, so the tile-edge dependency is real rather than replicated.
 *
 * ROUNDED ONCE, HERE. `BERM_CRUST_DEPTH_METRES` is 0.05, which is not exactly
 * representable in binary floating point, so the kilogram figure can land a few
 * ulps off an integer and arrive at `createCatalog` as 7500000.000000001 — rejected three
 * modules away with no hint of where the fraction came from. Rounding at the point of
 * conversion is the same discipline `power.ts`'s `energyPerTurnWh` and
 * `DRONE_TURN_CAPACITY_WH` apply, and for the same reason.
 *
 * @throws {RangeError} if `tileCount` is not a positive integer, `depthMetres` is negative
 *   or non-finite, or either density or `tileEdgeMetres` is not positive and finite — all
 *   delegated to `scale.ts`'s own guards, never re-implemented here.
 */
function arealMassGrams(
  tileCount: number,
  depthMetres: number,
  bulkDensityKgPerM3: number,
  tileEdgeMetres: number,
): number {
  const kilograms = arealMassKg(
    tileCount,
    arealDensityKgPerM2(depthMetres, bulkDensityKgPerM3),
    tileEdgeMetres,
  )
  return Math.round(kilograms * GRAMS_PER_KILOGRAM)
}

// ---------------------------------------------------------------------------
// The entries
// ---------------------------------------------------------------------------

/**
 * The Shield Berm's one-time bill of materials, derived arealy from the tile edge.
 *
 *   fill  = 4 tiles x 25 m² = 100 m²; 3 m x 1,500 kg/m³ = 4,500 kg/m²
 *           -> 450,000 kg -> 450,000,000 g   (7.5 Hopper-turns)
 *   crust = the same 100 m²; 0.05 m x 1,500 kg/m³ = 75 kg/m²
 *           ->   7,500 kg ->   7,500,000 g   (6.25 Press-turns)
 *
 * Both figures are the OUTPUT of the derivation, not a literal that happens to match it.
 * At a 10 m tile edge the same call returns 1,800,000,000 g and 30,000,000 g — four times
 * as much for twice the edge, which is the square law and is asserted by test.
 */
function shieldBermBuildCost(tileEdgeMetres: number): ResourceAmounts {
  return {
    [REGOLITH]: arealMassGrams(
      SHIELDED_MODULE_TILES,
      BERM_FILL_DEPTH_METRES,
      REGOLITH_BULK_DENSITY_KG_PER_M3,
      tileEdgeMetres,
    ),
    [SINTERED_PLATE]: arealMassGrams(
      SHIELDED_MODULE_TILES,
      BERM_CRUST_DEPTH_METRES,
      SINTERED_CRUST_DENSITY_KG_PER_M3,
      tileEdgeMetres,
    ),
  }
}

/**
 * Chain 1's three structure specs, in menu order: Hopper, Press, Berm.
 *
 * RAW SPECS, not a built catalog. The caller runs them through `createCatalog`, which is
 * the project's one validation boundary — returning a pre-built catalog from here would
 * either duplicate that boundary or hide it, and a caller assembling a full build menu
 * needs to concatenate these with other chains' entries before validating anything.
 *
 * @param config the turn cycle every wattage is converted against. A structure's PHYSICAL
 *   fact is its draw in watts; `consumes.electricity` is watt-hours PER TURN, so it is a
 *   function of how long a turn is. Passing the config rather than reading
 *   `DEFAULT_TURN_CYCLE` means a scenario running a different cycle gets correct figures
 *   instead of silently wrong ones — the same choice `colony-start.ts`'s `hullSpecs` makes.
 * @param tileEdgeMetres tile edge the AREAL costs are measured against. Defaults to the
 *   locked `TILE_EDGE_METRES`; overridable for exactly the reason `scale.ts`'s helpers take
 *   the same override — so a scale-sensitivity test can re-derive the berm cost at another
 *   edge length without this module (or the square law) being duplicated in a test.
 * @throws {RangeError} if `config` fails `time.ts`'s validation or `tileEdgeMetres` is not
 *   a positive finite number. Both are delegated to the modules that own those rules.
 */
export function chainOneStructureSpecs(
  config: TurnCycleConfig,
  tileEdgeMetres: number = TILE_EDGE_METRES,
): readonly StructureTypeSpec[] {
  return [
    {
      id: REGOLITH_HOPPER_ID,
      name: 'Regolith Hopper',
      footprint: REGOLITH_HOPPER_FOOTPRINT,
      // Two turns of drone work. Cheap on purpose: the acquisition stage should never be
      // what the player is waiting on — see the 40x over-feed.
      buildTurns: 2,
      produces: { [REGOLITH]: HOPPER_REGOLITH_PER_TURN_G },
      // 12,000 W x 178,775 s / 3,600 s/h = 595,916.67 -> 595,917 Wh per turn. Converted
      // by `energyPerTurnWh`, never hand-typed: a turn is 49.6597 h, so the watt-hour
      // figure is NOT 12,000 and a literal would be wrong by a factor of ~50.
      consumes: { [ELECTRICITY]: energyPerTurnWh(HOPPER_DRAW_WATTS, config) },
      // NO `siting` (FR-006). Absence is the statement: Martian soil is ~45 wt% SiO2 and
      // ~18 wt% iron oxide essentially everywhere (Curiosity APXS/CheMin), so regolith
      // needs no deposit and a player who lands badly can still shield a habitat. This is
      // also why chain 1 is not blocked behind typed deposits.
      //
      // THE PILE'S CAP LIVES HERE, and this is the only structure in chain 1 that could
      // hold it: a hopper IS a bin. 9 tiles x 25 m² = 225 m² of apron, heaped 2 m deep at
      // 1,500 kg/m³ = 3,000 kg/m² -> 675,000 kg -> 675,000,000 g. That is 11.25 turns of
      // this machine's own output, so a Hopper with nothing downstream overflows on turn
      // 12 (`ledger.ts` reports it as `Overflow`, never discards it silently), while still
      // holding one whole berm's 450 t of fill with 50% headroom — without which SC-001's
      // "one Hopper supplies one berm" would deadlock at full-and-overflowing.
      storageCapacity: {
        [REGOLITH]: arealMassGrams(
          HOPPER_HEAP_TILES,
          HOPPER_HEAP_DEPTH_METRES,
          REGOLITH_BULK_DENSITY_KG_PER_M3,
          tileEdgeMetres,
        ),
      },
      // Shed FIRST of everything in this chain: feedstock is abundant, so losing a turn of
      // digging costs a stockpile that was overflowing anyway. `brownout.ts` owns why.
      priorityClass: PRIORITY_PROCESSOR_UPSTREAM,
      habitatCapacity: 0,
    },
    {
      id: SINTER_PRESS_ID,
      name: 'Sinter Press',
      footprint: SINTER_PRESS_FOOTPRINT,
      // Six turns: three times the Hopper. The bottleneck stage is expensive to stand up
      // as well as expensive to run.
      buildTurns: 6,
      produces: { [SINTERED_PLATE]: PRESS_PLATE_PER_TURN_G },
      // 30,000 W x 178,775 s / 3,600 s/h = 1,489,791.67 -> 1,489,792 Wh per turn, plus
      // 1.4 t of feedstock. Both are PER-TURN operating draws, not a build cost.
      consumes: {
        [ELECTRICITY]: energyPerTurnWh(SINTER_PRESS_DRAW_WATTS, config),
        [REGOLITH]: PRESS_REGOLITH_PER_TURN_G,
      },
      // Shed AFTER its own feeder, which reads backwards until you look at the numbers:
      // one Hopper over-feeds one Press by ~43x, so shedding the Press costs the chain's
      // entire output while shedding the Hopper costs an overflow. `brownout.ts` owns why.
      priorityClass: PRIORITY_PROCESSOR_DOWNSTREAM,
      // NO `storageCapacity` for `sinteredPlate`, deliberately. Plate has no producer in
      // production until the Press is wired (`aic-d8y.3`), and `ledger.ts` leaves an
      // uncapped STOCK unbounded, so authoring a plate cap now would invent a balance
      // figure ahead of the phase that can playtest it. FR-003 wants every stockpile
      // capped; that cap belongs with the phase that makes plate accumulate.
      habitatCapacity: 0,
    },
    {
      id: SHIELD_BERM_ID,
      name: 'Shield Berm',
      footprint: SHIELD_BERM_FOOTPRINT,
      // MATERIAL-GATED, NOT LABOUR-GATED. `buildTurns: 0` means "needs no drone-hours"
      // (`catalog.ts`: complete on arrival), so the berm's ~7.5-turn duration is emergent
      // from the rate material arrives rather than a hardcoded figure. The accumulation
      // rule itself is `aic-d8y.4`; what is authored here is the bill of materials it
      // accumulates toward.
      buildTurns: 0,
      produces: {},
      // Draws nothing, ever: it is a pile of dirt. A zero-draw consumer is never shed
      // (`brownout.ts`), so it also cannot be a brownout victim, and it therefore needs no
      // `priorityClass` — the default (last) is free for a structure that demands nothing.
      consumes: {},
      buildCost: shieldBermBuildCost(tileEdgeMetres),
      habitatCapacity: 0,
    },
  ]
}
