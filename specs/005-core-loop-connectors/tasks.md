# Tasks — Core Game Loop & Connectors

`[P]` = parallelisable (disjoint files). TDD mandatory. Seam test required for any pair
built in separate worktrees (`.claude/rules/03-testing.md`).

## Phase 1 — Foundational connectors

- [ ] **T001** `[P]` `[US1]` `ColonyState` — the single thing a turn transforms: world, grid, structures with build progress, drone roster, stockpiles, turn index, mission config. Serialisable, immutable-by-copy → `src/sim/state.ts`
- [ ] **T002** `[P]` `[US2]` Reactor identity + data-driven generation; `REACTOR_OUTPUT_KW` stops being a code constant (audit E1/E2) → `src/sim/generation.ts`
- [ ] **T003** `[P]` `[US1]` Player orders: queue / cancel, validated, typed rejections, never throws for player error → `src/sim/orders.ts`
- [ ] **T004** `[US2]` Retire `power.ts`'s allocator; delegate ordering to `brownout.ts`. `computePowerBudget` survives; `power-drones.test.ts` must pass **unchanged**. Add an explicit **monotonicity** test. *(gated on `aic-9ol`)* → `src/sim/power.ts`
- [ ] **T005** `[US2]` Binary idle: a shed/unpowered consumer contributes no flow (audit B2) *(gated on `aic-96o`)* → `src/sim/ledger.ts`
- [ ] **T006** `[US5]` Fix float accumulation in construction progress (audit C1) — integer labour-units, no floor-with-no-epsilon across hundreds of turns → `src/sim/construction.ts`

## Phase 2 — The resolver (NOT parallelised — this is the cycle)

- [ ] **T007** `[US1]` `resolveTurn(state, orders) → { state, report }` composing steps 1–11. **Freeze the operational set at step 2**; assert a structure completed on turn N draws no power on turn N → `src/sim/resolve.ts`
- [ ] **T008** `[US4]` `CycleReport`: completions, shed ids **with cut line and rationale**, shortfalls, labour applied vs wasted, capacity, turns remaining → `src/sim/report.ts`
- [ ] **T009** `[US1]` Seam test: resolver ↔ every subsystem — proves each is genuinely called in production, not merely importable → `tests/integration/resolve-seam.test.ts`

## Phase 3 — Bootstrap the game

- [ ] **T010** `[P]` `[US3]` Landing → turn-0 `ColonyState`: hulls as pre-built structures, starting drones and reactors from the surviving holds, lost ship reflected as absent (audit E3) → `src/sim/bootstrap.ts`
- [ ] **T011** `[P]` `[US3]` Seam test: `generateWorld` → `evaluateLanding` → `bootstrap` → `resolveTurn` — the whole opening, end to end → `tests/integration/bootstrap-seam.test.ts`

## Phase 4 — Proof

- [ ] **T012** `[US5]` Golden trace over a multi-turn scenario using the existing `turn-harness.ts`; divergence names the exact turn and field → `tests/integration/golden-trace.test.ts`
- [ ] **T013** `[US5]` Headless full-mission runner; a complete **278-turn** mission reproduces identically → `src/sim/scenario.ts`
- [ ] **T014** `[US1]` Zero-production-consumer sweep as an automated architecture test — the detector that found `aic-c1p` and `aic-8eq`, made permanent → `tests/unit/no-islands.test.ts`
