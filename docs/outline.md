# AI City — Project Outline

Starting outline for the agent picking up the project. Treat it as a proposal, not
gospel — refine via `/speckit.specify` + `/speckit.plan` and wire beads (`aic-*`) before
building.

## Vision (one line)

**AI City** — a web-based recreation of the original **SimCity**. MVP: a square-grid city
with **1–20 residents** and three needs (**water, food, housing**); the player places
housing + infrastructure to meet those needs, and **population grows or declines along a
curve** driven by needs met vs. unmet.

## MVP scope (locked by the General)

- Square grid map.
- Population 1–20 to start.
- Needs: **water, food, housing**.
- Goal: supply those needs via housing + infrastructure placement.
- **Population growth curve** keyed to the needs-met ratio (the core loop).
- Web-based, JS framework (React / React Native or similar).

Out of MVP scope (backlog): power, roads/traffic, zoning depth, economy/taxes, pollution,
disasters, larger maps, save-to-cloud. **Do not build these until the MVP loop is fun.**

## Decisions to finalize in the plan phase (not blockers)

1. **Exact web stack.** React + Canvas/WebGL (PixiJS or plain Canvas) vs.
   React-Native-for-Web. Recommend React + Canvas for a per-tick grid unless a shared
   mobile target matters. Sim core stays framework-agnostic TS regardless.
2. **Population representation at 1–20.** Individual resident entities (simple, inspectable)
   vs. an aggregate cohort. Individuals are fine at this scale and read better.
3. **Growth-curve shape.** The met/unmet → growth function + its tunables; design it as a
   first-class, unit-tested unit.

## Proposed Epics (rough order)

### Epic 1 — Simulation core (deterministic)
Tick loop; authoritative city + population state. Supply/demand for water/food/housing →
needs-met ratio → growth curve. Pure TS, fully tested, no rendering dependency.
*Includes the growth-curve function as a first-class, tested unit — it is the balance knob.*

### Epic 2 — Grid & building model
Square grid of tiles. Building types (housing, water source, food source) as data-driven
config with supply/coverage rules. Placement validity + occupancy.

### Epic 3 — Population & needs
Residents (individual entities at 1–20 scale) with water/food/housing needs. Aggregate
need coverage → the growth curve. Move-in / move-out driven by met vs. unmet needs.

### Epic 4 — Renderer & UI (React + Canvas/WebGL)
Grid view, placement tools, and readouts (population, per-need coverage, growth trend).
Reads sim state; owns no game logic. Every state designed (empty/paused/over-capacity).

### Epic 5 — Core game loop & balance
Wire placement → simulation → growth into a satisfying minute-to-minute loop. Tune the
growth curve + need rates so meeting needs feels rewarding and neglect has consequences.

### Epic 6 — Persistence & polish
Deterministic save/load of grid + population. Onboarding, perf budget for the grid,
build/deploy pipeline. Then re-open the backlog (power/roads/economy) for v2.

## First moves for the agent

1. Read this outline + README (MVP is locked; the concept is settled).
2. `/speckit.specify` the MVP, then `/speckit.plan` — **lock the exact React/Canvas stack**
   and the sim-core/renderer boundary — then `/speckit.tasks` + `/speckit.beads` → `aic-*`.
3. Build **Epic 1 first** (deterministic sim core + growth curve, TDD) before any
   rendering — the loop must be provable in tests before it's drawn.
4. Claim work with `bd`; follow the constitution + testing rules from `adjutant init`.

## Non-negotiables

- **Ship the MVP loop first**; backlog everything else.
- **Simulation core is the product** — deterministic, testable, React-decoupled. No game
  logic in components.
- **Growth curve is data-driven and unit-tested.**
