# Feature Specification: Playable Start Flow

**Feature Branch**: `005-playable-start`
**Created**: 2026-07-30
**Status**: Draft
**Epic**: reconciles under existing `aic-8tl` (Epic 3 — Renderer & UI). **No new root epic.**

## The goal, stated as the General stated it

> "Run the game, start it, select a landing site, and begin my first turn."

That is one vertical slice through every layer the project has built and never connected.
It is not a UI task with a sim behind it — it is the **bridge**, and the bridge is where
this project has failed three times (`aic-c1p`, `aic-8eq`, `aic-ck0`).

## What exists, and what is missing

| Layer | State |
|---|---|
| Sim core — 14 modules, 812 tests, deterministic 278-turn resolution | **Shipped** |
| `world.generateWorld` — seeded terrain, buildability, typed deposits | **Shipped, test-only caller** |
| `landing.evaluateLanding` — validation + 3-axis site scoring | **Shipped, test-only caller** |
| `turn.createColony` / `turn.resolveTurn` | **Shipped, test-only caller** |
| Bridge: a scored landing → a started colony | **MISSING** (`aic-hfb`) |
| React + Vite + Canvas toolchain | **MISSING** — zero UI deps installed |
| Sim/UI adapter & intent dispatch | **MISSING** (`aic-8tl.5`) |
| Any screen at all | **MISSING** |
| Browser acceptance harness | **MISSING** |

**The honest summary: the game is 812 tests of engine with no ignition.**

## Why these acceptance criteria are browser-level, not unit-level

Every defect this project has shipped passed its unit tests. A unit test cannot answer
"can a person start this game and take a turn" — only a test that launches the real app
and clicks the real buttons can. So the definition of done for this feature is an
**acceptance suite that drives a real browser against a real dev server**, and it is
written BEFORE the app so it fails for the right reason first.

Three of the criteria below (**AC-3**, **AC-6**, **AC-9**) exist specifically to catch the
seam defect class: they assert that data actually *flows* rather than that a screen
merely *renders*. AC-6 is the one that would have caught `aic-c1p`.

---

## User Scenarios & Testing

### User Story 1 — Launch and survey (Priority: P1, MVP)

As the mission director I open the game and see the Martian surface I must choose from,
so my first decision is informed rather than blind.

**Independent test**: `npm run dev`, open the served page, assert a terrain grid renders
and a seed is displayed.

**Acceptance Scenarios**
1. **Given** a clean checkout, **When** the dev server starts and the page loads, **Then**
   the Surface Survey screen renders with no uncaught console errors.
2. **Given** the survey screen, **When** it loads, **Then** the terrain grid is drawn to a
   canvas and the generating seed is visible on screen.
3. **Given** the same seed, **When** the page is reloaded, **Then** the rendered terrain is
   identical.

---

### User Story 2 — Choose a landing site consequentially (Priority: P1, MVP)

As the mission director I place two hulls and see the site score respond, so the choice is
a decision rather than a formality.

**Independent test**: select two different candidate sites; assert the displayed score
differs.

**Acceptance Scenarios**
1. **Given** the survey screen, **When** I select a candidate site, **Then** a site score
   and its three components (buildability, deposit proximity, hull separation) are shown.
2. **Given** two different candidate sites, **When** each is selected, **Then** the
   displayed scores **differ** — proving the score is computed from the surveyed world and
   not a constant.
3. **Given** an illegal site, **When** I attempt to place a hull there, **Then** a specific
   reason is shown (`out-of-bounds` / `unbuildable` / `overlapping-hulls`) and no hull is
   placed.
4. **Given** fewer than two hulls placed, **When** I look for the start control, **Then**
   it is present but disabled, and states what is missing.

---

### User Story 3 — Begin the mission from that choice (Priority: P1, MVP)

As the mission director I confirm my landing and arrive at a colony that is **the one I
chose**, so my decision carries into the game.

**Independent test**: land at a site whose surveyed world has N deposits; assert the
started colony reports the same N.

**Acceptance Scenarios**
1. **Given** two legally placed hulls, **When** I confirm, **Then** the Colony Operations
   screen appears.
2. **Given** the started colony, **When** I inspect it, **Then** its grid dimensions,
   deposit count and hull positions **match the surveyed world I chose** — not a freshly
   generated one. *(This is the `aic-c1p` guard: a bridge that looks right and silently
   re-rolls the world would pass every other criterion here.)*
3. **Given** the started colony, **When** it first renders, **Then** it shows turn 1 of
   278, power generation and draw, drones on shift, and habitat capacity 0.

---

### User Story 4 — Take the first turn (Priority: P1, MVP)

As the mission director I end my first cycle and see the colony respond, so the loop is
real.

**Independent test**: click End Cycle; assert the turn counter advances and turns-remaining
decrements by exactly one.

**Acceptance Scenarios**
1. **Given** Colony Operations at turn 1, **When** I click End Cycle, **Then** the display
   advances to turn 2 and turns-remaining goes from 277 to 276.
2. **Given** a resolved turn, **When** I read the screen, **Then** any brownout is stated
   with its cut line, and any vented energy is reported as a number — never silently
   dropped.
3. **Given** the same seed, same landing choice and same orders, **When** the flow is
   repeated, **Then** the turn-1 display is **identical**. *(Determinism observable through
   the UI, not merely asserted in the sim.)*

---

### Edge Cases

- Page loaded with no seed in the URL — must generate one and display it, never crash.
- Reload mid-survey with one hull placed — must not present a half-started mission.
- End Cycle clicked twice rapidly — must advance exactly one turn, not two.
- End Cycle at turn 278 — must show the mission verdict, not turn 279.
- A canvas of zero size (hidden container) — must not throw.
- Browser back after starting — must not resurrect a stale survey over a live colony.

## Requirements

### Functional

- **FR-001**: `npm run dev` MUST serve the app; `npm run build` MUST produce a static bundle.
- **FR-002**: The app MUST derive all displayed state from the sim modules. **No game logic
  in components** (constitution §4) — the existing sim/renderer boundary guard MUST still pass.
- **FR-003**: A bridge MUST convert a `ReadyLanding` plus its surveyed `World` into a
  `ColonyState`, with the hulls pre-placed. It MUST NOT regenerate the world.
- **FR-004**: All player actions MUST go through a single intent-dispatch surface, so the UI
  never mutates sim state directly.
- **FR-005**: The seed MUST be visible and reproducible from the UI.
- **FR-006**: Illegal actions MUST surface the sim's typed rejection reason verbatim, not a
  generic message.

### Non-Functional

- **NFR-001**: Acceptance suite runs headless in CI via `npm run test:acceptance`.
- **NFR-002**: `npm run verify` continues to pass unchanged — lint, typecheck, coverage.
- **NFR-003**: The sim remains free of React imports and DOM access.

## Success Criteria

- **SC-001**: A person can run one command, land, and complete turn 1 in a browser.
- **SC-002**: Every acceptance criterion above is an executing test, not prose.
- **SC-003**: `world.generateWorld`, `landing.evaluateLanding`, `turn.createColony` and
  `turn.resolveTurn` all have **production** consumers — i.e. they leave the composition
  ratchet's allowlist. **This is the measurable definition of "the engine has ignition."**
- **SC-004**: CI green.

## Explicitly out of scope

Build-tray placement of new structures, the cycle-report screen (`aic-8tl.4`), the three
resource chains, save/load, art. This slice is **launch → survey → land → one turn**, and
nothing else. Scope creep here delays the moment the game becomes playable at all.
