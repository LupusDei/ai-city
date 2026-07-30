# Tasks: Regolith & the Shielded Habitat (Resource Chain 1 of 3)

**Input**: Design documents from `/specs/002-regolith-shield-chain/`
**Epic**: `aic-d8y`
**Date**: 2026-07-30

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (`aic-d8y.N.M`): Assigned in `beads-import.md`
- **[P]**: Can run in parallel — used **only** where tasks touch genuinely different files
- **[Story]**: User story label (US1, US2, US3)

## Non-negotiables for every task below

- **TDD (constitution §1)**: the failing test is written and confirmed RED — for the right
  reason, not a syntax error — **before** any implementation. Each task's acceptance criteria
  below start with the failing test.
- **Minimum test counts**: 3 tests per public method (happy / error / edge), 2 per handler.
- **Coverage gates**: lines 80%, branches 70%, functions 60% (`npm run test:coverage`).
- **Determinism**: integer base units only — grams, watt-hours. **No floats in the
  ledger.** No `Math.random`, `Date.now`, `new Date`, or Object/Map/Set key-order reliance in
  `src/sim/`.
- **Layered architecture (constitution §4)**: sim logic in `src/sim/`, zero React imports, no
  game logic in components. `tests/unit/boundary.test.ts` must keep passing.
- **Structures are data**: these three entries must require **only** new catalog entries — no
  new code branches in `src/sim/placement.ts` or `src/sim/ledger.ts`.

## Blocked on existing beads (do not duplicate)

- `aic-c75` — `buildCost`, `storageCapacity`, integer units, brownout total order. **Blocks the
  whole feature.**
- `aic-5ub` — ledger integer base units. **Blocks Phase 1.**
- `aic-wuo` — tile scale = 5 m. **Blocks Phase 4.**

Not depended on: `aic-m3t` (typed deposits) — regolith requires no deposit.

---

## Phase 1: Foundational

**Purpose**: Resource kinds, catalog entries, capped stockpiles, brownout total order.
Blocks all user stories.

- [ ] **T001** Add the resource-kind registry with integer base units in `src/sim/resources.ts`
      — `regolith` (grams), `sinteredPlate` (grams), `electricity` (watts instantaneous,
      watt-hours energy), each with a display scale (t, kW, kWh) applied only at the display
      boundary.
      *Acceptance*: failing tests first in `tests/unit/resources.test.ts` — happy (a declared
      kind returns its base unit and scale), error (an unknown kind is rejected, not silently
      defaulted), edge (a fractional or negative quantity in a base unit is rejected).
      Assert every declared kind's base unit is integral.

- [ ] **T002** Add the three structure entries as **data only** in `src/sim/catalog-data.ts`:
      `regolith-hopper` (1×1, `buildTurns: 2`, 12,000 W, produces 60,000,000 g regolith/turn,
      no deposit requirement); `sinter-press` (L-shape 3 tiles, `buildTurns: 6`, 30,000 W,
      produces 1,200,000 g plate/turn, consumes 1,400,000 g regolith/turn); `shield-berm`
      (skirt footprint around one habitat, 0 W, `buildTurns: 0` — material-gated,
      `buildCost` = 450,000,000 g regolith + 11,000,000 g plate).
      *Acceptance*: failing tests first in `tests/unit/catalog-data.test.ts` — happy (all three
      validate through the existing `createCatalog` and appear in declaration order), error
      (a malformed variant of each throws `RangeError` at the catalog boundary), edge (the
      L-shape footprint includes the anchor `(0,0)` and has no duplicate offsets). Assert
      `git diff` cleanliness of `src/sim/placement.ts` and `src/sim/ledger.ts` is preserved by
      the accompanying review — no new branch in either.

- [ ] **T003** [P] Add capped stockpiles with **cap-and-report** overflow in
      `src/sim/stockpile.ts`, layered on top of `applyLedger` from `src/sim/ledger.ts` —
      returns the new stockpiles plus an explicit `Overflow[]` (resource, discarded amount),
      mirroring how `ledger.ts` already reports `Shortfall[]`.
      *Acceptance*: failing tests first in `tests/unit/stockpile.test.ts` — happy (production
      below the cap accumulates exactly), error (production above the cap clamps to exactly the
      cap and reports the discarded amount — **silent discard is forbidden**), edge (production
      landing exactly on the cap reports **zero** overflow, and a resource with no declared cap
      is unbounded). Assert the input stockpile object is never mutated.

- [ ] **T004** [P] Register the Hopper and Press in the brownout priority order in
      `src/sim/power.ts` as a **documented total order** over all consumers — no ties, no
      dependence on Object/Map/Set iteration order — with binary-idle resolution returning
      per-consumer `active` or `idle` plus a reason.
      *Acceptance*: failing tests first in `tests/unit/power-brownout.test.ts` — happy (with
      ample supply every consumer is active), error (with zero supply every consumer is idle
      and none consumes inputs), edge (with supply for exactly one consumer, the
      higher-priority one runs and the other is fully idle — never fractional). One test must
      assert **totality**: for every pair of distinct consumers exactly one precedes the other,
      and the order is stable across repeated runs and across shuffled input arrays.

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 2: US1 — Extract regolith (Priority: P1)

**Goal**: A completed Hopper produces 60 t of regolith per turn into a capped stockpile,
draws 12 kW, and competes in the brownout order.
**Independent Test**: Place one Hopper, run turns with ample power, assert the pile rises by
exactly 60,000,000 g/turn until the cap, then reports overflow.

- [ ] **T005** [US1] Add per-turn production resolution in `src/sim/production.ts` — completed
      structures contribute flows, structures still under construction contribute nothing, and
      results are applied through `src/sim/stockpile.ts`.
      *Acceptance*: failing tests first in `tests/unit/production.test.ts` — happy (one
      completed Hopper adds exactly 60,000,000 g), error (a Hopper with `turnsCompleted < 2`
      adds zero and draws zero operating power), edge (zero structures resolves to an unchanged
      stockpile and empty reports, never `NaN`).

- [ ] **T006** [US1] Wire Hopper operating draw into binary-idle brownout resolution in
      `src/sim/production.ts` so an under-powered Hopper produces nothing and draws nothing.
      *Acceptance*: failing tests first in `tests/unit/production.test.ts` — happy (supply
      ≥ 12,000 W → active, full 60,000,000 g), error (supply 11,999 W → fully idle, zero
      produced, zero drawn, reason `power-starved`), edge (supply exactly 12,000 W → active;
      assert the boundary is inclusive and no epsilon fudge is required because the comparison
      is integer watts).

- [ ] **T007** [US1] Surface overflow through the turn result in `src/sim/production.ts` for a
      Hopper producing into a full pile — the steady state for this chain, since one Hopper
      out-produces its own berm by 8×.
      *Acceptance*: failing tests first in `tests/unit/production.test.ts` — happy (a full pile
      stays exactly at cap and reports 60,000,000 g of overflow), error (silent discard fails:
      assert the reported overflow total equals produced-minus-accepted for the turn), edge (a
      pile 1 g below cap accepts exactly 1 g and reports 59,999,999 g).

- [ ] **T008** [P] [US1] Add the US1 integration test in
      `tests/integration/regolith-extraction.test.ts` — one Hopper over ~12 turns from empty:
      2 turns of construction producing nothing, then exact per-turn accumulation, then cap
      saturation with reported overflow every subsequent turn.
      *Acceptance*: the test is written first and fails against the pre-T005 state. Assert the
      full turn-by-turn trace is identical across two runs (determinism).

**Checkpoint**: US1 independently functional — regolith accumulates and overflows honestly.

---

## Phase 3: US2 — Sinter plate (Priority: P1)

**Goal**: The Press consumes regolith and produces plate, idling — binary, with a distinct
reason — when starved of either input or power.
**Independent Test**: With a stocked pile and ample power, plate rises 1,200,000 g/turn while
regolith falls 1,400,000 g/turn; starve each input independently and assert binary idle.

- [ ] **T009** [US2] Add Press regolith → plate conversion to `src/sim/production.ts`, netting
      the Press's consumption against the Hopper's production through the existing `ledger.ts`
      flows.
      *Acceptance*: failing tests first in `tests/unit/sinter.test.ts` — happy (plate
      +1,200,000 g, regolith −1,400,000 g), error (a Press with `turnsCompleted < 6` neither
      consumes nor produces), edge (regolith at **exactly** 1,400,000 g → the Press runs and
      the pile lands at exactly 0 — not short by one gram, never negative).

- [ ] **T010** [US2] Add input-starvation binary idle to `src/sim/production.ts` — insufficient
      regolith means the Press is fully idle for the turn and consumes **zero**, with reason
      `input-starved`, distinct from `power-starved`.
      *Acceptance*: failing tests first in `tests/unit/sinter.test.ts` — happy (ample regolith →
      active), error (1,399,999 g → idle, zero consumed, zero produced, reason
      `input-starved`), edge (0 g → same clean refusal with no partial deduction and no
      negative balance). Assert `input-starved` and `power-starved` are distinguishable in the
      result.

- [ ] **T011** [P] [US2] Slot the Press's 30,000 W draw into the brownout total order in
      `src/sim/power.ts` and assert the documented order for the full consumer set including
      drone recharge (5.54 kW/drone) and drone work (5 kW/drone).
      *Acceptance*: failing tests first in `tests/unit/power-brownout.test.ts` — happy (a
      40,000 W reactor carries the 12,000 W Hopper but not also the 30,000 W Press: 42,000 W
      exceeds 40,000 W, so the lower-priority one idles), error (a Press idled by brownout
      consumes zero regolith), edge (supply exactly 30,000 W with the Press alone → active).

- [ ] **T012** [P] [US2] Add the US2 integration test in
      `tests/integration/regolith-chain.test.ts` — one Hopper plus one Press over ~30 turns,
      asserting the **40× over-feed** as a measured property: regolith accumulates
      monotonically toward its cap at ~58,600,000 g/turn net while plate rises at exactly
      1,200,000 g/turn.
      *Acceptance*: the test is written first and fails against the pre-T009 state. Assert the
      ratio of Hopper output to Press intake is > 40, and that the trace is identical across
      two runs.

**Checkpoint**: US2 independently functional — the chain's lesson (digging is cheap, heat is
ruinous) is an asserted property, not a claim in a doc.

---

## Phase 4: US3 — Shield Berm and the rated-habitat rule (Priority: P1, the payoff)

**Goal**: The berm consumes bulk regolith and plate over multiple turns; readiness becomes a
two-factor test (built AND rated); unrated habitats contribute zero capacity.
**Independent Test**: Run the full chain to one rated habitat; assert it counts and an
identically-built unrated habitat counts zero.

- [ ] **T013** [US3] Add `TILE_EDGE_METERS = 5` and the areal berm-cost derivation in
      `src/sim/scale.ts` — 4,500,000 g/m² of bulk fill (3 m at ~1.5 g/cm³) and 75,000 g/m² of
      crust (0.05 m at 1,500 kg/m³) over a 2×2 habitat's roof area — so the cost is **computed**
      from the tile edge, never typed in as 450 t.
      *Acceptance*: failing tests first in `tests/unit/scale.test.ts` — happy (at a 5 m tile the
      derivation yields exactly 450,000,000 g regolith and 11,000,000 g plate), error (a
      non-integer or non-positive tile edge is rejected), edge (**doubling the tile edge
      quadruples both costs** — the areal-scaling guard that stops a future tile-size
      ratification from silently desyncing the catalog from the map).

- [ ] **T014** [US3] Add berm material accumulation across turns in `src/sim/berm.ts` —
      delivered regolith and plate accrue toward `buildCost`, the berm is resumable with
      delivered material intact after any interruption, and completion deducts exactly the cost.
      *Acceptance*: failing tests first in `tests/unit/berm.test.ts` — happy (progress accrues
      over ~8 turns and completes), error (construction with an empty stockpile is a **clean
      refusal** — no partial deduction, no negative balance), edge (stockpiles at **exactly**
      450,000,000 g and 11,000,000 g complete the berm and leave both at exactly zero; and one
      gram short leaves the berm incomplete with delivered material intact). One test must
      cover **brownout mid-berm**: idling the Hopper or Press for several turns leaves the berm
      resumable with no silent loss.

- [ ] **T015** [US3] Add berm application rules and rating attachment in `src/sim/berm.ts` —
      applicable only to an **adjacent, completed** habitat; rating is **derived** from a
      completed adjacent berm, never stored on the habitat.
      *Acceptance*: failing tests first in `tests/unit/berm-rating.test.ts` — happy (a berm
      adjacent to a completed habitat rates it), error (applying to a habitat **still under
      construction** is rejected with **no material deducted**, and must not pre-credit
      readiness that later appears without a second berm — assert the order-independent case:
      berm completes first, habitat second), edge (applying a **second** berm to an
      already-rated habitat is refused **before any deduction** — a double-charge that grants
      nothing is the worst possible outcome at 450 t; and a berm not adjacent to any habitat
      rates nothing). One test must assert a **partially supplied berm confers no rating** —
      "a rated habitat whose berm was never finished" cannot exist.

- [ ] **T016** [US3] Make habitat readiness a two-factor test in `src/sim/mission.ts` —
      `HabitatStructure` gains `rated: boolean`, and `totalHabitatCapacity` counts only
      structures that are complete **AND** rated. `mission.ts` must not import `berm.ts`; the
      caller maps world state into the field.
      *Acceptance*: failing tests first in `tests/unit/mission.test.ts` — happy (built + rated,
      capacity 8 → contributes 8), error (built but **unrated**, capacity 8 → contributes
      exactly **0**, not partial credit, not 60%), edge (rated but incomplete → 0; six unrated
      habitats → total 0, and `evaluateMission` returns `lost` at the deadline). Assert
      `evaluateMission` re-queried after the deadline returns the identical verdict.

- [ ] **T017** [P] [US3] Make demolition and overwrite invalidate rating in `src/sim/berm.ts`
      — a demolished or overwritten habitat's rating disappears, and no rating may be inherited
      by a later structure on those tiles.
      *Acceptance*: failing tests first in `tests/unit/berm-demolition.test.ts` — happy
      (demolishing a rated habitat drops total readiness by exactly that habitat's capacity),
      error (a new habitat built on the demolished tiles is **unrated** — no orphan rating
      inherited for free), edge (demolishing the **berm** rather than the habitat also drops
      the rating). Assert rating is never a stored flag that survives the structure it
      described.

- [ ] **T018** [P] [US3] Add the US3 integration test in
      `tests/integration/shield-readiness.test.ts` — full run from empty stockpiles: build
      Hopper, Press and habitat, accumulate, complete the berm, and assert readiness flips from
      0 to full capacity at the exact turn the berm completes.
      *Acceptance*: the test is written first and fails against the pre-T014 state. Cover, in
      this file: brownout mid-berm leaving the berm resumable; an unrated habitat contributing
      zero at the deadline; and **deterministic recomputation** — the same seed and same orders
      produce an identical turn-by-turn ledger across two runs, **including the built/rated
      split**. Assert readiness is a pure function of world state, not an incrementally mutated
      counter.

**Checkpoint**: US3 functional — the win condition is honest.

---

## Phase 5: Polish & Cross-Cutting (Priority: P2)

- [ ] **T019** [P] Add cycle-report lines in `src/sim/cycle-report.ts` for berm progress
      (delivered / required per resource), starvation (which plant idled and whether
      `input-starved` or `power-starved`), and overflow (which resource, how much discarded).
      *Acceptance*: failing tests first in `tests/unit/cycle-report.test.ts` — happy (an active
      turn reports production and berm progress), error (an idled Press reports the specific
      reason), edge (a turn with overflow **and** starvation reports both, in a documented
      stable line order). Display units (t, kW, kWh) are converted here only — the underlying
      quantities stay integer base units.

- [ ] **T020** Add UI readouts in `src/ui/` — stockpile levels with cap, berm progress bar, and
      a rated/unrated habitat badge. **Presentation only**: zero game logic in components, all
      values read from sim results.
      *Acceptance*: failing tests first in `tests/unit/ui-readouts.test.ts` — 3 tests per
      component/hook (initial state, state change on new sim result, error/empty state).
      `tests/unit/boundary.test.ts` must still pass with no React import or DOM global under
      `src/sim/`.

- [ ] **T021** [P] Expose balance hooks in `src/sim/balance.ts` — berm cost, Hopper and Press
      throughputs, and stockpile caps as named tunables so the balance pass (`aic-to6.1`) can
      retune without editing sim internals. The berm cost tunable is a **multiplier on the
      areal derivation**, not a replacement for it, so `src/sim/scale.ts`'s tile-edge coupling
      survives tuning.
      *Acceptance*: failing tests first in `tests/unit/balance.test.ts` — happy (default
      tunables reproduce the ratified constants exactly), error (a non-integer or negative
      tunable is rejected), edge (a berm-cost multiplier of 1 leaves the derived cost byte-identical,
      and the tile-edge quadrupling property from T013 still holds under any multiplier).

---

## Dependencies

- **External**: `aic-c75` blocks the whole feature. `aic-5ub` blocks Phase 1. `aic-wuo` blocks
  Phase 4.
- Phase 1 (Foundational) blocks Phases 2, 3, 4.
- Phase 2 (US1) → Phase 3 (US2): the Press consumes what the Hopper produces, and both resolve
  through `src/sim/production.ts`.
- Phase 3 (US2) → Phase 4 (US3): the crust needs sintered plate.
- Phase 5 (Polish) depends on Phases 2, 3, 4.
- Task level: T002←T001; T003←T001; T004←T002. T005←T002,T003; T006←T004; T007←T005;
  T008←T005,T006,T007. T009←T005; T010←T009; T011←T006; T012←T009,T010,T007.
  T013←T002; T014←T013,T003; T015←T014; T016←T015; T017←T015; T018←T016,T017,T009.
  T019←T014,T010,T007; T020←T019; T021←T013.

## Parallel Opportunities

- **T003 ∥ T004** — `src/sim/stockpile.ts` vs `src/sim/power.ts`.
- **T008** runs alongside the start of Phase 3 — it is a test-only file.
- **T011 ∥ T009/T010** — `src/sim/power.ts` vs `src/sim/production.ts`.
- **T012 ∥ T013** — integration test file vs `src/sim/scale.ts`.
- **T017 ∥ T016** — `src/sim/berm.ts` vs `src/sim/mission.ts`.
- **T018 ∥ T016/T017** — test-only file.
- **T019 ∥ T021** — `src/sim/cycle-report.ts` vs `src/sim/balance.ts`.
- Phases 2, 3 and 4 are **not** parallel with each other: this chain is genuinely sequential
  (dig → sinter → bury), and pretending otherwise would produce merge conflicts in
  `src/sim/production.ts`.

## Total: 21 tasks
