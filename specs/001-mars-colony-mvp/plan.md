# Plan — AI City: Mars Colony Builder MVP

**Feature**: 001-mars-colony-mvp
**Reconciles with**: existing `aic-*` bead tree (no new root epic — see Bead Map).

## Architecture

```
src/sim/          framework-agnostic, deterministic, turn-based TypeScript  ← THE PRODUCT
  grid.ts         ✅ shipped — row-major tiles, bounds, occupancy
  catalog.ts      ✅ shipped — data-driven structures, multi-tile + L footprints
  placement.ts    footprint validation, typed rejections, no partial writes
  time.ts         turn cycle + 577-day mission clock, INTEGER SECONDS only
  ledger.ts       resource-agnostic production vs consumption
  power.ts        generation, draw, brownout priority order
  drones.ts       roster, shifts, labour capacity, recharge draw
  construction.ts build queue, progress in turns
  mission.ts      turn resolution (state → state), win/lose
  terrain.ts      seeded heightmap, buildability, deposits
  landing.ts      hull placement + site scoring
src/ui/           React shell + Canvas grid. Reads sim state. NO game logic.
  adapter.ts      the ONLY module importing both sim and UI
```

### Key decisions

1. **Integer seconds for all time arithmetic.** Floating-point hours would make the clock
   path irreproducible across platforms. The sol is stored as 88,775 s.
2. **Pure functions, new state objects.** `resolveTurn(state)` never mutates its input, so a
   golden trace can diff any two turns.
3. **Typed results, not exceptions, for player error.** Catalog/config errors throw (author
   defects); placement rejections return typed reasons (ordinary gameplay).
4. **Resource-agnostic ledger.** Open string-keyed records — already proven by a test that
   registers invented resources with zero source changes.
5. **Documented brownout priority.** Never Map/Set iteration order — that is a determinism leak.

## Phases

| Phase | Content | Parallel? |
|---|---|---|
| 1 | Foundation — scaffold, boundary enforcement | ✅ scaffold shipped |
| 2 | Sim primitives — placement, time model, terrain | **[P]** 3 independent files |
| 3 | Sim systems — ledger, power, drones, construction | partially [P] |
| 4 | Turn resolution + golden trace | sequential (integrates 3) |
| 5 | Renderer & screens | **[P]** after sim core |
| 6 | Balance + persistence + deploy | [P] |

## Parallel opportunities (for squad execution)

Phase 2 is the widest parallel front and every task touches a **different file**:

- `src/sim/placement.ts` — no overlap
- `src/sim/time.ts` — no overlap
- `src/sim/terrain.ts` — no overlap
- boundary-enforcement test — touches `tests/` only

Constitution §7 requires **worktree isolation** for every concurrent agent that edits files.

## Bead Map

Reconciled onto the existing tree — **no duplicate root created**.

- `aic-093` — Epic 1: Foundation & toolchain
  - `aic-093.1` ✅ Workspace scaffold (strict TS, Vitest, coverage gates)
  - `aic-093.2` Enforce sim-core/renderer boundary
- `aic-74p` — Epic 6: Martian surface & landing *(US1)*
  - `aic-74p.1` Seeded terrain generation
  - `aic-74p.2` Tile buildability & mineral deposits
  - `aic-74p.3` Landing site selection & scoring
  - `aic-74p.4` Starting inventory from surviving holds
- `aic-a00` — Epic 2: Simulation core *(US2, US3)*
  - `aic-a00.1` ✅ Grid & coordinate model
  - `aic-a00.2` ✅ Structure catalog (multi-tile + L footprints)
  - `aic-a00.3` Placement & footprint validation
  - `aic-a00.4` Resource ledger
  - `aic-a00.6` Deterministic turn resolution
  - `aic-a00.7` Determinism regression (golden trace)
  - `aic-a00.8` Drone construction system
  - `aic-a00.9` Power generation, distribution & brownout
  - `aic-a00.10` Mission clock, habitat readiness & win/lose
  - `aic-a00.11` Turn cycle & mission time model (577 d / 278 turns)
  - `aic-a00.12` Drone roster, shifts & labour capacity
- `aic-8tl` — Epic 3: Renderer & UI *(US4)*
  - `aic-8tl.1` Canvas grid renderer
  - `aic-8tl.2` Screen: Surface survey & landing
  - `aic-8tl.3` Screen: Colony operations
  - `aic-8tl.4` Screen: Cycle report
  - `aic-8tl.5` Sim/UI adapter & intent dispatch
- `aic-to6` — Epic 4: Core loop & balance
  - `aic-to6.1` Balance pass · `aic-to6.2` Headless scenario runner
- `aic-n3q` — Epic 5: Persistence & polish
  - `aic-n3q.1` Deterministic save/load · `aic-n3q.2` Perf budget · `aic-n3q.3` CI/deploy
