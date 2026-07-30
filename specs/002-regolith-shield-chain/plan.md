# Implementation Plan: Regolith & the Shielded Habitat (Resource Chain 1 of 3)

**Branch**: `002-regolith-shield-chain` | **Date**: 2026-07-30
**Epic**: `aic-d8y` | **Priority**: P1

## Scope: this is a post-MVP-loop increment

**State this plainly and schedule accordingly.** This feature ships **after** the core
electricity/labour loop is proven fun, and it **must not be scheduled against it**. The MVP's
job is to make the electricity-and-labour loop playable; none of this ships before that loop
lands. Read this as the first thing to build after the core loop, not as a competitor for the
same sprint.

## Summary

Add one acquisition utility (Regolith Hopper), one assembly line (Sinter Press) and one
structure (Shield Berm) as **catalog data**, then use them to make the win condition honest:
habitat readiness becomes a two-factor test (built AND rated) and an unrated habitat
contributes exactly zero capacity. The implementation is deliberately small in new code and
large in new data — the whole point of `catalog.ts` is that structure types are data, and this
feature is the first real test of that claim.

## Bead Map

- `aic-d8y` — Root: Regolith & the Shielded Habitat (Resource Chain 1 of 3)
  - `aic-d8y.1` — **Phase 1 / Foundational**: resource kinds, catalog entries, capped
    stockpile, brownout total order. Blocks all user stories.
    - `aic-d8y.1.1` — T001 Resource-kind registry with integer base units
    - `aic-d8y.1.2` — T002 Three catalog entries as data
    - `aic-d8y.1.3` — T003 Capped stockpile with cap-and-report overflow
    - `aic-d8y.1.4` — T004 Brownout priority as a documented total order
  - `aic-d8y.2` — **Phase 2 / US1 (P1)**: Extract regolith
    - `aic-d8y.2.1` — T005 Per-turn production resolution
    - `aic-d8y.2.2` — T006 Hopper binary idle under brownout
    - `aic-d8y.2.3` — T007 Overflow cap-and-report on a full pile
    - `aic-d8y.2.4` — T008 US1 integration: extraction over many turns
  - `aic-d8y.3` — **Phase 3 / US2 (P1)**: Sinter plate
    - `aic-d8y.3.1` — T009 Press regolith → plate conversion
    - `aic-d8y.3.2` — T010 Input-starvation binary idle
    - `aic-d8y.3.3` — T011 Power-starvation binary idle
    - `aic-d8y.3.4` — T012 US2 integration: the 40× over-feed
  - `aic-d8y.4` — **Phase 4 / US3 (P1, the payoff)**: Shield Berm & the rated-habitat rule
    - `aic-d8y.4.1` — T013 Tile-edge constant and areal berm-cost derivation
    - `aic-d8y.4.2` — T014 Berm material accumulation across turns
    - `aic-d8y.4.3` — T015 Berm application rules and rating attachment
    - `aic-d8y.4.4` — T016 Two-factor readiness in the mission module
    - `aic-d8y.4.5` — T017 Demolition/overwrite invalidates rating
    - `aic-d8y.4.6` — T018 US3 integration: shielded readiness end to end
  - `aic-d8y.5` — **Phase 5 / Polish (P2)**
    - `aic-d8y.5.1` — T019 Cycle-report lines
    - `aic-d8y.5.2` — T020 UI readouts
    - `aic-d8y.5.3` — T021 Balance hooks

## Dependencies on EXISTING beads (reconcile — never duplicate)

| Bead | What it is | Relationship |
|------|-----------|--------------|
| `aic-c75` | Shared foundation: `buildCost` (a one-time bill of materials — `consumes` is a per-turn operating draw and cannot express a build cost), `storageCapacity`, integer units, brownout priority as a documented total order | **Blocks this whole feature** (`aic-d8y`) |
| `aic-wuo` | Tile scale = 5 m | **Blocks Phase 4** (`aic-d8y.4`) — every shielding tonnage derives from it |
| `aic-5ub` | Ledger integer base units | **Blocks Phase 1** (`aic-d8y.1`) |

`aic-c75` is earned by three real callers (all three resource chains need the same five
additions), per constitution §8 — this proposal does not justify it alone and does not
re-file it.

**This feature does NOT depend on `aic-m3t`** (typed deposits). Regolith is global — Martian
soil is roughly 45 wt% SiO₂ and 18 wt% iron oxide essentially everywhere — so the Hopper needs
no deposit, and gating this chain on a lucky landing site would be wrong. "Deposit exhausted
mid-build" belongs to proposals 2 and 3, not here.

## Technical Context

**Stack**: TypeScript (strict, `noUncheckedIndexedAccess`), ESM, no framework in `src/sim/`
**Testing**: Vitest, `@vitest/coverage-v8`. Gates: lines 80%, branches 70%, functions 60%
**Storage**: In-memory pure data structures; no persistence in scope
**Constraints**:
- **Determinism** — integer base units only (grams, watt-hours). No floats in the
  ledger. No `Math.random`, `Date.now`, `new Date`, or reliance on Object/Map/Set key order in
  `src/sim/` (`tests/unit/boundary.test.ts` enforces this automatically).
- **Layered architecture** (constitution §4) — sim logic in `src/sim/`, zero React imports,
  no game logic in components.
- **TDD is mandatory** (constitution §1) — the failing test comes first on every task.

## Architecture Decision

**Structures stay data.** The three new entries go into a catalog-data module and are validated
by the existing `createCatalog`. No new branch may appear in `placement.ts` or `ledger.ts`;
`placement.ts` already resolves arbitrary footprints, and `ledger.ts` already nets arbitrary
open-keyed resources. If either file needs a new branch to make this work, that is the signal
that the *general* mechanism is missing (that is `aic-c75`'s job), not that this feature needs
a special case.

**New modules, not edits to load-bearing ones.** Rather than growing `ledger.ts` into a turn
engine, four small pure modules are added:

- `src/sim/resources.ts` — the resource-kind registry: base unit and display scale per kind.
  Makes "regolith is measured in grams" a single declared fact instead of a convention.
- `src/sim/stockpile.ts` — capped stockpile application on top of `applyLedger`, producing an
  explicit `Overflow[]` alongside the new stockpiles. `ledger.ts` deliberately reports
  shortfalls as structured data; overflow is the symmetric case and gets the same treatment.
- `src/sim/power.ts` — the brownout total order and binary-idle resolution: given consumers and
  a supply, decide who runs. Returns per-consumer `active | idle` with a reason, so the cycle
  report never has to guess *why* a plant stopped.
- `src/sim/production.ts` — per-turn resolution: completed structures → power decision →
  ledger flows → capped stockpiles. This is where "a structure under construction produces
  nothing" and "an idle structure consumes none of its inputs" live.
- `src/sim/scale.ts` — `TILE_EDGE_METERS` and the areal derivations. The berm cost is
  *computed* from the tile edge, never typed in, so ratifying a different tile size cannot
  silently desync the catalog from the map.
- `src/sim/berm.ts` — berm progress, application rules, and rating attachment.

**Binary idle, not fractional throughput.** A plant runs at full rate or not at all.
Fractional rates reintroduce non-integer accumulation, undermine the determinism guarantee
everything else in the sim is built on, and make the end-of-cycle report much harder to
explain to a player. Binary idle is harsher but explainable in one sentence.

**Berm is material-gated, not turn-gated.** `buildTurns: 0` with a non-empty `buildCost`. Its
~7.5-turn duration is an emergent property of the supply rate, which is a better mechanic than
a hardcoded number — and the direct argument for `buildCost` existing at all.

**Rating is derived, never stored on the habitat.** `berm.ts` answers "is habitat H rated?"
from world state (a completed berm adjacent to H). That is what makes FR-012 (demolition
drops readiness, no orphan rating) fall out for free instead of needing cleanup code, and what
makes FR-013 (deterministic recomputation) structurally true rather than merely tested.

**Mission module gains a field, not a dependency.** `HabitatStructure` in `mission.ts` gains
`rated: boolean`, keeping `mission.ts` free of any import from `berm.ts` — exactly the
one-line-adapter pattern its module doc already anticipates. `totalHabitatCapacity` then counts
only structures that are complete **and** rated.

## Files Changed

| File | Change |
|------|--------|
| `src/sim/resources.ts` | **New** — resource-kind registry with integer base units |
| `src/sim/catalog-data.ts` | **New** — the three catalog entries as data |
| `src/sim/stockpile.ts` | **New** — capacity caps + cap-and-report overflow |
| `src/sim/power.ts` | **New** — brownout total order, binary-idle resolution |
| `src/sim/production.ts` | **New** — per-turn production resolution |
| `src/sim/scale.ts` | **New** — `TILE_EDGE_METERS`, areal cost derivation |
| `src/sim/berm.ts` | **New** — berm progress, application rules, rating |
| `src/sim/cycle-report.ts` | **New** — report lines for progress/starvation/overflow |
| `src/sim/balance.ts` | **New** — tunables surface for the balance pass |
| `src/sim/mission.ts` | `HabitatStructure` gains `rated`; two-factor `totalHabitatCapacity` |
| `src/sim/catalog.ts` | No change expected — `buildCost`/`storageCapacity` arrive via `aic-c75` |
| `src/sim/placement.ts` | **No change** — a new branch here means the general mechanism is missing |
| `src/sim/ledger.ts` | **No change** — a new branch here means the general mechanism is missing |
| `src/ui/` | Stockpile, berm-progress and rated-badge readouts. Presentation only |
| `tests/unit/resources.test.ts` | **New** |
| `tests/unit/catalog-data.test.ts` | **New** |
| `tests/unit/stockpile.test.ts` | **New** |
| `tests/unit/power-brownout.test.ts` | **New** |
| `tests/unit/production.test.ts` | **New** |
| `tests/unit/sinter.test.ts` | **New** |
| `tests/unit/scale.test.ts` | **New** |
| `tests/unit/berm.test.ts` | **New** |
| `tests/unit/berm-rating.test.ts` | **New** |
| `tests/unit/berm-demolition.test.ts` | **New** |
| `tests/unit/cycle-report.test.ts` | **New** |
| `tests/unit/balance.test.ts` | **New** |
| `tests/unit/mission.test.ts` | Extend for the two-factor rule |
| `tests/integration/regolith-extraction.test.ts` | **New** |
| `tests/integration/regolith-chain.test.ts` | **New** |
| `tests/integration/shield-readiness.test.ts` | **New** |
| `tests/unit/boundary.test.ts` | **Must keep passing unchanged** |

## Phase 1: Foundational

Everything that all three user stories need, and nothing else. Resource kinds get declared
base units so "grams" is a fact rather than a habit. Stockpiles gain a cap and, critically, a
**reported** overflow — silent discard is a ledger bug that will not surface until balance
work, when it will be indistinguishable from a tuning problem. The two new consumers get
slotted into the brownout order, which is asserted by test to be a genuine total order (no
ties, no reliance on incidental iteration order).

The three catalog entries land here as pure data. If adding them requires touching
`placement.ts` or `ledger.ts`, stop and escalate — that is a missing general mechanism, not a
special case to write.

**Blocked by**: `aic-5ub` (ledger integer base units).

## Phase 2: US1 — Extract regolith (P1)

Per-turn production resolution: completed structures produce, incomplete ones do not, and an
under-powered structure is fully idle and consumes nothing. Then the steady state that defines
this chain: a Hopper running past its berm banks 60 t/turn into a capped pile, and the excess
is reported. One Hopper out-produces its own berm by 8×, so overflow is the normal case here,
not an edge case.

## Phase 3: US2 — Sinter plate (P1)

The Press converts regolith to plate and idles — binary, with a distinct reported reason —
when starved of either input or power. The integration test makes the 40× over-feed visible as
an asserted property rather than a claim in a doc: one Hopper (60 t/turn) against one Press
(1.4 t/turn), because digging is nearly free and heat is ruinous.

## Phase 4: US3 — Shield Berm and the rated-habitat rule (P1, the payoff)

The tile-edge constant drives the areal cost; the berm accumulates delivered material across
turns and is resumable; application is refused for an incomplete or already-rated habitat
**before any deduction**; readiness becomes built AND rated; and demolition drops the rating
with no orphan left behind. This phase carries most of the edge-case tests because it carries
all of the ways this feature could quietly lose 450 t of the player's work.

**Blocked by**: `aic-wuo` (tile scale = 5 m) and Phase 3 (the crust needs plate).

## Phase 5: Polish (P2)

Cycle-report lines so a player can see berm progress, why a plant idled, and what overflowed;
UI readouts (presentation only — zero game logic, boundary guard stays green); and balance
hooks exposing berm cost and throughputs as tunables so the balance pass does not have to edit
sim internals.

## Parallel Execution

- Phase 1 tasks T003 and T004 can run alongside each other once T001 lands (different files).
- Phase 2 and Phase 3 are **sequential** — the Press consumes what the Hopper produces, and
  both resolve through the same `production.ts`. Only T011 (power starvation, `power.ts`) is
  genuinely parallel to the Press conversion work.
- Phase 4's T017 (demolition) is parallel to T016 (mission readiness): different files.
- Phase 5's T019 and T021 touch different files and can run in parallel.
- `[P]` markers in `tasks.md` appear **only** where the tasks touch genuinely different files.

## Verification Steps

- [ ] `npm run verify` exits 0 (typecheck + build + coverage gates 80/70/60)
- [ ] `tests/unit/boundary.test.ts` passes unchanged — no React import, DOM global, or
      nondeterministic API under `src/sim/`
- [ ] `git diff` shows **zero** changes to `src/sim/placement.ts` and `src/sim/ledger.ts`
- [ ] Place one Hopper; confirm regolith rises 60,000,000 g/turn and overflow is reported at cap
- [ ] Place one Press; confirm 1,400,000 g regolith in → 1,200,000 g plate out per turn
- [ ] Starve the Press of regolith by one gram; confirm zero consumption and reason
      `input-starved`
- [ ] Drop reactor power below the pair's 42 kW; confirm binary idle in documented priority
      order
- [ ] Complete a berm; confirm the habitat becomes rated and both stockpiles land at exactly 0
- [ ] Evaluate a built-but-unrated habitat; confirm it contributes exactly 0 capacity
- [ ] Demolish a rated habitat; confirm readiness drops and no rating is inherited
- [ ] Double `TILE_EDGE_METERS` in a test; confirm the berm cost quadruples
- [ ] Run the full chain twice from the same seed; confirm identical ledgers including the
      built/rated split
