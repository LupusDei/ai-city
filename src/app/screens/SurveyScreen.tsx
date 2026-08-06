/**
 * The Surface Survey screen — the player's first sight of the game, and their first decision.
 *
 * ============================================================================
 * IT DECIDES NOTHING (constitution §4, spec 005 FR-002 / FR-004)
 * ----------------------------------------------------------------------------
 * Every number on this screen arrives already computed. The score and its three components
 * come from `LandingReadiness`, which the adapter stores exactly as the sim produced it. The
 * refusal comes from `LandingRejection`, rendered verbatim. The hull count comes from the
 * adapter's `placedHulls`. Whether Begin Mission is available is `readiness.status === 'ready'`
 * — the sim's word, not a check of this screen's own.
 *
 * Nothing here compares two sites, weighs a component, or forms an opinion about legality. The
 * only judgement this file makes is which of the sim's answers to put where, and how to say
 * it. Three gates hold that line: `tests/unit/app-boundary.test.ts` (no sim state transitions
 * outside `src/app/state/`), `tests/integration/composition-audit.test.ts`, and
 * `tests/unit/boundary.test.ts`.
 *
 * The screen is a PURE FUNCTION OF ITS PROPS: it holds no state of its own and calls no
 * dispatcher. Every gesture is an upward callback, and `App.tsx` turns each into exactly one
 * intent. That is what makes ★AC-4.3-style determinism possible through the UI — a screen with
 * private state is a screen that can disagree with the sim about what is happening.
 * ============================================================================
 *
 * ============================================================================
 * WHY THE MAP IS THE HERO, AND THE PANEL SITS BESIDE IT
 * ----------------------------------------------------------------------------
 * The decision is about the map, so the map is the largest thing on the page and the terrain
 * is the brightest ink on it — iron-oxide red, shaded by elevation, darkening toward basalt
 * where the ground is too steep to build on. The chrome is deliberately quiet basalt so
 * nothing competes with it. `SURVEY_TILE_SIZE` draws it at 640 square rather than the
 * renderer's default 512, which is as large as AC-1.3's element screenshot can be captured in
 * one pass at the acceptance viewport; that constant's docblock has the arithmetic.
 *
 * The assessment panel is immediately to the right rather than below, so a candidate's score
 * can be read without the eye leaving the site it belongs to. Its three components are shown
 * as bars as well as numbers, because the player's real question is not "what is the score" but
 * "what is this site BAD at" — and a shortfall is a shape before it is a figure.
 *
 * Session identity — seed, deposit count, grid — lives in the masthead, because those are facts
 * about the world rather than about the decision, and the seed in particular is FR-005's
 * reproducibility contract rather than a scoring input.
 * ============================================================================
 *
 * ============================================================================
 * THE MARKERS ARE RETICLES BECAUSE A FILLED BOX HID THE THING BEING CHOSEN
 * ----------------------------------------------------------------------------
 * The lattice used to draw sixty-four filled squares of identical weight at an even 8-tile
 * pitch. Two things were wrong with that, and the second is the serious one.
 *
 * It READ as a diagnostic layer — a uniform grid of interchangeable boxes, which is what a
 * debug overlay looks like, so the affordance did not announce itself as a decision. The
 * legend now names the reticles for what they are (one candidate per survey cell), which is
 * the cheapest possible fix for "what am I looking at".
 *
 * But a filled box also OCCLUDED the terrain inside the footprint — and that terrain is the
 * only basis the player has for preferring one site to another, because the map already
 * encodes buildability as a darkening toward basalt and says so in the legend. The screen was
 * painting over its own answer. So the resting marker is four corner ticks with nothing in
 * the middle: the ground shows through at full strength, and comparing two sites is looking
 * at the two patches of ground inside two reticles.
 *
 * Hover and keyboard focus close the reticle into the full 2x2 footprint, in the COLOUR OF
 * THE HULL THAT CLICK WOULD COMMIT (`nextHull`, read from the sim's own `missingHulls`). That
 * is the pre-commitment answer this screen can honestly give without a score: which hull, and
 * exactly which four tiles. The same fact is stated as a NEXT tag on the landing-party row,
 * so it is available where the player is reading as well as where they are pointing.
 *
 * WHAT IS STILL MISSING, AND IT IS NOT AN OVERSIGHT. There is no PREVIEW SCORE for a hovered
 * candidate, because there is nowhere legitimate for one to come from. `evaluateLandingOn` is
 * on `app-boundary.test.ts`'s list of sim state transitions that only `src/app/state/` may
 * call, and rightly so — a component scoring a hypothetical pair would be a second source of
 * truth for the number the panel already shows. The adapter exposes no hypothetical-landing
 * field, so the honest options were "add one to the adapter" or "do without", and a screen
 * does not get to widen its own boundary. See the handoff note on this bead.
 * ============================================================================
 *
 * ============================================================================
 * THE SELECTION IS COMMITTED, AND THAT IS WHY THE MARKERS LOCK
 * ----------------------------------------------------------------------------
 * `selectSite` fills the drone hull, then the reactor hull, and once both are down there is no
 * slot left: `dispatch` returns the identical state for any further `select-site`. So once the
 * landing is complete this screen DISABLES every candidate marker and offers "Re-plot landing"
 * (`clear-selection`) next to Begin Mission.
 *
 * The two alternatives were both worse. Leaving the markers live would be a control that
 * silently does nothing — an inert control that explains itself beats a live one that does not
 * respond. Making a marker click re-plot from that candidate reads well and is what a player
 * would try, but it puts a DESTRUCTIVE action behind an ordinary click with no undo, on the
 * screen where the player is least experienced: one mis-click and a chosen pair is gone. So the
 * reset is explicit, labelled, and adjacent to the decision it undoes.
 *
 * "Re-plot landing" appears as soon as ONE hull is committed, not only when both are, because a
 * first anchor is just as committed as a second and just as likely to be regretted.
 * ============================================================================
 *
 * AC-1.3 (byte-identical terrain across a reload) constrains the marker layer, because the
 * markers are painted on top of the canvas the acceptance suite screenshots. No text over the
 * map, no transitions on a marker, no measured sizes, no blur or blend over the canvas,
 * whole-pixel geometry. See `survey-styles.ts` and `candidate-sites.ts` for the details, and
 * `canvas/render-world.ts`'s docblock for the underlying rules.
 */
import { type CSSProperties, type JSX, useMemo, useState } from 'react'

import { TerrainCanvas } from '../canvas/TerrainCanvas'
import { worldPixelSize } from '../canvas/render-world'
import { formatDepositCount, formatGridDimensions } from '../world-readouts'
import type { SurveyingState } from '../state/game-state'
import { placedHulls, previewLanding } from '../state/game-state'
import type { Coord } from '../../sim/grid'
import type { HullId, LandingReadiness } from '../../sim/landing'
import {
  BUILDABILITY_WEIGHT,
  DEPOSIT_PROXIMITY_WEIGHT,
  HULL_SEPARATION_PENALTY_WEIGHT,
  SCORE_SCALE,
} from '../../sim/landing'
import {
  candidateGrounds,
  candidateMarkerBox,
  candidateSites,
  candidateTestId,
  groundInk,
  groundTickLength,
  occupantOf,
} from './candidate-sites'
import { PLATE_FRAME_PX, SURVEY_STYLES, SURVEY_TILE_SIZE } from './survey-styles'
import {
  TOTAL_HULLS,
  candidateMarkerLabel,
  formatHullsPlaced,
  formatTile,
  hullLabel,
  landingStatusLine,
  nextHull,
  rejectionReadout,
  scoreReadout,
} from './survey-readouts'

export interface SurveyScreenProps {
  /** The adapter's surveying state. Read only; this screen never mutates it. */
  readonly state: SurveyingState
  /** Commit the next hull at `anchor` — one `select-site` intent, decided by the adapter. */
  readonly onSelectSite: (anchor: Coord) => void
  /** Discard both anchors and survey the same world again — one `clear-selection` intent. */
  readonly onClearSelection: () => void
  /** Turn the scored landing into a running colony — one `begin-mission` intent. */
  readonly onBeginMission: () => void
  /** Device pixels per tile. Defaults to this screen's own {@link SURVEY_TILE_SIZE}. */
  readonly tileSize?: number
}

/** One weight, as the whole-number figure the sim's constant represents. */
function weightPoints(weight: number): string {
  return (weight * SCORE_SCALE).toFixed(0)
}

export function SurveyScreen({
  state,
  onSelectSite,
  onClearSelection,
  onBeginMission,
  tileSize = SURVEY_TILE_SIZE,
}: SurveyScreenProps): JSX.Element {
  const { seed, world, selection, readiness, rejection } = state

  // Keyed on the grid, which never changes for a session: `beginSurvey` generates the world
  // exactly once and `clear-selection` carries it through by reference. So this recomputes
  // never in practice, and the memo is documentation of that fact as much as an optimisation.
  const sites = useMemo(() => candidateSites(world.grid), [world.grid])
  /**
   * The sim's buildability reading under each candidate's footprint, in lattice order.
   * A property of the WORLD alone, so it is computed once per session like the lattice
   * itself and never per hover — see `candidateGrounds` for why a marker carries one.
   */
  const grounds = useMemo(() => candidateGrounds(sites, world.buildability), [sites, world])

  /**
   * The candidate under the pointer or the keyboard focus, or `null`.
   *
   * THE ONE PIECE OF STATE THIS SCREEN HOLDS, and it is worth naming why that is safe when
   * the header insists the screen is a pure function of its props. What that rule protects
   * is the screen's ability to DISAGREE WITH THE SIM about what is happening: a screen that
   * remembers a score, a selection or a turn can render something the sim never said. This
   * remembers a pointer. It holds a `Coord` that came from the lattice, it feeds exactly one
   * thing — a preview the ADAPTER computes from it — and it can no more contradict the sim
   * than the mouse itself can. It is also outside the intent path entirely, so ★AC-4.3's
   * determinism is untouched: hovering dispatches nothing and changes no game state.
   */
  const [hovered, setHovered] = useState<Coord | null>(null)

  const placed = placedHulls(selection)
  /** Both hulls down: the decision is complete, so the markers stop taking input. */
  const locked = placed.length >= TOTAL_HULLS
  const score = scoreReadout(readiness)
  const canBegin = readiness.status === 'ready'
  const { width, height } = worldPixelSize(world, tileSize)
  /**
   * Which hull the next candidate click would commit — the sim's own `missingHulls`, read
   * through {@link nextHull}. Drives three things that used to be invisible: the marker
   * layer's hover colour, the roster's NEXT tag, and every marker's accessible name.
   */
  const awaiting = nextHull(readiness)
  /**
   * The sim's verdict on the landing the player would have if they committed the hovered
   * candidate next — from the ADAPTER's `previewLanding`, never computed here.
   *
   * Suppressed once both hulls are down: nothing further can be committed, so a preview
   * would only restate the committed assessment sitting directly beneath it.
   */
  const preview =
    hovered !== null && awaiting !== null ? previewLanding(state, hovered) : null

  return (
    <>
      {/* Outside <main>, so the stylesheet's text is not part of the survey screen's own
          textContent — which tests and assistive technology both read. */}
      <style>{SURVEY_STYLES}</style>
      <main className="survey" data-testid="survey-screen">
        <header className="survey__masthead">
          <div>
            <p className="survey__eyebrow">AI City · Mars colony</p>
            <h1 className="survey__title">Surface Survey</h1>
          </div>
          <dl className="survey__facts">
            <div className="survey__fact">
              <dt>Mission seed</dt>
              {/* The readout's ENTIRE text is the seed: FR-005 asks for a reproducible
                  number, and a label inside this element would make it unreadable as one. */}
              <dd data-testid="seed-readout">{seed}</dd>
            </div>
            <div className="survey__fact">
              <dt>Mineral deposits</dt>
              {/* Exactly the shared formatter's string — ★AC-3.2 compares this element's
                  whole text against the operations screen with `toHaveText`. */}
              <dd data-testid="deposit-count">{formatDepositCount(world)}</dd>
            </div>
            <div className="survey__fact">
              <dt>Survey grid</dt>
              <dd data-testid="grid-dimensions">{formatGridDimensions(world.grid)}</dd>
            </div>
          </dl>
        </header>

        <div className="survey__body">
          <section
            className="survey__plate"
            aria-label="Surface survey and candidate landing sites"
            // Pinned to the map's own width so the legend wraps INSIDE the plate instead of
            // stretching it to the width of its longest line — which would push the
            // assessment column onto a row of its own. See PLATE_FRAME_PX.
            style={{ width: `${String(width + PLATE_FRAME_PX * 2)}px` }}
          >
            <div
              className="plate__stack"
              // Sized from the world and the tile size alone — never measured. A measured
              // size depends on layout, which depends on font loading, which is exactly the
              // nondeterminism AC-1.3 forbids.
              style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
            >
              <TerrainCanvas world={world} tileSize={tileSize} />
              <div
                className="plate__markers"
                // The hull a click would commit, hoisted to the LAYER rather than set on
                // each marker: it is one fact about the decision, not sixty-four facts
                // about sixty-four sites, and the stylesheet reads it to tint every
                // reticle's hover state to that hull's colour. Absent once nothing further
                // can be committed, so the locked layer advertises no pending gesture.
                {...(awaiting !== null ? { 'data-next': awaiting } : {})}
              >
                {sites.map((site, index) => {
                  const box = candidateMarkerBox(site.anchor, tileSize)
                  const occupant = occupantOf(selection, site.anchor)
                  return (
                    <button
                      key={candidateTestId(site.anchor)}
                      type="button"
                      className="marker"
                      data-testid={candidateTestId(site.anchor)}
                      data-legal={String(site.legal)}
                      // Absent rather than empty when unoccupied, so the CSS can select on
                      // presence and an occupied marker stays legible after the lock.
                      {...(occupant !== null ? { 'data-hull': occupant } : {})}
                      // An illegal anchor is never offered: `evaluateLanding` cannot refuse a
                      // single anchor, so an out-of-bounds first hull would be accepted here
                      // and only surface on the SECOND click, blamed on the wrong hull.
                      disabled={!site.legal || locked}
                      aria-pressed={occupant !== null}
                      // The marker's meaning is carried here and drawn nowhere: not one glyph
                      // may be painted over the canvas AC-1.3 compares byte for byte.
                      aria-label={candidateMarkerLabel({
                        anchor: site.anchor,
                        occupant,
                        legal: site.legal,
                        next: awaiting,
                      })}
                      style={
                        {
                          left: `${String(box.left)}px`,
                          top: `${String(box.top)}px`,
                          width: `${String(box.size)}px`,
                          height: `${String(box.size)}px`,
                          // How strongly this reticle is inked: the sim's own buildability
                          // reading for the ground under this footprint. A custom property
                          // rather than a colour, so the stylesheet's hover and committed
                          // rules can still override `--tick` outright — an inline `--tick`
                          // would outrank every rule in the sheet.
                          '--ground-ink': groundInk(grounds[index] ?? Number.NaN),
                          // The same reading as a length, so it survives being drawn over
                          // pale dust where an alpha difference does not. Whole pixels.
                          '--tick-len': `${String(groundTickLength(grounds[index] ?? Number.NaN))}px`,
                          // The cast is what a custom property costs: React types `style` as
                          // CSSProperties, which has no index signature for `--*`.
                        } as CSSProperties
                      }
                      onClick={() => {
                        onSelectSite(site.anchor)
                      }}
                      // Pointer AND keyboard, so the preview is not a mouse-only feature.
                      onMouseEnter={() => {
                        setHovered(site.anchor)
                      }}
                      onMouseLeave={() => {
                        setHovered(null)
                      }}
                      onFocus={() => {
                        setHovered(site.anchor)
                      }}
                      onBlur={() => {
                        setHovered(null)
                      }}
                    >
                      <span
                        className="marker__mark"
                        aria-hidden="true"
                        // The visible mark is the hull's true 2x2 footprint; the button box
                        // around it is a larger touch target. Drawing the mark any bigger
                        // would misinform the player about what they are placing.
                        style={{
                          width: `${String(box.footprintSize)}px`,
                          height: `${String(box.footprintSize)}px`,
                        }}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
            <ul className="plate__legend">
              <li className="legend__item">
                <span className="legend__swatch legend__swatch--ground" aria-hidden="true" />
                Clean oxide is buildable; steep ground darkens toward basalt
              </li>
              {/* Says what the reticles ARE, and what their weight MEANS. Sixty-four
                  identical marks with no legend entry read as a diagnostic layer someone
                  left switched on. Naming them as the survey's own plot fixes that; naming
                  what their brightness encodes is what makes the plot readable, in the same
                  spirit as the terrain line above it — the map teaches its own notation
                  rather than needing a tutorial. */}
              <li className="legend__item">
                <span className="legend__swatch legend__swatch--site" aria-hidden="true" />
                Reticles plot candidate touchdown points; bolder marks sit on flatter ground
              </li>
              <li className="legend__item">
                <span className="legend__swatch legend__swatch--silica" aria-hidden="true" />
                Silica
              </li>
              <li className="legend__item">
                <span className="legend__swatch legend__swatch--ice" aria-hidden="true" />
                Ice
              </li>
              <li className="legend__item">
                <span className="legend__swatch legend__swatch--drone" aria-hidden="true" />
                Drone hull
              </li>
              <li className="legend__item">
                <span className="legend__swatch legend__swatch--reactor" aria-hidden="true" />
                Reactor hull
              </li>
            </ul>
          </section>

          <aside className="survey__assessment">
            <section className="panel">
              <h2 className="panel__heading">Landing party</h2>
              <dl className="roster">
                <RosterRow
                  hull="drone-hull"
                  anchor={selection.droneHullAnchor}
                  next={awaiting === 'drone-hull'}
                />
                <RosterRow
                  hull="reactor-hull"
                  anchor={selection.reactorHullAnchor}
                  next={awaiting === 'reactor-hull'}
                />
              </dl>
              <div className="tally">
                <span className="tally__label">Hulls committed</span>
                <span className="tally__value" data-testid="hulls-placed">
                  {formatHullsPlaced(placed.length)}
                </span>
              </div>
            </section>

            <section className="panel">
              <h2 className="panel__heading">Site assessment</h2>
              {/* The pre-commitment answer. Rendered ABOVE the committed assessment and
                  visibly distinct from it, rather than replacing its figures: a panel whose
                  headline number changes as the pointer drifts would make the committed
                  score unreadable, and the two must never be confusable. The committed
                  readouts — the ones the acceptance contract pins — are untouched by hover. */}
              {preview !== null && hovered !== null && (
                <Preview
                  anchor={hovered}
                  readiness={preview}
                  occupant={occupantOf(selection, hovered)}
                  awaiting={awaiting}
                />
              )}
              <div className="score">
                <span
                  className={score.pending ? 'score__value score__value--pending' : 'score__value'}
                  data-testid="site-score"
                >
                  {score.total}
                </span>
                <span className="score__scale">/ {SCORE_SCALE}</span>
              </div>
              <div className="components">
                <Component
                  label="Terrain buildability"
                  testId="score-buildability"
                  value={score.buildability}
                  pending={score.pending}
                />
                <Component
                  label="Deposit proximity"
                  testId="score-deposit-proximity"
                  value={score.depositProximity}
                  pending={score.pending}
                />
                <Component
                  label="Hull separation penalty"
                  testId="score-hull-separation"
                  value={score.hullSeparation}
                  pending={score.pending}
                  penalty
                />
              </div>
              {/* The weights are the sim's own exported constants, read rather than restated,
                  so this line cannot drift from the arithmetic it describes. */}
              <p className="component__note">
                Weighted {weightPoints(BUILDABILITY_WEIGHT)} buildability and{' '}
                {weightPoints(DEPOSIT_PROXIMITY_WEIGHT)} proximity, less{' '}
                {weightPoints(HULL_SEPARATION_PENALTY_WEIGHT)} for separation.
              </p>
              {/* Why the figures are dashes, said where the dashes are. `evaluateLanding`
                  cannot score one anchor — every component is a property of the PAIR — so
                  there is nothing honest to show until the second hull is down. Without this
                  sentence a panel of em dashes reads as a screen that is broken rather than
                  as one that is waiting.

                  BELOW the score rather than above it, deliberately: the total and its three
                  bars then occupy the same place in the panel whether they are resolved or
                  pending, so the figures do not jump down the page at the moment the player
                  is trying to read them. */}
              {score.pending && preview === null && (
                <p className="component__pending">
                  Nothing is scored until both hulls are committed: every component is a property
                  of the pair — buildability across both footprints, proximity averaged over both
                  anchors, and the separation between them. Point at a candidate to preview the
                  landing it would give you.
                </p>
              )}
            </section>

            <section className="panel">
              <h2 className="panel__heading">Mission start</h2>
              {rejection !== null && <Refusal rejection={rejection} />}
              <button
                type="button"
                className="begin"
                data-testid="begin-mission"
                // The sim's verdict, not this screen's. `dispatch` refuses `begin-mission`
                // for a landing that is not ready regardless, so this is the brace to that
                // belt rather than the only guard.
                disabled={!canBegin}
                onClick={onBeginMission}
              >
                Begin mission
              </button>
              <p className={locked ? 'status status--locked' : 'status'}>
                {landingStatusLine(readiness)}
                {locked && ' Candidate sites are locked — re-plot to choose again.'}
              </p>
              {placed.length > 0 && (
                <button
                  type="button"
                  className="replot"
                  data-testid="clear-selection"
                  onClick={onClearSelection}
                >
                  Re-plot landing
                </button>
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  )
}

interface PreviewProps {
  readonly anchor: Coord
  /** The ADAPTER's verdict on committing `anchor` next. Rendered, never re-derived. */
  readonly readiness: LandingReadiness
  /** Which hull already sits on `anchor`, if any. */
  readonly occupant: HullId | null
  /** Which hull a click here would commit. */
  readonly awaiting: HullId | null
}

/**
 * What the landing WOULD be if the player committed the site under the pointer.
 *
 * This is the answer to the complaint that the opening decision was made blind: the whole
 * assessment used to be inert dashes until both hulls were down and both commitments were
 * irreversible, so the screen only told the player how they had done AFTER they had done it.
 *
 * FOUR STATES, and the honesty of the middle two is the point:
 *
 *   1. SCORED. Both slots would be full, so the sim can score the pair — and this is
 *      literally the same `LandingReadiness` the player will get by clicking, produced by
 *      the same `evaluateLandingOn` call, so the preview cannot lie by construction.
 *   2. NOT SCOREABLE YET, with no hull down. A landing is a PAIR: buildability spans both
 *      footprints, proximity is averaged over both anchors, and separation is the distance
 *      BETWEEN them. The sim genuinely cannot score one anchor, so the first hovered
 *      candidate has no number and this says so in as many words rather than inventing one.
 *      What the player CAN read for that first choice is the ground itself — which is why
 *      the reticles carry buildability and why they no longer cover the terrain.
 *   3. REFUSED. The sim's typed reason, verbatim (FR-006), shown BEFORE the click instead
 *      of after it.
 *   4. ALREADY TAKEN. Reported as occupancy rather than as the `overlapping-hulls` refusal
 *      it would technically produce — the pointer sits on the anchor the player just
 *      clicked more often than anywhere else, and flashing a refusal at them for the act of
 *      not having moved the mouse yet would be alarming and useless.
 */
function Preview({ anchor, readiness, occupant, awaiting }: PreviewProps): JSX.Element {
  const score = scoreReadout(readiness)
  return (
    <div className="preview">
      <div className="preview__head">
        <span className="preview__label">If you land here</span>
        <span className="preview__tile mono">{formatTile(anchor)}</span>
      </div>
      {occupant !== null ? (
        <p className="preview__note">The {hullLabel(occupant)} is already committed here.</p>
      ) : readiness.status === 'rejected' ? (
        <p className="preview__note">
          This touchdown point would be refused:{' '}
          <code className="refusal__reason">{readiness.rejection.reason}</code>
        </p>
      ) : readiness.status === 'incomplete' ? (
        <p className="preview__note">
          {awaiting === null ? '' : `Commits the ${hullLabel(awaiting)}. `}A site is scored as a
          pair, so there is no score to show until the second hull is placed — judge this one by
          its ground.
        </p>
      ) : (
        <>
          <div className="preview__score">
            <span className="preview__total">{score.total}</span>
            <span className="score__scale">/ {SCORE_SCALE}</span>
          </div>
          <ul className="preview__parts">
            <li>
              Buildability <span className="mono">{score.buildability}</span>
            </li>
            <li>
              Proximity <span className="mono">{score.depositProximity}</span>
            </li>
            <li>
              Separation <span className="mono">{score.hullSeparation}</span>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

interface RosterRowProps {
  readonly hull: HullId
  /** Where this hull is committed, or `null` if it is not. */
  readonly anchor: Coord | null
  /** Whether the player's next candidate click would commit THIS hull. */
  readonly next: boolean
}

/**
 * One hull's line in the landing party: what it is, where it is, and whether it is the one
 * the next click spends.
 *
 * THE "NEXT" TAG IS THE POINT. A click on a candidate fills the drone hull and then the
 * reactor hull, and nothing on the old screen said so — the player's first two clicks each
 * spent a hull whose identity they learned only afterwards. The tag names it before the
 * click, and the marker layer previews the same fact as the reticle's hover colour, so the
 * answer is available both where the player is reading and where they are pointing.
 */
function RosterRow({ hull, anchor, next }: RosterRowProps): JSX.Element {
  const label = hullLabel(hull)
  return (
    <div className={next ? 'roster__row roster__row--next' : 'roster__row'}>
      <dt className="roster__hull">
        <span
          className={hull === 'drone-hull' ? 'roster__chip' : 'roster__chip roster__chip--reactor'}
          aria-hidden="true"
        />
        {/* Capitalised in CSS-free prose rather than by a text-transform, so the accessible
            name and the visible text are the same string. */}
        {label.charAt(0).toUpperCase() + label.slice(1)}
        {next && <span className="roster__next">Next</span>}
      </dt>
      <dd className={anchor === null ? 'roster__at roster__at--empty' : 'roster__at'}>
        {anchor === null ? 'not committed' : formatTile(anchor)}
      </dd>
    </div>
  )
}

interface ComponentProps {
  readonly label: string
  readonly testId: string
  /** The already-formatted percentage, or the pending placeholder. */
  readonly value: string
  readonly pending: boolean
  readonly penalty?: boolean
}

/**
 * One scored component: its name, its figure, and its magnitude as a bar.
 *
 * The bar's width IS the formatted string. That is not a trick for its own sake — it makes it
 * impossible for the bar and the number to disagree, which is the failure mode a separately
 * computed width would eventually produce. While pending there is no value to draw, so the
 * track renders empty rather than at some default the player might read as a real figure.
 */
function Component({ label, testId, value, pending, penalty = false }: ComponentProps): JSX.Element {
  return (
    <div className="component">
      <div className="component__head">
        <span className="component__label">{label}</span>
        <span className="component__value" data-testid={testId}>
          {value}
        </span>
      </div>
      <div className="component__track">
        <div
          className={penalty ? 'component__fill component__fill--penalty' : 'component__fill'}
          style={{ width: pending ? '0%' : value }}
        />
      </div>
    </div>
  )
}

/**
 * Why the sim refused the last attempted touchdown.
 *
 * FR-006: "illegal actions MUST surface the sim's typed rejection reason verbatim, not a
 * generic message". So `reason` is rendered as the sim's own literal, in a `<code>` element
 * that presents it as an identifier rather than as English. The structured detail — which hull,
 * which tile — sits alongside it as separate fields, deliberately not folded into a sentence
 * that would replace the literal with prose.
 */
function Refusal({ rejection }: { readonly rejection: Parameters<typeof rejectionReadout>[0] }): JSX.Element {
  const readout = rejectionReadout(rejection)
  return (
    <div className="refusal" data-testid="rejection-reason" role="status">
      <h3 className="refusal__heading">Touchdown refused</h3>
      <code className="refusal__reason">{readout.reason}</code>
      <p className="refusal__detail">
        {readout.hull === null
          ? 'The two hulls would share ground at '
          : `The ${hullLabel(readout.hull)} could not be placed at `}
        <span className="mono">{formatTile(readout.tile)}</span>.
      </p>
    </div>
  )
}
