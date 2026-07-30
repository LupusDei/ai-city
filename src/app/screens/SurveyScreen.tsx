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
 * nothing competes with it.
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
 * map, no transitions on a marker, no measured sizes, whole-pixel geometry. See
 * `styles.ts` and `candidate-sites.ts` for the details, and `canvas/render-world.ts`'s docblock
 * for the underlying rules.
 */
import { type JSX, useMemo } from 'react'

import { TerrainCanvas } from '../canvas/TerrainCanvas'
import { DEFAULT_TILE_SIZE, worldPixelSize } from '../canvas/render-world'
import { formatDepositCount, formatGridDimensions } from '../world-readouts'
import { SURVEY_STYLES } from '../styles'
import type { SurveyingState } from '../state/game-state'
import { placedHulls } from '../state/game-state'
import type { Coord } from '../../sim/grid'
import {
  BUILDABILITY_WEIGHT,
  DEPOSIT_PROXIMITY_WEIGHT,
  HULL_SEPARATION_PENALTY_WEIGHT,
  SCORE_SCALE,
} from '../../sim/landing'
import {
  candidateMarkerBox,
  candidateSites,
  candidateTestId,
  occupantOf,
} from './candidate-sites'
import {
  TOTAL_HULLS,
  formatHullsPlaced,
  formatTile,
  hullLabel,
  landingStatusLine,
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
  /** Device pixels per tile. Defaults to the renderer's own {@link DEFAULT_TILE_SIZE}. */
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
  tileSize = DEFAULT_TILE_SIZE,
}: SurveyScreenProps): JSX.Element {
  const { seed, world, selection, readiness, rejection } = state

  // Keyed on the grid, which never changes for a session: `beginSurvey` generates the world
  // exactly once and `clear-selection` carries it through by reference. So this recomputes
  // never in practice, and the memo is documentation of that fact as much as an optimisation.
  const sites = useMemo(() => candidateSites(world.grid), [world.grid])

  const placed = placedHulls(selection)
  /** Both hulls down: the decision is complete, so the markers stop taking input. */
  const locked = placed.length >= TOTAL_HULLS
  const score = scoreReadout(readiness)
  const canBegin = readiness.status === 'ready'
  const { width, height } = worldPixelSize(world, tileSize)

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
          <section className="survey__plate" aria-label="Surface survey and candidate landing sites">
            <div
              className="plate__stack"
              // Sized from the world and the tile size alone — never measured. A measured
              // size depends on layout, which depends on font loading, which is exactly the
              // nondeterminism AC-1.3 forbids.
              style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
            >
              <TerrainCanvas world={world} tileSize={tileSize} />
              <div className="plate__markers">
                {sites.map((site) => {
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
                      aria-label={markerLabel(site.anchor, occupant, site.legal)}
                      style={{
                        left: `${String(box.left)}px`,
                        top: `${String(box.top)}px`,
                        width: `${String(box.size)}px`,
                        height: `${String(box.size)}px`,
                      }}
                      onClick={() => {
                        onSelectSite(site.anchor)
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
                <div className="roster__row">
                  <dt className="roster__hull roster__hull--drone">Drone hull</dt>
                  <dd className={anchorClass(selection.droneHullAnchor)}>
                    {anchorText(selection.droneHullAnchor)}
                  </dd>
                </div>
                <div className="roster__row">
                  <dt className="roster__hull roster__hull--reactor">Reactor hull</dt>
                  <dd className={anchorClass(selection.reactorHullAnchor)}>
                    {anchorText(selection.reactorHullAnchor)}
                  </dd>
                </div>
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

/**
 * A candidate marker's accessible name.
 *
 * The ONLY place a marker's meaning is expressed, because it is the only place that does not
 * paint pixels over the canvas. A visible label on 64 markers would put glyph rasterisation
 * — and therefore font loading — inside the bytes AC-1.3 compares across a reload.
 */
function markerLabel(anchor: Coord, occupant: ReturnType<typeof occupantOf>, legal: boolean): string {
  const where = `Candidate touchdown point ${formatTile(anchor)}`
  if (!legal) return `${where} — outside the survey grid`
  if (occupant !== null) return `${where} — ${hullLabel(occupant)} committed here`
  return where
}

function anchorText(anchor: Coord | null): string {
  return anchor === null ? 'not committed' : formatTile(anchor)
}

function anchorClass(anchor: Coord | null): string {
  return anchor === null ? 'roster__at roster__at--empty' : 'roster__at'
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
