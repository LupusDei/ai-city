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

import { TerrainCanvas } from '../../canvas/TerrainCanvas'
import { DEFAULT_TILE_SIZE, worldPixelSize } from '../../canvas/render-world'
import { formatDepositCount, formatGridDimensions } from '../../world-readouts'
import type { RunningState } from '../../state/game-state'
import type { Coord } from '../../../sim/grid'
import type { PlayerOrder } from '../../../sim/orders'
import {
  anchorBox,
  buildAnchorTestId,
  buildMenu,
  buildQueue,
  cancelBuildOrder,
  lastOrderOutcome,
  orderOutcomeReadout,
  queueBuildOrder,
} from './build-view'
import type { BuildMenuEntry } from './build-view'
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
  /**
   * The player queued a build or cancelled one — routed through the EXISTING
   * `issue-orders` action (aic-oby.7), the same intent `game-state.ts` already wires to
   * `orders.applyOrders`. This screen builds no game logic of its own: `build-view.ts`'s
   * `queueBuildOrder`/`cancelBuildOrder` construct the typed `PlayerOrder`, and the sim
   * decides whether it succeeds.
   *
   * ```tsx
   * <OpsScreen
   *   state={game}
   *   onEndCycle={...}
   *   onIssueOrders={(orders) => {
   *     setGame((current) => dispatch(current, { kind: 'issue-orders', orders }))
   *   }}
   * />
   * ```
   */
  readonly onIssueOrders: (orders: readonly PlayerOrder[]) => void
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
  buildTray: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
    gap: '0.6rem',
  },
  buildCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    alignItems: 'flex-start',
    background: '#241d19',
    border: `1px solid ${PANEL_EDGE}`,
    borderRadius: '5px',
    padding: '0.6rem 0.7rem',
    cursor: 'pointer',
    color: INK,
    textAlign: 'left',
    font: 'inherit',
  },
  buildCardSelected: {
    // The FULL `border` shorthand, matching `buildCard`'s own property — never just
    // `borderColor`. React warns ("Removing a style property during rerender...") when
    // a shorthand and its longhand are mixed across a style swap, because toggling
    // between `{ border }` and `{ border, borderColor }` leaves the DOM unable to tell
    // which one should win on the next render.
    border: `1px solid ${RUST}`,
    background: '#33231b',
  },
  buildCardName: { fontWeight: 700, fontSize: '0.9rem' },
  buildCardMeta: { fontSize: '0.7rem', color: MUTED },
  placementPlate: { position: 'relative', display: 'inline-block' },
  placementOverlay: { position: 'absolute', inset: 0 },
  anchorButton: {
    position: 'absolute',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'crosshair',
  },
  outcomeBanner: {
    padding: '0.5rem 0.7rem',
    borderRadius: '4px',
    fontSize: '0.8rem',
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'baseline',
  },
  queueTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  queueCell: { padding: '0.3rem 0.5rem', borderBottom: `1px solid ${PANEL_EDGE}`, textAlign: 'left' },
  cancelButton: {
    background: 'transparent',
    color: RUST,
    border: `1px solid ${RUST}`,
    borderRadius: '4px',
    padding: '0.2rem 0.5rem',
    fontSize: '0.72rem',
    cursor: 'pointer',
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
 * THE VERBS. Selecting a structure, placing it, and cancelling a queued build — the
 * whole of aic-oby.7's "the game has no verbs" fix, and the reason this panel is
 * rendered ABOVE the readouts rather than below the grid ledger: the General opened
 * Colony Operations on a phone and could not find a single action, and a build tray
 * buried under five panels of numbers would still fail that test.
 *
 * ============================================================================
 * NO GAME LOGIC HERE EITHER (constitution §4)
 * ----------------------------------------------------------------------------
 * Every entry in the tray is `build-view.ts`'s `buildMenu`, read off `state.catalog`
 * generically — there is no `if (id === 'regolith-hopper')` anywhere below, and
 * `game-state.ts`'s `buildableStructureSpecs` is the one place a new chain gets added.
 * A click never validates anything: it constructs the sim's own typed `PlayerOrder`
 * (`queueBuildOrder`/`cancelBuildOrder`) and hands it to `onIssueOrders`, which the
 * composition root turns into the EXISTING `issue-orders` action — the same adapter
 * intent `orders.applyOrders` was already wired to and nothing in any `.tsx` had ever
 * dispatched. The sim decides whether a placement is legal; this panel only renders
 * `state.orderOutcomes`' verbatim answer (`orderOutcomeReadout`), FR-006's requirement
 * that an illegal action surface the sim's typed rejection rather than a generic
 * "invalid" message.
 *
 * ============================================================================
 * WHY CLICK-TO-PLACE ON THE CANVAS, REUSING THE SURVEY SCREEN'S IDIOM
 * ----------------------------------------------------------------------------
 * `SurveyScreen` already teaches the player "click a tile over the terrain canvas to
 * act on it" for the two landed hulls. Placement reuses exactly that gesture rather
 * than inventing a second one: `TerrainCanvas` renders `state.world` (the same canvas
 * the survey screen draws), and an overlay of absolutely-positioned buttons — sized and
 * positioned from tile coordinates and the tile size alone, per `build-view.ts`'s
 * `anchorBox`, never from a measured element — sits over it. The one difference from
 * the survey screen's lattice of candidate markers is deliberate: a hull anchor was
 * pre-filtered to legal-by-bounds sites because `evaluateLanding` cannot validate a
 * single anchor in isolation (see `candidate-sites.ts`), but `queueConstruction`
 * validates every order independently, so there is no equivalent reason to withhold
 * any tile here — an anchor that would hang a footprint off the map is simply offered,
 * clicked, and refused by the sim with `out-of-bounds`, exactly the typed rejection
 * FR-006 wants demonstrated.
 */
function BuildPanel({
  state,
  onIssueOrders,
}: {
  readonly state: RunningState
  readonly onIssueOrders: (orders: readonly PlayerOrder[]) => void
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const menu = buildMenu(state.catalog)
  const queue = buildQueue(state)
  const outcome = lastOrderOutcome(state)
  const outcomeReadout = outcome === null ? null : orderOutcomeReadout(outcome)
  const selected: BuildMenuEntry | null =
    selectedId === null ? null : (menu.find((entry) => entry.id === selectedId) ?? null)

  const { width: gridWidth, height: gridHeight } = state.world.grid
  const { width: plateWidth, height: plateHeight } = worldPixelSize(state.world, DEFAULT_TILE_SIZE)

  const toggleSelected = (id: string): void => {
    setSelectedId((current) => (current === id ? null : id))
  }

  const placeAt = (anchor: Coord): void => {
    if (selected === null) return
    onIssueOrders([queueBuildOrder(selected.structureType, anchor)])
  }

  const cancelQueued = (id: string): void => {
    onIssueOrders([cancelBuildOrder(id)])
  }

  return (
    <section style={S.panel} aria-label="Build">
      <h2 style={S.panelTitle}>Build</h2>

      <div style={S.buildTray} data-testid="build-tray">
        {menu.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`build-menu-${entry.id}`}
            aria-pressed={entry.id === selectedId}
            style={entry.id === selectedId ? { ...S.buildCard, ...S.buildCardSelected } : S.buildCard}
            onClick={() => {
              toggleSelected(entry.id)
            }}
          >
            <span style={S.buildCardName}>{entry.name}</span>
            <span style={S.buildCardMeta}>
              {groupDigits(entry.footprintTiles)} tile{entry.footprintTiles === 1 ? '' : 's'} ·{' '}
              {groupDigits(entry.buildTurns)} build turn{entry.buildTurns === 1 ? '' : 's'}
            </span>
            <span style={S.buildCardMeta}>{formatWattHours(entry.powerDrawWh)} / cycle</span>
            <span style={S.buildCardMeta}>
              {entry.buildCost.length === 0
                ? 'No material cost'
                : entry.buildCost
                    .map((line) => `${groupDigits(line.amount)} g ${line.resource}`)
                    .join(', ')}
            </span>
          </button>
        ))}
      </div>

      {outcomeReadout === null ? null : (
        <p
          style={{
            ...S.outcomeBanner,
            color: outcomeReadout.ok ? OK : WARNING,
          }}
          data-testid="build-outcome"
          role="status"
        >
          <span>{outcomeReadout.message}</span>
          {outcomeReadout.code === null ? null : <code>{outcomeReadout.code}</code>}
        </p>
      )}

      {selected === null ? null : (
        <div>
          <p style={S.tileHint}>
            Placing {selected.name} — click a tile on the colony grid to build it there. Click{' '}
            {selected.name} again above to cancel placement.
          </p>
          <div
            style={{
              ...S.placementPlate,
              width: `${String(plateWidth)}px`,
              height: `${String(plateHeight)}px`,
            }}
          >
            <TerrainCanvas world={state.world} tileSize={DEFAULT_TILE_SIZE} />
            <div style={S.placementOverlay} data-testid="placement-overlay">
              {Array.from({ length: gridWidth * gridHeight }, (_unused, index) => {
                const anchor: Coord = { x: index % gridWidth, y: Math.floor(index / gridWidth) }
                const box = anchorBox(anchor, DEFAULT_TILE_SIZE)
                return (
                  <button
                    key={buildAnchorTestId(anchor)}
                    type="button"
                    data-testid={buildAnchorTestId(anchor)}
                    aria-label={`Place ${selected.name} at (${String(anchor.x)}, ${String(anchor.y)})`}
                    style={{
                      ...S.anchorButton,
                      left: `${String(box.left)}px`,
                      top: `${String(box.top)}px`,
                      width: `${String(box.size)}px`,
                      height: `${String(box.size)}px`,
                    }}
                    onClick={() => {
                      placeAt(anchor)
                    }}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 style={S.panelTitle}>Build queue</h3>
        {queue.length === 0 ? (
          <p style={S.tileHint} data-testid="build-queue-empty">
            Nothing under construction.
          </p>
        ) : (
          <table style={S.queueTable} data-testid="build-queue">
            <tbody>
              {queue.map((entry) => (
                <tr key={entry.id} data-testid={`build-queue-row-${entry.id}`}>
                  <td style={S.queueCell}>{entry.name}</td>
                  <td style={S.queueCell} data-testid={`build-queue-status-${entry.id}`}>
                    {entry.complete
                      ? 'Complete'
                      : `${String(entry.turnsCompleted)} / ${String(entry.buildTurns)} turns ` +
                        `(${String(entry.turnsRemaining)} to go)`}
                  </td>
                  <td style={S.queueCell}>
                    {entry.complete ? null : (
                      <button
                        type="button"
                        style={S.cancelButton}
                        data-testid={`cancel-build-${entry.id}`}
                        onClick={() => {
                          cancelQueued(entry.id)
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
export function OpsScreen({ state, onEndCycle, onIssueOrders }: OpsScreenProps): JSX.Element {
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

      <BuildPanel state={state} onIssueOrders={onIssueOrders} />

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
