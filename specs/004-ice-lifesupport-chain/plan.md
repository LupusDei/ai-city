# Implementation Plan: Ice, Air & the Provisioned Habitat (Resource Chain 3 of 3)

**Branch**: `004-ice-lifesupport-chain` | **Date**: 2026-07-30
**Epic**: `aic-85z` | **Priority**: P2 (post-MVP-loop increment)

## Summary

Add the third factor of habitat readiness — **provisioned** — and with it the game's first
**stored** (rather than flowed) resource. Three new catalog entries (Ice Auger → Electrolysis
Stack → Life Support Reserve) turn a latitude-gated shallow-ice deposit into banked oxygen
and water; a habitat only counts toward the win condition once the colony has banked the
margin for the colonists it claims to house, **re-checked every evaluation**. The load-bearing
engineering work is not the chain — it is capped storage, the reconciliation invariant that
**no resource leaves the simulation without a cycle-report line**, and the hydrogen sink that
the MVP has nothing to do with.

**This is a post-MVP-loop increment.** It ships after the MVP's electricity/labour loop is
proven fun. Nothing here competes with that loop for the next slice of work.

## Scheduling advantage: this chain does NOT depend on `aic-wuo` (tile scale)

State this plainly, because it changes when the work can start. Every figure in this feature
is **per-colonist or per-kilogram** — 840 g O₂ per person per day, 6,000 Wh per kg of water,
400 Wh per kg of ice — and not one of them is per-square-metre. The chain is therefore
**scale-invariant**: when the tile scale moved from 10 m to 5 m, nothing above would have had
to change. Only the footprints (1×1, 2×2) are expressed in tiles, and those are **counts, not
areas**.

Consequence: **this chain can proceed while tile scale is still being landed.** Its siblings
(a per-m² solar array, a per-m² regolith shielding depth) cannot make that claim.

## Dependencies on EXISTING beads — reconcile, never duplicate

| Bead | What it owns | Relationship to this feature |
|---|---|---|
| `aic-c75` | Shared foundation: `storageCapacity`, `buildCost`, `siting.requiresDeposit`, integer units, brownout total order | **Blocks the whole feature.** `storageCapacity` is a **hard requirement here specifically** — this is the first chain with stored rather than flowed resources, and a Reserve without a cap is not a tank, it is a hole. The other two chains can limp without caps; this one cannot exist without them. Do **not** re-declare any of these five fields. |
| `aic-m3t` | Typed deposits + latitude on terrain | **HARD BLOCKER on Phase 2 AND Phase 5.** Today `MineralDeposit` is `{x, y, richness}` with **no resource kind**, and `Terrain` exposes `elevation` only, with **no latitude at all**. The ice-deposit gate needs the kind; the entire latitude tension needs latitude. |
| `aic-c1p` | P0 integration bug | **Blocks Phases 2 and 5.** `generateDeposits` has **zero production consumers**, and `landing.ts` never imports `buildability` — deposit-gated siting and deposit-aware site scoring are not actually wired to anything. Verified against source: `src/sim/landing.ts` takes `mineralDeposits: readonly Coord[]` and a `BuildabilityScorer` callback from its caller, and no caller exists. Building on top of that wiring before it is fixed means building on nothing. |
| `aic-5ub` | Ledger integer units | **Blocks Phase 1.** `time.ts` argues at length that integers are non-negotiable for determinism; `catalog.ts` then accepts any finite non-negative number and `ledger.ts` sums whatever it is handed. A provisioning margin check that hinges on 1209599.99999 vs 1209600 is the difference between "ready" and "not ready" on identical inputs. |
| `aic-wuo` | Tile scale (1 tile = 5 m) | **NOT a dependency.** See the scheduling-advantage section above. |
| `aic-74p.3` | Survey screen site scoring | Consumer of Phase 5's new score components. Latitude belongs on the site as a shared enabler (`aic-m3t`), added once, not inside either chain. |

## Bead Map

```
aic-85z — Ice, Air & the Provisioned Habitat (Resource Chain 3 of 3)
│
├── aic-85z.1 — Phase 1 · Foundational: resources, capped storage, the ledger invariant
│   ├── aic-85z.1.1 — T001 water/oxygen/hydrogen kinds + integer base units
│   ├── aic-85z.1.2 — T002 catalog validation: integer units, storageCapacity, siting
│   ├── aic-85z.1.3 — T003 capped stockpile application + overflow accounting
│   ├── aic-85z.1.4 — T004 cycle-report channel (typed, deterministically ordered)
│   ├── aic-85z.1.5 — T005 the three catalog entries, as DATA
│   └── aic-85z.1.6 — T006 reconciliation invariant: nothing destroyed silently
│
├── aic-85z.2 — Phase 2 · US1 (P1): Ice Auger, ice-deposit-gated
│   ├── aic-85z.2.1 — T007 deposit-required placement rejection
│   ├── aic-85z.2.2 — T008 auger water yield per turn (energy-derived)
│   ├── aic-85z.2.3 — T009 deposit depletion + exhausted-mid-build
│   └── aic-85z.2.4 — T010 integration: auger water into capped storage
│
├── aic-85z.3 — Phase 3 · US2 (P1): Electrolysis Stack + the hydrogen sink
│   ├── aic-85z.3.1 — T011 stoichiometry + throughput, mass-exact
│   ├── aic-85z.3.2 — T012 hydrogen capped tank + vent on overflow
│   ├── aic-85z.3.3 — T013 vent/overflow report lines always emitted
│   └── aic-85z.3.4 — T014 binary idle on short water or short power
│
├── aic-85z.4 — Phase 4 · US3 (P1): Life Support Reserve + provisioned readiness
│   ├── aic-85z.4.1 — T015 provisioning bill (per-colonist margins)
│   ├── aic-85z.4.2 — T016 allocation in placement order
│   ├── aic-85z.4.3 — T017 three-factor readiness, recomputed every call
│   ├── aic-85z.4.4 — T018 Reserve's 6 kW position in the brownout total order
│   └── aic-85z.4.5 — T019 integration: readiness falls back when a tank drains
│
├── aic-85z.5 — Phase 5 · US4 (P2): latitude — ice poleward, sun equatorial
│   ├── aic-85z.5.1 — T020 ice-availability + insolation curves by latitude
│   ├── aic-85z.5.2 — T021 ice deposit generation gated on latitude
│   └── aic-85z.5.3 — T022 ice + insolation as separate site-score components
│
└── aic-85z.6 — Phase 6 · Polish (P3): reports, readouts, balance hooks
    ├── aic-85z.6.1 — T023 provisioning readout + full cycle-report surface
    ├── aic-85z.6.2 — T024 50-turn byte-identical replay determinism
    └── aic-85z.6.3 — T025 balance hooks as named constants + boundary/coverage gate
```

## Technical Context

**Stack**: TypeScript (strict), pure functions over plain readonly data. No classes, no I/O,
no clock inside `src/sim/`.
**Storage**: In-memory immutable records. `Stockpile` is `Readonly<Record<string, number>>`
keyed by open resource strings — this feature adds **keys**, never branches.
**Testing**: Vitest. Unit tests in `tests/unit/<module>.test.ts`, integration in
`tests/integration/<boundary>.test.ts` (repo currently has `tests/unit/` only; Phase 2
creates `tests/integration/`).
**Constraints**:
- **TDD is mandatory** (constitution §1): failing test first, ≥3 tests per public method
  (happy / error / edge), coverage 80% lines / 70% branches / 60% functions.
- **Integer base units only** — grams and watt-hours. No floats in stored or reported values.
- **Sim-only, zero React imports** (constitution §4).
- **Determinism ban** — no `Math.random`, `Date.now`, `new Date`, or reliance on
  Object/Map/Set iteration order. Already enforced automatically for everything under
  `src/sim/` by `tests/unit/boundary.test.ts`.
- **Structures are DATA** — new catalog entries only, no logic branch per structure type.

**Paths are repo-relative.** The sim currently lives in a sibling worktree
(`worktrees/stetmann/src/sim/`); every path below is relative to the repository root as it
will be on the integration branch.

## Architecture Decision

**Extend `ledger.ts`, do not replace it.** `ledger.ts` is already correct for flows and is
deliberately decoupled from `catalog.ts` (it accepts anything shaped
`{ produces, consumes }`). Capping is a **different concern** — it needs a capacity map and
it must report what it discarded — so it goes in a new `src/sim/storage.ts` that consumes
`LedgerResult` and applies caps on top. Rationale:

1. `applyLedger`'s existing contract ("stockpiles never go below zero, shortfalls reported as
   typed data") is the exact shape the cap needs at the top end ("stockpiles never go above
   capacity, overflow reported as typed data"). Mirroring it means a reviewer who understands
   `Shortfall` understands `Overflow` for free.
2. Not touching `applyLedger`'s signature keeps every existing ledger test valid, and keeps
   the MVP's flow-only path free of a capacity argument it has no use for.
3. The reconciliation invariant (FR-007) then has exactly **one** place to live — the seam
   where a quantity could be dropped — rather than being scattered across producers.

**Rejected: a `Tank` entity per structure.** Per-structure tanks would mean routing, which
means a transport model, which is not in scope and buys nothing the player can see. Capacity
sums colony-wide across completed structures; the Reserve is "a storage cap wearing a
footprint" and nothing more.

**Rejected: fractional throughput under brownout.** Binary idle instead. Fractional rates
reintroduce rounding drift and make the cycle report much harder to explain. "The stack was
idle this turn" is a sentence a player can act on; "the stack ran at 62% and produced
114.08 kg" is not.

**Stoichiometry is computed as a subtraction, not two multiplications.**
`h2 = round(water × 111 / 1000)`, then `o2 = water − h2`. Two independent roundings can lose
or fabricate a gram; a subtraction cannot. Mass conservation becomes a property of the code's
shape rather than a coincidence of the numbers.

## Files Changed

| File | Change |
|---|---|
| `src/sim/resources.ts` | **NEW** — canonical `water`/`oxygen`/`hydrogen` resource keys, integer base units (grams, watt-hours), and the documented floor-output/ceil-cost conversion helpers. |
| `src/sim/storage.ts` | **NEW** — `applyCappedLedger`, `StorageCapacity`, `Overflow`, and the per-resource reconciliation invariant. Mirrors `ledger.ts`'s conventions exactly. |
| `src/sim/report.ts` | **NEW** — typed `CycleReportLine` union (production, consumption, idle, overflow, vent, deposit-exhausted, life-support-unpowered, shortfall) in deterministic sorted order. |
| `src/sim/icechain.ts` | **NEW** — the three catalog specs as DATA plus their derived energy/throughput constants and the pure per-turn conversion functions. |
| `src/sim/provisioning.ts` | **NEW** — per-colonist provisioning bill, `allocateProvisions` (placement order), `isProvisioned`. |
| `src/sim/latitude.ts` | **NEW** — ice-availability and solar-insolation curves as functions of latitude. |
| `src/sim/catalog.ts` | Extend validation for integer units and the `storageCapacity` / `siting` fields. **Reconcile with `aic-c75`** — extend its validator, do not add a second one. |
| `src/sim/placement.ts` | Add a typed `deposit-required` rejection to `validatePlacement`'s discriminated union. Never throws — matches the existing convention. |
| `src/sim/buildability.ts` | Gate shallow-ice deposit generation on latitude; consume the typed deposit kind from `aic-m3t`. |
| `src/sim/landing.ts` | Add ice-availability and insolation as **separate named** `ScoreBreakdown` components. Note the existing weight invariant test (`BUILDABILITY_WEIGHT + DEPOSIT_PROXIMITY_WEIGHT <= 1`) must be updated to cover the new weights, or `scoreLandingSite`'s documented "no upper clamp needed" reasoning silently stops holding. |
| `src/sim/mission.ts` | Three-factor readiness. `HabitatStructure` gains occupancy-based provisioning; `totalHabitatCapacity` counts only habitats passing every factor. |
| `src/sim/brownout.ts` | Position the Reserve's 6 kW cryo draw in the documented TOTAL order (created by `aic-c75` — extend, do not re-create). |
| `tests/unit/{resources,storage,report,icechain,provisioning,latitude}.test.ts` | **NEW** unit suites. |
| `tests/unit/{catalog,placement,buildability,landing,mission}.test.ts` | Extended for the changes above. |
| `tests/integration/ice-auger.test.ts` | **NEW** — auger → capped storage across turns. |
| `tests/integration/provisioned-readiness.test.ts` | **NEW** — readiness fall-back when a tank drains. |
| `tests/integration/ledger-determinism.test.ts` | **NEW** — 50-turn byte-identical replay. |

## Phase 1: Foundational

**Purpose**: everything the three user stories share, and the invariant that makes the whole
feature trustworthy.

Order matters here. Resource kinds and integer units come first (T001) because every other
task's test data is expressed in them. Catalog validation (T002) comes next so the three
catalog entries (T005) are validated against a rule that actually exists rather than added
and retro-fitted. Capped storage (T003) and the report channel (T004) are genuinely
independent files and run in parallel. The reconciliation invariant (T006) comes last because
it needs both — it is the test that asserts `produced == stored_delta + consumed +
reported_discarded` for every resource, every turn, and it is the single most valuable test
in this feature.

Blocked by `aic-c75` (the five shared-foundation fields) and `aic-5ub` (ledger integer units).

## Phase 2: US1 — Ice Auger (P1)

Placement gains a `deposit-required` rejection; the Auger's yield is derived from energy
(15,000 W × turn seconds ÷ 3,600 = 744,895 Wh ÷ 400 Wh/kg = 1,862 kg, catalogued as
1,800,000 g — rounded **down**, deliberately) rather than asserted.

Two hazards get their own tasks because they are where this phase silently goes wrong:
deposit depletion (T009 — an Auger that completes onto an exhausted tile must not throw and
must not become a permanently mute structure with no explanation), and the integration path
(T010 — the yield must actually arrive in *capped* storage, not just be returned by a pure
function nobody calls; this is precisely the `aic-c1p` failure mode repeating).

**Hard-blocked by `aic-m3t`** (typed deposits — there is no ice deposit kind today) and
`aic-c1p` (deposit generation has no production consumer).

## Phase 3: US2 — Electrolysis Stack + the hydrogen sink (P1)

Throughput: 25,000 W × turn seconds ÷ 3,600 = 1,241,493 Wh ÷ 6,000 Wh/kg = 207 kg water per
turn → 184,023 g O₂ + 22,977 g H₂, summing to exactly 207,000 g.

The hydrogen sink is the reason this phase is three tasks and not one. T012 gives hydrogen a
capped tank; T013 asserts the **report line**, not the stockpile — because the failure mode
here is not a wrong number, it is a number that never appears anywhere. T014 makes short
water or short power a binary idle with a named limiting resource, so "why did nothing happen
this turn" is always answerable.

## Phase 4: US3 — Life Support Reserve + provisioned readiness (P1)

The win-condition change. T015/T016 own the arithmetic and the allocation rule (fully
provision in placement order — spreading thin produces three zeros instead of one one).
T017 is the dangerous one: `provisioned` must be **recomputed from current stockpiles on
every evaluation**. A cached boolean here is the single most likely bug in the whole feature,
so the test asserts the *fall-back* direction explicitly, not just the happy direction.

T018 places the Reserve's 6 kW in the brownout total order. This is a consumer class the
order has not had to rank before — a structure that stores and produces nothing — so a naive
"producers first" order idles it first. Life support ranks **above** production; an unpowered
Reserve is a reported warning, and no stock is lost this increment.

## Phase 5: US4 — Latitude: ice poleward, sun equatorial (P2)

The strategic centrepiece. Ice availability rises poleward of ~35–40°; insolation peaks at
the equator; the two components appear **separately** in the score breakdown so the player
sees a trade-off rather than one netted number they cannot reason about.

**Hard-blocked by `aic-m3t`** — `Terrain` has no latitude field at all today — and by
`aic-c1p`, since `landing.ts` never imports `buildability` and no caller supplies its
`mineralDeposits` or `BuildabilityScorer` arguments.

Deferred deliberately: the exact crossover point and contested-band width are illustrative
shapes, not published curves, and are exposed as named constants (T025) so balance can move
them without touching logic.

## Phase 6: Polish (P3)

The determinism replay (T024) is the load-bearing task, not the readouts. A 50-turn
byte-identical trace including every vent and overflow line is what protects all eleven edge
cases from regressing silently once balance work starts churning the constants.

## Parallel Execution

- **Phase 1**: T003 (`storage.ts`) and T004 (`report.ts`) are genuinely independent files and
  run in parallel after T001. T002 (`catalog.ts`) is also independent of both.
- **Phases 3 and 4** must be sequential — provisioning consumes the oxygen the Stack makes,
  and the readiness test is meaningless without a real supply.
- **Phase 5** is independent of Phases 3 and 4 (it touches `latitude.ts`, `buildability.ts`,
  `landing.ts` — no overlap with the chain modules) and can run in parallel with them once
  Phase 2 and `aic-m3t` / `aic-c1p` are done. This is the one real parallel track.
- **Phase 6** requires 3, 4 and 5 complete.
- `[P]` in `tasks.md` is used **only** where two tasks touch genuinely different files.

## Recommended NEXT feature (not planned here)

**MOXIE-style atmospheric CO₂ electrolysis.** MOXIE on Perseverance produced oxygen directly
from the Martian atmosphere at up to ~12 g/hour on ~300 W — on the order of 25 kWh/kg O₂, or
25–50 kWh/kg allowing for duty cycle and warm-up, against ~6.75 kWh/kg via water
electrolysis. So it is 4–7× worse per kilogram **but needs no ice deposit and works
anywhere**: precise **bad-site insurance** for a player who committed to an equatorial solar
site and now cannot reach ice. It is a strictly better follow-up than a battery, because it
interacts with a decision the player already made instead of smoothing one out — and it only
makes sense once there is a committed site to regret.

The **Sabatier / methane chain** (CO₂ + 4H₂ → CH₄ + 2H₂O) stays out per constitution §8.
Three chains already justify the shared foundation; a fourth speculative one justifies
nothing and costs review time. Banking hydrogen to a capped tank leaves that door open
without designing methane now.

## Verification Steps

- [ ] `npm run build` exits 0; `npm test` passes; `npm run test:coverage` meets 80/70/60.
- [ ] `tests/unit/boundary.test.ts` passes with the six new `src/sim/` modules present — zero
      React imports, zero determinism-ban violations.
- [ ] Grep the diff for float literals in resource quantities: every mass is grams, every
      energy is watt-hours, all integers.
- [ ] Place an Auger on a non-ice tile: rejected with `deposit-required`, does not throw.
- [ ] Fill the H₂ tank, run one turn: stockpile sits **exactly** at capacity and the cycle
      report names the vented grams.
- [ ] Provision one habitat exactly to the margin, remove one gram of O₂, re-evaluate:
      readiness drops.
- [ ] Run the 50-turn replay twice: traces are byte-identical.
- [ ] Score the same anchors at 10° and 45° latitude: ice and insolation components move in
      opposite directions.
