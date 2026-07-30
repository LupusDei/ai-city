# Tasks — AI City: Mars Colony Builder MVP

`[P]` = parallelisable (different files, no shared dependency).
`[US#]` = the user story it serves. TDD is mandatory: failing test first, always.

## Phase 1 — Foundation

- [x] **T001** Workspace scaffold: strict TS, Vitest, coverage gates → `package.json`, `tsconfig.json`, `vitest.config.ts` — **DONE** (`aic-093.1`)
- [ ] **T002** `[P]` Enforce sim/renderer boundary → `tests/unit/boundary.test.ts` (`aic-093.2`)

## Phase 2 — Sim primitives (widest parallel front)

- [x] **T003** Grid & coordinate model → `src/sim/grid.ts` — **DONE** (`aic-a00.1`)
- [x] **T004** Structure catalog, multi-tile + L footprints → `src/sim/catalog.ts` — **DONE** (`aic-a00.2`)
- [ ] **T005** `[P]` `[US2]` Placement & footprint validation → `src/sim/placement.ts`, `tests/unit/placement.test.ts` (`aic-a00.3`)
- [ ] **T006** `[P]` `[US3]` Turn cycle & mission time model, integer seconds, 577 d ⇒ 278 turns → `src/sim/time.ts`, `tests/unit/time.test.ts` (`aic-a00.11`)
- [ ] **T007** `[P]` `[US1]` Seeded terrain generation → `src/sim/terrain.ts`, `tests/unit/terrain.test.ts` (`aic-74p.1`)

## Phase 3 — Sim systems

- [ ] **T008** `[US1]` Tile buildability & mineral deposits → `src/sim/terrain.ts` (`aic-74p.2`)
- [ ] **T009** `[US2]` Resource ledger, resource-agnostic → `src/sim/ledger.ts` (`aic-a00.4`)
- [ ] **T010** `[US2]` Power generation, distribution, brownout priority → `src/sim/power.ts` (`aic-a00.9`)
- [ ] **T011** `[US2]` Drone roster, shifts, labour capacity, recharge draw → `src/sim/drones.ts` (`aic-a00.12`)
- [ ] **T012** `[US2]` Drone construction system → `src/sim/construction.ts` (`aic-a00.8`)
- [ ] **T013** `[US1]` Landing site selection & scoring → `src/sim/landing.ts` (`aic-74p.3`)
- [ ] **T014** `[US1]` Starting inventory from surviving holds → `src/sim/landing.ts` (`aic-74p.4`)
- [ ] **T015** `[US3]` Mission clock, habitat readiness, win/lose → `src/sim/mission.ts` (`aic-a00.10`)

## Phase 4 — Integration

- [ ] **T016** `[US3]` Deterministic turn resolution → `src/sim/mission.ts` (`aic-a00.6`)
- [ ] **T017** `[US3]` Determinism regression, golden trace → `tests/unit/golden-trace.test.ts` (`aic-a00.7`)

## Phase 5 — Renderer & screens

- [ ] **T018** `[US4]` Sim/UI adapter & intent dispatch → `src/ui/adapter.ts` (`aic-8tl.5`)
- [ ] **T019** `[P]` `[US4]` Canvas grid renderer → `src/ui/GridCanvas.tsx` (`aic-8tl.1`)
- [ ] **T020** `[P]` `[US1]` Screen: Surface survey & landing → `src/ui/screens/Survey.tsx` (`aic-8tl.2`)
- [ ] **T021** `[P]` `[US4]` Screen: Colony operations → `src/ui/screens/Colony.tsx` (`aic-8tl.3`)
- [ ] **T022** `[P]` `[US3]` Screen: Cycle report → `src/ui/screens/CycleReport.tsx` (`aic-8tl.4`)

## Phase 6 — Balance, persistence, ship

- [ ] **T023** `[P]` Headless scenario runner → `src/sim/scenario.ts` (`aic-to6.2`)
- [ ] **T024** Balance pass over durations/power/deadline → `src/sim/config/` (`aic-to6.1`)
- [ ] **T025** `[P]` Deterministic save/load → `src/sim/persist.ts` (`aic-n3q.1`)
- [ ] **T026** `[P]` Grid render perf budget (`aic-n3q.2`)
- [ ] **T027** `[P]` CI + deploy pipeline → `.github/workflows/` (`aic-n3q.3`)
