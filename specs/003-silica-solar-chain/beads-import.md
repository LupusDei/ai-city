# Silica & Solar — the Photovoltaic Chain · Beads

**Feature**: `003-silica-solar-chain`
**Generated**: 2026-07-30
**Source**: `specs/003-silica-solar-chain/tasks.md`
**Beads prefix**: `aic-`

> `aic-sfq` and its `.N[.M]` children are **placeholder tokens**. Substitute the real bead IDs
> after creation. Existing beads (`aic-c75`, `aic-m3t`, `aic-c1p`, `aic-wuo`, `aic-5ub`) are real and
> MUST NOT be re-created — they are referenced only as dependencies.

## Root Epic

- **ID**: `aic-sfq`
- **Title**: Silica & Solar — the Photovoltaic Chain
- **Type**: epic
- **Priority**: 1
- **Description**: Resource chain 2 of 3. Silica Sifter → Silicon Furnace → Photovoltaic Array,
  delivering the game's first energy-return-on-investment decision: a 41-turn energy payback out of
  278 turns, so an array is obviously correct on turn 20 and obviously a trap on turn 250. The
  payback is scale-invariant (identical at 5 m, 7.5 m and 10 m tiles) because silicon cost and energy
  yield both scale with panel area and the area cancels — it is a property of real physics, not of
  our grid. Post-MVP-loop increment. Batteries and intra-turn day/night modelling are explicit
  non-goals. TDD mandatory; integer base units (watt-hours, grams); binary idle on short power;
  sim-only, zero React imports.

## Epics

### Phase 1 — Foundational: resource kinds, catalog rows, deposit siting, storage caps
- **ID**: `aic-sfq.1`
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, US2, US3, US4
- **Blocked by**: `aic-c75`, `aic-5ub`
- **Tasks**: 5

### Phase 2 — US1: Silica Sifter
- **ID**: `aic-sfq.2`
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Blocked by**: `aic-sfq.1`, `aic-m3t` (hard blocker — `MineralDeposit` has no resource
  kind), `aic-c1p` (P0: deposits generated but never consumed)
- **Tasks**: 4

### Phase 3 — US2: Silicon Furnace
- **ID**: `aic-sfq.3`
- **Type**: epic
- **Priority**: 1
- **Blocked by**: `aic-sfq.2` (the Furnace needs SiO₂ from the Sifter)
- **Tasks**: 4

### Phase 4 — US3: Photovoltaic Array + payback readout
- **ID**: `aic-sfq.4`
- **Type**: epic
- **Priority**: 1
- **Blocked by**: `aic-sfq.3` (the array needs Si from the Furnace), `aic-wuo` (5 m tile scale)
- **Tasks**: 5

### Phase 5 — US4: Dust deposition + global dust storms
- **ID**: `aic-sfq.5`
- **Type**: epic
- **Priority**: 2
- **Blocked by**: `aic-sfq.4` (there must be an array to soil and storm)
- **Tasks**: 5

### Phase 6 — Polish: report lines, cleaning orders, balance hooks
- **ID**: `aic-sfq.6`
- **Type**: epic
- **Priority**: 3
- **Blocked by**: `aic-sfq.5`
- **Tasks**: 3

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Resource kinds + integer base-unit helpers | `src/sim/resources.ts`, `tests/unit/resources.test.ts` | `aic-sfq.1.1` |
| T002 | Ratified solar derivation constants | `src/sim/solar.ts`, `tests/unit/solar.test.ts` | `aic-sfq.1.2` |
| T003 | Three catalog rows as pure DATA | `src/sim/silicaChain.ts`, `tests/unit/silicaChain.test.ts` | `aic-sfq.1.3` |
| T004 | Deposit-gated siting validation | `src/sim/siting.ts`, `tests/unit/siting.test.ts` | `aic-sfq.1.4` |
| T005 | Stockpile caps + overflow reporting | `src/sim/storage.ts`, `tests/unit/storage.test.ts` | `aic-sfq.1.5` |

### Phase 2 — US1: Silica Sifter

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Production flow pipeline with completeness gate | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-sfq.2.1` |
| T007 | Sifter deposit-gated siting integration | `src/sim/siting.ts`, `tests/unit/siting.test.ts` | `aic-sfq.2.2` |
| T008 | Deposit exhaustion during and after build | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-sfq.2.3` |
| T009 | Sifter cap overflow surfaced, never dropped | `src/sim/storage.ts`, `tests/unit/storage.test.ts` | `aic-sfq.2.4` |

### Phase 3 — US2: Silicon Furnace

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T010 | Brownout total order + tie-break by instance id | `src/sim/brownout.ts`, `tests/unit/brownout.test.ts` | `aic-sfq.3.1` |
| T011 | Furnace SiO₂ → Si conversion | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-sfq.3.2` |
| T012 | Binary idle — never fractional throughput | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-sfq.3.3` |
| T013 | 80× over-feed + 110%-of-a-reactor integration test | `tests/integration/silica-chain.test.ts` | `aic-sfq.3.4` |

### Phase 4 — US3: Photovoltaic Array + payback readout

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T014 | One-time `buildCost` debit at commit | `src/sim/buildcost.ts`, `tests/unit/buildcost.test.ts` | `aic-sfq.4.1` |
| T015 | Exact-20 kg / one-gram-short / empty boundaries | `tests/unit/buildcost.test.ts` | `aic-sfq.4.2` |
| T016 | Array output zero until complete | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-sfq.4.3` |
| T017 | Payback readout: turns vs turns-remaining + verdict | `src/sim/solar.ts`, `tests/unit/solar.test.ts` | `aic-sfq.4.4` |
| T018 | Scale-invariance proof (5 m / 7.5 m / 10 m) | `tests/unit/solar.test.ts` | `aic-sfq.4.5` |

### Phase 5 — US4: Dust deposition + global dust storms

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T019 | Soiling decay in basis points, 60% cumulative cap | `src/sim/soiling.ts`, `tests/unit/soiling.test.ts` | `aic-sfq.5.1` |
| T020 | Storm schedule drawn at world-gen from terrain seed | `src/sim/storms.ts`, `tests/unit/storms.test.ts` | `aic-sfq.5.2` |
| T021 | Soiling × storm composition, arrays only | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-sfq.5.3` |
| T022 | Storm interval edge cases (mid-build, overlap, same-turn) | `tests/unit/storms.test.ts` | `aic-sfq.5.4` |
| T023 | Seeded determinism acceptance test | `tests/integration/determinism-storms.test.ts` | `aic-sfq.5.5` |

### Phase 6 — Polish: Cross-Cutting

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T024 | Chain cycle-report lines | `src/sim/cycleReport.ts`, `tests/unit/cycleReport.test.ts` | `aic-sfq.6.1` |
| T025 | Cleaning orders as a drone-hour labour tax | `src/sim/soiling.ts`, `tests/unit/soiling.test.ts` | `aic-sfq.6.2` |
| T026 | Balance hooks doc + boundary/coverage gate | `docs/balance/silica-solar.md`, `tests/unit/boundary.test.ts` | `aic-sfq.6.3` |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 5 | 1 | `aic-sfq.1` |
| 2: US1 Silica Sifter (MVP) | 4 | 1 | `aic-sfq.2` |
| 3: US2 Silicon Furnace | 4 | 1 | `aic-sfq.3` |
| 4: US3 PV Array + payback readout | 5 | 1 | `aic-sfq.4` |
| 5: US4 Dust + storms | 5 | 2 | `aic-sfq.5` |
| 6: Polish | 3 | 3 | `aic-sfq.6` |
| **Total** | **26** | | |

## Dependency Graph

```
aic-c75, aic-5ub
      |
Phase 1: Foundational (aic-sfq.1)
      |
      +-- aic-m3t (HARD BLOCKER), aic-c1p (P0 seam bug)
      |
Phase 2: US1 Silica Sifter (aic-sfq.2, MVP)
      |
Phase 3: US2 Silicon Furnace (aic-sfq.3)
      |
      +-- aic-wuo (5 m tile scale)
      |
Phase 4: US3 PV Array + payback readout (aic-sfq.4)
      |
Phase 5: US4 Dust + storms (aic-sfq.5)
      |
Phase 6: Polish (aic-sfq.6)
```

Phases are a **total order**, not a fan-out: the chain is sequential by resource flow (the Furnace
needs SiO₂ from the Sifter, the array needs Si from the Furnace), so US1–US3 cannot be parallelised.
Parallelism exists only *within* phases — see `tasks.md` "Parallel Opportunities".

## Dependency List (executable)

Format: `DEP <blocked-bead> <blocking-bead>`

```
DEP aic-sfq aic-c75
DEP aic-sfq.1 aic-c75
DEP aic-sfq.1 aic-5ub
DEP aic-sfq.2 aic-m3t
DEP aic-sfq.2 aic-c1p
DEP aic-sfq.4 aic-wuo
DEP aic-sfq aic-sfq.1
DEP aic-sfq aic-sfq.2
DEP aic-sfq aic-sfq.3
DEP aic-sfq aic-sfq.4
DEP aic-sfq aic-sfq.5
DEP aic-sfq aic-sfq.6
DEP aic-sfq.2 aic-sfq.1
DEP aic-sfq.3 aic-sfq.2
DEP aic-sfq.4 aic-sfq.3
DEP aic-sfq.5 aic-sfq.4
DEP aic-sfq.6 aic-sfq.5
DEP aic-sfq.1 aic-sfq.1.1
DEP aic-sfq.1 aic-sfq.1.2
DEP aic-sfq.1 aic-sfq.1.3
DEP aic-sfq.1 aic-sfq.1.4
DEP aic-sfq.1 aic-sfq.1.5
DEP aic-sfq.2 aic-sfq.2.1
DEP aic-sfq.2 aic-sfq.2.2
DEP aic-sfq.2 aic-sfq.2.3
DEP aic-sfq.2 aic-sfq.2.4
DEP aic-sfq.3 aic-sfq.3.1
DEP aic-sfq.3 aic-sfq.3.2
DEP aic-sfq.3 aic-sfq.3.3
DEP aic-sfq.3 aic-sfq.3.4
DEP aic-sfq.4 aic-sfq.4.1
DEP aic-sfq.4 aic-sfq.4.2
DEP aic-sfq.4 aic-sfq.4.3
DEP aic-sfq.4 aic-sfq.4.4
DEP aic-sfq.4 aic-sfq.4.5
DEP aic-sfq.5 aic-sfq.5.1
DEP aic-sfq.5 aic-sfq.5.2
DEP aic-sfq.5 aic-sfq.5.3
DEP aic-sfq.5 aic-sfq.5.4
DEP aic-sfq.5 aic-sfq.5.5
DEP aic-sfq.6 aic-sfq.6.1
DEP aic-sfq.6 aic-sfq.6.2
DEP aic-sfq.6 aic-sfq.6.3
DEP aic-sfq.1.3 aic-sfq.1.1
DEP aic-sfq.1.3 aic-sfq.1.2
DEP aic-sfq.2.2 aic-sfq.2.1
DEP aic-sfq.2.3 aic-sfq.2.1
DEP aic-sfq.2.4 aic-sfq.2.1
DEP aic-sfq.3.2 aic-sfq.3.1
DEP aic-sfq.3.3 aic-sfq.3.1
DEP aic-sfq.3.4 aic-sfq.3.2
DEP aic-sfq.3.4 aic-sfq.3.3
DEP aic-sfq.4.2 aic-sfq.4.1
DEP aic-sfq.4.4 aic-sfq.1.2
DEP aic-sfq.4.4 aic-sfq.4.3
DEP aic-sfq.4.5 aic-sfq.4.4
DEP aic-sfq.5.3 aic-sfq.5.1
DEP aic-sfq.5.3 aic-sfq.5.2
DEP aic-sfq.5.4 aic-sfq.5.2
DEP aic-sfq.5.5 aic-sfq.5.3
DEP aic-sfq.5.5 aic-sfq.5.4
```

**61 dependency edges**: 6 external (never re-create those beads), 6 root←phase, 5 phase chain,
26 phase←task, 18 within-phase task edges.

## Improvements

Improvements (Level 4: `aic-sfq.N.M.P`) are NOT pre-planned here. They are created during
implementation when bugs, refactors, or extra tests are discovered.
