# Balance pass (aic-oby.4): is the core loop fun?

Author: Egon Stetmann. Scope: measure and tune the reactor-vs-habitat power/labour
squeeze the MVP proposal's core loop rests on, using a real headless 278-turn runner
(`src/sim/mission-runner.ts`) driven by scripted strategies (`src/sim/
balance-strategies.ts`), against the real production catalog (`src/sim/
catalog-data-core.ts`). Reproduce every number below with:

```bash
npx tsx scripts/balance-report.ts
```

and the regression gate that keeps them from drifting is `tests/integration/
balance-pass.test.ts` (44 assertions, part of `npm run verify`).

**Read this first if you only read one section: [The honest verdict](#the-honest-verdict-is-it-fun).**

---

## 0. A finding before any measurement: there was nothing to measure

Before writing a single strategy, I read `catalog-data.ts`, `colony-start.ts`,
`mission.ts` and `power.ts` end to end, because the task said to measure first. What I
found: **no buildable reactor and no buildable habitat existed anywhere in production.**
`catalog-data.ts`'s own header says so outright — "there is no habitat catalog entry in
production yet" — and its three entries (Regolith Hopper, Sinter Press, Shield Berm) all
declare `habitatCapacity: 0`. The only structures with `habitatCapacity > 0` anywhere in
the codebase lived in test fixtures (`tests/integration/golden-scenario.ts` and about a
dozen unit-test builders). `src/app/state/game-state.ts`'s `buildColony` places only the
two landed hulls (drone hold, reactor hold — both `habitatCapacity: 0`), and no build
menu wires a habitat or a second reactor to anything a player, or a headless runner,
could ever queue.

Concretely: **the mission's win condition (`mission.ts`: completed habitat capacity ≥
incoming wave size) had no reachable path to a WIN at all, in production, before this
bead.** This is a different, and larger, kind of finding than "the numbers need
retuning" — it is "the game could not be played to a win," full stop.

I treated authoring the missing structures as data-only work, not a logic change,
because every physical figure involved is already ratified elsewhere and I invented
nothing about *how* the sim resolves them:

- The reactor reuses `power.ts`'s `REACTOR_OUTPUT_WATTS` (40 kWe) — the identical unit
  the landed reactor hull already runs. It is a second unit of existing hardware, not a
  new design.
- The habitat reuses `catalog.ts`'s own cited, ratified 32 kW rated / 6.4 kW standby
  draw (aic-96o — "two independent derivations agreed").
- `buildTurns`, `habitatCapacity` and `incomingWaveSize` are genuinely new balance data,
  and are exactly what this bead exists to measure and tune — see §2 and §3.

`src/sim/catalog-data-core.ts` is the new module; `tests/unit/catalog-data-core.test.ts`
pins it. Nothing in `turn.ts`, `power.ts`, `brownout.ts`, `construction.ts`, `ledger.ts`
or `mission.ts` changed — new structures generate, draw, get shed, and count toward the
verdict entirely because those modules already do exactly what their own headers say
they do for any catalog entry.

## 1. The harness

`src/sim/mission-runner.ts` is a new production module (not a script) that bootstraps a
colony at fixed landing anchors, then resolves every turn up to
`time.totalTurns(mission.turnCycle)` (278, for the ratified turn cycle), applying a
scripted `Strategy`'s build/cancel intents each turn via the same `orders.applyOrders`
path a real player's clicks go through. It is fully unit-tested in isolation
(`tests/unit/mission-runner.test.ts`, 10 tests) against a synthetic catalog, so its
*mechanics* — turn count, placement, "no room to build" reporting, determinism — are
proven independent of the real roster.

`src/sim/balance-strategies.ts` supplies the four strategies the brief asked for, but as
**two decision rules and one combinator**, not four independent implementations:

- **`naive`** — if nothing is under construction, queue a habitat. Never queues a
  reactor, whatever the power margin.
- **`considered`** — tracks one ratio: what share of *current* total generation is
  already claimed by completed habitats' permanent standby draw (default ceiling 30%,
  `DEFAULT_MAX_HABITAT_SHARE_OF_GENERATION`). Below the ceiling, queue a habitat; at or
  above it, queue a reactor. (Anchored to *current* generation, not the full 33-drone
  fleet's theoretical demand — the colony starts able to power only a fraction of its
  fleet by design, so a rule anchored to the full fleet would tell a "considered" player
  to build nothing but reactors for a third of the mission, which is not what the word
  means here.)
- **`naiveUntil(turn)`** — `naive` strictly before `turn`, `considered` at and after it.
  `naive` is `naiveUntil(∞)`; `considered` is `naiveUntil(1)`. RECOVERY and
  LATE-RECOVERY are `naiveUntil(90)` and `naiveUntil(250)` — the same correction logic,
  applied at different turns, which is the only way a comparison between them means
  anything.

**A mid-measurement design finding, not assumed up front:** a "considered" strategy that
only ever *waits* for an in-flight project to finish before queueing something better
cannot actually recover. `construction.ts`'s allocation rule is a strict left-to-right
dam — the first queued project absorbs a turn's labour before any surplus reaches the
second — so a corrective reactor queued behind a naive-phase habitat earns nothing until
that habitat finishes, and with few drones on shift (exactly the situation a correction
is trying to fix) that wait can burn most of the turns a recovery has left. The fix was
to let `considered` **cancel** an in-flight habitat when the *current* margin is already
unsafe, using the `orders.ts` `CancelBuildOrder` a real player already has (wired since
`game-state.ts`'s `issueOrders`) — not a new mechanic, a strategy finally using an
existing one. Without this, RECOVERY at turn 90 measured as a LOSS (§3); with it, a
correction is viable through turn 107.

## 2. What the first measurement said, honestly

I did not start by changing numbers. The first full run, with plausible-looking
first-guess values (reactor 4 build-turns, habitat 8 build-turns / capacity 8,
`incomingWaveSize` 32), said:

| strategy | seed 1–10 | verdict |
|---|---|---|
| naive | WON, capacity 48/32 | **the naive strategy already won** |
| considered | WON, capacity 1,448/32, reached 32 by **turn 7** | solved before the mission started |

Both halves of "if the naive strategy already wins, the game is too easy" and "a
competent playthrough finishing near the deadline" were violated at once. Diagnosis:

- **The naive ceiling is a hard, wattage-derived number, independent of build cost or
  turns remaining.** One reactor generates 1,986,389 Wh/turn; each completed habitat's
  standby draw (317,822 Wh/turn) outranks drone recharge in the brownout order
  (`PRIORITY_HABITAT` = 200, shed *after* `PRIORITY_DRONE_RECHARGE` = 300 — i.e. a
  completed habitat is always fed before the workforce that built it). Once six
  habitats are standing, `1,986,389 − 6 × 317,822 = 79,457` Wh of spare capacity remains
  — less than one drone's 275,204 Wh reservation, so **zero drones ever charge again,
  forever**, regardless of how many of the 278 turns are left. A naive colony always
  drifts to exactly this ceiling (48 capacity, 6 habitats) and then freezes solid. This
  is the death spiral, and it is real, structural, and independent of any number I
  tune — which is exactly why raising the win threshold safely above it (see §3) makes
  naive lose *by construction*, not by luck.
- **The reactor/habitat power ratio compounds close to exponentially** once a colony
  has more than a couple of reactors — each new reactor unlocks proportionally more
  future labour, so a fixed win threshold gets swallowed almost regardless of where you
  set it, in linear-turn terms. Milestone sweep at the first-guess build costs: capacity
  16 by turn 4, 320 by turn 62. Raising the wave size alone cannot fix "wins too early":
  going from 32 to even 1,000,000 only adds a few more turns per doubling.

**The correct lever was build-turns, not wave size.** I raised `REACTOR_BUILD_TURNS`
and `HABITAT_BUILD_TURNS` in steps (4→20→40→15→8, and 8→40→80, respectively — see the
git history / measured log below) while re-running the milestone sweep each time, until
a considered strategy's climb landed with room before the deadline rather than solving
the game in its first tenth. Final: `REACTOR_BUILD_TURNS = 8`, `HABITAT_BUILD_TURNS =
80` (ten times the reactor — habitats are the goal, not the infrastructure).

## 3. The wave size: a bug, and then an escalation

**`src/app/state/game-state.ts`'s `INCOMING_WAVE_SIZE` was `6`. This is a bug, not a
tuning gap, and it should be logged as one separately from everything else in this
report.** A single completed Habitat Module (`HABITAT_CAPACITY_PER_MODULE = 8`) already
exceeds `6` — meaning the moment the missing habitat/reactor data landed at all, the
mission would have been **mechanically unloseable** by over-building, because there is
no way to over-build the *one* habitat that already wins the game. The entire
"power-vs-labour death spiral" the MVP's design rests on was unreachable, not merely
easy.

I retuned it to `400` (50 habitats' worth), the figure at which the full battery below
holds:

| target | naive ceiling clears it? | considered reaches it by | verdict |
|---|---|---|---|
| 100 (illustrative, see below) | no | turn ~67–77 | **trivially early** — about a quarter of the mission |
| 400 (landed) | no (naive caps at 48, always) | turn ~201/278 | near the deadline, comfortable margin |

**Escalation, mid-pass:** the coordinator flagged that `100` colonists is not an
arbitrary placeholder — it was ratified by name ("wave 2 is 100 colonists — the first
real win condition," a commit message recording the General's own ruling) on a sibling
branch. My measurement is that `100` is reached by a considered player at turn ~67–77,
which is trivially early against a 278-turn mission under the build costs this pass
lands on. I am not overruling that ruling; `400` stays in place for this pass (so the
suite in `tests/integration/balance-pass.test.ts` is internally coherent) while the
coordinator escalates the actual number to the General with this measurement attached.
**If the General holds at 100, the fix is cheap: a smaller `incomingWaveSize` paired
with proportionally smaller `REACTOR_BUILD_TURNS`/`HABITAT_BUILD_TURNS` (the milestone
sweep in `scripts/balance-report.ts` is exactly the tool for re-deriving them) — far
cheaper than having shipped a win condition he did not choose.**

## 4. The measured battery (final tuning: reactor 8 turns, habitat 80 turns / capacity 8, wave 400)

All ten seeds (1–10) agree **exactly** — see §6 for why that is itself a finding, not a
coincidence to be proud of.

| strategy | outcome | final capacity | turns in brownout | max drones offline | completions |
|---|---|---|---|---|---|
| **naive** | **LOST**, every seed | 48 / 400 | 278 (100% of the mission) | 33 of 33 (all) | 6 |
| **considered** | **WON**, every seed | 568 / 400 | 64 | 27 of 33 | 109 |
| **recovery** (naive until turn 90, then considered) | **WON**, every seed | 432 / 400 | 124 | 31 of 33 | 83 |
| **late-recovery** (naive until turn 250, then considered) | **LOST**, every seed | 48 / 400 (identical to pure naive) | 278 | 33 of 33 | 6 |

- **Naive is capped at exactly 48 capacity forever**, on every seed, whether it is given
  20 turns or 278 — the wattage ceiling from §2, confirmed at the final tuning.
- **Considered wins at turn ~201/278 (72% of the mission)** — not trivially early
  (§2's first-guess number was turn 7), not stalled to the very last turn either.
- **Recovery, caught at turn 90, wins — barely (432 vs. a 400 target, an 8% margin).**
  The full trajectory (in the report script's output) shows the colony genuinely
  bricked toward zero drones through the 70s and 80s (as low as 1 drone on shift), the
  correction's cancelled habitat and freshly queued reactor bringing it back to a full
  33-drone shift by turn ~109, and steady habitat production afterward. This is a real
  recovery arc, not a foregone conclusion re-labelled.
- **Late-recovery, caught at turn 250, is indistinguishable from never correcting at
  all** — by then the colony has been at zero drones since roughly turn 200 (see the
  naive trajectory), and a corrective order queued into a colony with no labour left to
  spend on it is a no-op. This is the intended asymmetry: the same fix, applied too
  late, does nothing, not "does less."

**Precise crossover, measured (not estimated):** correcting at turn 107 still wins;
correcting at turn 108 does not, on every seed checked. This comfortably brackets the
brief's own illustrative bracket — turn 90 (recoverable, 17 turns of margin) and turn
250 (not recoverable, 142 turns past the cliff).

## 5. Weather: scheduled, and currently inert — stated, not glossed over

aic-oby.3 landed a real, seeded dust-storm scheduler, and every run above genuinely
lives through it — seed 1 sees 17 storm-turns out of 278, seed 2 sees 30, seed 3 sees 2
(the scheduler's own designed variance, ~0.84 expected storms per mission). **But
disabling storms entirely (`stormOnsetProbabilityPerTurn: 0`) changes nothing about any
outcome above, byte for byte** (`tests/integration/balance-pass.test.ts`'s
`'should currently be unaffected by dust storms'`, and the report script's own check,
confirm this for seeds 1–3).

This is not a bug. `generation.ts`'s `SOLAR_DECAY_KIND` curve is the one registered
curve that reads `GenerationEnvironment.dustStorm`; every generator in the current
buildable roster — the landed reactor hull and the new Reactor Unit alike — uses the
default `constant` curve, which by design ignores it entirely (a fission reactor's
output is not weather-dependent; that is correct physics, not a gap). Dust storms will
start to matter the moment a solar generator exists in the catalog — that is
`aic-sfq.4` (Photovoltaic Array), a full, currently-0%-built resource chain (silica
deposit siting, a Silica Sifter, a Silicon Furnace) — and building that chain is
explicitly out of scope for a data-tuning balance pass. I considered adding a minimal
stand-in solar generator solely to exercise weather and decided against it: it would
not be "tuning existing data," it would be inventing a new structure with its own
economy ahead of the epic that owns it.

**Running across multiple seeds was still worth doing and is not vacuous**, for two
reasons: it is what let me discover (empirically, not by assumption) that seed has zero
effect on outcomes *given this specific roster* (§6), and it is the harness aic-gom.8
asked for regardless of what any one roster currently uses it for — chain 2/3
structures will make seed matter the moment they land, and the same runner will measure
that without modification.

## 6. Honest limitation: outcomes are currently seed-invariant

Every seed (1 through 10) produced byte-identical `finalHabitatCapacity`, `won`,
`turnsInBrownout` and `completions` for every strategy. This is not a coincidence to
paper over: with only the Reactor Unit and Habitat Module in the roster, **nothing that
varies by seed can reach anything the mission outcome depends on.** Terrain and mineral
deposits only matter to structures with a `siting.requiresDeposit` (chain 1's Hopper,
not in this roster); dust storms only matter to the `solarDecay` curve (§5, not in this
roster either). The fixed landing anchors (`mission-runner.ts`'s
`DEFAULT_DRONE_HULL_ANCHOR`/`DEFAULT_REACTOR_HULL_ANCHOR`) validated on every seed tried
(consistent with `game-state.ts`'s own note that measured buildability minimum is
~0.67 — a generated map essentially never refuses a reasonable anchor pair).

This will stop being true the moment a deposit-gated or weather-sensitive structure
enters the roster. Recorded here so nobody mistakes "the balance pass ran across ten
seeds" for "seed variance was exercised" — it was exercised and found, honestly, to be
currently a non-factor for this specific two-structure economy.

## 7. What changed, and what did not

**New, data-only:**
- `src/sim/catalog-data-core.ts` — the missing Reactor Unit / Habitat Module catalog
  entries (§0). `REACTOR_BUILD_TURNS = 8`, `HABITAT_BUILD_TURNS = 80`,
  `HABITAT_CAPACITY_PER_MODULE = 8` — all measured, all cited in-file.
- `src/app/state/game-state.ts`'s `INCOMING_WAVE_SIZE`: `6 → 400` (§3 — a bug fix, then
  a measured retune, pending the General's ruling on the ratified `100`).

**New, harness/tooling (production `src/sim` code, unit-tested, no sim-rule changes):**
- `src/sim/mission-runner.ts` — the headless full-mission runner (also closes
  `aic-gom.8`'s stated acceptance criteria, incidentally).
- `src/sim/balance-strategies.ts` — the four scripted strategies (two rules, one
  combinator).
- `scripts/balance-report.ts` — the reproducible source of every number in this
  document.
- `tests/integration/balance-pass.test.ts` (44 assertions), `tests/unit/
  mission-runner.test.ts` (10), `tests/unit/balance-strategies.test.ts` (13),
  `tests/unit/catalog-data-core.test.ts` (15).
- `tests/integration/composition-audit.test.ts`'s `ACCEPTED_ORPHANS` allowlist gained
  two entries (`catalog-data-core.coreStructureSpecs`, `balance-strategies.
  createBalanceStrategies`) with the same "public API awaiting its caller" citation the
  list already uses for `colony-start.startMission` and `catalog-data.
  chainOneStructureSpecs` — their natural callers are a script and this test, not `src/`
  production code, exactly like those two precedents.

**Untouched:** `turn.ts`, `power.ts`, `brownout.ts`, `construction.ts`, `ledger.ts`,
`mission.ts`, `generation.ts`, `weather.ts`, `catalog.ts`, `catalog-data.ts` (chain 1).
`tests/integration/turn-golden.test.ts` passes unchanged, byte for byte — nothing in
this pass touches any structure the golden scenario's own private catalog uses.

**Found, not fixed — reported instead, per the brief's own instruction to STOP AND
REPORT rather than route around a logic gap:**
- The colony's opening turn-1 brownout (7 of 33 drones on shift, ~1.03M Wh vented) is
  the deliberate, documented consequence of the General's "no storing energy without
  barriers" ruling (`power.ts`'s own "turn-capacity model" header section), already
  captured by name as `aic-qbh` ("Batteries recover ~50% of wasted generation..."),
  explicitly marked "DO NOT BUILD YET." I checked whether a battery could be added as
  pure catalog data to close this gap myself: **it cannot, today.** `power.ts`'s own
  precondition block states that the moment any structure grants
  `storageCapacity.electricity > 0`, the current `DRONE_TURN_CAPACITY_WH` reservation
  becomes wrong — it would *under*-report the achievable drone count rather than
  correctly account for banked energy, because `resolveElectricity` would need to
  reserve `DRONE_GRID_ENERGY_WH` instead for the bankable portion, and nothing computes
  that split today. That is a logic change to the allocator, not a data value, and it is
  already correctly scoped to `aic-qbh`, not this bead. I did not touch it.

## 8. Reproducibility

Every run above is `runMission({ seed, mission, strategy })` — a pure function of its
arguments (no `Math.random`, `Date.now`, or `new Date` anywhere in `mission-runner.ts` or
`balance-strategies.ts`; both are covered by the project's whole-`src/sim` static
nondeterminism scanner, `tests/unit/boundary.test.ts`). `tests/integration/
balance-pass.test.ts`'s own determinism test calls `runMission` twice with identical
params and asserts `JSON.stringify` equality. To reproduce every table above from
scratch:

```bash
npx tsx scripts/balance-report.ts
```

## The honest verdict: is it fun?

**Not yet — but the reason is legible, and it is not the death-spiral mechanic itself.**

The mechanic works. I did not assume that; I measured it. Naive play is *structurally*
incapable of winning (a wattage ceiling, not a soft difficulty curve) — that is exactly
what makes over-building habitats a real mistake rather than a slow, forgiving loss.
Catching it early is a genuine recovery arc with a visible cliff (turn 107 vs. 108, on
every seed I checked), not a coin flip. A considered player is rewarded, and finishes
with real margin before the deadline rather than solving the mission in its first tenth.
That is the shape a good "one wrong call costs you the game, and there was a window to
notice" mechanic should have, and right now it has it.

What is missing is everything *around* that mechanic that would make discovering it
feel like play rather than arithmetic:

1. **There is still no way to act.** This pass measured against the assumption (per the
   coordinator) that a player can queue structures from turn 1 — but as of this
   writing, that is not yet true in the shipped game; `aic-oby.7` (a build UI) is
   landing concurrently with this report. Until it does, everything in this document is
   true of the *sim*, and the *player* still cannot experience any of it. That is not
   this bead's gap to close, but it is the single largest reason the honest answer is
   "not fun yet" rather than "fun."
2. **The choice a "considered" player is making is currently a single, repeated
   arithmetic comparison** — "is completed-habitat standby draw under 30% of current
   generation" — not a legible, on-screen number. `aic-oby.5` ("surface the cut line and
   shed rationale in the UI") is exactly the bead that turns this from a spreadsheet
   fact into something a player can *see* coming, the same way my scripted strategy can
   "see" it by reading `colony.queue` directly. Without that surface, a human player
   discovers the death spiral by falling into it once, blind, which is a harsher
   teacher than the mechanic itself intends to be (the brief's own "recoverable if
   caught early" promise depends on the player being *able* to catch it).
3. **The recovery margin is thin by design (8%, 432 vs. 400) at exactly the turn (90)
   the brief names as the illustrative "still fine" case** — appropriate for a game
   whose tension is meant to bite, but worth the coordinator's attention if the
   General's eventual ruling on wave size (§3) changes the arithmetic underneath it.
4. **The two structures in this pass are the whole game's economy for now.** §6's
   finding — ten seeds, one identical outcome each — is the sharpest evidence that a
   currently-fun colony sim is still, mechanically, a two-variable equation. The
   resource chains (regolith/silica/ice — 0% built beyond chain 1's Hopper/Press/Berm,
   none of which touch power or habitat capacity yet) are what will turn "build reactor
   or habitat" into a genuinely interesting sequence of decisions, and what will make
   the ten seeds stop agreeing with each other.

**What would make it more fun, in priority order:** ship `aic-oby.7` so the loop this
report measured is actually playable; ship `aic-oby.5` so the margin in point 2 is
visible before it is lost; get the General's ruling on wave size (§3) and re-run this
exact harness against it (one command, `scripts/balance-report.ts`, no manual
re-derivation); then, only once the two-structure loop has been played by a human and
found fun on its own terms, let the resource chains widen the decision space `aic-qbh`'s
battery and the silica/ice chains both promise.
