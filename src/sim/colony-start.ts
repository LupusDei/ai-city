/**
 * The opening move: a surveyed `World` plus a scored `ReadyLanding` becomes a running
 * `ColonyState` (aic-hfb).
 *
 * WHY THIS MODULE EXISTS. `landing.ts` produced a validated, scored `ReadyLanding` and
 * `turn.ts` consumed a `ColonyState`, and nothing converted one into the other. The
 * player's opening move produced a NUMBER and nothing else: no grid occupancy, no
 * reactor, no drone roster. `generateWorld`, `evaluateLanding`, `createColony` and
 * `resolveTurn` each had zero production consumers, so the opening move and the turn loop
 * were two complete systems that never met. This is the same seam shape as aic-c1p, where
 * the deposit generator's only caller was its own unit test while deposit proximity
 * carried 35% of the landing score — caught before it closed green this time.
 *
 * Like `turn.ts` and `world.ts`, this is a COMPOSITION layer with no rules of its own. It
 * owns no scoring, no placement validation, no progress arithmetic and no turn logic, so
 * it cannot drift away from the modules it joins. Everything it decides is stated below.
 *
 * ============================================================================
 * THE NON-NEGOTIABLE PROPERTY: THIS MODULE NEVER REGENERATES THE WORLD.
 * ----------------------------------------------------------------------------
 * `buildColony` takes a `World` and builds the colony's grid FROM IT — the exact terrain,
 * buildability and deposits the player was shown and the score was computed over. It
 * never calls the world generator. It cannot: it has no seed and no dimensions to call it
 * with, which is a deliberate part of the design rather than an accident of the signature.
 *
 * A bridge that generated a fresh world here would look correct, render correctly, and
 * silently discard the player's decision — and it would pass every test that did not
 * explicitly check for it. `tests/integration/colony-start-seam.test.ts` pins it by OBJECT
 * IDENTITY (every non-hull tile must be the same `Tile` instance the survey produced),
 * because a re-roll from the same seed is deep-equal to the original and only identity can
 * tell the two apart. `tests/acceptance/playable-start.spec.ts` AC-3.2 asserts the same
 * property one layer up, at the browser.
 *
 * `startMission` is the one function here that DOES generate a world, exactly once, from a
 * seed — and it hands that world back to the caller in both its success and its failure
 * branch. That is what keeps the guarantee whole: no caller ever has a reason to
 * regenerate, because it is never left holding a colony without the world it came from.
 * ============================================================================
 *
 * WHERE THE WORLD LIVES AFTER THE START. `ColonyState` deliberately does not absorb the
 * `World`. Terrain, buildability and deposits are the STATIC substrate; the colony is the
 * mutable state on top of it. Copying the substrate into colony state would mean two
 * sources of truth for the map, which is the defect `ColonyState`'s own doc comment says
 * it exists to prevent. So a caller holds the pair, and every function here that produces
 * a colony also yields the world it was built from.
 *
 * Determinism: pure functions of their arguments' values. No `Math.random`, no clock, no
 * I/O, no mutation of any input — the surveyed world is never written to. Every energy
 * figure is an integer watt-hour count converted once at authorship, and nothing here
 * accumulates or divides.
 */

import type { DepositOptions } from './buildability'
import { createCatalog, getStructureType } from './catalog'
import type { StructureType, StructureTypeSpec } from './catalog'
import { enqueueProject, queueConstruction } from './construction'
import type { ConstructionQueue } from './construction'
import type { DroneId } from './drones'
import type { Coord, Grid } from './grid'
import { HULL_FOOTPRINT, evaluateLanding, resolveHullFootprint } from './landing'
import type {
  HullId,
  IncompleteLanding,
  LandingReadiness,
  LandingSelection,
  ReadyLanding,
  RejectedLanding,
} from './landing'
import type { Stockpile } from './ledger'
import type { MissionConfig } from './mission'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from './power'
import type { TurnCycleConfig } from './time'
import { createColony } from './turn'
import type { ColonyState } from './turn'
import { buildabilityScorerFor, depositCoords, generateWorld } from './world'
import type { World } from './world'

// ---------------------------------------------------------------------------
// The two surviving hulls
// ---------------------------------------------------------------------------

/**
 * The landed drone hold's structure-instance id, which is also its `HullId`.
 *
 * One vocabulary for both roles deliberately: the grid records `occupantId`, and making
 * that string the same value `landing.ts` already uses to name a hull means a caller can
 * map a tile straight back to the hull standing on it with no second lookup table to keep
 * in sync.
 */
export const DRONE_HULL_ID: HullId = 'drone-hull'

/** The landed reactor hold's structure-instance id. See {@link DRONE_HULL_ID}. */
export const REACTOR_HULL_ID: HullId = 'reactor-hull'

/**
 * Reactor units the reactor hull runs while sitting on its landing legs: ONE.
 *
 * PHYSICS FIRST, and the reason it is not the whole hold. The hold carries several
 * fission surface power units as cargo, but a unit only produces once it is stood up on
 * its own radiator array at a safe separation from anything it would cook — that is a
 * construction task, and those units are catalog structures a later bead places. What a
 * landed starship can do immediately is run the one unit wired to its own onboard
 * distribution and reject that unit's heat through the hull's own radiators. So exactly
 * one unit's output is available from turn 1, and the rest of the hold is inventory
 * waiting on construction.
 *
 * GAME MECHANICS AGREE, which is why this is one rather than zero. Drone recharge is the
 * only source of labour, and recharge draws colony power: with no generation at all,
 * labour capacity is zero forever and the colony can never build the thing that would
 * give it power. A start with no generation is not a hard start, it is an unwinnable one.
 * One unit against a 33-drone fleet opens the colony in a genuine brownout — roughly a
 * fifth of the fleet on shift — which is the intended opening tension rather than a
 * stalemate.
 */
export const SURVIVING_HULL_REACTOR_UNITS = 1

/**
 * Drones that walk off the surviving drone hold: 33.
 *
 * The ratified figure — a ~100 t hold at ~3 t per construction drone. Taken here as a
 * FLAT DEFAULT, not derived, and that is deliberate: `aic-74p.4` ("Starting inventory from
 * surviving holds") owns turning hold capacity and payload masses into a starting
 * inventory, and implementing that derivation here would be doing that bead's work in the
 * wrong module. When it lands, this constant should be replaced by its computed figure and
 * this comment deleted.
 *
 * Overridable via `BuildColonyParams.droneRoster` so a scenario or a test can state a
 * different fleet without this constant becoming a lie — the golden trace, for instance,
 * deliberately runs 14 drones because a permanently drone-saturated colony would make a
 * useless regression lock.
 */
export const DEFAULT_SURVIVING_DRONES = 33

/** Prefix for generated drone ids. See {@link defaultDroneRoster} for why they are padded. */
export const DRONE_ID_PREFIX = 'drone-'

/**
 * The two hulls' structure specs.
 *
 * ARE THE LANDED HULLS CONSTRUCTION PROJECTS, OR A DISTINCT KIND OF THING? They are
 * `ConstructionProject`s with `buildTurns: 0`, and the codebase already designed for
 * exactly this: `catalog.ts` documents `buildTurns` as "`0` means pre-placed (e.g. a
 * landed starship)", and both `construction.ts` and `mission.ts` explicitly handle the
 * `buildTurns: 0` case as "complete on arrival". Nothing needed inventing.
 *
 * The alternative — a second collection of pre-placed structures alongside the queue — was
 * rejected for the reason `ColonyState`'s own doc gives: `queue` holds EVERY structure
 * instance, complete or not, precisely so no module has to reconcile two lists that
 * nothing checks agree. A hull is a thing that occupies tiles, generates power and could
 * be taken offline, which is exactly what that collection is for. Putting them in it means
 * the turn loop needed no change at all: they are complete, so they generate and draw from
 * turn 1; they need zero labour, so `advanceConstruction` transparently skips them; they
 * house nobody, so they contribute nothing to the mission verdict.
 *
 * THEY ARE STILL NOT BUILDABLE STRUCTURES. `landing.ts` is right that a hull has no
 * catalog entry — meaning it is never offered in the player's build menu. But it does need
 * a VALIDATED `StructureType`, and routing these two specs through `createCatalog` is what
 * gets the integer base-unit rule, the footprint-includes-its-anchor rule and the
 * standby-never-exceeds-rated rule applied to them, exactly as to every other structure.
 * A private catalog gives that validation without putting the hulls anywhere the player
 * can build them.
 *
 * The footprint is `HULL_FOOTPRINT` ITSELF, not a copy of its shape. That is load-bearing:
 * placement re-resolves the footprint from the structure type, while the landing's tiles
 * were resolved from this constant during scoring. Sharing the one constant makes it
 * impossible for the tiles the colony occupies to differ from the tiles the player was
 * shown and scored on.
 */
function hullSpecs(config: TurnCycleConfig): readonly StructureTypeSpec[] {
  return [
    {
      id: DRONE_HULL_ID,
      name: 'Drone Hold (landed)',
      footprint: HULL_FOOTPRINT,
      buildTurns: 0,
      // An emptied airframe. It generates nothing and has no rated process load: the
      // drones that were its payload are now the colony's roster, drawing their own
      // recharge through `power.ts`, not through the hull.
      produces: {},
      consumes: {},
      // Deliberately NO `storageCapacity`. Treating an empty hold as a warehouse is a real
      // and probably correct idea, and it belongs to aic-74p.4 and aic-7f5 alongside the
      // rest of the starting-inventory question — not smuggled in here where it would
      // silently change what the colony can hoard from turn 1.
      habitatCapacity: 0,
    },
    {
      id: REACTOR_HULL_ID,
      name: 'Reactor Hold (landed)',
      footprint: HULL_FOOTPRINT,
      buildTurns: 0,
      // Converted from the reality-grounded wattage ONCE, here at authorship, exactly as a
      // catalog author would — never a hand-typed watt-hour figure that could drift from
      // the reactor constant it is supposed to represent.
      produces: {
        [ELECTRICITY]: energyPerTurnWh(
          REACTOR_OUTPUT_WATTS * SURVIVING_HULL_REACTOR_UNITS,
          config,
        ),
      },
      // A generator with no draw can never be shed by the brownout, so the colony's
      // opening power supply cannot be taken away from it by its own drone fleet.
      consumes: {},
      habitatCapacity: 0,
    },
  ]
}

/** Both validated hull structure types, from one private catalog. */
interface HullTypes {
  readonly droneHull: StructureType
  readonly reactorHull: StructureType
}

/**
 * Validate the hull specs and return both types.
 *
 * @throws {RangeError} if either spec is malformed (delegated to `createCatalog`, never
 *   re-implemented here), or if a lookup misses. The lookup guard is unreachable while the
 *   id constants above and the specs agree, and is kept rather than cast past for the same
 *   reason `construction.ts` keeps its own documented untestable-as-unreachable guard:
 *   only the type checker, not this function's logic, can prove a `Map` lookup hit.
 */
function hullTypes(config: TurnCycleConfig): HullTypes {
  const catalog = createCatalog(hullSpecs(config))
  const droneHull = getStructureType(catalog, DRONE_HULL_ID)
  const reactorHull = getStructureType(catalog, REACTOR_HULL_ID)
  if (droneHull === undefined || reactorHull === undefined) {
    throw new RangeError(
      `Hull catalog is missing "${DRONE_HULL_ID}" or "${REACTOR_HULL_ID}" — the id constants ` +
        'and the hull specs have gone out of sync',
    )
  }
  return { droneHull, reactorHull }
}

/**
 * The index within `HULL_FOOTPRINT` of the anchor offset `(0, 0)`.
 *
 * `resolveHullFootprint` maps the footprint in order, so a resolved tile list carries its
 * anchor at this index. Derived from the constant rather than assumed to be `0`, so
 * reordering `HULL_FOOTPRINT` cannot silently make every hull land one tile off.
 */
const HULL_ANCHOR_INDEX = HULL_FOOTPRINT.findIndex(({ dx, dy }) => dx === 0 && dy === 0)

/**
 * Recover the anchor from a hull's resolved tile list, checking the list really is a hull
 * footprint.
 *
 * `ReadyLanding` carries TILES rather than anchors, and placement needs an anchor. Rather
 * than trust the shape, this re-resolves the footprint from the recovered anchor and
 * requires an exact match. A genuine `ReadyLanding` always passes — it can only be
 * produced by site validation, which resolved these tiles from this same constant — so
 * this fires only for a hand-fabricated one, and turns what would otherwise surface as a
 * baffling placement rejection several steps later into an error that names the hull.
 *
 * @throws {RangeError} if `tiles` is not `HULL_FOOTPRINT` resolved at some anchor.
 */
function hullAnchor(hull: HullId, tiles: readonly Coord[]): Coord {
  // `undefined` here covers both a tile list too short to hold an anchor and the
  // (catalog-impossible) case of a footprint with no `(0, 0)` offset, where the index is -1.
  const anchor = tiles[HULL_ANCHOR_INDEX]
  if (anchor !== undefined) {
    const expected = resolveHullFootprint(anchor)
    const matches =
      tiles.length === expected.length &&
      expected.every((tile, index) => {
        const given = tiles[index]
        return given !== undefined && given.x === tile.x && given.y === tile.y
      })
    if (matches) return anchor
  }

  throw new RangeError(
    `The ${hull} landing tiles are not a hull footprint: expected ${HULL_FOOTPRINT.length} ` +
      `tiles in HULL_FOOTPRINT order, received ${JSON.stringify(tiles)}`,
  )
}

/**
 * The default starting roster: one id per surviving drone.
 *
 * ZERO-PADDED, and the padding is load-bearing rather than cosmetic. Drone charge priority
 * is ASCENDING INSTANCE ID (spec 003 FR-007, enforced in `brownout.ts`), which is a STRING
 * comparison — so unpadded ids would order `drone-10` before `drone-9` and the roster's
 * documented priority would quietly stop matching its own numbering. The width is derived
 * from the fleet size, so raising {@link DEFAULT_SURVIVING_DRONES} past a power of ten
 * cannot reintroduce the bug.
 */
function defaultDroneRoster(): readonly DroneId[] {
  const digits = String(Math.max(0, DEFAULT_SURVIVING_DRONES - 1)).length
  return Array.from(
    { length: DEFAULT_SURVIVING_DRONES },
    (_unused, index) => `${DRONE_ID_PREFIX}${String(index).padStart(digits, '0')}`,
  )
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/** Everything needed to turn a scored landing into a running colony. */
export interface BuildColonyParams {
  /**
   * The world that was SURVEYED and SCORED. Used exactly as given — this module never
   * regenerates it. See the module header.
   */
  readonly world: World
  /** The player's validated, scored landing choice, from {@link evaluateLandingOn}. */
  readonly landing: ReadyLanding
  readonly mission: MissionConfig
  /** Defaults to {@link DEFAULT_SURVIVING_DRONES} padded ids. See {@link defaultDroneRoster}. */
  readonly droneRoster?: readonly DroneId[]
  /**
   * Starting stockpile. Defaults to EMPTY, and that is a documented minimal default rather
   * than a claim about the holds: nothing loose is assumed to have survived the landing,
   * and electricity is a flow that cannot be stockpiled at all. Deriving a real starting
   * inventory from the surviving holds is aic-74p.4, a separate open bead, and is
   * deliberately not attempted here.
   */
  readonly stockpiles?: Stockpile
}

/**
 * Build the starting colony from a surveyed world and a scored landing, with both hulls
 * already standing on the grid.
 *
 * The grid is the SURVEYED grid with hull occupancy written into it — never a fresh one.
 * Occupancy goes through `queueConstruction`, the same production path every player-placed
 * structure uses, so the hulls occupy their tiles by exactly the mechanism that will later
 * refuse to build anything on top of them. Nothing is hand-assembled and `createColony`
 * remains the only constructor of a `ColonyState`.
 *
 * @throws {RangeError} if `landing` is not a genuine `ReadyLanding` for `world` — its tiles
 *   are not a hull footprint, the two hulls overlap, or the world's grid already has
 *   something standing on a hull tile. All three are impossible for a landing obtained from
 *   {@link evaluateLandingOn} against a pristine surveyed world: site validation rejects an
 *   out-of-bounds or overlapping choice before it can ever become `ReadyLanding`, which is
 *   why these are programmer errors here rather than typed player-facing rejections. They
 *   throw rather than degrade because the alternative is a hull that silently never appears.
 * @throws {RangeError} if the drone roster or the mission config is malformed (delegated to
 *   `createColony` and `time.ts`).
 */
export function buildColony(params: BuildColonyParams): ColonyState {
  const { world, landing, mission } = params
  const types = hullTypes(mission.turnCycle)

  // The surveyed grid. This single assignment is the whole non-negotiable property.
  let grid: Grid = world.grid
  let queue: ConstructionQueue = []

  const land = (hull: HullId, structureType: StructureType, tiles: readonly Coord[]): void => {
    const anchor = hullAnchor(hull, tiles)
    const sited = queueConstruction(grid, hull, structureType, anchor)
    if (!sited.ok) {
      throw new RangeError(
        `Cannot land the ${hull} at (${anchor.x}, ${anchor.y}): placement was rejected as ` +
          `"${sited.reason}". A ReadyLanding has already passed bounds and overlap validation, ` +
          'so either this landing was not produced for this world, or the world grid was ' +
          'already occupied.',
      )
    }
    grid = sited.grid
    // `enqueueProject` rather than a spread, so a duplicated hull id is refused here
    // instead of surfacing mid-turn as a duplicate grid consumer.
    queue = enqueueProject(queue, sited.project)
  }

  // Drone hull first, so its id is the one reported as the occupant if a caller hands us a
  // landing whose two hulls overlap — the rejection then names the reactor hull, which is
  // the one that could not be placed.
  land(DRONE_HULL_ID, types.droneHull, landing.droneHullTiles)
  land(REACTOR_HULL_ID, types.reactorHull, landing.reactorHullTiles)

  return createColony(mission, {
    grid,
    queue,
    droneRoster: params.droneRoster ?? defaultDroneRoster(),
    stockpiles: params.stockpiles ?? {},
  })
}

/**
 * Score a landing selection against a world — the single call a survey screen needs on
 * every click.
 *
 * This is the adapter pair `world.ts` warned about, applied: landing evaluation wants bare
 * `Coord`s and a footprint scorer, while a `World` carries `MineralDeposit`s and a
 * `BuildabilityMap`. Assembling those two arguments by hand at every call site is exactly
 * what nobody did in aic-c1p, and the omission is SILENT — an empty deposit list scores as
 * "no deposits anywhere" rather than as an error, quietly zeroing 35% of the score. Doing
 * it in one place means a caller cannot forget half of it.
 *
 * Never throws: every outcome (too few hulls placed, an illegal site, a scored site) is an
 * ordinary state of an in-progress player decision. See `LandingReadiness`.
 */
export function evaluateLandingOn(world: World, selection: LandingSelection): LandingReadiness {
  return evaluateLanding({
    grid: world.grid,
    selection,
    mineralDeposits: depositCoords(world.deposits),
    buildabilityScore: buildabilityScorerFor(world.buildability),
  })
}

/** A mission that started: the world it was surveyed on, the landing chosen, the colony. */
export interface MissionStarted {
  readonly ok: true
  /** The surveyed world. The colony was built from THIS object — see the module header. */
  readonly world: World
  readonly landing: ReadyLanding
  readonly colony: ColonyState
}

/**
 * A mission that could not start because the landing choice was not ready.
 *
 * Carries the surveyed `world` too, and that is the point of returning a union rather than
 * throwing: a caller whose player has picked an illegal site must be able to show the SAME
 * map again and let them pick differently. If it had to re-survey to do that, the map would
 * re-roll underneath the player mid-decision.
 */
export interface MissionNotStarted {
  readonly ok: false
  readonly world: World
  readonly readiness: IncompleteLanding | RejectedLanding
}

export type StartMissionResult = MissionStarted | MissionNotStarted

export interface StartMissionParams {
  readonly width: number
  readonly height: number
  readonly seed: number
  readonly selection: LandingSelection
  readonly mission: MissionConfig
  readonly depositOptions?: DepositOptions
  readonly droneRoster?: readonly DroneId[]
  readonly stockpiles?: Stockpile
}

/**
 * Survey a world from a seed, score a landing selection on it, and start the colony —
 * the whole opening move in one call.
 *
 * GENERATES THE WORLD EXACTLY ONCE, and returns it on both branches. That is what makes
 * this function safe to have at all: the hazard this module exists to prevent is the world
 * being rolled twice, and a function that both takes a seed AND hands the resulting world
 * back leaves no caller with a reason to roll it again. A caller that already holds a
 * surveyed world (a survey screen, which must render the terrain before the player can
 * choose) should call {@link evaluateLandingOn} and {@link buildColony} directly instead —
 * that path takes a world and cannot generate one.
 *
 * @throws {RangeError} if a dimension or the mission config is malformed. A bad dimension
 *   is a config or programmer error, not player input, so it propagates unchanged from
 *   `world.ts` rather than being softened into a landing rejection — an illegal SITE is an
 *   ordinary outcome and comes back as `ok: false`; an illegal MAP is a defect.
 */
export function startMission(params: StartMissionParams): StartMissionResult {
  const world = generateWorld(params.width, params.height, params.seed, params.depositOptions)

  const readiness = evaluateLandingOn(world, params.selection)
  if (readiness.status !== 'ready') {
    return { ok: false, world, readiness }
  }

  return {
    ok: true,
    world,
    landing: readiness,
    colony: buildColony({
      world,
      landing: readiness,
      mission: params.mission,
      droneRoster: params.droneRoster,
      stockpiles: params.stockpiles,
    }),
  }
}
