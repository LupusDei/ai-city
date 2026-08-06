/**
 * Turning the sim's landing verdict into strings — and doing nothing else.
 *
 * ============================================================================
 * EVERY NUMBER HERE ARRIVES ALREADY COMPUTED (constitution §4, spec 005 FR-002)
 * ----------------------------------------------------------------------------
 * The input to this module is `LandingReadiness`: the sim's own verdict, stored unchanged by
 * the adapter. Nothing below computes a score, weighs a component, compares two sites or
 * decides whether a site is legal. `toFixed` and a percent sign are the whole of the
 * arithmetic. If a function in this file ever needs to know a rule — what makes a site good,
 * which of two scores is better — that rule belongs in `src/sim/` and the answer belongs on
 * `LandingReadiness`.
 *
 * It is plain `.ts` rather than logic inside the component for the same reason
 * `render-world.ts` is: `src/app/**\/*.tsx` is excluded from the coverage gate and pure
 * `.ts` under `src/app/` is not, so this stays inside the 80/70/60 thresholds where it can
 * be pinned by unit tests.
 * ============================================================================
 *
 * ============================================================================
 * WHY THERE IS A PENDING PLACEHOLDER, AND WHY IT IS NOT A FUDGE
 * ----------------------------------------------------------------------------
 * `evaluateLanding` cannot score one anchor. A selection with a single hull down is
 * `incomplete` and carries no `ScoreBreakdown` at all — the sim's position, and the right
 * one, because the three components it scores (buildability across BOTH footprints, average
 * proximity from BOTH anchors, the separation BETWEEN them) are each properties of the pair.
 *
 * Spec 005's AC-2.1 nevertheless asserts all four score readouts are non-empty after the
 * FIRST click. The only honest way to satisfy that is a placeholder that says "no value yet"
 * — {@link PENDING_READOUT}. The alternative would be for this module to invent a
 * single-hull score, which is precisely the game logic in a component that FR-002 forbids,
 * and it would be a number no rule in `src/sim/` could agree or disagree with.
 *
 * So the score panel is present from the first click and populated on the second. The real
 * teeth of the story are in ★AC-2.2, which places two hulls twice and requires the totals to
 * DIFFER — an assertion no placeholder can satisfy.
 * ============================================================================
 */

import type { Coord } from '../../sim/grid'
import type { HullId, LandingReadiness, LandingRejection } from '../../sim/landing'

/**
 * What a score readout shows before the sim can produce one: an em dash.
 *
 * An em dash rather than "0", "n/a" or an empty string. "0" is a lie — it is a real score a
 * genuinely terrible site could earn, and the player would have no way to tell the two
 * apart. An empty string reads as a missing element rather than an absent value, and would
 * fail AC-2.1's `not.toBeEmpty()`. An em dash is the long-standing typographic convention
 * for "no value here", needs no legend, and is unmistakably not a number.
 */
export const PENDING_READOUT = '—'

/** How many hulls a mission has to land. Both of them, or the mission does not start. */
export const TOTAL_HULLS = 2

/** The four score strings the survey screen displays, plus whether they are placeholders. */
export interface ScoreReadout {
  /** The weighted total on the sim's 0-100 scale, to one decimal place. */
  readonly total: string
  /** Average buildability across both footprints, as a whole percentage. */
  readonly buildability: string
  /** Average proximity to the nearest deposit, as a whole percentage. */
  readonly depositProximity: string
  /** The separation PENALTY between the hulls, as a whole percentage. Higher is worse. */
  readonly hullSeparation: string
  /** True when every field above is {@link PENDING_READOUT}, so the screen can style it. */
  readonly pending: boolean
}

/**
 * One decimal place on the total.
 *
 * The score is a weighted sum of three continuous components on a 0-100 scale, so a whole
 * number would collapse genuinely different sites onto the same readout — and "the score is
 * a real consequence of the choice" is the whole point of ★AC-2.2. Two decimals would imply
 * a precision the underlying hyperbolic decay curves do not warrant at the tile resolution
 * the player actually chooses at.
 */
const TOTAL_DECIMALS = 1

/**
 * Render the sim's landing verdict as the four score strings.
 *
 * `incomplete` and `rejected` both render as pending, for the same reason: neither carries a
 * `ScoreBreakdown`. They are distinguished for the player by
 * {@link landingStatusLine} and by the rejection panel, not by the score readout — a
 * refused site showing a stale score from a previous selection would be the worse failure.
 */
export function scoreReadout(readiness: LandingReadiness): ScoreReadout {
  if (readiness.status !== 'ready') {
    return {
      total: PENDING_READOUT,
      buildability: PENDING_READOUT,
      depositProximity: PENDING_READOUT,
      hullSeparation: PENDING_READOUT,
      pending: true,
    }
  }

  const { breakdown } = readiness
  return {
    // `readiness.score` and `breakdown.total` are documented as equal; the breakdown is read
    // for all four so the panel provably shows one consistent evaluation rather than a total
    // from one field and components from another.
    total: breakdown.total.toFixed(TOTAL_DECIMALS),
    buildability: formatFraction(breakdown.buildability),
    depositProximity: formatFraction(breakdown.depositProximity),
    hullSeparation: formatFraction(breakdown.hullSeparationPenalty),
    pending: false,
  }
}

/**
 * A sim component in [0, 1] as a whole percentage.
 *
 * Whole percentages, not decimals: the components are weights on a qualitative judgement
 * ("how flat", "how close"), and "80%" is read correctly at a glance where "0.804" invites
 * the player to do arithmetic the score has already done for them.
 */
function formatFraction(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

/**
 * The hulls-placed readout: "1 / 2".
 *
 * Takes a COUNT rather than a selection, because counting the player's committed hulls is
 * the adapter's `placedHulls` and this module must not grow a second way to do it.
 */
export function formatHullsPlaced(placed: number): string {
  return `${placed} / ${TOTAL_HULLS}`
}

/**
 * A hull's identifier as prose: `drone-hull` -> "drone hull".
 *
 * The dashed literal is a sim identifier, not a label. It appears verbatim in exactly one
 * place on this screen — the rejection reason, where FR-006 requires it — and nowhere else,
 * so the player never has to read an internal id as though it were English.
 */
export function hullLabel(hull: HullId): string {
  return hull === 'drone-hull' ? 'drone hull' : 'reactor hull'
}

/**
 * The sim's `missingHulls`, as prose: "drone hull and reactor hull".
 *
 * Reads the sim's own list rather than inferring what is missing from the selection, so the
 * screen and the verdict cannot disagree about what the player still owes. Empty in when
 * nothing is missing, empty out — a caller in that state has a score to show instead.
 */
export function formatMissingHulls(missing: readonly HullId[]): string {
  return missing.map(hullLabel).join(' and ')
}

/**
 * One sentence describing where the landing decision stands.
 *
 * Spec 005's AC-2.4 requires the screen to say what is MISSING while Begin Mission is
 * disabled, not merely to disable it. A disabled control with no explanation is the standard
 * way a first-time player gets stuck, and this is the sentence that prevents it.
 */
export function landingStatusLine(readiness: LandingReadiness): string {
  if (readiness.status === 'ready') {
    return 'Both hulls committed. Landing site scored — the mission can begin.'
  }
  if (readiness.status === 'rejected') {
    return 'That touchdown point was refused. Choose again.'
  }
  return `Awaiting ${formatMissingHulls(readiness.missingHulls)}.`
}

/** A tile as an ordered pair, so a rejection points at somewhere the player can find. */
export function formatTile(tile: Coord): string {
  return `(${tile.x}, ${tile.y})`
}

/**
 * Which hull the player's NEXT candidate click would commit, or `null` if none would.
 *
 * WHY THIS EXISTS. `selectSite` fills the drone hull and then the reactor hull, so a click
 * on a candidate means something different depending on what is already down — and until
 * now the screen never said which. The player's first click spent the drone hull with no
 * warning, and their second the reactor, and the only way to find out was afterwards. That
 * is the smaller half of "the first real decision is made blind", and it is the half that
 * needs no score to fix.
 *
 * READS THE SIM'S OWN `missingHulls`, and takes its FIRST entry. It does not assume the
 * order, and it does not recompute what is missing from the selection: `evaluateLanding`
 * builds that list drone-first, `withNextHull` fills the slots in the same order, and this
 * function follows whichever order the sim reports rather than holding a second opinion. If
 * the two ever disagreed, the screen would say what the sim says.
 *
 * `null` for `ready` (both slots are full — the click commits nothing, which is why the
 * markers lock) and for `rejected` (no `missingHulls` field, so there is no honest answer).
 */
export function nextHull(readiness: LandingReadiness): HullId | null {
  if (readiness.status !== 'incomplete') return null
  return readiness.missingHulls[0] ?? null
}

/** Everything a candidate marker's accessible name is built from. */
export interface CandidateMarkerLabelParams {
  readonly anchor: Coord
  /** Which hull is already committed at exactly this anchor, from `occupantOf`. */
  readonly occupant: HullId | null
  /** Whether the footprint sits inside the grid, from the site's own `legal`. */
  readonly legal: boolean
  /** What a click here would commit, from {@link nextHull}. */
  readonly next: HullId | null
}

/**
 * A candidate marker's accessible name — the ONLY place a marker's meaning is expressed.
 *
 * Nothing may be DRAWN over the map: AC-1.3 compares the terrain canvas byte for byte
 * across a reload and the marker layer is inside those bytes, so a visible label on 64
 * markers would put glyph rasterisation — and therefore font loading — into a determinism
 * check. Every one of the four states below is carried here instead, where assistive
 * technology reads it and no pixel is painted.
 *
 * The four are ordered by what the player most needs to know, and the order matters:
 *
 *   1. ILLEGAL first. A marker that is never clickable should say so before it says
 *      anything about what clicking it would do.
 *   2. OCCUPIED next. What a marker IS beats what clicking it would do — and clicking an
 *      occupied anchor is the refusal AC-2.3 provokes, not a placement.
 *   3. WHAT A CLICK WOULD COMMIT, when a slot is still open.
 *   4. WHY IT IS INERT, when none is. A disabled control that does not explain itself is
 *      how a first-time player gets stuck; the lock is stated on screen for a player who
 *      can see the fade, and here for one who cannot.
 */
export function candidateMarkerLabel(params: CandidateMarkerLabelParams): string {
  const { anchor, occupant, legal, next } = params
  const where = `Candidate touchdown point ${formatTile(anchor)}`

  if (!legal) return `${where} — outside the survey grid`
  if (occupant !== null) return `${where} — ${hullLabel(occupant)} committed here`
  if (next !== null) return `${where} — commits the ${hullLabel(next)}`
  return `${where} — landing complete; re-plot to choose again`
}

/**
 * A rejection, decomposed for display WITHOUT touching its reason.
 *
 * FR-006: "illegal actions MUST surface the sim's typed rejection reason verbatim, not a
 * generic message". `reason` is therefore passed straight through — the screen renders
 * `out-of-bounds` / `unbuildable` / `overlapping-hulls` as the sim named them. This function
 * exists only to normalise the two names the three rejection shapes use for "the tile to
 * point at": `out-of-bounds` and `overlapping-hulls` carry `tile`, while `unbuildable`
 * carries `anchor` (unbuildability is a property of the whole footprint, so there is no one
 * offending tile). Without this, the component would need a three-way switch of its own over
 * a sim union — a shape it should read, not re-implement.
 */
export interface RejectionReadout {
  /** The sim's own literal, unmodified. Rendered as-is. */
  readonly reason: LandingRejection['reason']
  /** Which hull could not be placed, or `null` for an overlap — a property of the pair. */
  readonly hull: HullId | null
  /** The tile to point the player at. */
  readonly tile: Coord
}

export function rejectionReadout(rejection: LandingRejection): RejectionReadout {
  if (rejection.reason === 'overlapping-hulls') {
    return { reason: rejection.reason, hull: null, tile: rejection.tile }
  }
  if (rejection.reason === 'unbuildable') {
    return { reason: rejection.reason, hull: rejection.hull, tile: rejection.anchor }
  }
  return { reason: rejection.reason, hull: rejection.hull, tile: rejection.tile }
}
