# Intake CRT redesign — PURGATORY.EXE

**Goal:** Restyle the `/intake` screen as a haunted municipal terminal — an amber segmented-LED "now serving" number on a static-filled CRT, a Windows-9x dialog survey, all dimmed-vaporwave and intermittently weirdcore.

**Approach:** Build three reusable presentational primitives (`CrtShell`, `SegmentNumber`, `useCrtFx`) plus a scoped `crt.css`, then skin every Intake state (standby → called → form → processed) with them. The CRT post-processing (scanlines/curvature/glow/flicker) is a toggleable CSS layer so it looks right on a dev LCD and can be dialed down on the real tube. `CalledGate` is shared by three stations, so the new look is gated behind a `skin` prop — only Intake opts in now.

**Tech stack:** Vite + React 18 + react-router (existing). New: a minimal **vitest + jsdom + @testing-library/react** harness in `apps/stage` (none today). Two self-hosted fonts (DSEG7 Classic, a Win9x pixel sans). No new runtime deps beyond the test harness.

---

## Why / design

### The problem
`/intake` today is the generic dark-mono `.void` form shared by every screen ([Intake.tsx](../../../app/apps/stage/src/routes/Intake.tsx), [CalledGate.tsx](../../../app/apps/stage/src/components/CalledGate.tsx)). The show wants this kiosk to *be* a DMV-purgatory artifact: a CRT that calls your number and makes you confirm you exist before it processes you.

### Organizing idea
**PURGATORY.EXE** — a municipal soul-processing terminal from a 1999 that never ended. Each aesthetic has exactly one job, so the combination reads as a choice, not a pile:

| Aesthetic | Single job |
|---|---|
| Amber segmented LED | the **signature** — the called number |
| Vaporwave | the *ambient void* — **desaturated/sickly**, not candy |
| Windows 9x/XP | the *institutional skin* of the survey dialog |
| Weirdcore | *intermittent corruption* — punctuation, not wallpaper |
| CRT | the *physical vessel* — curvature, scanlines, snow, flicker (toggleable) |

Restraint rule: the amber LED number is the one bold thing; everything else stays quiet.

### Scope
Full Intake flow, all four states: **STANDBY** (slot bound, waiting) · **CALLED** (the headline) · **FORM** (XP-dialog survey) · **PROCESSED** (done). `CalledGate`'s other two consumers (BodyScan, Altar) are untouched.

### Token system (the design contract — copy verbatim into `crt.css`)
Color:
- `--void-a: #1b0e30` → `--void-b: #07313a` — indigo→teal dusk gradient (the desktop)
- `--amber: #ffb000` (lit segment) · `--amber-off: #4a3300` (ghost/unlit) · `--amber-glow: #ff7a00`
- `--cyan: #2ee6d6` — eyebrows / live LED / "NOW SERVING"
- `--magenta: #ff3ca6` — weirdcore + error punctuation (sparing)
- `--win-face: #c9c5bb` · `--win-hi: #ffffff` · `--win-lo: #6f6a60` — XP dialog gray + bevels
- `--crt-ink: #e9e4d8` · `--crt-dim: #8a8475`

Type (3 roles): **DSEG7 Classic** (self-hosted, the LED) · **W95FA** pixel sans (self-hosted, dialog chrome; fallback `Tahoma, Geneva, Verdana, sans-serif`) · existing `ui-monospace` (eyebrows/data/receipt voice).

Signature: the amber segmented-LED call number glitching on CRT snow.

### Copy (in-world, bureaucratic-divination voice)
- STANDBY eyebrow: `▮ STANDBY` · subline `awaiting designation`
- CALLED eyebrow: `NOW SERVING` (cyan) · button `I AM` · subline `confirm to proceed`
- FORM titlebar: `INTAKE.EXE — FORM 7-A` · submit button `SUBMIT` · subject line `SUBJECT NO. <led>`
- PROCESSED: `● PROCESSED` · `proceed to the Physical Challenge when called`
- Errors don't apologize: `SIGNAL LOST — retry` (not "Sorry, something went wrong").

### Approaches considered

**Static/snow** — (a) animated SVG `feTurbulence`, (b) canvas RAF random-pixel, (c) tiled GIF. **Chosen: (a)** — GPU-composited, infinite (no loop seam), scalable, offline, no binary asset; canvas burns kiosk CPU, GIF shows seams.

**Segmented number** — (a) DSEG font + ghost-`8` behind, (b) per-segment SVG elements, (c) pre-rendered images. **Chosen: (a)** — authentic, minimal code; the ghost-`8` trick renders unlit segments for free; glitch via opacity/char-swap/text-shadow.

**XP chrome** — (a) hand-rolled bevel tokens, (b) `98.css`/`xp.css` library. **Chosen: (a)** — we want a *decayed, vaporwave-tinted* XP we control; a library fights our palette and ships a whole stylesheet.

**Test posture** — the stage app has no test runner. This work is ~85% CSS (not unit-testable). **Chosen:** add a minimal vitest harness and TDD only the genuine logic (`useCrtFx`, `SegmentNumber` formatting) + render smoke-tests for state branching; verify all visual states by running the app and screenshotting against acceptance criteria. *(Veto option: skip the harness → screenshot-only verification for everything.)*

### Decision log
- **CRT FX is a toggle** (`useCrtFx`, persisted) — looks right on dev LCD, dial-down on the real tube to avoid doubling its native scanlines. Default ON; `?crt=off` forces off.
- **`CalledGate` gains `skin?: "crt" | "default"`** (default `"default"`) — Intake opts in; BodyScan/Altar unchanged. CRT skin renders shell-less content meant to live inside Intake's `CrtShell`.
- **Procedural snow, not a GIF** — offline-resilience + no seams.
- **Self-host both fonts** — the show machine is a Mac (no Tahoma); fidelity matters for the signature. Graceful fallbacks if a file is missing.
- **4:3 title-safe center (~80%)** — a real tube's overscan must never clip the number or the I AM button.
- **All styles scoped under `.crt`** — cannot leak into `/console`, `/dispatch`, `/board`, which share the global `styles.css`.

---

## Global constraints
- **Verification commands:** `pnpm --filter @channelers/stage typecheck` (must pass), `pnpm --filter @channelers/stage test` (after harness exists), `pnpm --filter @channelers/stage build`. Full sweep: `pnpm -r typecheck`.
- **Dev run:** `pnpm dev` (brain :8787, stage :5173); Intake at `http://localhost:5173/intake`.
- **No new runtime dependencies** beyond devDeps for the test harness. Computer-vision/other routes untouched.
- **Offline-resilient:** fonts self-hosted under `apps/stage/public/fonts/`; missing-font fallbacks defined; no runtime Google Fonts / external CDNs.
- **Accessibility floor:** visible keyboard focus on `I AM` and all form controls; `prefers-reduced-motion` freezes rolls/jitter and dims static; the LED number carries an `aria-label` with the plain number.
- **Isolation:** every new selector lives under the `.crt` root class in `crt.css`. Do not touch `styles.css`.
- **After the work:** update `docs/CHANGELOG.md` (newest on top: what/why/files/docs) and note the `CalledGate` `skin` prop in `app/CLAUDE.md` + `docs/ARCHITECTURE.md` route notes.
- **Commit per task.**

---

## File structure

Created:
- `app/apps/stage/vitest.setup.ts` — jest-dom matchers + cleanup (test harness).
- `app/apps/stage/src/lib/useCrtFx.ts` — CRT-FX toggle hook (persisted).
- `app/apps/stage/src/lib/useCrtFx.test.ts` — its tests.
- `app/apps/stage/src/components/SegmentNumber.tsx` — LED number (ghost + glitch).
- `app/apps/stage/src/components/SegmentNumber.test.tsx` — its tests.
- `app/apps/stage/src/components/CrtShell.tsx` — void + static + FX layers + bezel + toggle.
- `app/apps/stage/src/components/CrtShell.test.tsx` — render smoke test.
- `app/apps/stage/src/styles/crt.css` — all scoped CRT/XP/glitch styles + `@font-face`.
- `app/apps/stage/public/fonts/DSEG7Classic-Bold.woff2` — vendored (OFL).
- `app/apps/stage/public/fonts/W95FA.woff2` — vendored (free).

Modified:
- `app/apps/stage/vite.config.ts` — add `test` block (jsdom, setup file, globals).
- `app/apps/stage/package.json` — `"test": "vitest run"` script + test devDeps.
- `app/apps/stage/src/components/CalledGate.tsx` — add `skin` prop; CRT branch.
- `app/apps/stage/src/components/CalledGate.test.tsx` — branch tests (created).
- `app/apps/stage/src/routes/Intake.tsx` — wrap in `CrtShell`; XP form; Processed screen; pass `skin="crt"`.

Responsibilities: `useCrtFx` = toggle state only. `SegmentNumber` = pure number→LED markup. `CrtShell` = the frame/atmosphere + toggle UI. `crt.css` = every visual rule (scoped). `CalledGate`/`Intake` = compose the above per state.

---

## Tasks

### Task 1 — `useCrtFx` hook + test harness

Folds in the one-time vitest scaffolding (this is the first unit that needs it).

**Files:** create `apps/stage/vitest.setup.ts`, `src/lib/useCrtFx.ts`, `src/lib/useCrtFx.test.ts`; modify `apps/stage/vite.config.ts`, `apps/stage/package.json`.

**Interfaces:**
- Produces: `useCrtFx(): { fx: boolean; toggle: () => void }`. `fx` default `true`; `?crt=off` forces `false` (read-only, toggle still flips local state but query wins on reload); otherwise persisted in `localStorage["channelers.crt"]` (`"on"`/`"off"`).

**Steps:**
- [ ] Add devDeps: `pnpm --filter @channelers/stage add -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`.
- [ ] Add to `package.json` scripts: `"test": "vitest run"`.
- [ ] Create `vitest.setup.ts`:
  ```ts
  import "@testing-library/jest-dom/vitest";
  import { afterEach } from "vitest";
  import { cleanup } from "@testing-library/react";
  afterEach(() => cleanup());
  ```
- [ ] Add a `test` block to `vite.config.ts` (merge into the existing `defineConfig`):
  ```ts
  test: { environment: "jsdom", globals: true, setupFiles: ["./vitest.setup.ts"] },
  ```
  and at the top of the file: `/// <reference types="vitest" />`.
- [ ] Write the failing test `src/lib/useCrtFx.test.ts`:
  ```ts
  import { renderHook, act } from "@testing-library/react";
  import { beforeEach, expect, test } from "vitest";
  import { useCrtFx } from "./useCrtFx";

  beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/intake"); });

  test("defaults on", () => {
    expect(renderHook(() => useCrtFx()).result.current.fx).toBe(true);
  });
  test("?crt=off forces off", () => {
    window.history.replaceState({}, "", "/intake?crt=off");
    expect(renderHook(() => useCrtFx()).result.current.fx).toBe(false);
  });
  test("toggle flips and persists", () => {
    const { result } = renderHook(() => useCrtFx());
    act(() => result.current.toggle());
    expect(result.current.fx).toBe(false);
    expect(localStorage.getItem("channelers.crt")).toBe("off");
  });
  ```
- [ ] Run `pnpm --filter @channelers/stage test` — expect FAIL (module not found).
- [ ] Implement `src/lib/useCrtFx.ts`:
  ```ts
  import { useCallback, useState } from "react";
  const KEY = "channelers.crt";
  function initial(): boolean {
    if (new URLSearchParams(location.search).get("crt") === "off") return false;
    return localStorage.getItem(KEY) !== "off";
  }
  export function useCrtFx(): { fx: boolean; toggle: () => void } {
    const [fx, setFx] = useState(initial);
    const toggle = useCallback(() => setFx((on) => {
      const next = !on;
      localStorage.setItem(KEY, next ? "on" : "off");
      return next;
    }), []);
    return { fx, toggle };
  }
  ```
- [ ] Run test — expect PASS. Run `pnpm --filter @channelers/stage typecheck` — PASS.
- [ ] Commit: `feat(stage): CRT-FX toggle hook + vitest harness`.

### Task 2 — `SegmentNumber` component

**Files:** create `src/components/SegmentNumber.tsx`, `src/components/SegmentNumber.test.tsx`.

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `<SegmentNumber value={n} digits?={3} glitch?={false} className?="" />`. Renders a ghost layer of `8`s (length = displayed length) at `--amber-off` and a front layer of the zero-padded value at `--amber`. Pads to `digits` (default 3) but never truncates a longer number. Sets `aria-label={String(value)}`.

**Steps:**
- [ ] Write failing `SegmentNumber.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import { expect, test } from "vitest";
  import { SegmentNumber } from "./SegmentNumber";

  test("pads to three and ghosts the same width", () => {
    const { container } = render(<SegmentNumber value={7} />);
    expect(screen.getByLabelText("7")).toBeInTheDocument();
    expect(container.querySelector(".seg-front")!.textContent).toBe("007");
    expect(container.querySelector(".seg-ghost")!.textContent).toBe("888");
  });
  test("does not truncate numbers wider than the pad", () => {
    const { container } = render(<SegmentNumber value={1234} />);
    expect(container.querySelector(".seg-front")!.textContent).toBe("1234");
    expect(container.querySelector(".seg-ghost")!.textContent).toBe("8888");
  });
  test("glitch flag adds the class", () => {
    const { container } = render(<SegmentNumber value={1} glitch />);
    expect(container.querySelector(".seg")!.className).toContain("seg-glitch");
  });
  ```
- [ ] Run test — expect FAIL.
- [ ] Implement `SegmentNumber.tsx`:
  ```tsx
  export function SegmentNumber({
    value, digits = 3, glitch = false, className = "",
  }: { value: number; digits?: number; glitch?: boolean; className?: string }) {
    const text = String(value).padStart(digits, "0");
    const ghost = "8".repeat(text.length);
    return (
      <div className={`seg${glitch ? " seg-glitch" : ""} ${className}`} aria-label={String(value)} role="img">
        <span className="seg-ghost" aria-hidden>{ghost}</span>
        <span className="seg-front" aria-hidden>{text}</span>
      </div>
    );
  }
  ```
- [ ] Run test — expect PASS. Typecheck — PASS.
- [ ] Commit: `feat(stage): SegmentNumber LED component`.

### Task 3 — Fonts + `crt.css` foundation

Pure-visual; verified by screenshot, not unit test.

**Files:** create `src/styles/crt.css`, `public/fonts/DSEG7Classic-Bold.woff2`, `public/fonts/W95FA.woff2`.

**Interfaces:**
- Produces (CSS classes later tasks rely on): `.crt` (root, tokens) · `.crt-void` · `.crt-static` · `.crt-scanlines` · `.crt-curve` · `.crt-bezel` · `.seg/.seg-ghost/.seg-front/.seg-glitch` · `.win/.win-title/.win-body/.win-btn/.win-field` · `.crt-eyebrow` · `.crt-led`.

**Steps:**
- [ ] Vendor fonts into `public/fonts/`: DSEG7 Classic Bold from github.com/keshikan/DSEG (OFL-1.1), W95FA (free webfont). If unreachable at build time, leave the `@font-face` with its fallback stack so the page still renders.
- [ ] Create `src/styles/crt.css`. `@font-face` first:
  ```css
  @font-face { font-family: "DSEG7"; src: url("/fonts/DSEG7Classic-Bold.woff2") format("woff2"); font-display: swap; }
  @font-face { font-family: "W95FA"; src: url("/fonts/W95FA.woff2") format("woff2"); font-display: swap; }
  ```
- [ ] Root tokens + void + title-safe center (copy the token values from the design contract above verbatim):
  ```css
  .crt { --void-a:#1b0e30; --void-b:#07313a; --amber:#ffb000; --amber-off:#4a3300; --amber-glow:#ff7a00;
         --cyan:#2ee6d6; --magenta:#ff3ca6; --win-face:#c9c5bb; --win-hi:#fff; --win-lo:#6f6a60;
         --crt-ink:#e9e4d8; --crt-dim:#8a8475;
         position:fixed; inset:0; overflow:hidden; display:grid; place-items:center;
         background:radial-gradient(120% 100% at 50% 0%, var(--void-b), var(--void-a) 70%);
         color:var(--crt-ink); font-family:"W95FA", Tahoma, Geneva, Verdana, sans-serif; }
  .crt-safe { width:80%; max-width:720px; aspect-ratio:4/3; display:grid; place-items:center; text-align:center; }
  ```
- [ ] Static (animated SVG turbulence as a CSS `background-image` data-URI on `.crt-static`, low opacity, `mix-blend-mode:screen`), scanlines (`repeating-linear-gradient` 0/2px), curvature/vignette (`radial-gradient` mask + inset `box-shadow`), all as absolutely-positioned full-bleed overlay layers. Gate the FX-only layers under `.crt[data-crt-fx="on"]`:
  ```css
  .crt-static, .crt-scanlines, .crt-curve { position:absolute; inset:0; pointer-events:none; }
  .crt-static { opacity:.06; background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }
  .crt[data-crt-fx='on'] .crt-scanlines { background:repeating-linear-gradient(rgba(0,0,0,.0) 0 1px, rgba(0,0,0,.35) 1px 2px); }
  .crt[data-crt-fx='on'] .crt-curve { box-shadow:inset 0 0 140px 40px rgba(0,0,0,.8); border-radius:18px/8px; }
  .crt[data-crt-fx='off'] .crt-scanlines, .crt[data-crt-fx='off'] .crt-curve { display:none; }
  ```
- [ ] LED segment stacking (front overlays ghost, monospaced DSEG aligns them) + glow:
  ```css
  .seg { position:relative; font-family:"DSEG7", ui-monospace, monospace; font-size:min(34vh,28vw); line-height:1; letter-spacing:.08em; }
  .seg-ghost { color:var(--amber-off); }
  .seg-front { position:absolute; inset:0; color:var(--amber); text-shadow:0 0 .18em var(--amber-glow); }
  .crt-eyebrow { font-family:ui-monospace,monospace; letter-spacing:.5em; color:var(--cyan); font-size:14px; text-transform:uppercase; }
  ```
- [ ] XP dialog primitives (outset bevel for face/buttons, inset for fields):
  ```css
  .win { background:var(--win-face); color:#101010; border:2px solid; border-color:var(--win-hi) var(--win-lo) var(--win-lo) var(--win-hi); width:88%; max-width:520px; text-align:left; }
  .win-title { display:flex; justify-content:space-between; align-items:center; padding:3px 6px; color:#fff;
               background:linear-gradient(90deg,#1f3a8a,#5b3a8a); font-weight:700; }
  .win-body { padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
  .win-field { background:#fff; border:2px solid; border-color:var(--win-lo) var(--win-hi) var(--win-hi) var(--win-lo); padding:4px 6px; font:inherit; }
  .win-btn { background:var(--win-face); border:2px solid; border-color:var(--win-hi) var(--win-lo) var(--win-lo) var(--win-hi);
             padding:4px 16px; font:inherit; cursor:pointer; }
  .win-btn:active { border-color:var(--win-lo) var(--win-hi) var(--win-hi) var(--win-lo); }
  .win-btn:focus-visible, .win-field:focus-visible { outline:2px solid var(--cyan); outline-offset:1px; }
  ```
- [ ] Import the stylesheet from `CrtShell.tsx` (Task 4) — not from `main.tsx` — so it loads only with the shell.
- [ ] Visual check (deferred to Task 4 when there's a host component). Typecheck — PASS (CSS only, no TS impact).
- [ ] Commit: `feat(stage): crt.css foundation + self-hosted DSEG/W95FA fonts`.

### Task 4 — `CrtShell` component

**Files:** create `src/components/CrtShell.tsx`, `src/components/CrtShell.test.tsx`.

**Interfaces:**
- Consumes: `useCrtFx` (Task 1); `crt.css` classes (Task 3).
- Produces: `<CrtShell statusLabel?="TERMINAL 1">{children}</CrtShell>`. Renders the `.crt` root with `data-crt-fx={fx ? "on" : "off"}`, the static/scanline/curve layers, a `.crt-safe` center holding `children`, a bezel status line, and a small FX toggle button (`aria-pressed`, label "CRT").

**Steps:**
- [ ] Write failing `CrtShell.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { beforeEach, expect, test } from "vitest";
  import { CrtShell } from "./CrtShell";

  beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/intake"); });

  test("renders children and defaults FX on", () => {
    render(<CrtShell><p>hello</p></CrtShell>);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(document.querySelector(".crt")!.getAttribute("data-crt-fx")).toBe("on");
  });
  test("toggle button flips the FX attribute", async () => {
    render(<CrtShell><p>x</p></CrtShell>);
    await userEvent.click(screen.getByRole("button", { name: /crt/i }));
    expect(document.querySelector(".crt")!.getAttribute("data-crt-fx")).toBe("off");
  });
  ```
- [ ] Run — expect FAIL.
- [ ] Implement `CrtShell.tsx`:
  ```tsx
  import "../styles/crt.css";
  import type { ReactNode } from "react";
  import { useCrtFx } from "../lib/useCrtFx";

  export function CrtShell({ children, statusLabel = "TERMINAL 1" }: { children: ReactNode; statusLabel?: string }) {
    const { fx, toggle } = useCrtFx();
    return (
      <div className="crt" data-crt-fx={fx ? "on" : "off"}>
        <div className="crt-static" aria-hidden />
        <div className="crt-scanlines" aria-hidden />
        <div className="crt-safe">{children}</div>
        <div className="crt-curve" aria-hidden />
        <div className="crt-bezel">
          <span className="crt-led" /> {statusLabel}
          <button className="crt-fx-toggle" aria-pressed={fx} onClick={toggle}>CRT</button>
        </div>
      </div>
    );
  }
  ```
  Add `.crt-bezel`/`.crt-led`/`.crt-fx-toggle` rules to `crt.css` (position the bezel line bottom-left, the toggle bottom-right, small + dim).
- [ ] Run — expect PASS.
- [ ] Visual check: temporarily mount `<CrtShell><SegmentNumber value={17} /></CrtShell>` at `/intake` (or via a scratch route) and screenshot — confirm: 4:3 safe area, amber LED with visible ghost segments, scanlines/curvature present with FX on and gone with FX off, static shimmer. Adjust token/opacity values to taste, then revert the scratch mount.
- [ ] Typecheck — PASS. Commit: `feat(stage): CrtShell frame + FX toggle`.

### Task 5 — `CalledGate` CRT skin (standby + called)

**Files:** modify `src/components/CalledGate.tsx`; create `src/components/CalledGate.test.tsx`.

**Interfaces:**
- Consumes: `SegmentNumber` (Task 2); `crt.css` classes; existing props + new `skin?: "crt" | "default"` (default `"default"`).
- Produces: when `skin="crt"`, renders **shell-less** CRT content (no `<main>`, no `<h1>` title) — meant to sit inside Intake's `CrtShell`. `default` renders today's markup unchanged.

**Steps:**
- [ ] Write failing `CalledGate.test.tsx` (mock `../lib/api` so no network):
  ```tsx
  import { render, screen } from "@testing-library/react";
  import { expect, test, vi } from "vitest";
  import { CalledGate } from "./CalledGate";
  vi.mock("../lib/api", () => ({ api: { arrive: vi.fn(), getByNumber: vi.fn() } }));
  const slot = (occ?: any) => ({ id: "intake-0", station: "intake" as const, online: true, occupant: occ });

  test("crt skin: no title, STANDBY when idle", () => {
    render(<CalledGate station="intake" title="Intake" connected skin="crt" slot={slot()} onArrived={() => {}} />);
    expect(screen.queryByRole("heading", { name: "Intake" })).toBeNull();
    expect(screen.getByText(/standby/i)).toBeInTheDocument();
  });
  test("crt skin: called shows the number and an I AM button", () => {
    const occ = { visitorId: "v1", number: 17, phase: "called" as const, since: "" };
    render(<CalledGate station="intake" title="Intake" connected skin="crt" slot={slot(occ)} onArrived={() => {}} />);
    expect(screen.getByLabelText("17")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I AM" })).toBeInTheDocument();
  });
  test("default skin still shows the title and Confirm arrival", () => {
    const occ = { visitorId: "v1", number: 9, phase: "called" as const, since: "" };
    render(<CalledGate station="intake" title="Intake" connected slot={slot(occ)} onArrived={() => {}} />);
    expect(screen.getByRole("heading", { name: "Intake" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm arrival/i })).toBeInTheDocument();
  });
  ```
- [ ] Run — expect FAIL (no `skin` prop).
- [ ] Implement: add `skin = "default"` to the props; keep all the existing `useState`/`useEffect`/`confirmArrival` logic. After the hooks, branch on `skin`. The `"default"` branch returns today's JSX verbatim. The `"crt"` branch returns a fragment:
  ```tsx
  if (skin === "crt") {
    return (
      <>
        {!slot && <p className="crt-dim">no slot bound — open with <code>?kiosk=…</code></p>}
        {slot && !occ && (
          <div className="crt-standby">
            <SegmentNumber value={0} className="seg-dim" />
            <p className="crt-eyebrow">▮ standby</p>
            <p className="crt-sub">awaiting designation</p>
          </div>
        )}
        {occ && occ.phase !== "in_progress" && occ.phase !== "pending" && (
          <div className="crt-called">
            <p className="crt-eyebrow">now serving</p>
            <SegmentNumber value={occ.number} glitch />
            <button className="win-btn crt-iam" disabled={busy} onClick={() => void confirmArrival()}>
              {busy ? "…" : "I AM"}
            </button>
            <p className="crt-sub">confirm to proceed</p>
          </div>
        )}
        {error && <p className="crt-err">SIGNAL LOST — {error}</p>}
      </>
    );
  }
  ```
  Import `SegmentNumber`. Add `.crt-standby/.crt-called/.crt-sub/.crt-err/.crt-iam/.seg-dim` rules to `crt.css` (standby LED dimmed via `.seg-dim .seg-front{opacity:.12}`; `.crt-iam` larger amber-bordered variant of `.win-btn`).
- [ ] Run — expect PASS (all three). Typecheck — PASS.
- [ ] Commit: `feat(stage): CalledGate CRT skin (standby + I AM)`.

### Task 6 — Intake: CrtShell wrap, XP-dialog form, Processed screen

**Files:** modify `src/routes/Intake.tsx`.

**Interfaces:**
- Consumes: `CrtShell` (Task 4), `CalledGate` `skin="crt"` (Task 5), `SegmentNumber` (Task 2). All existing data flow (`useStationPresence`, `useReleaseToGate`, `submit`, `SURVEY`) is unchanged — only the JSX wrapper/markup changes.

**Steps:**
- [ ] Wrap all three return paths in `<CrtShell statusLabel={`TERMINAL · #${visitor?.number ?? "—"}`}>…</CrtShell>`. The gate path becomes `<CalledGate … skin="crt" />` (drop the now-unused `title` visual but keep passing it).
- [ ] Processed screen → inside CrtShell:
  ```tsx
  <div className="crt-processed">
    <p className="crt-eyebrow">● processed</p>
    <SegmentNumber value={visitor.number} />
    <p className="crt-sub">proceed to the Physical Challenge when called</p>
  </div>
  ```
- [ ] Survey form → an XP dialog. Keep the `SURVEY.map` logic and state setters exactly; only change wrappers/classes:
  ```tsx
  <div className="win">
    <div className="win-title"><span>INTAKE.EXE — FORM 7-A</span><span className="win-controls">_ □ ✕</span></div>
    <div className="win-body">
      <p className="win-subject">SUBJECT NO. <SegmentNumber value={visitor.number} className="seg-inline" /></p>
      {SURVEY.map((f) => /* same branches; <label> stays, inputs → className="win-field",
         choice chips → className="win-chip" (+ " on"), submit → className="win-btn" */ null)}
      {error && <p className="crt-err">SIGNAL LOST — {error}</p>}
      <button className="win-btn" onClick={() => void submit()} disabled={!name.trim()}>SUBMIT</button>
    </div>
  </div>
  ```
  Replace the existing `className="field/choice/choices/submit"` with the `.win-*` equivalents; add `.win-chip`, `.win-subject`, `.seg-inline` (small inline LED) rules to `crt.css`. Remove the old `<header>`/`<h1>Intake</h1>`/`.dim` number line.
- [ ] Render smoke test (extend `CalledGate.test.tsx` or add `Intake.test.tsx` — mock `../lib/api`, `../lib/useStationPresence`, `../lib/useReleaseToGate` to drive a visitor in): assert the `INTAKE.EXE — FORM 7-A` titlebar renders, all SURVEY labels render, and SUBMIT is disabled until `name` is filled. *(If mocking the presence hooks proves fiddly, downgrade this to a visual-only check and note it.)*
- [ ] Visual check: `pnpm dev`, drive a visitor to the intake slot via `/dispatch`, screenshot CALLED → FORM → PROCESSED. Confirm: amber number on static, I AM button, XP dialog with beveled fields/chips/SUBMIT, Processed echo. Toggle CRT off and re-screenshot.
- [ ] Typecheck — PASS. Commit: `feat(stage): Intake XP-dialog form + Processed CRT screen`.

### Task 7 — Motion, glitch, reduced-motion, overscan polish + docs

**Files:** modify `src/styles/crt.css`; modify `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `app/CLAUDE.md`.

**Steps:**
- [ ] Add keyframes to `crt.css`: power-on reveal (`.crt-safe` scale-Y 0→1 + brightness flash on mount), ambient flicker (`.crt[data-crt-fx='on']` subtle opacity wobble), number glitch (`.seg-glitch` → periodic `clip-path`/`transform: translate` jitter + cyan/magenta `text-shadow` RGB-split on `.seg-front`), `.crt-iam:hover` phosphor pulse, `:active` screen-wobble.
- [ ] `@media (prefers-reduced-motion: reduce)`: disable the roll/jitter/flicker keyframes; set `.crt-static{opacity:.03}`; keep static frame, no motion.
- [ ] Overscan: confirm `.crt-safe` stays within 80% and nothing critical clips at 4:3; nudge if needed.
- [ ] Final screenshot pass of all four states, FX on and off, plus a reduced-motion run (emulate in devtools).
- [ ] `docs/CHANGELOG.md` (newest on top): what (Intake CRT redesign), why (DMV-purgatory identity), files/areas (the new components + crt.css + CalledGate skin), docs-touched.
- [ ] `docs/ARCHITECTURE.md` + `app/CLAUDE.md`: note `CalledGate` now takes `skin?: "crt"|"default"` and Intake renders inside `CrtShell`; BodyScan/Altar unchanged.
- [ ] `pnpm -r typecheck` + `pnpm --filter @channelers/stage test` + `pnpm --filter @channelers/stage build` — all PASS.
- [ ] Commit: `feat(stage): Intake CRT motion/glitch polish + docs`.

---

## Self-review notes
- TDD applies to the three logic/branching units (Tasks 1, 2, 5) + a render smoke test (Tasks 4, 6); pure-CSS tasks (3, 7) are screenshot-verified — stated honestly, not faked with meaningless assertions.
- No interface references a symbol not defined here: `useCrtFx`→`CrtShell`, `SegmentNumber`→Gate/Intake, `crt.css` classes→all consumers, `skin` prop→Intake. Types (`Slot`, `SlotOccupant.phase`, `VisitorProfile.number`) match `packages/shared`.
- Scope held to Intake; `CalledGate` default branch is byte-for-byte today's output so BodyScan/Altar can't regress.
- Open risk flagged inline: mocking the presence hooks for the Intake smoke test may be fiddly (Task 6 has a downgrade path).
