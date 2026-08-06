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

