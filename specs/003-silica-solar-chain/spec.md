# Feature Specification: Silica & Solar — the Photovoltaic Chain

**Feature Branch**: `003-silica-solar-chain`
**Created**: 2026-07-30
**Status**: Draft
**Root Epic**: `aic-sfq`

## Summary

Resource chain 2 of 3. Adds a three-structure chain — **Silica Sifter → Silicon Furnace →
Photovoltaic Array** — whose purpose is not "a new power building" but the game's first
**energy-return-on-investment** decision: a structure the player buys with kilowatt-hours and which
then earns them back on a clock. The clock is **41 turns out of 278**, and it is not a balance knob.

### Ratified constants (do NOT re-derive)

| Quantity | Value |
|---|---|
| Tile edge | 5 m (25 m² per tile) |
| Turn length | 178,775 s ≈ 2.014 sols |
| Mission length | 278 turns |
| Reactor | 40 kWe = 1,986 kWh/turn |
| Insolation through a 20% module | 1.168 kWh/m²/turn |
| Embodied energy of a module | 48 kWh/m² (0.8 kg Si/m² × 60 kWh/kg) |

Everything below is derived from those. Where a derived value is not an exact integer in base
units, the rounding rule is stated (see FR-002).

## User Scenarios & Testing

### User Story 1 - Silica Sifter: the first deposit-gated structure (Priority: P1)

The player surveys the map, sees a silica deposit, and sites a Sifter on it. The Sifter is 1×1,
takes 3 build turns, draws **8 kW (20% of a reactor)** and yields **6 t of SiO₂ concentrate per
turn** — 0.066 kWh/kg, the right order of magnitude for mechanical crushing and nothing more.
Attempting to site it anywhere else fails with a structured rejection.

**Why this priority**: This is the moment the survey screen's deposit-proximity score stops being
decoration and becomes a landing-site decision the player can lose by getting wrong. It is also
the smallest slice that proves the deposit → production seam end to end.

**Independent Test**: Place a Sifter on a silica deposit tile on a seeded map, run 4 turns, and
assert the silica stockpile rises only from turn 4 onward (build completes first) and that placing
the same structure on a non-deposit tile returns `{ ok: false, reason: 'deposit-required' }` with
the grid unchanged.

**Acceptance Scenarios**:

1. **Given** a tile carrying a `silica` deposit and an unoccupied 1×1 footprint, **When** the
   player sites a Silica Sifter there, **Then** placement succeeds and the structure enters
   construction with 3 build turns remaining.
2. **Given** a tile with no deposit, **When** the player sites a Silica Sifter there, **Then**
   validation returns a `deposit-required` rejection naming the required resource kind, and the
   grid's occupancy state is byte-identical to before the attempt.
3. **Given** a Sifter with 1 build turn remaining, **When** the turn is resolved, **Then** it
   contributes **zero** production to the ledger — an incomplete structure produces nothing.
4. **Given** a complete Sifter and a silica stockpile at its cap, **When** the turn is resolved,
   **Then** the stockpile clamps at the cap and the discarded amount appears in the cycle report
   as a positive number, never silently vanishing.

---

### User Story 2 - Silicon Furnace: the brutal refining step (Priority: P1)

The player builds a 2×2 Furnace, 9 build turns, drawing **36 kW — 90% of one entire 40 kWe fission
unit, flat out, all turn** — to consume 75 kg of SiO₂ and produce **30 kg of solar-grade silicon
per turn**. Sifter and Furnace together draw 44 kW = **110% of one reactor**, so running both needs
a second reactor online. When the Furnace is short of either power or feedstock it **idles
completely** — it never produces a fractional kilogram.

**Why this priority**: This is where the chain's cost becomes visceral and where the 80× over-feed
from the Sifter surfaces. It is also the hardest case for the brownout rule, so specifying it here
forces that rule to be written down properly rather than discovered later.

**Independent Test**: Run one Sifter and one Furnace for 10 turns on a colony with two reactors;
assert 300,000 g of silicon accumulated, 750,000 g of SiO₂ consumed, and that with only one
reactor online the Furnace's output is exactly zero for every turn, not a reduced rate.

**Acceptance Scenarios**:

1. **Given** a complete Furnace, ≥75 kg of SiO₂ stockpiled and sufficient electricity, **When** the
   turn is resolved, **Then** silicon rises by exactly 30,000 g and silica falls by exactly
   75,000 g.
2. **Given** a complete Furnace and 74,999 g of SiO₂, **When** the turn is resolved, **Then** the
   Furnace produces **0 g** of silicon, consumes **0 g** of SiO₂ and **0 Wh** of electricity, and
   is reported as idle with a typed reason.
3. **Given** a complete Furnace whose electricity demand exceeds available generation, **When** the
   turn is resolved, **Then** the Furnace idles wholly (binary idle) and the brownout report names
   it, in an order fixed by the documented total order.
4. **Given** one Sifter and one Furnace running, **When** a turn is resolved, **Then** the surplus
   SiO₂ is 5,925 kg — the Sifter over-feeds the Furnace ~80× — and that surplus either fills the
   cap or is reported as discarded.

---

### User Story 3 - Photovoltaic Array and the payback readout (Priority: P1)

The player spends **20 kg of silicon** — 1,200 kWh of embodied energy — to build a 1×1, 25 m² array
tile that returns **29.2 kWh per turn** (0.588 kW average). Before committing, the build panel shows
**payback in turns** beside **turns remaining**, and says in plain words when the array cannot
repay itself.

**Why this priority**: Without the readout the central mechanic is a trap the player cannot see,
which is just a bad rule. Without the `buildCost` debit the chain is a silicon counter that goes up
and can never be spent — a scoreboard, not a mechanic. The array and the readout are one story.

**Independent Test**: With exactly 20,000 g of silicon stockpiled, build an array: the build starts
and the stockpile lands at exactly 0. With 19,999 g the build is refused up front. Query the payback
readout at turn 1 and at turn 250 and assert the verdict flips from "repays" to "cannot repay".

**Acceptance Scenarios**:

1. **Given** a silicon stockpile of exactly 20,000 g, **When** the player commits an array build,
   **Then** the build starts and the stockpile is exactly 0 g — the `>=` boundary, not `>`.
2. **Given** a silicon stockpile of 19,999 g, **When** the player commits an array build, **Then**
   the build is refused before any drone-turn or tile is committed, with a typed
   `insufficient-resources` rejection naming `silicon` and the 1 g gap.
3. **Given** an array under construction, **When** turns are resolved, **Then** it contributes
   **0 Wh** of electricity every turn until the turn it completes.
4. **Given** a complete, clean, unstormed array, **When** a turn is resolved, **Then** it
   contributes exactly **29,200 Wh** to the ledger.
5. **Given** 30 turns remaining and an array payback of 42 turns, **When** the build panel is
   queried, **Then** it reports payback 42, remaining 30, and a plain-language verdict that this
   array will not repay its own construction.
6. **Given** the same array specification expressed at a 5 m, 7.5 m or 10 m tile edge, **When**
   payback is computed, **Then** the answer is identical — the ratio is scale-invariant.

---

### User Story 4 - Dust: the labour tax and the gamble (Priority: P2)

Two real Martian risks turn solar from an upgrade into a bet.

**Soiling** — Spirit and Opportunity both measured ~0.2% output loss per sol, ~0.4% per turn.
Arrays decay unless drones clean them, and cleaning spends the exact whole drone-turns the player wants
for construction: an ongoing **labour tax**, not just a build cost. Cumulative soiling loss is
capped at **60%** so an ignored array degrades badly and stays useful — it must never become a
permanent zero, because a structure that silently reaches zero output is indistinguishable from a
bug and will be reported as one.

**Global dust storms** — the 2018 planet-encircling storm drove optical depth past τ ≈ 10, cut
Opportunity's insolation by more than 99%, and ended the mission. Modelled as a scheduled event
lasting **10–40 turns** that cuts array output **80–95%** while leaving reactors completely
untouched. That asymmetry is the strategic payload: solar is high-yield and risk-exposed, fission
is steady and expensive.

**Why this priority**: P2 because US1–US3 are a complete, shippable mechanic without it. The risk
model makes the decision interesting; it does not make it functional.

**Independent Test**: Run 200 turns on a fixed seed with one array, never cleaning it: assert
output decays monotonically, reaches the 60% floor and stays there exactly, that the storm windows
match the schedule drawn at world-gen, and that reactor output is bit-identical to a run with the
array absent.

**Acceptance Scenarios**:

1. **Given** a clean array, **When** N turns pass without cleaning, **Then** retention falls by
   0.4% per turn in integer basis points and is floored at 4,000 bp (60% cumulative loss),
   producing the capped output on the turn the cap is reached and every turn after.
2. **Given** a soiled array and a cleaning order, **When** drones service it, **Then** retention
   rises and the whole drone-turns spent are unavailable to construction that turn.
3. **Given** a world generated from seed S, **When** the storm schedule is drawn, **Then** it is
   drawn from the **same seeded generator as the terrain**, is fully determined before turn 1, and
   two worlds from seed S have deep-equal schedules — asserted over the whole schedule, not just
   the first storm.
4. **Given** an active storm, **When** the turn is resolved, **Then** array output is reduced by the
   storm's severity and **reactor output is provably unchanged**.
5. **Given** an array both soiled and stormed, **When** output is computed, **Then** the result is
   ≥ 0 and never below the documented floor — soiling and storm compose in one fixed order and
   cannot compound into a negative.

---

## Explicit Non-Goals (SCOPE GUARD)

Two things fall out of the turn length that will otherwise get built by someone acting reasonably.
Both are **out of scope** and any PR adding them must be rejected.

- **No intra-turn day/night phase modelling.** A turn spans 2.014 sols — two complete Martian
  day/night cycles. Solar output therefore averages out *within* a single turn: at this granularity
  the per-turn average is **exact, not an approximation**. A sub-turn phase system would add a
  second time axis to a simulation that has one, for zero fidelity gain.
- **Batteries are OUT OF SCOPE** (constitution §8). Their textbook job is smoothing diurnal
  cycling, and the paragraph above deletes that job at this turn scale. Their only real role here
  would be dust-storm ride-through and brownout headroom — mechanics that do not exist yet. If
  storms ship and players want a hedge, that is the moment batteries have earned their entry, and
  they will be cheaper to design then because the storm model will already be specified.
- **No new simulation code branches per structure type.** Structures are DATA. The three entries
  here are catalog rows; a `if (type === 'pv-array')` anywhere in the sim is a defect.
- **No React, DOM or rendering imports** anywhere under `src/sim/` (constitution §4). The existing
  boundary guard in `tests/unit/boundary.test.ts` must keep passing unmodified.

## Edge Cases

Every one of these has a named task in `tasks.md`.

- **Silica deposit exhausted mid-build.** A Sifter under construction on a deposit that runs out
  **completes and idles at zero yield**. Cancelling a partly-built structure would silently destroy
  drone-turns the player has already spent. Both the exhaustion-during-build and
  exhaustion-after-completion paths are tested.
- **Placement rejected off-deposit.** Must fail with a structured error and must not partially
  mutate the tile grid.
- **Silicon stockpile exactly equal to the 20 kg cost.** Build succeeds, stockpile lands at exactly
  zero. The classic `>` vs `>=` off-by-one — a player will find it before a reviewer does.
- **One gram short.** 19,999 g must refuse, asserted in base units.
- **Empty stockpile.** Refused up front, not started and stalled.
- **Storage overflow.** The Sifter filling the silica cap clamps, and the discarded amount appears
  in the cycle report.
- **Storm beginning mid-build.** Must not affect construction; applies to output only, from the
  turn the array completes.
- **Array completed the same turn a storm starts.** Output that turn is the stormed value, not the
  clean value — the same-turn ordering is fixed and tested.
- **Storm overlapping a second storm.** The schedule is normalised at generation into disjoint,
  sorted intervals by merging overlaps with **max** severity, never multiplied severities.
- **Soiling at exactly the 60% cap boundary.** The turn the cap is reached and the turn after both
  produce exactly the capped output, and never less.
- **Storm and soiling composed.** Never negative, never below the documented floor.
- **Payback readout when turns-remaining is zero, or fewer than the payback.** Must render without
  dividing by zero and must say plainly that the build cannot repay.
- **Array output during construction.** Exactly zero, every turn, until completion.
- **Same seed reproduces identical storm timing.** Asserted over the full schedule.

## Requirements

### Functional Requirements

- **FR-001**: The catalog MUST gain the three structure entries `silica-sifter`, `silicon-furnace`
  and `pv-array` as **pure data**, with no new branch in simulation logic.
- **FR-002**: All resource amounts MUST be stored as **integers in base units** — watt-hours and
  grams. `6,000 kg` is `6_000_000`; `29.2 kWh` is `29_200 Wh`. Where a per-turn energy figure is
  not an exact integer (the Sifter's 8 kW × 178,775 s = 397,277.78 Wh), it MUST be rounded
  half-up **once**, by a single documented helper, so every catalog entry uses the same rule.
- **FR-003**: The Sifter MUST be sitable only on a tile carrying a **silica** deposit. Off-deposit
  siting MUST return a typed `deposit-required` rejection and MUST NOT mutate the grid.
- **FR-004**: Every resource MUST have a **storage capacity**. Production that would exceed it MUST
  clamp, and the discarded amount MUST be reported, never silently dropped.
- **FR-005**: A structure under construction MUST contribute **zero** production and **zero**
  consumption to the ledger.
- **FR-006**: A consumer short of any input (power or feedstock) MUST **idle wholly** — binary
  idle, never fractional throughput. Fractional rates give fractional kilograms, which reintroduce
  float drift in exactly the ledger we are keeping integral, and make the cycle report
  unexplainable ("your Furnace made 17.3 kg because it got 58% of its power" is not a sentence a
  player can act on).
- **FR-007**: Brownout shedding order MUST be a documented **total** order over all consumers, with
  a deterministic tie-break (ascending structure instance id) so no two runs can differ.
- **FR-008**: The array's 20 kg silicon cost MUST be a one-time `buildCost`, debited at build
  **commit**, distinct from the per-turn `consumes` operating draw.
- **FR-009**: The system MUST expose a payback readout giving, for any structure with a non-trivial
  `buildCost`: embodied energy, output per turn, **payback in turns**, **turns remaining**, and a
  plain-language verdict. It MUST be total — defined at zero turns remaining and at zero output.
- **FR-010**: Payback MUST be computed by integer division with **ceiling** rounding:
  `ceilDiv(1_200_000 Wh, 29_200 Wh/turn) = 42 turns`. See "Rounding note" below.
- **FR-011**: Array output MUST decay by **0.4% per turn** of soiling, tracked as integer basis
  points of retention, floored at **4,000 bp** (60% cumulative loss).
- **FR-012**: Cleaning MUST restore retention and MUST consume whole drone-turns from the same pool as
  construction.
- **FR-013**: The **entire** storm schedule (start turn, duration 10–40 turns, severity 8,000–9,500
  bp of output loss) MUST be drawn at world-gen from `terrain.seed`, using the same `mulberry32`
  construction the rest of `src/sim/` uses, and MUST be normalised into disjoint sorted intervals
  by merging overlaps with max severity.
- **FR-014**: Storms MUST affect array output only. Reactor output MUST be provably unchanged across
  a storm window.
- **FR-015**: Soiling and storm MUST compose in one fixed documented order (soiling, then storm),
  with the result floored at 0 Wh.
- **FR-016**: The cycle report MUST carry one line per chain event: silica produced, silica
  discarded to cap, furnace idle-with-reason, array output with its soiling and storm multipliers
  broken out.
- **FR-017**: Every public function added MUST have ≥3 tests (happy, error, edge) per constitution
  §1, written **before** the implementation, and coverage MUST stay at or above 80% lines / 70%
  branches / 60% functions.

#### Rounding note (flagged, not a re-derivation)

The ratified headline figure is **41 turns**, from 1,200,000 ÷ 29,200 = 41.096. Integer-ceiling
gives **42**. The readout MUST use the ceiling, because a player told "41" who has exactly 41 turns
left ends 1,200 Wh short — the readout would lie at precisely the boundary it exists to warn about.
Consequence: the "last viable start" the *readout* reports is turn **236**, one earlier than the
prose figure of 237. The ratified constants are unchanged; this is a rounding direction, and it is
called out here so nobody discovers it as a bug.

### Key Entities

- **Resource kind** (`silica`, `silicon`, plus existing `electricity`): an open string key, exactly
  as `catalog.ts`'s `ResourceAmounts` and `ledger.ts`'s `Stockpile` already model resources. No new
  closed union.
- **Silica Sifter** (`silica-sifter`): 1×1, 3 build turns, consumes 397,278 Wh/turn, produces
  6,000,000 g SiO₂/turn, requires a `silica` deposit.
- **Silicon Furnace** (`silicon-furnace`): 2×2, 9 build turns, consumes 1,787,750 Wh + 75,000 g
  SiO₂/turn, produces 30,000 g Si/turn.
- **Photovoltaic Array** (`pv-array`): 1×1, 3 build turns (by analogy with the Sifter — same scale
  of 1×1 work; there is no measured basis and this is stated as such), `buildCost` 20,000 g Si,
  produces 29,200 Wh/turn.
- **SoilingState**: per-array integer retention in basis points, `10_000` clean, floored at `4_000`.
- **StormSchedule**: a frozen, sorted, disjoint array of `{ startTurn, endTurn, severityBp }`, drawn
  once at world-gen from the terrain seed.
- **PaybackReadout**: `{ embodiedWh, perTurnWh, paybackTurns, turnsRemaining, verdict }`.

## Success Criteria

- **SC-001**: A player can complete Sifter → Furnace → Array on a seeded map and see colony
  generation rise, with every number in the cycle report an integer in base units.
- **SC-002**: A clean complete array contributes exactly 29,200 Wh/turn; an array under construction
  contributes exactly 0 Wh.
- **SC-003**: The payback readout returns 42 turns for the ratified array and is **identical** for
  the same specification expressed at 5 m, 7.5 m and 10 m tile edges (scale invariance test).
- **SC-004**: Two worlds generated from the same seed produce deep-equal storm schedules, and a
  278-turn run with the same seed and same orders produces a byte-identical ledger trace across a
  mission containing at least one storm and one soiling-cap event.
- **SC-005**: An array never cleaned for 200 turns settles at exactly 40% of nominal output and
  never at zero.
- **SC-006**: A Furnace short of power or feedstock produces exactly zero — no test anywhere
  observes a fractional gram or watt-hour.
- **SC-007**: `npm run verify` passes: typecheck, build, and coverage at or above 80/70/60.
- **SC-008**: `tests/unit/boundary.test.ts` passes **unmodified** — zero React/DOM imports and zero
  `Math.random`/`Date.now` under `src/sim/`.
- **SC-009**: `git grep -n "pv-array\|silicon-furnace\|silica-sifter" src/sim` matches only data
  files and tests — never a conditional in simulation logic.

## Standing rulings from the General (2026-07-30) — binding on this spec

These override anything above that contradicts them.

- **No storing energy without barriers.** Electricity does not accumulate across
  turns; generation is spent or lost within the turn that produces it, unless an
  explicit storage structure (battery) provides containment. The ledger therefore
  carries a **per-resource accumulation policy** — silica, water and oxygen are
  stocks; electricity is a flow.
- **No storing labour at all.** No exceptions and no storage structure. Unspent
  robot-hours are lost at end of turn, and labour is granted only in **whole
  build-turns** (implemented, `aic-chg`). No task in this chain may cost fractional
  labour — including solar-panel cleaning, which costs whole drone-turns.
- **Canonical units: grams for mass, watt-hours for energy.** Integers only.
- **Physics first, except where game mechanics and fun override.**
