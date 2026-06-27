# Pluribus altar-ready broadcast (/console + /dispatch)

**Goal:** Add a button to `/console` and `/dispatch` that voices, via the existing TTS, which visitors are **altar-ready** (cleared the pre-altar stations and waiting) — and switch `/dispatch`'s right column to show those altar-ready people instead of the fully-completed ones.

**Approach:** Centralize the altar-ready predicate in `@channelers/shared`; the brain exposes the altar-ready *list* in `DispatchState` (it already exposes the count). A tiny pure stage module turns either data shape into sorted numbers and builds the announcement; one shared `PluribusBroadcast` component reuses `speak()` + `useDevices()` + `<DevicePicker>` to play it. `/dispatch`'s right column renders the new list. `state.completed` is untouched (the `/board` roster still needs it).

**Tech stack:** TypeScript monorepo. Shared: `packages/shared` (zod + types). Backend: `apps/brain` (Fastify dispatcher). Frontend: `apps/stage` (React + Vitest, colocated `*.test.ts`).

---

## Why / design

### Problem
The overseer wants to announce, on command, the visitors who have **completed the stationing process** — which (clarified) means the **altar-ready** state: they have finished intake + bodyscan and are waiting, *before* the altar is enabled. Fixed line:

> INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... USERS [user numbers], YOU HAVE COMPLETED THE STATIONING PROCESS

Triggerable from **both** `/console` and `/dispatch`. Additionally, `/dispatch`'s right column should list the **altar-ready** people (not the fully-completed `sessionEndAt` people it shows today).

### Scope
- **In:** shared `isAltarReady` predicate; a brain-exposed altar-ready list in `DispatchState`; a shared broadcast control on `/console` + `/dispatch`; `/dispatch` right column → altar-ready roster; pure selector/text module.
- **Out:** removing/altering `state.completed` (the `/board` roster depends on it); dedicated "Pluribus" voice; WS/OSC fan-out; persistence; auto-fire/scheduling. (YAGNI.)

### "Altar-ready" — the predicate
`isAltarReady(v) = v.location.state === "waiting" && !!v.intakeAt && !!v.poseAt && !v.sessionEndAt`

This is exactly the brain's existing altar-ready *count* logic (`dispatcher.ts:424`). Centralizing it in shared means the **console announcement set**, the **dispatch list**, and the **`altarReady` count** all key off one definition and cannot diverge. In the fiction, "altar-ready" === "completed the stationing process".

### Approaches considered
- **Brain exposes the altar-ready list; shared predicate; one component (chosen).** `/dispatch` stays purely `dispatch.state`-driven (the brain already sends the count; the list is a natural sibling). `/console` computes locally from its `VisitorProfile[]`. Local playback per the Choreo precedent.
- **Client-only, no backend change** (rejected): `/dispatch` only holds `state` (queue entries don't expose intake/pose, and `eligible` omits "altar" while the altar is closed — the exact moment this is used), so it *can't* compute altar-ready without either a new `api.listVisitors()` poll (breaks the board's single-source `dispatch.state` design) or a backend list. The backend list is cleaner.
- **WS-broadcast fan-out / duplicate the control** (rejected): unnecessary protocol surface / copy-paste drift.

### Decisions resolved with the user
- **Set = altar-ready**, not `sessionEndAt` (clarified).
- **`/dispatch` right column = altar-ready roster**, replacing the completed roster.
- **Voice:** fixed default — `speak(text)` no archetype → ElevenLabs `DEFAULT_VOICE_ID` (or OpenAI `sage`). No new config.
- **Output:** per-screen output-device picker, `sinkId` → `speak()`.
- **Both screens** carry the control.

### Decision log
- **`state.completed` retained.** `/board` ([Board.tsx:43](app/apps/stage/src/routes/Board.tsx#L43)) maps it to "DONE" rows. The brain keeps sending it; the brain **adds** `altarReadyList`; only `/dispatch`'s display switches.
- **`isAltarReady` lives in `@channelers/shared`** and `flowHealth().altarReady` is refactored to use it — single source of truth.
- **`/dispatch` placement:** broadcast control = full-width strip right after `<FlowStrip>` (beside the altar gate + "altar-ready N" stat); the narrow 1fr right zone becomes the altar-ready roster (the `.completed` class has **no** CSS — `styles.css:162-163` only styles `.zones`/`.zone` — so renaming the column is safe). *Fallback if the strip breaks the no-scroll layout: move the control into the header next to the arrivals `<span>`.*
- **Pluralize USER/USERS by count** (1 → "USER 3"). *Faithful-to-template alternative: always "USERS" — change the one-liner in Task 2.*
- **Natural-language join:** `[3]→"3"`, `[3,7]→"3 and 7"`, `[3,7,12]→"3, 7, and 12"` (Oxford comma → clean TTS pause).
- **Empty state:** button disabled when the set is empty (the component guards, not the formatter).
- **Per-screen output choice** via a `storageKey` prop (`out.console` / `out.dispatch`), per-tab sessionStorage.
- **Numbers sorted ascending**; countdown left literal (`tts.ts` applies `speed: 0.7`); **no new CSS** beyond renaming the zone label.

---

## Global constraints

Every task implicitly includes these:

- **Verification:** from `app/`, the touched suites + `pnpm -r typecheck` must pass before a task is done:
  - `pnpm --filter @channelers/brain test` (Task 1)
  - `pnpm --filter @channelers/stage test` (Tasks 2–5)
  - `pnpm -r typecheck` (any task touching types/TSX)
- **Do NOT touch `state.completed`** in the brain or `/board`. It stays as-is.
- **Imports:** types/predicate from `@channelers/shared` (`VisitorProfile`, `DispatchReady`, `isAltarReady`); reuse `lib/speech`, `lib/devices`, `components/DevicePicker`.
- **Exact broadcast template** (verbatim, single utterance, one space between tokens):
  `INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... <USER|USERS> <numbers>, YOU HAVE COMPLETED THE STATIONING PROCESS`
- **Docs:** after it works, update `docs/CHANGELOG.md` (newest on top) and the `/console` + `/dispatch` lines in `app/CLAUDE.md`.

---

## File structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `app/packages/shared/src/schemas.ts` | **Modify** | Add `isAltarReady(v)` predicate. |
| `app/packages/shared/src/protocol.ts` | **Modify** | Add `DispatchReady` type + `DispatchState.altarReadyList`. |
| `app/apps/brain/src/dispatcher.ts` | **Modify** | Compute `altarReadyEntries()`; add to snapshot; refactor `flowHealth` count to use `isAltarReady`. |
| `app/apps/brain/test/dispatcher.test.ts` | **Modify** | Extend the altar-ready test to assert `altarReadyList`. |
| `app/apps/stage/src/lib/pluribus.ts` | **Create** | Pure: `altarReadyNumbers` / `readyNumbers` selectors + `formatNumberList` + `buildPluribusBroadcast`. |
| `app/apps/stage/src/lib/pluribus.test.ts` | **Create** | Vitest unit tests for the pure logic. |
| `app/apps/stage/src/components/PluribusBroadcast.tsx` | **Create** | Shared control: button + output picker; calls `speak()`. Props `{ numbers, storageKey }`. |
| `app/apps/stage/src/routes/Console.tsx` | **Modify** | Render `<PluribusBroadcast>` with `altarReadyNumbers(visitors)`. |
| `app/apps/stage/src/routes/Dispatch.tsx` | **Modify** | Broadcast strip after FlowStrip; right column → altar-ready roster. |
| `docs/CHANGELOG.md`, `app/CLAUDE.md` | **Modify** | Doc updates. |

---

## Tasks

### Task 1 — Shared predicate + brain altar-ready list, TDD

**Files:**
- Modify `app/packages/shared/src/schemas.ts`, `app/packages/shared/src/protocol.ts`
- Modify `app/apps/brain/src/dispatcher.ts`, `app/apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Produces: `isAltarReady(v: VisitorProfile): boolean`; `type DispatchReady = { id: string; number: number; name?: string }`; `DispatchState.altarReadyList: DispatchReady[]`.

**Steps:**

- [ ] **Red:** extend the existing `flow-health snapshot fields` test in `app/apps/brain/test/dispatcher.test.ts`. After the existing `expect(s.altarReady).toBe(1);` line (the block that registers `v`, calls `upsertSurvey`/`setPoseTemplate`/`setLocation`), add:
  ```ts
  expect(s.altarReadyList.map((r) => r.number)).toContain(v.number);
  expect(s.altarReadyList.find((r) => r.number === v.number)?.name).toBe("Jo");
  ```
- [ ] Run it, expect FAIL (`altarReadyList` missing): `pnpm --filter @channelers/brain test dispatcher`
- [ ] Add the predicate to `app/packages/shared/src/schemas.ts`, immediately after `export type VisitorProfile = z.infer<typeof VisitorProfile>;` (line 94):
  ```ts
  /**
   * "Altar-ready": cleared the pre-altar stations (intake + bodyscan) and waiting in the pool,
   * not yet through divination. The dispatcher's altar-ready count + list and the Pluribus
   * "completed the stationing process" broadcast all key off this single predicate.
   */
  export function isAltarReady(v: VisitorProfile): boolean {
    return v.location.state === "waiting" && !!v.intakeAt && !!v.poseAt && !v.sessionEndAt;
  }
  ```
- [ ] Add the type + field to `app/packages/shared/src/protocol.ts`. After the `DispatchDone` type (line 114):
  ```ts
  /** An altar-ready visitor (intake + bodyscan done, waiting) — divination prerequisites met. */
  export type DispatchReady = { id: string; number: number; name?: string };
  ```
  …and in the `DispatchState` type, immediately after `altarReady: number;` (line 134):
  ```ts
    /** Altar-ready visitors — the /dispatch right-column roster + the Pluribus broadcast list. */
    altarReadyList: DispatchReady[];
  ```
- [ ] In `app/apps/brain/src/dispatcher.ts`, add `isAltarReady` and `DispatchReady` to the existing `@channelers/shared` import. Then add an entries builder next to `completedEntries()` (after line 417):
  ```ts
  function altarReadyEntries(): DispatchReady[] {
    return store.list()
      .filter(isAltarReady)
      .map((v) => ({ id: v.id, number: v.number, name: v.survey?.name }))
      .sort((a, b) => a.number - b.number);
  }
  ```
- [ ] In `flowHealth()`, replace the inline altar-ready filter (dispatcher.ts:424-426) with the shared predicate:
  ```ts
  const altarReady = list.filter(isAltarReady).length;
  ```
- [ ] In `snapshot()`, add the list right after `completed: completedEntries(),` (line 456):
  ```ts
  altarReadyList: altarReadyEntries(),
  ```
- [ ] Run it, expect PASS: `pnpm --filter @channelers/brain test dispatcher`
- [ ] Typecheck, expect PASS: `pnpm -r typecheck`
- [ ] Commit: `git add app/packages/shared/src/schemas.ts app/packages/shared/src/protocol.ts app/apps/brain/src/dispatcher.ts app/apps/brain/test/dispatcher.test.ts && git commit -m "feat(dispatch): expose altar-ready list + shared isAltarReady predicate"`

### Task 2 — Pure `pluribus.ts` (selectors + template), TDD

**Files:**
- Create `app/apps/stage/src/lib/pluribus.ts`
- Create (test) `app/apps/stage/src/lib/pluribus.test.ts`

**Interfaces:**
- Consumes: `VisitorProfile`, `DispatchReady`, `isAltarReady` from `@channelers/shared` (Task 1).
- Produces:
  - `altarReadyNumbers(visitors: VisitorProfile[]): number[]`
  - `readyNumbers(ready: DispatchReady[]): number[]`
  - `formatNumberList(numbers: number[]): string`
  - `buildPluribusBroadcast(numbers: number[]): string`

**Steps:**

- [ ] Write the failing test `app/apps/stage/src/lib/pluribus.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import type { DispatchReady, VisitorProfile } from "@channelers/shared";
  import {
    altarReadyNumbers,
    buildPluribusBroadcast,
    formatNumberList,
    readyNumbers,
  } from "./pluribus";

  // Minimal VisitorProfile; cast past the optional fields we don't exercise.
  const v = (
    number: number,
    o: { state?: "waiting" | "called" | "in_progress"; intakeAt?: string; poseAt?: string; sessionEndAt?: string } = {},
  ): VisitorProfile =>
    ({
      id: `v${number}`,
      number,
      location: { state: o.state ?? "waiting" },
      createdAt: "t",
      intakeAt: o.intakeAt,
      poseAt: o.poseAt,
      sessionEndAt: o.sessionEndAt,
    }) as VisitorProfile;

  describe("altarReadyNumbers", () => {
    it("returns ascending numbers of waiting visitors with intake + pose and no session end", () => {
      const ready = (n: number) => v(n, { intakeAt: "t", poseAt: "t" });
      expect(
        altarReadyNumbers([
          ready(7),
          ready(3),
          v(5, { intakeAt: "t" }), // no pose → excluded
          v(9, { intakeAt: "t", poseAt: "t", sessionEndAt: "t" }), // done → excluded
          v(11, { intakeAt: "t", poseAt: "t", state: "in_progress" }), // not waiting → excluded
        ]),
      ).toEqual([3, 7]);
    });
  });

  describe("readyNumbers", () => {
    it("maps and sorts the dispatcher's altar-ready entries ascending", () => {
      const list: DispatchReady[] = [
        { id: "a", number: 7 },
        { id: "b", number: 3 },
      ];
      expect(readyNumbers(list)).toEqual([3, 7]);
    });
  });

  describe("formatNumberList", () => {
    it("formats one, two, and three-plus naturally", () => {
      expect(formatNumberList([3])).toBe("3");
      expect(formatNumberList([3, 7])).toBe("3 and 7");
      expect(formatNumberList([3, 7, 12])).toBe("3, 7, and 12");
    });
  });

  describe("buildPluribusBroadcast", () => {
    it("uses USER (singular) for one and the exact template", () => {
      expect(buildPluribusBroadcast([3])).toBe(
        "INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... USER 3, YOU HAVE COMPLETED THE STATIONING PROCESS",
      );
    });
    it("uses USERS (plural) and an Oxford-comma join for many", () => {
      expect(buildPluribusBroadcast([3, 7, 12])).toBe(
        "INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... USERS 3, 7, and 12, YOU HAVE COMPLETED THE STATIONING PROCESS",
      );
    });
  });
  ```
- [ ] Run it, expect FAIL (module missing): `pnpm --filter @channelers/stage test pluribus`
- [ ] Create `app/apps/stage/src/lib/pluribus.ts`:
  ```ts
  import { isAltarReady, type DispatchReady, type VisitorProfile } from "@channelers/shared";

  /** Numbers of altar-ready visitors (completed the pre-altar stations, waiting), ascending. */
  export function altarReadyNumbers(visitors: VisitorProfile[]): number[] {
    return visitors
      .filter(isAltarReady)
      .map((v) => v.number)
      .sort((a, b) => a - b);
  }

  /** Same set, from the dispatcher's already-filtered altar-ready list (DispatchState.altarReadyList). */
  export function readyNumbers(ready: DispatchReady[]): number[] {
    return ready.map((r) => r.number).sort((a, b) => a - b);
  }

  /** Join numbers for natural speech: [3]→"3", [3,7]→"3 and 7", [3,7,12]→"3, 7, and 12". */
  export function formatNumberList(numbers: number[]): string {
    if (numbers.length <= 1) return numbers.join("");
    if (numbers.length === 2) return `${numbers[0]} and ${numbers[1]}`;
    return `${numbers.slice(0, -1).join(", ")}, and ${numbers[numbers.length - 1]}`;
  }

  /** The Pluribus broadcast line for the given visitor numbers (caller ensures non-empty). */
  export function buildPluribusBroadcast(numbers: number[]): string {
    const word = numbers.length === 1 ? "USER" : "USERS";
    return `INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... ${word} ${formatNumberList(numbers)}, YOU HAVE COMPLETED THE STATIONING PROCESS`;
  }
  ```
- [ ] Run it, expect PASS: `pnpm --filter @channelers/stage test pluribus`
- [ ] Commit: `git add app/apps/stage/src/lib/pluribus.ts app/apps/stage/src/lib/pluribus.test.ts && git commit -m "feat(broadcast): pluribus text + altar-ready selectors"`

### Task 3 — Shared `PluribusBroadcast` component

**Files:**
- Create `app/apps/stage/src/components/PluribusBroadcast.tsx`

**Interfaces:**
- Consumes: `buildPluribusBroadcast` (Task 2); `speak`/`stopSpeaking` from `../lib/speech`; `useDevices` from `../lib/devices`; `DevicePicker`.
- Produces: `PluribusBroadcast` with props `{ numbers: number[]; storageKey: string }`.

**Steps:**

- [ ] Create `app/apps/stage/src/components/PluribusBroadcast.tsx`:
  ```tsx
  import { useEffect } from "react";
  import { speak, stopSpeaking } from "../lib/speech";
  import { useDevices } from "../lib/devices";
  import { DevicePicker } from "./DevicePicker";
  import { buildPluribusBroadcast } from "../lib/pluribus";

  /**
   * Overseer control shared by /console and /dispatch: voices the Pluribus
   * "completed the stationing process" line for the given (altar-ready) visitor
   * numbers, routed to a chosen output. Disabled when the set is empty.
   * `storageKey` namespaces the per-tab output choice per screen.
   */
  export function PluribusBroadcast({
    numbers,
    storageKey,
  }: {
    numbers: number[];
    storageKey: string;
  }) {
    const out = useDevices("audiooutput", storageKey, "out");
    useEffect(() => () => stopSpeaking(), []);
    function go() {
      if (numbers.length === 0) return;
      void speak(buildPluribusBroadcast(numbers), { sinkId: out.deviceId });
    }
    return (
      <div className="row">
        <button className="choice" disabled={numbers.length === 0} onClick={go}>
          ▶ PLURIBUS BROADCAST{numbers.length ? ` (${numbers.length})` : ""}
        </button>
        <span className="dim">
          {numbers.length ? `users ${numbers.join(", ")}` : "no altar-ready users yet"}
        </span>
        <DevicePicker
          kind="audiooutput"
          label="out"
          devices={out.devices}
          value={out.deviceId}
          onChange={out.setDeviceId}
          needsPermission={out.needsPermission}
          onEnableLabels={out.enableLabels}
        />
      </div>
    );
  }
  ```
- [ ] Typecheck, expect PASS: `pnpm -r typecheck`
- [ ] Commit: `git add app/apps/stage/src/components/PluribusBroadcast.tsx && git commit -m "feat(broadcast): shared PluribusBroadcast control (button + output picker)"`

### Task 4 — Wire into `/console`

**Files:**
- Modify `app/apps/stage/src/routes/Console.tsx`

**Interfaces:** Consumes `altarReadyNumbers` (Task 2); `PluribusBroadcast` (Task 3).

**Steps:**

- [ ] Add imports after the existing `../lib/useBrainSocket` import:
  ```ts
  import { altarReadyNumbers } from "../lib/pluribus";
  import { PluribusBroadcast } from "../components/PluribusBroadcast";
  ```
- [ ] In `Console()`, after the `counts` block (`Console.tsx:70`):
  ```ts
  const ready = altarReadyNumbers(visitors);
  ```
- [ ] Render the control immediately after the Flow `dispatch` block and before the `{/* ── Panel 1 ── */}` comment (`Console.tsx:101`):
  ```tsx
  <h3>Broadcast</h3>
  <PluribusBroadcast numbers={ready} storageKey="out.console" />
  ```
- [ ] Typecheck + full stage suite, expect PASS: `pnpm -r typecheck && pnpm --filter @channelers/stage test`
- [ ] Manual smoke: `pnpm dev`, open `http://localhost:5173/console`. With ≥1 visitor altar-ready (waiting + intake + pose, no session end — use Manual override / unlock to arrange), the button enables, names the right numbers, and voices the line on click (default voice; picked output, or browser-TTS fallback with no API key). With none, it's disabled.
- [ ] Commit: `git add app/apps/stage/src/routes/Console.tsx && git commit -m "feat(console): PLURIBUS BROADCAST button voices altar-ready visitors"`

### Task 5 — Wire into `/dispatch` (broadcast + altar-ready right column)

**Files:**
- Modify `app/apps/stage/src/routes/Dispatch.tsx`

**Interfaces:** Consumes `readyNumbers` (Task 2); `PluribusBroadcast` (Task 3); `state.altarReadyList: DispatchReady[]` (Task 1).

**Steps:**

- [ ] Add imports after the existing `../lib/dispatchTiming` import:
  ```ts
  import { readyNumbers } from "../lib/pluribus";
  import { PluribusBroadcast } from "../components/PluribusBroadcast";
  ```
- [ ] Render the broadcast strip immediately after the `<FlowStrip ... />` element (`Dispatch.tsx:97`), before `<div className="zones">`:
  ```tsx
  <PluribusBroadcast numbers={readyNumbers(state.altarReadyList)} storageKey="out.dispatch" />
  ```
- [ ] Replace the entire RIGHT zone `<section>` (`Dispatch.tsx:173-184`, the `{/* RIGHT — completed */}` block) with the altar-ready roster:
  ```tsx
  {/* RIGHT — altar-ready */}
  <section className="zone ready">
    <h3>Altar-ready ({state.altarReadyList.length})</h3>
    <ul className="pool-list">
      {state.altarReadyList.map((v) => (
        <li key={v.id} className="pool-item" title={v.name || "(no name)"}>
          <strong>#{v.number}</strong>
          <span className="dim">ready</span>
        </li>
      ))}
    </ul>
  </section>
  ```
- [ ] Update the route's header comment (`Dispatch.tsx:44`) from `waiting pool · slots · completed` to `waiting pool · slots · altar-ready`.
- [ ] Typecheck + full stage suite, expect PASS: `pnpm -r typecheck && pnpm --filter @channelers/stage test`
- [ ] Manual smoke: `pnpm dev`, open `http://localhost:5173/dispatch`. Confirm the right column now lists **altar-ready** people (matches the "altar-ready N" stat), the broadcast strip sits cleanly under the FlowStrip, the **no-scroll 3-zone layout still holds**, the button enables/names/voices correctly, and disables when none. *If the strip breaks no-scroll, move `<PluribusBroadcast>` into the `<header>` after the arrivals `<span>` and re-verify.*
- [ ] Commit: `git add app/apps/stage/src/routes/Dispatch.tsx && git commit -m "feat(dispatch): altar-ready right column + PLURIBUS BROADCAST strip"`

### Task 6 — Docs

**Files:** Modify `docs/CHANGELOG.md`, `app/CLAUDE.md`

**Steps:**

- [ ] Add a new top entry to `docs/CHANGELOG.md` (what / why / files-areas / docs-touched): `/console` + `/dispatch` gain a Pluribus broadcast that voices **altar-ready** visitors via the existing `speak()`/`/api/tts` pipeline with an output picker; `/dispatch`'s right column now lists altar-ready people; new shared `isAltarReady` + `DispatchState.altarReadyList`, pure `lib/pluribus.ts`, shared `components/PluribusBroadcast.tsx`. Note `state.completed` retained for `/board`.
- [ ] In `app/CLAUDE.md`, update the `/console` line to append `· Pluribus altar-ready broadcast (TTS, output picker)`, and the `/dispatch` line to note its right column shows **altar-ready** visitors + the broadcast control.
- [ ] Commit: `git add docs/CHANGELOG.md app/CLAUDE.md && git commit -m "docs: note pluribus altar-ready broadcast on /console + /dispatch"`
