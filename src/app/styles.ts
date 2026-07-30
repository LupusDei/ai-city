/**
 * The application's visual language, as CSS text.
 *
 * ============================================================================
 * WHY CSS LIVES IN A `.ts` MODULE AND NOT IN A `.css` FILE
 * ----------------------------------------------------------------------------
 * Vite handles `import './survey.css'` natively, but TypeScript does not: resolving that
 * specifier needs `vite/client` in `tsconfig.json`'s `types`, or an ambient
 * `declare module '*.css'`. Both are toolchain changes, and `tsconfig*` is owned by the
 * toolchain bead (`aic-8tl.6`) rather than by a screen. Exporting the stylesheet as a string
 * and rendering it in a `<style>` element needs no build configuration at all, keeps the
 * whole visual language in one reviewable place, and costs nothing at runtime — React
 * inserts the element once and leaves it alone.
 *
 * The trade is real and worth naming: no CSS syntax checking from the editor, and no
 * autoprefixing. Both are acceptable for a single hand-written sheet targeting one
 * evergreen browser (the acceptance suite runs Chromium), and neither is worth widening the
 * typecheck surface for.
 * ============================================================================
 *
 * ============================================================================
 * AC-1.3 CONSTRAINTS THIS SHEET OBEYS — read `render-world.ts`'s docblock first
 * ----------------------------------------------------------------------------
 * Spec 005's AC-1.3 screenshots the `terrain-canvas` element and requires the bytes to be
 * IDENTICAL across a page reload. The candidate-marker layer is painted ON TOP of that
 * canvas, so it is inside those bytes and is bound by the same determinism rules the
 * renderer is:
 *
 *   - NO TRANSITIONS OR ANIMATIONS ON THE MARKER LAYER. A transition mid-flight when the
 *     screenshot is taken is a partially-interpolated frame, and two loads would not
 *     necessarily be at the same point in it. Panel controls outside the canvas box may
 *     transition freely; markers change state instantly.
 *   - NO TEXT INSIDE A MARKER. Not one glyph over the canvas, for the same reason
 *     `render-world.ts` contains no `fillText`: glyph rasterisation depends on which fonts
 *     have finished loading, and a label rendered in a fallback face on the first load and
 *     the real face on the second is a byte difference with no visible cause. Marker meaning
 *     is carried by `aria-label` — read by assistive technology, drawn by nothing.
 *   - NO WEB FONTS ANYWHERE ON THE PAGE. System stacks only, so there is no font-loading
 *     race that could reflow the page between two loads.
 *   - WHOLE-PIXEL MARKER GEOMETRY, positioned from the tile size alone. See
 *     `candidate-sites.ts`'s `candidateMarkerBox`; nothing here derives a marker position
 *     from a measured element.
 *   - NO `backdrop-filter` OR `mix-blend-mode` OVER THE MAP. Both sample the pixels beneath
 *     them through compositor paths that are far more sensitive to timing and GPU state than
 *     an ordinary fill.
 * ============================================================================
 *
 * COLOUR. Every hue is drawn from `canvas/mars-palette.ts` so the chrome and the map read as
 * one instrument rather than a UI with a picture in it: the page ground is `MARS_VOID`, the
 * panels are `SLOPE_SHADE` basalt, and the accents are the same iron-oxide ramp the terrain
 * is shaded with. The values are duplicated as hex here rather than imported and converted,
 * because the palette module's types describe canvas fills (`Rgb`, alpha compositing) and
 * threading them through a template literal would buy consistency the eye can already check
 * while adding a conversion layer that could itself be wrong. The map is the hero; the chrome
 * stays deliberately quiet so the terrain is the brightest thing on screen.
 */

/**
 * Page-level ground, typography and design tokens.
 *
 * Rendered by `App.tsx` in every phase, so the operations screen inherits the same tokens
 * and the page does not lose its ground when the survey screen unmounts at `begin-mission`.
 */
export const PAGE_STYLES = `
:root {
  /* The Mars ramp, from canvas/mars-palette.ts. */
  --void: #120c0a;
  --basalt: #1a1416;
  --oxide-deep: #3a1a12;
  --oxide: #7a3420;
  --oxide-lit: #b05630;
  --dust: #e8c49c;
  --summit: #f6f0e2;
  --ice: #a8e2f0;
  --amber: #ffc857;

  --ink: #efe4d9;
  --ink-dim: #b09a8c;
  --ink-faint: #7d6a60;
  --hairline: rgba(232, 196, 156, 0.14);
  --hairline-strong: rgba(232, 196, 156, 0.28);

  --panel: rgba(30, 22, 22, 0.72);
  --radius: 3px;

  --font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

  color-scheme: dark;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--void);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

body {
  /* A single warm wash from the top-left, so the page reads as lit rather than flat.
     Fixed geometry, no animation: nothing here can differ between two loads. */
  background-image: radial-gradient(120% 80% at 12% -10%, #24160f 0%, var(--void) 62%);
  background-repeat: no-repeat;
  min-height: 100vh;
}

h1, h2, h3 { margin: 0; font-weight: 500; letter-spacing: -0.01em; }

button {
  font: inherit;
  color: inherit;
}

.numeric { font-variant-numeric: tabular-nums; }
.mono { font-family: var(--font-mono); }
`

/**
 * The Surface Survey screen.
 *
 * Structure, and why it is this shape: the map is the largest thing on the page because the
 * decision the player is making is a decision ABOUT the map, and the assessment panel sits
 * immediately beside it so a candidate's score can be read without the eye leaving the site
 * it belongs to. The masthead carries the three facts that are true of the whole session —
 * seed, deposits, grid — because those are session identity rather than part of the decision.
 */
export const SURVEY_STYLES = `
.survey {
  max-width: 1140px;
  margin: 0 auto;
  padding: 28px 24px 56px;
}

/* ---- masthead ------------------------------------------------------------ */

.survey__masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px 32px;
  padding-bottom: 18px;
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
  gap: 28px;
  margin-top: 24px;
}

.survey__plate { flex: 0 0 auto; }
.survey__assessment { flex: 1 1 300px; min-width: 280px; }

/* ---- the survey plate ---------------------------------------------------- */

.plate__stack {
  position: relative;
  /* Sized by the inline style the component sets from worldPixelSize, never measured.
     content-box overrides the global border-box reset ON PURPOSE: the inline width and
     height are the canvas's exact pixel size, and under border-box the 1px frame would eat
     two pixels of it — leaving the canvas overflowing its own container by 2px and the
     inset-0 marker layer misaligned from the terrain by one.
     NOTE for future editors: these stylesheets are template literals, so a backtick or a
     dollar-brace anywhere inside them terminates the string. Quote CSS identifiers in these
     comments with plain words, never with backticks. */
  box-sizing: content-box;
  border: 1px solid var(--hairline-strong);
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

/* The visible mark: exactly the 2x2 hull footprint, inside a larger touch target. */
.marker__mark {
  border: 1px solid rgba(246, 240, 226, 0.34);
  box-shadow: inset 0 0 0 1px rgba(18, 12, 10, 0.45);
}

.marker:hover .marker__mark,
.marker:focus-visible .marker__mark {
  border-color: var(--summit);
  box-shadow:
    inset 0 0 0 1px rgba(18, 12, 10, 0.6),
    0 0 0 1px rgba(246, 240, 226, 0.45);
}

.marker:focus-visible { outline: 1px solid var(--summit); outline-offset: 1px; }

.marker[data-hull='drone-hull'] .marker__mark {
  background: rgba(246, 240, 226, 0.82);
  border-color: var(--summit);
}

.marker[data-hull='reactor-hull'] .marker__mark {
  background: rgba(255, 200, 87, 0.82);
  border-color: var(--amber);
}

/* Committed hulls stay fully legible after the selection locks; unchosen sites fade out. */
.marker:disabled { cursor: default; }
.marker:disabled:not([data-hull]) .marker__mark { opacity: 0.22; }

/* An anchor whose footprint would hang off the grid is never offered as a choice. */
.marker[data-legal='false'] .marker__mark {
  border-style: dashed;
  border-color: rgba(176, 86, 48, 0.5);
  box-shadow: none;
  opacity: 0.5;
}

.plate__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
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

.legend__swatch--drone { background: rgba(246, 240, 226, 0.82); border-color: var(--summit); }
.legend__swatch--reactor { background: rgba(255, 200, 87, 0.82); border-color: var(--amber); }
.legend__swatch--silica { background: #f6f0d6; border-radius: 2px; transform: rotate(45deg); }
.legend__swatch--ice { background: var(--ice); border-radius: 50%; }
.legend__swatch--ground {
  background: linear-gradient(90deg, #7a3420, #b05630);
  border-color: var(--hairline-strong);
}

/* ---- the assessment panel ----------------------------------------------- */

.panel {
  padding: 18px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--panel);
}

.panel + .panel { margin-top: 16px; }

.panel__heading {
  margin: 0 0 14px;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--oxide-lit);
}

.roster { display: flex; flex-direction: column; gap: 8px; margin: 0 0 16px; }

.roster__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--hairline);
  font-size: 13px;
}

.roster__hull { color: var(--ink); }
.roster__hull--drone::before,
.roster__hull--reactor::before {
  content: '';
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 8px;
  vertical-align: 0;
  border: 1px solid var(--summit);
}
.roster__hull--drone::before { background: rgba(246, 240, 226, 0.82); }
.roster__hull--reactor::before { background: rgba(255, 200, 87, 0.82); border-color: var(--amber); }

.roster__at {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--dust);
}
.roster__at--empty { color: var(--ink-faint); }

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

/* ---- score ------------------------------------------------------------- */

.score { display: flex; align-items: flex-end; gap: 9px; margin-bottom: 18px; }

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

.component__note { margin: 5px 0 0; font-size: 11px; color: var(--ink-faint); }

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

@media (max-width: 900px) {
  .survey__facts { gap: 20px; }
  .survey__title { font-size: 25px; }
}
`
