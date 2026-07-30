/**
 * The application shell — and DELIBERATELY nothing more.
 *
 * SCOPE. This file exists to prove the toolchain end to end: React 19 mounts, Vite
 * serves and bundles it, and the acceptance suite can reach the page. It renders a
 * placeholder carrying three of the contract testids from
 * `tests/acceptance/playable-start.spec.ts` — `survey-screen`, `seed-readout` and
 * `terrain-canvas` — which is exactly enough to make AC-1.1, AC-1.2, AC-1.3 and the
 * no-seed edge case reachable.
 *
 * The real Surface Survey screen (candidate sites, scoring, the landing flow) is
 * `aic-8tl.2` and belongs to another bead. Do not grow this file into it: replace it.
 * `<TerrainCanvas>` is built to be lifted into that screen unchanged — it takes a
 * `World` and draws it, and knows nothing about where the world came from.
 *
 * Constitution §4 / spec 005 FR-002: no game logic in components. Two decisions are made
 * here and both are delegated: which seed this session uses (`./seed`, pure) and what
 * world that seed produces (`generateWorld`, the sim's own composition seam). Neither
 * this file nor the canvas computes anything about the game.
 */
import { useState, type JSX } from 'react'

import { generateWorld } from '../sim/world'
import { TerrainCanvas } from './canvas/TerrainCanvas'
import { resolveSeed } from './seed'

/**
 * The ratified colony map: 64x64 tiles, 320 m on a side at `TILE_EDGE_METRES`.
 *
 * Matches the sim's own default in `turn.ts` (`DEFAULT_GRID_DIMENSION`), which is private
 * to that module. Restated rather than exported-and-imported because the survey screen
 * (`aic-8tl.2`) is the layer that should own map sizing once it exists, and threading a
 * constant out of the turn loop to serve a placeholder would be the wrong seam to open.
 */
const MAP_DIMENSION = 64

export interface AppProps {
  /** URL query string (`location.search`), injected so the shell stays testable. */
  readonly search: string
  /**
   * Source of randomness for a generated seed. Defaults to `Math.random`; tests pass a
   * fixed function so the fallback path is deterministic.
   */
  readonly random?: () => number
}

/**
 * Root component. Resolves the session seed once and displays it.
 *
 * The seed is held in lazy state rather than recomputed per render: AC-1.3 requires the
 * same seed to produce identical terrain, and a seed that changed on re-render would
 * break that the moment the survey screen starts drawing from it.
 */
export function App({ search, random = Math.random }: AppProps): JSX.Element {
  const [seed] = useState(() => resolveSeed(search, random))
  // Generated ONCE per session, in lazy state, for the same reason the seed is: AC-1.3
  // requires one seed to yield one terrain, and a world regenerated on every render would
  // be wasted work at best and — the moment anything here becomes stateful — a different
  // map between two renders of the same session at worst.
  const [world] = useState(() => generateWorld(MAP_DIMENSION, MAP_DIMENSION, seed))

  return (
    <main data-testid="survey-screen">
      <h1>AI City — Surface Survey</h1>
      <p>
        Mission seed: <span data-testid="seed-readout">{seed}</span>
      </p>
      <TerrainCanvas world={world} />
      <p>
        Elevation is shaded low-to-high; steep ground darkens toward basalt, so clean
        iron-oxide red is buildable. Deposits: pale diamonds are silica, blue discs are ice.
      </p>
      <p>
        Toolchain shell. Candidate sites, site scoring and the landing flow arrive with{' '}
        <code>aic-8tl.2</code>.
      </p>
    </main>
  )
}
