import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite serves `npm run dev` and bundles `npm run build` (spec 005, FR-001).
 *
 * The stack is React for the shell and plain Canvas 2D for the grid (README, spec 001).
 * There is deliberately NO game framework here: the simulation is already a pure,
 * deterministic TypeScript core, and a framework's own loop, ticker or scene graph would
 * duplicate — and eventually contend with — the turn loop that core already owns.
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    // strictPort matters for the acceptance suite: without it Vite silently falls
    // forward to 5174 when 5173 is taken, and Playwright's baseURL would then point at
    // whatever else is listening. Failing to start is far better than testing the
    // wrong server.
    strictPort: true,
  },

  preview: {
    port: 5173,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    // Fail the build rather than emit a bundle whose sourcemaps or assets are stale.
    emptyOutDir: true,
    sourcemap: true,
  },
})
