/**
 * The Surface Survey screen's own visual language: the scale it draws the map at, and the
 * stylesheet that dresses it.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE FILE FROM `src/app/styles.ts`
 * ----------------------------------------------------------------------------
 * `styles.ts` is shared: `PAGE_STYLES` is rendered by `App.tsx` in every phase and owns the
 * design tokens (the Mars ramp, the type stacks, the page ground) that BOTH screens inherit.
 * The survey's own sheet is not shared with anything — it styles exactly one screen, changes
 * whenever that screen is redesigned, and has no business sitting in a file the operations
 * screen also has to be edited around.
 *
 * The tokens still come from `PAGE_STYLES` and are referenced here as custom properties, so
 * there is still exactly one definition of what "oxide" or "summit" means. This file adds no
 * colour of its own that is not built out of them.
 * ============================================================================
 *
 * ============================================================================
 * ★AC-1.3 CONSTRAINTS THIS SHEET OBEYS — read `canvas/render-world.ts`'s docblock first
 * ----------------------------------------------------------------------------
 * Spec 005's AC-1.3 screenshots the `terrain-canvas` element and requires the bytes to be
 * IDENTICAL across a page reload. The candidate-marker layer is painted ON TOP of that
 * canvas, so it is inside those bytes — verified empirically, by the probe recorded in the
 * acceptance spec: placing a hull changes that screenshot. The marker layer is therefore
 * bound by the same determinism rules the renderer is, and these are not stylistic
 * preferences:
 *
 *   - NO TRANSITIONS OR ANIMATIONS ON THE MARKER LAYER. A transition caught mid-flight is a
 *     partially-interpolated frame, and two loads need not be at the same point in it.
 *     Markers change state instantly. Panel controls outside the canvas box may transition.
 *   - NO TEXT INSIDE A MARKER. Not one glyph over the canvas, for the same reason
 *     `render-world.ts` contains no fillText: glyph rasterisation depends on which fonts
 *     have finished loading. Marker meaning is carried by the accessible name that
 *     `survey-readouts.ts` builds — read by assistive technology, drawn by nothing.
 *   - NO WEB FONTS ANYWHERE ON THE PAGE. System stacks only, so no font-loading race can
 *     reflow the page between two loads.
 *   - WHOLE-PIXEL MARKER GEOMETRY, positioned from the tile size alone. See
 *     `candidate-sites.ts`'s marker box; nothing here derives a position from a measured
 *     element, and every marker metric below is a whole number of pixels.
 *   - NO backdrop-filter AND NO mix-blend-mode OVER THE MAP. Both sample the pixels beneath
 *     them through compositor paths far more timing- and GPU-sensitive than an ordinary fill.
 *
 * The reticle below is drawn with background-image gradients at whole-pixel sizes and
 * keyword positions, which resolve to whole pixels on a whole-pixel box. That is why it is
 * built that way rather than with a rotated element or a clip-path percentage.
 * ============================================================================
 *
 * NOTE FOR FUTURE EDITORS: these stylesheets are template literals, so a backtick or a
 * dollar-brace anywhere inside them terminates the string. Quote CSS identifiers in these
 * comments with plain words, never with backticks.
 */

/**
 * Device pixels per tile on the survey map: 10, so the ratified 64x64 grid draws at 640x640.
 *
 * WHY NOT THE RENDERER'S DEFAULT 8. At 8 the map is 512 square, and on any modern viewport
 * that leaves the screen's single most important object — the thing the entire decision is
 * about — as a small square with a third of the page empty around it. 10 is a 56% larger
 * picture of the same world at the same one-canvas-pixel-per-tile crispness, and it is what
 * lets the assessment panel be sized to its content instead of being inflated to fill a row.
 *
 * WHY NOT LARGER, WHICH THE HORIZONTAL SPACE WOULD ALLOW. The acceptance suite runs at
 * Playwright's Desktop Chrome viewport, 1280x720. AC-1.3 takes an ELEMENT screenshot of the
 * canvas, and an element taller than the viewport cannot be captured in one pass — it has to
 * be scrolled, which puts scroll position into the bytes the test compares. `render-world.ts`
 * names that as the reason its own default is 8. 640 keeps an 80px margin under 720; 12 would
 * be 768 and over it. So this constant is capped by a determinism requirement, not by taste,
 * and it must not be raised without re-reading that docblock.
 *
 * Kept here rather than in `canvas/render-world.ts` because it is a decision about THIS
 * screen's layout, not about the renderer: `DEFAULT_TILE_SIZE` remains the renderer's own
 * answer for any caller that does not have a page to fit the map into.
 */
export const SURVEY_TILE_SIZE = 10

/**
 * The hairline frame around the map, in device pixels, on each side.
 *
 * Exported AND interpolated into the sheet below, rather than written as a literal in both
 * places, because the component needs the same number: the survey plate is given an explicit
 * width of the map plus this frame twice.
 *
 * WHY THE PLATE NEEDS AN EXPLICIT WIDTH AT ALL. The plate is a fixed-basis flex item, so its
 * base size is the max-content width of its children — and one of those children is the
 * legend, a single row of prose far wider than the map. Left to itself the plate claims the
 * whole row and the assessment column wraps underneath it, which is precisely the bug this
 * constant exists to prevent: the layout silently collapsed to one column when the legend
 * gained a line. Pinning the plate to the map's own width makes the legend wrap inside it
 * instead, and keeps the two-column composition a property of the map's size rather than of
 * how much text happens to be in the legend today.
 */
export const PLATE_FRAME_PX = 1

/**
 * The Surface Survey screen.
 *
 * ── THE MARKERS ARE AN INSTRUMENT PLOT, NOT A GRID OF BOXES ──────────────────────────
 *
 * The lattice used to draw 64 filled, hard-edged squares of identical weight, evenly spaced
 * across the map. That reads as a debug overlay, and worse, each box OCCLUDED the terrain
 * inside it — hiding the exact pixels the player needs to judge the site, since the map
 * already encodes buildability as a darkening toward basalt. A player looking at sixty-four
 * interchangeable boxes has no basis on which to prefer any of them, because the basis was
 * painted over.
 *
 * So the resting marker is a RETICLE: four corner ticks, and nothing in the middle. The
 * ground inside the footprint shows through at full strength, which means the terrain
 * shading IS the comparison between sites, and the reticle is the instrument's registration
 * mark on it. They sit one per graticule cell — the same 8-tile interval the map is ruled at
 * — so the plot reads as part of the survey rather than as an overlay bolted on top.
 *
 * Under the cursor or keyboard focus the reticle closes into a full box, in the COLOUR OF
 * THE HULL THAT CLICK WOULD COMMIT. That is the pre-commitment preview this screen can
 * honestly give: which hull, and exactly which four tiles. It is driven from the sim's own
 * missingHulls (see survey-readouts' next-hull reader), never from an opinion held here.
 *
 * Instant, both ways. See the AC-1.3 note above.
 */
export const SURVEY_STYLES = `
.survey {
  /* Sized to its contents rather than to the viewport: 642 of plate (640 of map plus its
     1px frame on each side), a 32px gutter, a 438px assessment column, and 24px of page
     padding on each side. A wider container would only stretch the panel, which is what
     made the old layout read as a small map beside an over-inflated column. */
  max-width: 1160px;
  margin: 0 auto;
  padding: 26px 24px 40px;
}

/* ---- masthead ------------------------------------------------------------ */

.survey__masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--hairline);
}

.survey__eyebrow {
  margin: 0 0 2px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

.survey__title { font-size: 30px; }

.survey__facts {
  display: flex;
  gap: 28px;
  margin: 0;
}

.survey__fact { display: flex; flex-direction: column; gap: 1px; }

.survey__fact dt {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.survey__fact dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}

/* ---- layout -------------------------------------------------------------- */

.survey__body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 32px;
  margin-top: 22px;
}

/* Width set inline by the component, from the map's pixel size. See PLATE_FRAME_PX. */
.survey__plate { flex: 0 0 auto; }
.survey__assessment { flex: 1 1 400px; min-width: 300px; }

/* ---- the survey plate ---------------------------------------------------- */

.plate__stack {
  position: relative;
  /* Sized by the inline style the component sets from worldPixelSize, never measured.
     content-box overrides the global border-box reset ON PURPOSE: the inline width and
     height are the canvas's exact pixel size, and under border-box the 1px frame would eat
     two pixels of it — leaving the canvas overflowing its own container by 2px and the
     inset-0 marker layer misaligned from the terrain by one. */
  box-sizing: content-box;
  border: ${String(PLATE_FRAME_PX)}px solid var(--hairline-strong);
  background: var(--void);
  line-height: 0;
}

.plate__markers {
  position: absolute;
  inset: 0;
  /* The layer itself is inert; only the markers inside it take pointer events, so the
     terrain beneath stays readable between them. */
  pointer-events: none;
}

.marker {
  position: absolute;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  pointer-events: auto;
  cursor: pointer;
  /* No transition: this element sits inside the bytes AC-1.3 compares. */
}

/* The visible mark: exactly the 2x2 hull footprint, inside a larger touch target.

   FOUR CORNER TICKS, drawn as eight 1px gradient bars — two per corner. Whole-pixel sizes
   and keyword positions on a whole-pixel box, so every edge lands on a device pixel. The
   middle is deliberately empty: that is the ground the player is choosing, and the old
   filled box hid it. */
.marker__mark {
  /* The ink strength is the sim's own buildability reading for the ground under this
     footprint, set inline per marker as --ground-ink by the component (see groundInk).
     Read here rather than set here, so the hover and committed rules below can still
     override --tick outright — an inline --tick would outrank every rule in this sheet.
     The fallback keeps a marker legible if the property is ever missing. */
  --tick: rgba(246, 240, 226, var(--ground-ink, 0.62));
  background-image:
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
    linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick));
  background-repeat: no-repeat;
  background-size:
    var(--tick-len, 5px) 1px, 1px var(--tick-len, 5px),
    var(--tick-len, 5px) 1px, 1px var(--tick-len, 5px),
    var(--tick-len, 5px) 1px, 1px var(--tick-len, 5px),
    var(--tick-len, 5px) 1px, 1px var(--tick-len, 5px);
  background-position:
    left top, left top,
    right top, right top,
    left bottom, left bottom,
    right bottom, right bottom;
  /* DELIBERATELY NO filter/drop-shadow, though one would help the ticks read over the
     palest dust. A drop-shadow is a blur, and a blur is a compositor path — the same class
     of effect as the backdrop-filter and mix-blend-mode this sheet's header bans over the
     map. Legibility is bought with tick opacity instead, which is an ordinary fill. */
}

/* Hover and keyboard focus close the reticle into the full footprint — the four tiles a
   click would actually commit — in the colour of the hull it would commit. Instant. */
.marker:hover:not(:disabled) .marker__mark,
.marker:focus-visible .marker__mark {
  --tick: var(--summit);
  background-color: rgba(246, 240, 226, 0.14);
  box-shadow: inset 0 0 0 1px rgba(246, 240, 226, 0.75), 0 0 0 1px rgba(18, 12, 10, 0.7);
}

.plate__markers[data-next='reactor-hull'] .marker:hover:not(:disabled) .marker__mark,
.plate__markers[data-next='reactor-hull'] .marker:focus-visible .marker__mark {
  --tick: var(--amber);
  background-color: rgba(255, 200, 87, 0.16);
  box-shadow: inset 0 0 0 1px rgba(255, 200, 87, 0.8), 0 0 0 1px rgba(18, 12, 10, 0.7);
}

.marker:focus-visible { outline: 1px solid var(--summit); outline-offset: 2px; }

/* A committed hull is the one thing on the plate that must be findable at a glance across a
   640px map, so it is filled and ringed rather than merely tinted. */
.marker[data-hull] .marker__mark { --tick: transparent; }

.marker[data-hull='drone-hull'] .marker__mark {
  background-color: rgba(246, 240, 226, 0.88);
  box-shadow: inset 0 0 0 1px var(--summit), 0 0 0 2px rgba(18, 12, 10, 0.75);
}

.marker[data-hull='reactor-hull'] .marker__mark {
  background-color: rgba(255, 200, 87, 0.88);
  box-shadow: inset 0 0 0 1px var(--amber), 0 0 0 2px rgba(18, 12, 10, 0.75);
}

/* Committed hulls stay fully legible after the selection locks; unchosen sites recede,
   because once the decision is made they are no longer offers. */
.marker:disabled { cursor: default; }
.marker:disabled:not([data-hull]) .marker__mark { opacity: 0.2; }

/* An anchor whose footprint would hang off the grid is never offered as a choice. */
.marker[data-legal='false'] .marker__mark {
  --tick: rgba(176, 86, 48, 0.55);
  opacity: 0.55;
}

.plate__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 18px;
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-dim);
}

.legend__item { display: inline-flex; align-items: center; gap: 7px; }

.legend__swatch {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  border: 1px solid rgba(246, 240, 226, 0.34);
}

.legend__swatch--drone { background: rgba(246, 240, 226, 0.88); border-color: var(--summit); }
.legend__swatch--reactor { background: rgba(255, 200, 87, 0.88); border-color: var(--amber); }
.legend__swatch--silica { background: #f6f0d6; border-radius: 2px; transform: rotate(45deg); }
.legend__swatch--ice { background: var(--ice); border-radius: 50%; }
.legend__swatch--ground {
  background: linear-gradient(90deg, #7a3420, #b05630);
  border-color: var(--hairline-strong);
}

/* The reticle at legend scale: the same four corner ticks, shortened to fit 11px. */
.legend__swatch--site {
  border: 0;
  background-image:
    linear-gradient(var(--summit), var(--summit)), linear-gradient(var(--summit), var(--summit)),
    linear-gradient(var(--summit), var(--summit)), linear-gradient(var(--summit), var(--summit)),
    linear-gradient(var(--summit), var(--summit)), linear-gradient(var(--summit), var(--summit)),
    linear-gradient(var(--summit), var(--summit)), linear-gradient(var(--summit), var(--summit));
  background-repeat: no-repeat;
  background-size: 3px 1px, 1px 3px, 3px 1px, 1px 3px, 3px 1px, 1px 3px, 3px 1px, 1px 3px;
  background-position:
    left top, left top,
    right top, right top,
    left bottom, left bottom,
    right bottom, right bottom;
}

/* ---- the assessment panel ----------------------------------------------- */

.panel {
  padding: 17px 18px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--panel);
}

.panel + .panel { margin-top: 14px; }

.panel__heading {
  margin: 0 0 13px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

.roster { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; }

.roster__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
}

.roster__hull { display: flex; align-items: center; gap: 8px; color: var(--ink); }

.roster__chip {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border: 1px solid var(--summit);
  background: rgba(246, 240, 226, 0.88);
}

.roster__chip--reactor { background: rgba(255, 200, 87, 0.88); border-color: var(--amber); }

.roster__at {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}
.roster__at--empty { color: var(--ink-faint); }

/* The hull the next click spends. Before this the gesture was a mystery: clicking a
   candidate placed the drone hull, then the reactor hull, and the player found out
   afterwards. Marked on the row AND previewed in the reticle's hover colour. */
.roster__row--next { border-bottom-color: var(--hairline-strong); }
.roster__row--next .roster__at { color: var(--ink-dim); }

.roster__next {
  margin-left: 8px;
  padding: 1px 5px;
  border: 1px solid rgba(232, 196, 156, 0.42);
  border-radius: 2px;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--dust);
}

.tally { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.tally__label {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.tally__value {
  font-family: var(--font-mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}

/* ---- the touchdown preview ---------------------------------------------- */

/* Sits above the committed assessment and is deliberately styled as a different KIND of
   thing — inset, hairline-ruled, smaller figures — because the one mistake this block must
   never make is being read as the committed score. Outside the map, so it may transition;
   it does not, because it appears and disappears with the pointer and a fade would lag it. */
.preview {
  margin: 0 0 16px;
  padding: 11px 12px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  background: rgba(18, 12, 10, 0.42);
}

.preview__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.preview__label {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

.preview__tile { font-size: 12px; color: var(--dust); font-variant-numeric: tabular-nums; }

.preview__note { margin: 7px 0 0; font-size: 12px; line-height: 1.5; color: var(--ink-dim); }

.preview__score { display: flex; align-items: flex-end; gap: 7px; margin-top: 7px; }

.preview__total {
  font-size: 27px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  color: var(--dust);
}

.preview__parts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
  color: var(--ink-faint);
}

.preview__parts .mono { color: var(--ink-dim); font-variant-numeric: tabular-nums; }

/* ---- score ------------------------------------------------------------- */

.score { display: flex; align-items: flex-end; gap: 9px; margin-bottom: 16px; }

.score__value {
  font-size: 46px;
  line-height: 0.94;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--summit);
}

.score__value--pending { color: var(--ink-faint); }
.score__scale { font-size: 12px; color: var(--ink-faint); padding-bottom: 5px; }

.components { display: flex; flex-direction: column; gap: 13px; }

.component__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 5px;
}

.component__label { font-size: 12px; color: var(--ink-dim); }

.component__value {
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}

.component__track {
  height: 3px;
  border-radius: 2px;
  background: rgba(232, 196, 156, 0.1);
  overflow: hidden;
}

.component__fill { height: 100%; background: var(--oxide-lit); }
.component__fill--penalty { background: var(--amber); }

.component__note { margin: 12px 0 0; font-size: 11px; line-height: 1.5; color: var(--ink-faint); }

/* Why the figures are dashes rather than zeroes, said once, where the dashes are. Every
   component is a property of the PAIR, so there is nothing honest to show for one hull —
   and a screen that shows a dash without saying why reads as broken. */
.component__pending {
  margin: 12px 0 0;
  padding: 9px 11px;
  border-left: 2px solid var(--hairline-strong);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-dim);
}

/* ---- refusal ----------------------------------------------------------- */

.refusal {
  padding: 13px 14px;
  border: 1px solid rgba(176, 86, 48, 0.45);
  border-left-width: 3px;
  border-radius: var(--radius);
  background: rgba(122, 52, 32, 0.2);
  margin-bottom: 16px;
}

.refusal__heading {
  margin: 0 0 8px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dust);
}

.refusal__reason {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid rgba(232, 196, 156, 0.32);
  border-radius: 2px;
  background: rgba(18, 12, 10, 0.5);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--summit);
}

.refusal__detail { margin: 9px 0 0; font-size: 12px; color: var(--ink-dim); }
.refusal__detail .mono { color: var(--dust); }

/* ---- begin ------------------------------------------------------------- */

.begin {
  display: block;
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--oxide-lit);
  border-radius: var(--radius);
  background: linear-gradient(180deg, #a34d2a, #7a3420);
  color: var(--summit);
  font-size: 14px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  /* Outside the canvas box, so a transition here cannot reach AC-1.3's bytes. */
  transition: filter 120ms ease-out;
}

.begin:hover:not(:disabled) { filter: brightness(1.16); }
.begin:focus-visible { outline: 2px solid var(--dust); outline-offset: 2px; }

.begin:disabled {
  border-color: var(--hairline);
  background: rgba(58, 26, 18, 0.42);
  color: var(--ink-faint);
  cursor: not-allowed;
}

.status {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-dim);
}

.status--locked { color: var(--dust); }

/* Secondary, and styled as secondary: re-plotting DISCARDS a committed decision, so it must
   never compete with Begin Mission for a hurried click. It appears as soon as one hull is
   down — a first anchor is as committed, and as regrettable, as a second. */
.replot {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 8px 14px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  background: none;
  color: var(--ink-dim);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: color 120ms ease-out, border-color 120ms ease-out;
}

.replot:hover { color: var(--dust); border-color: var(--dust); }
.replot:focus-visible { outline: 2px solid var(--dust); outline-offset: 2px; }

/* Below this the map (fixed by its own pixel size) and a usable assessment column cannot sit
   side by side, so the container narrows to the plate and the two stack. */
@media (max-width: 1060px) {
  .survey { max-width: 690px; }
  .survey__facts { gap: 20px; }
  .survey__title { font-size: 25px; }
}
`
