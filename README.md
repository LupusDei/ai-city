# AI City

A **web-based city-building game** — a modern recreation of the original **SimCity**.

You found and grow a city on a square grid: provide **housing** and **infrastructure**
(**water**, **food**) to support your residents, and the **population grows or shrinks**
along a curve driven by how well those needs are met.

## MVP scope (locked)

The first playable target, deliberately small:

- **Square grid** city map.
- **Population: 1–20 people** to start.
- **Three needs:** **water**, **food**, **housing**.
- **Player goal:** place **housing** and **infrastructure** to supply those needs.
- **Population growth curve:** population rises when needs are met, stalls/declines when
  they're unmet — the core feedback loop.
- **Web-based**, JavaScript framework (React / React Native, or similar — see Tech below).

Everything past this (power, roads, zoning depth, traffic, economy, disasters, larger
maps) is **post-MVP** and lives in the backlog, not the first build.

## Core loop (MVP)

1. Player places housing + infrastructure (water/food sources) on the grid.
2. Each tick, the sim computes **supply vs. demand** for water, food, housing.
3. The **needs-met ratio** feeds the **growth curve**: met → population grows toward the
   housing cap; unmet → growth stalls, then residents leave.
4. Player reads the city's state, expands supply, and grows the population. Repeat.

*The growth curve tied to met/unmet needs is the heart of the game — get that satisfying
first.*

## Tech (to finalize in `/speckit.plan`)

- **Web-based, JavaScript.** The General named **React Native or a similar JS framework**.
  For a grid-sim rendered every tick, the conventional fit is **React for UI/shell +
  a Canvas/WebGL layer** (plain Canvas, PixiJS, or similar) for the grid — React alone
  re-rendering a large grid per tick is a perf trap. **React-Native-for-Web** is viable if
  a shared mobile target matters; otherwise plain React + Canvas is simpler. **Confirm the
  exact stack in the plan phase** (this is a tech choice, not a blocker).
- **Simulation core is plain, framework-agnostic TypeScript** — deterministic tick loop,
  fully testable, no rendering dependency. The renderer only *reads* sim state.

## Architecture sketch (refine in docs/outline.md + /speckit.plan)

- **Simulation core** — deterministic tick loop; authoritative city + population state.
  Supply/demand for water/food/housing → needs-met ratio → growth curve. Pure TS, tested.
- **World / grid model** — square grid of tiles; buildings (housing, water, food sources)
  as data-driven types with supply/coverage rules.
- **Population model** — residents (or aggregate cohorts at this scale) with the three
  needs; the growth-curve function is a first-class, tunable, tested unit.
- **Renderer & UI (React + Canvas/WebGL)** — grid view, placement tools, city readouts
  (population, need coverage). Reads sim state; owns no game logic.
- **Persistence** — deterministic save/load of the grid + population state.
- **Content/config** — building types, need rates, growth-curve tunables as **data**.

## Non-negotiables

- **Ship the MVP loop first** — grid + housing + water/food + the growth curve. Resist
  scope creep (power/roads/economy/etc. are backlog until the loop is fun).
- **Simulation core is the product** — deterministic, testable, decoupled from React.
  **Do not put game logic in components.**
- **The growth curve is data-driven and unit-tested** — it's the balance knob.
- Follow the constitution + testing rules installed by `adjutant init` (TDD; sim logic and
  the growth curve have tests; determinism is regression-tested).

## Status

Bootstrapped and adjutant-initialized; ready for an agent to begin planning + building.
See `docs/outline.md` for the epic/task outline. First move: `/speckit.specify` the MVP
above → `/speckit.plan` (lock the exact React/Canvas stack) → `/speckit.tasks` →
`/speckit.beads` (`aic-*`).
