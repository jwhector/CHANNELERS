# Group/Timed Stations + Station #1 (Scan/Shred/Feed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a kiosk-less, multi-person, timer-completed station *kind* to the Tier 3 dispatcher and ship its first instance, `paper` (Scan/Shred/Feed): the dispatcher calls visitors to `paper`, a 5-minute timer-from-call stamps `paperAt`, and a physical-button webcam capture OCRs the page and animates it "into the matrix" via a new `paper.fed` event.

**Architecture:** `paper` is a 4th `Station` whose slots are **always online** (no kiosk to bind) and whose occupants are **completed by a dwell timer** measured from operator Confirm-call (the `called` phase), instead of by a task stamping a milestone. The dispatcher's existing slot/select/fill machinery is reused; only `reconcile()` gains a timed-completion branch. The feed is a separate, **identity-agnostic** spectacle pipeline: a stage `/feed` route captures a frame on a keypress → `POST /api/paper/feed` → `gpt-4o` vision OCR (offline fallback) → a new `paper.fed` `ShowEvent` on the WS bus **+ OSC** → a Brain-controlled "into the matrix" animation.

**Tech Stack:** TypeScript, pnpm monorepo. Brain: Fastify + `ws` + OpenAI SDK (`apps/brain`). Shared zod contract (`packages/shared`). Stage: Vite/React + React Router (`apps/stage`). Tests: vitest (brain offline-by-default; stage with Testing Library).

## Global Constraints

- **All TypeScript.** Typecheck must pass before any task is "done": `pnpm -r typecheck` (0 errors).
- **Brain tests run offline by design.** `apps/brain/test/setup.ts` forces `OPENAI_API_KEY=""`, so any OpenAI path must take a deterministic offline fallback. Tests needing the keyed path `vi.mock("../src/config")`.
- **Offline-resilient:** an OpenAI failure must degrade gracefully (fallback text), never throw to the user or block the spectacle.
- **Bus discipline:** dispatch/logistics state stays **off** the `ShowEvent`/OSC contract (rides `dispatch.state` WS only). The outward-facing **`paper.fed`** spectacle is the exception — it IS a `ShowEvent` and rides WS **+ OSC**.
- **Feed is identity-agnostic:** `paper.fed = { text, fedAt }` — **no `visitorId`**.
- **`paper` is non-gating + ungated:** eligible whenever `!paperAt`; nothing downstream requires `paperAt`.
- **Knobs (env-overridable):** `slots.paper = 4` (group capacity), `paperDwellMs = 300_000` (5 min), operator-only countdown.
- **OpenAI:** use the configured multimodal model (`config.transformModel`, default `gpt-4o`). **Verify the vision message shape against the current OpenAI reference at build time** (per `docs/CLAUDE.md`) before trusting Task 5's snippet.
- **After the feature lands, update `docs/CHANGELOG.md`** (newest on top) and affected docs (`app/CLAUDE.md`, `docs/ARCHITECTURE.md`). Spec of record: `docs/superpowers/specs/2026-06-22-group-stations-design.md`.
- Run a single brain test file with: `pnpm --filter @channelers/brain test -- <file>`. Run stage tests with: `pnpm --filter @channelers/stage test`.

## File Structure

**Tier A — dispatcher backbone (the timed group station + `paper`):**
- Modify `packages/shared/src/schemas.ts` — `Station` enum `+ "paper"`; `VisitorProfile` `+ paperAt`.
- Modify `apps/brain/src/store.ts` — `stampMilestone` field union `+ "paperAt"`.
- Modify `apps/brain/src/config.ts` — `dispatcher.slots.paper`; new `dispatcher.timed`.
- Modify `apps/brain/src/dispatcher.ts` — `STATION_ORDER + "paper"`; `isTimed`/`dwellMs` helpers; `isOnline` true for timed slots; `paper` eligibility line; `milestoneField()`; timed-completion branch in `reconcile()`; `markComplete`/`completionMilestoneSet` cover `paper`; `snapshot().stationsOnline.paper`.

**Tier B — the feed spectacle pipeline (brain):**
- Modify `packages/shared/src/events.ts` — `paper.fed` variant + `OSC_ADDRESSES` entry + `toOsc()` case.
- Create `apps/brain/src/paper.ts` — `ocrPage(dataUrl): Promise<string | null>` (keyed `gpt-4o` vision, else `null`).
- Modify `apps/brain/src/app.ts` — `POST /api/paper/feed` (JSON `{ image }` → OCR → fallback → publish `paper.fed`).

**Tier C — the `/feed` stage route:**
- Modify `apps/stage/src/lib/api.ts` — `feedPaper(image)` helper.
- Create `apps/stage/src/lib/paperFeed.ts` — pure `paperFedText(msg)` selector + `captureDataUrl(video)`.
- Create `apps/stage/src/routes/Feed.tsx` — `FeedDisplay` (presentational) + `Feed` (webcam + button + WS wiring).
- Modify `apps/stage/src/App.tsx` — register `/feed` + add to `SCREENS`.

**Tier D — operator countdown (optional polish):**
- Modify `packages/shared/src/protocol.ts` + `apps/brain/src/dispatcher.ts` — `DispatchState.timedDwellMs`.
- Modify `apps/stage/src/routes/Dispatch.tsx` — show remaining time on paper slot occupants.

**Tier E — docs reconciliation** (per project convention + the "reconcile arch docs" learning).

**Tests:** append to `apps/brain/test/{store,dispatcher,endpoints}.test.ts`; new `apps/brain/test/paper-events.test.ts` (the `paper.fed` contract) and `apps/brain/test/paper.test.ts` (OCR offline); new `apps/stage/src/lib/paperFeed.test.ts` + `apps/stage/src/routes/Feed.test.tsx`.

---

## Tier A — Dispatcher backbone

### Task 1: `paper` station + `paperAt` milestone (shared schema + store)

**Files:**
- Modify: `packages/shared/src/schemas.ts:45` (`Station`), `:72` (add `paperAt` to `VisitorProfile`)
- Modify: `apps/brain/src/store.ts:106-114` (`stampMilestone` field union)
- Test: `apps/brain/test/store.test.ts` (append)

**Interfaces:**
- Produces: `Station` now includes `"paper"`; `VisitorProfile.paperAt?: string`; `store.stampMilestone(id, "paperAt")` is valid.

- [ ] **Step 1: Write the failing test** — append to `apps/brain/test/store.test.ts`:

```ts
describe("paper station milestone", () => {
  it("stamps paperAt via stampMilestone", () => {
    store.clear();
    const v = store.register(770001);
    expect(v.paperAt).toBeUndefined();
    store.stampMilestone(v.id, "paperAt");
    expect(store.get(v.id)?.paperAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- store.test.ts`
Expected: FAIL — `stampMilestone`'s field argument type does not allow `"paperAt"` (typecheck/compile error or assertion).

- [ ] **Step 3: Implement** — in `packages/shared/src/schemas.ts`, extend the enum and add the milestone:

```ts
/** The dispatchable stations. `paper` is a timed group station (spec 2026-06-22). */
export const Station = z.enum(["intake", "bodyscan", "altar", "paper"]);
```

```ts
  poseVerifiedAt: z.string().optional(),
  /** Timed group station: stamped on dwell-timer expiry at the paper station (spec 2026-06-22). */
  paperAt: z.string().optional(),
  sessionStartAt: z.string().optional(),
```

In `apps/brain/src/store.ts`, add `"paperAt"` to the `stampMilestone` field union:

```ts
  stampMilestone(
    id: string,
    field:
      | "intakeAt" | "poseAt" | "personaAt" | "paperAt"
      | "poseVerifiedAt" | "sessionStartAt" | "sessionEndAt",
  ): VisitorRecord | undefined {
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @channelers/brain test -- store.test.ts` then `pnpm -r typecheck`
Expected: PASS; 0 typecheck errors.

> Note: adding `"paper"` to `Station` makes the hardcoded `stationsOnline` object in `dispatcher.ts:336-340` a TS error (missing key) — that's expected and fixed in Task 2. If you run the full typecheck now it will flag exactly that line.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts apps/brain/src/store.ts apps/brain/test/store.test.ts
git commit -m "feat(shared): add paper station + paperAt milestone"
```

---

### Task 2: register `paper` as a timed group station (dispatcher)

**Files:**
- Modify: `apps/brain/src/config.ts:52-72` (`dispatcher.slots` + new `timed`)
- Modify: `apps/brain/src/dispatcher.ts` (`STATION_ORDER`, helpers, `isOnline`, eligibility, `stationsOnline`)
- Test: `apps/brain/test/dispatcher.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `Station` incl. `"paper"` (Task 1).
- Produces: a dispatcher whose `snapshot().slots` includes `paper-0..N-1`, each `online: true` with no `kioskId`; `snapshot().stationsOnline.paper`; `eligibleStations` returns `"paper"` when `!paperAt`. Internal helpers `isTimed(station)`, `dwellMs(station)`.

- [ ] **Step 1: Write the failing test** — append to `apps/brain/test/dispatcher.test.ts`:

```ts
describe("paper: timed group station", () => {
  const P_KNOBS = {
    slots: { intake: 0, bodyscan: 0, altar: 0, paper: 2 },
    timed: { paper: { dwellMs: 300_000 } },
    K: 1, warmupMs: 0, tickMs: 5_000,
  };
  let pf: ReturnType<typeof fakeBus>;
  let pd: ReturnType<typeof createDispatcher>;
  beforeEach(() => {
    pf = fakeBus();
    pd = createDispatcher(pf.bus, { knobs: P_KNOBS as any, autoStart: false });
  });
  afterEach(() => pd.stop());

  it("derives paper slots that are always online without any kiosk", () => {
    const s = pd.snapshot();
    const paper = s.slots.filter((x) => x.station === "paper");
    expect(paper.map((x) => x.id).sort()).toEqual(["paper-0", "paper-1"]);
    expect(paper.every((x) => x.online === true && !x.kioskId)).toBe(true);
    expect(s.stationsOnline.paper).toBe(true);
  });

  it("a fresh waiting visitor is eligible for paper", () => {
    store.register(771001);
    const q = pd.snapshot().queue.find((e) => e.number === 771001);
    expect(q?.eligible).toContain("paper");
  });

  it("dispatches a waiting visitor into a paper slot (no kiosk), confirm starts the dwell", () => {
    const v = store.register(771002);
    pd.kick(); // warmup K=1 met → fill
    const pending = pd.snapshot().slots.find((x) => x.station === "paper" && x.occupant);
    expect(pending?.occupant?.phase).toBe("pending");
    expect(pd.confirm(v.id)).toBe(true);
    const called = pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id);
    expect(called?.occupant?.phase).toBe("called");
    expect(store.get(v.id)?.location).toMatchObject({ state: "called", station: "paper" });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- dispatcher.test.ts`
Expected: FAIL — paper slots are absent / `online` is false / `stationsOnline.paper` missing.

- [ ] **Step 3: Implement** — in `apps/brain/src/config.ts`, extend `dispatcher.slots` and add `timed`:

```ts
  dispatcher: {
    /** Per-station capacity. intake/bodyscan/altar are kiosk slots; `paper` is a timed group's capacity. */
    slots: { intake: 2, bodyscan: 1, altar: 1, paper: 4 } as Record<
      "intake" | "bodyscan" | "altar" | "paper", number
    >,
    /** Timed group stations: present ⇒ kiosk-less, always-online, completed by a dwell timer (spec 2026-06-22). */
    timed: { paper: { dwellMs: Number(process.env.PAPER_DWELL_MS ?? 300_000) } } as Partial<
      Record<"intake" | "bodyscan" | "altar" | "paper", { dwellMs: number }>
    >,
    /** Warm-up pool size — don't dispatch until this many are waiting OR T_warmup elapses. */
    K: Number(process.env.DISPATCH_K ?? 3),
```

In `apps/brain/src/dispatcher.ts`, extend `STATION_ORDER` and add the helpers + eligibility + `stationsOnline`:

```ts
const STATION_ORDER: Station[] = ["intake", "bodyscan", "altar", "paper"];
```

Just after `const ageMs = ...` (around line 63), add:

```ts
  const isTimed = (s: Station): boolean => !!knobs.timed?.[s];
  const dwellMs = (s: Station): number => knobs.timed?.[s]?.dwellMs ?? Infinity;
```

Change `isOnline` (line 75) so timed slots never need a kiosk:

```ts
  const isOnline = (s: SlotState) => isTimed(s.station) || !!s.connId;
```

Add the `paper` eligibility line inside `eligibleStations` (after the altar line, ~line 87):

```ts
    if (v.intakeAt && v.poseAt && !v.sessionEndAt) out.push("altar");
    if (!v.paperAt) out.push("paper");
    return out;
```

Fix `snapshot().stationsOnline` (lines 336-340) to include `paper`:

```ts
    const stationsOnline = {
      intake: slotsOf("intake").some(isOnline),
      bodyscan: slotsOf("bodyscan").some(isOnline),
      altar: slotsOf("altar").some(isOnline),
      paper: slotsOf("paper").some(isOnline),
    };
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm --filter @channelers/brain test -- dispatcher.test.ts` then `pnpm -r typecheck`
Expected: PASS (new block + all existing dispatcher tests still green); 0 typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/config.ts apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(dispatch): register paper as an always-online timed group station"
```

---

### Task 3: timer-from-call completion (dispatcher `reconcile`)

**Files:**
- Modify: `apps/brain/src/dispatcher.ts` (`milestoneField()`, `markComplete`, `completionMilestoneSet`, `reconcile` timed branch)
- Test: `apps/brain/test/dispatcher.test.ts` (extend the `paper` block)

**Interfaces:**
- Consumes: Task 2's `isTimed`/`dwellMs`, `paper` slots.
- Produces: a `paper` occupant in the `called` phase auto-completes once `dwellMs` elapses from its `since` — `paperAt` stamped, slot freed, location back to `waiting`; no-show/stale never fire for timed stations; `markComplete` stamps `paperAt` for a paper occupant.

- [ ] **Step 1: Write the failing test** — extend the `describe("paper: timed group station", …)` block:

```ts
  it("completes a paper occupant after dwellMs: stamps paperAt, frees the slot, repools", () => {
    const v = store.register(772001);
    pd.kick();
    pd.confirm(v.id); // called → dwell starts from now
    vi.advanceTimersByTime(300_000 + 1_000);
    pd.kick(); // reconcile
    expect(store.get(v.id)?.paperAt).toBeTruthy();
    expect(store.get(v.id)?.location.state).toBe("waiting");
    expect(pd.snapshot().slots.some((x) => x.occupant?.visitorId === v.id)).toBe(false);
  });

  it("does not complete before dwellMs", () => {
    const v = store.register(772002);
    pd.kick();
    pd.confirm(v.id);
    vi.advanceTimersByTime(120_000); // < dwell
    pd.kick();
    expect(store.get(v.id)?.paperAt).toBeUndefined();
    expect(pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant?.phase).toBe("called");
  });

  it("never applies the no-show timer to a timed station", () => {
    const v = store.register(772003);
    pd.kick();
    pd.confirm(v.id);
    vi.advanceTimersByTime(100_000); // > noShowMs(90s) but < dwell(300s)
    pd.kick();
    const occ = pd.snapshot().slots.find((x) => x.occupant?.visitorId === v.id)?.occupant;
    expect(occ?.phase).toBe("called"); // still there, not reaped, not flagged
    const q = pd.snapshot().queue.find((e) => e.number === 772003);
    expect(q).toBeUndefined(); // not back in the waiting pool
  });

  it("markComplete stamps paperAt for a paper occupant", () => {
    const v = store.register(772004);
    pd.kick();
    pd.confirm(v.id);
    expect(pd.markComplete(v.id)).toBe(true);
    expect(store.get(v.id)?.paperAt).toBeTruthy();
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- dispatcher.test.ts`
Expected: FAIL — `paperAt` never set (no timed branch); `markComplete` stamps `sessionEndAt` not `paperAt`; no-show flags/repools the paper occupant.

- [ ] **Step 3: Implement** — in `apps/brain/src/dispatcher.ts`.

Add a `milestoneField` helper (next to `completionMilestoneSet`, ~line 266):

```ts
  function milestoneField(station: Station): "intakeAt" | "poseAt" | "paperAt" | "sessionEndAt" {
    if (station === "intake") return "intakeAt";
    if (station === "bodyscan") return "poseAt";
    if (station === "paper") return "paperAt";
    return "sessionEndAt"; // altar held through the reading
  }
```

Use it in `markComplete` (replace the inline `field` ternary, ~line 228):

```ts
    if (station) {
      store.stampMilestone(visitorId, milestoneField(station));
    }
```

Extend `completionMilestoneSet` to cover `paper` (~line 266-270):

```ts
  function completionMilestoneSet(v: VisitorRecord, station: Station): boolean {
    if (station === "intake") return !!v.intakeAt;
    if (station === "bodyscan") return !!v.poseAt;
    if (station === "paper") return !!v.paperAt;
    return !!v.sessionEndAt; // altar held through the reading
  }
```

Add the timed-completion branch at the top of the `reconcile` per-slot loop (inside `for (const slot of slots.values())`, right after the `if (!v) {...}` guard, ~line 287):

```ts
      if (isTimed(slot.station)) {
        // Timer-from-call: a confirmed (called) occupant completes once the dwell elapses.
        // No auto-arrive (stays `called` so /board shows it); no no-show / stale for timed stations.
        if (occ.phase === "called" && ageMs(occ.since) > dwellMs(slot.station)) {
          store.stampMilestone(occ.visitorId, milestoneField(slot.station));
          slot.occupant = undefined;
          store.setLocation(occ.visitorId, { state: "waiting", since: nowIso() });
          clearFlags(occ.visitorId);
        }
        continue; // skip the kiosk-station in_progress/called handling below
      }
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm --filter @channelers/brain test -- dispatcher.test.ts` then `pnpm -r typecheck`
Expected: PASS (paper block + existing dispatcher tests); 0 typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/dispatcher.ts apps/brain/test/dispatcher.test.ts
git commit -m "feat(dispatch): timer-from-call completion for timed stations (stamps paperAt)"
```

---

## Tier B — The feed spectacle pipeline

### Task 4: the `paper.fed` event (shared contract)

**Files:**
- Modify: `packages/shared/src/events.ts:8-18` (`ShowEvent`), `:22-31` (`OSC_ADDRESSES`), `:34-50` (`toOsc`)
- Test: `apps/brain/test/paper-events.test.ts` (new)

**Interfaces:**
- Produces: `ShowEvent` includes `{ type: "paper.fed"; text: string; fedAt: string }`; `toOsc` maps it to `{ address: "/channelers/paper/fed", args: [text, fedAt] }`.

- [ ] **Step 1: Write the failing test** — create `apps/brain/test/paper-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ShowEvent, toOsc } from "@channelers/shared";

describe("paper.fed event", () => {
  it("parses as a ShowEvent", () => {
    const ev = { type: "paper.fed", text: "i confess nothing", fedAt: "2026-06-22T00:00:00.000Z" };
    expect(ShowEvent.safeParse(ev).success).toBe(true);
  });

  it("flattens to its OSC address + args", () => {
    const osc = toOsc({ type: "paper.fed", text: "hello", fedAt: "2026-06-22T00:00:00.000Z" });
    expect(osc.address).toBe("/channelers/paper/fed");
    expect(osc.args).toEqual(["hello", "2026-06-22T00:00:00.000Z"]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- paper-events.test.ts`
Expected: FAIL — `paper.fed` not in the union; `toOsc` has no case (and `OSC_ADDRESSES` typecheck error).

- [ ] **Step 3: Implement** — in `packages/shared/src/events.ts`.

Add the variant to the `ShowEvent` union (after `souvenir.minted`, line 16):

```ts
  z.object({ type: z.literal("souvenir.minted"), profileId: z.string(), url: z.string() }),
  z.object({ type: z.literal("paper.fed"), text: z.string(), fedAt: z.string() }),
]);
```

Add the OSC address (in `OSC_ADDRESSES`, after `souvenir.minted`, line 30):

```ts
  "souvenir.minted": "/channelers/souvenir/minted",
  "paper.fed": "/channelers/paper/fed",
};
```

Add the `toOsc` case (in the `switch`, e.g. after the `souvenir.minted` case, line 48):

```ts
    case "souvenir.minted":
      return { address, args: [event.profileId, event.url] };
    case "paper.fed":
      return { address, args: [event.text, event.fedAt] };
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm --filter @channelers/brain test -- paper-events.test.ts` then `pnpm -r typecheck`
Expected: PASS; 0 typecheck errors (the `toOsc` switch is now exhaustive over the union).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts apps/brain/test/paper-events.test.ts
git commit -m "feat(shared): add paper.fed ShowEvent (rides WS + OSC)"
```

---

### Task 5: page OCR (`ocrPage`) with offline fallback

**Files:**
- Create: `apps/brain/src/paper.ts`
- Test: `apps/brain/test/paper.test.ts` (new)

**Interfaces:**
- Produces: `ocrPage(dataUrl: string): Promise<string | null>` — returns transcribed text when `OPENAI_API_KEY` is set, else `null` (offline fallback handled by the caller). Modeled on `tts.ts`'s keyed-else-null shape.

- [ ] **Step 1: Write the failing test** — create `apps/brain/test/paper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ocrPage } from "../src/paper";

// setup.ts forces OPENAI_API_KEY="" → ocrPage takes the offline branch and returns null.
describe("ocrPage (offline)", () => {
  it("returns null when no OpenAI key is configured", async () => {
    const out = await ocrPage("data:image/jpeg;base64,AAAA");
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- paper.test.ts`
Expected: FAIL — `Cannot find module '../src/paper'`.

- [ ] **Step 3: Implement** — create `apps/brain/src/paper.ts`:

```ts
import OpenAI from "openai";
import { config } from "./config";

const OCR_INSTRUCTION =
  "Transcribe the typed text on this page exactly as written. " +
  "Return only the transcribed text — no preamble, no commentary, no quotes. " +
  "If nothing is legible, return an empty string.";

/**
 * OCR a captured page image (a data: URL) to its text, using the configured multimodal model.
 * Returns null when OPENAI_API_KEY is unset (offline) — the caller substitutes placeholder text,
 * so the feed spectacle never blocks (project offline-resilience convention).
 * NOTE: verify the chat.completions vision message shape against the current OpenAI reference
 * (docs/CLAUDE.md) before trusting this verbatim.
 */
export async function ocrPage(dataUrl: string): Promise<string | null> {
  if (!config.openaiApiKey) return null;
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const res = await client.chat.completions.create({
    model: config.transformModel, // gpt-4o (multimodal)
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_INSTRUCTION },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  return text && text.length > 0 ? text : null;
}
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm --filter @channelers/brain test -- paper.test.ts` then `pnpm -r typecheck`
Expected: PASS; 0 typecheck errors.

> Keyed-path coverage (optional, documented not asserted here): a test may `vi.mock("../src/config", () => ({ config: { openaiApiKey: "x", transformModel: "gpt-4o" } }))` and `vi.mock("openai", …)` returning a stub `chat.completions.create`, then assert `ocrPage` returns the stub text. Keep the asserted suite on the deterministic offline branch.

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/paper.ts apps/brain/test/paper.test.ts
git commit -m "feat(brain): ocrPage gpt-4o vision OCR with offline-null fallback"
```

---

### Task 6: `POST /api/paper/feed` (capture → OCR → emit `paper.fed`)

**Files:**
- Modify: `apps/brain/src/app.ts` (import `ocrPage`; add the route near the other `/api` handlers)
- Test: `apps/brain/test/endpoints.test.ts` (append)

**Interfaces:**
- Consumes: `ocrPage` (Task 5), `bus.publish` with the `paper.fed` event (Task 4).
- Produces: `POST /api/paper/feed` with JSON body `{ image: string }` (a data: URL) → `200 { text: string, fedAt: string }`; emits `paper.fed` on the bus; `400` when `image` is missing. Offline → `text` is the placeholder.

- [ ] **Step 1: Write the failing test** — append to `apps/brain/test/endpoints.test.ts` (it already has `app`/`app.inject` in scope from the top-level `beforeAll`):

```ts
describe("paper feed", () => {
  it("feeds a page → returns text + fedAt (offline → placeholder)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/paper/feed",
      payload: { image: "data:image/jpeg;base64,AAAA" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.text).toBe("string");
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.fedAt).toBeTruthy();
  });

  it("400s a feed with no image", async () => {
    const res = await app.inject({ method: "POST", url: "/api/paper/feed", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- endpoints.test.ts`
Expected: FAIL — route 404s.

- [ ] **Step 3: Implement** — in `apps/brain/src/app.ts`.

Add the import (with the other `./` imports near line 14):

```ts
import { ocrPage } from "./paper";
```

Add the route (e.g. just after the `/api/choreo/config` block, ~line 79). The placeholder text is tunable (it's what animates when OCR is unavailable):

```ts
  // ── paper station: capture → OCR → animate (identity-agnostic spectacle, spec 2026-06-22) ──
  // Body is a data: URL (the stage grabs a webcam frame on a physical button). gpt-4o vision OCRs
  // it; on no-key/failure we emit placeholder text so the "into the matrix" animation never blocks.
  const PAPER_FALLBACK_TEXT = "⋯ the page is illegible ⋯";
  const PaperFeedBody = z.object({ image: z.string().min(1) });
  app.post("/api/paper/feed", async (req, reply) => {
    const parsed = PaperFeedBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let text: string | null = null;
    try {
      text = await ocrPage(parsed.data.image);
    } catch (err) {
      req.log.error(err); // degrade — never block the spectacle
    }
    const finalText = text && text.length > 0 ? text : PAPER_FALLBACK_TEXT;
    const fedAt = new Date().toISOString();
    bus.publish({ type: "paper.fed", text: finalText, fedAt });
    return { text: finalText, fedAt };
  });
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm --filter @channelers/brain test -- endpoints.test.ts` then `pnpm -r typecheck`
Expected: PASS; 0 typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/app.ts apps/brain/test/endpoints.test.ts
git commit -m "feat(brain): POST /api/paper/feed → OCR → emit paper.fed"
```

---

## Tier C — The `/feed` stage route

### Task 7: stage feed lib — `paperFedText` selector + `feedPaper` api + `captureDataUrl`

**Files:**
- Create: `apps/stage/src/lib/paperFeed.ts`
- Modify: `apps/stage/src/lib/api.ts` (add `feedPaper`)
- Test: `apps/stage/src/lib/paperFeed.test.ts` (new)

**Interfaces:**
- Produces: `paperFedText(m: WsServerMsg): string | null` (returns `event.text` for a `paper.fed` event, else `null`); `captureDataUrl(video: HTMLVideoElement): string | null` (grabs a JPEG data URL from a `<video>`); `api.feedPaper(image: string): Promise<{ text: string; fedAt: string }>`.

- [ ] **Step 1: Write the failing test** — create `apps/stage/src/lib/paperFeed.test.ts`:

```ts
import { expect, test } from "vitest";
import { paperFedText } from "./paperFeed";

test("returns the text for a paper.fed event", () => {
  const out = paperFedText({ kind: "event", event: { type: "paper.fed", text: "burn it", fedAt: "t" } });
  expect(out).toBe("burn it");
});

test("ignores other event types and message kinds", () => {
  expect(paperFedText({ kind: "event", event: { type: "divination.started", profileId: "p" } })).toBeNull();
  expect(paperFedText({ kind: "hello" })).toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/stage test -- paperFeed`
Expected: FAIL — `Cannot find module './paperFeed'`.

- [ ] **Step 3: Implement** — create `apps/stage/src/lib/paperFeed.ts`:

```ts
import type { WsServerMsg } from "@channelers/shared";

/** Pure selector: the fed page's text from a paper.fed event, else null. */
export function paperFedText(m: WsServerMsg): string | null {
  return m.kind === "event" && m.event.type === "paper.fed" ? m.event.text : null;
}

/** Grab a single still frame from a live <video> as a JPEG data URL. Null until the stream has dimensions. */
export function captureDataUrl(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}
```

In `apps/stage/src/lib/api.ts`, add `feedPaper` to the exported `api` object (using the existing `post<T>` helper):

```ts
  feedPaper: (image: string) => post<{ text: string; fedAt: string }>("/api/paper/feed", { image }),
```

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `pnpm --filter @channelers/stage test -- paperFeed` then `pnpm -r typecheck`
Expected: PASS; 0 typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add apps/stage/src/lib/paperFeed.ts apps/stage/src/lib/paperFeed.test.ts apps/stage/src/lib/api.ts
git commit -m "feat(stage): paperFedText selector, captureDataUrl, feedPaper api"
```

---

### Task 8: the `/feed` route (webcam + button capture + animation) and route registration

**Files:**
- Create: `apps/stage/src/routes/Feed.tsx` (exports `FeedDisplay` + default `Feed`)
- Modify: `apps/stage/src/App.tsx` (import `Feed`, add `/feed` route + `SCREENS` entry)
- Test: `apps/stage/src/routes/Feed.test.tsx` (new)

**Interfaces:**
- Consumes: `useBrainSocket` (`lib/useBrainSocket.ts`), `useDevices("videoinput", …)` (`lib/devices.ts`), `DevicePicker` (`components/DevicePicker.tsx`), `paperFedText`/`captureDataUrl` (Task 7), `api.feedPaper` (Task 7), the CRT kit (`components/CrtShell`).
- Produces: a `/feed` route. `FeedDisplay({ text, capturing, connected })` is the presentational unit (testable without webcam/WS).

- [ ] **Step 1: Write the failing test** — create `apps/stage/src/routes/Feed.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FeedDisplay } from "./Feed";

test("renders the fed text once a page is fed", () => {
  render(<FeedDisplay text="i never read the terms" capturing={false} connected />);
  expect(screen.getByText("i never read the terms")).toBeInTheDocument();
});

test("shows the idle prompt when nothing has been fed yet", () => {
  render(<FeedDisplay text={null} capturing={false} connected />);
  expect(screen.getByText(/feed a page/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/stage test -- Feed`
Expected: FAIL — `Cannot find module './Feed'`.

- [ ] **Step 3: Implement** — create `apps/stage/src/routes/Feed.tsx`. The display is presentational; the route owns webcam + button + WS.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { WsServerMsg } from "@channelers/shared";
import { useBrainSocket } from "../lib/useBrainSocket";
import { useDevices } from "../lib/devices";
import { buildVideoConstraints } from "../lib/pose/usePoseLandmarker";
import { DevicePicker } from "../components/DevicePicker";
import { api } from "../lib/api";
import { paperFedText, captureDataUrl } from "../lib/paperFeed";
import { CrtShell } from "../components/CrtShell";

/** Presentational "into the matrix" surface — the fed text dissolving, or an idle prompt. */
export function FeedDisplay({
  text, capturing, connected,
}: { text: string | null; capturing: boolean; connected: boolean }) {
  return (
    <CrtShell statusLabel="FEED">
      <div className="feed-matrix">
        {text ? (
          <p key={text} className="feed-text feed-dissolve">{text}</p>
        ) : (
          <p className="feed-idle">Feed a page to the machine.</p>
        )}
        {capturing && <p className="feed-status" aria-live="polite">capturing…</p>}
        <span className={connected ? "led on" : "led"} aria-hidden />
      </div>
    </CrtShell>
  );
}

/** The /feed station: webcam over the slot, physical button (keypress) grabs a frame → OCR → animate. */
export default function Feed() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const cam = useDevices("videoinput", "channelers.feedCam", "cam");

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    const fed = paperFedText(m);
    if (fed !== null) setText(fed);
  });

  // attach the selected camera to the <video>
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(cam.deviceId || undefined),
          audio: false,
        });
        const video = videoRef.current;
        if (!video || cancelled) return;
        (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
      } catch { /* no camera in dev / denied — idle is fine */ }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cam.deviceId]);

  const fire = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    const dataUrl = captureDataUrl(video);
    if (!dataUrl) return;
    setCapturing(true);
    try {
      await api.feedPaper(dataUrl); // text arrives back via the paper.fed WS event
    } catch { /* swallow — operator can re-press */ } finally {
      setCapturing(false);
    }
  }, [capturing]);

  // a USB arcade button / footswitch presents as a keypress (Space/Enter by default)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); void fire(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fire]);

  return (
    <div className="feed-route">
      <video ref={videoRef} className="feed-cam" playsInline muted />
      <FeedDisplay text={text} capturing={capturing} connected={connected} />
      <div className="feed-controls">
        <DevicePicker label="Camera" {...cam} />
        <button type="button" onClick={() => void fire()}>Feed (Space)</button>
      </div>
    </div>
  );
}
```

> Adjust `DevicePicker`'s prop spread to its actual signature (see `components/DevicePicker.tsx`); the `/bodyscan` + `/altar` routes show the exact prop shape `useDevices` returns. The `feed-*` CSS classes are cosmetic — minimal styling is fine for the workshop; reuse `crt.css` tokens for the dissolve.

In `apps/stage/src/App.tsx`: import the route, add to `SCREENS`, and register the path:

```tsx
import Feed from "./routes/Feed";
```
```tsx
const SCREENS = ["intake", "bodyscan", "altar", "channel", "choreo", "console", "board", "dispatch", "souvenir", "feed"] as const;
```
```tsx
<Route path="/feed" element={<Feed />} />
```

- [ ] **Step 2 (display test): Run, verify pass**

Run: `pnpm --filter @channelers/stage test -- Feed`
Expected: PASS (both `FeedDisplay` tests).

- [ ] **Step 3: Typecheck + build**

Run: `pnpm -r typecheck` then `pnpm --filter @channelers/stage build`
Expected: 0 typecheck errors; build succeeds.

- [ ] **Step 4: Manual browser smoke** (no automated webcam test)

Run `pnpm dev`; open `/feed`. Verify: the camera preview shows; pressing **Space** (or the wired button) flips to "capturing…"; with a key set, the OCR'd text animates in; with no key, the placeholder `⋯ the page is illegible ⋯` animates. Open `/dispatch` in another tab and confirm a `paper` group with 4 always-online slots; confirm-call a visitor to a paper slot and watch it auto-complete after the (shortened, for the smoke) dwell.

- [ ] **Step 5: Commit**

```bash
git add apps/stage/src/routes/Feed.tsx apps/stage/src/routes/Feed.test.tsx apps/stage/src/App.tsx
git commit -m "feat(stage): /feed route — webcam + button capture + into-the-matrix animation"
```

---

## Tier D — Operator countdown (optional polish)

> Optional for the workshop. Without it, `/dispatch` already shows each `paper` slot occupant and their `since`, so the operator can see who's at the station. This task adds a precise remaining-time readout. Skip if time is short.

### Task 9: surface dwell remaining on `/dispatch`

**Files:**
- Modify: `packages/shared/src/protocol.ts` (`DispatchState` + `timedDwellMs`)
- Modify: `apps/brain/src/dispatcher.ts` (`snapshot()` populates `timedDwellMs`)
- Modify: `apps/stage/src/routes/Dispatch.tsx` (render remaining for paper occupants)
- Test: `apps/brain/test/dispatcher.test.ts` (append)

**Interfaces:**
- Produces: `DispatchState.timedDwellMs: Partial<Record<Station, number>>`; client computes `remaining = dwellMs − (now − occupant.since)`.

- [ ] **Step 1: Write the failing test** — extend the `paper` block in `apps/brain/test/dispatcher.test.ts`:

```ts
  it("exposes the paper dwell in the snapshot for the operator countdown", () => {
    expect(pd.snapshot().timedDwellMs?.paper).toBe(300_000);
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @channelers/brain test -- dispatcher.test.ts`
Expected: FAIL — `timedDwellMs` undefined.

- [ ] **Step 3: Implement** — add to `DispatchState` in `packages/shared/src/protocol.ts`:

```ts
  /** Dwell (ms) per timed group station, so the operator board can show a remaining-time countdown. */
  timedDwellMs?: Partial<Record<Station, number>>;
```

In `apps/brain/src/dispatcher.ts` `snapshot()`, build and include it:

```ts
    const timedDwellMs: Partial<Record<Station, number>> = {};
    for (const s of STATION_ORDER) if (isTimed(s)) timedDwellMs[s] = dwellMs(s);
```
```ts
      stationsOnline,
      timedDwellMs,
      warmedUp: warmedUp(),
```

In `apps/stage/src/routes/Dispatch.tsx`, for a slot whose `station` is in `state.timedDwellMs`, render `Math.max(0, Math.ceil((dwell − (Date.now() − Date.parse(occupant.since))) / 1000))` s beside the occupant (reuse the existing 1 s tick that already drives elapsed clocks).

- [ ] **Step 4: Run tests + typecheck + build, verify pass**

Run: `pnpm --filter @channelers/brain test -- dispatcher.test.ts` && `pnpm -r typecheck` && `pnpm --filter @channelers/stage build`
Expected: PASS; 0 errors; build OK.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts apps/brain/src/dispatcher.ts apps/stage/src/routes/Dispatch.tsx apps/brain/test/dispatcher.test.ts
git commit -m "feat(dispatch): expose timed dwell + operator countdown for paper"
```

---

## Tier E — Verification & docs reconciliation

### Task 10: full verification + docs

**Files:**
- Modify: `docs/CHANGELOG.md` (new entry on top), `docs/ARCHITECTURE.md` (if any deviation), `app/CLAUDE.md` (route list + brain `paper.ts`/`paper.fed`/timed-station notes), `app/.env.example` (`PAPER_DWELL_MS`).

- [ ] **Step 1: Full test + typecheck sweep**

Run: `pnpm -r typecheck && pnpm --filter @channelers/brain test && pnpm --filter @channelers/stage test`
Expected: 0 typecheck errors; **all** brain + stage tests pass. Record the counts.

- [ ] **Step 2: Production build smoke**

Run: `pnpm -r build`
Expected: succeeds (brain + stage + shared).

- [ ] **Step 3: Update docs** — per the project's "reconcile arch docs after implementation" learning, don't just update the CHANGELOG:
  - `docs/CHANGELOG.md`: new top entry (what/why/files-areas/docs-touched + verification counts), referencing this plan and the spec.
  - `app/CLAUDE.md`: add `/feed` to the stage route list; note the dispatcher now hosts a **timed group station** kind (`paper`, always-online slots, timer-from-call completion); note `apps/brain/src/paper.ts` (`ocrPage`) and the `paper.fed` event (rides WS + OSC). Update the `config.dispatcher.slots` line to include `paper`.
  - `docs/ARCHITECTURE.md`: only if an architectural detail deviated from the spec during implementation; otherwise leave the §12 open-questions block as-is.
  - `app/.env.example`: add `PAPER_DWELL_MS` (default 300000) with a one-line comment.

- [ ] **Step 4: Commit**

```bash
git add docs/CHANGELOG.md app/CLAUDE.md docs/ARCHITECTURE.md app/.env.example
git commit -m "docs: group/timed stations + /feed — CHANGELOG, app CLAUDE, env example"
```

---

## Self-Review

**Spec coverage** (against `2026-06-22-group-stations-design.md`):
- §3 timed-group primitive → Tasks 2–3 (always-online slots, timer-from-call, timer-completion). ✅
- §4 data model (enum, `paperAt`, eligibility, config, occupancy) → Tasks 1–2. ✅
- §5 presence/completion (Confirm-call starts dwell; stays `called`; stamp on expiry) → Task 3. ✅
- §6 feed pipeline (button → capture → OCR → `paper.fed` WS+OSC → animation; offline fallback; no `visitorId`) → Tasks 4–8. ✅
- §7 shred physical-only → no code (correctly nothing to build). ✅
- §8 recovery/backstops (markComplete/repool/remove for paper) → Task 3 (`markComplete`/`milestoneField`); `repool`/`remove` already station-agnostic. ✅
- §9 knobs (capacity 4, dwell 5 min, operator-only countdown) → Task 2 config + Task 9 (countdown). ✅
- §11 file map → matches the File Structure above. ✅
- §10 typewriter / §15 open questions → no code (deferred, already in ARCHITECTURE §12). ✅

**Placeholder scan:** no "TBD"/"add error handling"/"similar to". The one tunable value (`PAPER_FALLBACK_TEXT`) is concrete with a note that it's adjustable. ✅

**Type consistency:** `milestoneField` returns `"intakeAt"|"poseAt"|"paperAt"|"sessionEndAt"` (subset of `store.stampMilestone`'s field union from Task 1) — consistent. `paper.fed = { type, text, fedAt }` is identical across Task 4 (schema), Task 6 (publish), Task 7 (`paperFedText`). `feedPaper` returns `{ text, fedAt }` matching the Task 6 route response. `timedDwellMs` shape matches between Task 9 protocol + snapshot. ✅

**Gap check:** the operator countdown (§9 "operator-only countdown visibility") is the only spec item placed in an *optional* tier; the core build (Tiers A–C) fully delivers the station and the spectacle without it, and Task 9 completes it. No spec requirement is unimplemented.
