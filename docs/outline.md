# AI City — Epic Outline

> **Revised 2026-07-29** for the Mars colonization brief. The original SimCity outline
> (water/food/housing needs + population growth curve) is **superseded** — see the
> "Retired" section at the bottom before resurrecting anything from git history.

The authoritative task list is **beads** (`aic-*`). Run `bd ready`. This document explains
the *shape* of the plan; the beads carry the acceptance criteria.

## Vision (one line)

**AI City** — a turn-based Mars colony builder. Two of three starships land; the one
carrying the personnel is lost. Using **drones** and **nuclear reactors**, build a habitat
ready for the next colonist wave **within two years**.

---

## Why the epics are ordered this way

The single highest-risk property of this project is **determinism** — a colony sim whose
turns aren't reproducible cannot be balanced, saved, or debugged. So the sim core is built
and proven in tests *before* anything is drawn. Rendering is downstream of a sim that
already works.

### Epic 1 — Foundation & toolchain — `aic-093` ✅ *scaffold complete*
Strict TypeScript, Vitest, blocking coverage gates (80/70/60), and an enforced
sim-core/renderer boundary. Exists so every later bead can be built test-first.

### Epic 6 — Martian surface & landing site selection — `aic-74p`
Seeded terrain generation (identical seed → identical map), tile buildability, and
resource deposits. Then the player's opening move: choosing where the two surviving ships
set down. **Landing choice must be consequential**, or the phase is cosmetic.

### Epic 2 — Simulation core (deterministic, turn-based) — `aic-a00` ← *the product*
- `.1` **Grid & coordinate model** ✅ *done* — row-major tiles, bounds, occupancy
- `.2` **Structure catalog** — types as data: footprint, power, build cost/duration
- `.3` **Placement & multi-tile footprint validation** — typed rejections, never throws
- `.4` **Resource ledger** — production vs consumption; electricity now, silica/O₂/H₂/
  carbon/metals later *as data*
- `.8` **Drone construction** — builds consume turns; build time is the scarce currency
- `.9` **Power generation & distribution** — the binding constraint + the brownout rule
- `.10` **Mission clock & win condition** — habitat capacity vs the 2-year deadline
- `.6` **Deterministic turn resolution** — the authoritative `state → state` step
- `.7` **Golden-trace regression** — proves determinism can't silently rot

### Epic 3 — Renderer & UI — `aic-8tl`
React shell/HUD + Canvas grid layer. Reads sim state, dispatches intents, **owns no game
logic**. Needs a turn fast-forward affordance if one turn = one sol.

### Epic 4 — Core loop & balance — `aic-to6`
Tune build durations, power values, and the deadline so the race feels tight. All tunables
are data.

### Epic 5 — Persistence & polish — `aic-n3q`
Deterministic save/load, perf budget, deploy. *Then* re-open the backlog (silica, oxygen,
hydrogen, carbon, metals, Earth-resupply credits).

---

## Working defaults (confirm via filed questions)

- **Colony is unmanned** until the wave arrives — no population sim in MVP.
- **1 turn = 1 sol**, ~670-turn budget, with UI fast-forward.
- **Landing sites differ by** terrain buildability, deposit proximity, ship separation.

## Non-negotiables

- **Sim core is the product** — deterministic, testable, React-decoupled.
- **Determinism is tested**, via golden trace. No `Date.now()`, no unseeded `Math.random()`.
- **Resources and structures are data**, not code branches.
- **Ship the MVP loop first.**

---

## Retired (do not rebuild)

The pre-pivot outline specified: population 1–20, needs of **water/food/housing**, and a
**population growth curve** driven by a needs-met ratio. All of it is retired. The crew
ship was lost in transit, so the MVP colony has **no humans** — the goal function is
habitat *readiness*, not population growth. Bead `aic-a00.5` is closed as superseded.
