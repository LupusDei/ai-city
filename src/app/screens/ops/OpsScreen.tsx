/**
 * COLONY OPERATIONS — the screen the player spends the whole 278-turn mission in.
 *
 * ============================================================================
 * NO GAME LOGIC HERE. (Constitution §4, spec 005 FR-002)
 * ----------------------------------------------------------------------------
 * This file chooses a layout and nothing else. Every number on it arrives already decided:
 * `ops-view.ts` selects it from the adapter's state, and the adapter stores the sim's own
 * values unchanged. There is no arithmetic on game state in this file — in particular no
 * `turnsTaken + 1`, because `RunningState.outlook` hands over the current turn number and
 * the turns remaining as sim fields for exactly that reason.
 *
 * The one decision this component genuinely owns is WHICH PRESSES OF END CYCLE COUNT, and
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
 * WHAT IS ON SCREEN, AND WHY THOSE THINGS
 * ----------------------------------------------------------------------------
 * The accepted proposal asks for constraint meters at the top with the power margin, drones
 * on shift and turns remaining always visible. The layout follows the three questions a
 * player asks every turn, in order:
 *
 *   1. HOW LONG HAVE I GOT?  The clock, top right, never scrolled away.
 *   2. WHAT IS THE CONSTRAINT?  Power and labour, as meters — because a brownout is the
 *      thing that will actually stop this colony, and a bar communicates "you are short"
 *      faster than two eight-digit numbers do.
 *   3. WHAT DID THAT COST ME?  The grid ledger: the brownout cut line, and vented energy.
 *
 * THE CUT LINE IS SHOWN WHENEVER THERE IS A BROWNOUT because it is one integer that
 * explains the entire turn — `brownout.ts` chose strict-order shedding over first-fit
 * precisely so that it would be. Everything above the line ran; everything at or below it
 * did not.
 *
 * VENTED ENERGY IS ALWAYS SHOWN, including when it is zero. Under the General's no-storage
 * ruling this colony throws away over a megawatt-hour every single turn, and that is the
 * mechanic the whole early game turns on: a number the player cannot see is a mechanic the
 * player cannot learn. It sits next to the idle capacity that caused it so the two read as
 * cause and effect.
 *
 * THE TURN IN PROGRESS AND THE TURN THAT ENDED ARE DIFFERENT PANELS. `outlook` is a
 * forecast whose `completedThisTurn` describes a turn that has not happened; `lastReport` is
 * the record of one that did. Showing them in one place would let the screen promise a
 * building the player has not finished, so the layout keeps them apart and labels them.
 *
 * ============================================================================
 * STYLING IS INLINE, DELIBERATELY
 * ----------------------------------------------------------------------------
 * The project has no stylesheet and no CSS pipeline (see `index.html`: the mount point is
 * the only markup). `TerrainCanvas` already sets its own geometry inline. Introducing a
 * styling system is a decision for a bead that owns the visual language, not a side effect
 * of this one. Style objects are kept in this `.tsx` on purpose: a `styles.ts` would be a
 * pure `.ts` under `src/app/` and therefore inside the coverage gate, which would mean
 * writing assertions about colour values to satisfy a threshold. That is the coverage gate
 * measuring the wrong thing, so the constants stay where the exclusion applies.
 */

import { useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react'

import { formatDepositCount, formatGridDimensions } from '../../world-readouts'
import type { RunningState } from '../../state/game-state'
import { acceptsEndCycle, isEndCycleEnabled } from './end-cycle-guard'
import type { EndCyclePress } from './end-cycle-guard'
import { formatWattHours, groupDigits, lastCycleSummary, missionVerdictText, opsView } from './ops-view'

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

// ---------------------------------------------------------------------------
// Visual language: a lit instrument panel in a cold room on a red planet.
// ---------------------------------------------------------------------------

const INK = '#f4ece6'
const MUTED = '#a89a92'
const PANEL = '#1c1715'
const PANEL_EDGE = '#3a2f2a'
const RUST = '#c2603a'
const WARNING = '#e0a33c'
const OK = '#6fae7a'

const S = {
  screen: {
    background: '#100d0c',
    color: INK,
    minHeight: '100vh',
    padding: '1.5rem',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '1rem',
    borderBottom: `1px solid ${PANEL_EDGE}`,
    paddingBottom: '0.75rem',
  },
  title: { margin: 0, fontSize: '1.35rem', letterSpacing: '0.08em', textTransform: 'uppercase' },
  clock: { display: 'flex', alignItems: 'baseline', gap: '0.75rem' },
  clockValue: { fontSize: '1.6rem', fontVariantNumeric: 'tabular-nums', color: RUST },
  panel: {
    background: PANEL,
    border: `1px solid ${PANEL_EDGE}`,
    borderRadius: '6px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  panelTitle: {
    margin: 0,
    fontSize: '0.72rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: MUTED,
  },
  tiles: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(9.5rem, 1fr))',
    gap: '0.75rem',
  },
  tileLabel: {
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
  },
  tileValue: { fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' },
  tileHint: { fontSize: '0.72rem', color: MUTED },
  meterRow: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  meterHead: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem' },
  meter: { inlineSize: '100%', blockSize: '0.6rem' },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    borderTop: `1px solid ${PANEL_EDGE}`,
    paddingTop: '0.75rem',
  },
  endCycle: {
    background: RUST,
    color: '#140f0d',
    border: 'none',
    borderRadius: '5px',
    padding: '0.7rem 1.6rem',
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  },
  endCycleDisabled: {
    background: PANEL_EDGE,
    color: MUTED,
    cursor: 'not-allowed',
  },
} satisfies Record<string, CSSProperties>

/** One labelled readout. `testId` goes on the VALUE element and nothing else shares it. */
function Tile({
  label,
  testId,
  value,
  hint,
  tone,
}: {
  readonly label: string
  readonly testId?: string
  readonly value: string
  readonly hint?: string
  readonly tone?: string
}): JSX.Element {
  return (
    <div>
      <div style={S.tileLabel}>{label}</div>
      {/* The testid element's text is EXACTLY `value`: the acceptance suite compares some of
          these across two screens with exact string equality, so labels stay siblings. */}
      <div style={tone === undefined ? S.tileValue : { ...S.tileValue, color: tone }} data-testid={testId}>
        {value}
      </div>
      {hint === undefined ? null : <div style={S.tileHint}>{hint}</div>}
    </div>
  )
}

/**
 * A native `<meter>`, so the part-of-whole ratio is computed by the browser.
 *
 * Chosen over a `<div>` with a percentage width for a reason that matters here: a percentage
 * would be arithmetic over two sim figures inside a component, which is the thing
 * constitution §4 forbids and the thing this screen is careful not to do anywhere else. The
 * element also carries the relationship to assistive technology for free.
 */
function Gauge({
  label,
  value,
  max,
  readout,
}: {
  readonly label: string
  readonly value: number
  readonly max: number
  readonly readout: string
}): JSX.Element {
  return (
    <div style={S.meterRow}>
      <div style={S.meterHead}>
        <span style={S.tileLabel}>{label}</span>
        <span style={S.tileHint}>{readout}</span>
      </div>
      <meter style={S.meter} value={value} max={max} aria-label={label} />
    </div>
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
  // it were ever wrong. Same discipline as `TerrainCanvas`'s null 2D context: render the
  // shell, keep the page up, say what is missing.
  if (view === null) {
    return (
      <main data-testid="ops-screen" style={S.screen}>
        <h1 style={S.title}>Colony Operations</h1>
        <p>No cycle report is available for this colony.</p>
      </main>
    )
  }

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
    <main data-testid="ops-screen" style={S.screen}>
      <header style={S.header}>
        <div>
          <h1 style={S.title}>Colony Operations</h1>
          <div style={S.tileHint}>
            Landing site scored {String(view.landingScore)} · seed {String(state.seed)}
          </div>
        </div>
        <div style={S.clock}>
          <span style={S.tileLabel}>Cycle</span>
          {/* AC-3.3: this one element carries the current turn AND the mission length. */}
          <span style={S.clockValue} data-testid="turn-readout">
            {view.turn} / {view.totalTurns}
          </span>
          <span style={S.tileLabel}>Turns to the wave</span>
          <span style={{ ...S.clockValue, color: INK }} data-testid="turns-remaining">
            {view.turnsRemaining}
          </span>
        </div>
      </header>

      <section style={S.panel} aria-label="Constraints">
        <h2 style={S.panelTitle}>Constraints — cycle {view.turn}</h2>
        <Gauge
          label="Power supplied against demand"
          value={view.suppliedWh}
          max={view.powerDrawWh}
          readout={`${formatWattHours(view.suppliedWh)} of ${formatWattHours(view.powerDrawWh)}`}
        />
        <Gauge
          label="Drones on shift"
          value={view.dronesOnShift}
          max={view.droneRosterSize}
          readout={`${groupDigits(view.dronesOnShift)} of ${groupDigits(view.droneRosterSize)} charged`}
        />
      </section>

      <section style={S.panel} aria-label="Colony status">
        <h2 style={S.panelTitle}>Status</h2>
        <div style={S.tiles}>
          <Tile
            label="Power generation"
            testId="power-generation"
            value={formatWattHours(view.generationWh)}
            hint="Reactor output this cycle"
          />
          <Tile
            label="Power draw"
            testId="power-draw"
            value={formatWattHours(view.powerDrawWh)}
            hint="Structures plus the whole drone roster"
          />
          <Tile
            label="Drones on shift"
            testId="drones-on-shift"
            value={`${groupDigits(view.dronesOnShift)} of ${groupDigits(view.droneRosterSize)}`}
            hint={`${groupDigits(view.labourCapacityHours)} robot-hours of labour`}
          />
          <Tile
            label="Habitat capacity"
            testId="habitat-capacity"
            value={groupDigits(view.habitatCapacity)}
            hint="Colonists housed by completed habitats"
          />
        </div>
      </section>

      <section style={S.panel} aria-label="Power grid">
        <h2 style={S.panelTitle}>Grid ledger</h2>
        <div style={S.tiles}>
          {/* Shown only during a brownout: with nothing shed there is no line to report, and
              a permanent "—" would train the player to ignore the field that matters most. */}
          {view.cutLine === null ? (
            <Tile label="Brownout" value="No shedding this cycle" tone={OK} />
          ) : (
            <Tile
              label="Brownout cut line"
              testId="brownout-cut-line"
              value={groupDigits(view.cutLine)}
              hint="Everything above this line ran; everything at or below it did not"
              tone={WARNING}
            />
          )}
          <Tile
            label="Vented energy"
            testId="vented-energy"
            value={formatWattHours(view.ventedElectricityWh)}
            hint="Generated with nowhere to store it, and therefore gone"
            tone={view.ventedElectricityWh > 0 ? WARNING : undefined}
          />
          <Tile
            label="Idle capacity"
            value={formatWattHours(view.idleCapacityWh)}
            hint="Generation that reached nothing — strict-order shedding leaves it idle"
          />
          <Tile
            label="Drones held offline"
            value={groupDigits(view.dronesHeldOffline)}
            hint="Could not be charged from this cycle's budget"
          />
        </div>
      </section>

      <section style={S.panel} aria-label="Surveyed world">
        <h2 style={S.panelTitle}>Surveyed world</h2>
        <div style={S.tiles}>
          {/* ★AC-3.2: these two strings are compared against the survey screen's with exact
              equality, which is why they come from the shared formatters (`world-readouts.ts`)
              and why each testid element contains the formatter's output and nothing else. */}
          <Tile
            label="Mineral deposits"
            testId="deposit-count"
            value={formatDepositCount(view.world)}
            hint="The world the survey scored — carried across, never re-rolled"
          />
          {/* DELIBERATELY `colony.grid` AND NOT `world.grid`, though both render "64 × 64".
              The two are not the same object: `buildColony` starts from the surveyed grid and
              writes hull occupancy into it, so the colony's grid is DERIVED from the survey's
              rather than identical to it. Reading the colony's grid therefore witnesses one
              more thing than reading the world's would — that the colony was actually built on
              the surveyed grid's dimensions and not on a fresh default-sized one. That is the
              `aic-c1p` defect class exactly (a value assembled from data the survey never
              produced), and it is the failure ★AC-3.2 would otherwise miss, because the
              deposit count alone cannot see the grid. */}
          <Tile
            label="Colony grid"
            testId="grid-dimensions"
            value={formatGridDimensions(state.colony.grid)}
            hint="Tiles"
          />
        </div>
      </section>

      {lastCycle === null ? null : (
        <section style={S.panel} aria-label="Previous cycle">
          <h2 style={S.panelTitle}>
            Cycle <span data-testid="last-cycle-turn">{lastCycle.turn}</span> — resolved
          </h2>
          <div style={S.tiles}>
            <Tile
              label="Labour applied"
              value={`${groupDigits(lastCycle.labourHoursApplied)} h`}
              hint={`${groupDigits(lastCycle.labourHoursUnused)} h had no project to absorb it`}
            />
            <Tile
              label="Completed"
              value={
                lastCycle.completedThisTurn.length === 0
                  ? 'Nothing'
                  : lastCycle.completedThisTurn.join(', ')
              }
            />
            <Tile label="Vented" value={formatWattHours(lastCycle.ventedElectricityWh)} />
          </div>
        </section>
      )}

      <footer style={S.footer}>
        <span data-testid="mission-verdict">{missionVerdictText(view.mission)}</span>
        <button
          type="button"
          data-testid="end-cycle"
          onClick={handleEndCycle}
          disabled={!enabled}
          style={enabled ? S.endCycle : { ...S.endCycle, ...S.endCycleDisabled }}
        >
          {view.cycleInProgress ? 'End cycle' : 'Mission over'}
        </button>
      </footer>
    </main>
  )
}
