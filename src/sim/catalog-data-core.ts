/**
 * AUTHORED CATALOG DATA for the core power-vs-labour roster: a buildable Reactor Unit
 * and a buildable Habitat Module (aic-oby.4, the balance pass).
 *
 * ============================================================================
 * THE GAP THIS MODULE CLOSES
 * ----------------------------------------------------------------------------
 * Before this module, `catalog-data.ts` (chain 1: Regolith Hopper, Sinter Press, Shield
 * Berm) was the only authored catalog data reaching production, and its own header says
 * outright: "there is no habitat catalog entry in production yet". Every structure with
 * `habitatCapacity > 0` anywhere in this codebase lived in a test fixture
 * (`tests/integration/golden-scenario.ts`, a dozen unit-test builders) — never in data a
 * real mission could build from. `mission.ts`'s win condition compares completed
 * habitat capacity against `MissionConfig.incomingWaveSize`; with no buildable structure
 * ever reporting a non-zero `habitatCapacity`, that comparison could never be won. The
 * balance pass this module belongs to cannot MEASURE a death spiral without something to
 * spiral around, so the two structures the design already assumes — see `turn.ts`'s and
 * `power.ts`'s own module headers, which discuss "a habitat" and "a reactor" as if both
 * already existed in the catalog — are authored here, as data, following the exact
 * pattern `catalog-data.ts` established for chain 1.
 *
 * NO SIM LOGIC CHANGES ANYWHERE. Precisely as chain 1's own header argues: the reactor
 * generates because `turn.ts` already routes every powered, complete generator's
 * `produces` into the grid; the habitat draws standby because `power.ts`'s
 * `electricityDrawWh` already reads `standbyConsumes` for any complete-but-unproductive
 * structure; the habitat is shed before life support and after nothing (there is no life
 * support catalog entry yet) because `brownout.ts` already orders by `priorityClass`;
 * its capacity counts toward the mission verdict because `mission.ts` already sums
 * `habitatCapacity` across completed structures. If either entry below needed a new `if`
 * anywhere in `src/sim`, that would be the defect this module exists to avoid.
 *
 * ============================================================================
 * RATIFIED PHYSICS vs. THIS BEAD'S OWN BALANCE DATA
 * ----------------------------------------------------------------------------
 * Two figures below are REUSED, not invented, and must never be restated as a bare
 * literal that could drift from their source:
 *   - The reactor's rated output is `power.ts`'s `REACTOR_OUTPUT_WATTS` (40 kWe, the
 *     NASA Fission Surface Power baseline) — the SAME figure the landed reactor hull
 *     already generates (`colony-start.ts`). This structure is simply a second,
 *     buildable unit of the identical hardware; there is no second reactor design.
 *   - The habitat's rated/standby draw (32 kW / ~20% -> 6.4 kW) is `catalog.ts`'s own
 *     cited, RATIFIED figure (aic-96o) — two independent physical derivations agreed,
 *     which is why `catalog.ts`'s `standbyConsumes` doc cites it by name. Every
 *     multi-turn test fixture in this codebase already assumes exactly these two
 *     numbers, which is corroborating evidence this is the project's settled figure,
 *     not a guess made here.
 *
 * Everything else — `buildTurns` for both structures, and `HABITAT_CAPACITY_PER_MODULE`
 * — is this bead's OWN balance data: no prior document ratifies a specific habitat
 * headcount or a specific labour cost for either structure. These are exactly the
 * numbers a headless balance pass (`src/sim/mission-runner.ts`) exists to measure and
 * this bead is charged with tuning. See `docs/balance-report.md` for the measured
 * verdict and the reasoning behind the values landed here.
 *
 * Both structures are free to build in materials (`buildCost: {}`, the default): the
 * design's central tension is POWER versus LABOUR, not a materials economy — chain 1's
 * regolith/plate chain is a separate, independently-gated resource loop that does not
 * feed habitat capacity or power in the current build (see this module's own test file
 * and `docs/balance-report.md` for why that separation is deliberate for this pass).
 *
 * Determinism: pure data, converted once at authorship exactly like `catalog-data.ts`.
 * No `Math.random`, no clock, no I/O, no mutation.
 */

import { PRIORITY_HABITAT } from './brownout'
import type { FootprintOffset, StructureTypeSpec } from './catalog'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from './power'
import type { TurnCycleConfig } from './time'

// ---------------------------------------------------------------------------
// Structure ids
// ---------------------------------------------------------------------------

/** Catalog id of the buildable Reactor Unit. */
export const REACTOR_UNIT_ID = 'reactor-unit'
/** Catalog id of the buildable Habitat Module. */
export const HABITAT_MODULE_ID = 'habitat-module'

// ---------------------------------------------------------------------------
// Ratified figures, reused (see the module header — do not restate as literals)
// ---------------------------------------------------------------------------

/**
 * The habitat's rated (fully productive) electricity draw: 32 kW.
 *
 * RATIFIED (aic-96o) — see `catalog.ts`'s `standbyConsumes` doc, which cites this exact
 * figure as the basis for the 20%-of-rated standby derivation below.
 */
export const HABITAT_RATED_DRAW_WATTS = 32_000

/**
 * The habitat's standby (complete, unmanned) electricity draw: 6.4 kW, ~20% of rated.
 *
 * RATIFIED (aic-96o), by two independent derivations that agree — see `catalog.ts`'s
 * `standbyConsumes` doc for both. NOT computed here as "20% of `HABITAT_RATED_DRAW_WATTS`":
 * that division belongs at the point of physical derivation (already performed, and
 * cited, in `catalog.ts`), not re-derived as a runtime-adjacent constant here — the same
 * discipline that doc itself argues for ("WHY IT IS DATA AND NOT A FRACTION").
 */
export const HABITAT_STANDBY_DRAW_WATTS = 6_400

// ---------------------------------------------------------------------------
// This bead's own balance data (see the module header)
// ---------------------------------------------------------------------------

/**
 * Build-turns of drone labour for one Reactor Unit: 8.
 *
 * Deliberately CHEAPER than the habitat below — a reactor is the "safe" build a
 * considered player reaches for, and it must be affordable enough that catching a
 * brownout early (aic-oby.4's "recoverable if caught early" requirement) genuinely
 * means "build a reactor, recover within a handful of turns", not "spend a quarter of
 * the mission on it".
 *
 * MEASURED, NOT GUESSED, and the numbers moved twice before landing here —
 * `docs/balance-report.md` walks the measurement: an initial 4-turn reactor let a
 * "considered" strategy solve the whole 278-turn mission by turn ~10 (the game was
 * trivially easy), and even at a 40-turn reactor a caught-early recovery (correcting at
 * turn 90) still lost, because construction's strict queue-order dam made a corrective
 * reactor wait behind whatever habitat the naive phase had already queued. 8 is the
 * figure at which the full battery of headless runs (naive/considered/recovery/
 * late-recovery, `tests/integration/balance-pass.test.ts`) passes.
 */
export const REACTOR_BUILD_TURNS = 8

/**
 * Build-turns of drone labour for one Habitat Module: 80.
 *
 * Ten times the reactor's cost: habitats are the colony's GOAL, not its
 * infrastructure, and the design's tension requires them to be a real commitment.
 * `docs/balance-report.md` documents why this figure is this large: the reactor/habitat
 * power ratio compounds close to exponentially once a colony has more than a couple of
 * reactors (each new reactor unlocks proportionally more future labour), so keeping a
 * competent mission's finish NEAR the 278-turn deadline — rather than trivially early —
 * needed the per-structure labour cost pushed up substantially, not the mission's wave
 * size (raising the win target alone only adds a few more turns per doubling, not
 * hundreds). Measured empirically via the milestone sweep in
 * `scripts/balance-report.ts`, not derived from a formula.
 */
export const HABITAT_BUILD_TURNS = 80

/**
 * Colonists one completed Habitat Module houses: 8.
 *
 * Chosen so the mission's win condition needs SEVERAL habitats (50, at the paired
 * `incomingWaveSize` below), not one — a single-habitat win condition (as
 * `docs/turn-composition-audit.md`'s "one habitat houses one wave" reading would give,
 * paired with a small `incomingWaveSize`) admits no "over-build habitats" failure mode
 * at all, because there is no way to over-build the one habitat that wins the game.
 *
 * `src/app/state/game-state.ts`'s `INCOMING_WAVE_SIZE` is the mission-config half of
 * this same tuning question — it was `6` (able to be satisfied, or lost, by a SINGLE
 * habitat, and therefore no death spiral was reachable at all) and this bead's
 * measurement raised it to `400`, i.e. 50 habitats' worth. See `docs/balance-report.md`
 * for the full derivation and why `400`, specifically, is where the measured naive/
 * considered/recovery/late-recovery battery all land on their intended side.
 */
export const HABITAT_CAPACITY_PER_MODULE = 8

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/**
 * The Reactor Unit: two tiles, matching the shape every multi-turn test fixture in this
 * codebase already assumes for a reactor (`tests/integration/golden-scenario.ts` and
 * others) — not a new shape invented for this bead.
 */
const REACTOR_UNIT_FOOTPRINT: readonly FootprintOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
]

/**
 * The Habitat Module: a 2x2 block, matching the same fixtures' assumed shape and
 * matching `catalog-data.ts`'s `SHIELDED_MODULE_TILES` (4 tiles) — the Shield Berm's own
 * shielded-module figure is dimensioned against exactly this footprint.
 */
const HABITAT_MODULE_FOOTPRINT: readonly FootprintOffset[] = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
]

// ---------------------------------------------------------------------------
// The entries
// ---------------------------------------------------------------------------

/**
 * The core roster's two structure specs, in menu order: Reactor Unit, Habitat Module.
 *
 * RAW SPECS, not a built catalog — mirrors `catalog-data.ts`'s `chainOneStructureSpecs`
 * exactly, for the same reason: the caller runs them through `createCatalog`, the
 * project's one validation boundary, and a caller assembling a full build menu needs to
 * concatenate these with other chains' entries before validating anything.
 *
 * @param config the turn cycle every wattage is converted against — see
 *   `chainOneStructureSpecs`'s identical parameter for why this is threaded rather than
 *   reading `DEFAULT_TURN_CYCLE` directly.
 * @throws {RangeError} if `config` fails `time.ts`'s own validation (delegated to
 *   `energyPerTurnWh`, never re-implemented here).
 */
export function coreStructureSpecs(config: TurnCycleConfig): readonly StructureTypeSpec[] {
  return [
    {
      id: REACTOR_UNIT_ID,
      name: 'Fission Surface Power Unit',
      footprint: REACTOR_UNIT_FOOTPRINT,
      buildTurns: REACTOR_BUILD_TURNS,
      // The SAME rated wattage the pre-placed reactor hull generates
      // (`colony-start.ts`'s `SURVIVING_HULL_REACTOR_UNITS`) — this is a second unit of
      // identical hardware, not a differently-rated design.
      produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, config) },
      consumes: {},
      // A generator with no draw is never a brownout victim (see `colony-start.ts`'s
      // identical reasoning for the reactor hull), so it needs no `priorityClass`.
      habitatCapacity: 0,
    },
    {
      id: HABITAT_MODULE_ID,
      name: 'Habitat Module',
      footprint: HABITAT_MODULE_FOOTPRINT,
      buildTurns: HABITAT_BUILD_TURNS,
      produces: {},
      consumes: { [ELECTRICITY]: energyPerTurnWh(HABITAT_RATED_DRAW_WATTS, config) },
      standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(HABITAT_STANDBY_DRAW_WATTS, config) },
      // Shed above every processor and above drone recharge, below only life support
      // (`brownout.ts` owns why: an empty habitat's trickle load still outranks the
      // workforce that built it — see `docs/balance-report.md` for what that means for
      // the death spiral).
      priorityClass: PRIORITY_HABITAT,
      habitatCapacity: HABITAT_CAPACITY_PER_MODULE,
    },
  ]
}
