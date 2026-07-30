# Feature Specification: Ice, Air & the Provisioned Habitat (Resource Chain 3 of 3)

**Feature Branch**: `004-ice-lifesupport-chain`
**Created**: 2026-07-30
**Status**: Draft
**Epic**: `aic-85z`
**Source Proposal**: `.scratch/prop3-merged.html` (Raynor — QA & Systems)

---

## Scope Statement (read this first)

This is a **post-MVP-loop increment**. It ships only after the MVP's electricity/labour
loop is proven fun. Nothing here competes with that loop for the next slice of work.

It delivers the third factor of habitat readiness — **provisioned** — and with it the
game's first **STORED** resource, as opposed to a per-turn flow. That second point is the
mechanical reason to build this chain and not just the thematic one: everything in the MVP
balances inside a single turn (a reactor makes 1,986 kWh this turn, a drone spends 125 kWh
this turn). Oxygen, water and hydrogen must **accumulate across turns and be capped**.
Storage caps, overflow, and drawdown rules become load-bearing here for the first time.

### The three-factor readiness test

| Factor | The test | Introduced by | Data required |
|---|---|---|---|
| **built** | Habitat module complete on its footprint | MVP (accepted) — `mission.ts` `isStructureComplete` | `habitatCapacity`, `buildTurns` |
| **rated** | Shielded to the dose target for its claimed occupancy | Proposal 1 (regolith/shielding chain) | Proposal 1's rating field |
| **provisioned** | Banked O₂ and H₂O meet the margin for its claimed occupancy | **Proposal 3 — this feature** | `storageCapacity` |

A habitat that fails any one factor contributes **zero**, not a fraction. You cannot
half-breathe. This feature only introduces and owns **provisioned**; it must not assume
`rated` exists, and must degrade to a two-factor test if Proposal 1 has not landed
(`rated` absent ⇒ treated as satisfied, with a documented TODO, never silently failed).

### Explicitly out of scope

- **Sabatier / methane chain** (CO₂ + 4H₂ → CH₄ + 2H₂O) — out per constitution §8. Three
  chains justify the shared foundation; a fourth speculative one justifies nothing.
- **MOXIE-style atmospheric CO₂ electrolysis** (~25–50 kWh/kg O₂ vs ~6.75 kWh/kg via water
  electrolysis) — the recommended NEXT feature and "bad-site insurance". Not planned here.
- **Boil-off modelling** for an unpowered Life Support Reserve. An unpowered Reserve is a
  reported warning this increment, not a loss.
- **Water recycling** beyond the flat 3.5 kg/person/day assumption in the provisioning bill.

---

## Ratified Constants (do not re-derive; import)

| Quantity | Value | Source |
|---|---|---|
| Turn duration | 178,775 s (25 h drone work + 1 Mars sol) ≈ 49.66 h ≈ 2.014 sols | `src/sim/time.ts` `DEFAULT_TURN_CYCLE` |
| Mission length | 278 turns | `src/sim/time.ts` `totalTurns` |
| Reactor output | 40 kWe = 1,986 kWh/turn (1,986,388 Wh floored) | ratified |
| Drone recharge draw | 5.54 kW | ratified (`src/sim/drones.ts` `DRONE_RECHARGE_DRAW_KW`) |

**Every per-turn energy figure in this feature MUST be derived from
`turnDurationSeconds(config)`, never written as a literal.** The proposal's 49.66 h is the
same number `time.ts` already owns; if a future ratification changes the turn cycle, this
chain's throughputs must move with it automatically.

---

## User Scenarios & Testing

### User Story 1 — Mine ice into a tank (Priority: P1)

The player has a landing site with a shallow-ice deposit inside reach. They place an
**Ice Auger** on an ice-deposit tile. Four build turns later it begins drawing 15 kW and
banking water into storage every turn. Placing an Auger on a tile with no ice deposit is
refused with a legible reason, not silently accepted as a structure that produces nothing.

**Why this priority**: This is the acquisition end of the chain and the first structure
whose *siting* is genuinely constrained by the map. Without it there is no water, and
without water nothing else in the feature can be exercised.

**Independent Test**: Build an Auger on an ice tile on a fixed-seed map, run 5 turns, and
assert water in the stockpile is exactly `0` for turns 1–4 (still building) and exactly the
catalogued yield on turn 5. Attempt the same placement on a non-ice tile and assert a
`deposit-required` rejection carrying the offending tile and required resource kind.

**Acceptance Scenarios**:

1. **Given** a tile with a shallow-ice deposit and a clear 1×1 footprint,
   **When** the player places `ice-auger` there,
   **Then** placement succeeds and the structure begins accruing build turns.
2. **Given** a buildable tile with **no** ice deposit,
   **When** the player places `ice-auger` there,
   **Then** placement is rejected with `reason: 'deposit-required'`, the tile coordinate,
   and the required deposit resource — and nothing is written to the grid.
3. **Given** a completed Auger and sufficient power,
   **When** a turn is resolved,
   **Then** water in the stockpile increases by exactly the catalogued integer gram yield,
   and the cycle report contains one production line naming the structure and amount.
4. **Given** a completed Auger and insufficient power,
   **When** a turn is resolved,
   **Then** the Auger is **idle** (binary — produces exactly zero, not a fraction), the
   cycle report contains an idle line, and no water is produced.

---

### User Story 2 — Split water into oxygen, and deal honestly with the hydrogen (Priority: P1)

The player places an **Electrolysis Stack** (2×2, 7 build turns, 25 kW). Once complete it
consumes 207 kg of water per turn and produces 184 kg of O₂ and 23 kg of H₂. The oxygen is
what the mission needs. The hydrogen has **no consumer in this increment** — so it is
banked to a capped tank, vented on overflow, and **the vent is always reported**.

**Why this priority**: The Stack is the conversion bottleneck the whole chain is shaped
around, and the hydrogen sink is a **correctness requirement**, not flavour. A byproduct
with no sink is exactly the kind of quantity that silently vanishes and quietly corrupts
every balance conclusion drawn from the game for months.

**Independent Test**: Seed a stockpile with water, run one turn with one completed Stack,
and assert: (a) water down by exactly 207,000 g, (b) O₂ + H₂ produced sums to exactly
207,000 g — mass conserved to the gram, (c) with the H₂ tank pre-filled to capacity, the
H₂ stockpile stays exactly at capacity **and** the report contains a vent line with the
exact discarded gram count.

**Acceptance Scenarios**:

1. **Given** ≥207,000 g of water banked and a completed Stack with power,
   **When** a turn is resolved,
   **Then** water falls by exactly 207,000 g and O₂ rises by 184,023 g and H₂ by 22,977 g
   (the split is computed as `h2 = round(water × 111 / 1000)`, `o2 = water − h2`, so mass
   is conserved **by construction**, not by coincidence of rounding).
2. **Given** <207,000 g of water banked,
   **When** a turn is resolved,
   **Then** the Stack is idle (binary), consumes zero water, produces zero, and the report
   carries an idle line naming water as the limiting resource.
3. **Given** an H₂ tank at exactly capacity,
   **When** a Stack produces 22,977 g of H₂,
   **Then** the stockpile remains **exactly** at capacity (not one gram over), and the
   report carries a vent line with `amount: 22977`.
4. **Given** an H₂ tank 10,000 g below capacity,
   **When** a Stack produces 22,977 g of H₂,
   **Then** 10,000 g are stored, 12,977 g are vented, and the vent line reports exactly
   12,977 — the stored and vented amounts sum to the produced amount.

---

### User Story 3 — Provision the habitat, and keep re-checking it (Priority: P1)

The player builds a **Life Support Reserve** (2×2, 5 build turns, 6 kW standing draw,
produces nothing) and fills it. A habitat only counts toward mission readiness once the
colony has banked the O₂ and water margin for the colonists it claims to house. If the
tanks are later drawn down below that margin, the habitat becomes **UN-provisioned** again
and stops counting.

**Why this priority**: This is the win-condition change the whole feature exists to make,
and "provisioned is not a one-time flag" is the single most likely bug in the feature.

**Independent Test**: One completed habitat (capacity 8) plus banked provisions exactly at
the margin ⇒ readiness counts it. Remove one gram of O₂ and re-evaluate ⇒ readiness
excludes it. No cached boolean anywhere in the path.

**Acceptance Scenarios**:

1. **Given** one completed 8-colonist habitat and banked stock of exactly 1,209,600 g O₂
   and 840,000 g water,
   **When** readiness is evaluated,
   **Then** the habitat is `provisioned` and contributes its full capacity of 8.
2. **Given** the same state minus one gram of O₂,
   **When** readiness is evaluated,
   **Then** the habitat is **not** `provisioned` and contributes exactly 0.
3. **Given** a habitat previously reported provisioned and a tank subsequently drawn below
   the margin,
   **When** readiness is re-evaluated on a later turn,
   **Then** readiness **falls back** — the earlier verdict is not cached or sticky.
4. **Given** three completed habitats and provisions sufficient for one and a half,
   **When** allocation runs,
   **Then** habitats are provisioned **fully, in placement order** (one fully provisioned,
   two unprovisioned, contributing 8 rather than 0) — never spread thin into three zeros.
5. **Given** a completed Reserve and a brownout,
   **When** the turn resolves,
   **Then** the Reserve's 6 kW cryo draw is honoured **ahead of** any producing plant per
   the documented total order, and if it still cannot be met the report carries an explicit
   `life-support-unpowered` warning line — cryogenic stock is **not** lost this increment.

---

### User Story 4 — Ice wants poleward; sunlight wants the equator (Priority: P2)

At the survey screen, the player sees that accessible shallow ice only appears poleward of
roughly 35–40° latitude, while solar insolation peaks at the equator. The two sibling
chains pull the landing site in **opposite directions** and the player cannot have both
optima. The survey score exposes both components separately so the trade-off is visible,
and the commitment is made in the first sixty seconds of the game and paid for at turn 200.

**Why this priority**: P2 because the chain is mechanically complete without it — but this
is the best thing in the proposal and the reason to build chains 2 and 3 as a pair. It
turns the survey screen from a scoring exercise into a strategic commitment.

Grounding (measured facts): Phoenix struck buried ice within centimetres of the surface at
68°N in 2008; Mars Odyssey's neutron spectrometer mapped near-surface hydrogen globally;
NASA's SWIM maps show shallow ice poleward of ~35–40° with mid-latitude sheets that can
exceed 90% purity; Curiosity measured only ~2 wt% water in equatorial soil. The crossing
point of the two curves and the width of the contested band (~35°–50°) are **illustrative
shapes, not published curves** — the argument does not depend on their exact position.

**Independent Test**: Generate deposits on two fixed-seed maps, one equatorial and one
mid-latitude, and assert the equatorial map yields zero ice deposits while the mid-latitude
map yields some. Score the same hull anchors at both latitudes and assert the ice component
and the insolation component move in **opposite** directions.

**Acceptance Scenarios**:

1. **Given** a site at 10° latitude,
   **When** ice deposits are generated,
   **Then** zero shallow-ice deposits appear, deterministically for that seed.
2. **Given** a site at 45° latitude,
   **When** ice deposits are generated,
   **Then** shallow-ice deposits appear, deterministically for that seed.
3. **Given** two candidate sites at 10° and 45°,
   **When** both are scored,
   **Then** the ice-availability component is higher at 45° and the insolation component is
   higher at 10°, and both appear as separate named fields in the score breakdown.
4. **Given** the same `(terrain, latitude, options)` inputs,
   **When** deposits are generated twice,
   **Then** the two results are deeply equal (determinism ban still holds: no
   `Math.random`, `Date.now`, or Object/Map/Set iteration order).

---

### Edge Cases

Every item below is a **test that must exist before this merges**, ordered by how badly it
would hurt if it were wrong. Each maps to a task in `tasks.md`.

1. **Tank at exactly capacity** — stockpile equal to `storageCapacity` accepts zero further
   input, reports zero as a *stored* amount and the full input as *discarded*, and does not
   go one gram over. This boundary is where off-by-one storage bugs live.
2. **Overflow is reported, never silently dropped** — a turn producing more oxygen than the
   Reserve can hold emits an explicit overflow line carrying the discarded quantity. The
   test asserts the **report line**, not just the final stockpile.
3. **Hydrogen tank full and venting** — the specific instance of (2) that has no consumer at
   all, so it is the one most likely to be dropped from the code entirely.
4. **Oxygen consumed by a habitat completed the same turn** — ordering hazard. **Decision:
   a habitat completed on turn N draws provisions on turn N+1**; it is `built` on N and can
   first be `provisioned` on N+1. Documented and tested; the untested answer is the only
   wrong one.
5. **Ice deposit exhausted mid-build** — an Auger four turns into construction on a tile
   whose deposit is depleted must not throw, and must not silently complete into a structure
   that yields nothing forever with no explanation. Test the resulting state **and** the
   report line.
6. **Readiness recomputed when a tank drains below the margin** — a habitat can become
   UN-provisioned. This must be handled, not assumed one-way. No cached boolean.
7. **Partial provisioning across multiple habitats** — deterministic and documented: fully
   provision in **placement order** rather than spreading thin, because half-provisioned
   habitats count for nothing and spreading produces three zeros instead of one one.
8. **The Reserve idled by a brownout while holding cryogenic stock** — the Reserve's 6 kW
   sits **above** producing plants in the brownout total order. If it is still unpowered,
   the outcome is a reported warning and **no stock loss** (no boil-off this increment).
9. **Brownout during a partial build** — an Auger or Stack mid-construction when power goes
   short: build progress must not advance, must not reset, and must be reported.
10. **Empty stockpile and stockpile exactly equal to `buildCost`** — a build order with
    exactly enough material succeeds and leaves zero; one gram less fails cleanly with a
    legible reason. (`buildCost` itself is owned by `aic-c75`; this is its consumer test.)
11. **Determinism of the whole ledger across a replay** — same seed plus same orders
    produces a byte-identical trace across the full water/oxygen/hydrogen ledger, including
    overflow and vent lines, across at least 50 turns. This is the test that protects every
    item above from silently regressing.

---

## Requirements

### Functional Requirements

**Resources and units**

- **FR-001**: System MUST define `water`, `oxygen`, and `hydrogen` as resource kinds usable
  by the existing open-keyed `ResourceAmounts` / `Stockpile` records with **no new code
  branch per resource** — structures stay DATA.
- **FR-002**: All resource quantities MUST be integers in base units: **grams** for mass,
  **watt-hours** for energy. No floats anywhere in stored or reported quantities.
- **FR-003**: Mass↔energy conversions MUST use integer arithmetic with an explicitly
  documented rounding direction: **floor for produced output**, **ceil for energy and
  material cost**. The sim must never fabricate matter or free energy through rounding.
- **FR-004**: Per-turn energy figures MUST be derived from
  `turnDurationSeconds(config)` in `src/sim/time.ts`, never hardcoded.

**Storage (the first stored resource)**

- **FR-005**: System MUST support a per-resource stockpile **cap** sourced from
  `storageCapacity` on completed structures, summed across them.
- **FR-006**: A stockpile MUST NOT exceed its cap by any amount. At exactly capacity,
  further input stores zero.
- **FR-007**: Every gram that enters the simulation MUST end the turn either (a) in a
  stockpile, or (b) named in a cycle-report line as vented, overflowed, or consumed.
  **"No resource is ever destroyed without a cycle-report line" is an explicit, tested
  acceptance criterion**, asserted as a reconciliation invariant
  (`produced == stored_delta + consumed + reported_discarded`) per resource per turn.
- **FR-008**: Hydrogen MUST be banked to a capped tank and vented on overflow, with the
  vent **always** reported. Silent disposal is a defect.

**The chain**

- **FR-009**: Catalog MUST gain three entries — `ice-auger`, `electrolysis-stack`,
  `life-support-reserve` — as **data only**, with no change to simulation logic.
- **FR-010**: `ice-auger` MUST require a shallow-ice deposit tile
  (`siting.requiresDeposit: 'ice'`), and placement on a tile without one MUST be rejected
  with a typed `deposit-required` rejection carrying the tile and required resource. It
  MUST NOT throw — this is ordinary player error, per `placement.ts`'s existing convention.
- **FR-011**: `electrolysis-stack` MUST convert water at the fixed stoichiometry
  1 kg H₂O → 0.111 kg H₂ + 0.889 kg O₂, computed so the two outputs sum **exactly** to the
  water consumed.
- **FR-012**: `life-support-reserve` MUST carry a 6 kW standing draw and produce nothing.
  It is the game's first structure that is pure overhead.
- **FR-013**: A plant short of power or feedstock MUST **binary idle** — full rate or
  nothing, never a fractional rate — and the idle MUST be reported.

**Provisioning and readiness**

- **FR-014**: System MUST compute a per-habitat provisioning requirement from occupancy:
  **840 g O₂ per colonist per day × 180-day margin** and **3,500 g water per colonist per
  day × 30-day banked margin** (8 colonists ⇒ 1,209,600 g O₂ + 840,000 g water).
- **FR-015**: A habitat MUST count toward readiness only if `built` **and** `provisioned`
  (**and** `rated`, once Proposal 1 lands). Failing any factor contributes exactly 0.
- **FR-016**: `provisioned` MUST be **recomputed on every evaluation** from current
  stockpiles. No cached or sticky flag.
- **FR-017**: When provisions are insufficient for all habitats, allocation MUST fully
  provision habitats in **placement order**, deterministically.
- **FR-018**: A habitat completed on turn N first draws provisions on turn **N+1**.

**Brownout**

- **FR-019**: The brownout priority order MUST be a documented **TOTAL** order over all
  consumers, and the Reserve's 6 kW cryogenic draw MUST have a defined position in it:
  **life support ranks above production**.
- **FR-020**: An unpowered Reserve MUST emit a `life-support-unpowered` warning line and
  MUST NOT lose stock this increment (boil-off is explicitly deferred).

**Siting and latitude**

- **FR-021**: Shallow-ice deposit generation MUST be gated on latitude, with availability
  rising poleward of ~35–40°.
- **FR-022**: Site scoring MUST expose ice availability and solar insolation as **separate
  named components** of the breakdown, so the opposing pull is legible rather than netted
  away into one number.

**Non-functional**

- **FR-023**: All new modules MUST be sim-only with **zero React imports** (constitution
  §4) and MUST obey the existing determinism ban (no `Math.random`, `Date.now`, `new Date`,
  or Object/Map/Set iteration order), as enforced by `tests/unit/boundary.test.ts`.

### Key Entities

- **ResourceKind** — the canonical string keys `water`, `oxygen`, `hydrogen`, alongside the
  existing `electricity`. Open-keyed by design; validated once at the catalog boundary.
- **StorageCapacity** — a `ResourceAmounts` cap contributed by a completed structure. Summed
  across completed structures into a colony-wide per-resource cap. (Field owned by
  `aic-c75`; this feature is its first and hardest-requirement consumer.)
- **CappedLedgerResult** — the existing `LedgerResult` plus `stored`, `discarded` and the
  report lines that account for every gram. Extends, never replaces, `ledger.ts`.
- **CycleReportLine** — a typed, deterministically ordered record of something that happened
  this turn: production, consumption, idle, overflow, vent, deposit-exhausted,
  life-support-unpowered, shortfall. The vehicle for FR-007.
- **HabitatProvision** — the O₂ and water requirement for one habitat at its claimed
  occupancy, plus whether current stock satisfies it.
- **IceDeposit** — a typed deposit (`aic-m3t` gives `MineralDeposit` a resource kind).
  Today it is `{x, y, richness}` with no kind at all.

---

## Success Criteria

- **SC-001**: One Auger sustains exactly **8** Stacks (1,800 kg/turn ÷ 207 kg/turn = 8.7×);
  the ninth Stack requires a second Auger **and** a second ice tile. Asserted as a test on
  catalog data, so a balance change that breaks the intended decision is caught.
- **SC-002**: Provisioning one 8-colonist habitat costs **~8,700 kWh ≈ 4.4 reactor-turns**
  (1,360,630 g water electrolysed at 6,000 Wh/kg = 8,163,780 Wh, plus 544,252 Wh to mine
  the ice). Asserted within ±1% of the derived figure from catalog constants.
- **SC-003**: One Stack running flat out takes **6.6 turns** to fill one habitat's oxygen
  tank, against a 278-turn mission.
- **SC-004**: Reconciliation invariant holds for **every** resource on **every** turn of a
  50-turn replay: `produced == stored_delta + consumed + reported_discarded`.
- **SC-005**: A 50-turn replay from the same seed and orders produces a **byte-identical**
  trace, including every overflow and vent line.
- **SC-006**: Coverage thresholds met on all new modules: **80% lines, 70% branches, 60%
  functions** (constitution §1).
- **SC-007**: Zero React imports and zero determinism-ban violations in `src/sim/`, enforced
  by the existing `tests/unit/boundary.test.ts`.
- **SC-008**: An equatorial site yields zero ice deposits and a 45° site yields some, from
  the same terrain seed — the site tension is real and observable, not documentation.

---

## Assumptions & Open Items

Working defaults are in use — **nothing is blocked**. Each of these is catalog data or one
documented rule, not a rewrite, if overruled.

- **A-001**: One Life Support Reserve holds exactly **one habitat-provision** (1,209,600 g
  O₂ + 840,000 g water), so "one Reserve per habitat, full tank means ready" is legible
  without arithmetic. Cost of being wrong: low and reversible — a capacity number in data.
- **A-002**: **Life support outranks production** in the brownout total order; an unpowered
  Reserve is a reported warning, not a loss. Cost of being wrong: moderate — the inverse
  quietly destroys banked provisions, a save-ruining outcome discovered late.
- **A-003**: Hydrogen is **banked to a capped tank, vented on overflow, vent always
  reported**. Cost of being wrong: high if the answer is "ignore it".
- **A-004**: A habitat completed on turn N draws provisions on turn **N+1**.
- **A-005**: `rated` (Proposal 1) may not exist yet. If absent, readiness is a two-factor
  test with `rated` treated as satisfied and a documented TODO — never silently failed.
- **A-006**: The proposal's 49.66 h turn is the same number `time.ts` already owns
  (178,775 s). This spec treats `time.ts` as the single source of truth; if the two ever
  disagree, `time.ts` wins and the catalog throughputs move with it.
