/**
 * The power-generation abstraction: how a source's output MOVES over its life and the
 * colony's conditions, as data plus a registered curve — never a code branch in turn
 * resolution (aic-a00.18).
 *
 * =====================================================================
 * THE DEFECT THIS MODULE FIXES
 * =====================================================================
 * Before this module, `turn.ts` computed a generator's per-turn output as
 * `electricityWh(project.structureType.produces)` — a FLAT, STATIC read from the
 * catalog, every turn, forever. `power.ts`'s own header admitted the consequence
 * without fixing it: that expression can represent a constant-output reactor and
 * NOTHING else. Accepted spec 003 requires solar arrays whose output decays ~0.4% a
 * turn to dust soiling (capped) and drops further during a dust storm. Representing
 * that needs two things neither `ConstructionProject` nor `GridParticipant` had: an
 * instance's OWN history (how long has it been generating, i.e. how soiled is it), and
 * a function that turns that history plus the colony's current conditions into a
 * watt-hour figure. This module is exactly those two things, plus the registry that
 * keeps adding a third, fourth, fifth kind a catalog-and-registration change rather
 * than a new `if` in `turn.ts`.
 *
 * =====================================================================
 * THE SHAPE, AND WHY EACH PIECE IS SEPARATE
 * =====================================================================
 * A source's RATED output — the nameplate figure, undecayed and unmodulated — stays
 * exactly where it has always lived: `StructureType.produces.electricity`, authored
 * with `power.ts`'s `energyPerTurnWh` exactly as before. Nothing about that changes,
 * which is what makes a constant reactor behave IDENTICALLY after this change (see
 * `resolveOutputModel`'s default below) and is why the golden trace does not move.
 *
 * What is new is `StructureType.powerOutputModel` (`catalog.ts`): an open string
 * naming a CURVE registered here — "how does the rated figure move" — kept separate
 * from the number itself for the same reason `siting.requiresDeposit` names a deposit
 * kind without knowing what a deposit is: `catalog.ts` holds the reference, never the
 * meaning, and a curve can be re-used by any number of structure types at any number of
 * rated wattages without restating its math once per structure. Registering
 * `'solarDecay'` once covers a 20-panel array and a 200-panel array alike; only their
 * `produces.electricity` differs.
 *
 * A curve is a pure function `(ratedWh, state, environment) => wh`, kept in a Map this
 * module owns and `registerOutputModel` extends. `currentOutputWh` is the ONE place
 * that looks a curve up by name and calls it — the seam `turn.ts` calls once per
 * participant, uniformly, with no branch on which kind it got. Adding a fourth kind is
 * one call to `registerOutputModel` plus a catalog entry naming it; nothing here or in
 * `turn.ts` changes. `tests/integration/generation-seam.test.ts` proves this by
 * registering a kind invented for the test and running it through `resolveTurn` with
 * zero changes to `turn.ts`.
 *
 * `PowerSourceState` is the per-INSTANCE history a curve reads: today, exactly
 * `turnsOperated`, an integer count of turns this instance has been in service (see
 * `turn.ts`'s frozen operational set). It lives on `ColonyState.powerSourceState`,
 * keyed by structure instance id — NOT as a field on `ConstructionProject` — for
 * exactly the reason `turn.ts` already keeps `offlineStructureIds` off
 * `ConstructionProject`: being in service, and for how long, is a fact about the WORLD
 * that only turn resolution tracks, and `construction.ts`'s own type should not grow a
 * field only the power path reads. Two arrays built on different turns therefore
 * necessarily hold two different `PowerSourceState` values keyed by their own ids, and
 * a fresh instance starts at `INITIAL_POWER_SOURCE_STATE` — soiling begins at zero the
 * turn an array is commissioned, not before.
 *
 * `GenerationEnvironment` is the colony-WIDE condition a curve may read —
 * today, exactly `dustStorm`. It is a single flag passed to every curve uniformly;
 * whether a given kind reacts to it is a decision the CURVE makes (see `SOLAR_DECAY_KIND`
 * reading it and `RADIOISOTOPE_DECAY_KIND` ignoring it entirely), never a decision
 * `turn.ts` makes on a source's behalf. That is what satisfies "a dust storm scales
 * susceptible sources with no special-casing of solar in the resolver": the resolver
 * (`currentOutputWh`) does not know or care which kinds are susceptible.
 *
 * =====================================================================
 * DETERMINISM
 * =====================================================================
 * `PowerSourceState.turnsOperated` is an INTEGER counter, advanced by exactly 1 per
 * operating turn (`advancePowerSourceState`) — never a float multiplier accumulated
 * turn over turn. Every curve below computes its output AFRESH from that integer count
 * plus its integer parameters every time it is called, rounding at most twice (once per
 * physically independent effect — soiling, then storm), and never storing the rounded
 * result back into state. That means the exact sequence of roundings a call performs
 * depends only on `turnsOperated`'s current value, not on how many times a turn has
 * been resolved before it — so 278 turns of calling `currentOutputWh` cannot drift
 * relative to calling it once at turn 278 with the same state, which is precisely the
 * float-accumulation hazard `docs/turn-composition-audit.md` C1 identifies elsewhere
 * (aic-chg) and that this module was written not to repeat.
 *
 * No `Math.random`, `Date.now`, `new Date`, and no Map/Set iteration order reaches any
 * output — the registry `Map` is used only for keyed lookup (`get`/`has`), never
 * enumerated.
 */

import type { StructureType } from './catalog'
import { electricityWh } from './power'

// ---------------------------------------------------------------------------
// Environment and per-instance state
// ---------------------------------------------------------------------------

/**
 * Colony-wide conditions capable of modulating generation, independent of any single
 * source's own history.
 *
 * Deliberately a flat struct of named conditions rather than an open string-keyed map:
 * unlike a resource kind or a structure id, the set of conditions that can affect
 * generation is a small, reviewed, code-level vocabulary — a curve has to be WRITTEN to
 * understand a condition, so an open key here would only invite a condition nothing
 * reads. Extending it (storm severity tiers, a seasonal insolation factor) is an
 * interface change reviewed like any other, not a data-authoring concern.
 */
export interface GenerationEnvironment {
  /**
   * Whether a colony-wide dust storm is active this turn. A curve decides for itself
   * whether it cares — see `SOLAR_DECAY_KIND` (does) and `RADIOISOTOPE_DECAY_KIND`
   * (does not). `turn.ts` supplies this uniformly to every source; it is never branched
   * on there.
   */
  readonly dustStorm: boolean
}

/** No active conditions. The default environment until a dust-storm scheduler exists. */
export const CALM_ENVIRONMENT: GenerationEnvironment = { dustStorm: false }

/**
 * One structure instance's generation history: how long it has been in service.
 *
 * Exactly one integer field today, because that is all any registered curve below
 * needs to derive its current output — soiling and radioactive decay are both,
 * mathematically, functions of elapsed operating time. A future curve needing MORE
 * history (turns since last cleaned, say, if a cleaning mechanic lands) extends this
 * interface once, centrally, rather than each curve inventing its own private state
 * shape that `turn.ts` would then need to know how to store.
 */
export interface PowerSourceState {
  /**
   * Turns this instance has been OPERATING (complete, not offline — `turn.ts`'s frozen
   * per-turn set), ever. Zero for a freshly commissioned source. Advanced by exactly 1
   * per operating turn; frozen while not operating (under construction, or offline) —
   * a modelling simplification stated here because it is genuinely a choice: this model
   * does not accrue soiling during downtime. Revisit if a maintenance/outage mechanic
   * makes that distinction matter.
   */
  readonly turnsOperated: number
}

/** A freshly commissioned source's state: no operating history yet. */
export const INITIAL_POWER_SOURCE_STATE: PowerSourceState = { turnsOperated: 0 }

/** @throws {RangeError} if `value` is not a non-negative integer. */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received: ${value}`)
  }
}

/**
 * Advance one instance's history by exactly one operating turn.
 *
 * Pure and integer: takes a state, returns a NEW state with `turnsOperated + 1`. Never
 * mutates its argument. `turn.ts` calls this once per structure that was operating this
 * turn (see this module's header on why downtime does not advance it), and stores the
 * result on `ColonyState.powerSourceState` for the NEXT turn to read — this turn's
 * generation is always computed from the state as it stood BEFORE this call, so a
 * freshly commissioned array's first operating turn sees `turnsOperated: 0`.
 *
 * @throws {RangeError} if `state.turnsOperated` is not a non-negative integer.
 */
export function advancePowerSourceState(state: PowerSourceState): PowerSourceState {
  assertNonNegativeInteger(state.turnsOperated, 'turnsOperated')
  return { turnsOperated: state.turnsOperated + 1 }
}

// ---------------------------------------------------------------------------
// The curve registry
// ---------------------------------------------------------------------------

/**
 * A registered output curve: given a source's RATED watt-hours (from
 * `produces.electricity`), its own history, and the colony's current conditions,
 * returns its ACTUAL output this turn in integer watt-hours.
 *
 * Deliberately ignorant of `StructureType` or catalog structure entirely — a curve is a
 * function of three plain values, which is what lets it be reused across any number of
 * structure types (see the module header) and tested with no catalog fixture at all.
 */
export type OutputCurve = (
  ratedWh: number,
  state: PowerSourceState,
  environment: GenerationEnvironment,
) => number

const registry = new Map<string, OutputCurve>()

/**
 * Register a new output curve under `kind`, the name a catalog entry spells in its
 * `powerOutputModel` field.
 *
 * THIS is the "at most, registering one named output model" extension point the
 * abstraction promises: a genuinely new kind of generator — one whose output moves
 * through time or environment in a way no existing curve captures — is one call to
 * this function plus a catalog entry naming it. Nothing in `turn.ts`, `catalog.ts`'s
 * validation, or any other registered curve is touched.
 *
 * Kept OPEN (a `Map` keyed by string) rather than a closed union of kinds for the same
 * reason `catalog.ts` keeps resource keys and deposit kinds open: a closed union would
 * mean every invented kind needs a source edit HERE, which is precisely the coupling
 * this module exists to avoid. `catalog.ts` validates only that `powerOutputModel` is a
 * non-empty string; it cannot and does not check that the name is registered, exactly
 * as it does not check that `siting.requiresDeposit` names a real deposit kind — that
 * is this module's job, at resolve time (`currentOutputWh`), where the registry lives.
 *
 * @throws {RangeError} if `kind` is empty, or already registered. Re-registration is
 *   almost always a copy-paste bug (two curves silently fighting over one name, with
 *   whichever registered last winning silently) rather than a deliberate override, so
 *   it fails loudly rather than shadowing.
 */
export function registerOutputModel(kind: string, curve: OutputCurve): void {
  if (kind.length === 0) {
    throw new RangeError('Power output model kind must be a non-empty string')
  }
  if (registry.has(kind)) {
    throw new RangeError(`Power output model kind "${kind}" is already registered`)
  }
  registry.set(kind, curve)
}

/**
 * This structure's output THIS TURN, in integer watt-hours — the function that
 * replaces the flat `electricityWh(project.structureType.produces)` read `turn.ts`
 * used to perform for every participant, every turn (aic-a00.18).
 *
 * Looks `type.powerOutputModel` up in the registry and calls the curve found there with
 * the source's rated wattage (from `produces.electricity`, via `power.ts`'s
 * `electricityWh` — the one function allowed to read that key, per its own header),
 * `state`, and `environment`. `turn.ts` calls this identically for EVERY participant —
 * generator or not, constant or decaying — which is what makes this a genuine seam
 * rather than a dispatcher wearing a seam's clothes: there is no branch here on kind,
 * only a keyed lookup.
 *
 * A structure with no `produces.electricity` at all (a pure consumer) still resolves
 * cleanly: its rated figure is `0`, and every registered curve maps a `0` rated input to
 * a `0` output, so a non-generator's `powerOutputModel` (always the default `'constant'`
 * — see `catalog.ts`) simply returns `0`, exactly as `electricityWh` used to.
 *
 * @throws {RangeError} if `type.powerOutputModel` names a kind nothing has registered
 *   (a catalog authoring defect — the name is a typo, or the intended curve's
 *   `registerOutputModel` call has not run), or if the curve's own return value is not
 *   a non-negative integer (a curve authoring defect, caught here rather than let
 *   silently corrupt the grid total three modules downstream).
 */
export function currentOutputWh(
  type: StructureType,
  state: PowerSourceState,
  environment: GenerationEnvironment,
): number {
  const curve = registry.get(type.powerOutputModel)
  if (curve === undefined) {
    throw new RangeError(
      `Structure "${type.id}" declares powerOutputModel "${type.powerOutputModel}", which ` +
        'no registerOutputModel call has registered. Check for a typo, or register the ' +
        'curve (in generation.ts, or wherever your new source kind lives) before any ' +
        'turn resolves.',
    )
  }
  const wh = curve(electricityWh(type.produces), state, environment)
  assertNonNegativeInteger(wh, `currentOutputWh("${type.powerOutputModel}") for structure "${type.id}"`)
  return wh
}

// ---------------------------------------------------------------------------
// Built-in curves
// ---------------------------------------------------------------------------

/**
 * One basis point is 1/10,000, i.e. 0.01%. Integer basis points are how
 * `SOLAR_DECAY_KIND` expresses a percentage without a single float anywhere — the same
 * "choose a small enough integer base unit" discipline `catalog.ts`'s header applies to
 * watt-hours and grams, applied here to a fraction instead of an amount.
 */
const BASIS_POINTS_WHOLE = 10_000

/** "This source's output never moves." The default every structure gets when its catalog entry names no `powerOutputModel` — see `catalog.ts`. */
export const CONSTANT_OUTPUT_KIND = 'constant'

registerOutputModel(CONSTANT_OUTPUT_KIND, (ratedWh) => ratedWh)

/**
 * A photovoltaic array's output curve (spec 003): rated output, reduced by cumulative
 * dust soiling and, on top of that, by an active dust storm.
 *
 * FIGURES, cited so nobody has to re-derive them from the accepted proposal:
 *   - `SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN` = 40 (0.40%/turn). One Martian sol of
 *     dust deposition costs a panel roughly that fraction of its output; over a
 *     2.014-sol turn (`power.ts`'s turn-capacity block) that is ~0.4% a turn
 *     (docs/proposals/02-chain-silica-solar.html, "Risk one: dust deposition").
 *   - `SOLAR_SOILING_CAP_BASIS_POINTS` = 6,000 (60%). Soiling does not compound to
 *     zero — wind gusts and the shallow angle of low-elevation dust give a natural
 *     floor. The proposal's own recommendation: "Cap cumulative soiling loss — ~60%".
 *   - `SOLAR_STORM_RETENTION_BASIS_POINTS` = 1,000 (10% retained, i.e. -90% output).
 *     The proposal's illustrative storm band: "storm: -90% output, 30 turns".
 *
 * Composed as two INDEPENDENT multiplicative reductions, each rounded once at the point
 * it is applied (soiling first, storm second) rather than combined into one product
 * before rounding — two physically separate effects, so two separate roundings, matching
 * this project's "round once, at the point of definition" convention rather than
 * inventing a single combined-and-rounded formula that would need re-deriving if either
 * figure changes independently.
 */
export const SOLAR_DECAY_KIND = 'solarDecay'

/** See `SOLAR_DECAY_KIND`'s doc for the citation. */
export const SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN = 40
/** See `SOLAR_DECAY_KIND`'s doc for the citation. */
export const SOLAR_SOILING_CAP_BASIS_POINTS = 6_000
/** See `SOLAR_DECAY_KIND`'s doc for the citation. */
export const SOLAR_STORM_RETENTION_BASIS_POINTS = 1_000

registerOutputModel(SOLAR_DECAY_KIND, (ratedWh, state, environment) => {
  const soilingLossBp = Math.min(
    state.turnsOperated * SOLAR_SOILING_DECAY_BASIS_POINTS_PER_TURN,
    SOLAR_SOILING_CAP_BASIS_POINTS,
  )
  const afterSoilingWh = Math.round((ratedWh * (BASIS_POINTS_WHOLE - soilingLossBp)) / BASIS_POINTS_WHOLE)
  if (!environment.dustStorm) return afterSoilingWh
  return Math.round((afterSoilingWh * SOLAR_STORM_RETENTION_BASIS_POINTS) / BASIS_POINTS_WHOLE)
})

/**
 * A radioisotope thermoelectric generator's output curve — INVENTED for this bead, to
 * prove the abstraction genuinely supports a THIRD, independently-shaped kind with no
 * change to `turn.ts`, `catalog.ts`'s validation, or `SOLAR_DECAY_KIND` (spec 003
 * requirements 1 and 2). Not itself required by any accepted spec.
 *
 * Physically real nonetheless: an RTG's output falls as its isotope decays, on a
 * timescale set by the isotope's half-life rather than by weather. Pu-238 (the isotope
 * NASA's MMRTGs use) has a ~87.7-year half-life, giving a continuous decay rate of
 * ln(2)/87.7 ≈ 0.79%/YEAR. Converted to this project's ~2.069-Earth-day turn
 * (`power.ts`'s 178,775 s turn, / 86,400 s/day), that is ≈ 45 PARTS PER MILLION per
 * turn — three orders of magnitude finer than `SOLAR_DECAY_KIND`'s basis points, which
 * is exactly why this curve uses its OWN integer granularity
 * (`RADIOISOTOPE_DECAY_PPM_WHOLE`) rather than forcing an unrelated physical process
 * into somebody else's unit. That is the point being proven: a new kind brings
 * whatever integer scale its own physics calls for, and nothing here has to agree.
 *
 * Deliberately does NOT read `environment` at all — an RTG's thermoelectric conversion
 * is indifferent to dust storms, which is the other half of the proof: `currentOutputWh`
 * passes `environment` to every curve uniformly, and whether a curve uses it is entirely
 * the curve's own decision, never `turn.ts`'s.
 */
export const RADIOISOTOPE_DECAY_KIND = 'radioisotopeDecay'

/** One "whole" in parts-per-million, this curve's own fractional unit. See its doc. */
const RADIOISOTOPE_DECAY_PPM_WHOLE = 1_000_000
/** ≈ ln(2)/87.7 years, converted to this project's turn length. See the curve's doc. */
export const RADIOISOTOPE_DECAY_PPM_PER_TURN = 45

registerOutputModel(RADIOISOTOPE_DECAY_KIND, (ratedWh, state) => {
  const retainedPpm = Math.max(
    0,
    RADIOISOTOPE_DECAY_PPM_WHOLE - state.turnsOperated * RADIOISOTOPE_DECAY_PPM_PER_TURN,
  )
  return Math.round((ratedWh * retainedPpm) / RADIOISOTOPE_DECAY_PPM_WHOLE)
})
