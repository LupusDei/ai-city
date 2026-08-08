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

import { useMemo, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'

import type { Coord } from '../../../sim/grid'
import type { QueueBuildOrder } from '../../../sim/orders'
import { formatDepositCount, formatGridDimensions } from '../../world-readouts'
import type { RunningState } from '../../state/game-state'
import {
  buildCatalog,
  buildOptions,
  placementTargets,
  queueBuildOrder,
  rejectionText,
  selectedOption,
  stockpileReadouts,
  underConstructionCount,
} from './build-tray'
import type { BuildOption } from './build-tray'
import { ColonyCanvas } from './ColonyCanvas'
import { acceptsEndCycle, isEndCycleEnabled } from './end-cycle-guard'
import type { EndCyclePress } from './end-cycle-guard'
import { constraintBanner, standingStructures, ventedTone } from './ops-panels'
import type { ConstraintTone } from './ops-panels'
import { OPS_STYLES } from './ops-styles'
import { OPS_TILE_SIZE } from './render-colony'
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
  /**
   * The player armed a structure in the tray and then clicked a tile on the map.
   *
   * Carries the sim's own `QueueBuildOrder` — typed DATA, not a state transition — which the
   * composition root turns into the one intent the adapter accepts:
   *
   * ```tsx
   * <OpsScreen
   *   state={game}
   *   onQueueBuild={(order) => {
   *     setGame((current) => dispatch(current, { kind: 'issue-orders', orders: [order] }))
   *   }}
   * />
   * ```
   *
   * The order is BUILT here (by `build-tray.ts`'s `queueBuildOrder`, which mints the
   * deterministic instance id) and APPLIED there, for the same reason `onEndCycle` passes
   * the turn it rendered: the screen knows what the player asked for, and only
   * `src/app/state/` may drive `applyOrders`.
   */
  readonly onQueueBuild: (order: QueueBuildOrder) => void
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
 * One structure the colony can build: what it is, what it costs, and — when it cannot be
 * paid for — exactly what is missing.
 *
 * THE BUTTON IS DISABLED FROM `orders.canAfford` AND NOTHING ELSE. That predicate is defined
 * in `orders.ts` AS `checkAffordability(...).ok`, which is the same call `applyOrders` makes
 * before refusing a build — so a greyed option and the sim's refusal are not merely
 * consistent, they are the same computation. A hand-rolled comparison against `buildCost`
 * here would be the duplicate rule that pair exists to prevent.
 *
 * AN INERT CONTROL THAT EXPLAINS ITSELF. The shortfall is rendered on the disabled option,
 * not hidden behind a tooltip or a toast fired after a refused click: "needs 450,000,000 g
 * regolith, holds 0" is actionable, and "cannot afford" is not. `orders.ts` carries all four
 * figures on `ResourceShortfall` for precisely this readout.
 */
function BuildOptionRow({
  option,
  selected,
  onSelect,
}: {
  readonly option: BuildOption
  readonly selected: boolean
  readonly onSelect: (id: string) => void
}): JSX.Element {
  return (
    <li className="build-option__item">
      <button
        type="button"
        className="build-option"
        data-testid={option.testId}
        data-selected={selected ? 'true' : 'false'}
        // The sim's predicate, verbatim. See this component's docblock.
        disabled={!option.affordable}
        aria-pressed={selected}
        onClick={() => {
          onSelect(option.id)
        }}
      >
        <span className="build-option__head">
          <span className="build-option__name">{option.name}</span>
          <span className="build-option__cost">{option.costLabel}</span>
        </span>
        <span className="build-option__spec">
          {option.labourLabel} · {option.drawLabel}
        </span>
        {option.shortfall.map((line) => (
          <span className="build-option__short" key={line.resource}>
            {line.text}
          </span>
        ))}
      </button>
    </li>
  )
}

/**
 * The placement layer: every tile of the colony grid, offered as a target for the armed
 * structure.
 *
 * IT LIVES ON THE MAP, and that is the whole design. The player has spent the survey screen
 * reasoning about terrain and the operations screen looking at the plate; asking them to
 * pick coordinates from a list beside it would discard the one view that makes the decision
 * make sense. Select a structure, then click the ground.
 *
 * ONLY MOUNTED WHILE A STRUCTURE IS ARMED. That is what makes a build a two-step commit
 * rather than an ordinary ambiguous click: with nothing selected there is no target layer at
 * all, so a click on the map cannot commit anything, and `build-cancel` takes the layer away
 * again. It also means the 4,096 target buttons exist only during the gesture that needs
 * them.
 *
 * EVERY VERDICT IS `placement.validatePlacement`'S, resolved in `build-tray.ts`. An illegal
 * tile is rendered DISABLED rather than omitted — the inert-control rule again — so the
 * player can see the shape of what is blocked instead of wondering whether the tray simply
 * forgot a tile.
 *
 * NO GAME LOGIC HERE: this multiplies a tile count by a tile size to lay out a grid, which
 * is the same projection `render-colony.ts` performs, and that is the whole of its
 * arithmetic.
 */
function PlacementOverlay({
  option,
  grid,
  tileSize,
  onPlace,
}: {
  readonly option: BuildOption
  readonly grid: import('../../../sim/grid').Grid
  readonly tileSize: number
  readonly onPlace: (anchor: Coord) => void
}): JSX.Element {
  // Recomputed only when the armed structure or the grid changes — not on every unrelated
  // re-render (a resolved turn, a hovered readout). `validatePlacement` is pure, so this is
  // a performance memo and never a correctness one: dropping it would change nothing but
  // speed.
  const targets = useMemo(
    () => placementTargets(grid, option.structureType),
    [grid, option.structureType],
  )

  return (
    <div
      className="place-layer"
      style={{
        gridTemplateColumns: `repeat(${String(grid.width)}, ${String(tileSize)}px)`,
        gridAutoRows: `${String(tileSize)}px`,
      }}
      role="group"
      aria-label={`Choose a site for the ${option.name}`}
    >
      {targets.map((target) => (
        <button
          type="button"
          key={target.testId}
          className="place-target"
          data-testid={target.testId}
          data-legal={target.legal ? 'true' : 'false'}
          disabled={!target.legal}
          // The sim's own discriminant, surfaced on the tile rather than re-worded.
          title={
            target.legal
              ? `Place the ${option.name} at ${String(target.x)}, ${String(target.y)}`
              : `${target.reason ?? 'refused'} at ${String(target.x)}, ${String(target.y)}`
          }
          onClick={() => {
            onPlace({ x: target.x, y: target.y })
          }}
        />
      ))}
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
export function OpsScreen({ state, onEndCycle, onQueueBuild }: OpsScreenProps): JSX.Element {
  const [acceptedForTurnsTaken, setAcceptedForTurnsTaken] = useState<number | null>(null)
  /**
   * The catalog id the player has armed, or `null`.
   *
   * The screen's SECOND piece of state, and like the first it is not game state: it is
   * bookkeeping about the player's own gesture — the same category as `placedHulls` in the
   * adapter. Nothing in the simulation knows or cares that a tray option is highlighted, and
   * arming one changes nothing until a tile is clicked.
   *
   * Stored as an ID rather than as a `StructureType` so it cannot go stale: the catalog is
   * rebuilt from the mission's turn cycle, and holding a structure object across a rebuild
   * would pin a value from an older one.
   */
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)

  // Built from the mission's own turn cycle, and memoised on it — ABOVE the narrowing return
  // below, because a hook may not sit behind a conditional. `buildCatalog` runs the authored
  // specs through `createCatalog`, the project's one validation boundary, so this is also
  // where malformed catalog data would fail loudly rather than render a menu quietly missing
  // a structure.
  const catalog = useMemo(
    () => buildCatalog(state.colony.mission.turnCycle),
    [state.colony.mission.turnCycle],
  )

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

  // ---- the build tray -----------------------------------------------------
  // Every one of these is a pure selection over the sim's own values; see `build-tray.ts`.
  const options = buildOptions(catalog, view.stockpiles)
  const armed = selectedOption(options, selectedTypeId)
  const stockpiles = stockpileReadouts(catalog, view.stockpiles)
  const underConstruction = underConstructionCount(view.turnCycle, view.queue)
  const rejection = rejectionText(state.orderOutcomes)

  /**
   * Commit the armed structure at `anchor`, then disarm.
   *
   * DISARMS UNCONDITIONALLY, including when the sim refuses the order. The refusal is
   * reported (see the `order-rejection` line below) and the player is returned to a neutral
   * state rather than left holding a loaded cursor over a map they have just been told they
   * cannot build on — which is how a second, equally-refused click happens.
   */
  const handlePlace = (anchor: Coord): void => {
    if (armed === null) return
    onQueueBuild(queueBuildOrder(armed.structureType, anchor))
    setSelectedTypeId(null)
  }

  /** Arm a structure, or disarm it if it was already the armed one. */
  const handleSelect = (id: string): void => {
    setSelectedTypeId((current) => (current === id ? null : id))
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
            {/* The frame is the positioning context for the placement layer, which sits
                exactly over the canvas. The canvas itself is untouched by the tray: it is
                sized from the world and the tile size and never measured, which is the rule
                `render-colony.ts` depends on. */}
            <div className="ops-plate__frame">
              <ColonyCanvas world={view.world} queue={view.queue} />
              {armed === null ? null : (
                <PlacementOverlay
                  option={armed}
                  grid={view.colonyGrid}
                  tileSize={OPS_TILE_SIZE}
                  onPlace={handlePlace}
                />
              )}
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
            {/* WHAT THE COLONY CAN BUILD — the verb this whole screen was missing. Placed
                between what the colony OWNS and what it is FOR, because that is the order the
                question arrives in: what is stopping me, what do I have, what can I do about
                it, what am I aiming at. */}
            <section className="ops-panel build" aria-label="Build" data-testid="build-tray">
              <h2 className="ops-panel__heading build__heading">
                Build
                <span className="build__queued">
                  <span className="mono" data-testid="under-construction">
                    {groupDigits(underConstruction)}
                  </span>{' '}
                  under construction
                </span>
              </h2>

              <ul className="build-options">
                {options.map((option) => (
                  <BuildOptionRow
                    key={option.id}
                    option={option}
                    selected={armed?.id === option.id}
                    onSelect={handleSelect}
                  />
                ))}
              </ul>

              {/* ARMED. Present only while a structure is selected, which is what makes the
                  commit two-step: this line IS the statement that the next map click will
                  spend something. `build-cancel` puts the player back to neutral. */}
              {armed === null ? null : (
                <div className="build-armed" data-testid="build-selection" role="status">
                  <span className="build-armed__text">
                    Placing <strong>{armed.name}</strong> — click a tile on the map
                  </span>
                  <button
                    type="button"
                    className="build-armed__cancel"
                    data-testid="build-cancel"
                    onClick={() => {
                      setSelectedTypeId(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* The sim's typed refusal, carried verbatim (FR-006). Absent when the last
                  batch of orders was accepted — a permanent placeholder would train the
                  player to ignore the one line that ever explains a failure. */}
              {rejection === null ? null : (
                <p className="build-rejection" data-testid="order-rejection" role="alert">
                  {rejection}
                </p>
              )}

              {/* WHAT THE MENU IS PAID IN, beside the menu. The materials come from the
                  catalog rather than from the stockpile, so a colony that has mined nothing
                  still learns on turn 1 that regolith is what the Shield Berm costs — see
                  `stockpileReadouts`. */}
              <div className="stockpiles">
                <span className="stockpiles__label">Stockpiles</span>
                {stockpiles.map((entry) => (
                  <span className="stockpile" key={entry.resource}>
                    <span className="stockpile__resource">{entry.resource}</span>
                    <span className="stockpile__amount mono" data-testid={entry.testId}>
                      {entry.text}
                    </span>
                  </span>
                ))}
              </div>
            </section>

            <section className="ops-panel" aria-label="Standing structures">
              <h2 className="ops-panel__heading">Standing structures</h2>
              <ul className="structures">
                {standingStructures(view).map((structure) => (
                  <li
                    className="structure"
                    key={structure.id}
                    data-testid={`structure-row-${structure.id}`}
                  >
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
                  {/* ★AC-B5.1: the figure that says a project actually ABSORBED the colony's
                      labour. Before any project existed this screen reported 175 h with
                      nothing to absorb it, every cycle, for 25 turns. The testid carries the
                      applied figure and nothing else, so "0 h" and "50 h" are
                      distinguishable without parsing the sentence around them. */}
                  <span className="mono" data-testid="labour-applied">
                    {groupDigits(lastCycle.labourHoursApplied)} h
                  </span>{' '}
                  of labour applied,{' '}
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
