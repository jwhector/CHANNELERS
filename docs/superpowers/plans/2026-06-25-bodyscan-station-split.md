# Body Scan — split kiosk display from station controls

**Goal:** Turn `/bodyscan` into a controls-free, front-facing display (retro called-number → live camera + skeleton when present) and move the operating controls — a manual **Capture pose** button — onto the performer's `/station/bodyscan` view.

**Approach:** The camera + MediaPipe stay on the `/bodyscan` kiosk; it renders purely from `dispatch.state` (no `CalledGate`, no visitor fetch). The performer's `/station/bodyscan` (an interactive device) taps **Capture pose**, which POSTs to the brain; the brain broadcasts a one-shot `station.cmd` over the existing WS; the kiosk receives it, persists the *current* pose it sees, and the dispatcher's existing pose-milestone logic frees the slot and returns the display to standby.

**Tech stack:** React + TS (Vite), MediaPipe Tasks-Vision (in-browser), Fastify + `ws` (brain), zod (shared protocol). No new deps.

---

## Why / design

### Problem
`/bodyscan` today is a single screen mixing the visitor-facing pose stage with operator controls (Start camera, Record shape, tuning sliders, live bars). The install wants two surfaces:
- **Front-facing display** (a TV with no input in front of the visitor): shows the called number before presence is confirmed, then *only* the camera + skeleton once the performer admits the visitor.
- **Performer station** (`/station/bodyscan`, an interactive device): presence confirm already lives here; it gains the pose-operating control — a manual **Capture pose** button.

### Scope
- **In:** rewrite the `/bodyscan` route as a display-only kiosk; add a Capture button to `/station/bodyscan` for bodyscan in-progress rows; a brain endpoint + `station.cmd` broadcast to carry the capture command cross-device; a one-time camera-setup affordance for the input-less TV.
- **Out (YAGNI):** relaying live pose metrics (framing/motion/hold) back to the station; an auto stillness-hold capture (removed — manual only); re-recording / multi-capture; making other stations cross-device-controllable.

### Decisions (locked with the user)
1. **Two devices, command relayed through the brain.** The camera is physically on the kiosk; the button is on a different device. The honest path is a brain relay. We reuse the house idiom — **REST command in → WS broadcast out** (exactly how `arrive`/`repool`/`complete` already work) — rather than adding a client→server WS message. New endpoint `POST /api/bodyscan/capture`; new server message `station.cmd`.
2. **Capture button only on the station — no metric relay.** The performer judges framing/stillness by watching the visitor and the front display (which shows the live skeleton). Keeps the kiosk→station direction empty.
3. **Manual capture only.** The stillness-hold auto-capture and its tuning are removed. The pose is saved *only* when the performer taps Capture. The kiosk continuously tracks the latest pose it sees and persists that on command.
4. **Front display = number → camera + skeleton + minimal framing hint.** Reuse `SegmentNumber` (DSEG7) for the retro number, matching Intake's look. When present: full-bleed camera + skeleton, the existing "step back, whole body in frame" nudge, and a brief ✓ flash on capture.
5. **Kiosk renders from `dispatch.state` alone.** No `CalledGate`, no `useReleaseToGate`, no `getByNumber` fetch. `slot.occupant` drives everything: `number` for the readout, `visitorId` for matching the capture command, `phase` for which view. After a pose is enrolled the dispatcher already frees the slot (`completionMilestoneSet`), so standby returns on its own.
6. **Input-less TV camera setup.** The DevicePicker cannot live on the front display. The camera auto-starts with the saved/default device (`useDevices("videoinput","cam.bodyscan")`); opening `/bodyscan?setup=1` (once, from a keyboard/mouse during install) reveals the picker to choose + persist the camera. Normal runtime shows no controls.

### Decision log
- *Why not co-locate camera + controls on one machine?* The user's front display is an input-less TV; controls must be on a separate interactive device → cross-device relay is required regardless.
- *Why REST→broadcast, not a new `WsClientMsg`?* `WsClientMsg` is the divination/tuning/hello command surface; dispatch-style operator commands already go over REST and come back as WS state/events. `station.cmd` matches the existing one-shot server messages (`session.transcript`, `oracle.delta`, …).
- *Why match on `visitorId` in the command?* Multiple bodyscan kiosks can be online; the broadcast reaches all, and only the kiosk whose `occupant.visitorId` matches acts. Defensive and future-proof at no cost.
- *Why drop auto-capture?* User chose manual-only. It also collapses the kiosk state machine (no ready/record/hold phases, no tuners), a net simplification.
- *Camera cold-start per visitor:* the camera view mounts on `in_progress` and tears down when the slot frees, so the MediaPipe model reloads (~1–2 s) per visitor. Acceptable for the workshop MVP; noted, not optimized.

---

## Global constraints
- **Repo:** monorepo at `app/` (pnpm). Run from `app/`.
- **Verification (run before claiming done):**
  - `pnpm -r typecheck`
  - `pnpm --filter @channelers/stage test`
  - `pnpm --filter @channelers/brain test`
- **Conventions:** all TypeScript; CV in-browser (no Python); screen-only command stays *off* the OSC contract (it is a `WsServerMsg`, not a `ShowEvent`). Match surrounding code style (terse comments explaining *why*).
- **Docs:** after the change, add a newest-on-top entry to `docs/CHANGELOG.md` (what / why / files-areas / docs-touched). Update `app/CLAUDE.md`'s `/bodyscan` + `/station` route descriptions (their behavior changes). No ARCHITECTURE.md change (no architectural deviation — reuses the existing bus idiom).

---

## File structure
- `packages/shared/src/protocol.ts` *(modify)* — add `station.cmd` to the `WsServerMsg` union.
- `apps/brain/src/app.ts` *(modify)* — add `POST /api/bodyscan/capture` → `bus.broadcast` a `station.cmd`.
- `apps/brain/test/endpoints.test.ts` *(modify)* — validation + (integration) broadcast assertion for the new endpoint.
- `apps/stage/src/lib/api.ts` *(modify)* — add `api.captureBodyscan(visitorId)`.
- `apps/stage/src/routes/Station.tsx` *(modify)* — thread an `onCapture` action; render **Capture pose** on bodyscan in-progress rows.
- `apps/stage/src/routes/Station.test.tsx` *(modify)* — Capture-button presence + callback.
- `apps/stage/src/routes/BodyScan.tsx` *(rewrite)* — display-only kiosk: `BodyScan` (presence + view routing), `BodyScanStandby` (retro number), `BodyScanCamera` (camera + skeleton + capture listener), `BodyScanSaved` (✓ flash).
- `apps/stage/src/routes/BodyScan.test.tsx` *(new)* — view-selection + standby/called/saved rendering; capture-command match guard.
- `apps/stage/src/styles/bodyscan.css` *(new)* — full-bleed display layout, standby/called framing, framing-hint position, saved flash.

### Key interfaces (locked here, referenced by tasks)
```ts
// packages/shared/src/protocol.ts — added to WsServerMsg union:
| { kind: "station.cmd"; station: Station; action: "capture"; visitorId: string }

// apps/stage/src/lib/api.ts:
captureBodyscan: (visitorId: string) => Promise<{ ok: boolean }>   // POST /api/bodyscan/capture { visitorId }

// apps/stage/src/routes/Station.tsx — StationOpsView gains:
onCapture?: (visitorId: string) => void   // provided only when station === "bodyscan"
```

---

## Tasks

### Task 1 — `station.cmd` server message + capture endpoint (brain + shared)
**Files:** modify `packages/shared/src/protocol.ts`, `apps/brain/src/app.ts`; modify `apps/brain/test/endpoints.test.ts`.

**Interfaces:**
- Consumes: `Bus.broadcast(msg: WsServerMsg)` (existing), `Station` zod schema (existing).
- Produces: `WsServerMsg` variant `{ kind: "station.cmd"; station: Station; action: "capture"; visitorId: string }`; route `POST /api/bodyscan/capture`.

**Steps:**
- [ ] Add the failing test to `apps/brain/test/endpoints.test.ts` — validation + broadcast over a real socket:
  ```ts
  import WebSocket from "ws";
  // ...inside the existing describe, or a new one:
  test("POST /api/bodyscan/capture rejects a missing visitorId", async () => {
    const app = await buildApp({ serveStage: false });
    const res = await app.inject({ method: "POST", url: "/api/bodyscan/capture", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test("POST /api/bodyscan/capture broadcasts a station.cmd to connected screens", async () => {
    const app = await buildApp({ serveStage: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as import("node:net").AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const got = new Promise<any>((resolve) => {
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.kind === "station.cmd") resolve(m);
      });
    });
    await new Promise((r) => ws.on("open", r));
    const res = await app.inject({ method: "POST", url: "/api/bodyscan/capture", payload: { visitorId: "v42" } });
    expect(res.statusCode).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await got).toEqual({ kind: "station.cmd", station: "bodyscan", action: "capture", visitorId: "v42" });
    ws.close();
    await app.close();
  });
  ```
- [ ] Run it, expect FAIL: `pnpm --filter @channelers/brain test endpoints` (route 404 / type missing).
- [ ] Add the message variant to `packages/shared/src/protocol.ts` `WsServerMsg`:
  ```ts
    | { kind: "station.cmd"; station: Station; action: "capture"; visitorId: string }
  ```
  (`Station` is already imported in this file.)
- [ ] Add the route in `apps/brain/src/app.ts` (near the dispatcher routes, ~after `/api/dispatch/altar`), reusing the existing `VisitorIdBody` zod schema:
  ```ts
  // Cross-device capture relay: the /station performer taps Capture; the bodyscan
  // kiosk (which holds the camera) hears this and persists the pose it sees.
  app.post("/api/bodyscan/capture", async (req, reply) => {
    const parsed = VisitorIdBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad request" });
    bus.broadcast({ kind: "station.cmd", station: "bodyscan", action: "capture", visitorId: parsed.data.visitorId });
    return { ok: true };
  });
  ```
  (Confirm `VisitorIdBody` is defined in `app.ts`; it backs `/api/dispatch/arrive` etc. If it is module-local, reuse it as-is.)
- [ ] Run it, expect PASS: `pnpm --filter @channelers/brain test endpoints`.
- [ ] `pnpm -r typecheck` (shared type change ripples to stage/brain — expect clean).
- [ ] Commit: `git add -A && git commit -m "feat(bodyscan): station.cmd capture relay endpoint"`.

### Task 2 — `api.captureBodyscan` (stage client)
**Files:** modify `apps/stage/src/lib/api.ts`. (No standalone api test file exists; this is exercised via Task 3's UI test calling through. Keep the signature exact.)

**Interfaces:**
- Consumes: the `post<T>(url, body)` helper (existing in `api.ts`).
- Produces: `api.captureBodyscan(visitorId: string): Promise<{ ok: boolean }>`.

**Steps:**
- [ ] Add to the `api` object in `apps/stage/src/lib/api.ts`:
  ```ts
  /** Bodyscan kiosk capture (cross-device): tell the brain to relay a capture to the kiosk. */
  captureBodyscan: (visitorId: string) => post<{ ok: boolean }>("/api/bodyscan/capture", { visitorId }),
  ```
- [ ] `pnpm -r typecheck` — expect clean.
- [ ] Commit: `git add -A && git commit -m "feat(stage): api.captureBodyscan"`.

### Task 3 — Capture button on `/station/bodyscan`
**Files:** modify `apps/stage/src/routes/Station.tsx`; modify `apps/stage/src/routes/Station.test.tsx`.

**Interfaces:**
- Consumes: `api.captureBodyscan` (Task 2); existing `StationOpsView` props.
- Produces: `StationOpsView` prop `onCapture?: (visitorId: string) => void`, rendered as a **Capture pose** button on in-progress rows.

**Steps:**
- [ ] Add the failing tests to `apps/stage/src/routes/Station.test.tsx`:
  ```ts
  test("bodyscan in-progress row shows Capture pose and fires onCapture", () => {
    const onCapture = vi.fn();
    const slot: Slot = {
      id: "bodyscan-0", station: "bodyscan", online: true,
      occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
    };
    render(
      <StationOpsView
        station="bodyscan" connected called={[]} inProgress={[slot]}
        busyId={null} onArrive={() => {}} onRelease={() => {}} onCapture={onCapture} />,
    );
    screen.getByRole("button", { name: /capture pose/i }).click();
    expect(onCapture).toHaveBeenCalledWith("v9");
  });

  test("no Capture button when onCapture is not provided", () => {
    const slot: Slot = {
      id: "bodyscan-0", station: "bodyscan", online: true,
      occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
    };
    render(
      <StationOpsView
        station="bodyscan" connected called={[]} inProgress={[slot]}
        busyId={null} onArrive={() => {}} onRelease={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /capture pose/i })).toBeNull();
  });
  ```
- [ ] Run it, expect FAIL: `pnpm --filter @channelers/stage test Station`.
- [ ] In `Station.tsx`, add `onCapture?: (visitorId: string) => void;` to the `StationOpsView` prop type, and in the **In progress** row render a Capture button (before the timed `dwellMs` block) when `onCapture` is set:
  ```tsx
  {onCapture && (
    <button className="submit" disabled={busyId === o.visitorId}
      onClick={() => onCapture(o.visitorId)}>
      Capture pose
    </button>
  )}
  ```
- [ ] Wire it in `StationContainer` — pass `onCapture` only for bodyscan:
  ```tsx
  onCapture={station === "bodyscan" ? (id) => void run(id, () => api.captureBodyscan(id)) : undefined}
  ```
  and add `onCapture?: (visitorId: string) => void;` to `StationOpsView`'s destructured params.
- [ ] Run it, expect PASS: `pnpm --filter @channelers/stage test Station`.
- [ ] `pnpm -r typecheck` — expect clean.
- [ ] Commit: `git add -A && git commit -m "feat(station): Capture pose button on /station/bodyscan"`.

### Task 4 — Rewrite `/bodyscan` as a display-only kiosk
**Files:** rewrite `apps/stage/src/routes/BodyScan.tsx`; new `apps/stage/src/routes/BodyScan.test.tsx`; new `apps/stage/src/styles/bodyscan.css`.

**Interfaces:**
- Consumes: `useStationPresence("bodyscan")` → `{ connected, slot }`; `slot.occupant` (`number`, `visitorId`, `phase`); `usePoseLandmarker`, `bodyCoverage`, `isBodyFramed`, `landmarksToAngles`, `drawSkeleton` (existing); `useBrainSocket` (listen for `station.cmd`); `api.enrollPose` (existing); `useDevices`, `DevicePicker` (setup mode only); `SegmentNumber`.
- Produces: the new `/bodyscan` route (no exported API others depend on).

**Design of the rewritten file:**
- `BodyScan()` — `const { connected, slot } = useStationPresence("bodyscan")`; `const occ = slot?.occupant`. Local `savedNumber: number | null` state for the post-capture flash.
  - If `savedNumber != null` → `<BodyScanSaved number={savedNumber} />` (a `useEffect` setTimeout clears it after 3000ms; clean up the timer).
  - else if `occ?.phase === "in_progress"` → `<BodyScanCamera visitorId={occ.visitorId} number={occ.number} onSaved={(n) => setSavedNumber(n)} />`.
  - else → `<BodyScanStandby occ={occ} connected={connected} />`.
- `BodyScanStandby({ occ, connected })` — full-screen `.void`. If `occ` and `occ.phase !== "pending"` → `<SegmentNumber value={occ.number} glitch />` under a small `NOW SERVING` eyebrow + `PROCEED TO BODY SCAN` sub. Else → dim standby `<SegmentNumber value={0} className="seg-dim" />` + `AWAITING DESIGNATION`. A small connection LED (reuse `.led`/`.led.on`).
- `BodyScanCamera({ visitorId, number, onSaved })`:
  - `const cam = useDevices("videoinput", "cam.bodyscan", "cam")`.
  - Refs: `canvasRef`, `lastVecRef: PoseVector | null`, `framedRef`. State: `framed` (for the hint), `saving`.
  - `onFrame(lms, _t)` — size canvas to video, `drawSkeleton`; if `!lms` → `lastVecRef=null`, set framed via `isBodyFramed(0, framedRef)`; else `vec = landmarksToAngles(lms)`, `lastVecRef.current = vec`, update framed via `isBodyFramed(bodyCoverage(vec), framedRef.current)`. (No stillness/hold logic — manual capture only.)
  - `const { videoRef, status, start } = usePoseLandmarker(onFrame, cam.deviceId)`.
  - `useEffect(() => { if (status === "idle") void start(); }, [status, start])` — auto-start the camera on mount (no Start button on the kiosk).
  - `useBrainSocket((m) => { if (m.kind === "station.cmd" && m.action === "capture" && m.visitorId === visitorId) void capture(); })`.
  - `capture()` — guard `saving`; if `lastVecRef.current` is null, ignore; else `setSaving(true)`; `await api.enrollPose(visitorId, vec)`; `onSaved(number)`. (On success the dispatcher frees the slot → this view unmounts; `onSaved` drives the parent's flash so the visitor still sees confirmation.)
  - Render: `.bodyscan-cam` full-bleed `<video>` + `<canvas>`; framing hint (`.framehint`) when `status==="running" && !framed`; `?setup=1` → render the `DevicePicker` in a corner overlay (`new URLSearchParams(location.search).get("setup")`).
- `BodyScanSaved({ number })` — `.void` centered `<SegmentNumber value={number} />` + `✓ SAVED` + `PROCEED TO THE WAITING ROOM`.
- Imports: `import "../styles/crt.css"` (for `.seg` + DSEG7) and `import "../styles/bodyscan.css"`.

**Steps:**
- [ ] Write `apps/stage/src/styles/bodyscan.css` first (no test; layout shell the component renders into):
  ```css
  /* Front-facing bodyscan display: full-bleed, controls-free. */
  .bodyscan-cam { position: fixed; inset: 0; background: #000; }
  .bodyscan-cam video, .bodyscan-cam canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  /* No mirroring — keep video and skeleton in the same coordinate space, matching current behavior. */
  .bodyscan-setup { position: fixed; right: 1rem; bottom: 1rem; z-index: 10; }
  .bodyscan-standby { display: grid; place-content: center; gap: 1.5rem; min-height: 100vh; text-align: center; }
  .bodyscan-saved { display: grid; place-content: center; gap: 1rem; min-height: 100vh; text-align: center; }
  .bodyscan-eyebrow { letter-spacing: 0.4em; opacity: 0.7; font-family: ui-monospace, monospace; }
  ```
  (Reuse existing `.framehint`, `.poseflash`, `.led` from `styles.css`/`crt.css`; do not redefine.)
- [ ] Add the failing tests to a new `apps/stage/src/routes/BodyScan.test.tsx`. Mock the presence + socket + pose hooks so the camera path is inert and the view-selection is what's asserted:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import { expect, test, vi } from "vitest";

  const presence = { current: { connected: true, slot: undefined as any } };
  vi.mock("../lib/useStationPresence", () => ({ useStationPresence: () => presence.current }));
  vi.mock("../lib/useBrainSocket", () => ({ useBrainSocket: () => ({ connected: true, send: () => {} }) }));
  vi.mock("../lib/pose/usePoseLandmarker", () => ({
    usePoseLandmarker: () => ({ videoRef: { current: null }, status: "running", error: null, start: vi.fn() }),
  }));
  vi.mock("../lib/devices", () => ({ useDevices: () => ({ devices: [], deviceId: undefined, setDeviceId: () => {}, needsPermission: false, enableLabels: () => {} }) }));

  import { BodyScan } from "./BodyScan";
  const slot = (occ?: any) => ({ id: "bodyscan-0", station: "bodyscan", online: true, occupant: occ });

  test("dim standby when no occupant", () => {
    presence.current = { connected: true, slot: slot(undefined) };
    render(<BodyScan />);
    expect(screen.getByText(/awaiting designation/i)).toBeInTheDocument();
  });

  test("shows the called number before presence is confirmed", () => {
    presence.current = { connected: true, slot: slot({ visitorId: "v7", number: 7, phase: "called", since: "" }) };
    render(<BodyScan />);
    expect(screen.getByLabelText("7")).toBeInTheDocument();   // SegmentNumber aria-label
    expect(screen.getByText(/now serving/i)).toBeInTheDocument();
  });

  test("renders the camera surface once in progress (no controls)", () => {
    presence.current = { connected: true, slot: slot({ visitorId: "v7", number: 7, phase: "in_progress", since: "" }) };
    const { container } = render(<BodyScan />);
    expect(container.querySelector(".bodyscan-cam")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /record|start camera/i })).toBeNull();
  });
  ```
- [ ] Run it, expect FAIL: `pnpm --filter @channelers/stage test BodyScan` (old `BodyScan` still renders header/controls).
- [ ] Rewrite `apps/stage/src/routes/BodyScan.tsx` per the design above (remove `Enroll`, `Tuner`, the phase machine, `CalledGate`, `useReleaseToGate`, `Bar`/`posebars`, tuning sliders).
- [ ] Run it, expect PASS: `pnpm --filter @channelers/stage test BodyScan`.
- [ ] Run the whole stage suite (the old BodyScan tests, if any, are gone; `CalledGate.test.tsx` for intake still passes): `pnpm --filter @channelers/stage test`.
- [ ] `pnpm -r typecheck` — expect clean (no remaining imports of removed symbols).
- [ ] Manual smoke (note in commit, not a gate): `pnpm dev`, open `/bodyscan?kiosk=bodyscan-0` (number shows), admit from `/station/bodyscan`, confirm camera+skeleton appear, tap **Capture pose**, confirm ✓ flash then standby.
- [ ] Commit: `git add -A && git commit -m "feat(bodyscan): display-only kiosk (called number → camera+skeleton); manual capture from /station"`.

### Task 5 — Docs
**Files:** modify `docs/CHANGELOG.md`, `app/CLAUDE.md`.

**Steps:**
- [ ] Add a newest-on-top `docs/CHANGELOG.md` entry: what (bodyscan split into display-only kiosk + station-driven manual capture), why (input-less front TV; performer-operated capture), files/areas (BodyScan, Station, protocol `station.cmd`, `/api/bodyscan/capture`, bodyscan.css), docs-touched.
- [ ] Update `app/CLAUDE.md`: `/bodyscan` is now display-only (called number → camera+skeleton, no controls; capture is performer-driven); `/station` (`/station/bodyscan`) gains a **Capture pose** action.
- [ ] Commit: `git add -A && git commit -m "docs: record bodyscan kiosk/station split"`.

---

## Self-review notes
- **Coverage:** every file in the structure has a task; shared type → brain route → stage api → station UI → kiosk display → docs, in dependency order.
- **Interface consistency:** `station.cmd` shape is identical in the shared union, the brain broadcast, and the kiosk matcher; `captureBodyscan` signature matches the endpoint body (`{ visitorId }`) and the station wiring.
- **No placeholders:** all test and impl snippets are concrete. Facts verified against the tree: `VisitorIdBody` is a `const` defined at `app.ts:182` inside `buildApp` (the new route goes *after* it — placing near `/api/dispatch/altar` satisfies this); `ws` is a brain dependency (the test's `import WebSocket from "ws"` resolves); `SegmentNumber` renders `aria-label={String(value)}` (so `getByLabelText("7")` works).
- **Scope:** no auto-capture, no metric relay, no ARCHITECTURE.md change — all consistent with the locked decisions.
