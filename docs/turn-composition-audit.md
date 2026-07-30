# Turn Composition Audit

**Bead:** `aic-8eq` (P0) / `aic-a00.6` · **Author:** karax · **Date:** 2026-07-30
**Status:** Phase 1 complete. Read section A before scheduling any Phase 2 work.

---

## Verdict, up front

Nine of the ten sim modules fit together. **Two do not, and it is not adapter-shaped.**

`aic-a00.4` (resource ledger) and `aic-a00.9` (power & brownout) both closed at 100%
coverage having each decided, independently and reasonably, that they own electricity.
They chose different units, different semantics (a stockpiled quantity vs. an
instantaneous rate), and different homes for a structure's draw. Neither imports the
other. Neither is wrong on its own terms. **They cannot both be right**, and the
resolution changes `catalog.ts`, `ledger.ts` and `power.ts` — two of which are being
edited by other agents right now. See **B1** and **B2**.

Separately, the brownout rule that shipped in `aic-a00.9` is not a total order, is
**non-monotone** (I have the arithmetic: adding generation switches a running factory
off), and orders drone recharge against processors the opposite way round from the three
accepted resource-chain specs. See **B3**–**B6**.

And before any of that can be tested: **no branch in this repository contains all five
closed sim-core modules.** See **A1**.

Everything else — 12 further findings — is a genuine gap rather than a contradiction, and
Phase 2 can absorb it.

---

## A. Blockers

### A1. Two of the five closed sim-core modules do not exist on `main`

Verified with `git ls-tree`, not inferred:

| Module | Bead | On `main` | On `agent/raynor` | On `agent/stetmann` |
|---|---|---|---|---|
| `src/sim/power.ts` | `aic-a00.9` (closed) | **no** | **no** | yes |
| `src/sim/construction.ts` | `aic-a00.8` (closed) | **no** | **no** | yes |
| `src/sim/world.ts` | `aic-c1p` (closed) | **no** | yes | **no** |

`aic-a00.9` and `aic-a00.8` are closed with detailed close reasons describing tests that
have never run in the same tree as the modules they integrate with. The 344-test baseline
on this branch **does not include power or construction at all** — so "344 green" was
never evidence about those two beads.

A turn loop cannot be written, let alone tested, until `agent/stetmann` and
`agent/raynor` are both in one tree. Good news, verified: `git merge-tree --write-tree
agent/raynor agent/stetmann` succeeds cleanly — the two branches touch disjoint file
sets.

**This merge is a hard prerequisite for Phase 2.** It is one command.

### A2. `placement.ts` has already diverged between branches

`agent/stetmann` changed `applyPlacement` from returning `Grid` to returning an
`ApplyResult` discriminated union (`aic-a00.13`), because the old signature silently
no-op'd when a `ValidPlacement` was applied to a different grid than it was validated
against. `main` and `agent/raynor` still have the old signature.

The change is a genuine improvement and the merge is textually clean (different files),
but note what it means: **`construction.ts` on `agent/stetmann` is written against an
`applyPlacement` that does not exist on `main`.** Anyone who merges `construction.ts`
without `placement.ts` gets a compile error; anyone who cherry-picks in the other order
gets a silent behaviour change. Merge both or neither.

---

## B. Hard contradictions — two closed beads that cannot both be right

### B1. `ledger.ts` and `power.ts` both own electricity, in incompatible units and semantics

**Severity: highest. This is the finding I was asked to stop and shout about.**

Three independent conflicts in one place:

| | `ledger.ts` (`aic-a00.4`) | `power.ts` (`aic-a00.9`) |
|---|---|---|
| What electricity *is* | a resource key in `produces`/`consumes` | an instantaneous rate |
| Unit | unitless catalog numbers | `kW`, floating point |
| Where a structure's draw lives | `StructureType.consumes.electricity` | `PowerConsumerStructure.drawKw` |
| Accumulates across turns? | **yes** — `Stockpile` carries it forward | no |
| Who decides a shortfall | `applyLedger`, by clamping at 0 | `allocateStructurePower`, by shedding |

Consequences, each independently disqualifying:

1. **A structure's electricity draw has two homes with no link between them.** If a
   catalog author writes `consumes: { electricity: 12 }`, `power.ts` never sees it. If
   they populate `drawKw`, the ledger never sees it. If they populate both, the colony
   pays twice. Nothing detects any of the three.
2. **`applyLedger` would let electricity accumulate a stockpile** — you could bank
   reactor output across turns and spend it later. The ratified physics explicitly rules
   this out (batteries are not modelled for diurnal smoothing; a turn spans two full
   sols, so generation averages out *within* a turn). `ledger.ts` has no concept of a
   resource that must not accumulate, and adding one is a change to its core type.
3. **`power.ts` is float `kW`; the accepted specs require integer base units** (spec 002
   FR-001). `aic-5ub` is converting the ledger right now. `power.ts` is not in its scope.

**This is not adapter-shaped.** An adapter that converts kW to ledger units still leaves
two authorities deciding who gets electricity, in a system where that decision *is* the
game. One of the two modules has to stop owning electricity.

**Recommendation (a decision for Raynor, not for me to make silently):** electricity
leaves the ledger entirely. The ledger keeps mass-denominated stockpiling resources
(regolith, silica, plate, ice) where accumulation is the correct model; electricity
becomes a per-turn flow owned by the power path and never stockpiled, with a structure's
draw read from catalog data (see **B4**). That keeps `ledger.ts`'s stock semantics honest
for everything it retains, instead of bolting a "this one doesn't accumulate" exception
onto the type.

### B2. `ledger.ts`'s clamp-and-report is incompatible with binary idle

`applyLedger` lets a consumer draw a resource **down to zero** and reports the gap as a
`Shortfall` — i.e. it *partially* consumes. That is a coherent design, thoughtfully
documented, and it is the opposite of what the accepted specs require:

> spec 002 FR-004: a structure whose per-turn power draw cannot be met MUST be **fully
> idle** for that turn — binary idle, never a fractional rate — and MUST consume **none**
> of its per-turn inputs while idle.
>
> spec 003 FR-006: a consumer short of any input (power or feedstock) MUST **idle
> wholly**.

Under binary idle a starved Sinter Press consumes **0 g** of regolith, not "as much as
was left". So the run/don't-run decision must be made **before** the ledger ever sees
that consumer's flow, and `applyLedger`'s clamp-and-shortfall path becomes either dead
code or a last-resort invariant assertion.

Same family as B1: the ledger was built assuming divisible partial consumption; the
accepted design requires all-or-nothing. Both are defensible. Only one can be the rule.

### B3. The shipped brownout rule is not a total order, and it is non-monotone

`allocateStructurePower` walks consumers in the caller's array order with a
"first-fit-continue": a consumer that does not fit is shed, **but the walk continues**, so
a cheaper lower-priority consumer can claim capacity a shed higher-priority one could not
use. That is a bin-packing heuristic, not shedding in a total order — and specs 002
(FR-005) and 003 (FR-007) both require the latter, "asserted by test".

It is deterministic. It is not monotone, and that is worse. Two consumers, Press 30 kW
(higher priority) and Hopper 12 kW (lower priority):

| Budget | First-fit-continue outcome |
|---|---|
| 20 kW | Press doesn't fit → skipped. Hopper fits in the leftover → **Hopper runs.** |
| 30 kW | Press fits, takes all of it → **Hopper stops.** |

**Building a reactor turns a working factory off.** No cycle report can explain that to a
player, and no player can plan around it. This is arithmetic from the shipped code, not a
hypothetical.

`src/sim/brownout.ts` (this pass) fixes it with strict-order shedding and pins
monotonicity as a budget sweep in `tests/unit/brownout.test.ts`. See section D.

### B4. `power.ts` puts every structure above drone recharge; the specs put drone recharge in the middle

`power.ts` level 1: *all* structures are powered before drone charging gets any budget,
justified by analogy to real grids curtailing EV charging before hospitals.

Spec 003 T010's documented order: life support → habitat → **drone recharge** → silicon
furnace → silica sifter → all others.

Under `power.ts`, a Sinter Press placed early in the array starves the drone fleet. Under
the specs it never can. This is not a detail — it decides whether a brownout costs you
*this turn's output* or *all future construction*.

**The analogy does not survive this colony.** It is UNMANNED for the entire mission
(ratified): there are no hospitals because there are no people. And the drones are not
consumer vehicles, they are the entire workforce. A shed processor loses one turn of
output while its feedstock keeps piling up in an overflowing stockpile — largely
recoverable. A drone that misses its charging window loses one turn of progress on
*everything under construction*, against a hard 278-turn deadline, and that turn never
comes back. The specs are right; the closed bead is wrong.

### B5. Drone offline priority: roster array position vs. ascending instance id

`aic-a00.12`'s `computeDroneShift` documents its priority rule as **position in the
roster array** ("seniority — the newest additions are curtailed first"), explicitly and
carefully, as a determinism guarantee.

Spec 003 FR-007 requires the tie-break to be **ascending structure instance id**, "so no
two runs can differ".

These give different offline sets whenever roster order ≠ id order. Both are
deterministic; only one can be the rule.

**Recommendation: ascending id.** Array-position priority means the outcome depends on
how the *caller* built its array, so two callers holding the same colony get different
brownouts, and a golden trace could pass for one and fail for the other. Ascending id is
intrinsic to colony state. (The seniority *flavour* is preserved for free if ids are
issued in acquisition order, which they naturally are.)

### B6. Priority is a property of the caller's array, not of the colony

Generalising B3/B5, because it recurs in both `power.ts` and `drones.ts`: in both
modules "priority" is defined as array position. That makes brownout outcomes a function
of caller bookkeeping rather than of world state. It also quietly defeats the accepted
proposal's promise that brownouts are *"deterministic and explainable, never whatever the
iteration order happened to be"* — array order is not Map iteration order, but it is
still not an explanation. There is no answer to "why was my furnace shed" except
"because of where it sat in an array nobody showed you".

`brownout.ts` makes priority `(priorityClass, instanceId)`, both intrinsic, and pins
array-order-invariance with a test.

---

## C. Latent determinism defects inside closed, 100%-covered code

### C1. `construction.ts` accumulates a float across hundreds of turns, then floors it with no epsilon

`ConstructionProject.accumulatedLabourHours` is documented as
"fractional-safe accumulated labour-hours". `advanceConstruction` adds to it every turn.
`turnsCompletedFor` then does:

```ts
const rawTurns = Math.floor(project.accumulatedLabourHours / hoursPerTurn)
```

Today every labour figure happens to be integral (`labourCapacityHours` returns
`25 * droneCount`), so nothing has gone wrong yet. It is one change away from going
wrong, and the failure is maximally severe:

- Spec 003 FR-012 has solar-panel cleaning drawing drone-hours from the same pool.
  Any fractional labour source makes `accumulatedLabourHours` a float that
  **accumulates across up to 278 turns** — exactly what `time.ts`'s header identifies as
  unforgivable ("a colony sim that cannot replay identically from the same seed is not a
  colony sim, it is a slot machine").
- A `1e-13` deficit then flips `Math.floor` down by one, which flips a habitat from
  complete to incomplete, which makes it contribute **zero** capacity
  (`mission.ts`'s deliberate "9/10 houses nobody" rule), which loses the mission.

The asymmetry is the tell: `drones.ts` felt the need for an explicit `FLOOR_EPSILON` to
survive precisely this floor-a-float-quotient hazard, and documented it at length.
`construction.ts` performs the identical operation with no epsilon.

**Recommendation:** track progress in **integer labour-seconds** (or integer
milli-hours), not float hours. `time.ts` already proves the pattern. An epsilon would
paper over it; integers remove it.

### C2. `power.ts`'s `brownout` flag is permanently true in the intended steady state

```ts
brownout: allocation.totalStructureDemandKw + droneRosterSize * DRONE_RECHARGE_DRAW_KW > generationKw
```

It measures demand against the **full** roster. But the ratified balance has the player
owning ~33 drones (a 100 t Starship hold at ~3 t/drone) and able to charge only ~22
(120 kW ÷ 5.54 kW). An over-subscribed roster is **the intended, designed steady state**,
not an alarm. So this flag is true from turn 1 to turn 278, and a UI wired to it warns
the player about the normal condition of the game forever.

`brownout.ts` defines a brownout as "something was actually shed", which is true when it
should be and false otherwise.

---

## D. How a turn *would* compose

Here is the composition, in the order it has to happen and with the reasons the order is
forced. Two of these orderings are non-obvious and would otherwise be decided by
accident.

### D0. There is a dependency cycle, and exactly one ordering breaks it

```
power budget  ←  which structures are operational  ←  accumulated labour
     ↓                                                        ↑
drone charging  →  drones on shift  →  labour-hours  ──────────┘
```

Power needs completion; completion needs labour; labour needs power. **This is acyclic if
and only if power reads a START-OF-TURN completion snapshot.** Nobody has written that
down anywhere, and if a future turn loop resolves construction first and then power, a
structure completed this turn immediately draws power this turn — and the whole turn's
outcome changes silently depending on statement order in one function.

**Invariant to hold:** the set of operational structures is computed once, at the top of
the turn, from start-of-turn accumulated labour, and every downstream step reads that
frozen snapshot.

### D1. The order

| # | Step | Calls | Why here |
|---|---|---|---|
| 1 | Apply player orders (queue/cancel builds) | `queueConstruction`, `cancelProject`, `releaseTiles` | An order issued for turn N must affect turn N. Applying it after resolution delays it a turn from what the player saw. |
| 2 | **Freeze the operational set** | `turnsCompletedFor`, `isStructureOperational` | Breaks the cycle (D0). Read-only from here on. |
| 3 | Sum generation | *(needs redesign — see E1)* | Depends only on step 2. |
| 4 | Assemble demands | catalog data → `PowerDemand[]`, one per operational consumer **and one per drone** | One demand per drone is what makes binary idle correct for a divisible fleet. |
| 5 | **Brownout** | `resolveBrownout(demands, generation)` | Single authority for who runs. |
| 6 | Drone shift → labour | powered drone demands = drones on shift; `labourCapacityHours` | Replaces `computeDroneShift`'s own power arithmetic (B4/B5). |
| 7 | Advance construction | `advanceConstruction(config, queue, labourHours)` | After step 2's freeze, so progress made this turn does not grant production this turn. |
| 8 | Production ledger | `applyLedger` over flows from consumers that are **complete (step 2) AND powered (step 5)** | Binary idle: a shed or starved consumer contributes *no* flow, not a clamped one (B2). |
| 9 | Advance the clock | `turnsTaken := N + 1` | |
| 10 | Evaluate the mission | `evaluateMission(config, N+1, habitats)` using **post-construction** completion | See D2. |
| 11 | Emit the cycle report | cut line, shed ids + rationale, shortfalls, labour applied/unused, capacity | The explainability promise, made concrete. |

### D2. The deliberate asymmetry in step 10 — decide this explicitly or it will be decided by accident

Step 8 reads **start-of-turn** completion. Step 10 reads **end-of-turn** completion. That
looks like an inconsistency. It is a deliberate choice, and the alternative is worse:

- A habitat finishing on turn 278 must **count toward the win** — construction completed
  before the deadline, and the deadline is when the next wave *departs Earth*.
- The same habitat must **produce nothing** on turn 278 — it never actually operated for
  any part of that turn.

Freezing completion once for both would mean a habitat finished exactly on time houses
nobody and the player loses on a technicality. Recomputing for both would grant a
structure a free turn of output on its completion turn. The asymmetry is correct; it just
has to be written down, because it reads like a bug.

### D3. Per-module input/output contract

| Module | Needs | Returns | Notes for the turn loop |
|---|---|---|---|
| `time.ts` | `TurnCycleConfig`, `turnsTaken` | integer seconds, turn counts, labour-hours | Sound. The project exemplar. Integer-only. |
| `grid.ts` | `width`, `height`, `Coord` | `Grid`, `Tile` | Sound. Row-major, immutable. |
| `terrain.ts` | `(w, h, seed)` | `Terrain` | Sound, seeded. |
| `buildability.ts` | `Terrain` | `BuildabilityMap`, `MineralDeposit[]` | Sound. Owns a duplicated PRNG (**E5**). |
| `world.ts` | `(w, h, seed, opts)` | `World` | The one existing composition layer. Only on `agent/raynor`. |
| `landing.ts` | `Grid`, anchors, deposit coords, scorer | `LandingReadiness` | Output is a **dead end** (**E3**). |
| `catalog.ts` | raw specs | `StructureCatalog` | The one validation boundary. Missing: `priorityClass`, `buildCost`, generator output, a consumer/generator kind (**E1**, **E2**). |
| `placement.ts` | `Grid`, `StructureType`, anchor | `PlacementResult` / `ApplyResult` | Sound. Signature differs by branch (**A2**). |
| `construction.ts` | `TurnCycleConfig`, queue, labour-hours | new queue, applied/unused | Float accumulator (**C1**). Already provides `toHabitatStructure`/`toResourceFlow` — the adapter pattern to copy. |
| `drones.ts` | config, roster, charging kW | on/offline split, labour-hours | Priority rule conflicts with specs (**B5**). Float kW. |
| `power.ts` | reactors, structures, roster size | generation, powered/unpowered, charging budget | **B1**, **B3**, **B4**, **C2**, **E1**. |
| `ledger.ts` | `ResourceFlow[]`, `Stockpile` | balances, stockpiles, shortfalls | **B1**, **B2**, **E4**. |
| `mission.ts` | config, `turnsTaken`, habitats | `MissionOutcome` | Sound. Will need a second readiness factor (**E6**). |
| `brownout.ts` *(new)* | `PowerDemand[]`, integer budget | powered/shed, cut line | Written this pass. |

---

## E. Gaps — missing seams, not contradictions

### E1. `REACTOR_OUTPUT_KW` is a code constant, and the generation model already cannot express an accepted spec

`catalog.ts`'s header sets the contract for the whole sim: *"Structure types are DATA,
never code branches."* `power.ts` puts a reactor's output in a module constant and sums it
with `totalGenerationKw`. Two consequences:

- A second reactor type cannot be expressed at all.
- **Spec 003 adds solar arrays**: generators with per-turn output that *decays* by 0.4%
  per turn of soiling and is knocked down further by dust storms. `totalGenerationKw`
  (count × constant) literally cannot represent them. The generation model is already
  known-insufficient for an accepted spec, before anyone starts that work.

**Recommendation:** generation is `produces: { electricity: N }` catalog data, resolved
through the same path as every other production flow. Then a solar array is data plus a
retention multiplier, not a new code branch.

### E2. Nothing distinguishes a reactor from any other structure

`computePowerBudget(reactors, structures, ...)` takes generators and consumers as two
separate arrays, but no field anywhere — no `kind`, no `isGenerator` — lets the turn loop
partition its queue into those two arrays. The only available discriminator is
`structureType.id === 'reactor'`, which is exactly the hardcoded branch `catalog.ts`
forbids. Fixed for free by E1.

### E3. `landing.ts`'s output is a dead end — the turn-0 seam is missing entirely

`evaluateLanding` returns a `ReadyLanding` with two hull anchors and a score. **No
function takes it and returns a started colony.** Nothing converts a landed hull into grid
occupancy, into reactor instances, or into a drone roster. The player's opening move
currently produces a number and nothing else.

This is the same shape as `aic-c1p` — a scored decision with no consumer — and it is
Phase 2 work.

### E4. `ResourceFlow` has no identity, so per-structure reporting is unrepresentable

`applyLedger` takes `readonly ResourceFlow[]`, and `ResourceFlow` is `{ produces,
consumes }` with **no id**. Two consequences:

- `power.ts`'s own documented contract — "a future turn-resolution step is expected to
  zero out their ledger production flows for exactly the ids in `unpoweredStructureIds`"
  — cannot be honoured by joining ids to flows, because there is nothing to join on. It
  works only if the turn loop filters the *project* list before mapping to flows. Fine,
  but fragile and undocumented.
- Spec 002 FR-007 requires a **distinct reported reason per structure** for input
  starvation vs. power starvation. The ledger cannot attribute a shortfall to a structure
  at all.

`ResourceFlow` needs an optional consumer id, or the ledger needs a keyed input.

### E5. Two copies of `mulberry32`, with a third scheduled

`terrain.ts` has it private; `buildability.ts` duplicates it verbatim with a comment
explaining that `terrain.ts` was off-limits to edit at the time. Spec 003 FR-013 requires
the dust-storm schedule to use "the same `mulberry32` construction". That is a third copy.

A drifted PRNG is a silently broken golden trace. Export it once from one module.

### E6. `mission.ts` has no "rated" factor, and spec 002 requires two

`totalHabitatCapacity` counts any *complete* habitat. Spec 002 FR-011: readiness MUST be
a two-factor test — built **AND** rated (shielded by a Shield Berm) — and an unrated
habitat MUST contribute exactly 0. `mission.ts` will change. The turn loop should not
hard-code around `HabitatStructure` in a way that makes that painful.

### E7. `buildTurns` does not mean turns

`catalog.ts` says "turns of drone work to complete" and never pins it. `construction.ts`
pins it to `labourCapacityHours(config, 1)` = 25 labour-hours, i.e. **one drone working
one turn**. So `buildTurns: 10` means 250 labour-hours, which 17 drones finish in a single
turn. The arithmetic is consistent everywhere; the *name* is a trap, and `mission.ts`'s
`turnsCompleted` inherits it. Rename to `buildDroneTurns` / `droneTurnsCompleted`, or
document it in `catalog.ts` where authors actually read.

### E8. Nothing produces a drone roster

`computeDroneShift` takes `readonly DroneId[]`. No production code creates one. The drone
hull carries ~33 drones per the ratified figures; that is modelled nowhere. Belongs with
E3.

### E9. There is no colony state type

No `ColonyState`, `GameState` or `TurnState` exists anywhere in `src/` (grepped). Five
modules each take a bespoke *view* of the same structure instances — `PowerReactor[]`,
`PowerConsumerStructure[]`, `ConstructionQueue`, `HabitatStructure[]`, `ResourceFlow[]` —
and today a caller would have to maintain those as parallel arrays kept in sync by hand,
with nothing checking that they agree.

This is the actual work of `aic-a00.6`: **one canonical instance record, with every
module's view derived from it by a total function.** The pattern already exists —
`construction.ts`'s `toHabitatStructure` and `toResourceFlow` are exactly it. It needs
`toPowerDemand` and one owner.

### E10. `landing.ts` re-declares `FootprintOffset`

Structurally identical to `catalog.ts`'s, declared separately with a documented rationale
(a landed hull is not a catalog structure). Defensible, but two exported types with one
name in one directory is a papercut worth one import.

---

## F. Open questions for the General

### F1. Does a completed but empty habitat draw life-support power? *(load-bearing, filed)*

The MVP colony is **unmanned** (ratified) — zero humans until the wave arrives. Life
support is specced at ~4 kW *per colonist*. 4 kW × 0 colonists = 0, which would leave the
top class of the brownout order empty for the entire game.

But the ratified balance figures appear to assume otherwise, and the arithmetic is
specific: 3 × 40 kWe = 120 kW supports 120 / 5.54 = **21.7 drones**, and the ratified note
says **17.1 drones "with one habitat running"**. The difference is 4.6 drones × 5.54 kW ≈
**25 kW for one habitat** — which is ~4 kW × 6 colonists of *rated* capacity, drawn while
nobody is inside.

So the ratified reactor/drone numbers — the ones proving power and labour are
co-binding — already depend on an unmanned habitat drawing full life support. That is a
defensible model (you must prove the habitat works before the wave commits to leaving),
but it is written down nowhere, and if the answer is "no draw until the wave lands" the
whole power balance changes.

### F2. Watt-hours or watt-seconds?

Spec 002 FR-001 says integer **watt-seconds**. Spec 003 T010 says
`resolveBrownout(demands, availableWh)` — **watt-hours**. Factor of 3600 apart. `aic-5ub`
is converting the ledger to integer base units *now* and needs the answer.

`brownout.ts` is deliberately scale-free so it does not have to pick (see its header), but
the ledger cannot dodge it.

### F3. Confirm the electricity ownership resolution (B1) before anyone builds a resource chain

All three chain epics (`aic-d8y`, `aic-sfq`, `aic-85z`) add power consumers. If B1 is
resolved after those start, all three redo their work.

---

## G. What landed in this pass

| File | Status | Tests |
|---|---|---|
| `src/sim/brownout.ts` | **new** — the total order, strict-order shedding, binary idle | 33 |
| `tests/unit/brownout.test.ts` | **new** — incl. the monotonicity sweep that condemns first-fit-continue | |
| `tests/integration/turn-harness.ts` | **new** — golden-trace harness, injected step | 30 |
| `tests/integration/turn-harness.test.ts` | **new** — plants Math.random / clock / mutation and asserts the harness catches them | |
| `docs/turn-composition-audit.md` | **new** — this document | |

`npm run verify`: typecheck clean, build clean, **407 tests passing** (baseline 344),
coverage **100% / 100% / 100%** against the 80/70/60 gate.

**Not touched**, per the parallel-work embargo: `catalog.ts`, `ledger.ts`,
`buildability.ts`, `terrain.ts`, `scale.ts`, `placement.ts`, `power.ts`, `construction.ts`.

### The brownout decision, recorded

**Binary idle: agreed** — a consumer runs at full rate or not at all. Fractional
throughput reintroduces float drift into accumulating stockpiles and produces cycle
reports no player can act on. The three accepted specs independently require it.

**Strict-order shedding, no backfill: decided here.** Walk the total order from the top;
from the first consumer that does not fit, everything below is shed too, even if it
individually would have fitted. Costs idle generation. Buys: monotonicity (more power
never switches anything off), a powered set that is always a *prefix* of the priority
order, and a whole turn's brownout explained by **one integer** — the cut line. In a game
whose entire tension is the power budget, visible waste is a legible, actionable problem;
a bin-packer that hides it is neither.

**Priority is `(priorityClass, instanceId)`**, both intrinsic to colony state. Priority
classes are catalog data with 100-spacing so a new consumer slots in without renumbering
and without a code branch. Ids compare by UTF-16 code unit, **never** `localeCompare`
(locale- and ICU-dependent: two machines would disagree about who was shed, which is the
exact bug class the golden trace exists to catch).

**The order**, highest priority first: life support → habitat → drone recharge →
downstream processors → upstream processors → unclassified. Drone recharge above all
processors (B4). Downstream above upstream because the accepted numbers show feeders
over-produce their converters 40–80×, so feedstock is abundant and conversion is scarce —
shed the abundant stage.

---

## H. Recommended Phase 2 sequence

1. Merge `agent/stetmann` + `agent/raynor` into `main` (**A1**, **A2**). Verified clean.
2. Get a ruling on **B1** (electricity ownership) and **F2** (units). Both block the chains.
3. `ColonyState` + the derivation functions (**E9**) — the actual content of `aic-a00.6`.
4. `resolveTurn` in the D1 order, with D0's freeze and D2's asymmetry documented in code.
5. Integration test over multiple consecutive turns through `turn-harness.ts`; commit the
   golden trace (`aic-a00.7`).
6. Fix **C1** (integer labour) before any fractional labour source lands.
7. File beads for **E1**–**E10**.
