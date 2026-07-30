# Beads Import Map — 001-mars-colony-mvp

**Reconciliation, not import.** The `aic-*` bead tree already existed when this spec was
written (the accepted proposal was authored *from* it). No new root epic was created —
creating one would have duplicated 30 beads and split work tracking across two trees.

## T-ID → Bead ID

| T-ID | Task | Bead | Status |
|---|---|---|---|
| T001 | Workspace scaffold | `aic-093.1` | ✅ closed |
| T002 | Sim/renderer boundary enforcement | `aic-093.2` | open |
| T003 | Grid & coordinate model | `aic-a00.1` | ✅ closed |
| T004 | Structure catalog | `aic-a00.2` | ✅ closed |
| T005 | Placement & footprint validation | `aic-a00.3` | open |
| T006 | Turn cycle & mission time model | `aic-a00.11` | open |
| T007 | Seeded terrain generation | `aic-74p.1` | open |
| T008 | Buildability & deposits | `aic-74p.2` | open |
| T009 | Resource ledger | `aic-a00.4` | open |
| T010 | Power & brownout | `aic-a00.9` | open |
| T011 | Drone roster & labour | `aic-a00.12` | open |
| T012 | Drone construction | `aic-a00.8` | open |
| T013 | Landing site scoring | `aic-74p.3` | open |
| T014 | Starting inventory | `aic-74p.4` | open |
| T015 | Mission clock & win/lose | `aic-a00.10` | open |
| T016 | Turn resolution | `aic-a00.6` | open |
| T017 | Golden trace | `aic-a00.7` | open |
| T018 | Sim/UI adapter | `aic-8tl.5` | open |
| T019 | Canvas grid renderer | `aic-8tl.1` | open |
| T020 | Screen: Survey | `aic-8tl.2` | open |
| T021 | Screen: Colony ops | `aic-8tl.3` | open |
| T022 | Screen: Cycle report | `aic-8tl.4` | open |
| T023 | Headless scenario runner | `aic-to6.2` | open |
| T024 | Balance pass | `aic-to6.1` | open |
| T025 | Save/load | `aic-n3q.1` | open |
| T026 | Perf budget | `aic-n3q.2` | open |
| T027 | CI + deploy | `aic-n3q.3` | open |

**Superseded**: `aic-a00.5` (population growth curve) — closed, killed by the Mars pivot.

## Squad execution front

Phase 2 tasks T002, T005, T006, T007 touch four disjoint files and have no dependency on
one another. They are the correct first parallel wave, each in an isolated worktree
(Constitution §7).
