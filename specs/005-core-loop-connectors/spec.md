# Spec — Core Game Loop & Connectors

**Feature**: 005-core-loop-connectors
**Root epic**: `aic-loop` (see beads-import.md)
**Source**: `docs/turn-composition-audit.md` (aic-8eq) + accepted proposal `55009338`

## The problem in one sentence

Every simulation subsystem exists, is unit-tested, and is at ~100% coverage — and **none of
them are connected**. `computeDroneShift`, `evaluateMission`, `applyLedger`,
`evaluateLanding`, `advanceConstruction` and `resolveBrownout` all have **zero production
callers**. 710 passing tests prove the parts work. Nothing proves the *game* works.

This epic builds the missing layer: the state the colony lives in, the connectors between
subsystems, and the turn resolver that composes them into an actual game loop.

## What already exists (build on, do not duplicate)

| Asset | Provides |
|---|---|
| `src/sim/world.ts` | `World`, `generateWorld` — terrain + deposits + buildability |
| `tests/integration/turn-harness.ts` | `runTrace`, `findDivergence`, `expectDeterministic`, canonical serialisation |
| 15 sim modules | every subsystem operation, unit-tested, uncomposed |

## The dependency cycle and the invariant that breaks it

```
power budget  ←  operational structures  ←  accumulated labour
     ↓                                             ↑
drone charging  →  drones on shift  →  labour  ────┘
```

Power needs completion; completion needs labour; labour needs power.

> **INVARIANT (the single most important rule in this epic).** The set of operational
> structures is computed **once, at the top of the turn**, from **start-of-turn**
> accumulated labour. Every downstream step reads that frozen snapshot.

Without it, a structure completed during turn N draws power during turn N, and the entire
turn's outcome changes depending on statement order inside one function. That is a
determinism bug that unit tests cannot see.

## Turn order (authoritative)

| # | Step | Why here |
|---|---|---|
| 1 | Apply player orders (queue / cancel) | An order issued for turn N must affect turn N |
| 2 | **Freeze the operational set** | Breaks the cycle. Read-only from here |
| 3 | Sum generation | Depends only on step 2 |
| 4 | Assemble demands — one per consumer **and one per drone** | Makes binary idle correct for a divisible fleet |
| 5 | **Brownout** (`resolveBrownout`) | Single authority for who runs |
| 6 | Powered drone demands → drones on shift → labour-hours | Replaces drones.ts's own power arithmetic |
| 7 | Advance construction | After the freeze, so progress this turn grants no production this turn |
| 8 | Production ledger over **complete AND powered** consumers | Binary idle: a shed consumer contributes *no* flow, not a clamped one |
| 9 | Advance the clock | |
| 10 | Evaluate mission on **post-construction** completion | Deliberate asymmetry — a habitat finished this turn counts toward victory |
| 11 | Emit the cycle report | The explainability promise, made concrete |

## User stories

### US1 — A turn actually resolves (Priority: P0)
`resolveTurn(state) → state` composes every subsystem in the order above.

**Acceptance**
- Returns a NEW state; never mutates its input.
- Sub-step order is documented and asserted, not implicit.
- Same state resolved N times yields byte-identical output.
- An empty colony resolves safely as a no-op.
- Every subsystem operation gains a production caller (the zero-consumer sweep comes back clean).

### US2 — Connectors resolve the contradictions (Priority: P0)
The audit's B-series contradictions are decided, once, in code.

**Acceptance**
- **Exactly one** module decides who keeps power (`brownout.ts`'s total order).
- Electricity has **one owner** and one unit (integer Wh); `ledger.ts` and `power.ts` no longer both claim it.
- Idle is **binary**: a shed consumer produces nothing, rather than a clamped fraction.
- Reactors are distinguishable from other structures; generation is data-driven, not a code constant.
- Every subsystem's input/output contract is stated at the seam, not inferred.

### US3 — The game starts (Priority: P1)
Landing output becomes an initial colony state. Today `evaluateLanding` is a dead end.

**Acceptance**
- A chosen landing produces a turn-0 `ColonyState`: hulls placed as pre-built structures, starting drones and reactors from the surviving holds, the lost ship reflected as absent.
- Turn 0 → turn 1 resolves without special-casing.
- Same seed + same landing ⇒ identical turn-0 state.

### US4 — The player can see why (Priority: P1)
Each turn emits a readable account: completions, shed structures **with the cut line and rationale**, shortfalls, labour applied vs unused, capacity, turns remaining.

**Acceptance**
- Every shed consumer names *why* it was shed and where the cut line fell.
- Labour applied and labour wasted are both reported.
- The report is derived from resolution output, never recomputed by the reader.

### US5 — Determinism is proven over a full mission (Priority: P0)
**Acceptance**
- A committed golden trace covers a multi-turn scenario; divergence names the exact turn and field.
- A **full 278-turn mission** runs headlessly and reproduces identically.
- Injecting `Math.random`/`Date.now` into the turn path demonstrably fails.
- Float accumulation across hundreds of turns cannot drift the outcome (audit C1).

## Out of scope

Rendering, and the three resource chains (`aic-d8y`, `aic-sfq`, `aic-85z`). Those stay gated
until this loop is proven fun — the accepted proposal's own condition.

## Success criteria

- A full mission plays out end to end, deterministically, in tests.
- The zero-production-consumer sweep returns **nothing**.
- Coverage gates hold; determinism is regression-guarded, not asserted by hand.
