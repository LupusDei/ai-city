# Implementation Plan: Silica & Solar — the Photovoltaic Chain

**Branch**: `003-silica-solar-chain` | **Date**: 2026-07-30
**Epic**: `aic-sfq` | **Priority**: P1
**Beads prefix**: `aic-`

## Summary

Add resource chain 2 of 3 — Silica Sifter → Silicon Furnace → Photovoltaic Array — as catalog
**data** plus five small pure sim modules (siting, storage caps, production, build cost, solar
risk). The point of the feature is not the buildings: it is the **41-turn energy payback out of
278**, which makes an array obviously correct on turn 20 and obviously a trap on turn 250. That
payback is a property of silicon refining and Martian sunlight, not of our grid — it is identical at
5 m, 7.5 m and 10 m tiles because silicon cost and energy yield both scale with panel area and the
area cancels. A required deliverable is the UI-facing payback readout, because a trap the player
cannot see is just a bad rule.

## Scope & Sequencing

**This is a post-MVP-loop increment.** The MVP's job is to make the electricity/labour loop fun.
None of this ships before that loop is proven, and nothing here should pull an engineer off the core
loop. What this feature needs *now* is only that the shared foundation (`aic-c75`) lands with
`buildCost`, `siting.requiresDeposit`, `storageCapacity`, integer base units and a documented
brownout total order — those five seams are far cheaper before golden-trace baselines exist than
after. The Sifter, Furnace and array can wait. The seams cannot.

## Explicit Non-Goals (restated from spec.md — do not let these get built)

- **No intra-turn day/night phase system.** A turn is 2.014 sols = two complete day/night cycles,
  so solar output averages out *within* a turn and the per-turn average is **exact, not an
  approximation**. A sub-turn phase axis is pointless at this turn length.
- **Batteries are OUT OF SCOPE per constitution §8.** Diurnal smoothing — their textbook job — is
  deleted by the point above. Their only real role would be storm ride-through and brownout
  headroom, mechanics that do not exist yet. Defer until a mechanic demands them.
- No per-structure code branches. Structures are DATA.
- No React/DOM imports under `src/sim/`.

## Blocking Dependencies on Existing Beads

Reconciled against the tracker — **none of these are re-created here**.

| Bead | What it gives | Blocks |
|---|---|---|
| `aic-c75` | Shared foundation: `buildCost` (**hard requirement** — the 20 kg silicon cost has nowhere to live today, `consumes` is per-turn operating draw only), `siting.requiresDeposit`, `storageCapacity`, integer units, brownout total order | Whole feature; Phase 1 directly |
| `aic-m3t` | Typed deposits + latitude. **HARD BLOCKER on Phase 2** — `MineralDeposit` in `src/sim/buildability.ts` is `{ x, y, richness }` with **no resource kind**, so "must be sited on a silica deposit" is literally unimplementable until this lands | Phase 2 |
| `aic-c1p` | **P0 integration bug**: deposits are generated but never consumed. `generateDeposits` has zero production consumers and `src/sim/landing.ts` never imports `buildability`. Deposit-gated siting cannot be trusted until the seam is wired | Phase 2 |
| `aic-wuo` | Tile scale = 5 m | Phase 4 (per-tile output and silicon cost both derive from area — though note the payback **ratio** does not) |
| `aic-5ub` | Ledger integer units | Phase 1 |

## Bead Map

- `aic-sfq` — Root: Silica & Solar — the Photovoltaic Chain
  - `aic-sfq.1` — Phase 1 · Foundational: resource kinds, catalog entries, deposit siting, storage caps
    - `aic-sfq.1.1` — Resource kinds + integer base-unit helpers
    - `aic-sfq.1.2` — Solar/scale derivation constants
    - `aic-sfq.1.3` — Three catalog entries as data
    - `aic-sfq.1.4` — Deposit-gated siting validation
    - `aic-sfq.1.5` — Stockpile caps + overflow report
  - `aic-sfq.2` — Phase 2 · US1: Silica Sifter (P1)
    - `aic-sfq.2.1` — Production flow derivation with completeness gate
    - `aic-sfq.2.2` — Sifter deposit-gated siting integration
    - `aic-sfq.2.3` — Deposit exhaustion during and after build
    - `aic-sfq.2.4` — Sifter overflow clamp surfaced in report
  - `aic-sfq.3` — Phase 3 · US2: Silicon Furnace (P1)
    - `aic-sfq.3.1` — Binary idle gate + brownout total order
    - `aic-sfq.3.2` — Furnace SiO₂ → Si conversion in production
    - `aic-sfq.3.3` — Starved / brownout furnace idles wholly
    - `aic-sfq.3.4` — 80× over-feed and 110%-of-a-reactor integration test
  - `aic-sfq.4` — Phase 4 · US3: Photovoltaic Array + payback readout (P1)
    - `aic-sfq.4.1` — One-time `buildCost` debit at commit
    - `aic-sfq.4.2` — Exact-cost and one-gram-short boundaries
    - `aic-sfq.4.3` — Array output only when complete
    - `aic-sfq.4.4` — Payback readout (turns vs turns-remaining + verdict)
    - `aic-sfq.4.5` — Scale-invariance proof test
  - `aic-sfq.5` — Phase 5 · US4: Dust deposition + global dust storms (P2)
    - `aic-sfq.5.1` — Soiling decay with 60% cumulative cap
    - `aic-sfq.5.2` — Storm schedule drawn at world-gen from terrain seed
    - `aic-sfq.5.3` — Soiling × storm composition, arrays only
    - `aic-sfq.5.4` — Storm interval edge cases (mid-build, overlap, same-turn)
    - `aic-sfq.5.5` — Seeded determinism acceptance test
  - `aic-sfq.6` — Phase 6 · Polish: report lines, cleaning orders, balance hooks (P3)
    - `aic-sfq.6.1` — Cycle-report lines for the chain
    - `aic-sfq.6.2` — Cleaning orders as a drone-hour labour tax
    - `aic-sfq.6.3` — Balance hooks + boundary/coverage gate

## Technical Context

**Stack**: TypeScript 5.7 strict, ESM, no runtime dependencies. Vitest 4 + `@vitest/coverage-v8`.
**Storage**: In-memory pure data. No DB, no I/O in `src/sim/`.
**Testing**: Vitest. Unit tests in `tests/unit/<module>.test.ts`, integration in
`tests/integration/<boundary>.test.ts`. (Note: the repo convention is a top-level `tests/`, not the
`backend/tests/` path in `.claude/rules/03-testing.md` — there is no `backend/` directory in this
project.)
**Commands**: `npm run typecheck`, `npm run build`, `npm test`, `npm run test:coverage`,
`npm run verify`.
**Constraints**:
- Integer base units only — watt-hours and grams. No floats in the ledger.
- Determinism: no `Math.random`, `Date.now`, `new Date`, or iteration over Object/Map/Set key order
  anywhere under `src/sim/`. Enforced automatically by `tests/unit/boundary.test.ts`.
- Zero React/DOM imports under `src/sim/` (constitution §4).
- TDD mandatory (constitution §1): failing test first, ≥3 tests per public method, coverage
  80 lines / 70 branches / 60 functions.

## Architecture Decision

**New composing modules, not edits to existing validated ones.** Four decisions worth stating:

1. **Deposit gating goes in a new `src/sim/siting.ts`, not into `placement.ts`.**
   `validatePlacement(grid, structureType, anchor)` is already a clean, fully-tested boundary that
   knows only about bounds and occupancy. Threading a deposit list through it would change its
   signature and couple it to `buildability.ts`. Instead `siting.ts` composes: it calls
   `validatePlacement` first, then applies the deposit requirement, and widens the rejection union
   with `deposit-required`. Same discriminated-union, never-throws contract as `placement.ts`.

2. **Storage caps go in a new `src/sim/storage.ts` wrapping `applyLedger`, not inside it.**
   `ledger.ts` is deliberately ignorant of what produced a flow and never throws. Capping is a
   separate concern with its own output (the discarded amount, which must be *reported* — silent
   overflow discard is a ledger bug that will not surface until balance work, when it will look like
   a balance problem). `storage.ts` calls `applyLedger` and then clamps, returning
   `{ ...ledgerResult, discarded }`.

3. **`src/sim/production.ts` is the one place that decides whether a structure contributes a flow
   this turn.** It answers: is it complete? is it fed? is it powered? is it soiled or stormed? It
   emits a `readonly ResourceFlow[]` — exactly what `applyLedger` already accepts, structurally, no
   adapter. This is what keeps "structures are DATA" true: incomplete-produces-nothing, binary idle,
   soiling and storms are all *one* generic pipeline applied to catalog rows, not per-type branches.

4. **Soiling uses integer basis points, not a float multiplier.** Retention starts at `10_000` bp
   and each turn becomes `floor(retention * 9_960 / 10_000)`, floored at `4_000` bp. This is
   deterministic integer arithmetic, monotone, and reproducible byte-for-byte — a compounding
   float `× 0.996` is order-dependent and is exactly the drift the integer-units rule exists to
   prevent. Output is `floor(29_200 * retention / 10_000)`.

**Storm schedule at world-gen, not per-turn sampling.** Drawn once from `terrain.seed` via the same
`mulberry32` construction, so the whole schedule is fixed and inspectable before turn 1. Per-turn
sampling would advance the RNG stream on every tick and couple storm generation to turn order; a
later refactor of tick ordering would then invalidate every golden trace, and the failure would look
like a determinism bug rather than a design choice. Overlaps are merged into disjoint sorted
intervals taking **max** severity, never multiplied.

## Files Changed

| File | Change |
|---|---|
| `src/sim/resources.ts` | **New.** Resource kind constants (`SILICA`, `SILICON`, `ELECTRICITY`), base-unit types (`Grams`, `WattHours`), and the single documented `wattHoursPerTurn(kilowatts, turnSeconds)` rounding helper (FR-002). |
| `src/sim/solar.ts` | **New.** Ratified derivation constants (tile 5 m / 25 m², 1.168 kWh/m²/turn, 48 kWh/m² embodied, 29,200 Wh/turn, 20,000 g Si) and `computePayback()` with the ceiling rule. |
| `src/sim/silicaChain.ts` | **New.** The three `StructureTypeSpec` rows as data, in integer base units, with derivations in comments. |
| `src/sim/siting.ts` | **New.** `validateSiting()` composing `validatePlacement` with `siting.requiresDeposit`; adds `deposit-required` rejection. |
| `src/sim/storage.ts` | **New.** `applyCappedLedger()` — clamps stockpiles to `storageCapacity` and reports `discarded`. |
| `src/sim/production.ts` | **New.** `collectProductionFlows()` — completeness gate, feedstock gate, power gate (binary idle), output modifiers. The one generic pipeline. |
| `src/sim/brownout.ts` | **New.** The documented total shed order + `resolveBrownout()`. |
| `src/sim/buildcost.ts` | **New.** `commitBuildCost()` — one-time debit at commit, `insufficient-resources` typed rejection, `>=` boundary. |
| `src/sim/soiling.ts` | **New.** Integer basis-point retention decay, 60% cap, `cleanArray()`. |
| `src/sim/storms.ts` | **New.** `generateStormSchedule(terrain)` — seeded, normalised, disjoint; `stormSeverityAt(schedule, turn)`. |
| `src/sim/cycleReport.ts` | **New.** Chain report lines (silica produced/discarded, furnace idle reason, array output with multipliers broken out). |
| `src/sim/catalog.ts` | **No change in this feature** — `buildCost`, `siting`, `storageCapacity` and integer validation all arrive via `aic-c75`. |
| `src/sim/ledger.ts`, `placement.ts`, `terrain.ts`, `buildability.ts`, `grid.ts` | **No change.** Composed, never edited. |
| `tests/unit/resources.test.ts`, `solar.test.ts`, `silicaChain.test.ts`, `siting.test.ts`, `storage.test.ts`, `production.test.ts`, `brownout.test.ts`, `buildcost.test.ts`, `soiling.test.ts`, `storms.test.ts`, `cycleReport.test.ts` | **New.** Written first, red before green. |
| `tests/integration/silica-chain.test.ts` | **New.** Sifter → Furnace → Array over many turns. |
| `tests/integration/determinism-storms.test.ts` | **New.** Same seed + same orders → byte-identical ledger across a mission with a storm and a soiling-cap event. |
| `tests/unit/boundary.test.ts` | **No change.** Must keep passing unmodified. |
| `docs/balance/silica-solar.md` | **New.** Tuning knobs and their derivations, so a future balance pass changes numbers in one place. |

## Phase 1: Foundational

Resource kinds, the derivation constants, the three catalog rows, deposit-gated siting, and
stockpile caps. Nothing here is player-visible; everything else depends on it. Blocked by `aic-c75`
(the catalog fields) and `aic-5ub` (integer ledger units). Contains the single rounding helper that
makes FR-002 enforceable rather than aspirational — every non-integral per-turn energy figure in the
catalog goes through it, so "397,278" is derived once and never hand-typed twice.

## Phase 2: US1 — Silica Sifter (P1)

The production seam plus deposit gating. `production.ts` arrives here because "producing into a
capped stockpile" *is* the production seam, and US1 is the smallest slice that proves it end to end.
**Hard-blocked by `aic-m3t`** (typed deposits — without a resource kind on `MineralDeposit` the
requirement is unimplementable) and by `aic-c1p` (deposits are generated but never consumed;
`landing.ts` never imports `buildability`, so the seam is not wired and gating cannot be trusted).

## Phase 3: US2 — Silicon Furnace (P1)

Binary idle and the brownout total order, then the conversion itself. The Furnace is the hardest
case for the brownout rule at 90% of a whole reactor, which is exactly why the rule gets written
here rather than assumed. This phase is where the 80× over-feed from the Sifter becomes visible, and
where Sifter + Furnace at 44 kW = 110% of one reactor forces a second reactor online.

## Phase 4: US3 — Photovoltaic Array + payback readout (P1)

The `buildCost` debit, the output contribution, and the readout. The readout is **not** polish: it
is the delivery mechanism for the entire mechanic. Blocked by `aic-wuo` (tile scale) because
per-tile output and silicon cost both derive from area — though the payback ratio itself does not
move, which is what the scale-invariance test in `aic-sfq.4.5` pins down so that no future
tuning argument about tile size can quietly break the central decision.

## Phase 5: US4 — Dust deposition and global dust storms (P2)

Soiling as an ongoing **labour tax** (cleaning spends the exact whole drone-turns wanted for
construction), and storms as a seeded, world-gen-fixed schedule that hits arrays and leaves reactors
untouched. The asymmetry is the strategic payload: "how much of your power base do you dare put on
sunlight" becomes a genuine decision. Determinism here is an acceptance criterion with a test, not a
note — a storm from unseeded randomness would break the golden-trace harness *intermittently*, which
is the worst failure mode there is.

## Phase 6: Polish & Cross-Cutting (P3)

Cycle-report lines, drone cleaning orders, balance hooks, and the final boundary + coverage gate.

## Parallel Execution

- Within Phase 1, `resources.ts`, `solar.ts`, `siting.ts` and `storage.ts` are four independent
  files and can be written simultaneously; `silicaChain.ts` depends on `resources.ts` and
  `solar.ts` for its constants.
- Phases 2 → 3 → 4 are **sequential by resource flow**: the Furnace needs SiO₂ from the Sifter, the
  array needs Si from the Furnace. Do not parallelise them; the integration tests would have nothing
  to consume.
- Within Phase 5, `soiling.ts` and `storms.ts` are independent files and parallel; the composition
  task depends on both.
- Within Phase 6, all three tasks touch different files and are parallel.

## Verification Steps

- [ ] `npm run typecheck` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `npm test` passes; `npm run test:coverage` meets 80 lines / 70 branches / 60 functions.
- [ ] `tests/unit/boundary.test.ts` passes **unmodified** — no React/DOM imports, no `Math.random`
      or `Date.now` under `src/sim/`.
- [ ] `git grep -n "pv-array\|silicon-furnace\|silica-sifter" src/sim` matches only data files —
      never a conditional in simulation logic.
- [ ] `git diff --stat src/sim/catalog.ts src/sim/ledger.ts src/sim/placement.ts src/sim/terrain.ts`
      is empty for this branch.
- [ ] Manual: site a Sifter off-deposit, confirm the rejection message names `silica` and the grid
      is unchanged.
- [ ] Manual: with 19,999 g of silicon, confirm the array build is refused before any tile or
      drone-turn is committed; with 20,000 g confirm it starts and the stockpile reads exactly 0.
- [ ] Manual: open the build panel at turn 1 and at turn 250 and confirm the payback verdict flips.
- [ ] Manual: run two 278-turn missions on the same seed with the same orders and diff the ledger
      traces — byte-identical, including storm windows.
