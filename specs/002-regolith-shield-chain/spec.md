# Feature Specification: Regolith & the Shielded Habitat (Resource Chain 1 of 3)

**Feature Branch**: `002-regolith-shield-chain`
**Created**: 2026-07-30
**Status**: Draft
**Epic**: `aic-d8y`

## Summary

Adds one acquisition utility (Regolith Hopper), one assembly line (Sinter Press), and one
structure (Shield Berm) — and uses them to make the win condition honest: **an unshielded
habitat contributes ZERO to habitat readiness.**

Mars surface radiation is ~0.64 mSv/day as measured in situ by the RAD instrument on
Curiosity (~230 mSv/year). That is not a hazard engineered around with a thicker wall; it is
a hazard engineered around with mass. Habitat readiness therefore becomes a **two-factor
test**: a habitat counts only when it is **built AND rated**, and rating comes only from an
adjacent completed Shield Berm.

### Ratified constants (do not re-derive, do not change)

| Constant | Value |
|----------|-------|
| Tile edge | 5 m (25 m² per tile) |
| Drone work draw | 5 kW |
| Drone recharge draw | 5.54 kW |
| Reactor output | 40 kWe = 1,986 kWh per turn |
| Turn duration | 178,775 s = 2.014 sols |
| Mission length | 278 turns |

## User Scenarios & Testing

### User Story 1 - Extract regolith (Priority: P1)

The player places a Regolith Hopper anywhere on buildable ground. It requires no mineral
deposit — Martian soil is roughly 45 wt% SiO₂ and 18 wt% iron oxide essentially everywhere
(Curiosity APXS/CheMin), so a player who lands badly can still shield a habitat. Once
complete it produces 60 t of bulk regolith per turn into the colony stockpile, drawing 12 kW
(30% of one reactor) and competing for power in the documented brownout order.

**Why this priority**: Nothing downstream exists without a regolith supply. It is also the
cheapest possible demonstration that the acquisition side of a chain works end to end.

**Independent Test**: Place one Hopper, run turns with ample reactor power, and assert the
regolith stockpile rises by exactly 60,000,000 g per turn until it hits its capacity cap,
after which the excess is reported as overflow rather than silently discarded.

**Acceptance Scenarios**:

1. **Given** a completed Hopper and sufficient power, **When** a turn resolves, **Then** the
   regolith stockpile increases by exactly 60,000,000 g and the cycle report shows the
   Hopper as active.
2. **Given** a Hopper still under construction (fewer than 2 build turns applied), **When** a
   turn resolves, **Then** it produces nothing and draws no operating power.
3. **Given** a completed Hopper and a power budget below 12 kW after higher-priority
   consumers are served, **When** a turn resolves, **Then** the Hopper is **fully idle** —
   zero regolith produced, zero power drawn — never a fractional rate.
4. **Given** a regolith stockpile at capacity, **When** a Hopper turn resolves, **Then** the
   stockpile stays exactly at capacity and the turn reports an overflow of the discarded
   amount.

---

### User Story 2 - Sinter plate (Priority: P1)

The player places a Sinter Press (L-shape, 3 tiles, 6 build turns, 30 kW = 75% of one
reactor). It consumes ~1.4 t of regolith per turn and produces 1.2 t of sintered plate.
Sintering regolith to ~1,100 °C has a thermodynamic floor of 0.244 kWh/kg (specific heat
~0.8 kJ/kg·K over an 1,100 K rise); at a realistic ~20% process efficiency that is
~1.2 kWh/kg, which is what sets the throughput.

This is where the chain's lesson lands: **one Hopper (60 t/turn) over-feeds one Press
(1.4 t/turn) by more than 40×.** That is not a balance error. Moving a kilogram of dirt costs
~0.01 kWh; raising it to 1,100 °C costs ~1.2 kWh — two orders of magnitude more. Digging is
nearly free; heat is ruinous. The mechanical consequence is that presses are the bottleneck
and power is the currency: the player's question is never "how much dirt can I move" but
"how many presses can my reactors carry."

**Why this priority**: Without the Press the chain is Hopper → Berm, the crust has no
supplier, and the most interesting thing here never reaches the player.

**Independent Test**: With a stocked regolith pile and ample power, run turns and assert
plate rises by exactly 1,200,000 g/turn while regolith falls by exactly 1,400,000 g/turn.
Then starve each input independently and assert binary idle with a distinct reported reason.

**Acceptance Scenarios**:

1. **Given** a completed Press, ≥1,400,000 g of regolith, and sufficient power, **When** a
   turn resolves, **Then** plate increases by 1,200,000 g and regolith decreases by
   1,400,000 g.
2. **Given** a completed Press and exactly 1,400,000 g of regolith, **When** a turn resolves,
   **Then** it runs to completion and leaves regolith at exactly 0 — not short by one gram,
   never negative.
3. **Given** a completed Press and 1,399,999 g of regolith, **When** a turn resolves,
   **Then** the Press is fully idle with reason `input-starved`, consumes **zero** regolith,
   and produces zero plate.
4. **Given** a completed Press with ample regolith but a power budget below 30 kW after
   higher-priority consumers, **When** a turn resolves, **Then** the Press is fully idle with
   reason `power-starved`, consumes zero regolith, and produces zero plate.
5. **Given** one Hopper and one Press running together, **When** many turns resolve, **Then**
   regolith accumulates monotonically toward its cap (the 40× over-feed) while plate rises at
   the Press rate.

---

### User Story 3 - Shield Berm and the rated-habitat rule (Priority: P1, the payoff)

The player applies a Shield Berm to an adjacent **completed** habitat. It occupies a skirt of
tiles around the module (the ratified working default — 450 t of fill has to sit somewhere,
and a flag on the habitat would be honest about nothing). The berm is not gated on
drone-hours; it is gated on **material arriving**, so its ~7.5-turn duration is emergent from
the supply rate rather than a hardcoded `buildTurns`.

Costs, derived arealy from the 5 m tile:

- Bulk fill: 3 m of regolith at ~1.5 g/cm³ = 450 g/cm² = 4,500 kg/m²; × 100 m² (a 2×2
  habitat at 5 m tiles) = **450,000,000 g = 7.5 Hopper-turns**.
- Sintered crust: 0.05 m × 100 m² × 1,500 kg/m³ = **11,000,000 g = 9.2 Press-turns**. The
  crust holds the loose fill against dust mobilisation and slow slope creep — not against
  wind loading; the Martian atmosphere is ~610 Pa and carries very little force.

Once complete, the berm converts the habitat from unrated to **rated**. Readiness then asks
two questions instead of one, and an unrated habitat contributes exactly **zero** capacity —
not partial credit, not 60%. This punishes the death spiral the MVP proposal already flagged:
over-building bare shells, starving the power budget, and finding out too late. Zero is
legible. A player who sees zero at turn 40 changes plan.

Zero is only fair because a berm is cheap: 7.5 Hopper-turns is 2.7% of the mission against a
42 kW Hopper+Press pair that any player with one reactor can afford.

**Why this priority**: This is the entire point of the feature. US1 and US2 are infrastructure
for it.

**Independent Test**: Run the full chain from empty stockpiles to one rated habitat, then
assert `evaluateMission` counts that habitat's capacity and counts an identically-built but
unrated habitat as zero.

**Acceptance Scenarios**:

1. **Given** a completed habitat with an adjacent berm site and stockpiles filling over time,
   **When** turns resolve, **Then** the berm accumulates delivered material toward its
   `buildCost` across multiple turns and reports progress each turn.
2. **Given** a berm that has received exactly 450,000,000 g of regolith and 11,000,000 g of
   plate, **When** the turn resolves, **Then** the berm completes, both stockpiles land at
   exactly zero, and the habitat becomes rated.
3. **Given** a built but unrated habitat with capacity 8, **When** the mission is evaluated,
   **Then** it contributes exactly 0 to habitat capacity.
4. **Given** a built and rated habitat with capacity 8, **When** the mission is evaluated,
   **Then** it contributes exactly 8.
5. **Given** a habitat still under construction, **When** a berm is applied to it, **Then**
   the application is **rejected** and no material is deducted; and applying a berm that
   completes before the habitat does must not pre-credit readiness.
6. **Given** an already-rated habitat, **When** a second berm is applied, **Then** it is
   refused **before any material is deducted**. A double-charge that grants nothing is the
   worst possible outcome at 450 t.

---

### Phase 5 - Polish (Priority: P2)

Cycle-report lines for berm progress, starvation reasons and overflow; UI readouts for
stockpiles, berm progress and the rated badge; and balance hooks exposing berm cost and
throughputs as tunables for the balance pass.

---

### Edge Cases

Each of these MUST have a named test. They are the regression risks this feature can
plausibly introduce.

- **Berm applied to a habitat still under construction** — rejected, no material deducted,
  no pre-credited readiness. Assert the order-independent case too: berm completes first,
  habitat completes second, and readiness only appears once both are true.
- **Berm applied twice to the same habitat** — refused before any deduction.
- **Habitat demolished or overwritten after being rated** — readiness drops, and the berm
  must not survive as an orphan rating that a newly built module inherits for free.
- **Stockpile exactly equal to the cost** — boundary at exactly 450,000,000 g regolith and
  11,000,000 g plate: must succeed and leave both stockpiles at exactly zero. Not fail by one
  gram, not go negative. (Distinct from, and tested alongside, the one-gram-short case.)
- **Empty stockpile** — berm construction with zero regolith is a clean refusal, never a
  partial deduction or a negative balance.
- **Brownout mid-berm** — a Hopper or Press idled mid-supply leaves the berm resumable with
  all delivered material intact. A berm is only 11 turns, so a lost partial is small in
  isolation — and exactly the kind of small silent loss that never gets reported as a bug.
- **Stockpile overflow** — a Hopper producing 60 t/turn into a full stockpile handles the
  excess by the one documented rule (cap-and-report) and the cycle report shows it. Silent
  discard is forbidden. This is the steady state for this chain, not an edge case: one Hopper
  out-produces its own berm by 8×.
- **Readiness recomputed deterministically** — readiness is a pure function of world state,
  never an incrementally mutated counter. Same seed plus same orders produces an identical
  ledger, including the built/rated split, across repeated runs.
- **A rated habitat whose berm was never finished** — cannot exist. Rating is derived from a
  *completed* berm; a partially supplied berm confers nothing.
- **Tile scale changes** — the berm cost is areal, so it must be derived from the tile-edge
  constant, not typed in as 450 t. A test asserts that doubling the tile edge quadruples the
  berm cost.

## Requirements

### Functional Requirements

- **FR-001**: The ledger MUST recognise `regolith` and `sinteredPlate` as resource kinds
  denominated in **integer grams**, and electricity in **integer watts** (instantaneous) and
  **integer watt-hours** (energy). No floats anywhere in the ledger; kWh and tonnes are
  display-boundary conversions only.
- **FR-002**: The three new structures MUST be added as **catalog data only**. Adding them
  MUST NOT introduce a new code branch in `src/sim/placement.ts` or `src/sim/ledger.ts`.
- **FR-003**: Every resource stockpile MUST have a capacity cap. Production beyond the cap
  MUST be capped and **reported** as overflow, never silently discarded.
- **FR-004**: A structure whose per-turn power draw cannot be met MUST be **fully idle** for
  that turn — binary idle, never a fractional rate — and MUST consume none of its per-turn
  inputs while idle.
- **FR-005**: The brownout priority order MUST be a **documented total order** over all
  consumers (no ties, no dependence on Map/Set/object key iteration order), asserted by test.
- **FR-006**: The Regolith Hopper MUST produce 60,000,000 g of regolith per turn at a 12,000 W
  draw, with **no deposit requirement**.
- **FR-007**: The Sinter Press MUST consume 1,400,000 g of regolith and produce 1,200,000 g
  of sintered plate per turn at a 30,000 W draw, and MUST idle with a distinct reported reason
  for input starvation vs. power starvation.
- **FR-008**: The Shield Berm MUST carry a one-time `buildCost` of 450,000,000 g regolith and
  11,000,000 g sintered plate, **derived from the tile-edge constant** rather than literal, and
  MUST draw 0 W.
- **FR-009**: Berm construction MUST accumulate delivered material across turns and MUST be
  resumable with delivered material intact after any interruption.
- **FR-010**: A berm MUST only be applicable to an **adjacent, completed** habitat, and MUST
  be refused (before any deduction) for an incomplete habitat or an already-rated habitat.
- **FR-011**: Habitat readiness MUST be a two-factor test — built AND rated. An unrated
  habitat MUST contribute exactly 0 capacity.
- **FR-012**: Demolishing or overwriting a rated habitat MUST invalidate its rating; no
  rating may be inherited by a later structure on those tiles.
- **FR-013**: Readiness MUST be recomputed as a pure function of world state on every query,
  producing identical results for identical state.
- **FR-014**: `src/sim/` MUST remain free of React imports, DOM globals, and nondeterministic
  APIs — `tests/unit/boundary.test.ts` MUST keep passing.

### Key Entities

- **Resource kind** — an open string key with a declared integer base unit (`regolith`: g,
  `sinteredPlate`: g, `electricity`: W / W·s) and a display scale.
- **Regolith Hopper** — catalog entry `regolith-hopper`. 1×1, 2 build turns, 12,000 W,
  produces 60,000,000 g regolith/turn. No deposit required.
- **Sinter Press** — catalog entry `sinter-press`. L-shape (3 tiles), 6 build turns, 30,000 W,
  produces 1,200,000 g plate/turn, consumes 1,400,000 g regolith/turn.
- **Shield Berm** — catalog entry `shield-berm`. Skirt footprint around one habitat, 0 W,
  material-gated (`buildTurns: 0`), `buildCost` = 450,000,000 g regolith + 11,000,000 g plate.
- **Berm progress** — per-instance delivered-material state plus the id of the habitat it
  rates.
- **Rated habitat** — a completed habitat with a completed adjacent berm. The only kind that
  counts toward readiness.

## Success Criteria

- **SC-001**: One Hopper plus one Press (42 kW = 105% of one reactor) supplies one completed
  berm in exactly 7.5 Hopper-turns and 9.2 Press-turns, with no idle-waiting stage.
- **SC-002**: An unrated habitat contributes exactly 0 to `totalHabitatCapacity`; the same
  habitat once rated contributes its full `habitatCapacity`.
- **SC-003**: Doubling `TILE_EDGE_METERS` quadruples the derived berm cost, asserted by test.
- **SC-004**: Two identical runs of the full chain produce identical ledgers, including the
  built/rated split.
- **SC-005**: Coverage gates hold: lines ≥ 80%, branches ≥ 70%, functions ≥ 60%
  (`npm run test:coverage`).
- **SC-006**: `npm run verify` (typecheck + build + coverage) exits 0, and
  `tests/unit/boundary.test.ts` passes unchanged.
- **SC-007**: Six habitats shielded serially with one Hopper and one Press cost 45
  Hopper-turns and 37.5 Press-turns — about 16% of the 278-turn mission.

## Open Design Notes (working defaults in use, nothing blocked)

Working defaults, all reversible: 5 m tile, **zero** credit for unrated, tile-occupying
skirt footprint, crust **included**, **binary idle** under brownout. If the tile edge moves,
every tonnage here moves with its square.

The honest balance risk has inverted from the original 10 m-tile analysis: shielding may now
be **too cheap** to be a decision. That is acceptable — the mechanic's job is to make
readiness truthful, not to be the difficulty. The difficulty belongs in the power budget and
the deadline, where the MVP already put it. Tune berm cost in the same balance pass as build
durations, against real playtest traces.

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
