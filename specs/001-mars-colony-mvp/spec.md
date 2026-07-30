# Spec — AI City: Mars Colony Builder MVP

**Feature**: 001-mars-colony-mvp
**Source**: Adjutant proposal `55009338-f1bb-40ea-a2f5-d1938edb361f` (status: **accepted**)
**Bead tree**: existing `aic-*` epics — this spec **reconciles**, it does not create a second root.

## Premise

Three starships left Earth. Two landed: one carrying automated construction drones, one
carrying nuclear reactors. The third — carrying critical components **and the entire crew** —
was lost in transit.

The colony is therefore **unmanned**. The player commands drones to raise a habitat before
the next colonist wave departs Earth. The win condition is **habitat readiness**, not
population growth.

## Locked parameters (reality-grounded, ratified by the General)

Every number below must be defensible against real mission engineering. No invented figures.

| Parameter | Value | Derivation |
|---|---|---|
| Mars sol | 24 h 39 m 35 s | Actual Martian solar day |
| Drone work period | 25 h | General's directive |
| Drone recharge | 1 sol (24.66 h) | General's directive |
| **Turn duration** | **49.6598 h = 2.014 sols** | work + recharge |
| Duty cycle | 50.3% | 25 / 49.66 |
| **Mission deadline** | **577 days = 278 full turns** | Synodic period 779.9 d − Starship transit 203 d = interval from landing until the next wave **departs Earth** |
| Reactor output | 40 kWe per unit | NASA Fission Surface Power target unit |
| Drone working draw | 5 kW | Ratified; 5 kW × 25 h = 125 kWh usable per shift |
| Charging efficiency | 0.92 | Round-trip loss, well-managed lithium pack |
| Pack thermal upkeep | 32 W | Insulated ~1 m² pack held near 0 °C against −60 °C ambient; 610 Pa suppresses convection |
| **Drone recharge draw** | **5.54 kW** | (125 / 0.92 + 0.79) kWh over one sol — **grid** energy, not pack energy |
| Habitat life support | ~4 kW per colonist | ISS-derived |

> **Why 577 and not 780**: the next wave will not commit to launch unless the habitat is
> confirmed ready. The deadline is their *departure*, not their arrival.

## User stories

### US1 — Survey and land (Priority: P1)
As the mission director, I choose where the two surviving hulls set down, so that my starting
position is a decision rather than an accident.

**Acceptance**
- Terrain is generated from a seed; identical seeds produce identical maps.
- Tiles expose elevation, buildability (derived from local slope) and mineral deposits.
- Both hulls must be placed before the mission begins.
- Site score reflects flatness, deposit proximity, and separation between hulls.
- An invalid site is refused with a typed reason; state is never partially mutated.

### US2 — Build under an electricity constraint (Priority: P1)
As the mission director, I queue structures that drones build over multiple turns, trading
reactor output against construction speed.

**Acceptance**
- Structures have multi-tile and L-shaped footprints; every footprint tile must be in bounds,
  unoccupied and buildable or placement is refused.
- Builds consume turns; an in-progress structure occupies tiles but produces nothing.
- Labour capacity = 25 robot-hours × drones on shift.
- **Drone recharging draws colony power** and competes with structures.
- Draw exceeding generation triggers a brownout via a **documented priority order**.

### US3 — Race the clock to habitat readiness (Priority: P1)
As the mission director, I need to know how much time remains and whether I will make it.

**Acceptance**
- The mission runs exactly 278 turns; turns remaining is always queryable.
- Habitat capacity counts **completed** structures only.
- Outcome is evaluated once, at the deadline turn.
- Each turn produces a readable report: completions, brownouts, labour applied.

### US4 — Read and operate the colony (Priority: P2)
As the mission director, I need the constraints visible at all times.

**Acceptance**
- Power margin, drones on shift, habitat capacity and turns remaining are always on screen.
- Player actions dispatch typed intents the sim validates; components own **no** game logic.
- Rejected actions surface their reason in plain language.

## Out of scope (deferred backlog)

Silica, oxygen, hydrogen, carbon, metals, Earth-resupply credits. The resource ledger is
built resource-agnostic so these arrive as **data**, not a rewrite. Do not build them until
the core loop is fun.

## Success criteria

- A full 278-turn mission runs headlessly and deterministically.
- Identical seed + identical actions ⇒ byte-identical state trace (golden-trace regression).
- Coverage gates hold: 80% lines / 70% branches / 60% functions.
- No floating-point arithmetic in the clock path.
- Every default balance value cites its real-world basis in a comment.
