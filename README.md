# AI City

A new **game** — working title **"AI City."**

> **Bootstrap note.** The General's directive named the game ("AI City") but not its
> genre, platform, or scope. This README lays out the most likely concept and the
> decisions that must be locked before serious building. **Resolving the game concept is
> the first job** — surface options + a recommendation to the General via `file_question`
> before committing to an architecture.

## The likely concept (to confirm)

Given the name and the Adjutant multi-agent context, the strongest read is:

> **A living city simulation where the citizens are AI agents.** The player founds and
> shapes a city; autonomous AI-driven residents pursue goals, form relationships, take
> jobs, and react to the player's decisions — the city feels alive because it is *run by
> agents*, not scripted crowds.

Plausible adjacent directions, worth a quick decision rather than a long debate:
- **City-builder / management sim** — zone, build, budget; AI citizens are the simulation
  layer (SimCity / Cities-lines lineage, but the sim is agent-driven).
- **Emergent social sim** — smaller footprint, deeper agents; the drama between residents
  *is* the game (Dwarf-Fortress / RimWorld lineage).
- **Sandbox / "AI zoo"** — the player observes and nudges a city of LLM-or-behavior-tree
  agents; the fun is watching emergent behavior (a toy/experience more than a win-state).

**Pick one primary pillar first.** The genre decides almost every downstream technical
choice, so this is Epic 0.

## Decisions that gate the build (resolve before heavy work)

1. **Genre / core loop.** What does the player *do* minute-to-minute, and what's the
   win/progress condition (if any)? See Epic 0.
2. **Platform & tech.** Web (Canvas/WebGL, e.g. Phaser/PixiJS/Three) vs. a game engine
   (Godot/Unity). Web keeps it inspectable and shippable via the existing tooling; an
   engine buys richer rendering. **Recommend evaluating web-first** unless the vision
   needs 3D.
3. **What "AI" means here.** Behavior trees / utility AI / GOAP (cheap, deterministic,
   offline) vs. LLM-driven agents (rich, emergent, but latency + cost + non-determinism).
   A hybrid — cheap sim for the many, LLM for a few "named" citizens — is often the sweet
   spot. This is the single most identity-defining choice.
4. **Scale.** Tens of deep agents vs. thousands of shallow ones. Drives the whole
   architecture (ECS, tick model, spatial partitioning).
5. **Determinism & save/load.** Simulation games live or die on reproducible ticks and
   robust saves — decide early, don't bolt on.

## Architecture sketch (to be refined in docs/outline.md + /speckit.plan)

Simulation-first, whatever the shell:
- **Simulation core** — deterministic tick loop; the source of truth for city + agents.
- **Agent system** — perception → decision → action; pluggable "brains" (BT/utility/GOAP,
  optionally LLM for select agents). Isolate the brain behind an interface so the AI
  strategy can be swapped.
- **World / city model** — grid or graph of tiles/buildings/roads; economy, needs, jobs.
- **Renderer & UI** — reads simulation state; never owns game logic.
- **Persistence** — deterministic save/load, replay if feasible.
- **Content/config** — buildings, jobs, agent archetypes, tunables as data, not code.

## Non-negotiables

- **Lock the genre + the meaning of "AI" before building the engine.** Everything hangs
  on those two.
- **Simulation core is the product** — deterministic, testable, decoupled from rendering.
- **Data-driven content** so designers/agents can tune without code changes.
- Follow the project constitution + testing rules installed by `adjutant init` (TDD,
  simulation logic must be tested).

## Status

Bootstrapped and adjutant-initialized; ready for an agent to begin planning + building.
See `docs/outline.md` for the initial epic/task outline. First move: **confirm the game
concept (Epic 0)**, then `/speckit.specify` → `/speckit.plan` → beads (`aic-*`).
