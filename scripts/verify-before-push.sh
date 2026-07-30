#!/usr/bin/env bash
set -euo pipefail

# Ensure we run from repo root regardless of where the script is invoked
cd "$(git rev-parse --show-toplevel)" || exit 1

# Skip verification for WIP branches
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == wip/* ]]; then
  echo "WIP branch detected — skipping verification"
  exit 0
fi

# Single definition of the gate: typecheck -> lint -> build -> test:coverage.
# This MUST stay `npm run verify`, not a hand-rolled list of steps. Re-listing
# steps here is exactly how this script and CI drifted from the real gate
# before (aic-hfp): this script used to skip typecheck entirely and run
# `npm test` instead of `npm run test:coverage`, so the 80/70/60 coverage
# thresholds (Constitution §1) were never enforced before a push, and type
# errors confined to tests/ (which `npm run build` never compiles) slipped
# through. If `npm run verify` gains or loses a step, this script picks it up
# automatically instead of silently falling further behind.
echo "=== Running npm run verify (typecheck, lint, build, test:coverage) ==="
npm run verify || { echo "FAILED: npm run verify did not pass"; exit 1; }

echo "=== All checks passed ==="
