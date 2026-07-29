# AI City — Project Outline

Starting outline for the agent picking up the project. Treat it as a proposal, not
gospel — refine via `/speckit.specify` + `/speckit.plan` and wire beads (`aic-*`) before
building.

## Vision (one line)

**AI City** — a living city simulation where the citizens are autonomous AI agents; the
player founds and shapes the city and the drama/emergence comes from the agents, not
scripted crowds. (Genre + the exact meaning of "AI" are the first decisions — see Epic 0.)

## Highest-risk questions (resolve FIRST — they gate the build)

1. **Genre / core loop** — city-builder vs. emergent social sim vs. observational sandbox.
   Decides win-state, UI, and scope. Surface options + a recommendation to the General via
   `file_question` if it's a vision-level call.
2. **What "AI" means** — cheap deterministic AI (behavior trees / utility / GOAP) vs.
   LLM-driven agents vs. a hybrid (cheap for the crowd, LLM for named citizens). This is
   the most identity-defining and cost/latency-sensitive choice.
3. **Platform / tech** — web (Canvas/WebGL: Phaser/PixiJS/Three) vs. engine (Godot/Unity).
   Recommend web-first unless 3D is core.
4. **Scale** — few deep agents vs. many shallow ones. Drives ECS/tick/spatial design.

## Proposed Epics (rough order)

### Epic 0 — Define the game *(first, and gating)*
Lock the genre + core loop, the meaning of "AI", platform/tech, and target scale. Produce
a short, dated one-pager the rest of the plan hangs on. **Nothing downstream is stable
until this is decided.**

### Epic 1 — Simulation core
Deterministic tick loop; the authoritative city + agent state. Save/load + (if feasible)
replay from the start. Testable in isolation, no rendering dependency.

### Epic 2 — Agent system
Perception → decision → action. Pluggable "brain" behind a clean interface (BT/utility/
GOAP now; LLM adapter optional later). Agent needs, goals, jobs, relationships.

### Epic 3 — City / world model
Grid or graph of tiles/buildings/roads; economy, zoning, resources, jobs. Data-driven
content (buildings/jobs/archetypes as config).

### Epic 4 — Renderer & UI
Read-only view of simulation state; camera, selection, inspect-an-agent, city overview.
Never owns game logic. Every state designed (empty/loading/paused).

### Epic 5 — Player interaction / core loop
Whatever Epic 0 picks: build/zone/budget, or nudge/observe, or intervene in citizen lives.
The actual verbs the player uses each minute.

### Epic 6 — Content & tuning
Buildings, jobs, agent archetypes, events, difficulty/tunables — all as data. Enough
content to make the loop feel alive.

### Epic 7 — Persistence, polish, ship
Robust save/load, performance budget for target scale, onboarding, build/deploy pipeline.

## First moves for the agent

1. Read this outline + README.
2. **Resolve Epic 0** — genre, meaning of "AI", platform, scale. Surface options + a
   recommendation to the General via `file_question` for the vision-level calls.
3. Run `/speckit.specify` to formalize scope, then `/speckit.plan` + `/speckit.tasks` +
   `/speckit.beads` to generate `aic-*` work.
4. Claim work with `bd`; follow the constitution + testing rules from `adjutant init`
   (simulation logic is TDD-tested; determinism has regression tests).

## Non-negotiables

- **Lock genre + meaning of "AI" before building the engine.**
- **Simulation core is the product** — deterministic, testable, render-decoupled.
- **Data-driven content** so tuning doesn't require code changes.
