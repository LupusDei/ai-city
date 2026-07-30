# Regolith & the Shielded Habitat — Beads

**Feature**: `002-regolith-shield-chain`
**Generated**: 2026-07-30
**Source**: `specs/002-regolith-shield-chain/tasks.md`
**Beads prefix**: `aic-`

> Root epic ID appears throughout as the placeholder token `aic-d8y`. Substitute the real
> bead ID after creation; children follow as `aic-d8y.1`, `aic-d8y.2.3`, etc.

## Root Epic

- **ID**: `aic-d8y`
- **Title**: Regolith & the Shielded Habitat (Resource Chain 1 of 3)
- **Type**: epic
- **Priority**: 1
- **Description**: One acquisition utility (Regolith Hopper), one assembly line (Sinter Press)
  and one structure (Shield Berm) — added as catalog data — used to make the win condition
  honest: an unshielded habitat contributes ZERO to habitat readiness. Readiness becomes a
  two-factor test (built AND rated). **Post-MVP-loop increment**: ships after the core
  electricity/labour loop is proven fun; must not be scheduled against it.

## Epics

### Phase 1 — Foundational: resource kinds, catalog entries, capped stockpile, brownout order
- **ID**: `aic-d8y.1`
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, US2, US3
- **Blocked by**: `aic-5ub` (ledger integer base units)
- **Tasks**: 4

### Phase 2 — US1: Extract regolith
- **ID**: `aic-d8y.2`
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 3 — US2: Sinter plate
- **ID**: `aic-d8y.3`
- **Type**: epic
- **Priority**: 1
- **Tasks**: 4

### Phase 4 — US3: Shield Berm and the rated-habitat rule
- **ID**: `aic-d8y.4`
- **Type**: epic
- **Priority**: 1
- **Payoff**: true
- **Blocked by**: `aic-wuo` (tile scale = 5 m)
- **Tasks**: 6

### Phase 5 — Polish: Cross-Cutting
- **ID**: `aic-d8y.5`
- **Type**: epic
- **Priority**: 2
- **Depends**: US1, US2, US3
- **Tasks**: 3

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Resource-kind registry with integer base units | `src/sim/resources.ts`, `tests/unit/resources.test.ts` | `aic-d8y.1.1` |
| T002 | Three structure entries as catalog data | `src/sim/catalog-data.ts`, `tests/unit/catalog-data.test.ts` | `aic-d8y.1.2` |
| T003 | Capped stockpile with cap-and-report overflow | `src/sim/stockpile.ts`, `tests/unit/stockpile.test.ts` | `aic-d8y.1.3` |
| T004 | Brownout priority as a documented total order | `src/sim/power.ts`, `tests/unit/power-brownout.test.ts` | `aic-d8y.1.4` |

### Phase 2 — US1: Extract regolith

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T005 | Per-turn production resolution | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-d8y.2.1` |
| T006 | Hopper binary idle under brownout | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-d8y.2.2` |
| T007 | Overflow cap-and-report on a full pile | `src/sim/production.ts`, `tests/unit/production.test.ts` | `aic-d8y.2.3` |
| T008 | US1 integration: extraction over many turns | `tests/integration/regolith-extraction.test.ts` | `aic-d8y.2.4` |

### Phase 3 — US2: Sinter plate

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Press regolith → plate conversion | `src/sim/production.ts`, `tests/unit/sinter.test.ts` | `aic-d8y.3.1` |
| T010 | Input-starvation binary idle | `src/sim/production.ts`, `tests/unit/sinter.test.ts` | `aic-d8y.3.2` |
| T011 | Power-starvation binary idle for the Press | `src/sim/power.ts`, `tests/unit/power-brownout.test.ts` | `aic-d8y.3.3` |
| T012 | US2 integration: the 40× over-feed | `tests/integration/regolith-chain.test.ts` | `aic-d8y.3.4` |

### Phase 4 — US3: Shield Berm and the rated-habitat rule

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T013 | Tile-edge constant and areal berm-cost derivation | `src/sim/scale.ts`, `tests/unit/scale.test.ts` | `aic-d8y.4.1` |
| T014 | Berm material accumulation across turns | `src/sim/berm.ts`, `tests/unit/berm.test.ts` | `aic-d8y.4.2` |
| T015 | Berm application rules and rating attachment | `src/sim/berm.ts`, `tests/unit/berm-rating.test.ts` | `aic-d8y.4.3` |
| T016 | Two-factor readiness (built AND rated) | `src/sim/mission.ts`, `tests/unit/mission.test.ts` | `aic-d8y.4.4` |
| T017 | Demolition/overwrite invalidates rating | `src/sim/berm.ts`, `tests/unit/berm-demolition.test.ts` | `aic-d8y.4.5` |
| T018 | US3 integration: shielded readiness end to end | `tests/integration/shield-readiness.test.ts` | `aic-d8y.4.6` |

### Phase 5 — Polish: Cross-Cutting

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T019 | Cycle-report lines for berm/starvation/overflow | `src/sim/cycle-report.ts`, `tests/unit/cycle-report.test.ts` | `aic-d8y.5.1` |
| T020 | UI readouts (stockpile, berm progress, rated badge) | `src/ui/`, `tests/unit/ui-readouts.test.ts` | `aic-d8y.5.2` |
| T021 | Balance hooks for the balance pass | `src/sim/balance.ts`, `tests/unit/balance.test.ts` | `aic-d8y.5.3` |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 4 | 1 | `aic-d8y.1` |
| 2: US1 — Extract regolith | 4 | 1 | `aic-d8y.2` |
| 3: US2 — Sinter plate | 4 | 1 | `aic-d8y.3` |
| 4: US3 — Shield Berm & rated habitat (payoff) | 6 | 1 | `aic-d8y.4` |
| 5: Polish | 3 | 2 | `aic-d8y.5` |
| **Total** | **21** | | |

## Dependency Graph

```
        aic-c75 (shared foundation) ──blocks──> aic-d8y (whole feature)
        aic-5ub (integer units) ─────blocks──> Phase 1
        aic-wuo (5 m tile) ──────────blocks──> Phase 4

Phase 1: Foundational (aic-d8y.1)
    |
Phase 2: US1 Extract regolith (aic-d8y.2)
    |
Phase 3: US2 Sinter plate (aic-d8y.3)
    |
Phase 4: US3 Shield Berm & rated habitat (aic-d8y.4)  [the payoff]
    |
Phase 5: Polish (aic-d8y.5)
```

The chain is genuinely sequential — dig, sinter, bury — so Phases 2–4 do not run in parallel.

## Dependency List (executable, one per line)

Format: `DEP <blocked-bead> <blocking-bead>`

```
DEP aic-d8y aic-c75
DEP aic-d8y.1 aic-5ub
DEP aic-d8y.4 aic-wuo
DEP aic-d8y aic-d8y.1
DEP aic-d8y aic-d8y.2
DEP aic-d8y aic-d8y.3
DEP aic-d8y aic-d8y.4
DEP aic-d8y aic-d8y.5
DEP aic-d8y.1 aic-d8y.1.1
DEP aic-d8y.1 aic-d8y.1.2
DEP aic-d8y.1 aic-d8y.1.3
DEP aic-d8y.1 aic-d8y.1.4
DEP aic-d8y.2 aic-d8y.2.1
DEP aic-d8y.2 aic-d8y.2.2
DEP aic-d8y.2 aic-d8y.2.3
DEP aic-d8y.2 aic-d8y.2.4
DEP aic-d8y.3 aic-d8y.3.1
DEP aic-d8y.3 aic-d8y.3.2
DEP aic-d8y.3 aic-d8y.3.3
DEP aic-d8y.3 aic-d8y.3.4
DEP aic-d8y.4 aic-d8y.4.1
DEP aic-d8y.4 aic-d8y.4.2
DEP aic-d8y.4 aic-d8y.4.3
DEP aic-d8y.4 aic-d8y.4.4
DEP aic-d8y.4 aic-d8y.4.5
DEP aic-d8y.4 aic-d8y.4.6
DEP aic-d8y.5 aic-d8y.5.1
DEP aic-d8y.5 aic-d8y.5.2
DEP aic-d8y.5 aic-d8y.5.3
DEP aic-d8y.2 aic-d8y.1
DEP aic-d8y.3 aic-d8y.1
DEP aic-d8y.4 aic-d8y.1
DEP aic-d8y.3 aic-d8y.2
DEP aic-d8y.4 aic-d8y.3
DEP aic-d8y.5 aic-d8y.2
DEP aic-d8y.5 aic-d8y.3
DEP aic-d8y.5 aic-d8y.4
DEP aic-d8y.1.2 aic-d8y.1.1
DEP aic-d8y.1.3 aic-d8y.1.1
DEP aic-d8y.1.4 aic-d8y.1.2
DEP aic-d8y.2.1 aic-d8y.1.2
DEP aic-d8y.2.1 aic-d8y.1.3
DEP aic-d8y.2.2 aic-d8y.1.4
DEP aic-d8y.2.3 aic-d8y.2.1
DEP aic-d8y.2.4 aic-d8y.2.1
DEP aic-d8y.2.4 aic-d8y.2.2
DEP aic-d8y.2.4 aic-d8y.2.3
DEP aic-d8y.3.1 aic-d8y.2.1
DEP aic-d8y.3.2 aic-d8y.3.1
DEP aic-d8y.3.3 aic-d8y.2.2
DEP aic-d8y.3.4 aic-d8y.3.1
DEP aic-d8y.3.4 aic-d8y.3.2
DEP aic-d8y.3.4 aic-d8y.2.3
DEP aic-d8y.4.1 aic-d8y.1.2
DEP aic-d8y.4.2 aic-d8y.4.1
DEP aic-d8y.4.2 aic-d8y.1.3
DEP aic-d8y.4.3 aic-d8y.4.2
DEP aic-d8y.4.4 aic-d8y.4.3
DEP aic-d8y.4.5 aic-d8y.4.3
DEP aic-d8y.4.6 aic-d8y.4.4
DEP aic-d8y.4.6 aic-d8y.4.5
DEP aic-d8y.4.6 aic-d8y.3.1
DEP aic-d8y.5.1 aic-d8y.4.2
DEP aic-d8y.5.1 aic-d8y.3.2
DEP aic-d8y.5.1 aic-d8y.2.3
DEP aic-d8y.5.2 aic-d8y.5.1
DEP aic-d8y.5.3 aic-d8y.4.1
```

**Do not create** beads for `aic-c75`, `aic-wuo`, `aic-5ub` — they already exist. `aic-m3t`
(typed deposits) is deliberately **not** a dependency: regolith needs no deposit.

## Improvements

Improvements (Level 4: `aic-d8y.N.M.P`) are NOT pre-planned here. They are created during
implementation when bugs, refactors, or extra tests are discovered.
