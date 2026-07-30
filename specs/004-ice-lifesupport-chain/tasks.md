# Tasks: Ice, Air & the Provisioned Habitat (Resource Chain 3 of 3)

**Input**: Design documents from `/specs/004-ice-lifesupport-chain/`
**Epic**: `aic-85z`
**Total**: 25 tasks

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001…T025): Sequential authoring IDs for this document
- **Bead IDs** (`aic-85z.N.M`): Assigned in `beads-import.md`
- **[P]**: Can run in parallel — used ONLY where tasks touch genuinely different files
- **[Story]**: User story label (US1…US4)

## TDD is mandatory for every task below (constitution §1)

Every task follows the same non-negotiable sequence, and a task is not done until step 8:

1. Write the failing test(s) first. 2. Run — confirm RED. 3. Confirm it fails for the RIGHT
reason (not a syntax error). 4. Implement the minimum. 5. Run — confirm GREEN. 6. Refactor,
re-run. 7. `npm test` for regressions. 8. `npm run test:coverage` still meets 80/70/60.

**Minimum 3 tests per public method**: happy path, error path, edge case.
**All quantities are integers** — grams for mass, watt-hours for energy. No floats.
**Paths are repo-relative.** The sim currently lives in a sibling worktree
(`worktrees/stetmann/src/sim/`); paths below are relative to the repo root on the
integration branch.

---

## Phase 1: Foundational

**Purpose**: Resource kinds, integer units, capped storage, the cycle report, and the
invariant that nothing leaves the simulation silently. Blocks every user story.

**Blocked by**: `aic-c75` (`storageCapacity`, `buildCost`, `siting.requiresDeposit`, integer
units, brownout total order) and `aic-5ub` (ledger integer units). Do NOT re-declare those
fields — extend what those beads deliver.

- [ ] **T001** Add canonical resource kinds and integer base units in `src/sim/resources.ts`
      (tests first in `tests/unit/resources.test.ts`). Export `water`, `oxygen`, `hydrogen`
      as named string constants alongside the existing `electricity` key, plus
      `GRAMS_PER_KILOGRAM` and `WATT_HOURS_PER_KILOWATT_HOUR`, plus two conversion helpers
      with **explicitly documented and tested** rounding direction: `massFromEnergy` floors
      (produced output is never fabricated) and `energyForMass` ceils (cost is never
      discounted). Also export `perTurnEnergyWh(powerWatts, config)` deriving watt-hours from
      `turnDurationSeconds(config)` in `src/sim/time.ts` — **never a hardcoded 49.66 h**.
      Tests: happy conversion both directions; `RangeError` on non-integer/negative input;
      edge — a mass whose energy is exactly divisible, and one that is one watt-hour short of
      the next gram (the rounding boundary in both directions).

- [ ] **T002** Extend catalog validation for the shared-foundation fields in
      `src/sim/catalog.ts` (tests first in `tests/unit/catalog.test.ts`). Require every
      `produces` / `consumes` / `storageCapacity` / `buildCost` amount to be a **non-negative
      integer** (today `validateResourceAmounts` accepts any finite non-negative number —
      tighten it, and reconcile with whatever `aic-c75` and `aic-5ub` land rather than adding
      a parallel validator). Validate `siting.requiresDeposit` as a non-empty resource key
      when present. Tests: valid spec with all four maps accepted; `RangeError` naming the
      structure and field on a fractional amount (e.g. `184.5`); edge — `0` accepted,
      `storageCapacity: {}` accepted (a structure that stores nothing is legal), empty
      `requiresDeposit` string rejected.

- [ ] **T003** [P] Add capped stockpile application in `src/sim/storage.ts` (tests first in
      `tests/unit/storage.test.ts`). Export `StorageCapacity` (a `ResourceAmounts` cap),
      `Overflow` (`{ resource, stored, discarded }`), `sumStorageCapacity(structures)`
      summing `storageCapacity` across **completed** structures only, and
      `applyCappedLedger(flows, stockpiles, capacity)` wrapping `applyLedger` from
      `src/sim/ledger.ts`. Mirror `ledger.ts`'s conventions exactly — pure, never throws,
      never mutates inputs, resources reported in sorted order, `Overflow` reported as typed
      data exactly like `Shortfall`. Tests: under capacity stores everything and reports no
      overflow; over capacity clamps to the cap and reports the discarded remainder;
      **edge — stockpile at EXACTLY capacity accepts zero further input, reports
      `stored: 0` and the full input as `discarded`, and does not go one gram over**;
      resource with no cap entry is uncapped and passes through unchanged.

- [ ] **T004** [P] Add the cycle-report channel in `src/sim/report.ts` (tests first in
      `tests/unit/report.test.ts`). Export a discriminated `CycleReportLine` union with the
      kinds this feature needs: `production`, `consumption`, `idle` (carrying the limiting
      resource), `overflow`, `vent`, `deposit-exhausted`, `life-support-unpowered`,
      `shortfall`. Export `buildCycleReport(lines)` returning them in a **deterministic total
      order** (by kind, then resource, then structure id — never Object/Map/Set iteration
      order). Tests: lines round-trip with their payloads intact; ordering is identical
      across two differently-ordered inputs with the same content; edge — an empty report is
      `[]`, never `undefined`, and a report with two lines identical but for structure id
      keeps both in a stable order.

- [ ] **T005** Add the three catalog entries as DATA in `src/sim/icechain.ts` (tests first in
      `tests/unit/icechain.test.ts`). Export `ICE_AUGER_SPEC` (1×1, 4 build turns, 15,000 W,
      `siting.requiresDeposit: 'ice'`, 1,800,000 g water/turn), `ELECTROLYSIS_STACK_SPEC`
      (2×2, 7 build turns, 25,000 W, 207,000 g water in), `LIFE_SUPPORT_RESERVE_SPEC` (2×2,
      5 build turns, 6,000 W standing draw, **produces nothing**, `storageCapacity` of one
      habitat-provision: 1,209,600 g O₂ + 840,000 g water), plus the derived energy constants
      `AUGER_ENERGY_WH_PER_KG = 400` and `ELECTROLYSIS_ENERGY_WH_PER_KG = 6000` with the
      derivations in comments (ice: 126 kJ/kg to warm 60 K at ~2.1 kJ/kg·K + 334 kJ/kg latent
      heat of fusion = 460 kJ/kg = 0.128 kWh/kg thermodynamic floor, budgeted at ~3× for
      mechanical work and heat leak; PEM: ~52 kWh/kg H₂ ≈ 6 kWh/kg water). **No logic branch
      per structure type** — these are specs passed to the existing `createCatalog`.
      Tests: all three specs pass `createCatalog` unmodified; the Reserve produces nothing and
      still has a non-empty `storageCapacity` (the first structure that is pure overhead);
      edge — **SC-001**: assert `floor(1_800_000 / 207_000) === 8`, so one Auger sustains
      exactly 8 Stacks and the ninth needs a second Auger and a second ice tile. A balance
      change that destroys that decision fails this test.

- [ ] **T006** Add the reconciliation invariant — "nothing is destroyed silently" — in
      `src/sim/storage.ts` and `src/sim/report.ts` (tests first in
      `tests/unit/storage.test.ts`). Export `reconcileResources(result)` asserting, per
      resource, that `produced === stored_delta + consumed + reported_discarded`, and have
      `applyCappedLedger` emit an `overflow` report line for **every** non-zero discard.
      Tests: a balanced turn reconciles with zero discrepancy; a turn with a capped overflow
      reconciles only because the discard is reported (assert the **report line**, not just
      the stockpile); **edge — a turn where a resource is produced, capped, AND consumed
      simultaneously still reconciles to the gram**. This is FR-007 and the most valuable
      test in the feature.

**Checkpoint**: Foundation ready — resource kinds, integer units, capped storage, cycle
report, and the reconciliation invariant all in place. User stories can begin.

---

## Phase 2: US1 — Ice Auger, ice-deposit-gated (Priority: P1)

**Goal**: A player can site an Ice Auger on a shallow-ice deposit and bank water every turn.
**Independent Test**: Build an Auger on an ice tile on a fixed-seed map, run 5 turns, assert
water is exactly 0 for turns 1–4 and exactly the catalogued yield on turn 5. Attempt the same
placement on a non-ice tile and assert a `deposit-required` rejection.

**Hard-blocked by**: `aic-m3t` — `MineralDeposit` is `{x, y, richness}` with **no resource
kind**, so there is nothing to gate on. And `aic-c1p` — `generateDeposits` has zero
production consumers today.

- [ ] **T007** [US1] Add the `deposit-required` placement rejection in
      `src/sim/placement.ts` (tests first in `tests/unit/placement.test.ts`). Add
      `DepositRequiredRejection { ok: false, reason: 'deposit-required', tile, requiredResource }`
      to the `PlacementRejection` union and check `structureType.siting?.requiresDeposit`
      against the typed deposits from `aic-m3t` inside `validatePlacement`. **Must not
      throw** — this is ordinary player error, per the module's existing convention. Tests:
      Auger on a tile with an ice deposit succeeds; Auger on a buildable tile with no deposit
      rejects with the tile coordinate and `requiredResource: 'ice'` and writes nothing to the
      grid; edge — a structure with **no** `siting` requirement is unaffected (regression
      guard on every existing placement path), and a tile carrying a deposit of the WRONG kind
      is rejected, not accepted.

- [ ] **T008** [P] [US1] Add the Auger's per-turn water yield in `src/sim/icechain.ts`
      (tests first in `tests/unit/icechain.test.ts`). Export
      `computeAugerWaterGrams(powerWatts, config)` deriving yield from energy:
      15,000 W × 178,775 s ÷ 3,600 = 744,895 Wh ÷ 400 Wh/kg = 1,862 kg, with the catalogued
      1,800,000 g documented as the deliberately **rounded-down** shipping figure. Derive
      from `turnDurationSeconds(config)`, never a literal. Tests: default config yields the
      documented figure; `RangeError` on a non-integer or negative power; edge — a shortened
      test turn cycle scales the yield proportionally (proves nothing is hardcoded), and the
      result is always an integer number of grams.

- [ ] **T009** [US1] Handle deposit depletion and exhausted-mid-build in
      `src/sim/icechain.ts` (tests first in `tests/unit/icechain.test.ts`). Export
      `drawFromDeposit(deposit, requestedGrams)` returning the grams actually available plus
      a depletion flag, and have a completed Auger over an exhausted deposit produce zero and
      emit a `deposit-exhausted` report line. Tests: a rich deposit satisfies the full
      request; a partially depleted deposit yields only what remains and flags depletion;
      **edge — an Auger four build turns in on a tile whose deposit is exhausted must NOT
      throw and must NOT complete into a permanently mute structure with no explanation:
      assert both the resulting state and the report line.**

- [ ] **T010** [US1] Add the integration path in `tests/integration/ice-auger.test.ts`
      (creates the `tests/integration/` directory). Wire terrain → typed ice deposits →
      placement → build turns → `applyCappedLedger` → stockpile across 6 turns on a fixed
      seed, asserting water is exactly 0 through the 4 build turns and exactly the catalogued
      yield thereafter, and that it lands in **capped** storage. This closes the exact
      `aic-c1p` failure mode — a pure function that is correct and that nothing calls. Tests:
      the 6-turn happy path; a brownout turn mid-build leaves build progress **unchanged**
      (neither advanced nor reset) and reports it; edge — two Augers on two separate ice tiles
      sum correctly and independently.

**Checkpoint**: US1 independently functional — water accumulates in capped storage from a
correctly-sited Auger.

---

## Phase 3: US2 — Electrolysis Stack + the hydrogen sink (Priority: P1)

**Goal**: Water becomes banked oxygen, and the hydrogen byproduct is banked, vented on
overflow, and **always reported**.
**Independent Test**: Seed water, run one turn with a completed Stack, assert water down
exactly 207,000 g and O₂ + H₂ produced summing to exactly 207,000 g. Pre-fill the H₂ tank to
capacity and assert the stockpile stays exactly at capacity **and** a vent line carries the
exact discarded grams.

- [ ] **T011** [US2] Add electrolysis stoichiometry and throughput in `src/sim/icechain.ts`
      (tests first in `tests/unit/icechain.test.ts`). Export
      `computeElectrolysis(waterGrams)` returning `{ oxygenGrams, hydrogenGrams }` computed as
      `hydrogen = round(water × 111 / 1000)` then **`oxygen = water − hydrogen`** — a
      subtraction, not a second multiplication, so mass conservation is a property of the
      code's shape rather than a coincidence of rounding. Also export
      `computeStackWaterGrams(powerWatts, config)`: 25,000 W × 178,775 s ÷ 3,600 =
      1,241,493 Wh ÷ 6,000 Wh/kg = 207 kg. Tests: 207,000 g in → 22,977 g H₂ + 184,023 g O₂;
      `RangeError` on non-integer or negative grams; **edge — for a range of inputs including
      1 g, 999 g and 207,000 g, `oxygen + hydrogen === water` EXACTLY, every time.**

- [ ] **T012** [US2] Add the hydrogen capped tank and vent-on-overflow in
      `src/sim/storage.ts` (tests first in `tests/unit/storage.test.ts`). Route the Stack's
      hydrogen through `applyCappedLedger` against a hydrogen capacity, emitting a `vent`
      report line (distinct from generic `overflow`) for a byproduct with **no consumer at
      all** — the case most likely to be dropped from the code entirely. Tests: tank with
      room banks everything and vents nothing; **tank at exactly capacity banks zero and
      vents exactly 22,977 g**; edge — tank 10,000 g below capacity stores 10,000 and vents
      12,977, and `stored + vented === produced`.

- [ ] **T013** [US2] Assert the vent and overflow report lines always appear, in
      `tests/unit/report.test.ts` and `src/sim/report.ts`. The failure mode here is not a
      wrong number — it is a number that never appears anywhere — so these tests assert the
      **report line**, not the stockpile. Tests: every non-zero vent produces exactly one
      `vent` line with the exact gram count; a zero-vent turn produces **no** vent line (no
      noise); edge — vent plus overflow plus shortfall in the same turn produce three
      distinct, deterministically-ordered lines, and `reconcileResources` passes only because
      all three were reported.

- [ ] **T014** [US2] Add binary idle on short water or short power in
      `src/sim/icechain.ts` (tests first in `tests/unit/icechain.test.ts`). A plant runs at
      **full rate or not at all** — never fractionally — and an idle emits an `idle` line
      naming the limiting resource. Tests: 207,000 g of water available → full run; 206,999 g
      → **fully idle**, consuming zero and producing zero, with `limitingResource: 'water'`;
      edge — short *power* idles the same way with `limitingResource: 'electricity'`, and a
      plant short of both reports a single deterministic limiting resource, not two lines.

**Checkpoint**: US2 independently functional — oxygen banks, hydrogen is accounted for to the
gram, and every disposal is on the record.

---

## Phase 4: US3 — Life Support Reserve + provisioned readiness (Priority: P1)

**Goal**: A habitat counts toward the win condition only once its O₂ and water margin is
banked — and stops counting if the tanks drain.
**Independent Test**: One completed 8-colonist habitat plus stock exactly at the margin ⇒
counted. Remove one gram of O₂, re-evaluate ⇒ not counted.

- [ ] **T015** [US3] Add the provisioning bill in `src/sim/provisioning.ts` (tests first in
      `tests/unit/provisioning.test.ts`). Export `OXYGEN_GRAMS_PER_COLONIST_DAY = 840` (NASA
      BVAD metabolic oxygen ~0.84 kg/person/day), `WATER_GRAMS_PER_COLONIST_DAY = 3500`,
      `OXYGEN_MARGIN_DAYS = 180`, `WATER_MARGIN_DAYS = 30`, and
      `habitatProvisionRequirement(occupancy)` returning integer grams. Tests: occupancy 8 ⇒
      exactly 1,209,600 g O₂ + 840,000 g water; `RangeError` on non-integer or negative
      occupancy; edge — occupancy 0 requires exactly zero of both (a habitat housing nobody
      is trivially provisioned), and occupancy 1 is exactly one eighth of the 8-colonist bill.

- [ ] **T016** [US3] Add placement-order allocation in `src/sim/provisioning.ts` (tests first
      in `tests/unit/provisioning.test.ts`). Export `allocateProvisions(habitats, stockpiles)`
      fully provisioning habitats in **placement order** and leaving the remainder
      unprovisioned — never spreading thin, because half-provisioned habitats count for
      nothing and spreading produces three zeros instead of one one. Tests: enough for all
      three provisions all three; **enough for one and a half provisions exactly one, fully,
      and the order is deterministic**; edge — enough for exactly one leaves zero remaining
      stock and still provisions that one; empty habitat list returns an empty allocation,
      never throws.

- [ ] **T017** [US3] Add three-factor readiness in `src/sim/mission.ts` (tests first in
      `tests/unit/mission.test.ts`). Extend `HabitatStructure` with the occupancy needed for
      a provisioning check and make `totalHabitatCapacity` count a habitat only if `built`
      **and** `provisioned` (**and** `rated` once Proposal 1 lands; if the field is absent,
      treat `rated` as satisfied with a documented TODO — never silently fail it).
      `provisioned` is **recomputed from current stockpiles on every call** — no cached or
      sticky boolean. Document and implement the ordering rule: a habitat completed on turn N
      first draws provisions on turn **N+1**. Tests: built + provisioned counts full
      capacity; built but one gram short of the O₂ margin contributes **exactly 0**, not a
      fraction; edge — a habitat completed **this** turn draws nothing this turn and is
      provisioned next turn (the ordering hazard), and re-evaluating identical inputs returns
      an identical verdict (still pure).

- [ ] **T018** [P] [US3] Position the Reserve's 6 kW cryo draw in the brownout TOTAL order in
      `src/sim/brownout.ts` (created by `aic-c75` — extend, do not re-create; tests first in
      `tests/unit/brownout.test.ts`). This is a consumer class the order has never had to rank
      before: a structure that **stores and produces nothing**, which a naive "producers
      first" rule idles first. **Life support ranks above production.** An unpowered Reserve
      emits a `life-support-unpowered` warning line and **loses no stock** this increment
      (boil-off explicitly deferred). Tests: with power for only one of {Reserve, Stack}, the
      Reserve wins and the Stack idles; the order is **total** — no two consumers ever tie, so
      the outcome is deterministic; edge — an unpowered Reserve holding cryogenic stock reports
      the warning and the stock is byte-identical before and after.

- [ ] **T019** [US3] Add the readiness fall-back integration test in
      `tests/integration/provisioned-readiness.test.ts`. Provision a habitat to exactly the
      margin, confirm readiness counts it, then drain the tank below the margin over
      subsequent turns and confirm readiness **falls back**. A cached boolean here is the
      single most likely bug in the whole feature, so this asserts the fall-back direction
      explicitly. Tests: provision → ready; drain → **not** ready; edge — refill back to the
      margin → ready again (readiness is not one-way in either direction), and three habitats
      with a draining shared tank lose readiness in reverse placement order, deterministically.

**Checkpoint**: US3 independently functional — the win condition now requires breathable air,
re-checked every turn.

---

## Phase 5: US4 — Latitude: ice wants poleward, sunlight wants the equator (Priority: P2)

**Goal**: Ice availability and solar insolation pull the landing site in opposite directions,
and the survey score makes the trade-off visible.
**Independent Test**: Same terrain seed at 10° and 45° latitude — the equatorial map yields
zero ice deposits, the mid-latitude map yields some, and the two score components move in
opposite directions.

**Hard-blocked by**: `aic-m3t` — `Terrain` exposes `elevation` only, with **no latitude at
all**. And `aic-c1p` — `landing.ts` never imports `buildability`, and no caller supplies its
`mineralDeposits` or `BuildabilityScorer` arguments.

- [ ] **T020** [US4] Add latitude curves in `src/sim/latitude.ts` (tests first in
      `tests/unit/latitude.test.ts`). Export `ICE_ONSET_LATITUDE_DEGREES = 38` (SWIM maps show
      shallow ice poleward of ~35–40°; Phoenix struck buried ice within centimetres at 68°N in
      2008; Curiosity measured only ~2 wt% water in equatorial soil),
      `iceAvailability(latitudeDegrees)` rising poleward, and
      `solarInsolation(latitudeDegrees)` peaking at the equator and falling poleward more
      steeply than cosine alone (poleward sites also suffer worse seasonal variation and more
      dust-storm exposure). Both return values in [0, 1]. Document in comments that the
      crossover point and the ~35°–50° contested band are **illustrative shapes, not published
      curves** — the argument does not depend on their exact position. Tests: `iceAvailability`
      is 0 at the equator and rises monotonically poleward; `solarInsolation` is maximal at the
      equator and falls monotonically poleward; edge — both are exactly bounded in [0, 1] at
      0° and 90°, both are symmetric about the equator (−45° behaves as +45°), and a
      non-finite or out-of-range latitude throws `RangeError`.

- [ ] **T021** [US4] Gate shallow-ice deposit generation on latitude in
      `src/sim/buildability.ts` (tests first in `tests/unit/buildability.test.ts`). Extend
      `generateDeposits` to emit typed ice deposits whose density is scaled by
      `iceAvailability(latitude)` from the terrain's latitude (`aic-m3t`), keeping the existing
      fixed row-major draw order and the `mulberry32(terrain.seed)` stream — the determinism
      ban still holds in full. Tests: a 45° terrain yields ice deposits, deterministically for
      its seed; **a 10° terrain yields ZERO ice deposits**; edge — identical
      `(terrain, latitude, options)` produce deeply-equal results across two calls, and
      existing non-ice deposit generation is unchanged (regression guard).

- [ ] **T022** [US4] Add ice and insolation as **separate named** score components in
      `src/sim/landing.ts` (tests first in `tests/unit/landing.test.ts`). Extend
      `ScoreBreakdown` with `iceAvailability` and `solarInsolation` fields and weight them into
      `scoreLandingSite`'s total. **They must appear separately, not netted into one number**,
      so the player sees a trade-off they can reason about. Also update the existing
      `'named scoring weight constants'` test asserting
      `BUILDABILITY_WEIGHT + DEPOSIT_PROXIMITY_WEIGHT <= 1` to cover the new weights —
      otherwise `scoreLandingSite`'s documented "no upper clamp is needed" reasoning silently
      stops holding and the score can exceed `SCORE_SCALE`. Tests: the same anchors at 10° and
      45° produce breakdowns whose ice and insolation components move in **opposite**
      directions; the total stays within `[0, SCORE_SCALE]` for adversarial inputs (all
      weights maxed, hulls at opposite corners of the largest legal grid); edge — the summed
      positive weights still satisfy the invariant, and a site with zero ice deposits scores a
      finite total rather than `NaN` or `Infinity`.

**Checkpoint**: US4 independently functional — the survey screen is now a strategic commitment,
not a scoring exercise.

---

## Phase 6: Polish & Cross-Cutting (Priority: P3)

- [ ] **T023** Add the provisioning readout and complete the cycle-report surface in
      `src/sim/report.ts` (tests first in `tests/unit/report.test.ts`). Export
      `summariseProvisioning(habitats, stockpiles)` reporting, per habitat, banked vs required
      O₂ and water and turns-of-margin remaining, and emit the per-turn production /
      consumption lines for the whole chain. Tests: a fully provisioned habitat reports 100%
      on both resources; a half-provisioned one reports the exact shortfall in grams; edge — a
      habitat with occupancy 0 reports as provisioned without dividing by zero.

- [ ] **T024** [P] Add the 50-turn replay determinism test in
      `tests/integration/ledger-determinism.test.ts`. Same seed plus same orders must produce a
      **byte-identical** trace across the full water/oxygen/hydrogen ledger, **including every
      overflow and vent line**, across at least 50 turns. This is the test that protects all
      eleven `spec.md` edge cases from silently regressing once balance work starts churning
      the constants. Tests: two runs of the same scenario serialise identically; a
      one-gram-different starting stockpile produces a *different* trace (the test can actually
      fail — it is not vacuously true); edge — a scenario that overflows, vents, brownouts and
      exhausts a deposit within the 50 turns still replays byte-identically, and
      `reconcileResources` passes on **every one** of the 50 turns.

- [ ] **T025** [P] Extract every balance tunable as a named exported constant and confirm the
      cross-cutting gates, in `src/sim/icechain.ts`, `src/sim/provisioning.ts`,
      `src/sim/latitude.ts` and `tests/unit/boundary.test.ts`. No magic numbers left inline:
      throughputs, margins, energy intensities, capacities, latitude onset and curve shapes are
      all named, commented with their derivation, and changeable without touching logic.
      Tests: every exported constant is a positive integer (or a documented [0, 1] ratio) and
      is actually referenced by the logic (no dead tunables); `boundary.test.ts` passes with
      all six new `src/sim/` modules present — **zero React imports** (constitution §4) and
      zero determinism-ban violations; edge — `npm run test:coverage` meets 80% lines / 70%
      branches / 60% functions across the new modules.

---

## Dependencies

**External blockers (reconcile, never duplicate):**

- `aic-c75` (shared foundation: `storageCapacity`, `buildCost`, `siting.requiresDeposit`,
  integer units, brownout total order) → blocks the **whole feature**, and Phase 1 in
  particular. `storageCapacity` is a hard requirement here, not a nice-to-have.
- `aic-5ub` (ledger integer units) → blocks Phase 1.
- `aic-m3t` (typed deposits + latitude) → **hard-blocks Phase 2 AND Phase 5**.
- `aic-c1p` (P0: `generateDeposits` has no production consumer; `landing.ts` never imports
  `buildability`) → blocks Phases 2 and 5.
- `aic-wuo` (tile scale) → **NOT a dependency.** Every figure here is per-colonist or
  per-kilogram, never per-square-metre; the chain is scale-invariant. Only footprints are in
  tiles, and those are counts, not areas. **This chain can proceed while tile scale is still
  being landed.**

**Internal:**

- Phase 1 (Foundational) blocks Phases 2, 3, 4 and 5.
- Phase 2 (US1) blocks Phase 3 (the Stack consumes the water the Auger banks) and Phase 5
  (latitude gates the deposits the Auger sites on).
- Phase 3 (US2) blocks Phase 4 (provisioning consumes the oxygen the Stack makes; the
  readiness test is meaningless without a real supply).
- Phase 6 (Polish) depends on Phases 3, 4 and 5.

**Task-level:**

- T001 → T002, T003, T004, T005
- T002 → T005
- T003, T004 → T006
- T005 → T007, T008
- T007, T008 → T009 → T010
- T008 → T011 → T012 → T013; T011 → T014
- T011 → T015 → T016 → T017 → T019; T014 → T018
- T020 → T021 → T022
- T017 → T023; T013, T019, T022 → T024; T022 → T025

## Parallel Opportunities

- **Phase 1**: T003 (`storage.ts`) and T004 (`report.ts`) run in parallel after T001 — genuinely
  different files.
- **Phase 2**: T008 (`icechain.ts`) runs in parallel with T007 (`placement.ts`).
- **Phase 4**: T018 (`brownout.ts`) runs in parallel with T015–T017 (`provisioning.ts`,
  `mission.ts`).
- **Phase 5** is the one real parallel *track*: it touches `latitude.ts`, `buildability.ts` and
  `landing.ts` with no overlap against the chain modules, so it can run alongside Phases 3–4
  once Phase 2, `aic-m3t` and `aic-c1p` are done.
- **Phase 6**: T024 (integration test) and T025 (constants + gates) run in parallel.
- Everything else is sequential. `[P]` is deliberately sparse — two tasks editing the same file
  are not parallel, whatever the dependency graph says.
