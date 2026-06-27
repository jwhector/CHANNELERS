# Stream E — Channeling consolidation (`/perform` one-device view)

**Goal:** Put `/channel` + `/choreo` + `/altar` on one device behind a tabbed shell that reuses the existing, tested components, and default the altar to override (no camera).

**Approach:** Add a new `/perform` route whose presentational `PerformShell` mounts the existing `Altar`, `Channel`, and `Choreo` components simultaneously (inactive tabs stay mounted but `hidden`, so sockets/sessions/choreo-audio never drop) and a segmented switch foregrounds one. The altar tab renders `<Altar showCamera={false}>` (camera dropped this iteration). Standalone `/altar` keeps the camera as an opt-in fallback while making override the primary action (#21). `/channel` and `/choreo` are reused unchanged.

**Tech stack:** TypeScript, React 18 + react-router-dom, Vite, Vitest + @testing-library/react. Stage app at `app/apps/stage`.

---

## Why / design

### The three rehearsal items (Stream E)
- **#19** — Centralize `/channel` + `/choreo` + `/altar` onto one device. **(this plan's core)**
- **#20** — Add altar bodyscan override to `/console` (mirror `/altar`'s override). **Already implemented:** Console's per-visitor "unlock" button at `Console.tsx:119` already calls `api.verifyPose(v.id)` — the exact call the altar's "Manual unlock (override)" makes (`Altar.tsx:46`). Resolution: clarify the label only.
- **#21** — Disable bodyscan confirmation at the altar, default to override. Folds into the altar refactor: override becomes the primary action; the camera pose-match becomes an opt-in fallback (and is absent entirely in the consolidated view).

### Decisions (from the design discussion)
- **Build style:** tabbed shell **reusing** the existing components — not a rewrite. Rationale: "simplicity and lack of bugs is paramount" — reuse tested code; consolidation = one URL/device. (User-selected over a split-console rewrite and a full single-flow rewrite.)
- **Camera:** dropped from the consolidated altar tab ("won't be used this iteration"). Standalone `/altar` keeps it as an opt-in fallback per #21 ("override primary, camera kept as fallback").
- **Standalone routes stay:** `/altar`, `/channel`, `/choreo` remain registered and functional — no regression for any device still pointed at them. `/perform` is additive.
- **All-tabs-mounted, not unmount-on-switch:** inactive tabs use the HTML `hidden` attribute (`display:none`). This keeps each component's WebSocket, claimed session, and audio alive across tab switches, and lets choreo ear-audio keep playing while the performer is on another tab. (`display:none` does not pause `<audio>`/`<video>` or tear down `getUserMedia`.)
- **No shared socket / no shared state:** each child keeps its own `useBrainSocket`. The brain already serves many concurrent sockets (board, console, dispatch, …); three from one device is fine and avoids refactoring the children. Message kinds don't overlap (oracle.* vs choreo.* vs dispatch.*), so there's no cross-talk.
- **Default tab:** `altar` — it is step 1 of the visitor's journey on this device (unlock → pick oracle → then switch to Channel to channel them).

### Decision log
- *Why not a shared socket?* Less code, less risk; children are already correct in isolation. The cost is N sockets per device, which the brain already supports.
- *Why keep all tabs mounted?* `Channel` owns a live divination session with recovery/liveness semantics; unmount/remount churn risks dropping or re-claiming sessions. Mounting-once side-steps that entirely. It also keeps choreo audio continuous.
- *Why export `Gate` from `Altar.tsx`?* To unit-test the #21 override-primary / `showCamera` branching directly, mirroring the existing `ChoreoDisplay` (presentational) + `Choreo` (container) split.
- *Why a `PerformShell` presentational split?* The container mounts heavy socket-backed children; the shell's tab logic is the only new behavior worth testing, so it's extracted to test with sentinel children (same pattern as `ChoreoDisplay`).

### Out of scope
- Merging the audio output pickers into one panel (each child keeps its own `out.channel` / `out.choreo` picker). 
- Filtering choreo by active session (today `Choreo` shows all `choreo.*`; unchanged — acceptable while the altar is one-at-a-time, per the existing note in `Choreo.tsx`).
- Any camera/pose work beyond making it opt-in.
- Removing the standalone routes or the timed `waitingroom`/`/feed` work (other streams).

---

## Global constraints

- **Verify before "done":** from `app/`, run `pnpm -r typecheck` (must be clean) and `pnpm --filter @channelers/stage test` (touched suites green).
- **No new deps.** Reuse `react-router-dom`, the existing `useDevices`/`usePlaybackRate`/`useBrainSocket`/`speak` libs, and existing CSS tokens (`.choice`, `.choice.on`, `.submit`, `.toggle`, `.void`).
- **Reuse, don't fork:** `Channel` and `Choreo` are imported and rendered unchanged. Do not duplicate their internals.
- **Inactive tabs hidden, not unmounted:** use the `hidden` attribute on wrapper elements; never conditionally render (`{active && <Channel/>}`) the children, which would unmount them.
- **Copy:** the altar primary button reads **`Unlock (override)`**; the camera opt-in toggle reads **`verify by camera`** / **`hide camera`**; the console button reads **`unlock (override)`**.
- **Path conventions:** stage routes in `app/apps/stage/src/routes/`, tests co-located as `*.test.tsx`, CSS in `app/apps/stage/src/styles.css`.

---

## File structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `app/apps/stage/src/routes/Altar.tsx` | Modify | Export `Gate`; add `showCamera` prop (default `true`); make override the primary action; put the camera pose-match behind an opt-in toggle (rendered only when `showCamera`). |
| `app/apps/stage/src/routes/Altar.test.tsx` | Create | Unit-test `Gate`: override button always present + calls `api.verifyPose`; `showCamera={false}` hides all camera UI; default shows the `verify by camera` toggle collapsed. Pose/device/api modules mocked. |
| `app/apps/stage/src/routes/Perform.tsx` | Create | `PerformShell` (presentational tab shell) + `Perform` (container mounting `<Altar showCamera={false}>`, `<Channel/>`, `<Choreo/>`). |
| `app/apps/stage/src/routes/Perform.test.tsx` | Create | Unit-test `PerformShell`: all three regions present; default `altar` visible + others `hidden`; clicking a tab swaps which region is `hidden`. |
| `app/apps/stage/src/App.tsx` | Modify | Register `<Route path="/perform">`; add `"perform"` to the `SCREENS` list (Home links). |
| `app/apps/stage/src/styles.css` | Modify | `.perform-tabs` segmented control styling (reuse `.choice` look). |
| `app/apps/stage/src/routes/Console.tsx` | Modify | #20 clarity: relabel the visitor-row override button `unlock` → `unlock (override)`. |
| `docs/CHANGELOG.md` | Modify | New top entry. |
| `docs/rehearsal-punchlist.md` | Modify | Flip #19/#20/#21 status; session-log + next-up. |
| `app/CLAUDE.md` | Modify | Add `/perform` to the route map. |
| `docs/ARCHITECTURE.md` | Modify (if route map present) | Reconcile route list with `/perform`. |

---

## Tasks

### Task 1 — Altar: default-to-override + opt-in camera (#21, + camera-drop foundation)

**Files:**
- Modify: `app/apps/stage/src/routes/Altar.tsx`
- Create: `app/apps/stage/src/routes/Altar.test.tsx`

**Interfaces:**
- **Consumes:** existing `api.verifyPose(id)`, `api.setPersona(id, archetype)`, `usePoseLandmarker`, `useDevices`, `ARCHETYPES`, `VisitorProfile`.
- **Produces:**
  - `export function Gate({ visitor, connected, showCamera }: { visitor: VisitorProfile; connected: boolean; showCamera?: boolean })` — `showCamera` defaults to `true`.
  - `export function Altar({ showCamera }: { showCamera?: boolean } = {})` — threads `showCamera` into `Gate`; defaults `true`.

**Steps:**

- [ ] Write the failing test `app/apps/stage/src/routes/Altar.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { expect, test, vi, beforeEach } from "vitest";

  const verifyPose = vi.fn(() => Promise.resolve());
  vi.mock("../lib/api", () => ({ api: { verifyPose: (id: string) => verifyPose(id), setPersona: vi.fn(() => Promise.resolve()) } }));
  vi.mock("../lib/pose/usePoseLandmarker", () => ({
    usePoseLandmarker: () => ({ videoRef: { current: null }, status: "idle", error: null, start: vi.fn() }),
  }));
  vi.mock("../lib/devices", () => ({
    useDevices: () => ({ deviceId: "", devices: [], setDeviceId: vi.fn(), needsPermission: false, enableLabels: vi.fn() }),
  }));

  import { Gate } from "./Altar";
  import type { VisitorProfile } from "@channelers/shared";

  const visitor = { id: "v1", number: 7, location: { state: "in_progress" }, survey: { name: "Ada" } } as unknown as VisitorProfile;

  beforeEach(() => verifyPose.mockClear());

  test("override is the primary action and calls verifyPose", async () => {
    render(<Gate visitor={visitor} connected showCamera={false} />);
    await userEvent.click(screen.getByRole("button", { name: /unlock \(override\)/i }));
    expect(verifyPose).toHaveBeenCalledWith("v1");
  });

  test("showCamera=false hides all camera UI", () => {
    render(<Gate visitor={visitor} connected showCamera={false} />);
    expect(screen.queryByRole("button", { name: /verify by camera/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /start camera/i })).toBeNull();
  });

  test("default offers an opt-in camera toggle, collapsed", () => {
    render(<Gate visitor={visitor} connected />);
    expect(screen.getByRole("button", { name: /verify by camera/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start camera/i })).toBeNull(); // collapsed until toggled
  });
  ```
- [ ] Run it, expect FAIL (Gate not exported / no `showCamera` / old layout):
  ```
  pnpm --filter @channelers/stage test -- Altar
  ```
- [ ] Implement in `app/apps/stage/src/routes/Altar.tsx`:
  - Change the wrapper signature and thread the prop:
    ```tsx
    export function Altar({ showCamera = true }: { showCamera?: boolean } = {}) {
      const { connected, slot } = useStationPresence("altar");
      const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
      useReleaseToGate(visitor, slot, false, () => setVisitor(null));
      if (!visitor) return <CalledGate station="altar" title="Altar" connected={connected} slot={slot} confirmedBy="performer" onArrived={setVisitor} />;
      return <Gate visitor={visitor} connected={connected} showCamera={showCamera} />;
    }
    ```
  - `export function Gate(...)` with `showCamera = true` in its props.
  - Add a local `const [camOpen, setCamOpen] = useState(false);` in `Gate`.
  - Rewrite the step-1 block (`<h3>1 · Validate your shape</h3>` … through the camera `controls`) so that, when `!verified`:
    1. The **primary** button is `<button className="submit" onClick={() => void markVerified()}>Unlock (override)</button>` (rendered first/always).
    2. The camera affordance renders only `when showCamera`:
       ```tsx
       {showCamera && (
         <>
           <button className="choice" onClick={() => setCamOpen((o) => !o)}>
             {camOpen ? "hide camera" : "verify by camera"}
           </button>
           {camOpen && (
             /* existing posestage <video>/<canvas>, Start/loading button, similarity+hold bars, DevicePicker */
           )}
         </>
       )}
       ```
    - Keep the existing pose-hold auto-verify (`onFrame` → `markVerified()` at `prog >= 1`) intact; it only runs once the camera is started, which now requires opening the toggle.
    - When `!showCamera`, do **not** render the `<video>`/`<canvas>` posestage (camera hooks stay called per React rules but `start()` is never invoked, so the camera stays inert and no permission is requested).
  - Leave the `2 · Choose the oracle` archetype section and the `ready`/`ORACLE READY` flash unchanged.
- [ ] Run it, expect PASS:
  ```
  pnpm --filter @channelers/stage test -- Altar
  ```
- [ ] Typecheck and commit:
  ```
  pnpm -r typecheck
  git add -A && git commit -m "feat(altar): default to override, camera as opt-in fallback (#21)"
  ```

### Task 2 — `/perform` consolidated route (#19)

**Files:**
- Create: `app/apps/stage/src/routes/Perform.tsx`
- Create: `app/apps/stage/src/routes/Perform.test.tsx`
- Modify: `app/apps/stage/src/App.tsx`
- Modify: `app/apps/stage/src/styles.css`

**Interfaces:**
- **Consumes:** `Altar` (with `showCamera`), `Channel`, `Choreo` (default imports/named exports as in `App.tsx`).
- **Produces:**
  - `export function PerformShell({ altar, channel, choreo }: { altar: ReactNode; channel: ReactNode; choreo: ReactNode })` — segmented tabs (`altar` | `channel` | `choreo`), default active `altar`; renders all three regions, non-active ones `hidden`.
  - `export function Perform()` — `<PerformShell altar={<Altar showCamera={false} />} channel={<Channel />} choreo={<Choreo />} />`.

**Steps:**

- [ ] Write the failing test `app/apps/stage/src/routes/Perform.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { expect, test } from "vitest";
  import { PerformShell } from "./Perform";

  const shell = () => (
    <PerformShell
      altar={<div data-testid="altar-region">ALTAR</div>}
      channel={<div data-testid="channel-region">CHANNEL</div>}
      choreo={<div data-testid="choreo-region">CHOREO</div>}
    />
  );
  const wrap = (id: string) => screen.getByTestId(id).closest("[data-tabpanel]") as HTMLElement;

  test("mounts all three regions", () => {
    render(shell());
    expect(screen.getByTestId("altar-region")).toBeInTheDocument();
    expect(screen.getByTestId("channel-region")).toBeInTheDocument();
    expect(screen.getByTestId("choreo-region")).toBeInTheDocument();
  });

  test("defaults to the altar tab visible, others hidden", () => {
    render(shell());
    expect(wrap("altar-region").hidden).toBe(false);
    expect(wrap("channel-region").hidden).toBe(true);
    expect(wrap("choreo-region").hidden).toBe(true);
  });

  test("clicking a tab foregrounds its region", async () => {
    render(shell());
    await userEvent.click(screen.getByRole("button", { name: /^channel$/i }));
    expect(wrap("altar-region").hidden).toBe(true);
    expect(wrap("channel-region").hidden).toBe(false);
    expect(wrap("choreo-region").hidden).toBe(true);
  });
  ```
- [ ] Run it, expect FAIL (no `Perform.tsx`):
  ```
  pnpm --filter @channelers/stage test -- Perform
  ```
- [ ] Implement `app/apps/stage/src/routes/Perform.tsx`:
  ```tsx
  import { useState, type ReactNode } from "react";
  import { Altar } from "./Altar";
  import { Channel } from "./Channel";
  import { Choreo } from "./Choreo";

  type Tab = "altar" | "channel" | "choreo";
  const TABS: Tab[] = ["altar", "channel", "choreo"];

  /** One-device performer shell: altar (entry) · channel (oracle) · choreo (cues).
   *  All three stay mounted; inactive ones are `hidden` so sessions, sockets, and
   *  choreo ear-audio never drop on tab switch. */
  export function PerformShell({ altar, channel, choreo }: { altar: ReactNode; channel: ReactNode; choreo: ReactNode }) {
    const [tab, setTab] = useState<Tab>("altar");
    const region: Record<Tab, ReactNode> = { altar, channel, choreo };
    return (
      <div className="perform">
        <nav className="perform-tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "choice on" : "choice"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {TABS.map((t) => (
          <div key={t} data-tabpanel={t} hidden={t !== tab}>
            {region[t]}
          </div>
        ))}
      </div>
    );
  }

  export function Perform() {
    return <PerformShell altar={<Altar showCamera={false} />} channel={<Channel />} choreo={<Choreo />} />;
  }
  ```
- [ ] Run it, expect PASS:
  ```
  pnpm --filter @channelers/stage test -- Perform
  ```
- [ ] Wire the route in `app/apps/stage/src/App.tsx`:
  - Import: `import { Perform } from "./routes/Perform";`
  - Add `"perform"` to the `SCREENS` array.
  - Add `<Route path="/perform" element={<Perform />} />` alongside the others.
- [ ] Add tab styling to `app/apps/stage/src/styles.css`:
  ```css
  .perform-tabs { display: flex; gap: 8px; padding: 12px 20px 0; max-width: 760px; margin: 0 auto; }
  .perform-tabs .choice { text-transform: capitalize; }
  ```
- [ ] Typecheck, run the full stage suite, commit:
  ```
  pnpm -r typecheck
  pnpm --filter @channelers/stage test
  git add -A && git commit -m "feat(perform): consolidate /channel + /choreo + /altar onto one device (#19)"
  ```

### Task 3 — #20 console override label clarity

**Files:**
- Modify: `app/apps/stage/src/routes/Console.tsx`

**Steps:**

- [ ] In `Console.tsx`, change the visitor-row override button label from `unlock` to `unlock (override)` (the behavior — `api.verifyPose(v.id)` — is unchanged; this only makes it recognizable as the altar-override mirror):
  ```tsx
  {!v.poseVerifiedAt && <button className="choice" onClick={() => void api.verifyPose(v.id).then(refresh)}>unlock (override)</button>}
  ```
- [ ] Typecheck and commit:
  ```
  pnpm -r typecheck
  git add -A && git commit -m "chore(console): clarify altar override button label (#20)"
  ```

### Task 4 — Docs & punchlist reconciliation

**Files:**
- Modify: `docs/CHANGELOG.md`, `docs/rehearsal-punchlist.md`, `app/CLAUDE.md`, `docs/ARCHITECTURE.md` (route map only, if present).

**Steps:**

- [ ] `docs/CHANGELOG.md` — new top entry (what / why / files-areas / docs-touched): the `/perform` consolidation (Stream E #19), altar default-to-override + opt-in camera (#21), and console label clarity (#20-confirmed-already-present).
- [ ] `docs/rehearsal-punchlist.md`:
  - #19 → 🟢 (shipped `/perform` tabbed shell, reuse).
  - #20 → 🟢 (already present; label clarified).
  - #21 → 🟢 (override primary; camera opt-in fallback on `/altar`, absent on `/perform`).
  - Add a **Session 3** log line and update **Next up**.
- [ ] `app/CLAUDE.md` — add `/perform` to the route map ("one-device performer console: altar (override+persona) · channel · choreo tabs; reuses the standalone components").
- [ ] `docs/ARCHITECTURE.md` — if it carries a route list (§3), add `/perform`; otherwise no change (record that it was checked).
- [ ] Commit:
  ```
  git add -A && git commit -m "docs: Stream E consolidation — CHANGELOG, punchlist, route maps"
  ```

---

## Verification (end of stream)
- `pnpm -r typecheck` clean.
- `pnpm --filter @channelers/stage test` green (new `Altar`/`Perform` suites + untouched suites).
- Manual smoke (optional, `pnpm dev`): open `/perform`; confirm tabs switch; altar tab shows `Unlock (override)` + no camera; channel tab claims/teleprompts; choreo audio continues while on another tab.
- Handoff checklist (punchlist §"Per-session handoff"): branch landed, CHANGELOG written, route maps reconciled, statuses flipped, memory updated if a durable decision emerged, Next-up pointer moved.
