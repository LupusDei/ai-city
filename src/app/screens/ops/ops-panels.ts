/**
 * WHAT IS A CRISIS — the operations screen's severity layer, and nothing else.
 *
 * ============================================================================
 * THE PROBLEM THIS MODULE EXISTS TO FIX
 * ----------------------------------------------------------------------------
 * The screen used to present a colony running at roughly a fifth of its power demand, with
 * 26 of its 33 drones held offline, in tiles styled IDENTICALLY to "Colony grid 64 x 64" —
 * and it drew the two bars above them GREEN. Green for a starved grid is not a palette
 * mistake. It is a claim about the game state, made by a stylesheet, and a false one.
 *
 * So "is this a crisis?" is answered here, in a module with tests, and never in a component.
 *
 * ============================================================================
 * THE ANSWER COMES FROM THE SIM'S OWN VERDICTS. THERE IS NO THRESHOLD IN THIS FILE.
 * ----------------------------------------------------------------------------
 * The obvious implementation is a percentage: supplied over demand, red below some cut-off.
 * It is rejected, and the reason is the whole point of the module.
 *
 * A cut-off invented here would be a RULE — "a colony below 40% is in trouble" — living in
 * the app layer, where nothing in `src/sim/` can agree or disagree with it. That is the
 * `aic-c1p` defect class exactly: a figure the player acts on, assembled from a judgement
 * the simulation never made. It would also drift silently the first time `brownout.ts`
 * changed how shedding works.
 *
 * `power.ts` already decides this. `electricity.brownout` is true IFF something was shed,
 * and `dronesHeldOffline` is the list of drones that could not be charged. Those two fields
 * ARE the answer, computed by the code that owns the question, so this module reads them and
 * adds no opinion of its own. Every function below branches on a sim field and returns a
 * word or a tone; there is not one comparison against a constant anywhere in it.
 *
 * The consequence is worth stating plainly: if the simulation ever stops calling this a
 * brownout, the screen stops calling it one, on the same turn, with no second definition to
 * find and update.
 *
 * ============================================================================
 * WHAT IS NOT HERE, AND WHY
 * ----------------------------------------------------------------------------
 * A PERCENTAGE READOUT ("the colony runs at 22%"). It would be the single most legible
 * number on the screen and it is deliberately absent, because supplied-over-demand is
 * arithmetic on two sim figures and no sim field carries it. `ops-view.ts` selects and does
 * not calculate; this module classifies and does not calculate. Adding the division to
 * either would put a derived game figure in the app layer, which is the thing spec 005's
 * FR-002 forbids. The proportion is still SHOWN — the constraint bars are native `<meter>`
 * elements given the sim's two figures as `value` and `max`, so the browser performs the
 * division for display and nothing in this codebase holds the result. If the number is
 * wanted as text, it belongs on `ElectricityResult` in `src/sim/power.ts`.
 *
 * ============================================================================
 * WHY A `.ts` MODULE
 * ----------------------------------------------------------------------------
 * `vitest.config.ts` excludes `src/app/**\/*.tsx` from the coverage gate and pointedly does
 * not exclude pure `.ts` under `src/app/`. Severity living in the layout would be the one
 * decision on this screen outside the 80/70/60 thresholds — and it is the decision most
 * worth pinning, because it is the one that can be wrong while everything renders.
 *
 * Pure functions of their arguments: no clock, no randomness, no locale. Digit grouping
 * comes from `ops-view.ts`'s `groupDigits` for the reason its docblock gives.
 */

import type { OpsView } from './ops-view'
import { groupDigits } from './ops-view'

/**
 * How hard a constraint is pressing, in three steps.
 *
 * Three rather than two because there are genuinely three things the screen needs to say,
 * and rather than five because a player glancing at a strip of meters can distinguish
 * "stop", "look" and "fine" and cannot reliably distinguish more:
 *
 *   - `critical` — the colony is being stopped by this right now. Something was shed.
 *   - `caution`  — nothing is being stopped, but value is being lost or time has run out.
 *   - `nominal`  — no attention needed.
 */
export type ConstraintTone = 'critical' | 'caution' | 'nominal'

/** The tone of each of the three constraints the screen keeps permanently on view. */
export interface ConstraintTones {
  readonly power: ConstraintTone
  readonly labour: ConstraintTone
  readonly clock: ConstraintTone
}

/**
 * The same three constraints in words.
 *
 * Words as well as colour, always. Colour alone fails a colour-blind player and fails
 * anyone reading a screenshot in a bug report, and "Brownout" is a shorter path to
 * understanding than a red bar is even for a player who can see it.
 */
export interface ConstraintVerdicts {
  readonly power: string
  readonly labour: string
  readonly clock: string
}

/** The severity of the whole colony, as the constraint strip renders it. */
export interface ConstraintBanner {
  readonly tones: ConstraintTones
  readonly verdicts: ConstraintVerdicts
  /**
   * One sentence naming what is stopping the colony, or `null` when nothing is.
   *
   * NULL, NOT A REASSURING SENTENCE. A banner that is always on screen is a banner the
   * player stops seeing, and the entire job of this one is to be noticed on the turn it
   * first appears. "All systems nominal" would cost the strip its only alarm.
   */
  readonly headline: string | null
}

/**
 * Classify the colony's live constraints from the sim's own fields.
 *
 * @param view - The selected ops view. Every field read below was produced by the sim.
 */
export function constraintBanner(view: OpsView): ConstraintBanner {
  const dronesOffline = view.dronesHeldOffline > 0

  return {
    tones: {
      // `brownout` is `power.ts`'s "true iff anything was shed". Nothing else decides this.
      power: view.brownout ? 'critical' : 'nominal',
      // Labour and power are the same constraint seen twice — a drone held offline is a
      // drone that could not be charged — so an uncharged roster is critical for the same
      // reason a brownout is: work the colony planned did not happen.
      labour: dronesOffline ? 'critical' : 'nominal',
      // `cycleInProgress` is `outlook !== null`, which the adapter clears exactly when the
      // mission concludes. Caution rather than critical: the deadline passing is not a
      // failure — `mission-verdict` says whether the colony won — it is the end of input.
      clock: view.cycleInProgress ? 'nominal' : 'caution',
    },
    verdicts: {
      power: view.brownout ? 'Brownout' : 'Grid stable',
      labour: dronesOffline
        ? `${groupDigits(view.dronesHeldOffline)} held offline`
        : 'Full roster on shift',
      clock: view.cycleInProgress ? 'Mission running' : 'Deadline reached',
    },
    headline: headlineFor(view, dronesOffline),
  }
}

/**
 * The crisis in one sentence, or `null`.
 *
 * The brownout and the idle drones are reported TOGETHER because they are one event with
 * two faces: the grid could not meet demand, and the visible cost is the drones that
 * therefore did not work. Splitting them across two readouts is what let the old screen
 * present a power shortfall and an idle workforce as unrelated statistics.
 *
 * Both fields are checked independently rather than one being inferred from the other. They
 * are separate outputs of `resolveElectricity` — a brownout can shed a structure and charge
 * every drone, and the sim is entitled to change how they relate — so a headline that read
 * only `brownout` would one day drop a fact it was written to carry.
 */
function headlineFor(view: OpsView, dronesOffline: boolean): string | null {
  const roster = `${groupDigits(view.dronesHeldOffline)} of ${groupDigits(view.droneRosterSize)} drones held offline`

  if (view.brownout) {
    return dronesOffline
      ? `Brownout — ${roster}`
      : 'Brownout — structures shed from the grid'
  }
  return dronesOffline ? roster : null
}

/**
 * Vented energy: cautionary whenever any was thrown away, and quiet when none was.
 *
 * Never `critical`. Venting stops nothing this turn — the colony met every demand it could
 * and simply had nowhere to put the surplus — so styling it as an emergency alongside a
 * brownout would spend the player's alarm on the wrong readout. It is nevertheless the
 * mechanic the whole early game turns on under the no-storage ruling, which is why it is
 * marked at all rather than left plain.
 *
 * A non-positive amount is `nominal`. `ledger.ts` never vents a negative quantity, so the
 * guard is for a future signed field: a bookkeeping correction must not light a warning.
 */
export function ventedTone(ventedElectricityWh: number): ConstraintTone {
  return ventedElectricityWh > 0 ? 'caution' : 'nominal'
}

// ---------------------------------------------------------------------------
// What the colony is made of
// ---------------------------------------------------------------------------

/** One structure the colony owns, as the rail lists it beside the map that shows it. */
export interface StandingStructure {
  /** The structure INSTANCE id, which is also the React key and the offline-list key. */
  readonly id: string
  /** The catalog's own display name, e.g. `"Reactor Hold (landed)"`. Never derived from the id. */
  readonly name: string
  /** How many tiles it stands on. */
  readonly tileCount: number
  /** Whether the colony has it in service. An offline structure neither generates nor draws. */
  readonly online: boolean
}

/**
 * Everything the colony owns, complete or not, in the queue's own order.
 *
 * WHY THE SCREEN LISTS THIS AT ALL. Two hulls is a small list today and the temptation is to
 * leave it out, but "what do I own and is it running" is the question a player asks straight
 * after "what is stopping me", and until now the screen could not answer it: the colony
 * existed only as aggregate watt-hours. The list also names the two marks on the plate, so
 * the legend's swatches connect to objects with names rather than to colours.
 *
 * SELECTION, NOT CALCULATION, exactly as `ops-view.ts`. The name is `catalog.ts`'s validated
 * `StructureType.name` — never a prettified id, which would be this layer inventing a fact
 * about a structure. `tileCount` counts a list the sim built, the same read the module header
 * sanctions for `dronesOnShift`. `online` is a membership test against the colony's own
 * `offlineStructureIds`: a lookup by key, like `ventedElectricityWh`'s find, not a rule about
 * when a structure should be in service.
 *
 * Queue order is preserved and never sorted. `construction.ts` documents array order as the
 * labour-priority order, so the list reads top to bottom in the order work reaches things —
 * and a sort here would be a second ordering to keep deterministic for no gain.
 */
export function standingStructures(view: OpsView): readonly StandingStructure[] {
  return view.queue.map((project) => ({
    id: project.id,
    name: project.structureType.name,
    tileCount: project.tiles.length,
    online: !view.offlineStructureIds.includes(project.id),
  }))
}
