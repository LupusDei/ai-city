/**
 * The application shell — and DELIBERATELY nothing more.
 *
 * SCOPE. This file exists to prove the toolchain end to end: React 19 mounts, Vite
 * serves and bundles it, and the acceptance suite can reach the page. It renders a
 * placeholder carrying two of the contract testids from
 * `tests/acceptance/playable-start.spec.ts` — `survey-screen` and `seed-readout` — which
 * is exactly enough to make AC-1.1 and the no-seed edge case reachable.
 *
 * The real Surface Survey screen (terrain canvas, candidate sites, scoring) is
 * `aic-8tl.2` and belongs to another bead. Do not grow this file into it: replace it.
 *
 * Constitution §4 / spec 005 FR-002: no game logic in components. The only decision
 * made here is which seed this session uses, and even that is delegated to
 * `./seed`, which is pure.
 */
import { useState, type JSX } from 'react'

import { resolveSeed } from './seed'

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

  return (
    <main data-testid="survey-screen">
      <h1>AI City — Surface Survey</h1>
      <p>
        Mission seed: <span data-testid="seed-readout">{seed}</span>
      </p>
      <p>
        Toolchain shell. The survey screen, terrain canvas and landing flow arrive with{' '}
        <code>aic-8tl.2</code>.
      </p>
    </main>
  )
}
