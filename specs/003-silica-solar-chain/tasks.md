# Tasks: Silica & Solar — the Photovoltaic Chain

**Input**: Design documents from `/specs/003-silica-solar-chain/`
**Epic**: `aic-sfq`
**Date**: 2026-07-30

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001…): sequential authoring IDs for this document
- **Bead IDs** (`aic-sfq.N.M`): assigned in `beads-import.md`
- **[P]**: can run in parallel — different files, no shared dependency
- **[Story]**: user story label (US1…US4)

## TDD is mandatory (constitution §1)

Every task below is **red-first**: write the failing test, confirm it fails for the right reason,
then implement. Minimum 3 tests per public method (happy, error, edge). Coverage must stay at or
above 80% lines / 70% branches / 60% functions. A task is not done until `npm run verify` passes.

## Blocked on existing beads — do not start before these land

`aic-c75` (shared foundation: `buildCost`, `siting.requiresDeposit`, `storageCapacity`, integer
units, brownout total order) · `aic-5ub` (integer ledger units) → Phase 1.
`aic-m3t` (typed deposits — **hard blocker**) · `aic-c1p` (P0: deposits generated but never
consumed) → Phase 2. `aic-wuo` (5 m tile scale) → Phase 4.

---

## Phase 1: Foundational

**Purpose**: Resource kinds, derivation constants, the three catalog rows, deposit-gated siting and
stockpile caps. Blocks every user story.

- [ ] T001 [P] Add resource kinds and integer base-unit helpers in `src/sim/resources.ts` — export
      `SILICA`, `SILICON`, `ELECTRICITY` kind constants and `Grams` / `WattHours` branded integer
      types, plus the **single** documented `wattHoursPerTurn(kilowatts, turnSeconds)` helper that
      rounds half-up (FR-002), so `8 kW × 178,775 s = 397,277.78 → 397,278 Wh` is derived once and
      never hand-typed. Tests in `tests/unit/resources.test.ts`: exact-integer case (36 kW →
      1,787,750 Wh), rounding case (8 kW → 397,278 Wh), and rejection of non-finite / negative
      kilowatts.
- [ ] T002 [P] Add ratified solar derivation constants in `src/sim/solar.ts` — `TILE_EDGE_METRES = 5`,
      `TILE_AREA_M2 = 25`, `INSOLATION_WH_PER_M2_PER_TURN = 1_168`, `EMBODIED_WH_PER_M2 = 48_000`,
      `ARRAY_OUTPUT_WH_PER_TURN = 29_200`, `ARRAY_SILICON_COST_GRAMS = 20_000`, each with its
      derivation in a comment. Tests in `tests/unit/solar.test.ts` assert the constants compose:
      `1_168 × 25 = 29_200` and `48_000 × 25 = 1_200_000`. (Payback function lands in T017.)
- [ ] T003 Add the three catalog rows as pure DATA in `src/sim/silicaChain.ts` — `silica-sifter`
      (1×1, 3 build turns, consumes 397,278 Wh/turn, produces 6,000,000 g silica,
      `siting.requiresDeposit: SILICA`), `silicon-furnace` (2×2, 9 build turns, consumes
      1,787,750 Wh + 75,000 g silica, produces 30,000 g silicon), `pv-array` (1×1, 3 build turns —
      by analogy with the Sifter, no measured basis, stated as such — `buildCost` 20,000 g silicon,
      produces 29,200 Wh). Tests in `tests/unit/silicaChain.test.ts`: `createCatalog` accepts all
      three, every amount is an integer, and the 2×2 footprint includes the anchor.
- [ ] T004 [P] Add deposit-gated siting validation in `src/sim/siting.ts` — `validateSiting(grid,
      structureType, anchor, deposits)` composing `validatePlacement` from `src/sim/placement.ts`,
      widening the rejection union with `{ ok: false, reason: 'deposit-required', tile, resource }`.
      Never throws, never mutates the grid. Tests in `tests/unit/siting.test.ts`: on-deposit success,
      off-deposit rejection naming the resource, wrong-kind-of-deposit rejection, and a
      grid-unchanged assertion after every rejection.
- [ ] T005 [P] Add stockpile caps and overflow reporting in `src/sim/storage.ts` —
      `applyCappedLedger(flows, stockpiles, capacities)` calling `applyLedger` from
      `src/sim/ledger.ts` then clamping, returning `{ ...ledgerResult, discarded }` with `discarded`
      as positive base-unit amounts sorted by resource. Tests in `tests/unit/storage.test.ts`:
      under-cap passthrough, exact-at-cap (zero discard), over-cap clamp with the discard reported,
      and a resource with no configured capacity passing through uncapped.

**Checkpoint**: Foundation ready — user stories can begin.

---

## Phase 2: US1 — Silica Sifter (Priority: P1, MVP of this chain)

**Goal**: A deposit-gated Sifter producing SiO₂ into a capped stockpile.
**Independent Test**: Place a Sifter on a silica deposit on a seeded map, run 4 turns, assert silica
rises only from turn 4 (build completes first); place one off-deposit and assert a structured
rejection with an unchanged grid.

- [ ] T006 [US1] Add the production flow pipeline in `src/sim/production.ts` —
      `collectProductionFlows(structures, context)` returning `readonly ResourceFlow[]` (structurally
      accepted by `applyLedger`, no adapter). Gates, in order: **incomplete → contributes zero
      produces AND zero consumes**, then feedstock, then power. One generic pipeline over catalog
      rows — no per-type branches. Tests in `tests/unit/production.test.ts`: complete structure emits
      its flows, structure with 1 build turn remaining emits nothing, empty structure list returns
      `[]`.
- [ ] T007 [US1] Wire Sifter siting through `validateSiting` in `src/sim/siting.ts` and cover the
      integration in `tests/unit/siting.test.ts` — a `silica-sifter` on a silica deposit succeeds; on
      a bare tile it returns `deposit-required`; on an occupied deposit tile the `occupied` rejection
      from `placement.ts` still wins (gate order is bounds → occupancy → deposit).
- [ ] T008 [US1] Handle deposit exhaustion in `src/sim/production.ts` — a Sifter whose deposit is
      exhausted **completes its build and idles at zero yield** (never cancelled: cancelling would
      silently destroy drone-turns the player already spent). Tests in
      `tests/unit/production.test.ts`: exhaustion **during** build (build still completes, then zero
      yield), exhaustion **after** completion (yield drops to zero the same turn), and a typed
      `deposit-exhausted` idle reason on the result.
- [ ] T009 [US1] Surface the Sifter's cap overflow in `src/sim/storage.ts` — a Sifter filling the
      silica cap clamps and the discarded grams appear on the result. Tests in
      `tests/unit/storage.test.ts`: a single turn that overflows reports the exact discarded grams;
      the following turn at cap discards the full 6,000,000 g; total stockpile never exceeds the cap
      over 10 turns.

**Checkpoint**: US1 independently functional.

---

## Phase 3: US2 — Silicon Furnace (Priority: P1)

**Goal**: A Furnace consuming 75 kg SiO₂ + 36 kW to produce 30 kg silicon, idling **wholly** when
starved of either.
**Independent Test**: One Sifter + one Furnace for 10 turns with two reactors online → 300,000 g
silicon and 750,000 g silica consumed; with one reactor → the Furnace's output is exactly 0 every
turn, not a reduced rate.

- [ ] T010 [US2] Add the brownout total order in `src/sim/brownout.ts` — `resolveBrownout(demands,
      availableWh)` shedding in the documented **total** order (life support → habitat → drone
      recharge → silicon furnace → silica sifter → all others), tie-broken by ascending structure
      instance id so no two runs can differ. Tests in `tests/unit/brownout.test.ts`: sufficient power
      sheds nothing, insufficient power sheds in exact documented order, two structures of equal
      priority shed by id order (determinism).
- [ ] T011 [US2] Add the Furnace conversion to `src/sim/production.ts` — consumes 1,787,750 Wh +
      75,000 g silica, produces 30,000 g silicon, all integers. Tests in
      `tests/unit/production.test.ts`: exact conversion at ≥75,000 g feed, exact-75,000 g boundary
      (succeeds, silica lands at 0), and 10 consecutive turns accumulating exactly 300,000 g with no
      drift.
- [ ] T012 [US2] Enforce **binary idle** in `src/sim/production.ts` — a Furnace short of feedstock
      or power consumes 0 Wh, consumes 0 g, produces 0 g, and reports a typed idle reason; there is
      no fractional path. Tests in `tests/unit/production.test.ts`: 74,999 g feed → fully idle;
      power one watt-hour short → fully idle; and an assertion that **no** result field is
      non-integral in any starved case.
- [ ] T013 [US2] Add the chain integration test in `tests/integration/silica-chain.test.ts` — one
      Sifter + one Furnace: assert the Sifter over-feeds the Furnace ~80× (6,000,000 g produced vs
      75,000 g accepted, 5,925,000 g surplus per turn, either capped or reported discarded), and
      that combined draw of 397,278 + 1,787,750 Wh exceeds one reactor's 1,986,000 Wh/turn — so a
      single-reactor colony brownouts and a two-reactor colony does not.

**Checkpoint**: US2 independently functional.

---

## Phase 4: US3 — Photovoltaic Array + payback readout (Priority: P1)

**Goal**: 20 kg of silicon buys a tile returning 29,200 Wh/turn, and the player can **see** the
payback before committing.
**Independent Test**: With exactly 20,000 g the build starts and the stockpile lands at exactly 0;
with 19,999 g it is refused up front. The payback verdict flips between turn 1 and turn 250.

- [ ] T014 [US3] Add one-time build-cost debiting in `src/sim/buildcost.ts` — `commitBuildCost(
      structureType, stockpiles)` debiting `buildCost` at build **commit** (distinct from the
      per-turn `consumes` operating draw), returning either the new stockpiles or a typed
      `{ ok: false, reason: 'insufficient-resources', resource, shortfall }`. Never throws; never
      mutates the input. Tests in `tests/unit/buildcost.test.ts`: sufficient stockpile debits
      exactly, insufficient refuses **before** anything is committed, and a structure with no
      `buildCost` is a no-op passthrough.
- [ ] T015 [US3] Cover the cost boundaries in `tests/unit/buildcost.test.ts` — 20,000 g succeeds and
      lands at exactly 0 g (the `>=` not `>` off-by-one); **19,999 g refuses** with a 1 g shortfall
      asserted in base units; an empty stockpile refuses up front rather than starting and stalling;
      and a brownout during a partly-built array does not lose build progress.
- [ ] T016 [US3] Gate array output on completion in `src/sim/production.ts` — an array under
      construction contributes exactly 0 Wh every turn until the turn it completes; a complete clean
      unstormed array contributes exactly 29,200 Wh. Tests in `tests/unit/production.test.ts`: turns
      1–2 of a 3-turn build all yield 0 Wh, the completion turn yields 29,200 Wh, and a mid-build
      brownout leaves progress intact.
- [ ] T017 [US3] Add the payback readout in `src/sim/solar.ts` — `computePayback({ embodiedWh,
      perTurnWh, turnsRemaining })` returning `{ embodiedWh, perTurnWh, paybackTurns,
      turnsRemaining, verdict }`, with `paybackTurns = ceilDiv(embodiedWh, perTurnWh)` (FR-010:
      1,200,000 / 29,200 → **42**, ceiling not floor, because a player told "41" with 41 turns left
      ends 1,200 Wh short) and a plain-language verdict when payback exceeds turns remaining. Tests
      in `tests/unit/solar.test.ts`: ratified array → 42 turns and a repays-verdict at turn 1;
      `turnsRemaining = 0` renders without dividing by zero and says it cannot repay;
      `turnsRemaining = 30` against 42 turns reports cannot-repay; `perTurnWh = 0` (a stormed-out
      array) is total and does not divide by zero.
- [ ] T018 [US3] Prove scale invariance in `tests/unit/solar.test.ts` — build the array
      specification at 5 m, 7.5 m and 10 m tile edges (silicon cost and output both scaling with
      area) and assert `paybackTurns` is **identical** in all three. This is the test that stops a
      future tuning argument about tile size from quietly breaking the central decision: the payback
      is `48,000 Wh/m² ÷ 1,168 Wh/m²/turn`, and the area cancels.

**Checkpoint**: US3 independently functional — the chain and its central mechanic are shippable here.

---

## Phase 5: US4 — Dust deposition and global dust storms (Priority: P2)

**Goal**: Soiling as an ongoing drone-hour labour tax, and seeded global storms that hit arrays and
leave reactors untouched.
**Independent Test**: 200 turns on a fixed seed with one never-cleaned array: output decays
monotonically, settles at exactly the 60% floor, storm windows match the world-gen schedule, and
reactor output is bit-identical to a run with the array absent.

- [ ] T019 [P] [US4] Add soiling decay in `src/sim/soiling.ts` — integer basis-point retention
      starting at `10_000`, per turn `floor(retention × 9_960 / 10_000)` (~0.4%/turn, from ~0.2%/sol
      measured by Spirit and Opportunity over 2.014 sols), floored at `4_000` bp = **60% cumulative
      loss cap**, plus `cleanArray()` restoring retention. No floats. Tests in
      `tests/unit/soiling.test.ts`: one turn of decay is exact; **at exactly the cap boundary** the
      capped output is produced on the turn the cap is reached and on the turn after, and never
      less; retention never reaches zero over 500 turns; cleaning restores retention.
- [ ] T020 [P] [US4] Add the storm schedule in `src/sim/storms.ts` —
      `generateStormSchedule(terrain, totalTurns)` drawing the **entire** schedule at world-gen from
      `terrain.seed` using the same `mulberry32` construction the rest of `src/sim/` uses (never
      per-turn sampling, which would couple storm generation to tick order and invalidate every
      golden trace on a later refactor), each storm 10–40 turns long at 8,000–9,500 bp of output
      loss, normalised into **disjoint sorted** intervals by merging overlaps with **max** severity.
      Plus `stormSeverityAt(schedule, turn)`. Tests in `tests/unit/storms.test.ts`: schedule is
      sorted and disjoint, durations and severities are inside the documented ranges, and a
      zero-length mission yields an empty schedule.
- [ ] T021 [US4] Compose soiling and storm onto array output in `src/sim/production.ts` — one fixed
      documented order (soiling, then storm), `floor(29_200 × retention/10_000 ×
      (10_000 − severity)/10_000)`, floored at 0 Wh, applied to arrays only. Tests in
      `tests/unit/production.test.ts`: soiled-and-stormed output is ≥ 0 and never below the floor;
      **reactor output is provably unchanged** across a storm window; and the composition never
      produces a non-integer.
- [ ] T022 [US4] Cover the storm interval edge cases in `tests/unit/storms.test.ts` — a storm that
      **begins mid-build** does not affect construction and applies to output only from the turn the
      array completes; an array **completed the same turn a storm starts** yields the stormed value
      that turn, not the clean value; two **overlapping** storms merge into one interval at max
      severity rather than multiplying; a storm spanning the mission end clamps to the final turn.
- [ ] T023 [US4] Add the seeded determinism acceptance test in
      `tests/integration/determinism-storms.test.ts` — **same seed → identical storm timing** is an
      acceptance criterion, so assert it: two worlds from seed S have deep-equal **full** schedules
      (not just the first storm), the schedule survives a serialise/deserialise round trip, and two
      278-turn runs with the same seed and same orders produce byte-identical ledger traces across a
      mission containing at least one storm **and** one soiling-cap event.

**Checkpoint**: US4 independently functional.

---

## Phase 6: Polish & Cross-Cutting (Priority: P3)

- [ ] T024 [P] Add chain cycle-report lines in `src/sim/cycleReport.ts` — silica produced, silica
      **discarded to cap** (never silently dropped), furnace idle with its typed reason, and array
      output with its soiling and storm multipliers broken out so a player can see *why* an array
      under-produced. Tests in `tests/unit/cycleReport.test.ts`: a clean turn, an overflow turn, and
      a stormed-and-idle turn.
- [ ] T025 [P] Add cleaning orders in `src/sim/soiling.ts` — a cleaning order consumes whole drone-turns
      from the same pool as construction (the **labour tax**: cleaning spends the exact whole drone-turns
      the player wants for building). Tests in `tests/unit/soiling.test.ts`: cleaning restores
      retention and reduces labour available for construction that turn; cleaning with zero
      whole drone-turns available is refused, not partially applied; cleaning an already-clean array is a
      no-op that spends nothing.
- [ ] T026 [P] Document balance hooks in `docs/balance/silica-solar.md` and close the gate — every
      tuning knob (soiling rate, 60% cap, storm duration/severity ranges, array `buildTurns`) in one
      place with its derivation and the cost of getting it wrong; then confirm
      `tests/unit/boundary.test.ts` passes **unmodified**, `npm run verify` is green, and
      `git grep -n "pv-array\|silicon-furnace\|silica-sifter" src/sim` matches only data files.

---

## Dependencies

- External: `aic-c75` + `aic-5ub` → Phase 1. `aic-m3t` + `aic-c1p` → Phase 2. `aic-wuo` → Phase 4.
- Phase 1 (Foundational) blocks all user stories.
- Phases 2 → 3 → 4 are **sequential by resource flow**, not parallel: the Furnace needs SiO₂ from
  the Sifter, the array needs Si from the Furnace. Parallelising them leaves the integration tests
  with nothing to consume.
- Phase 5 depends on Phase 4 (there must be an array to soil and storm).
- Phase 6 depends on Phases 1–5.
- Within-phase: T003 depends on T001 and T002. T007–T009 depend on T006. T011 and T012 depend on
  T010. T013 depends on T011 and T012. T015 depends on T014. T017 depends on T002 and T016. T018
  depends on T017. T021 depends on T019 and T020. T022 depends on T020. T023 depends on T021 and
  T022.

## Parallel Opportunities

- **Phase 1**: T001, T002, T004, T005 — four independent new files, fully parallel. T003 waits on
  T001 + T002.
- **Phase 5**: T019 and T020 are independent files and parallel; T021 joins them.
- **Phase 6**: T024, T025, T026 all touch different files — fully parallel.
- Phases 2, 3 and 4 have **no** cross-phase parallelism by design (see Dependencies).

## Task Count

**26 tasks** across 6 phases: Phase 1 (5), Phase 2 (4), Phase 3 (4), Phase 4 (5), Phase 5 (5),
Phase 6 (3).
