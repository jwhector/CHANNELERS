# Stream F — Bodyscan experience (#11 repeat-to-confirm · #13 aura skeleton)

**Goal:** Make the bodyscan a deliberate ritual — the visitor enrolls a pose, *breaks it, and repeats it to affirm it* — rendered as a fully-stylized aura with no webcam visible.

**Approach:** Add an `enroll → confirm` state machine inside `BodyScanCamera` that reuses the altar's existing pose-match loop (`poseSimilarity` ≥ 0.9) against the just-captured pose, gated behind a forced "break" of the pose. Swap the bodyscan's skeleton draw for a new additive-glow `drawAura` that paints an opaque background (removing the webcam) and renders colorblob landmarks. No server/brain changes — the existing `api.enrollPose` call simply moves to *after* the confirm hold.

**Tech stack:** Vite/React + TypeScript (`apps/stage`), MediaPipe Tasks pose landmarks (existing), Canvas 2D, Vitest + Testing Library.

---

## Why / design

### Problem
Two rehearsal notes against the bodyscan ([rehearsal-punchlist.md](../../rehearsal-punchlist.md) Stream F):
- **#11 (P2)** — the visitor enrolls a pose in one 3.5s hold and is done; nothing makes them *commit it to memory*. We want a repeat-to-affirm beat that is both ritual (they internalize their "sign") and a reproducibility check (proves the altar can match it later).
- **#13 (P3, pulled into scope)** — the display currently shows the live webcam with a thin off-white skeleton over it. We want it 100% stylized: webcam removed, an aura/colorblob skeleton.

### Scope
- **In:** #11 (enroll→confirm with a forced break), #13 (aura render + webcam removed). Bodyscan front display only.
- **Out:** #12 (model swap) — stays deferred. The altar's verify camera keeps the plain `drawSkeleton` (it is an operator diagnostic, not audience-facing). No brain/protocol/server changes.

### Approaches considered
1. **Reuse the altar verify loop against the just-captured pose, forced-break gated** *(chosen).* The altar already does exactly the hard part — continuous `poseSimilarity` hold-to-threshold ([Altar.tsx:57-79](../../../app/apps/stage/src/routes/Altar.tsx#L57)). The confirm phase is that loop pointed at pose A instead of a server template, with a "must leave the pose first" gate so the repeat is a deliberate act. Smallest, most consistent, no new matching code.
2. **Capture two poses and average them.** More robust template, but muddies the "this exact shape is your sign" semantics and adds averaging code. Rejected (YAGNI).
3. **Operator re-arms the second capture.** Keeps a human gate on the repeat but doubles operator taps per visitor and adds station UI. Rejected — auto-advance keeps the operator's interaction identical (one Capture tap).

For #13: paint an **opaque background on the canvas** each frame rather than `display:none` on the `<video>`, because MediaPipe reads its frames from that video element — hiding it via `display:none` risks starving the model. The canvas already sits above the video; an opaque fill (plus `opacity:0` on the video as belt-and-suspenders) removes the webcam with zero risk to detection.

### Decision log
- **Confirm = altar loop vs pose A.** `MATCH_THRESH=0.9`, `CONFIRM_SEC=1.5`, reuse `STILLNESS=0.05` — mirror the altar verbatim.
- **Forced break (`BREAK_THRESH=0.7`).** After pose A is captured, the confirm hold will not start until similarity drops below 0.7 (they physically leave the pose). Then they re-form it and hold. This makes the repeat deliberate (user's explicit requirement).
- **Save pose A** (the first, deliberate capture). The repeat *proves A is reproducible*; it is not itself saved.
- **Auto-advance** enroll→confirm — one operator Capture tap, unchanged. A second tap mid-flow aborts back to disarmed-enroll and clears pose A.
- **No hard block.** If the visitor can't reproduce, they keep trying; the altar's `Unlock (override)` remains the safety net. The server contract is unchanged — `api.enrollPose` still stamps `poseAt` and frees the slot, it just fires later.
- **Aura is bodyscan-only.** `drawSkeleton` stays for the altar camera. Aura is static-per-frame (driven by the pose), no animation, for the first cut.

---

## Global constraints

Apply to every task:
- **Verify:** `pnpm --filter @channelers/stage typecheck` and `pnpm --filter @channelers/stage test` must be clean before each commit (full `pnpm -r typecheck` before the final commit).
- **Run from** `/Users/jared/Documents/Projects/CHANNELERS/app`.
- **Copy register:** lowercase, terminal/DMV aesthetic (match existing `bodyscan-eyebrow` strings like `proceed to the waiting room`). No title-case.
- **No brain/protocol/server edits.** `apps/brain`, `packages/shared` untouched.
- **MediaPipe video must keep playing** — never `display:none` the bodyscan `<video>`.
- Workshop MVP scope; one working path over breadth.
- Commit per task with a `feat(bodyscan):` / `feat(stage):` style message consistent with recent history.

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| [app/apps/stage/src/routes/BodyScan.tsx](../../../app/apps/stage/src/routes/BodyScan.tsx) | Modify | `BodyScanCamera`: add `enroll → confirm` state machine with forced break; swap `drawSkeleton`→`drawAura`; two-step confirm prompt. |
| [app/apps/stage/src/components/poseUI.tsx](../../../app/apps/stage/src/components/poseUI.tsx) | Modify | Add `drawAura` (opaque bg + additive glowing bones + colorblob landmarks). Keep `drawSkeleton` for the altar. |
| [app/apps/stage/src/styles/bodyscan.css](../../../app/apps/stage/src/styles/bodyscan.css) | Modify | `.bodyscan-cam video { opacity: 0 }` so the webcam never flashes pre-first-frame. |
| [app/apps/stage/src/routes/BodyScan.test.tsx](../../../app/apps/stage/src/routes/BodyScan.test.tsx) | Modify | Replace the single-hold happy path with enroll→break→reform→save; add confirm-gates-save, forced-break, and non-matching-repeat tests. |
| app/apps/stage/src/components/poseUI.test.tsx | Create | `drawAura` recording-ctx test: opaque bg painted (webcam hidden) + blob per landmark + null/no-canvas no-ops. |
| [docs/CHANGELOG.md](../../CHANGELOG.md) · [docs/rehearsal-punchlist.md](../../rehearsal-punchlist.md) · [app/CLAUDE.md](../../../app/CLAUDE.md) | Modify | Changelog entry; punchlist status + session log; bodyscan route description update. |

---

## Task 1 — #11: enroll → confirm with forced break

**Files:** modify `app/apps/stage/src/routes/BodyScan.tsx`, `app/apps/stage/src/routes/BodyScan.test.tsx`.

**Interfaces**
- Consumes: `poseSimilarity(p, q): number`, `landmarksToAngles(lms): PoseVector`, `motionMetric`, `bodyCoverage`, `isBodyFramed` from [angles.ts](../../../app/apps/stage/src/lib/pose/angles.ts); `api.enrollPose(visitorId, vec)`.
- Produces: no new exports. New module constants `CONFIRM_SEC`, `MATCH_THRESH`, `BREAK_THRESH` (local to BodyScan.tsx).

### Steps

- [ ] **Add the test helper + precondition.** In `BodyScan.test.tsx`, extend the imports and add a "clearly different shape" helper after the existing `landmarks` helper (all key joints collinear → straight angles, so similarity vs the grid pose is far below 0.7):

```tsx
// add poseSimilarity + landmarksToAngles to the existing pose import line:
import { landmarksToAngles, poseSimilarity } from "../lib/pose/angles";

// A clearly different shape: every landmark on one vertical line, so the joint
// angles collapse to straight/zero and poseSimilarity vs landmarks() is < 0.7.
// Used to "break" the enrolled pose and to test a non-matching repeat.
const lineLandmarks = (visibility: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.05 + i * 0.025, z: 0, visibility }));
```

- [ ] **Replace the happy-path test** (current "armed + framed + held still past the hold window persists the pose", lines ~79-89) with the full enroll→break→reform→save sequence:

```tsx
test("repeat-to-confirm: enroll, break the pose, re-form it, then persist", async () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  const b = lineLandmarks(1);
  act(() => onFrame!(a, 0));                 // establish framing + prev vector
  act(() => onMessage!(captureCmd("v7")));   // operator arms enroll
  act(() => onFrame!(a, 100));               // enroll hold starts
  act(() => onFrame!(a, 3700));              // > RECORD_SEC → capture pose A, enter confirm
  expect(api.enrollPose).not.toHaveBeenCalled(); // NOT saved yet
  act(() => onFrame!(b, 3800));              // similarity < BREAK_THRESH → pose broken
  act(() => onFrame!(a, 3900));              // re-forming: motion high (prev=b) → not still yet
  act(() => onFrame!(a, 4000));              // motion settles → confirm hold starts
  await act(async () => { onFrame!(a, 5600); }); // > CONFIRM_SEC → persist
  expect(api.enrollPose).toHaveBeenCalledTimes(1);
  expect(api.enrollPose).toHaveBeenCalledWith(
    "v7",
    expect.objectContaining({ angles: expect.any(Array), weights: expect.any(Array) }),
  );
});
```

- [ ] **Add three more tests** (confirm gates the save + the prompt; the forced break; a non-matching repeat):

```tsx
test("the first hold captures but does not persist — it prompts for the repeat", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  act(() => onFrame!(a, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(a, 100));
  act(() => onFrame!(a, 3700)); // enroll completes → confirm
  expect(api.enrollPose).not.toHaveBeenCalled();
  expect(screen.getByText(/release, then form it again/i)).toBeInTheDocument();
});

test("holding the pose continuously (never breaking) never confirms", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  act(() => onFrame!(a, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(a, 100));
  act(() => onFrame!(a, 3700));  // → confirm; similarity to A stays 1, never < BREAK_THRESH
  act(() => onFrame!(a, 5000));
  act(() => onFrame!(a, 8000));
  expect(api.enrollPose).not.toHaveBeenCalled();
});

test("a non-matching repeat does not persist", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  const b = lineLandmarks(1);
  expect(poseSimilarity(landmarksToAngles(a), landmarksToAngles(b))).toBeLessThan(0.7); // precondition
  act(() => onFrame!(a, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(a, 100));
  act(() => onFrame!(a, 3700));  // → confirm
  act(() => onFrame!(b, 3800));  // breaks (sim < 0.7)
  act(() => onFrame!(b, 3900));  // motion settles, but sim(A,B) < MATCH_THRESH
  act(() => onFrame!(b, 6000));  // held well past CONFIRM_SEC → still must not save
  expect(api.enrollPose).not.toHaveBeenCalled();
});
```

- [ ] **Run the tests — expect FAIL** (new flow not implemented; `release, then form it again` not rendered; first hold still saves):

```bash
pnpm --filter @channelers/stage test BodyScan
# expect: failures in the 4 tests above
```

- [ ] **Add constants + import** in `BodyScan.tsx`. Extend the pose import (line 4) with `poseSimilarity`, and add the constants beside `RECORD_SEC`/`STILLNESS` (lines 93-94):

```tsx
import { bodyCoverage, isBodyFramed, landmarksToAngles, motionMetric, poseSimilarity, type PoseVector } from "../lib/pose/angles";

const RECORD_SEC = 3.5;    // hold-still to capture the pose
const STILLNESS = 0.05;    // max per-frame motion (radians) that still counts as "held"
const CONFIRM_SEC = 1.5;   // hold to confirm the repeat (mirrors the altar verify hold)
const MATCH_THRESH = 0.9;  // similarity the repeat must reach (altar's value)
const BREAK_THRESH = 0.7;  // they must leave pose A (similarity drops below this) before the repeat is armed
```

- [ ] **Add confirm-phase refs + state** inside `BodyScanCamera`, beside the existing refs (after `armedRef`/`savingRef`, lines ~115-120):

```tsx
const phaseRef = useRef<"enroll" | "confirm">("enroll");
const enrolledRef = useRef<PoseVector | null>(null);
const brokenRef = useRef(false);
const [phase, setPhase] = useState<"enroll" | "confirm">("enroll");
const [broken, setBroken] = useState(false);
```

- [ ] **Reset the new state on (dis)arm.** Replace `toggleArmed` (lines ~129-136) so a tap always returns to a clean enroll:

```tsx
const toggleArmed = useCallback(() => {
  const v = !armedRef.current;
  armedRef.current = v;
  setArmed(v);
  holdStartRef.current = null;
  setHoldProgress(0);
  phaseRef.current = "enroll"; setPhase("enroll");
  enrolledRef.current = null;
  brokenRef.current = false; setBroken(false);
  if (v) savingRef.current = false;
}, []);
```

- [ ] **Swap the armed branch of `onFrame`** (currently lines ~170-176, from `if (!armedRef.current) return;` to the end) for the two-phase machine. Leave the draw call and the null-`lms`/`vec`/`motion`/`framedNow` lines above it unchanged:

```tsx
    if (!armedRef.current) return;

    if (phaseRef.current === "enroll") {
      const still = motion < STILLNESS && framedNow;
      if (!still) { holdStartRef.current = null; setHoldProgress(0); return; }
      if (holdStartRef.current == null) holdStartRef.current = tMs;
      const prog = Math.min(1, (tMs - holdStartRef.current) / (RECORD_SEC * 1000));
      setHoldProgress(prog);
      if (prog >= 1) {
        holdStartRef.current = null;
        enrolledRef.current = vec;                 // remember pose A (saved only after confirm)
        phaseRef.current = "confirm"; setPhase("confirm");
        brokenRef.current = false; setBroken(false);
        setHoldProgress(0);
      }
      return;
    }

    // confirm: they must break pose A, then re-form and hold it (altar-style match loop).
    const template = enrolledRef.current;
    if (!template) return;
    const sim = poseSimilarity(template, vec);
    if (!brokenRef.current) {
      if (sim < BREAK_THRESH) { brokenRef.current = true; setBroken(true); }
      holdStartRef.current = null; setHoldProgress(0);
      return;
    }
    const qualifies = framedNow && motion < STILLNESS && sim >= MATCH_THRESH;
    if (!qualifies) { holdStartRef.current = null; setHoldProgress(0); return; }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    const prog = Math.min(1, (tMs - holdStartRef.current) / (CONFIRM_SEC * 1000));
    setHoldProgress(prog);
    if (prog >= 1) { holdStartRef.current = null; void persist(template); }
```

(`onFrame`'s dependency array stays `[persist]` — constants are module-level, refs are stable.)

- [ ] **Two-step confirm prompt.** Replace the static hold label (lines ~201-208) so the prompt guides break→reform:

```tsx
      {armed && !showFrameHint && (
        <div className="bodyscan-hold">
          <p className="bodyscan-hold-label">
            {phase === "enroll"
              ? "hold your shape"
              : broken
                ? "now hold the same shape"
                : "release, then form it again"}
          </p>
          <div className="bodyscan-hold-track">
            <div className="bodyscan-hold-fill" style={{ width: `${Math.round(holdProgress * 100)}%` }} />
          </div>
        </div>
      )}
```

- [ ] **Run the tests — expect PASS:**

```bash
pnpm --filter @channelers/stage test BodyScan
# expect: all BodyScan tests green (the 4 new/updated + the untouched standby/camera/arming tests)
```

- [ ] **Typecheck + commit:**

```bash
pnpm --filter @channelers/stage typecheck   # expect: clean
git add -A && git commit -m "feat(bodyscan): repeat-to-confirm pose enrollment with forced break (#11)"
```

---

## Task 2 — #13: aura / colorblob skeleton, webcam removed

**Files:** modify `app/apps/stage/src/components/poseUI.tsx`, create `app/apps/stage/src/components/poseUI.test.tsx`, modify `app/apps/stage/src/routes/BodyScan.tsx` (one line), modify `app/apps/stage/src/styles/bodyscan.css`.

**Interfaces**
- Consumes: `CONNECTIONS`, `type Landmark` from [landmarks.ts](../../../app/apps/stage/src/lib/pose/landmarks.ts) (already imported in poseUI.tsx).
- Produces: `drawAura(canvas: HTMLCanvasElement | null, lms: Landmark[] | null): void`.

### Steps

- [ ] **Write the failing render test.** Create `app/apps/stage/src/components/poseUI.test.tsx` with a recording fake ctx — assert the two invariants that matter (opaque full-canvas bg = webcam hidden; a blob per visible landmark) plus null/no-canvas safety:

```tsx
import { expect, test, vi } from "vitest";
import { drawAura } from "./poseUI";
import type { Landmark } from "../lib/pose/landmarks";

function fakeCanvas() {
  const grad = { addColorStop: vi.fn() };
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, shadowBlur: 0, shadowColor: "", globalCompositeOperation: "",
    fillRect: vi.fn(), clearRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
    createRadialGradient: vi.fn(() => grad),
  };
  const canvas = { width: 200, height: 120, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

const landmarks = (v: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + (i % 7) * 0.1, y: 0.1 + Math.floor(i / 7) * 0.08, z: 0, visibility: v }));

test("paints an opaque full-canvas background (hides the webcam)", () => {
  const { canvas, ctx } = fakeCanvas();
  drawAura(canvas, landmarks(1));
  expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 120);
});

test("draws a glowing colorblob per visible landmark", () => {
  const { canvas, ctx } = fakeCanvas();
  drawAura(canvas, landmarks(1));
  expect(ctx.createRadialGradient).toHaveBeenCalled();
  expect(ctx.arc).toHaveBeenCalled();
});

test("with no pose, still hides the webcam but draws no blobs", () => {
  const { canvas, ctx } = fakeCanvas();
  drawAura(canvas, null);
  expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 120);
  expect(ctx.createRadialGradient).not.toHaveBeenCalled();
});

test("no-ops without a canvas", () => {
  expect(() => drawAura(null, landmarks(1))).not.toThrow();
});
```

- [ ] **Run it — expect FAIL** (`drawAura` does not exist):

```bash
pnpm --filter @channelers/stage test poseUI
# expect: cannot find export drawAura / failures
```

- [ ] **Implement `drawAura`** in `poseUI.tsx` (append after `drawSkeleton`; keep `drawSkeleton` for the altar):

```tsx
// Visibility a landmark needs before we paint a blob for it.
const AURA_VIS = 0.5;

/**
 * The bodyscan's fully-stylized render: an opaque void background (this is what
 * removes the webcam) with additive glowing bones and a colorblob at each visible
 * landmark. The altar keeps drawSkeleton — that camera is an operator diagnostic.
 */
export function drawAura(canvas: HTMLCanvasElement | null, lms: Landmark[] | null) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, w, h); // opaque background — removes the webcam feed
  if (!lms) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: overlapping glow blooms brighter

  // Glowing bones.
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(120,180,255,0.5)";
  ctx.shadowColor = "rgba(120,180,255,0.9)";
  ctx.shadowBlur = 24;
  for (const [i, j] of CONNECTIONS) {
    const a = lms[i], b = lms[j];
    if (!a || !b || (a.visibility ?? 1) < AURA_VIS || (b.visibility ?? 1) < AURA_VIS) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }

  // Colorblobs at each visible landmark — hue sweeps across the body.
  ctx.shadowBlur = 0;
  const r = Math.max(w, h) * 0.05;
  for (let k = 0; k < lms.length; k++) {
    const p = lms[k];
    if (!p || (p.visibility ?? 1) < AURA_VIS) continue;
    const cx = p.x * w, cy = p.y * h;
    const hue = (k / lms.length) * 300;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `hsla(${hue}, 90%, 70%, 0.9)`);
    g.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
```

- [ ] **Run it — expect PASS:**

```bash
pnpm --filter @channelers/stage test poseUI
# expect: 4 green
```

- [ ] **Point BodyScan at `drawAura`.** In `BodyScan.tsx`, change the import (line 7) and the draw call (line ~159):

```tsx
import { drawAura } from "../components/poseUI";
// ...
    drawAura(canvasRef.current, lms); // was drawSkeleton(...)
```

- [ ] **Hide the webcam element in CSS.** In `bodyscan.css`, after the shared `.bodyscan-cam video, .bodyscan-cam canvas` rule (line ~7), add:

```css
/* The webcam feeds MediaPipe but is never shown — the aura canvas is the whole picture. */
.bodyscan-cam video { opacity: 0; }
```

- [ ] **Run the full stage suite — expect PASS** (BodyScan tests still green; jsdom's null 2D context makes `drawAura` a no-op there, exactly as `drawSkeleton` was):

```bash
pnpm --filter @channelers/stage test
# expect: all green
```

- [ ] **Typecheck + commit:**

```bash
pnpm --filter @channelers/stage typecheck   # expect: clean
git add -A && git commit -m "feat(bodyscan): aura/colorblob skeleton, webcam removed (#13)"
```

---

## Task 3 — docs, reconciliation, and live verify

**Files:** modify `docs/CHANGELOG.md`, `docs/rehearsal-punchlist.md`, `app/CLAUDE.md`.

### Steps

- [ ] **CHANGELOG entry** (newest on top) — what / why / files-areas / docs-touched, e.g.:

```
## Stream F — bodyscan repeat-to-confirm + aura render (#11, #13)
**What:** /bodyscan now enrolls a pose, requires the visitor to break it and repeat it
to affirm it (altar-style match loop vs the just-captured pose, forced-break gated at
sim<0.7, confirm hold 1.5s @ ≥0.9), and renders a fully-stylized aura/colorblob skeleton
with the webcam removed. **Why:** rehearsal notes #11 (commit-your-sign ritual + altar
reproducibility) and #13 (100% stylized). **Files:** apps/stage BodyScan.tsx, poseUI.tsx
(+drawAura, drawSkeleton kept for altar), bodyscan.css, BodyScan.test.tsx, poseUI.test.tsx.
No brain/protocol changes — api.enrollPose just fires after the confirm hold.
**Docs:** rehearsal-punchlist.md, app/CLAUDE.md.
```

- [ ] **Punchlist update** ([rehearsal-punchlist.md](../../rehearsal-punchlist.md)): flip #11 → 🟢 and #13 → 🟢 in the Stream F table (note #13 was pulled from deferred); add a **Session 4** log line; update the **Next up** pointer. #12 stays 🗓.

- [ ] **Reconcile route docs.** Update the `/bodyscan` bullet in [app/CLAUDE.md](../../../app/CLAUDE.md) to mention the repeat-to-confirm step and the aura render (capture is still operator-armed; the kiosk now runs enroll→break→confirm and shows the stylized aura, not the webcam). `ARCHITECTURE.md` needs no change (no architectural shift — same data model, same `enrollPose` contract); confirm this explicitly in the commit message.

- [ ] **Final full typecheck + commit:**

```bash
pnpm -r typecheck   # expect: clean across the monorepo
git add -A && git commit -m "docs(stream-f): changelog, punchlist, bodyscan route notes (#11, #13)"
```

- [ ] **Live verify on a device** (can't unit-test "looks good" or the real camera path). With `pnpm dev` running, open `/bodyscan`, admit a visitor from `/station/bodyscan`, tap **Capture**, and confirm:
  - The display shows **no webcam** — only the aura/colorblob skeleton on a dark field.
  - After the first 3.5s hold the prompt reads **"release, then form it again"**; it does **not** save.
  - Breaking the pose flips the prompt to **"now hold the same shape"**; re-forming + holding ~1.5s saves and shows **"✓ saved"**.
  - The freed slot / waiting-room handoff behaves exactly as before.

---

## Out of scope (record for later)
- **#12** pose-model swap — deferred. If picked up: `usePoseLandmarker.ts` model/WASM URLs + `landmarksToAngles` if the representation changes.
- Aura animation (breathing/pulse), per-archetype palettes, and applying the aura to the altar camera — all deferred; the altar intentionally keeps the diagnostic `drawSkeleton`.
