/**
 * Scripted strategies for the balance pass (aic-oby.4): NAIVE, CONSIDERED, and the
 * naive-then-corrected combinator that produces RECOVERY and LATE-RECOVERY by varying
 * only the turn correction happens on.
 *
 * ============================================================================
 * WHY A COMBINATOR, NOT FOUR SEPARATE FUNCTIONS
 * ----------------------------------------------------------------------------
 * The task this module serves is measurement, and the question that matters most is
 * "recoverable if caught early, not if caught late" — a single THRESHOLD question, not
 * four unrelated play styles. Writing RECOVERY and LATE-RECOVERY as independent
 * functions would let their decision rules drift apart from each other and from
 * CONSIDERED, so a balance report comparing them would not actually be comparing "the
 * same correction, applied at a different turn". Instead there are exactly two decision
 * RULES — `naiveDecision` and `consideredDecision` — and `naiveUntil(turn)` is the one
 * function that switches between them. `naive` is `naiveUntil(Infinity)` (never
 * switches) and `considered` is `naiveUntil(1)` (corrected from the very first turn);
 * neither is a separate implementation.
 *
 * ============================================================================
 * THE CONSIDERED DECISION RULE, AND WHY IT IS THIS RULE AND NOT AN OPTIMISER
 * ----------------------------------------------------------------------------
 * A "considered" player is modelled as someone who tracks ONE ratio: what SHARE of the
 * colony's CURRENT total generation is already spoken for by completed habitats'
 * permanent standby draw. `power.ts`'s own header is explicit that a completed
 * habitat's ~6.4 kW standby draw is PRIORITY_HABITAT — shed after nothing this roster
 * contains, i.e. it is fed before drone recharge, forever, once complete. So this rule
 * asks, before queueing the NEXT habitat: "if I build this, will completed habitats'
 * standby draw exceed `maxHabitatShareOfGeneration` of what I currently generate?" If
 * so, build a reactor first; otherwise the habitat is affordable.
 *
 * This is deliberately SELF-RELATIVE (a share of CURRENT generation) rather than
 * measured against the full theoretical drone fleet: the colony starts with enough
 * reactor capacity for only a fraction of its fleet (`colony-start.ts`'s own header:
 * "one reactor against a 33-drone fleet... roughly a fifth of the fleet on shift" is
 * the DESIGNED opening tension, not a shortfall to fix before building anything else).
 * A rule anchored to the full fleet size would tell a considered player to build
 * nothing but reactors for a third of the mission before ever touching a habitat, which
 * is not what "considered" is meant to model. A rule anchored to current generation
 * scales naturally as reactors come online, exactly like a player watching their own
 * cut line rather than a number they can never see.
 *
 * This is deliberately NOT a search over "what habitat count maximises the final
 * score" — a scripted opponent that could see 278 turns ahead would not be measuring
 * what a real player's judgement call produces, which is the entire point of running
 * NAIVE/CONSIDERED/RECOVERY side by side.
 *
 * ============================================================================
 * "ONE THING IN FLIGHT AT A TIME" — AND WHEN THAT THING GETS CANCELLED INSTEAD
 * ----------------------------------------------------------------------------
 * Neither decision rule QUEUES a second build while ANY project (reactor or habitat) is
 * still incomplete. `construction.ts`'s own documented allocation rule is a strict
 * left-to-right dam — the first queued project absorbs a turn's labour before any
 * surplus reaches the second — so queueing several builds at once does not parallelise
 * them, it only reorders which one finishes first. A strategy that queued eagerly would
 * therefore not be "building faster", only obscuring, behind a longer queue, exactly the
 * same one-at-a-time reality `mission-runner.ts`'s placement scan already exposes. This
 * also keeps each decision legible for a balance report: at most one build intent per
 * turn, ever.
 *
 * An in-flight REACTOR is never touched — a reactor is never a mistake to undo, so
 * `consideredDecision` always just waits for one to finish. An in-flight HABITAT is
 * different: it is exactly the thing a NAIVE phase leaves behind when a correction
 * arrives, and per the dam rule above, waiting for it costs the recovery every turn
 * until it finishes — with few drones on shift, that can be dozens of turns for nothing.
 * So `consideredDecision` asks one more question before waiting: is the CURRENT margin
 * (ignoring the in-flight habitat, which is not yet complete and so not yet drawing
 * anything) already past `maxHabitatShareOfGeneration`? If so, the habitat is cancelled
 * (`{ kind: 'cancel' }`, using the real `orders.ts` `CancelBuildOrder` a player already
 * has) and a reactor is queued in the same turn. If the margin is still fine, the
 * habitat is left to complete normally — a considered builder does not churn the queue
 * over a habitat that was never actually a mistake.
 *
 * Determinism: every function here is a pure function of a `StrategyContext` — no
 * `Math.random`, `Date.now`, or `new Date`, matching `mission-runner.ts`'s own
 * requirement that a `Strategy` be pure.
 */

import type { StructureType } from './catalog'
import type { ConstructionProject } from './construction'
import { isProjectComplete } from './construction'
import { ELECTRICITY } from './power'
import type { TurnCycleConfig } from './time'
import type { ColonyState } from './turn'
import type { Strategy, StrategyContext, StrategyIntent } from './mission-runner'

/** Default share of CURRENT generation a considered builder lets completed habitats claim. See the module header. */
export const DEFAULT_MAX_HABITAT_SHARE_OF_GENERATION = 0.3

export interface BalanceStrategyParams {
  readonly reactorType: StructureType
  readonly habitatType: StructureType
  readonly config: TurnCycleConfig
  /**
   * The largest share of CURRENT total generation completed habitats' standby draw may
   * claim before a "considered" builder insists on a reactor instead of the next
   * habitat. Defaults to {@link DEFAULT_MAX_HABITAT_SHARE_OF_GENERATION}. Overridable so
   * a balance run can sweep it as a tuning parameter alongside the catalog data it
   * protects — see the module header for why it is a SHARE of current generation, not
   * an absolute figure.
   */
  readonly maxHabitatShareOfGeneration?: number
}

export interface BalanceStrategies {
  /** Always builds a habitat, never a reactor. See the module header. */
  readonly naive: Strategy
  /** Builds a reactor whenever spare generation is thin, a habitat otherwise. */
  readonly considered: Strategy
  /** `naive` strictly before `correctionTurn`, `considered` at and after it. */
  readonly naiveUntil: (correctionTurn: number) => Strategy
}

/** The first incomplete project of `structureType.id` in `colony.queue`, if any. */
function findIncomplete(
  colony: ColonyState,
  structureType: StructureType,
  config: TurnCycleConfig,
): ConstructionProject | undefined {
  return colony.queue.find(
    (project) => project.structureType.id === structureType.id && !isProjectComplete(config, project),
  )
}

/** Total electricity generated and total electricity drawn in standby, across the queue. */
interface GenerationAndStandby {
  readonly generationWh: number
  readonly standbyWh: number
}

/**
 * Sum electricity GENERATED and electricity DRAWN IN STANDBY over every complete,
 * in-service structure in the queue.
 *
 * Deliberately generic over the WHOLE queue, not filtered to `reactorType`/`habitatType`:
 * the colony's landed reactor hull (`colony-start.ts`) also generates and is not an
 * instance of `params.reactorType`, so filtering by id would silently ignore the
 * colony's actual starting generation. Reading every structure's own `produces`/
 * `standbyConsumes` is what makes this correct regardless of which structures happen to
 * be in the queue.
 */
function currentGenerationAndStandby(colony: ColonyState, config: TurnCycleConfig): GenerationAndStandby {
  const offline = new Set(colony.offlineStructureIds)
  let generationWh = 0
  let standbyWh = 0
  for (const project of colony.queue) {
    if (offline.has(project.id) || !isProjectComplete(config, project)) continue
    generationWh += project.structureType.produces[ELECTRICITY] ?? 0
    standbyWh += project.structureType.standbyConsumes[ELECTRICITY] ?? 0
  }
  return { generationWh, standbyWh }
}

/** NAIVE: if nothing is in flight, queue a habitat. Never queues a reactor, never cancels anything. */
function naiveDecision(context: StrategyContext, params: BalanceStrategyParams): readonly StrategyIntent[] {
  const { colony } = context
  const { config } = params
  if (
    findIncomplete(colony, params.reactorType, config) !== undefined ||
    findIncomplete(colony, params.habitatType, config) !== undefined
  ) {
    return []
  }
  return [{ kind: 'build', structureType: params.habitatType }]
}

/** Whether the NEXT habitat's own standby draw would push completed habitats' share of `generationWh` past `maxShare`. */
function nextHabitatWouldExceedShare(
  generationAndStandby: GenerationAndStandby,
  habitatType: StructureType,
  maxShare: number,
): boolean {
  const { generationWh, standbyWh } = generationAndStandby
  const projectedStandbyWh = standbyWh + (habitatType.standbyConsumes[ELECTRICITY] ?? 0)
  // Zero current generation can only mean "the next habitat would claim ALL of it" —
  // treated as unaffordable rather than dividing by zero.
  return generationWh === 0 ? true : projectedStandbyWh / generationWh > maxShare
}

/**
 * CONSIDERED.
 *
 *   1. A reactor already in flight is NEVER cancelled — just wait for it.
 *   2. A habitat already in flight is cancelled, and a reactor queued in its place,
 *      ONLY if the CURRENT margin (before that habitat even finishes) is already
 *      unsafe — see the module header's "why a strategy needs this". Otherwise it is
 *      left to finish undisturbed.
 *   3. With nothing in flight, queue a reactor if completing ONE MORE habitat would
 *      push completed habitats' standby draw past `maxHabitatShareOfGeneration` of
 *      current total generation; queue a habitat otherwise.
 */
function consideredDecision(
  context: StrategyContext,
  params: BalanceStrategyParams,
): readonly StrategyIntent[] {
  const { colony } = context
  const { config } = params
  const maxShare = params.maxHabitatShareOfGeneration ?? DEFAULT_MAX_HABITAT_SHARE_OF_GENERATION

  if (findIncomplete(colony, params.reactorType, config) !== undefined) {
    return []
  }

  const inFlightHabitat = findIncomplete(colony, params.habitatType, config)
  const generationAndStandby = currentGenerationAndStandby(colony, config)

  if (inFlightHabitat !== undefined) {
    const currentShareUnsafe = nextHabitatWouldExceedShare(
      { generationWh: generationAndStandby.generationWh, standbyWh: generationAndStandby.standbyWh },
      // Comparing the CURRENT share (no further projection: the in-flight habitat is
      // not yet complete and contributes nothing) against the same threshold used
      // below — reusing the "next habitat" projection with the habitat type supplies
      // exactly that one further habitat-worth of draw as the thing being tested.
      params.habitatType,
      maxShare,
    )
    if (!currentShareUnsafe) return []
    return [
      { kind: 'cancel', projectId: inFlightHabitat.id },
      { kind: 'build', structureType: params.reactorType },
    ]
  }

  if (nextHabitatWouldExceedShare(generationAndStandby, params.habitatType, maxShare)) {
    return [{ kind: 'build', structureType: params.reactorType }]
  }
  return [{ kind: 'build', structureType: params.habitatType }]
}

/**
 * Build the four (well — two rules and a combinator) strategies a balance run compares.
 *
 * @throws Nothing of its own; every field is read, not validated — malformed inputs
 *   surface through whichever sim function first rejects them (`isProjectComplete`,
 *   `mission-runner.ts`'s own validation), exactly as `landing.ts`'s injected scorer
 *   is trusted rather than re-validated here.
 */
export function createBalanceStrategies(params: BalanceStrategyParams): BalanceStrategies {
  return {
    naive: (context) => naiveDecision(context, params),
    considered: (context) => consideredDecision(context, params),
    naiveUntil: (correctionTurn) => (context) =>
      context.turn < correctionTurn
        ? naiveDecision(context, params)
        : consideredDecision(context, params),
  }
}
