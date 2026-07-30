/**
 * The four scripted strategies aic-oby.4's balance pass measures against: naive,
 * considered, and the naive-then-corrected combinator that produces "recovery" and
 * "late recovery" by varying only the correction turn.
 *
 * Exercised here against synthetic colony states built the same way
 * `tests/unit/turn.test.ts` does (a real `ColonyState`, a real catalog, real
 * `ConstructionProject`s pre-advanced to a chosen progress) — never against
 * `mission-runner.runMission` itself, so a strategy's DECISION LOGIC is pinned
 * independently of the harness that executes it.
 */

import { describe, expect, it } from 'vitest'

import { PRIORITY_HABITAT } from '../../src/sim/brownout'
import { createCatalog, getStructureType } from '../../src/sim/catalog'
import type { StructureType } from '../../src/sim/catalog'
import { createProject } from '../../src/sim/construction'
import type { ConstructionProject } from '../../src/sim/construction'
import { createGrid } from '../../src/sim/grid'
import { validatePlacement } from '../../src/sim/placement'
import { ELECTRICITY, energyPerTurnWh } from '../../src/sim/power'
import { DEFAULT_TURN_CYCLE } from '../../src/sim/time'
import { createColony } from '../../src/sim/turn'
import type { ColonyState } from '../../src/sim/turn'
import { createBalanceStrategies } from '../../src/sim/balance-strategies'

const CONFIG = DEFAULT_TURN_CYCLE

const CATALOG = createCatalog([
  {
    id: 'reactor',
    name: 'Reactor',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 4,
    produces: { [ELECTRICITY]: energyPerTurnWh(40_000, CONFIG) },
    consumes: {},
    habitatCapacity: 0,
  },
  {
    id: 'habitat',
    name: 'Habitat',
    footprint: [{ dx: 0, dy: 0 }],
    buildTurns: 8,
    produces: {},
    consumes: { [ELECTRICITY]: energyPerTurnWh(32_000, CONFIG) },
    standbyConsumes: { [ELECTRICITY]: energyPerTurnWh(6_400, CONFIG) },
    priorityClass: PRIORITY_HABITAT,
    habitatCapacity: 8,
  },
])

function type(id: string): StructureType {
  const found = getStructureType(CATALOG, id)
  if (found === undefined) throw new Error(`test catalog is missing "${id}"`)
  return found
}

const REACTOR = type('reactor')
const HABITAT = type('habitat')

/** A project of `structureType`, sited on its own private grid, at a chosen progress. */
function projectAt(id: string, structureType: StructureType, x: number, buildTurnsDone: number): ConstructionProject {
  const grid = createGrid(24, 24)
  const placement = validatePlacement(grid, structureType, { x, y: 0 })
  if (!placement.ok) throw new Error(`test setup: ${id} did not fit at x=${String(x)}`)
  const fresh = createProject(id, structureType, placement)
  const hoursPerBuildTurn = 25 // one drone-shift, matching `time.ts`'s `DRONE_SHIFT_HOURS`
  return { ...fresh, accumulatedLabourHours: buildTurnsDone * hoursPerBuildTurn }
}

function colonyWith(queue: readonly ConstructionProject[], droneRosterSize: number): ColonyState {
  return createColony(
    { turnCycle: CONFIG, incomingWaveSize: 100 },
    {
      queue,
      droneRoster: Array.from({ length: droneRosterSize }, (_unused, i) => `drone-${String(i)}`),
    },
  )
}

const STRATEGIES = createBalanceStrategies({
  reactorType: REACTOR,
  habitatType: HABITAT,
  config: CONFIG,
})

describe('createBalanceStrategies', () => {
  describe('naive', () => {
    it('should queue a habitat when nothing is currently under construction', () => {
      const colony = colonyWith([projectAt('reactor-1', REACTOR, 0, REACTOR.buildTurns)], 33)
      const intents = STRATEGIES.naive({ turn: 1, colony, lastReport: null })
      expect(intents).toEqual([{ kind: 'build', structureType: HABITAT }])
    })

    it('should queue nothing while a habitat is already incomplete', () => {
      const colony = colonyWith(
        [
          projectAt('reactor-1', REACTOR, 0, REACTOR.buildTurns),
          projectAt('habitat-1', HABITAT, 1, 2),
        ],
        33,
      )
      const intents = STRATEGIES.naive({ turn: 10, colony, lastReport: null })
      expect(intents).toEqual([])
    })

    it('should never queue a reactor, however thin the power margin', () => {
      // Six completed habitats against one reactor: standby draw alone dwarfs
      // generation. A naive player still just queues another habitat.
      const habitats = Array.from({ length: 6 }, (_unused, i) =>
        projectAt(`habitat-${String(i)}`, HABITAT, i, HABITAT.buildTurns),
      )
      const colony = colonyWith([projectAt('reactor-1', REACTOR, 10, REACTOR.buildTurns), ...habitats], 33)
      const intents = STRATEGIES.naive({ turn: 50, colony, lastReport: null })
      expect(intents).toEqual([{ kind: 'build', structureType: HABITAT }])
    })

    it('should never cancel anything, however thin the power margin', () => {
      const habitats = Array.from({ length: 6 }, (_unused, i) =>
        projectAt(`habitat-${String(i)}`, HABITAT, i, HABITAT.buildTurns),
      )
      const colony = colonyWith(
        [
          projectAt('reactor-1', REACTOR, 10, REACTOR.buildTurns),
          ...habitats,
          projectAt('habitat-in-flight', HABITAT, 20, 2),
        ],
        33,
      )
      const intents = STRATEGIES.naive({ turn: 50, colony, lastReport: null })
      expect(intents).toEqual([])
    })
  })

  describe('considered', () => {
    it('should queue a reactor, never a habitat, when nothing has generated anything yet', () => {
      // An empty colony (no completed reactor yet at all — the synthetic fixture here
      // has no landed hull) generates zero electricity. Queueing a habitat nobody could
      // ever power is treated as unaffordable by definition, not a division by zero.
      const colony = colonyWith([], 33)
      const intents = STRATEGIES.considered({ turn: 1, colony, lastReport: null })
      expect(intents).toEqual([{ kind: 'build', structureType: REACTOR }])
    })

    it('should treat a habitat with no declared standby draw as costing nothing to the margin', () => {
      // `standbyConsumes` is optional on a `StructureTypeSpec`; a habitat that omits it
      // (unusual, but legal — `catalog.ts` normalises the absence to `{}`) must not
      // crash the share calculation, and correctly contributes zero standby draw.
      const noStandbyHabitat = getStructureType(
        createCatalog([
          {
            id: 'habitat-no-standby',
            name: 'Habitat (no declared standby)',
            footprint: [{ dx: 0, dy: 0 }],
            buildTurns: 8,
            produces: {},
            consumes: { [ELECTRICITY]: energyPerTurnWh(32_000, CONFIG) },
            habitatCapacity: 8,
          },
        ]),
        'habitat-no-standby',
      )
      if (noStandbyHabitat === undefined) throw new Error('test setup: missing fixture type')

      const strategies = createBalanceStrategies({
        reactorType: REACTOR,
        habitatType: noStandbyHabitat,
        config: CONFIG,
      })
      const colony = colonyWith([projectAt('reactor-1', REACTOR, 0, REACTOR.buildTurns)], 33)
      // Ample generation, and the candidate habitat draws no standby at all once
      // complete — always affordable, regardless of `maxHabitatShareOfGeneration`.
      expect(strategies.considered({ turn: 1, colony, lastReport: null })).toEqual([
        { kind: 'build', structureType: noStandbyHabitat },
      ])
    })

    it('should queue a habitat when the power margin is ample', () => {
      // One completed reactor, nothing drawing standby yet: plenty of spare capacity.
      const colony = colonyWith([projectAt('reactor-1', REACTOR, 0, REACTOR.buildTurns)], 33)
      const intents = STRATEGIES.considered({ turn: 1, colony, lastReport: null })
      expect(intents).toEqual([{ kind: 'build', structureType: HABITAT }])
    })

    it('should queue a reactor once completed habitats leave too little spare capacity', () => {
      const habitats = Array.from({ length: 6 }, (_unused, i) =>
        projectAt(`habitat-${String(i)}`, HABITAT, i, HABITAT.buildTurns),
      )
      const colony = colonyWith([projectAt('reactor-1', REACTOR, 10, REACTOR.buildTurns), ...habitats], 33)
      const intents = STRATEGIES.considered({ turn: 50, colony, lastReport: null })
      expect(intents).toEqual([{ kind: 'build', structureType: REACTOR }])
    })

    it('should wait (queue nothing) while a reactor is already in flight', () => {
      const withReactorInFlight = colonyWith(
        [
          projectAt('reactor-1', REACTOR, 0, REACTOR.buildTurns),
          projectAt('reactor-2', REACTOR, 1, 1),
        ],
        33,
      )
      expect(STRATEGIES.considered({ turn: 5, colony: withReactorInFlight, lastReport: null })).toEqual(
        [],
      )
    })

    it('should wait (queue nothing) while an in-flight habitat is still comfortably affordable', () => {
      // One completed reactor, no completed habitats yet, and a fresh habitat under
      // construction: the current margin (before that habitat even finishes) is ample,
      // so a considered builder just lets it finish rather than churning the queue.
      const colony = colonyWith(
        [projectAt('reactor-1', REACTOR, 0, REACTOR.buildTurns), projectAt('habitat-1', HABITAT, 5, 2)],
        33,
      )
      expect(STRATEGIES.considered({ turn: 5, colony, lastReport: null })).toEqual([])
    })

    it('should CANCEL an in-flight habitat and queue a reactor instead once the current margin is already unsafe', () => {
      // Six completed habitats already leave too little spare capacity (the same
      // colony the "queue a reactor" test above uses) — and now a SEVENTH habitat is
      // ALSO mid-construction, queued before the correction arrived. Waiting for it
      // to finish would only make the margin worse, and — per `construction.ts`'s
      // strict queue-order dam — it also blocks a reactor queued behind it from ever
      // earning labour. A considered builder recognises the mistake: cancel it, then
      // queue the reactor immediately.
      const habitats = Array.from({ length: 6 }, (_unused, i) =>
        projectAt(`habitat-${String(i)}`, HABITAT, i, HABITAT.buildTurns),
      )
      const inFlight = projectAt('habitat-in-flight', HABITAT, 20, 2)
      const colony = colonyWith(
        [projectAt('reactor-1', REACTOR, 10, REACTOR.buildTurns), ...habitats, inFlight],
        33,
      )
      const intents = STRATEGIES.considered({ turn: 50, colony, lastReport: null })
      expect(intents).toEqual([
        { kind: 'cancel', projectId: 'habitat-in-flight' },
        { kind: 'build', structureType: REACTOR },
      ])
    })
  })

  describe('naiveUntil', () => {
    it('should behave like naive strictly before the correction turn', () => {
      const habitats = Array.from({ length: 6 }, (_unused, i) =>
        projectAt(`habitat-${String(i)}`, HABITAT, i, HABITAT.buildTurns),
      )
      const colony = colonyWith([projectAt('reactor-1', REACTOR, 10, REACTOR.buildTurns), ...habitats], 33)
      const recovered = STRATEGIES.naiveUntil(90)
      // Turn 50 is before the correction turn: same thin-margin colony that `considered`
      // would fix with a reactor is still played naively — one more habitat.
      expect(recovered({ turn: 50, colony, lastReport: null })).toEqual([
        { kind: 'build', structureType: HABITAT },
      ])
    })

    it('should behave like considered at and after the correction turn, including cancelling a doomed in-flight habitat', () => {
      const habitats = Array.from({ length: 6 }, (_unused, i) =>
        projectAt(`habitat-${String(i)}`, HABITAT, i, HABITAT.buildTurns),
      )
      const inFlight = projectAt('habitat-in-flight', HABITAT, 20, 2)
      const colony = colonyWith(
        [projectAt('reactor-1', REACTOR, 10, REACTOR.buildTurns), ...habitats, inFlight],
        33,
      )
      const recovered = STRATEGIES.naiveUntil(90)
      const expected = [
        { kind: 'cancel', projectId: 'habitat-in-flight' },
        { kind: 'build', structureType: REACTOR },
      ]
      expect(recovered({ turn: 90, colony, lastReport: null })).toEqual(expected)
      expect(recovered({ turn: 200, colony, lastReport: null })).toEqual(expected)
    })
  })
})
