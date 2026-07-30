# Design Proposals

Rendered snapshots of the Adjutant design proposals for AI City. Each `.html` file is
**fully self-contained** — inline CSS, inline SVG, no external assets and no dependency on
a running Adjutant server. Open any of them directly in a browser.

These are archived here because Adjutant proposals live in a local service; the repo
should carry the design record on its own.

| # | Proposal | Author | Status |
|---|---|---|---|
| 00 | [MVP — Mars Colony Builder](00-mvp-mars-colony-builder.html) | stetmann | **accepted** |
| 01 | [Chain 1 of 3 — Break Ground (Regolith → Sinter → Shielded Habitat)](01-chain-regolith-shielded-habitat.html) | raynor | pending |
| 02 | [Chain 2 of 3 — Sunlight and Silica (Silica → Silicon → Solar Array)](02-chain-silica-solar.html) | raynor | pending |
| 03 | [Chain 3 of 3 — Ice, Air and the Provisioned Habitat](03-chain-ice-air-life-support.html) | raynor | pending |
| 04 | [First Light — engine to playable game](04-first-light.html) | stetmann | pending |

## Reading order

**Start with 00.** It is the accepted MVP and the only one that defines the core loop, the
mission clock, and the locked physical parameters everything else builds on:

- one turn = one drone duty cycle = 25 h work + 1 sol recharge = **2.014 sols**
- mission = **577 days = 278 turns** (Earth–Mars synodic period − Starship transit: the
  interval from landing until the next colonist wave *departs* Earth)
- reactor **40 kWe** (NASA Fission Surface Power target unit)
- drone recharge **5.54 kW** grid draw, and **recharging competes with structures for
  reactor output** — power and labour are one constraint

**01–03 are the deferred backlog.** The accepted MVP binds on **electricity alone**. These
three chains are planned and dependency-gated but deliberately not startable until turn
resolution and the golden-trace regression prove the core loop is fun. That gating is the
proposal's own condition, not an afterthought.

## Caveat on 00

Proposal 00 was written before the deadline was re-grounded against real mission
engineering and still shows the earlier **352-turn** figure. The authoritative number is
**278 turns**; see `specs/001-mars-colony-mvp/spec.md` and `src/sim/time.ts`, where the
derivation is documented in code so it stays auditable.
