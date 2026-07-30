/**
 * The golden-trace scenario (aic-a00.7).
 *
 * Factored out of `turn-golden.test.ts` so that the recording script
 * (`scripts/record-golden-trace.ts`) and the assertion share ONE definition. If the two
 * defined the scenario separately, a regenerated golden could silently describe a
 * different colony than the one the test replays — the golden would then pass while
 * guarding nothing, which is exactly the class of defect this whole harness exists to
 * catch.
 *
 * Deliberately NOT a `.test.ts` file, so vitest's `include` does not collect it.
 */

import { PRIORITY_HABITAT, PRIORITY_PROCESSOR_DOWNSTREAM, PRIORITY_PROCESSOR_UPSTREAM } from '../../src/sim/brownout'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { queueConstruction } from '../../src/sim/construction'
import type { ConstructionQueue } from '../../src/sim/construction'
import type { Grid } from '../../src/sim/grid'
import { ELECTRICITY, REACTOR_OUTPUT_WATTS, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { generateWorld } from '../../src/sim/world'
import { createColony, resolveTurn } from '../../src/sim/turn'
import type { ColonyState, CycleReport } from '../../src/sim/turn'

const CONFIG = DEFAULT_TURN_CYCLE

/** Scenario identity, carried on the trace so a golden file names its own scenario. */
export const GOLDEN_SCENARIO = { label: 'mars-colony-opening-16-turns', seed: 20260730 } as const

/**
 * Turns recorded.
 *
 * Long enough that cross-turn accumulation errors surface (a one-turn trace cannot show
 * drift, which is the failure mode the integer discipline exists to prevent) and that
 * the scenario passes through a brownout, several completions and steady production.
 * Short enough that the committed file stays reviewable as a diff — the full 278-turn
 * mission would be unreadable, and an unreadable golden gets regenerated on autopilot.
 */
export const GOLDEN_TURNS = 16

/**
 * The scenario catalog. Real wattages converted ONCE by `energyPerTurnWh`, never
 * hand-typed watt-hours — the same discipline a designer would follow.
 */
const CATALOG = createCatalog([
  {
    id: 'reactor',
    name: 'Fission Surface Power Unit',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    buildTurns: 4,
    produces: { [ELECTRICITY]: energyPerTurnWh(REACTOR_OUTPUT_WATTS, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'habitat',
    name: 'Habitat Module',
    footprint: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
    ],
    buildTurns: 6,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(32_000, CONFIG) },
    standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(6_400, CONFIG) },
    priorityClass: PRIORITY_HABITAT,
    habitatCapacity: 8,
  },
  {
    id: 'hopper',
    name: 'Regolith Hopper',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 3,
    produces: { regolith: 60_000_000 },
    consumes: { [ELECTRICITY]: energyPerTurnWh(12_000, CONFIG) },
    priorityClass: PRIORITY_PROCESSOR_UPSTREAM,
    habitatCapacity: 0,
  },
  {
    id: 'press',
    name: 'Sinter Press',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 6,
    produces: { sinteredPlate: 1_200_000 },
    consumes: { [ELECTRICITY]: energyPerTurnWh(30_000, CONFIG), regolith: 1_400_000 },
    priorityClass: PRIORITY_PROCESSOR_DOWNSTREAM,
    habitatCapacity: 0,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`golden scenario is missing catalog entry "${id}"`)
  return found
}

/** What the harness threads from turn to turn: the colony, plus the last cycle report. */
export interface GoldenState {
  readonly colony: ColonyState
  readonly report: CycleReport | null
  /** Terrain fingerprint, carried so the PRNG stream is covered by the golden. */
  readonly world: { readonly depositCount: number; readonly firstDeposit: string }
}

/**
 * The opening colony, built through the REAL production path.
 *
 * Structures are sited with `queueConstruction`, which validates placement and writes
 * occupancy into the grid — so the golden covers the placement seam rather than
 * hand-assembling a queue that never touched a grid. One pre-built reactor gets the
 * colony off the ground; everything else is genuinely constructed over the recorded
 * turns, which is what makes the trace pass through completions.
 */
export function initialGoldenState(): GoldenState {
  const world = generateWorld(32, 32, GOLDEN_SCENARIO.seed)

  let grid: Grid = world.grid
  let queue: ConstructionQueue = []

  const site = (id: string, typeId: string, x: number, y: number): void => {
    const result = queueConstruction(grid, id, type(typeId), { x, y })
    if (!result.ok) {
      throw new Error(`golden scenario: could not site ${id} at (${x}, ${y}): ${result.reason}`)
    }
    grid = result.grid
    queue = [...queue, result.project]
  }

  // Sited in a fixed order, because construction priority IS queue order — and this
  // order is chosen to make the trace pass through every interesting state. The
  // processors finish while only two reactors are up, so they are SHED for several
  // turns (exercising the brownout cut line and no-backfill); reactor-3 then comes
  // online and they start producing. A scenario where nothing is ever shed, or where
  // everything is always affordable, would lock in nothing.
  site('reactor-1', 'reactor', 2, 2)
  site('reactor-2', 'reactor', 5, 2)
  site('hopper-1', 'hopper', 2, 5)
  site('press-1', 'press', 4, 5)
  site('reactor-3', 'reactor', 8, 5)
  site('habitat-1', 'habitat', 8, 2)
  site('habitat-2', 'habitat', 11, 2)

  // reactor-1 arrives complete — the landed starship's own power unit. Everything else
  // starts at zero progress and is built by drone labour over the recorded turns.
  const buildTurns = type('reactor').buildTurns
  const hoursPerBuildTurn = 25 * buildTurns
  queue = queue.map((project) =>
    project.id === 'reactor-1'
      ? { ...project, accumulatedLabourHours: hoursPerBuildTurn }
      : project,
  )

  const firstDeposit = world.deposits[0]
  return {
    colony: createColony(
      { turnCycle: CONFIG, incomingWaveSize: 8 },
      {
        grid,
        queue,
        // 14 drones, and the figure is load-bearing for what the trace covers. It is
        // more than one reactor can charge, so the colony opens in a brownout with the
        // processors shed; three reactors can afford both the fleet and the processors,
        // so they run for a few turns; then the two habitats come online, take priority
        // over drone charging, and push the press back off the grid. One trace,
        // covering brownout, recovery and re-shedding — which is the whole tension the
        // design is built on.
        //
        // With the ratified 33-drone hold the colony would be permanently
        // drone-saturated and no processor would ever run: a real scenario, and a
        // useless golden.
        droneRoster: Array.from({ length: 14 }, (_, i) => `drone-${String(i).padStart(2, '0')}`),
        // The landed starship's hold: enough regolith for the press to bite on before
        // the hopper is producing. Input starvation is NOT modelled yet (it belongs to
        // the production module the chain epics add), so a press with no feedstock would
        // record a ledger shortfall and manufacture plate from nothing — an honest
        // reflection of a known gap, but not something to bake into a regression lock.
        stockpiles: { regolith: 40_000_000 },
      },
    ),
    report: null,
    world: {
      depositCount: world.deposits.length,
      firstDeposit:
        firstDeposit === undefined
          ? 'none'
          : `${firstDeposit.x},${firstDeposit.y},${firstDeposit.kind}`,
    },
  }
}

/** One turn of the scenario. Satisfies the harness's `TurnStep` signature exactly. */
export function goldenStep(state: GoldenState): GoldenState {
  const resolved = resolveTurn(state.colony)
  return { colony: resolved.state, report: resolved.report, world: state.world }
}

/**
 * The shape of one recorded snapshot.
 *
 * Declared rather than left implicit so `turn-golden.test.ts` can `JSON.parse` a
 * recorded snapshot into a TYPED value instead of an `any`. That matters beyond
 * satisfying the linter: assertions written against an `any` will happily pass on a
 * misspelled field (`s.electricity.brownedOut` is `undefined`, and `expect(undefined)
 * .toBe(undefined)`-style checks read as green), so a typo would silently disable the
 * very assertions that keep this golden from going toothless.
 */
export interface GoldenSnapshot {
  readonly turn: number
  readonly stockpiles: Readonly<Record<string, number>>
  readonly electricity: {
    readonly brownout: boolean
    readonly cutLine: number | null
    readonly shedStructureIds: readonly string[]
    readonly poweredStructureIds: readonly string[]
    readonly dronesOnShift: number
    readonly generationWh: number
  } | null
  readonly completedThisTurn: readonly string[]
  readonly habitatCapacity: number
}

/**
 * What the golden file pins.
 *
 * A projection, not whole state: pinning everything would include the grid's 1,024 tile
 * objects, making the file unreviewable and breaking it on every unrelated refactor —
 * which is how golden tests get deleted. This pins the aggregates that are SUPPOSED to
 * be stable, plus the cycle report's explanatory fields, and lets the rest move.
 *
 * The return type is deliberately wider than {@link GoldenSnapshot} — the recorded file
 * carries extra diagnostic fields (`progress`, `balances`, `vented`, `mission`) that
 * make a failing diff readable but that no assertion reads. `GoldenSnapshot` describes
 * the subset the test actually asserts against.
 */
export function goldenProjection(state: GoldenState): unknown {
  const { colony, report } = state
  return {
    turn: colony.turnsTaken,
    world: state.world,
    stockpiles: colony.stockpiles,
    // Build progress per project, which is where cross-turn drift would show first.
    progress: colony.queue.map((project) => ({
      id: project.id,
      labourHours: project.accumulatedLabourHours,
    })),
    electricity:
      report === null
        ? null
        : {
            generationWh: report.electricity.generationWh,
            structureDemandWh: report.electricity.structureDemandWh,
            droneDemandWh: report.electricity.droneDemandWh,
            droneEnergyWh: report.electricity.droneEnergyWh,
            unusedWh: report.electricity.unusedWh,
            brownout: report.electricity.brownout,
            cutLine: report.electricity.cutLine,
            poweredStructureIds: report.electricity.poweredStructureIds,
            shedStructureIds: report.electricity.shedStructureIds,
            dronesOnShift: report.electricity.dronesOnShift.length,
            labourCapacityHours: report.electricity.labourCapacityHours,
          },
    labour:
      report === null
        ? null
        : { applied: report.labourHoursApplied, unused: report.labourHoursUnused },
    completedThisTurn: report?.completedThisTurn ?? [],
    balances: report?.balances ?? [],
    vented: report?.vented ?? [],
    overflow: report?.overflow ?? [],
    habitatCapacity: report?.habitatCapacity ?? 0,
    mission: report?.mission ?? null,
  }
}
