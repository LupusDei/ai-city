/**
 * Browser entry point — the one place in the codebase that touches the real DOM.
 *
 * Everything below this line is ordinary React; everything in `src/sim/` is forbidden
 * from knowing this file exists (`tests/unit/boundary.test.ts`). Keeping the mount, the
 * URL read and the random source together in a single edge module is what makes that
 * boundary cheap to hold.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

const container = document.getElementById('root')

// A missing mount point is a broken index.html, not a runtime condition to paper over.
// Throwing here surfaces it as a page error the acceptance suite's AC-1.1 console-error
// check will catch, rather than rendering a silently blank page.
if (container === null) {
  throw new Error('Mount point #root not found — index.html and main.tsx have diverged.')
}

createRoot(container).render(
  // StrictMode double-invokes renders and state initialisers in development to surface
  // impure components. For a UI whose whole job is to display a deterministic
  // simulation, that is exactly the class of bug worth failing loudly on.
  <StrictMode>
    <App search={window.location.search} />
  </StrictMode>,
)
