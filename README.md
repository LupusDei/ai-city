# AI City — Mars Colony

A **web-based, turn-based colony-building game**. SimCity's DNA, relocated to Mars and
put on a clock.

Three starships left Earth. **Two landed.** The third — carrying critical components
*and the personnel* — was **lost in transit**. What survived: one ship of **automated
construction drones**, one ship of **nuclear reactors**.

You have **two years** to build a habitat capable of receiving the next wave of
colonists. There is nobody on the surface to help you. Only the drones.

---

## MVP scope

The first playable target, deliberately small:

- **Square grid** Martian surface.
- **Landing site selection** — the player's opening move: map the surface, then choose
  where the two surviving ships set down.
- **Drone-driven construction** — you don't place finished buildings, you *queue* them,
  and drones build over multiple turns. **Build time is the scarce currency.**
- **Electricity as the single binding constraint**, supplied by the surviving reactors.
- **Structures of varying footprint** — from single tiles to larger multi-tile shapes,
  all grid-aligned.
- **Turn-based, against a hard 577-day deadline** — see the mission clock below.
- **Win condition:** habitat capacity sufficient for the arriving colonist wave, evaluated
  at the deadline.

### The mission clock (locked, reality-grounded)

| Quantity | Value | Where it comes from |
|---|---|---|
| Mars sol | 24 h 39 m 35 s | The actual Martian solar day |
| Drone shift | 25 h work + 1 sol recharge | The General's directive |
| **One turn** | **49.66 h = 2.014 sols** | Work + recharge — the turn *is* the duty cycle |
| **Mission length** | **577 days = 278 turns** | Synodic period 779.9 d − Starship transit 203 d |
| Reactor output | 40 kWe per unit | NASA Fission Surface Power target unit |
| Drone recharge draw | **5.54 kW** | 125 kWh usable ÷ 0.92 charging efficiency, + 32 W pack thermal upkeep, over one sol |

The deadline is the moment the next wave **departs Earth**, not when it arrives — they will
not commit to launch unless the habitat is confirmed ready. **Numbers must stay defensible
against real mission engineering**; every default cites its basis in a code comment.

Because drones recharge on **colony power**, the reactor budget caps how many drones can be
on shift. Power and labour are a single constraint — that coupling is the core tension.

### Deliberately deferred (post-MVP backlog)

Additional resource constraints — **silica** (solar panels, habitat glass), **oxygen**,
**hydrogen**, **carbon**, **metals** — plus a **credit system** for urgent Earth resupply
missions. The resource ledger is built resource-agnostic *specifically* so these drop in
as **data**, not as a rewrite. Do not build them until the core loop is fun.

---

## Core loop (MVP)

1. Survey the surface; choose landing sites for the two surviving ships.
2. Queue structures; drones execute the builds over subsequent turns.
3. Each turn resolves: construction progresses, the resource ledger nets production
   against consumption, the mission clock advances.
4. **Electricity is the pressure.** Expand generation or your colony browns out.
5. Race the clock to habitat readiness before the colonists arrive.

*The tension between build time, power budget, and the deadline is the heart of the game.*

---

## Status & open decisions

**Confirmed by the General:** Mars premise, square grid, drones, electricity-first,
varying structure footprints, turn-based with a 2-year limit.

**Ratified** (proposal `55009338` accepted; all three confirmed):

| Decision | Ruling |
|---|---|
| Is the colony unmanned until the wave arrives? | **Yes** — no humans, no population sim in MVP |
| What is one turn? | **One drone duty cycle** — 25 h work + 1 sol recharge |
| Mission length | **577 days = 278 turns** |
| Does recharging draw colony power? | **Yes** — power and labour are one constraint |
| What makes a landing site good? | Terrain buildability, deposit proximity, hull separation |

> **Superseded:** an earlier draft of this project specified a SimCity MVP with
> water/food/housing needs and a population growth curve. The Mars brief replaced it.
> That model is **retired** — the crew ship was lost, so there is no population to grow
> during the MVP. Do not resurrect it from old notes.

---

## Architecture

- **Simulation core** (`src/sim`) — **the product.** Framework-agnostic, deterministic,
  turn-based TypeScript. Grid, structure catalog, placement, resource ledger, construction,
  power, mission clock. Zero rendering dependency.
- **Renderer & UI** — React for shell/HUD + a **Canvas** layer for the grid. Reads sim
  state and dispatches player intents; **owns no game logic**.
- **Content/config** — structure types, build durations, power values, and the deadline
  are **data**, never literals in code.

### Non-negotiables

- **The simulation core is the product** — deterministic, testable, React-decoupled.
  **No game logic in components.**
- **Determinism is a tested property**, not an aspiration: identical state + identical
  turns must yield identical output. Guarded by a golden-trace regression test.
- **Resources are data-driven.** Adding silica or oxygen must not require touching
  ledger logic.
- **Ship the MVP loop first.** Backlog everything else until it's fun.

---

## Build & test

```bash
npm install
npm run verify        # typecheck + build + tests with coverage gates
npm test              # tests only
npm run test:coverage # coverage gates: 80% lines / 70% branches / 60% functions
```

TypeScript **strict** mode (plus `noUncheckedIndexedAccess`). Coverage thresholds are
**blocking** — verified by negative control, not assumed.

Work is tracked in **beads** (`aic-*`): `bd ready` to find available work.
See `docs/outline.md` for the epic breakdown.
