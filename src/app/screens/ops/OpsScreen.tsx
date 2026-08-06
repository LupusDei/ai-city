/**
 * COLONY OPERATIONS — the screen the player spends the whole 278-turn mission in.
 *
 * ============================================================================
 * WHAT THIS REDESIGN FIXED, IN THE ORDER IT MATTERED
 * ----------------------------------------------------------------------------
 * 1. THE SCREEN HAD NO MAP. The player opens this game by reading terrain — weighing clean
 *    oxide against basalt, measuring two hulls against the deposits nearest them — and then
 *    the mission began and the colony they had just sited DID NOT EXIST VISUALLY. Four rows
 *    of number cards. Every piece of spatial reasoning the survey screen demanded was
 *    discarded at the moment it began to matter, and the main screen of a city-builder was a
 *    financial report. The plate is now the largest object on the page. See
 *    `render-colony.ts`.
 *
 * 2. NOTHING SAID WHAT MATTERED NOW. Twelve tiles across four near-identical rows, in which
 *    "power demand 9,081,732 Wh against 1,986,389 Wh supplied" was styled exactly like
 *    "colony grid 64 x 64" — and the two bars above them rendered GREEN while the colony ran
 *    at roughly a fifth of its demand with 26 of 33 drones held offline. Green there is not a
 *    palette slip; it is a claim about the game state, and a false one. The screen now
 *    separates LIVE CONSTRAINTS (the strip, at the top, permanently) from INERT REFERENCE
 *    (the grid size, the deposit count — facts beside the map they describe). Severity comes
 *    from `ops-panels.ts`, which reads the sim's own brownout verdict and invents no
 *    threshold of its own.
 *
 * 3. A RAW FLOAT REACHED THE PLAYER: "Landing site scored 55.19023601229619". Fourteen
 *    decimal places. Now `formatLandingScore`, which agrees with the survey screen's own
 *    rendering of the same number.
 *
 * 4. A THIRD OF THE VIEWPORT WAS EMPTY while the map — which did not exist — would have been
 *    confined to a 512 px square. The body is now a two-column split whose right rail
 *    stretches to the plate's height, with the objective and the one control pinned to its
 *    foot by an auto margin.
 *
 * ============================================================================
 * NO GAME LOGIC HERE. (Constitution §4, spec 005 FR-002)
 * ----------------------------------------------------------------------------
 * This file chooses a layout and nothing else. Every number arrives already decided:
 * `ops-view.ts` selects it from the adapter's state and the adapter stores the sim's own
 * values unchanged; `ops-panels.ts` classifies severity from the sim's own verdicts. There
 * is no arithmetic on game state in this file — in particular no `turnsTaken + 1`, because
 * `RunningState.outlook` hands over the current turn number and the turns remaining as sim
 * fields for exactly that reason.
 *
 * THE ONE PLACE A PROPORTION IS COMPUTED IS INSIDE THE BROWSER. The constraint bars are
 * native `<meter>` elements handed the sim's two figures as `value` and `max`. A `<div>` at
 * a percentage width would be arithmetic over two sim figures inside a component; delegating
 * it means the ratio is displayed and never held. `ops-panels.ts`'s header explains why the
 * percentage is deliberately not shown as TEXT and where it would have to come from.
 *
 * The other decision this component genuinely owns is WHICH PRESSES OF END CYCLE COUNT, and
 * that is delegated to `end-cycle-guard.ts` — see that module's header for why the guard
 * cannot live in the adapter and must not use a timer.
 *
 * ============================================================================
 * IT DOES NOT DRIVE THE SIM. IT ASKS ITS PARENT TO.
 * ----------------------------------------------------------------------------
 * The screen never calls `resolveTurn` or `dispatch`. It renders a `RunningState` and calls
 * `onEndCycle` with the turn the player was looking at; the composition root turns that into
 * the one intent (`{ kind: 'end-cycle', afterTurnsTaken }`) that the adapter accepts.
 * `tests/unit/app-boundary.test.ts` is the gate that keeps it that way, and the shape is
 * what makes the adapter's stale-token guard meaningful: the token names the turn that was
 * actually on screen, not whatever the state happened to be by the time it was read.
 *
 * ============================================================================
 * THE READOUTS THAT ARE STILL HERE, AND WHY EACH SURVIVED THE CUT
 * ----------------------------------------------------------------------------
 * THE CUT LINE IS SHOWN WHENEVER THERE IS A BROWNOUT because it is one integer that explains
 * the entire turn — `brownout.ts` chose strict-order shedding over first-fit precisely so
 * that it would be. Everything above the line ran; everything at or below it did not.
 *
 * VENTED ENERGY IS ALWAYS SHOWN, including when it is zero. Under the General's no-storage
 * ruling this colony throws away over a megawatt-hour every single turn, and that is the
 * mechanic the whole early game turns on: a number the player cannot see is a mechanic the
 * player cannot learn. It sits next to the idle capacity that caused it so the two read as
 * cause and effect.
 *
 * THE TURN IN PROGRESS AND THE TURN THAT ENDED ARE DIFFERENT PANELS. `outlook` is a forecast
 * whose `completedThisTurn` describes a turn that has not happened; `lastReport` is the
 * record of one that did. Showing them in one place would let the screen promise a building
 * the player has not finished, so the layout keeps them apart and labels them.
 *
 * ============================================================================
 * STYLING IS A STYLESHEET IN A SIBLING `.ts`, NOT INLINE STYLE OBJECTS
 * ----------------------------------------------------------------------------
 * This screen used to carry its own inline `CSSProperties` constants, on the grounds that a
 * `styles.ts` would be a pure `.ts` inside the coverage gate and would mean writing
 * assertions about colour values. That was right when this screen had no visual language to
 * belong to. It no longer is: `App.tsx` renders `PAGE_STYLES` in every phase, so the design
 * tokens are already on the page, and the operations screen was the only thing on the site
 * still speaking its own dialect of them.
 *
 * `ops-styles.ts` is a single exported string. It contains no functions and no branches, so
 * it costs the coverage gate nothing and nobody has to assert that a hex value is a hex
 * value. It is separate from `src/app/styles.ts` because that file is SHARED with the survey
 * screen, which is being redesigned in parallel — and worktree isolation protects files from
 * each other, never the interfaces between them.
 */

import { useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'

import { formatDepositCount, formatGridDimensions } from '../../world-readouts'
import type { RunningState } from '../../state/game-state'
import { ColonyCanvas } from './ColonyCanvas'
import { acceptsEndCycle, isEndCycleEnabled } from './end-cycle-guard'
import type { EndCyclePress } from './end-cycle-guard'
import { constraintBanner, standingStructures, ventedTone } from './ops-panels'
import type { ConstraintTone } from './ops-panels'
import { OPS_STYLES } from './ops-styles'
import {
  formatLandingScore,
  formatWattHours,
  groupDigits,
  lastCycleSummary,
  missionVerdictText,
  opsView,
} from './ops-view'

export interface OpsScreenProps {
  /**
   * The running mission, straight from the adapter. Read only; never mutated.
   *
   * The whole state rather than a bag of extracted figures: `ops-view.ts` decides what to
   * read off it, so a new readout is a change in one tested module rather than a new prop
   * threaded through the composition root.
   */
  readonly state: RunningState
  /**
   * The player asked to end the cycle, and this screen's guard has already accepted the
   * press — a swallowed double-click never reaches here.
   *
   * `afterTurnsTaken` is `colony.turnsTaken` AS RENDERED, and the caller must pass it
   * through unchanged so the adapter's stale-token guard compares against the turn the
   * player actually saw:
   *
   * ```tsx
   * <OpsScreen
   *   state={game}
   *   onEndCycle={(afterTurnsTaken) => {
   *     setGame((current) => dispatch(current, { kind: 'end-cycle', afterTurnsTaken }))
   *   }}
   * />
   * ```
   *
   * The screen does not dispatch it itself: `src/app/state/` is the only directory allowed
   * to drive a sim state transition (FR-004).
   */
  readonly onEndCycle: (afterTurnsTaken: number) => void
}

/**
 * One labelled readout in the ledger rail.
 *
 * `testId` goes on the VALUE element and nothing else shares it. The element's text is
 * EXACTLY `value`, because the acceptance suite compares some of these across two screens
 * with exact string equality — so labels and notes are siblings, never children.
 */
function Readout({
  label,
  testId,
  value,
  note,
  tone,
}: {
  readonly label: string
  readonly testId?: string
  readonly value: string
  readonly note?: string
  readonly tone?: ConstraintTone | 'quiet'
}): JSX.Element {
  const toneClass = tone === undefined ? '' : ` readout__value--${tone}`
  return (
    <div>
      <div className="readout__label">{label}</div>
      <div className={`readout__value${toneClass}`} data-testid={testId}>
        {value}
      </div>
      {note === undefined ? null : <p className="readout__note">{note}</p>}
    </div>
  )
}

/**
 * One constraint in the strip: a headline figure, a bar, and a verdict in words.
 *
 * THE BAR IS A NATIVE `<meter>` and that is a constitutional choice, not an accessibility
 * one. A `<div>` sized to a percentage would mean dividing one sim figure by another inside
 * a component — the exact thing §4 forbids and the thing this screen is careful not to do
 * anywhere else. Handing the browser `value` and `max` means the proportion is DISPLAYED
 * without ever being COMPUTED here. The element also carries the part-of-whole relationship
 * to assistive technology for free.
 *
 * `children` carries the footnote so each caller can put its own testid-bearing elements
 * there with the exact text the acceptance contract requires.
 */
function Gauge({
  label,
  verdict,
  tone,
  value,
  max,
  meterLabel,
  headline,
  unit,
  children,
}: {
  readonly label: string
  readonly verdict: string
  readonly tone: ConstraintTone
  readonly value: number
  readonly max: number
  readonly meterLabel: string
  readonly headline: JSX.Element
  readonly unit?: string
  readonly children: JSX.Element
}): JSX.Element {
  return (
    <section className="gauge" data-tone={tone} aria-label={label}>
      <div className="gauge__head">
        <span className="gauge__label">{label}</span>
        <span className="gauge__verdict">{verdict}</span>
      </div>
      <div className="gauge__value">
        {headline}
        {unit === undefined ? null : <span className="gauge__unit">{unit}</span>}
      </div>
      <meter className="gauge__meter" value={value} max={max} aria-label={meterLabel} />
      <p className="gauge__note">{children}</p>
    </section>
  )
}

/**
 * The Colony Operations screen.
 *
 * Holds exactly one piece of state, and it is not game state: which turn the last accepted
 * End Cycle press named. That is bookkeeping about the PLAYER'S OWN INPUT — the same
 * category as `placedHulls` in the adapter — and it is what lets the control disable itself
 * while a resolution is in flight without anything here learning what a turn is.
 */
export function OpsScreen({ state, onEndCycle }: OpsScreenProps): JSX.Element {
  const [acceptedForTurnsTaken, setAcceptedForTurnsTaken] = useState<number | null>(null)

  const view = opsView(state)
  const lastCycle = lastCycleSummary(state)

  // Unreachable through the adapter (`begin-mission` always sets an outlook), so this is the
  // narrowing that replaces a non-null assertion — an ERROR in `src/`, and a page crash if
  // it were ever wrong. Same discipline as `ColonyCanvas`'s null 2D context: render the
  // shell, keep the page up, say what is missing.
  if (view === null) {
    return (
      <>
        <style>{OPS_STYLES}</style>
        <main className="ops" data-testid="ops-screen">
          <h1 className="ops__title">Colony Operations</h1>
          <p>No cycle report is available for this colony.</p>
        </main>
      </>
    )
  }

  const banner = constraintBanner(view)

  const availability = {
    turnsTaken: view.turnsTaken,
    cycleInProgress: view.cycleInProgress,
    acceptedForTurnsTaken,
  }
  const enabled = isEndCycleEnabled(availability)

  const handleEndCycle = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    // `event.detail` is the browser's own count of clicks in this gesture — the whole
    // double-click defence, and the reason there is no timer anywhere in this path.
    const press: EndCyclePress = { ...availability, clickCount: event.detail }
    if (!acceptsEndCycle(press)) return

    setAcceptedForTurnsTaken(view.turnsTaken)
    onEndCycle(view.turnsTaken)
  }

  return (
    <>
      <style>{OPS_STYLES}</style>
      <main className="ops" data-testid="ops-screen">
        <header className="ops__masthead">
          <div>
            <p className="ops__eyebrow">AI City · Mars colony</p>
            <h1 className="ops__title">Colony Operations</h1>
          </div>
          <div className="ops__clock">
            <span className="ops__clock-label">Cycle</span>
            {/* AC-3.3: this one element carries the current turn AND the mission length. */}
            <span className="ops__clock-value" data-testid="turn-readout">
              {view.turn} / {view.totalTurns}
            </span>
          </div>
        </header>

        {/* Rendered only when something is actually constraining the colony — see
            `ops-panels.ts` on why the absence of a headline is itself the design. */}
        {banner.headline === null ? null : (
          <p className="ops__headline" role="status">
            {banner.headline}
          </p>
        )}

        <div className="ops__constraints">
          <Gauge
            label="Power"
            verdict={banner.verdicts.power}
            tone={banner.tones.power}
            value={view.suppliedWh}
            max={view.powerDrawWh}
            meterLabel="Power supplied against demand"
            headline={<>{groupDigits(view.suppliedWh)}</>}
            unit="Wh supplied"
          >
            <>
              against <span className="mono" data-testid="power-draw">{formatWattHours(view.powerDrawWh)}</span>{' '}
              demanded · <span className="mono" data-testid="power-generation">{formatWattHours(view.generationWh)}</span>{' '}
              generated
            </>
          </Gauge>

          <Gauge
            label="Drones on shift"
            verdict={banner.verdicts.labour}
            tone={banner.tones.labour}
            value={view.dronesOnShift}
            max={view.droneRosterSize}
            meterLabel="Drones charged out of the whole roster"
            // ★ The testid element's text is EXACTLY "7 of 33" — no unit, no label inside it.
            headline={
              <span data-testid="drones-on-shift">
                {groupDigits(view.dronesOnShift)} of {groupDigits(view.droneRosterSize)}
              </span>
            }
          >
            <>
              <span className="mono">{groupDigits(view.labourCapacityHours)}</span> robot-hours of
              labour this cycle
            </>
          </Gauge>

          <Gauge
            label="Turns to the wave"
            verdict={banner.verdicts.clock}
            tone={banner.tones.clock}
            value={view.turnsRemaining}
            max={view.totalTurns}
            meterLabel="Turns remaining before the colonist wave arrives"
            headline={<span data-testid="turns-remaining">{view.turnsRemaining}</span>}
          >
            <>
              of a <span className="mono">{view.totalTurns}</span>-cycle mission
            </>
          </Gauge>
        </div>

        <div className="ops__body">
          <section className="ops__plate" aria-label="Colony map">
            <div className="plate__head">
              <span className="plate__title">The colony</span>
              {/* ★AC-3.2: these two strings are compared against the survey screen's with
                  exact equality, which is why they come from the shared formatters
                  (`world-readouts.ts`) and why each testid element contains the formatter's
                  output and nothing else. They live here rather than in a card of their own
                  because they are facts ABOUT THIS PICTURE, and a reference figure beside
                  the thing it describes is not competing with a live constraint for
                  attention. */}
              <span className="plate__facts">
                <span>
                  {/* DELIBERATELY `colony.grid` AND NOT `world.grid`, though both render
                      "64 × 64". The two are not the same object: `buildColony` starts from
                      the surveyed grid and writes hull occupancy into it, so the colony's
                      grid is DERIVED from the survey's rather than identical to it. Reading
                      the colony's grid therefore witnesses one more thing than reading the
                      world's would — that the colony was actually built on the surveyed
                      grid's dimensions and not on a fresh default-sized one. That is the
                      `aic-c1p` defect class exactly, and it is the failure ★AC-3.2 would
                      otherwise miss, because the deposit count alone cannot see the grid. */}
                  <span className="mono" data-testid="grid-dimensions">
                    {formatGridDimensions(state.colony.grid)}
                  </span>{' '}
                  tiles
                </span>
                <span>
                  <span className="mono" data-testid="deposit-count">
                    {formatDepositCount(view.world)}
                  </span>{' '}
                  deposits
                </span>
                {/* The landing score, to ONE DECIMAL — the survey screen's own rendering of
                    the same figure. It reached the player as "55.19023601229619", which is
                    the float's internal representation escaping into the fiction. See
                    `formatLandingScore`. */}
                <span>
                  site scored <span className="mono">{formatLandingScore(view.landingScore)}</span>{' '}
                  of 100
                </span>
                <span>
                  seed <span className="mono">{state.seed}</span>
                </span>
              </span>
            </div>
            <div className="ops-plate__frame">
              <ColonyCanvas world={view.world} queue={view.queue} />
            </div>
            {/* The same five marks the survey screen teaches, so one symbol means one thing
                across the whole game — but captioned tersely, because by the time the player
                is here they have already read the survey's full sentence about oxide and
                basalt, and this legend has to hold ONE line: a second line is the difference
                between End Cycle sitting above the fold on a 900 px viewport and below it. */}
            <ul className="ops-plate__legend">
              <li className="ops-legend__item">
                <span className="ops-legend__swatch ops-legend__swatch--ground" aria-hidden="true" />
                Buildable ground
              </li>
              <li className="ops-legend__item">
                <span className="ops-legend__swatch ops-legend__swatch--silica" aria-hidden="true" />
                Silica
              </li>
              <li className="ops-legend__item">
                <span className="ops-legend__swatch ops-legend__swatch--ice" aria-hidden="true" />
                Ice
              </li>
              <li className="ops-legend__item">
                <span className="ops-legend__swatch ops-legend__swatch--drone" aria-hidden="true" />
                Drone hull
              </li>
              <li className="ops-legend__item">
                <span className="ops-legend__swatch ops-legend__swatch--reactor" aria-hidden="true" />
                Reactor hull
              </li>
            </ul>
          </section>

          <aside className="ops__rail">
            <section className="ops-panel" aria-label="Power grid">
              <h2 className="ops-panel__heading">
                This cycle — the grid ledger
              </h2>
              <div className="readouts">
                {/* Shown only during a brownout: with nothing shed there is no line to
                    report, and a permanent placeholder would train the player to ignore the
                    field that matters most. */}
                {view.cutLine === null ? (
                  <Readout
                    label="Brownout"
                    value="None"
                    note="Every operating structure and every drone kept its power"
                    tone="quiet"
                  />
                ) : (
                  <Readout
                    label="Brownout cut line"
                    testId="brownout-cut-line"
                    value={groupDigits(view.cutLine)}
                    note="Everything above this line ran; everything at or below it did not"
                    tone="critical"
                  />
                )}
                <Readout
                  label="Drones held offline"
                  value={groupDigits(view.dronesHeldOffline)}
                  note="Could not be charged from this cycle's budget"
                  tone={banner.tones.labour}
                />
                <Readout
                  label="Vented energy"
                  testId="vented-energy"
                  value={formatWattHours(view.ventedElectricityWh)}
                  note="Generated with nowhere to store it, and therefore gone"
                  tone={ventedTone(view.ventedElectricityWh)}
                />
                <Readout
                  label="Idle capacity"
                  value={formatWattHours(view.idleCapacityWh)}
                  note="Reached nothing — strict-order shedding leaves it idle"
                  tone="quiet"
                />
              </div>
            </section>

            {/* WHAT THE COLONY IS MADE OF. Until now this screen described the colony only
                as aggregate watt-hours; "what do I own, and is it running" is the question a
                player asks straight after "what is stopping me", and it had no answer. It
                also names the two marks on the plate, so the legend's swatches attach to
                objects rather than to colours. */}
            <section className="ops-panel" aria-label="Standing structures">
              <h2 className="ops-panel__heading">Standing structures</h2>
              <ul className="structures">
                {standingStructures(view).map((structure) => (
                  <li className="structure" key={structure.id}>
                    <span className="structure__name">{structure.name}</span>
                    <span className="structure__tiles">{structure.tileCount} tiles</span>
                    <span
                      className="structure__status"
                      data-online={structure.online ? 'true' : 'false'}
                    >
                      {structure.online ? 'On line' : 'Offline'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {lastCycle === null ? null : (
              // A COMPACT SINGLE LINE, unlike the live ledger above it, and the asymmetry is
              // the point: this panel records a turn that is over and nothing in it can be
              // acted on, so it must not compete for attention with the constraint the
              // player is about to make a decision against. It stays a SEPARATE panel rather
              // than a third row of the ledger because `outlook` and `lastReport` describe
              // different turns — see this file's header — and one heading over both would
              // let the screen promise a building the player has not finished.
              <section className="ops-panel resolved" aria-label="Previous cycle">
                <h2 className="ops-panel__heading resolved__heading">
                  Cycle <span className="mono" data-testid="last-cycle-turn">{lastCycle.turn}</span>{' '}
                  — resolved
                </h2>
                <p className="resolved__line">
                  <span className="mono">{groupDigits(lastCycle.labourHoursApplied)} h</span> of
                  labour applied,{' '}
                  <span className="mono">{groupDigits(lastCycle.labourHoursUnused)} h</span> with no
                  project to absorb it · completed:{' '}
                  {lastCycle.completedThisTurn.length === 0
                    ? 'nothing'
                    : lastCycle.completedThisTurn.join(', ')}
                </p>
              </section>
            )}

            <section className="ops-panel ops__objective" aria-label="Mission objective">
              <h2 className="ops-panel__heading">Objective</h2>
              <div className="objective__capacity">
                <span className="objective__value" data-testid="habitat-capacity">
                  {groupDigits(view.habitatCapacity)}
                </span>
                <span className="objective__scale">colonists housed</span>
              </div>
              <p className="objective__verdict" data-testid="mission-verdict">
                {missionVerdictText(view.mission)}
              </p>
              {/* The trap the whole early game is built around, stated where the player is
                  looking at the number it applies to. Static text, not a derived figure. */}
              <p className="objective__note">
                Every habitat raised early is power the grid has not got.
              </p>
              <button
                type="button"
                className="end-cycle"
                data-testid="end-cycle"
                onClick={handleEndCycle}
                disabled={!enabled}
              >
                {view.cycleInProgress ? 'End cycle' : 'Mission over'}
              </button>
            </section>
          </aside>
        </div>
      </main>
    </>
  )
}
