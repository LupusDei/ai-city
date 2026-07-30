# Plan — Core Game Loop & Connectors

**Feature**: 005-core-loop-connectors · **Root epic**: `aic-loop`

## Architecture

```
src/sim/
  state.ts       ColonyState — the one thing a turn transforms. NEW.
  orders.ts      player intents: queue / cancel. Validated, typed rejections. NEW.
  generation.ts  reactor identity + data-driven generation (audit E1/E2). NEW.
  resolve.ts     resolveTurn(state, orders) -> { state, report }. THE COMPOSITION ROOT. NEW.
  report.ts      CycleReport — completions, cut line, shortfalls, labour. NEW.
  bootstrap.ts   landing -> turn-0 ColonyState (audit E3). NEW.
  scenario.ts    headless full-mission runner. NEW.
```

Existing modules are **called**, not rewritten — except where the audit's B-series
contradictions force a decision (electricity ownership, binary idle, brownout authority).

## The three decisions this epic makes permanent

1. **Brownout authority — `brownout.ts` wins.** Its total order is monotone; `power.ts`'s
   first-fit-continue is not. Non-monotone shedding means "I built another reactor and my
   factory switched off," which is unplayable and unbalanceable. `power.ts` keeps
   `computePowerBudget` as the drones integration point so the proven
   `power-drones.test.ts` seam survives unchanged.
2. **Electricity has one owner, in integer Wh.** `ledger.ts` owns stockpiled resources;
   power flow-of-the-turn is the brownout path. They stop overlapping.
3. **Idle is binary.** A shed or unpowered consumer contributes *no* flow. A clamped
   fraction is unexplainable to a player and order-dependent in float.

## Phases

| Phase | Content | Parallel |
|---|---|---|
| 1 | Foundational connectors — state, generation/reactor identity, contradiction fixes | partly **[P]** |
| 2 | The resolver — orders, resolveTurn, report | sequential (this is the cycle) |
| 3 | Bootstrap — landing → turn 0 | **[P]** with phase 2's report |
| 4 | Proof — golden trace, full 278-turn mission, zero-consumer sweep | after 2 |

## Parallel opportunity

Phase 1 splits cleanly across three disjoint new files (`state.ts`, `generation.ts`,
`orders.ts`) plus one surgical edit each to `power.ts` and `construction.ts`. Phase 2's
`resolve.ts` is deliberately **not** parallelised — it is the cycle, and splitting it is how
the ordering invariant gets broken.

## Coordination

`karax` holds `aic-96o` (electricity contradiction) and `aic-8eq` (the audit). `raynor` holds
the resource chains and `aic-9ol` (allocator replacement). This epic **consumes** their
outputs; it does not re-litigate them. Phase 1 beads that touch `power.ts`/`ledger.ts` are
explicitly gated on their P0s landing, so we do not collide in shared files.

## Risk

The ordering invariant (freeze the operational set at the top of the turn) is the one thing
that cannot be recovered by tests written later — a wrong order still produces a plausible,
self-consistent, *deterministic* game that is subtly wrong. It is called out in the spec, in
`resolve.ts`'s header, and asserted by a dedicated test that a structure completed on turn N
draws no power on turn N.
