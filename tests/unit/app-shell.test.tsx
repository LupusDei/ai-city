// @vitest-environment jsdom
/**
 * The toolchain proof for aic-8tl.6.
 *
 * This file is small on purpose. Its job is not to test the survey screen — that screen
 * does not exist yet (`aic-8tl.2`). Its job is to prove that the UI toolchain this bead
 * installs actually functions end to end in the test runner: React 19 renders, the
 * automatic JSX transform compiles, @testing-library/react queries the result, and the
 * per-file `// @vitest-environment jsdom` docblock above genuinely switches this one file
 * to a DOM environment while the 812 sim tests keep running in Node.
 *
 * If this file passes, the next agent's component tests will run. If it were absent, we
 * would be handing over a toolchain nobody had executed.
 *
 * The two testids asserted below are from the acceptance contract in
 * `tests/acceptance/playable-start.spec.ts` and are deliberately the only two the shell
 * carries.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '../../src/app/App'

afterEach(() => {
  // No auto-cleanup is configured (that needs a global setup file), so unmounting here
  // keeps each render isolated — otherwise the second test would query two survey
  // screens and `getByTestId` would throw on the duplicate.
  document.body.innerHTML = ''
})

describe('App shell', () => {
  it('should render the survey screen container', () => {
    render(<App search="?seed=20260730" random={() => 0} />)
    expect(screen.getByTestId('survey-screen')).toBeTruthy()
  })

  it('should display the seed from the URL', () => {
    render(<App search="?seed=20260730" random={() => 0} />)
    expect(screen.getByTestId('seed-readout').textContent).toBe('20260730')
  })

  it('should display a generated seed when the URL has none', () => {
    render(<App search="" random={() => 0.5} />)
    // Non-empty is the acceptance criterion for this edge case; asserting the exact value
    // also pins that the shell does not quietly render "NaN" or an empty span.
    const readout = screen.getByTestId('seed-readout').textContent
    expect(readout).not.toBe('')
    expect(readout).toBe(String(Math.floor(0.5 * 2_147_483_647)))
  })
})
