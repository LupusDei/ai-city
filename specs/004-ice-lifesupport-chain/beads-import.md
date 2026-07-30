# Ice, Air & the Provisioned Habitat (Resource Chain 3 of 3) — Beads

**Feature**: `004-ice-lifesupport-chain`
**Generated**: 2026-07-30
**Source**: `specs/004-ice-lifesupport-chain/tasks.md`
**Beads prefix**: `aic-`

> Placeholder IDs below (`aic-85z`, `aic-85z.1`, `aic-85z.2.3`, …) are literal
> tokens. The team lead substitutes real `aic-` IDs after bead creation. **No `bd` commands
> were run by the author of these artifacts** — bead creation is centralised to avoid
> database contention.

## Root Epic

- **ID**: `aic-85z`
- **Title**: Ice, Air & the Provisioned Habitat (Resource Chain 3 of 3)
- **Type**: epic
- **Priority**: 2
- **Description**: Adds the third factor of habitat readiness — **provisioned** — and the
  game's first STORED (rather than flowed) resource. Ice Auger → Electrolysis Stack → Life
  Support Reserve turns a latitude-gated shallow-ice deposit into banked oxygen and water; a
  habitat counts toward the win condition only once its margin is banked, re-checked every
  evaluation. Load-bearing engineering: capped storage, the reconciliation invariant that no
  resource leaves the simulation without a cycle-report line, and a real sink for the 23 kg
  of hydrogen per turn the MVP has nothing to do with. Latitude makes chains 2 and 3 pull the
  landing site in opposite directions. **Post-MVP-loop increment.** Sabatier/methane and
  MOXIE atmospheric O₂ are explicitly out of scope (§8); MOXIE is the recommended next
  feature. Scale-invariant — does **not** depend on `aic-wuo` (tile scale).

## Epics

### Phase 1 — Foundational: resources, capped storage, the ledger invariant
- **ID**: `aic-85z.1`
- **Type**: epic
- **Priority**: 1
- **Blocks**: US1, US2, US3, US4 (all phases)
- **Blocked by**: `aic-c75`, `aic-5ub`
- **Tasks**: 6

### Phase 2 — US1: Ice Auger, ice-deposit-gated (P1)
- **ID**: `aic-85z.2`
- **Type**: epic
- **Priority**: 1
- **MVP**: true (first shippable slice of this feature)
- **Blocked by**: `aic-85z.1`, `aic-m3t` (HARD), `aic-c1p`
- **Tasks**: 4

### Phase 3 — US2: Electrolysis Stack + the hydrogen sink (P1)
- **ID**: `aic-85z.3`
- **Type**: epic
- **Priority**: 1
- **Blocked by**: `aic-85z.1`, `aic-85z.2`
- **Tasks**: 4

### Phase 4 — US3: Life Support Reserve + provisioned readiness (P1)
- **ID**: `aic-85z.4`
- **Type**: epic
- **Priority**: 1
- **Blocked by**: `aic-85z.1`, `aic-85z.3`
- **Tasks**: 5

### Phase 5 — US4: latitude — ice poleward, sun equatorial (P2)
- **ID**: `aic-85z.5`
- **Type**: epic
- **Priority**: 2
- **Blocked by**: `aic-85z.1`, `aic-85z.2`, `aic-m3t` (HARD), `aic-c1p`
- **Tasks**: 3

### Phase 6 — Polish: reports, readouts, balance hooks (P3)
- **ID**: `aic-85z.6`
- **Type**: epic
- **Priority**: 3
- **Depends**: US2, US3, US4
- **Tasks**: 3

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Resource kinds + integer base units (grams, watt-hours) | `src/sim/resources.ts`, `tests/unit/resources.test.ts` | `aic-85z.1.1` |
| T002 | Catalog validation: integer units, `storageCapacity`, `siting` | `src/sim/catalog.ts`, `tests/unit/catalog.test.ts` | `aic-85z.1.2` |
| T003 | Capped stockpile application + `Overflow` accounting | `src/sim/storage.ts`, `tests/unit/storage.test.ts` | `aic-85z.1.3` |
| T004 | Cycle-report channel, deterministically ordered | `src/sim/report.ts`, `tests/unit/report.test.ts` | `aic-85z.1.4` |
| T005 | The three catalog entries, as DATA | `src/sim/icechain.ts`, `tests/unit/icechain.test.ts` | `aic-85z.1.5` |
| T006 | Reconciliation invariant: nothing destroyed silently | `src/sim/storage.ts`, `src/sim/report.ts`, `tests/unit/storage.test.ts` | `aic-85z.1.6` |

### Phase 2 — US1: Ice Auger

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | `deposit-required` placement rejection | `src/sim/placement.ts`, `tests/unit/placement.test.ts` | `aic-85z.2.1` |
| T008 | Auger per-turn water yield, energy-derived | `src/sim/icechain.ts`, `tests/unit/icechain.test.ts` | `aic-85z.2.2` |
| T009 | Deposit depletion + exhausted-mid-build | `src/sim/icechain.ts`, `tests/unit/icechain.test.ts` | `aic-85z.2.3` |
| T010 | Integration: auger water into capped storage | `tests/integration/ice-auger.test.ts` | `aic-85z.2.4` |

### Phase 3 — US2: Electrolysis Stack + the hydrogen sink

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T011 | Stoichiometry + throughput, mass-exact by subtraction | `src/sim/icechain.ts`, `tests/unit/icechain.test.ts` | `aic-85z.3.1` |
| T012 | Hydrogen capped tank + vent on overflow | `src/sim/storage.ts`, `tests/unit/storage.test.ts` | `aic-85z.3.2` |
| T013 | Vent/overflow report lines always emitted | `src/sim/report.ts`, `tests/unit/report.test.ts` | `aic-85z.3.3` |
| T014 | Binary idle on short water or short power | `src/sim/icechain.ts`, `tests/unit/icechain.test.ts` | `aic-85z.3.4` |

### Phase 4 — US3: Life Support Reserve + provisioned readiness

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T015 | Provisioning bill (per-colonist margins) | `src/sim/provisioning.ts`, `tests/unit/provisioning.test.ts` | `aic-85z.4.1` |
| T016 | Allocation in placement order, never spread thin | `src/sim/provisioning.ts`, `tests/unit/provisioning.test.ts` | `aic-85z.4.2` |
| T017 | Three-factor readiness, recomputed every call | `src/sim/mission.ts`, `tests/unit/mission.test.ts` | `aic-85z.4.3` |
| T018 | Reserve's 6 kW position in the brownout TOTAL order | `src/sim/brownout.ts`, `tests/unit/brownout.test.ts` | `aic-85z.4.4` |
| T019 | Integration: readiness falls back when a tank drains | `tests/integration/provisioned-readiness.test.ts` | `aic-85z.4.5` |

### Phase 5 — US4: latitude — ice poleward, sun equatorial

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T020 | Ice-availability + insolation curves by latitude | `src/sim/latitude.ts`, `tests/unit/latitude.test.ts` | `aic-85z.5.1` |
| T021 | Ice deposit generation gated on latitude | `src/sim/buildability.ts`, `tests/unit/buildability.test.ts` | `aic-85z.5.2` |
| T022 | Ice + insolation as separate site-score components | `src/sim/landing.ts`, `tests/unit/landing.test.ts` | `aic-85z.5.3` |

### Phase 6 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T023 | Provisioning readout + full cycle-report surface | `src/sim/report.ts`, `tests/unit/report.test.ts` | `aic-85z.6.1` |
| T024 | 50-turn byte-identical replay determinism | `tests/integration/ledger-determinism.test.ts` | `aic-85z.6.2` |
| T025 | Balance hooks as named constants + boundary/coverage gate | `src/sim/icechain.ts`, `src/sim/provisioning.ts`, `src/sim/latitude.ts`, `tests/unit/boundary.test.ts` | `aic-85z.6.3` |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 6 | 1 | `aic-85z.1` |
| 2: US1 Ice Auger (MVP slice) | 4 | 1 | `aic-85z.2` |
| 3: US2 Electrolysis Stack + H₂ sink | 4 | 1 | `aic-85z.3` |
| 4: US3 Reserve + provisioned readiness | 5 | 1 | `aic-85z.4` |
| 5: US4 Latitude tension | 3 | 2 | `aic-85z.5` |
| 6: Polish | 3 | 3 | `aic-85z.6` |
| **Total** | **25** | | |

## Dependency Graph

```
aic-c75 (shared foundation) ──┐
aic-5ub (ledger integers) ────┤
                              ▼
                    Phase 1: Foundational (aic-85z.1)
                              │
        ┌─────────────────────┴──────────────────────┐
        ▼                                            │
aic-m3t (typed deposits + latitude) ──┐              │
aic-c1p (deposit/landing wiring) ─────┤              │
                                      ▼              │
                     Phase 2: US1 Ice Auger (.2)     │
                              │                      │
              ┌───────────────┴───────────────┐      │
              ▼                               ▼      ▼
   Phase 3: US2 Stack (.3)          Phase 5: US4 Latitude (.5)
              │                               │   [parallel track]
              ▼                               │
   Phase 4: US3 Provisioned (.4)              │
              │                               │
              └───────────────┬───────────────┘
                              ▼
                    Phase 6: Polish (.6)

aic-wuo (tile scale) ──✗── NOT a dependency: chain is scale-invariant
```

## Explicit Dependency List (executable)

Format: `DEP <blocked-bead> <blocking-bead>` — one per line. Substitute real IDs for the
`aic-85z*` placeholders before running.

```
DEP aic-85z aic-c75
DEP aic-85z aic-85z.1
DEP aic-85z aic-85z.2
DEP aic-85z aic-85z.3
DEP aic-85z aic-85z.4
DEP aic-85z aic-85z.5
DEP aic-85z aic-85z.6
DEP aic-85z.1 aic-c75
DEP aic-85z.1 aic-5ub
DEP aic-85z.1 aic-85z.1.1
DEP aic-85z.1 aic-85z.1.2
DEP aic-85z.1 aic-85z.1.3
DEP aic-85z.1 aic-85z.1.4
DEP aic-85z.1 aic-85z.1.5
DEP aic-85z.1 aic-85z.1.6
DEP aic-85z.1.2 aic-85z.1.1
DEP aic-85z.1.3 aic-85z.1.1
DEP aic-85z.1.4 aic-85z.1.1
DEP aic-85z.1.5 aic-85z.1.1
DEP aic-85z.1.5 aic-85z.1.2
DEP aic-85z.1.6 aic-85z.1.3
DEP aic-85z.1.6 aic-85z.1.4
DEP aic-85z.2 aic-85z.1
DEP aic-85z.2 aic-m3t
DEP aic-85z.2 aic-c1p
DEP aic-85z.2 aic-85z.2.1
DEP aic-85z.2 aic-85z.2.2
DEP aic-85z.2 aic-85z.2.3
DEP aic-85z.2 aic-85z.2.4
DEP aic-85z.2.1 aic-85z.1.5
DEP aic-85z.2.1 aic-m3t
DEP aic-85z.2.2 aic-85z.1.5
DEP aic-85z.2.3 aic-85z.2.1
DEP aic-85z.2.3 aic-85z.2.2
DEP aic-85z.2.4 aic-85z.2.3
DEP aic-85z.2.4 aic-85z.1.6
DEP aic-85z.3 aic-85z.1
DEP aic-85z.3 aic-85z.2
DEP aic-85z.3 aic-85z.3.1
DEP aic-85z.3 aic-85z.3.2
DEP aic-85z.3 aic-85z.3.3
DEP aic-85z.3 aic-85z.3.4
DEP aic-85z.3.1 aic-85z.2.2
DEP aic-85z.3.2 aic-85z.3.1
DEP aic-85z.3.2 aic-85z.1.3
DEP aic-85z.3.3 aic-85z.3.2
DEP aic-85z.3.3 aic-85z.1.4
DEP aic-85z.3.4 aic-85z.3.1
DEP aic-85z.4 aic-85z.1
DEP aic-85z.4 aic-85z.3
DEP aic-85z.4 aic-85z.4.1
DEP aic-85z.4 aic-85z.4.2
DEP aic-85z.4 aic-85z.4.3
DEP aic-85z.4 aic-85z.4.4
DEP aic-85z.4 aic-85z.4.5
DEP aic-85z.4.1 aic-85z.3.1
DEP aic-85z.4.2 aic-85z.4.1
DEP aic-85z.4.3 aic-85z.4.2
DEP aic-85z.4.4 aic-85z.3.4
DEP aic-85z.4.4 aic-c75
DEP aic-85z.4.5 aic-85z.4.3
DEP aic-85z.5 aic-85z.1
DEP aic-85z.5 aic-85z.2
DEP aic-85z.5 aic-m3t
DEP aic-85z.5 aic-c1p
DEP aic-85z.5 aic-85z.5.1
DEP aic-85z.5 aic-85z.5.2
DEP aic-85z.5 aic-85z.5.3
DEP aic-85z.5.1 aic-m3t
DEP aic-85z.5.2 aic-85z.5.1
DEP aic-85z.5.2 aic-m3t
DEP aic-85z.5.3 aic-85z.5.1
DEP aic-85z.5.3 aic-85z.5.2
DEP aic-85z.5.3 aic-c1p
DEP aic-85z.6 aic-85z.3
DEP aic-85z.6 aic-85z.4
DEP aic-85z.6 aic-85z.5
DEP aic-85z.6 aic-85z.6.1
DEP aic-85z.6 aic-85z.6.2
DEP aic-85z.6 aic-85z.6.3
DEP aic-85z.6.1 aic-85z.4.3
DEP aic-85z.6.2 aic-85z.3.3
DEP aic-85z.6.2 aic-85z.4.5
DEP aic-85z.6.2 aic-85z.5.3
DEP aic-85z.6.3 aic-85z.5.3
```

**Not a dependency — do not wire:** `aic-wuo` (tile scale). Every figure in this feature is
per-colonist or per-kilogram, never per-square-metre, so the chain is scale-invariant and can
proceed while tile scale is still being landed. Only footprints are expressed in tiles, and
those are counts, not areas.

## Improvements

Improvements (Level 4: `aic-85z.N.M.P`) are NOT pre-planned here. They are created during
implementation when bugs, refactors, or extra tests are discovered.
