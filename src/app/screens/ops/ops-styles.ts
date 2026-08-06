/**
 * The Colony Operations screen's stylesheet, as CSS text.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS SEPARATELY FROM `src/app/styles.ts`
 * ----------------------------------------------------------------------------
 * `styles.ts` holds `PAGE_STYLES` (the design tokens, rendered by `App.tsx` in every phase)
 * and `SURVEY_STYLES`. It is SHARED, and the survey screen is being redesigned in parallel
 * in another worktree — worktree isolation protects files from each other and does nothing
 * whatsoever for two agents editing one file. So this screen brings its own sheet and edits
 * none of theirs.
 *
 * It does NOT bring its own palette. Structure, type and every ordinary accent below are
 * `var(--token)` from `PAGE_STYLES`, so the two screens read as one instrument: the same
 * oxide, the same dust, the same hairlines, the same mono stack.
 *
 * Literal colours appear in exactly three places, and each is a case the token set cannot
 * cover:
 *
 *   1. THE ALARM REDS (`#e0533c`, `#a8321f`, `#ffb3a3`, `#ff9a86` and their translucent
 *      companions). The token palette is a MARS RAMP and deliberately has no true red in it
 *      — the terrain IS iron oxide, so an oxide accent cannot read as an alarm against the
 *      map. A colony in a brownout needs a colour the planet is not already wearing.
 *   2. THE LEGEND SWATCHES. They must equal the colours `render-colony.ts` paints onto the
 *      canvas, and that module speaks `Rgb` while this one speaks CSS text. Both sides are
 *      written out and each names the other; a conversion layer between them would be a
 *      third thing that could be wrong about a pair the eye checks in one glance.
 *   3. THE OXIDE GRADIENTS on the End Cycle control and the ground swatch, lifted verbatim
 *      from `SURVEY_STYLES` so the primary control looks the same on both screens.
 *
 * The `.ts`-not-`.css` decision, and its trade (no CSS syntax checking, no autoprefixing),
 * is `styles.ts`'s and is explained there. This file follows it rather than introducing a
 * second convention.
 *
 * ============================================================================
 * A WARNING FOR FUTURE EDITORS — this is a template literal
 * ----------------------------------------------------------------------------
 * A backtick or a dollar-brace anywhere inside the string, INCLUDING INSIDE A CSS COMMENT,
 * terminates it. Quote CSS identifiers in these comments with plain words. This is the same
 * trap `styles.ts` documents; it has caught someone once already.
 *
 * ============================================================================
 * AC-1.3 IS NOT AT RISK FROM THIS FILE, AND HERE IS WHY THAT IS WORTH SAYING
 * ----------------------------------------------------------------------------
 * Spec 005's AC-1.3 screenshots the SURVEY screen's canvas element and requires the bytes
 * identical across a reload. Nothing here is ever mounted on that screen — `OpsScreen`
 * renders this sheet and `OpsScreen` only exists in the running phase.
 *
 * The colony plate nevertheless obeys the same rules, because "safe only where a test looks"
 * is not a property: NO TRANSITIONS ON ANYTHING OVER THE CANVAS, no text drawn on it, no
 * measured sizing, and no `backdrop-filter` or `mix-blend-mode` above it. Transitions on the
 * ordinary panel chrome and on the End Cycle control are fine and are used — those elements
 * are nowhere near a screenshot.
 */

/**
 * Layout, chrome and the constraint strip for `OpsScreen`.
 *
 * THE SHAPE OF THE SCREEN, AND WHY IT IS THIS SHAPE. Three bands, in the order a commander
 * asks the questions:
 *
 *   1. THE MASTHEAD — who and when. The cycle clock lives here and never scrolls away.
 *   2. THE CONSTRAINT STRIP — what is stopping me. Three meters, full width, above
 *      everything else, because the answer on most turns is a crisis and the old screen
 *      buried it in the third of four identical card rows.
 *   3. THE BODY — a two-column split with the MAP on the left and the ledger on the right.
 *      The map is the largest object on the page for the same reason it is on the survey
 *      screen: this is a game about a place.
 *
 * The right rail is a flex column whose last panel is pushed to the bottom with an auto
 * margin, so the End Cycle control sits at the foot of the viewport rather than floating
 * under a short stack of panels. That is what stops the screen ending in the third of empty
 * space it used to.
 */
export const OPS_STYLES = `
.ops {
  max-width: 1280px;
  margin: 0 auto;
  /* Measured, not guessed. At 1440x900 this puts the foot of the objective panel — and
     therefore End Cycle, the only control on the screen — at 898 px, just inside the fold,
     with the whole map, the whole constraint strip and the whole ledger above it. The
     screen the player presses 278 times must not require a scroll to press. */
  padding: 14px 24px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ---- masthead ------------------------------------------------------------ */

.ops__masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px 32px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--hairline);
}

.ops__eyebrow {
  margin: 0 0 2px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

.ops__title { font-size: 27px; }

/* The clock. Large, tabular and iron-oxide, so the single most time-critical fact on a
   278-turn deadline is the brightest number in the masthead. */
.ops__clock { display: flex; align-items: baseline; gap: 10px; }

.ops__clock-label {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.ops__clock-value {
  font-family: var(--font-mono);
  font-size: 26px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  color: var(--dust);
}

/* ---- the headline: the crisis in one sentence ---------------------------- */

/* Present ONLY when something is constraining the colony. See ops-panels.ts: a banner that
   is always on screen is a banner nobody reads, and this one exists to be noticed. */
.ops__headline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 8px 13px;
  border: 1px solid rgba(214, 74, 51, 0.5);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: rgba(122, 32, 22, 0.26);
  font-size: 13px;
  color: var(--summit);
}

.ops__headline::before {
  content: '';
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  /* ALARM RED — see case 1 in this file's header for why it is a literal and not a token. */
  background: #e0533c;
}

/* ---- the constraint strip ------------------------------------------------ */

.ops__constraints {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.gauge {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 14px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--panel);
}

/* The one live constraint gets a lit edge, so the eye lands on it before it reads a word.
   Tone comes from ops-panels.ts, which reads the sim's own brownout verdict. */
.gauge[data-tone='critical'] { border-color: rgba(214, 74, 51, 0.45); }
.gauge[data-tone='caution'] { border-color: rgba(255, 200, 87, 0.34); }

.gauge__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.gauge__label {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* The verdict in WORDS as well as colour: colour alone fails a colour-blind player and
   fails anyone reading a screenshot in a bug report. */
.gauge__verdict {
  padding: 1px 7px;
  border: 1px solid var(--hairline-strong);
  border-radius: 2px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
  white-space: nowrap;
}

.gauge[data-tone='critical'] .gauge__verdict {
  border-color: rgba(214, 74, 51, 0.6);
  background: rgba(122, 32, 22, 0.4);
  color: #ffb3a3;
}

.gauge[data-tone='caution'] .gauge__verdict {
  border-color: rgba(255, 200, 87, 0.5);
  color: var(--amber);
}

.gauge__value {
  font-family: var(--font-mono);
  font-size: 23px;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  color: var(--summit);
}

.gauge__unit { font-size: 14px; color: var(--ink-dim); margin-left: 3px; }

.gauge__note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-faint);
}

.gauge__note .mono { color: var(--ink-dim); }

/* ---- the meter ----------------------------------------------------------- */

/* A native meter element, given the sim's two figures as value and max, so the BROWSER
   performs the part-of-whole division and no arithmetic on game state happens in this
   codebase. Constitution paragraph 4 is the reason, not accessibility — though the element
   carries the relationship to assistive technology for free as well.

   Chromium needs appearance none before the bar and value pseudo-elements are styleable;
   the acceptance suite runs Chromium. Without the pseudo-elements the meter still renders
   its default bar, so the failure mode of this block is an ugly meter and never a missing
   one. */
.gauge__meter {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 7px;
  border: 0;
  border-radius: 2px;
  background: rgba(232, 196, 156, 0.1);
}

.gauge__meter::-webkit-meter-inner-element { display: block; }

.gauge__meter::-webkit-meter-bar {
  height: 7px;
  border: 0;
  border-radius: 2px;
  background: rgba(232, 196, 156, 0.1);
}

/* Sand, not oxide. A nominal bar has to be legible WITHOUT reading as a fourth alarm beside
   two red ones, and the clock's bar is nearly full for most of the mission — in lit oxide it
   looked like the loudest thing on the strip while saying "nothing is wrong". */
.gauge__meter::-webkit-meter-optimum-value,
.gauge__meter::-webkit-meter-suboptimum-value,
.gauge__meter::-webkit-meter-even-less-good-value {
  border-radius: 2px;
  background: var(--dust);
}

/* A supply bar at a fifth of demand used to render GREEN. It is not a palette slip: green
   is a claim about the game state and it was false. */
.gauge[data-tone='critical'] .gauge__meter::-webkit-meter-optimum-value,
.gauge[data-tone='critical'] .gauge__meter::-webkit-meter-suboptimum-value,
.gauge[data-tone='critical'] .gauge__meter::-webkit-meter-even-less-good-value {
  background: linear-gradient(90deg, #a8321f, #e0533c);
}

.gauge[data-tone='caution'] .gauge__meter::-webkit-meter-optimum-value,
.gauge[data-tone='caution'] .gauge__meter::-webkit-meter-suboptimum-value,
.gauge[data-tone='caution'] .gauge__meter::-webkit-meter-even-less-good-value {
  background: var(--amber);
}

/* ---- body: map on the left, ledger on the right -------------------------- */

.ops__body {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 20px;
}

/* A one-column grid sized to MIN-CONTENT, and that is load-bearing rather than fussy. The
   canvas carries a fixed inline pixel width, so it is the only child with a large minimum —
   the column therefore comes out exactly as wide as the map, and the head row and the legend
   are laid out to that width instead of stretching it. With an ordinary auto-width flex item
   the legend's max-content (all five entries on one line) decided the column, and the plate
   sat a hundred pixels wider than the picture inside it. */
.ops__plate {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: min-content;
  /* Rows keep their content height instead of sharing out the extra when the rail beside
     them is taller. Without this, the grid stretched its three rows and pushed the map down
     by a dozen pixels on the turn the resolved-cycle panel appears — a map that drifts as
     the ledger grows. */
  align-content: start;
}

/* Flexes to fill whatever the fixed-width map leaves, and stretches to the map's height so
   the End Cycle control lands at the foot of the screen rather than mid-page. */
.ops__rail {
  flex: 1 1 340px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ---- the colony plate ---------------------------------------------------- */

.plate__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 8px;
}

.plate__title {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

/* THE SESSION'S PROVENANCE, and it lives here rather than under the title on purpose: the
   grid size, the deposit count and the score the landing earned are all facts ABOUT THIS
   PICTURE, and a caption belongs on the thing it captions. It also keeps the masthead to one
   line, which is what gets the End Cycle control above the fold on a 900 px viewport.

   Two of these figures are compared across BOTH screens by the acceptance suite with exact
   string equality, so each testid element holds the shared formatter's output and nothing
   else; every label is a sibling. */
.plate__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 11px;
  color: var(--ink-faint);
}

.plate__facts .mono {
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}

.ops-plate__frame {
  /* Sized by the inline style ColonyCanvas sets from worldPixelSize, never measured.
     content-box overrides the global border-box reset ON PURPOSE, exactly as the survey
     plate does: under border-box the 1px frame would eat two pixels of the canvas. */
  box-sizing: content-box;
  border: 1px solid var(--hairline-strong);
  background: var(--void);
  line-height: 0;
}

.ops-plate__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--ink-dim);
}

.ops-legend__item { display: inline-flex; align-items: center; gap: 7px; }

.ops-legend__swatch {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  border: 1px solid rgba(246, 240, 226, 0.34);
}

/* The same two marks the player clicked on the survey screen. See render-colony.ts: making
   the player learn one object twice is how a legend stops being a legend. */
.ops-legend__swatch--drone { background: rgba(246, 240, 226, 0.85); border-color: var(--summit); }
.ops-legend__swatch--reactor { background: rgba(255, 200, 87, 0.85); border-color: var(--amber); }
.ops-legend__swatch--silica { background: #f6f0d6; border-radius: 2px; transform: rotate(45deg); }
.ops-legend__swatch--ice { background: var(--ice); border-radius: 50%; }
.ops-legend__swatch--ground {
  background: linear-gradient(90deg, #7a3420, #b05630);
  border-color: var(--hairline-strong);
}

/* ---- rail panels --------------------------------------------------------- */

.ops-panel {
  padding: 13px 15px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--panel);
}

.ops-panel__heading {
  margin: 0 0 12px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

.ops-panel__heading .mono {
  font-variant-numeric: tabular-nums;
  color: var(--dust);
  letter-spacing: 0;
}

/* Two columns of readouts, so the rail reads as a ledger rather than as a long list. */
.readouts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
}

.readouts--single { grid-template-columns: minmax(0, 1fr); }

.readout__label {
  font-size: 10px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.readout__value {
  margin-top: 1px;
  font-family: var(--font-mono);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--dust);
  overflow-wrap: anywhere;
}

.readout__value--caution { color: var(--amber); }
.readout__value--critical { color: #ff9a86; }
.readout__value--quiet { color: var(--ink-dim); }

.readout__note {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--ink-faint);
}

/* ---- standing structures ------------------------------------------------- */

.structures { margin: 0; padding: 0; list-style: none; }

.structure {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
  border-bottom: 1px solid var(--hairline);
}

.structure:last-child { border-bottom: 0; padding-bottom: 0; }

.structure__name { flex: 1 1 auto; color: var(--ink); }

.structure__tiles {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.structure__status {
  flex: 0 0 auto;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

/* Out of service is the exceptional state and the only one that gets colour: an offline
   structure neither generates nor draws, which is a fact the player must not have to hunt
   for in a list where every other row is unremarkable. */
.structure__status[data-online='false'] { color: var(--amber); }

/* ---- the cycle that just ended ------------------------------------------- */

.resolved__heading { margin-bottom: 5px; }

.resolved__line {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-dim);
}

.resolved__line .mono {
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}

/* ---- the objective, and the one control ---------------------------------- */

/* Auto margin, not a fixed height: this panel is pushed to the bottom of the rail whatever
   is above it, which is what earns back the vertical space the old screen wasted. */
.ops__objective { margin-top: auto; }

.objective__capacity {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin-bottom: 4px;
}

.objective__value {
  font-family: var(--font-mono);
  font-size: 30px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--summit);
}

.objective__scale { font-size: 12px; color: var(--ink-faint); }

.objective__verdict {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-dim);
}

.objective__note {
  margin: 3px 0 13px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--ink-faint);
}

.end-cycle {
  display: block;
  width: 100%;
  padding: 13px 16px;
  border: 1px solid var(--oxide-lit);
  border-radius: var(--radius);
  background: linear-gradient(180deg, #a34d2a, #7a3420);
  color: var(--summit);
  font-size: 14px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  /* Nowhere near a screenshotted canvas — see this file's header on AC-1.3. */
  transition: filter 120ms ease-out;
}

.end-cycle:hover:not(:disabled) { filter: brightness(1.16); }
.end-cycle:focus-visible { outline: 2px solid var(--dust); outline-offset: 2px; }

.end-cycle:disabled {
  border-color: var(--hairline);
  background: rgba(58, 26, 18, 0.42);
  color: var(--ink-faint);
  cursor: not-allowed;
}

/* ---- narrow viewports ---------------------------------------------------- */

/* The map keeps its exact pixel size at every width — it is sized from the world and the
   tile size and never from a measurement, which is the rule the renderer depends on. Only
   the chrome around it reflows. */
@media (max-width: 1080px) {
  .ops__constraints { grid-template-columns: 1fr; }
  .ops__title { font-size: 25px; }
}
`
