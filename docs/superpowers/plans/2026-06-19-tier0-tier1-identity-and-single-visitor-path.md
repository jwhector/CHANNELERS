# Tier 0 + Tier 1 — Identity Core & Single-Visitor Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-path intake (oracle + Physical-Challenge chosen during the form) with a number-keyed, multi-station identity model and the end-to-end single-visitor ritual: register → intake → body-scan enroll → altar (pose-verify + persona) → channel.

**Architecture:** A human **ticket number** becomes the cross-station lookup key over an internal UUID primary key; the brain's in-memory store gains a `number → id` index, create-or-fetch registration, upsert-by-number, and durable milestone timestamps + a transient location. The body-scan persists a self-invented **pose template** (`{angles, weights}`) to the record; the altar loads it back to verify (different machine) and sets the persona; `/channel` (renamed from `/station`) lists only altar-cleared visitors. This plan is **Tiers 0–1** of the spec; the dispatcher/board/console (Tier 3) and choreography (Tier 2) are deliberately out of scope.

**Tech Stack:** TypeScript, pnpm workspace; brain = Fastify + `ws` + `@anthropic-ai/sdk`; stage = Vite + React + react-router-dom; shared = zod. Pose CV = `@mediapipe/tasks-vision` (in-browser). New: **vitest** (brain package only).

**Spec:** `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` (read §3 identity/state, §5 body-scan, §6 persona, §13 gotchas).

## Global Constraints

- **Verification split (read this — it governs every task's test step):** brain logic/endpoints use **vitest** (unit + Fastify `app.inject()`); stage UI uses **`pnpm -r typecheck` + `pnpm --filter @channelers/stage build` + a written manual browser smoke test**. Do not invent React component tests — no harness exists.
- **Typecheck gate:** every task ends green on `pnpm -r typecheck` (0 errors across all packages). This is the project's primary correctness signal — never skip it.
- **Offline-resilient:** the brain runs with **no `ANTHROPIC_API_KEY`** (stub seeds, offline oracle fallback). Nothing in this plan may require a key to run or test.
- **Number = plain integer**, globally unique within a running brain process; internal UUID stays the primary key. The store wipes on restart (in-memory) — acceptable.
- **Models (don't hardcode):** `config.transformModel` (`claude-opus-4-8`), `config.oracleModel` (`claude-sonnet-4-6`). Untouched by this plan.
- **Commit after every task.** Conventional-commit messages. End each commit message with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Out of scope (do NOT build here):** the dispatcher, `/board`, `/dispatch`, `/waiting`, the `/console` overhaul, choreography, the `location.state === "called"` flow. Tier 1 only ever sets location to `waiting`/`in_progress`; the rich queue logic is Tier 3.

---

## File Structure

**Shared (`packages/shared/src/`)**
- `schemas.ts` — **modify**: add `PoseVector`, `VisitorLocation`; extend `VisitorProfile` (number, optional survey, archetype, poseTemplate, location, milestone timestamps); drop `archetype` from `SurveyResponse`.
- `survey.ts` — **modify**: delete the two `scan` fields + the `oracle` field and their `SurveyField` kinds.

**Brain (`apps/brain/src/`)**
- `store.ts` — **rewrite**: number index + register/getByNumber/upsertSurvey/setPoseTemplate/setArchetype/setPoseVerified/setLocation/session stamps.
- `index.ts` — **modify**: new endpoints (register, intake-by-id, pose, persona, verify, by-number); repoint the music-seed transform to intake.
- `transform.ts` — **modify**: guard for optional survey.
- `divination.ts` — **modify**: read top-level `archetype`; guard missing survey; stamp `sessionStartAt`/`sessionEndAt`.
- `vitest.config.ts` — **create**. `package.json` — **modify** (vitest dep + `test` script).
- `test/` — **create**: `store.test.ts`, `schema.test.ts`, `endpoints.test.ts`.

**Stage (`apps/stage/src/`)**
- `lib/api.ts` — **modify**: register, submitIntake, enrollPose, setPersona, verifyPose, getByNumber.
- `lib/useNumberGate.ts` — **create**: the shared "enter your number" gate.
- `routes/Intake.tsx` — **modify**: number gate, drop scan/oracle UI, post-submit "physical challenge" message.
- `routes/BodyScan.tsx` — **rename** from `Scan.tsx`: number gate, enroll, POST template.
- `routes/Altar.tsx` — **create**: number gate, pose-verify, persona buttons.
- `routes/Channel.tsx` — **rename** from `Station.tsx`: oracleReady lobby, remove debug `fetch`, archetype from record.
- `App.tsx` — **modify**: routes `/intake /bodyscan /altar /channel /console /souvenir`.

---

# TIER 0 — Identity & state core

## Task 0.1: Vitest harness in the brain package

**Files:**
- Modify: `apps/brain/package.json`
- Create: `apps/brain/vitest.config.ts`
- Create: `apps/brain/test/smoke.test.ts`

**Interfaces:**
- Produces: a working `pnpm --filter @channelers/brain test` command for all later brain tasks.

- [ ] **Step 1: Add vitest + test script.** Edit `apps/brain/package.json` — add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`; add to `devDependencies`: `"vitest": "^2.1.8"`. Then run:

```bash
cd /Users/jared/Documents/Projects/CHANNELERS/app && pnpm install
```

Expected: installs vitest, lockfile updates.

- [ ] **Step 2: Create `apps/brain/vitest.config.ts`:**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Write the smoke test** `apps/brain/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run it.**

```bash
pnpm --filter @channelers/brain test
```

Expected: PASS, 1 test.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/package.json apps/brain/vitest.config.ts apps/brain/test/smoke.test.ts pnpm-lock.yaml
git commit -m "test(brain): add vitest harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 0.2: Shared schema — PoseVector, location, extended VisitorProfile

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Create: `apps/brain/test/schema.test.ts`

**Interfaces:**
- Produces:
  - `PoseVector = { angles: number[]; weights: number[] }` (zod `PoseVector`)
  - `VisitorLocation = { state: "waiting"|"called"|"in_progress"; station?: "intake"|"bodyscan"|"altar"; since: string }`
  - `VisitorProfile` now: `{ id, number, survey?, archetype?, poseTemplate?, scans, location, createdAt, intakeAt?, poseAt?, personaAt?, poseVerifiedAt?, sessionStartAt?, sessionEndAt? }`
  - `SurveyResponse` no longer has `archetype`.

- [ ] **Step 1: Write the failing test** `apps/brain/test/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VisitorProfile, PoseVector, SurveyResponse } from "@channelers/shared";

describe("schema: PoseVector", () => {
  it("accepts an angle/weight vector", () => {
    expect(PoseVector.safeParse({ angles: [0.1, 0.2], weights: [1, 0.5] }).success).toBe(true);
  });
});

describe("schema: VisitorProfile", () => {
  it("accepts a freshly-registered record (number, no survey yet)", () => {
    const r = VisitorProfile.safeParse({
      id: "u1",
      number: 42,
      scans: [],
      location: { state: "waiting", since: "2026-06-19T00:00:00.000Z" },
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a fully-progressed record", () => {
    const r = VisitorProfile.safeParse({
      id: "u1", number: 42, scans: [],
      survey: { name: "Jo", freeText: {}, phrases: [] },
      archetype: "tree",
      poseTemplate: { angles: [0], weights: [1] },
      location: { state: "in_progress", station: "altar", since: "2026-06-19T00:00:00.000Z" },
      createdAt: "2026-06-19T00:00:00.000Z",
      intakeAt: "2026-06-19T00:01:00.000Z",
      poseAt: "2026-06-19T00:02:00.000Z",
      personaAt: "2026-06-19T00:03:00.000Z",
      poseVerifiedAt: "2026-06-19T00:04:00.000Z",
    });
    expect(r.success).toBe(true);
  });
});

describe("schema: SurveyResponse", () => {
  it("no longer carries archetype as a known field", () => {
    // archetype moved to the top-level record; survey is intake answers only.
    const r = SurveyResponse.safeParse({ name: "Jo", freeText: {}, phrases: [] });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/schema.test.ts
```

Expected: FAIL — `PoseVector` is not an export; `VisitorProfile` rejects `number`/`location`.

- [ ] **Step 3: Edit `packages/shared/src/schemas.ts`.** Remove `archetype` from `SurveyResponse`:

```ts
export const SurveyResponse = z.object({
  name: z.string().min(1),
  freeText: z.record(z.string(), z.string()),
  phrases: z.array(VibePhrase),
});
export type SurveyResponse = z.infer<typeof SurveyResponse>;
```

Add after the `ScanResult` block (keep `PoseScan`/`FiducialScan`/`ScanResult` as legacy — unchanged):

```ts
/** A pose reduced to one interior angle per measured joint + a per-joint trust weight.
 *  This is the persisted body-scan "identity token" (see spec §5). Mirrors the stage's
 *  PoseVector in apps/stage/src/lib/pose/angles.ts — keep the two in sync. */
export const PoseVector = z.object({
  angles: z.array(z.number()),
  weights: z.array(z.number()),
});
export type PoseVector = z.infer<typeof PoseVector>;

/** Transient dispatch location — a visitor is in exactly one place at a time (spec §3.2).
 *  Tier 1 only ever uses "waiting"/"in_progress"; "called" is Tier 3 (the dispatcher). */
export const VisitorLocation = z.object({
  state: z.enum(["waiting", "called", "in_progress"]),
  station: z.enum(["intake", "bodyscan", "altar"]).optional(),
  since: z.string(),
});
export type VisitorLocation = z.infer<typeof VisitorLocation>;
```

Replace the `VisitorProfile` definition with:

```ts
export const VisitorProfile = z.object({
  id: z.string(),
  /** Human ticket number — the cross-station lookup key (spec §3.1). */
  number: z.number().int(),
  /** Present once intake is completed; absent for a just-registered visitor. */
  survey: SurveyResponse.optional(),
  /** Oracle archetype, chosen at the altar (spec §6) — NOT during intake. */
  archetype: z.string().optional(),
  /** Self-invented pose template, enrolled at the body-scan station (spec §5). */
  poseTemplate: PoseVector.optional(),
  /** Legacy scan results (unused by the new flow; kept for back-compat). */
  scans: z.array(ScanResult),
  location: VisitorLocation,
  /** Milestone timestamps (ISO). Present = that milestone is done (spec §3.2). */
  createdAt: z.string(), // = registeredAt
  intakeAt: z.string().optional(),
  poseAt: z.string().optional(),
  personaAt: z.string().optional(),
  poseVerifiedAt: z.string().optional(),
  sessionStartAt: z.string().optional(),
  sessionEndAt: z.string().optional(),
});
export type VisitorProfile = z.infer<typeof VisitorProfile>;
```

- [ ] **Step 4: Run the test + typecheck.**

```bash
pnpm --filter @channelers/brain test test/schema.test.ts && pnpm -r typecheck
```

Expected: schema test PASSES. Typecheck will now FAIL elsewhere (store.ts, index.ts, divination.ts, Intake.tsx still use the old shape) — **that is expected**; those are fixed in the tasks below. Confirm the *only* failures are pre-existing references to `survey.archetype`, `store.create`, and missing `number`/`location` — not new schema errors.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/schemas.ts apps/brain/test/schema.test.ts
git commit -m "feat(shared): number-keyed VisitorProfile with pose template + location state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 0.3: Store — number index, registration, upsert, state helpers

**Files:**
- Modify: `apps/brain/src/store.ts`
- Create: `apps/brain/test/store.test.ts`

**Interfaces:**
- Consumes: `VisitorProfile`, `SurveyResponse`, `PoseVector`, `Seeds`, `VisitorLocation` from `@channelers/shared`.
- Produces (the `store` object):
  - `register(number: number): VisitorRecord` — create-or-fetch by number; new records start `location={state:"waiting",since}`, `createdAt=now`, `scans:[]`.
  - `get(id: string): VisitorRecord | undefined`
  - `getByNumber(number: number): VisitorRecord | undefined`
  - `list(): VisitorRecord[]`
  - `upsertSurvey(id: string, survey: SurveyResponse): VisitorRecord | undefined` — sets `survey`, `intakeAt=now`.
  - `setPoseTemplate(id: string, template: PoseVector): VisitorRecord | undefined` — sets `poseTemplate`, `poseAt=now`.
  - `setArchetype(id: string, archetype: string): VisitorRecord | undefined` — sets `archetype`, `personaAt=now`.
  - `setPoseVerified(id: string): VisitorRecord | undefined` — sets `poseVerifiedAt=now`.
  - `setLocation(id: string, location: VisitorLocation): VisitorRecord | undefined`
  - `markSessionStart(id: string)` / `markSessionEnd(id: string)` — stamp `sessionStartAt`/`sessionEndAt`.
  - `setSeeds(id, seeds)` — unchanged.

- [ ] **Step 1: Write the failing test** `apps/brain/test/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/store";

const NUM = () => Math.floor(Math.random() * 1e9); // unique per test (store is process-global)

describe("store registration (born on first touch by number)", () => {
  it("creates a waiting record with a uuid and the given number", () => {
    const n = NUM();
    const r = store.register(n);
    expect(r.number).toBe(n);
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.location).toEqual(expect.objectContaining({ state: "waiting" }));
    expect(r.survey).toBeUndefined();
    expect(r.createdAt).toBeTruthy();
  });

  it("is idempotent: re-registering the same number returns the same record", () => {
    const n = NUM();
    const a = store.register(n);
    const b = store.register(n);
    expect(b.id).toBe(a.id);
    expect(store.getByNumber(n)?.id).toBe(a.id);
  });
});

describe("store upserts attach to the record by id", () => {
  it("upsertSurvey sets survey + intakeAt", () => {
    const r = store.register(NUM());
    const out = store.upsertSurvey(r.id, { name: "Jo", freeText: {}, phrases: [] });
    expect(out?.survey?.name).toBe("Jo");
    expect(out?.intakeAt).toBeTruthy();
  });

  it("setPoseTemplate sets poseTemplate + poseAt", () => {
    const r = store.register(NUM());
    const out = store.setPoseTemplate(r.id, { angles: [0.1], weights: [1] });
    expect(out?.poseTemplate?.angles).toEqual([0.1]);
    expect(out?.poseAt).toBeTruthy();
  });

  it("setArchetype sets archetype + personaAt; setPoseVerified sets poseVerifiedAt", () => {
    const r = store.register(NUM());
    expect(store.setArchetype(r.id, "tree")?.archetype).toBe("tree");
    expect(store.get(r.id)?.personaAt).toBeTruthy();
    expect(store.setPoseVerified(r.id)?.poseVerifiedAt).toBeTruthy();
  });

  it("returns undefined for unknown ids", () => {
    expect(store.upsertSurvey("nope", { name: "x", freeText: {}, phrases: [] })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

```bash
pnpm --filter @channelers/brain test test/store.test.ts
```

Expected: FAIL — `store.register` is not a function.

- [ ] **Step 3: Rewrite `apps/brain/src/store.ts`:**

```ts
import { randomUUID } from "node:crypto";
import type {
  SurveyResponse, VisitorProfile, ScanResult, Seeds, PoseVector, VisitorLocation,
} from "@channelers/shared";

/** In-memory store — fine for the workshop. Swap for SQLite/Postgres if persistence is needed. */
export type VisitorRecord = VisitorProfile & { seeds?: Seeds };

const visitors = new Map<string, VisitorRecord>();
const byNumber = new Map<number, string>(); // number → id index

const now = () => new Date().toISOString();

export const store = {
  /** Create-or-fetch by ticket number. New records are born "waiting" with no survey (spec §3.1). */
  register(number: number): VisitorRecord {
    const existingId = byNumber.get(number);
    if (existingId) {
      const existing = visitors.get(existingId);
      if (existing) return existing;
    }
    const ts = now();
    const record: VisitorRecord = {
      id: randomUUID(),
      number,
      scans: [],
      location: { state: "waiting", since: ts },
      createdAt: ts,
    };
    visitors.set(record.id, record);
    byNumber.set(number, record.id);
    return record;
  },
  get(id: string): VisitorRecord | undefined {
    return visitors.get(id);
  },
  getByNumber(number: number): VisitorRecord | undefined {
    const id = byNumber.get(number);
    return id ? visitors.get(id) : undefined;
  },
  list(): VisitorRecord[] {
    return [...visitors.values()];
  },
  upsertSurvey(id: string, survey: SurveyResponse): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.survey = survey;
    v.intakeAt = now();
    return v;
  },
  setPoseTemplate(id: string, template: PoseVector): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.poseTemplate = template;
    v.poseAt = now();
    return v;
  },
  setArchetype(id: string, archetype: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.archetype = archetype;
    v.personaAt = now();
    return v;
  },
  setPoseVerified(id: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.poseVerifiedAt = now();
    return v;
  },
  setLocation(id: string, location: VisitorLocation): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.location = location;
    return v;
  },
  markSessionStart(id: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.sessionStartAt = now();
    v.sessionEndAt = undefined;
    return v;
  },
  markSessionEnd(id: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.sessionEndAt = now();
    return v;
  },
  setSeeds(id: string, seeds: Seeds): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (v) v.seeds = seeds;
    return v;
  },
};
```

- [ ] **Step 4: Run the test.**

```bash
pnpm --filter @channelers/brain test test/store.test.ts
```

Expected: PASS, all store tests.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/src/store.ts apps/brain/test/store.test.ts
git commit -m "feat(brain): number-indexed store with registration, upsert, and state stamps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 0.4: Brain endpoints — register, intake, pose, persona, verify

**Files:**
- Modify: `apps/brain/src/index.ts`
- Modify: `apps/brain/src/transform.ts` (guard optional survey)
- Create: `apps/brain/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `store` (Task 0.3), `transform` (modified here).
- Produces (HTTP):
  - `POST /api/register { number }` → `200` VisitorRecord (create-or-fetch).
  - `GET /api/visitors/by-number/:number` → `200` record | `404`.
  - `POST /api/visitors/:id/intake { survey }` → `200` record; sets survey + fires music-seed transform fire-and-forget; emits `visitor.submitted` + (async) `seeds.ready`.
  - `POST /api/visitors/:id/pose { template }` → `200` record.
  - `POST /api/visitors/:id/persona { archetype }` → `200` record; emits `oracle.selected`.
  - `POST /api/visitors/:id/verify` → `200` record (sets `poseVerifiedAt`; doubles as manual unlock).
  - `GET /api/visitors` → list (unchanged).
  - Legacy `POST /api/visitors` (full-survey create) is **removed**; `POST /api/visitors/:id/scan` and `/seeds` stay.

- [ ] **Step 1: Guard `transform.ts` for optional survey.** In `apps/brain/src/transform.ts`, change `stubSeeds` and `transform` to tolerate a possibly-absent survey. Replace the top of `stubSeeds`:

```ts
function stubSeeds(profile: VisitorProfile): Seeds {
  const lost = profile.survey?.freeText.lost ?? "something nameless";
```

And in `transform`, guard at the very top of the function body (after the `if (!config.anthropicApiKey)` line stays as-is):

```ts
export async function transform(profile: VisitorProfile): Promise<Seeds> {
  if (!profile.survey) return stubSeeds(profile); // nothing to transform pre-intake
  if (!config.anthropicApiKey) return stubSeeds(profile);
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    // ...unchanged...
    messages: [{ role: "user", content: JSON.stringify(profile.survey) }],
```

(Everything else in `transform.ts` is unchanged. The `JSON.stringify(profile.survey)` line already existed — it is now guarded above.)

- [ ] **Step 2: Write the failing test** `apps/brain/test/endpoints.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

async function register(n: number) {
  const res = await app.inject({ method: "POST", url: "/api/register", payload: { number: n } });
  return res.json() as any;
}

describe("registration + lookup", () => {
  it("registers by number and is idempotent", async () => {
    const a = await register(101);
    const b = await register(101);
    expect(a.number).toBe(101);
    expect(b.id).toBe(a.id);
  });

  it("looks a visitor up by number", async () => {
    await register(102);
    const res = await app.inject({ method: "GET", url: "/api/visitors/by-number/102" });
    expect(res.statusCode).toBe(200);
    expect(res.json().number).toBe(102);
  });

  it("404s an unknown number", async () => {
    const res = await app.inject({ method: "GET", url: "/api/visitors/by-number/999999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("station upserts attach to the record", () => {
  it("intake → pose → persona → verify progress the milestones", async () => {
    const v = await register(200);
    const intake = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "Jo", freeText: {}, phrases: [] } } });
    expect(intake.json().survey.name).toBe("Jo");
    expect(intake.json().intakeAt).toBeTruthy();

    const pose = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/pose`,
      payload: { template: { angles: [0.1, 0.2], weights: [1, 1] } } });
    expect(pose.json().poseTemplate.angles).toEqual([0.1, 0.2]);

    const persona = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`,
      payload: { archetype: "tree" } });
    expect(persona.json().archetype).toBe("tree");
    expect(persona.json().personaAt).toBeTruthy();

    const verify = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/verify` });
    expect(verify.json().poseVerifiedAt).toBeTruthy();
  });

  it("404s a station write to an unknown id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/visitors/nope/pose",
      payload: { template: { angles: [], weights: [] } } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Extract an injectable app factory.** Create `apps/brain/src/app.ts` so tests can `inject` without binding a port. Move the Fastify construction out of `index.ts` into a `buildApp()` that returns the configured instance (registers cors, multipart, the content-type parser, the `Bus`, divination, and all routes) **without** calling `listen`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { SurveyResponse, ScanResult, PoseVector, type ShowEvent } from "@channelers/shared";
import { z } from "zod";
import { store } from "./store";
import { Bus } from "./bus";
import { transform } from "./transform";
import { registerDivination } from "./divination";
import { transcribeWav } from "./stt";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    done(null, body && body.length > 0 ? body : undefined);
  });

  const bus = new Bus(app.server);
  registerDivination(bus);

  app.get("/api/health", async () => ({ ok: true, at: new Date().toISOString() }));

  app.post("/api/stt", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "missing audio" });
    const wav = await file.toBuffer();
    if (!wav.length) return reply.code(400).send({ error: "empty audio" });
    try {
      return { text: await transcribeWav(wav) };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: "transcription failed" });
    }
  });

  app.get("/api/visitors", async () => store.list());

  // ── identity: register by number (create-or-fetch) + lookup ──
  const RegisterBody = z.object({ number: z.number().int() });
  app.post("/api/register", async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return store.register(parsed.data.number);
  });

  app.get("/api/visitors/by-number/:number", async (req, reply) => {
    const { number } = req.params as { number: string };
    const v = store.getByNumber(Number(number));
    if (!v) return reply.code(404).send({ error: "unknown number" });
    return v;
  });

  // ── intake: attach survey to a registered record, fire the music seed ──
  const IntakeBody = z.object({ survey: SurveyResponse });
  app.post("/api/visitors/:id/intake", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = IntakeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.upsertSurvey(id, parsed.data.survey);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    bus.publish({ type: "visitor.submitted", profileId: v.id });
    void transform(v).then((seeds) => {
      store.setSeeds(v.id, seeds);
      bus.publish({ type: "seeds.ready", profileId: v.id });
    });
    return v;
  });

  // ── body-scan: persist the enrolled pose template ──
  const PoseBody = z.object({ template: PoseVector });
  app.post("/api/visitors/:id/pose", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PoseBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.setPoseTemplate(id, parsed.data.template);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    return v;
  });

  // ── altar: set persona (the swappable seam, spec §6) ──
  const PersonaBody = z.object({ archetype: z.string() });
  app.post("/api/visitors/:id/persona", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PersonaBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.setArchetype(id, parsed.data.archetype);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    bus.publish({ type: "oracle.selected", profileId: v.id, archetype: parsed.data.archetype });
    return v;
  });

  // ── altar: record a successful pose verify (also the manual-unlock path) ──
  app.post("/api/visitors/:id/verify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = store.setPoseVerified(id);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    return v;
  });

  // legacy scan + manual seeds regeneration (kept)
  app.post("/api/visitors/:id/scan", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ScanResult.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const v = store.addScan(id, parsed.data);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    bus.publish(
      parsed.data.kind === "pose"
        ? { type: "scan.pose", archetypeGuess: parsed.data.archetypeGuess, confidence: parsed.data.confidence }
        : { type: "scan.fiducial", cards: parsed.data.cards.map((c) => c.id) },
    );
    return v;
  });

  app.post("/api/visitors/:id/seeds", async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = store.get(id);
    if (!v) return reply.code(404).send({ error: "unknown visitor" });
    const seeds = await transform(v);
    store.setSeeds(id, seeds);
    bus.publish({ type: "seeds.ready", profileId: id });
    return seeds;
  });

  app.post("/api/demo/echo", async () => {
    const samples: ShowEvent[] = [
      { type: "visitor.submitted", profileId: "demo" },
      { type: "scan.pose", archetypeGuess: "heron", confidence: 0.82 },
      { type: "scan.fiducial", cards: [3, 1, 4] },
      { type: "seeds.ready", profileId: "demo" },
      { type: "oracle.selected", profileId: "demo", archetype: "tree" },
      { type: "divination.started", profileId: "demo" },
      { type: "divination.ended", profileId: "demo" },
      { type: "souvenir.minted", profileId: "demo", url: "https://example.com/s/demo" },
    ];
    for (const e of samples) bus.publish(e);
    return { published: samples.length };
  });

  return app;
}
```

> **Note:** `store.addScan` is referenced by the legacy `/scan` route above. It exists in the current store; **preserve it** when rewriting `store.ts` in Task 0.3 (add it back — the Task 0.3 listing omits it for brevity; copy the original `addScan` method in verbatim).

- [ ] **Step 4: Slim `index.ts` to just boot the app:**

```ts
import { buildApp } from "./app";
import { config } from "./config";

const app = await buildApp();
await app.listen({ host: config.host, port: config.port });
console.log(`[brain] http://${config.host}:${config.port}  •  ws://${config.host}:${config.port}/ws`);
```

- [ ] **Step 5: Run endpoint tests + typecheck.**

```bash
pnpm --filter @channelers/brain test test/endpoints.test.ts && pnpm -r typecheck
```

Expected: endpoint tests PASS. Typecheck still fails only in `divination.ts` (reads `survey.archetype`) and stage files — fixed in Task 0.5 and Tier 1.

- [ ] **Step 6: Commit.**

```bash
git add apps/brain/src/app.ts apps/brain/src/index.ts apps/brain/src/transform.ts apps/brain/test/endpoints.test.ts
git commit -m "feat(brain): station endpoints (register/intake/pose/persona/verify) on an injectable app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 0.5: Divination — archetype from record, guard missing survey, stamp session

**Files:**
- Modify: `apps/brain/src/divination.ts`
- Modify: `packages/oracles/src/buildPrompt.ts` (accept survey-bearing profile safely)
- Add test to: `apps/brain/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `store.markSessionStart/markSessionEnd` (Task 0.3), `buildPersona` (modified).
- Produces: `session.start` now reads `visitor.archetype` (top-level) and refuses visitors with no `survey`/`archetype`; the record's `sessionStartAt`/`sessionEndAt` are stamped.

- [ ] **Step 1: Make `buildPersona` survey-safe.** In `packages/oracles/src/buildPrompt.ts`, `buildSystemPrompt` reads `profile.survey.*`, but `survey` is now optional. Change `buildPersona` to guard and pass a concrete survey down:

```ts
import type { VisitorProfile, SurveyResponse, OraclePersona } from "@channelers/shared";
import { PERSONAS, type Persona } from "./personas";
import { ANTI_SLOP_INSTRUCTION } from "./denylist";

export function buildSystemPrompt(persona: Persona, survey: SurveyResponse): string {
  const facts = [
    `Name: ${survey.name}`,
    ...Object.entries(survey.freeText).map(([k, v]) => `${k}: ${v}`),
    ...survey.phrases.map((p) => `${p.axis}: ${p.choice}`),
  ].join("\n");

  return [
    `You are ${persona.name}. ${persona.concept}`,
    ``,
    `VOICE:`,
    ...persona.style.map((s) => `- ${s}`),
    ``,
    `Speak only in this voice. Examples of how you sound:`,
    ...persona.fewShot.map((s) => `  "${s}"`),
    ``,
    ANTI_SLOP_INSTRUCTION,
    ``,
    `You are giving a divination to this visitor, drawn from their intake:`,
    facts,
    ``,
    `Keep replies to one to three sentences. This is spoken aloud and channelled by a performer.`,
  ].join("\n");
}

export function buildPersona(personaId: string, profile: VisitorProfile): OraclePersona {
  const persona = PERSONAS[personaId];
  if (!persona) throw new Error(`unknown persona: ${personaId}`);
  if (!profile.survey) throw new Error("visitor has no intake survey");
  return {
    archetype: persona.id,
    systemPrompt: buildSystemPrompt(persona, profile.survey),
    openingLine: persona.opening,
  };
}
```

- [ ] **Step 2: Update `divination.ts` `start()`.** Replace the archetype lookup + add guards + session stamping. Find the block at [divination.ts:103-149](apps/brain/src/divination.ts#L103-L149) and change the archetype source and add a survey/archetype guard:

```ts
  function start(visitorId: string, reply: ReplyFn, connId: string): void {
    const visitor = store.get(visitorId);
    if (!visitor) {
      reply({ kind: "session.error", visitorId, message: "unknown visitor" });
      return;
    }
    if (!visitor.survey) {
      reply({ kind: "session.error", visitorId, message: "visitor has not completed intake" });
      return;
    }
    if (!visitor.archetype) {
      reply({ kind: "session.error", visitorId, message: "no oracle selected yet" });
      return;
    }

    const already = [...sessions.values()].find((s) => s.visitorId === visitorId);
    if (already) {
      reply({ kind: "session.error", visitorId, message: "visitor already in a divination" });
      return;
    }

    const archetypeId = visitor.archetype;
    let persona: OraclePersona;
    try {
      persona = buildPersona(archetypeId, visitor);
    } catch {
      reply({ kind: "session.error", visitorId, message: `unknown archetype: ${archetypeId}` });
      return;
    }

    const session: Session = {
      id: randomUUID(),
      visitorId,
      visitorName: visitor.survey.name,
      archetype: archetypeId,
      persona,
      history: [],
      ownerConn: connId,
    };
    sessions.set(session.id, session);
    store.markSessionStart(visitorId);

    bus.publish({ type: "oracle.selected", profileId: visitorId, archetype: archetypeId });
    bus.publish({ type: "divination.started", profileId: visitorId });
    bus.broadcast({
      kind: "session.started",
      sessionId: session.id,
      visitorId,
      visitorName: session.visitorName,
      archetype: archetypeId,
      opening: persona.openingLine,
    });
    bus.broadcast(rosterMsg());
  }
```

Remove the now-unused `ARCHETYPES` import if TS flags it (it was the fallback source). In `reap()`, add `store.markSessionEnd(session.visitorId);` right after `sessions.delete(sessionId);`.

- [ ] **Step 3: Add a guard test** to `apps/brain/test/endpoints.test.ts` — a visitor with no archetype can't be channelled. Append:

```ts
import { registerDivination } from "../src/divination";
// (registerDivination is already wired inside buildApp; this test exercises the record guard via HTTP state.)

describe("divination guards", () => {
  it("a registered-but-unprepared visitor is not oracle-ready", async () => {
    const v = await register(300);
    // No intake, no persona, no verify → derived oracleReady must be false.
    const ready = !!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt;
    expect(ready).toBe(false);
  });
});
```

- [ ] **Step 4: Run brain tests + full typecheck.**

```bash
pnpm --filter @channelers/brain test && pnpm -r typecheck
```

Expected: all brain tests PASS. Typecheck now fails **only** in stage files (Intake/Scan/Station/App) — addressed in Tier 1. Confirm no brain/shared/oracles errors remain.

- [ ] **Step 5: Commit.**

```bash
git add apps/brain/src/divination.ts packages/oracles/src/buildPrompt.ts apps/brain/test/endpoints.test.ts
git commit -m "feat(brain): channel by record archetype; guard intake/persona; stamp session state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# TIER 1 — Single-visitor critical path

> Stage tasks verify with **`pnpm -r typecheck`** + **`pnpm --filter @channelers/stage build`** + the **manual browser smoke** written in each task. Run the brain with `pnpm --filter @channelers/brain dev` (port 8787) and stage with `pnpm --filter @channelers/stage dev` (port 5173) — or `pnpm dev` for both. No API key needed.

## Task 1.1: Stage API client + the shared number gate

**Files:**
- Modify: `apps/stage/src/lib/api.ts`
- Create: `apps/stage/src/components/NumberGate.tsx`

**Interfaces:**
- Produces (`api`): `register(number)`, `getByNumber(number)`, `submitIntake(id, survey)`, `enrollPose(id, template)`, `setPersona(id, archetype)`, `verifyPose(id)` — all `Promise<VisitorProfile>`; keep `listVisitors`.
- Produces: `<NumberGate title onResolved={(v: VisitorProfile) => void} />` — renders "enter your number", calls `api.register`, hands the resolved record up.

- [ ] **Step 1: Rewrite `apps/stage/src/lib/api.ts`:**

```ts
import type { SurveyResponse, VisitorProfile, PoseVector } from "@channelers/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const post = <T>(url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<T>(r));

export const api = {
  listVisitors: () => fetch("/api/visitors").then((r) => json<VisitorProfile[]>(r)),
  register: (number: number) => post<VisitorProfile>("/api/register", { number }),
  getByNumber: (number: number) =>
    fetch(`/api/visitors/by-number/${number}`).then((r) => json<VisitorProfile>(r)),
  submitIntake: (id: string, survey: SurveyResponse) =>
    post<VisitorProfile>(`/api/visitors/${id}/intake`, { survey }),
  enrollPose: (id: string, template: PoseVector) =>
    post<VisitorProfile>(`/api/visitors/${id}/pose`, { template }),
  setPersona: (id: string, archetype: string) =>
    post<VisitorProfile>(`/api/visitors/${id}/persona`, { archetype }),
  verifyPose: (id: string) => post<VisitorProfile>(`/api/visitors/${id}/verify`),
};
```

- [ ] **Step 2: Create `apps/stage/src/components/NumberGate.tsx`:**

```tsx
import { useState } from "react";
import type { VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";

/** The shared "enter your number" gate. Registers (create-or-fetch) and hands the
 *  resolved record up. Used by /intake, /bodyscan, and /altar (spec §3–§4). */
export function NumberGate({
  title,
  onResolved,
}: {
  title: string;
  onResolved: (visitor: VisitorProfile) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Enter the number on your ticket.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onResolved(await api.register(n));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="void form">
      <h1>{title}</h1>
      <section className="field">
        <label>Enter your number</label>
        <input
          inputMode="numeric"
          autoFocus
          value={value}
          placeholder="000"
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
        />
      </section>
      {error && <p className="error">{error}</p>}
      <button className="submit" onClick={() => void go()} disabled={busy || !value}>
        {busy ? "…" : "Continue"}
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Verify typecheck + build.**

```bash
cd /Users/jared/Documents/Projects/CHANNELERS/app && pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS (additive — old `Intake.tsx`/`Scan.tsx` still compile against the unchanged exports they use). `submitSurvey`/`generateSeeds` were removed from `api` — if typecheck flags `Intake.tsx` using `api.submitSurvey`, that's expected and fixed in Task 1.2; if so, proceed (do not re-add the old method).

- [ ] **Step 4: Commit.**

```bash
git add apps/stage/src/lib/api.ts apps/stage/src/components/NumberGate.tsx
git commit -m "feat(stage): station API client + shared NumberGate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.2: Survey trim + Intake rework (number gate, no scan/oracle, post-submit message)

**Files:**
- Modify: `packages/shared/src/survey.ts`
- Modify: `apps/stage/src/routes/Intake.tsx`

**Interfaces:**
- Consumes: `NumberGate`, `api.submitIntake` (Task 1.1).
- Produces: `/intake` = number gate → form (text/longtext/phrase only) → "proceed to physical challenge" message.

- [ ] **Step 1: Trim `packages/shared/src/survey.ts`** — delete the two `scan` fields, the `oracle` field, and their `SurveyField` kinds:

```ts
import type { VibeAxis } from "./schemas";

/** The intake survey, transcribed from docs/intake.md — content the team keeps editing.
 *  Drives /intake directly (one source of truth). Scan stations and oracle choice are
 *  no longer part of the form (spec §3–§6). */
export type SurveyField =
  | { kind: "text"; id: string; label: string; placeholder?: string }
  | { kind: "longtext"; id: string; label: string; placeholder?: string }
  | { kind: "phrase"; axis: VibeAxis; label: string; options: string[] };

export const SURVEY: SurveyField[] = [
  { kind: "text", id: "name", label: "Name" },
  { kind: "longtext", id: "tender", label: "Do you consider yourself tender? Describe below:" },
  { kind: "text", id: "shoeSize", label: "What is your shoe size?" },
  { kind: "longtext", id: "lost", label: "Describe something you recently lost" },
  { kind: "text", id: "ssn", label: "Provide your social security number", placeholder: "###-##-####" },
  {
    kind: "phrase", axis: "vulnerability",
    label: "Choose one phrase that describes a close relationship you are in — State of vulnerability",
    options: ["Basement Riser", "Moody Sky", "Artistic Facts"],
  },
  {
    kind: "phrase", axis: "tension",
    label: "Choose a secondary phrase for the same relationship — State of Tension",
    options: ["Hard Times", "Legendary Emulation", "Sync Wheel"],
  },
  {
    kind: "phrase", axis: "hopefulness",
    label: "Choose a tertiary phrase for the same relationship — State of hopefulness",
    options: ["Heavenly Sky", "Night Drive", "Underwater"],
  },
];
```

- [ ] **Step 2: Rewrite `apps/stage/src/routes/Intake.tsx`:**

```tsx
import { useState } from "react";
import { SURVEY, type SurveyResponse, type VibeAxis, type VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { NumberGate } from "../components/NumberGate";

export function Intake() {
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  const [name, setName] = useState("");
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [phrases, setPhrases] = useState<Partial<Record<VibeAxis, string>>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visitor) return <NumberGate title="Intake" onResolved={setVisitor} />;

  async function submit() {
    if (!visitor) return;
    setError(null);
    const survey: SurveyResponse = {
      name,
      freeText,
      phrases: Object.entries(phrases).map(([axis, choice]) => ({
        axis: axis as VibeAxis,
        choice: choice as string,
      })),
    };
    try {
      await api.submitIntake(visitor.id, survey);
      setDone(true);
    } catch (e) {
      setError(String(e));
    }
  }

  if (done) {
    return (
      <main className="void">
        <h1>Processed.</h1>
        <p className="dim">
          Number {visitor.number} — proceed to the Physical Challenge when called.
        </p>
      </main>
    );
  }

  return (
    <main className="void form">
      <h1>Intake</h1>
      <p className="dim">Number {visitor.number}</p>
      {SURVEY.map((f) => {
        if (f.kind === "phrase") {
          return (
            <section key={f.axis} className="field">
              <label>{f.label}</label>
              <div className="choices">
                {f.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={phrases[f.axis] === o ? "choice on" : "choice"}
                    onClick={() => setPhrases((p) => ({ ...p, [f.axis]: o }))}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </section>
          );
        }
        const value = f.id === "name" ? name : freeText[f.id] ?? "";
        const set = (v: string) =>
          f.id === "name" ? setName(v) : setFreeText((s) => ({ ...s, [f.id]: v }));
        return (
          <section key={f.id} className="field">
            <label>{f.label}</label>
            {f.kind === "longtext" ? (
              <textarea value={value} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
            ) : (
              <input value={value} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
            )}
          </section>
        );
      })}
      {error && <p className="error">{error}</p>}
      <button className="submit" onClick={() => void submit()} disabled={!name.trim()}>
        Submit for processing
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS (shared, brain, and Intake all green; `Scan.tsx`/`Station.tsx` still compile — they don't use the removed survey fields).

- [ ] **Step 4: Manual browser smoke.** `pnpm dev`, open `http://localhost:5173/intake`:
  1. The gate shows "Enter your number" — type `1`, Continue.
  2. The form appears, headed "Number 1". No "Physical Challenge" sections, no oracle picker.
  3. Fill Name, submit → "Processed. Number 1 — proceed to the Physical Challenge when called."
  4. In another tab, `GET http://localhost:5173/api/visitors` → the record has `number: 1`, a `survey`, and an `intakeAt`. ✔

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/survey.ts apps/stage/src/routes/Intake.tsx
git commit -m "feat(stage): intake = number gate + data-only form + physical-challenge handoff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.3: `/scan` → `/bodyscan` — number gate, enroll, persist template

**Files:**
- Create: `apps/stage/src/routes/BodyScan.tsx` (from `Scan.tsx`)
- Delete: `apps/stage/src/routes/Scan.tsx`
- Modify: `apps/stage/src/App.tsx`

**Interfaces:**
- Consumes: `NumberGate`, `api.enrollPose`, the pose lib (`usePoseLandmarker`, `landmarksToAngles`, `motionMetric`, `CONNECTIONS`, `JOINTS`).
- Produces: `/bodyscan` route — record a shape, hold to lock, POST the template, confirm. No verify loop (that's the altar).

- [ ] **Step 1: Create `apps/stage/src/routes/BodyScan.tsx`.** This is `Scan.tsx` reduced to enroll-only (drop the `watch`/`matched` phases and the match tuners) wrapped in the number gate, POSTing on lock:

```tsx
import { useCallback, useRef, useState } from "react";
import type { VisitorProfile } from "@channelers/shared";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import { landmarksToAngles, motionMetric, type PoseVector } from "../lib/pose/angles";
import { CONNECTIONS, type Landmark } from "../lib/pose/landmarks";
import { api } from "../lib/api";
import { NumberGate } from "../components/NumberGate";

type Phase = "ready" | "record" | "saving" | "enrolled";

export function BodyScan() {
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  if (!visitor) return <NumberGate title="Body Scan" onResolved={setVisitor} />;
  return <Enroll visitor={visitor} />;
}

function Enroll({ visitor }: { visitor: VisitorProfile }) {
  const [stillness, setStillness] = useState(0.05);
  const [recordSec, setRecordSec] = useState(3.5);
  const [phase, setPhase] = useState<Phase>("ready");
  const [motion, setMotion] = useState(1);
  const [holdProgress, setHoldProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("ready");
  const prevVecRef = useRef<PoseVector | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const draw = (lms: Landmark[] | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lms) return;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(231,227,218,0.7)";
    for (const [i, j] of CONNECTIONS) {
      const a = lms[i], b = lms[j];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }
  };

  async function persist(vec: PoseVector) {
    setPhaseBoth("saving");
    try {
      await api.enrollPose(visitor.id, vec);
      setPhaseBoth("enrolled");
    } catch (e) {
      setError(String(e));
      setPhaseBoth("ready");
    }
  }

  const onFrame = useCallback((lms: Landmark[] | null, tMs: number) => {
    const canvas = canvasRef.current;
    const video = canvas?.previousElementSibling as HTMLVideoElement | null;
    if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    draw(lms);
    if (!lms) { holdStartRef.current = null; prevVecRef.current = null; setMotion(1); return; }

    const vec = landmarksToAngles(lms);
    const bodyVisible = vec.weights.reduce((s, w) => s + w, 0) / vec.weights.length > 0.5;
    const m = prevVecRef.current ? motionMetric(prevVecRef.current, vec) : 1;
    prevVecRef.current = vec;
    setMotion(m);

    if (phaseRef.current !== "record") return;
    const still = m < stillness && bodyVisible;
    if (!still) { holdStartRef.current = null; setHoldProgress(0); return; }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    const prog = Math.min(1, (tMs - holdStartRef.current) / (recordSec * 1000));
    setHoldProgress(prog);
    if (prog >= 1) { holdStartRef.current = null; void persist(vec); }
  }, [stillness, recordSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const { videoRef, status, error: camError, start } = usePoseLandmarker(onFrame);

  const prompt = {
    ready: "Press start, then invent a shape only you will remember.",
    record: "Strike your shape — and hold it.",
    saving: "Saving your shape…",
    enrolled: "Your shape is saved. Return to the waiting room until you are called.",
  }[phase];

  return (
    <main className="void">
      <h1>Body Scan</h1>
      <p className="dim">Number {visitor.number} · invent and hold a shape — it becomes your key.</p>

      <div className="posestage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {phase === "enrolled" && <div className="poseflash">✓ SAVED</div>}
      </div>

      <p style={{ fontSize: 20, minHeight: 28 }}>{prompt}</p>

      <div className="controls">
        {status !== "running" ? (
          <button className="submit" onClick={start} disabled={status === "loading"}>
            {status === "loading" ? "loading model…" : "Start camera"}
          </button>
        ) : phase === "ready" || phase === "enrolled" ? (
          <button className="submit" onClick={() => setPhaseBoth("record")}>
            {phase === "enrolled" ? "Re-record shape" : "Record shape"}
          </button>
        ) : null}
      </div>
      {(error || camError) && <p className="error">{error ?? `camera/model error: ${camError}`}</p>}

      {status === "running" && (
        <>
          <div className="posebars">
            <Bar label="motion" value={1 - Math.min(1, motion / 0.3)} text={motion.toFixed(3)} good={motion < stillness} />
            <Bar label="record hold" value={holdProgress} text={`${(holdProgress * 100).toFixed(0)}%`} good={holdProgress >= 1} />
          </div>
          <details>
            <summary className="dim">tuning</summary>
            <div className="tuners">
              <Tuner label="stillness (rad)" min={0.01} max={0.2} step={0.005} value={stillness} onChange={setStillness} />
              <Tuner label="record hold (s)" min={1} max={6} step={0.5} value={recordSec} onChange={setRecordSec} />
            </div>
          </details>
        </>
      )}
    </main>
  );
}

function Bar({ label, value, text, good }: { label: string; value: number; text: string; good: boolean }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track"><div className={`fill${good ? " good" : ""}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
      <span className="val">{text}</span>
    </div>
  );
}

function Tuner({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="tuner">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{value.toFixed(3)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Delete `apps/stage/src/routes/Scan.tsx`.**

```bash
git rm apps/stage/src/routes/Scan.tsx
```

- [ ] **Step 3: Wire the route in `apps/stage/src/App.tsx`.** Change the import and the `SCREENS` array and the `<Route>`:

```tsx
import { BodyScan } from "./routes/BodyScan";
// ...
const SCREENS = ["intake", "bodyscan", "station", "console", "souvenir"] as const;
// ...
<Route path="/bodyscan" element={<BodyScan />} />
```

(Remove the old `import { Scan }` and `<Route path="/scan" ... />`. The `/station` route is renamed in Task 1.5.)

- [ ] **Step 4: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 5: Manual browser smoke.** `http://localhost:5173/bodyscan`:
  1. Number gate → type the same number you used at intake (e.g. `1`).
  2. Start camera → Record shape → strike + hold → "✓ SAVED".
  3. `GET /api/visitors` → that record now has a `poseTemplate` (angles/weights) and a `poseAt`. ✔

- [ ] **Step 6: Commit.**

```bash
git add apps/stage/src/routes/BodyScan.tsx apps/stage/src/App.tsx
git commit -m "feat(stage): /bodyscan enrolls and persists the pose identity token

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.4: `/altar` — pose verify + persona select

**Files:**
- Create: `apps/stage/src/routes/Altar.tsx`
- Modify: `apps/stage/src/App.tsx`

**Interfaces:**
- Consumes: `NumberGate`, `api.verifyPose`, `api.setPersona`, the pose lib, `ARCHETYPES`, the resolved record's `poseTemplate`.
- Produces: `/altar` route — load by number, verify the held pose against the enrolled template (with a manual-unlock override), set the persona; show "oracle ready" when both done.

- [ ] **Step 1: Create `apps/stage/src/routes/Altar.tsx`:**

```tsx
import { useCallback, useRef, useState } from "react";
import { ARCHETYPES, type VisitorProfile } from "@channelers/shared";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import { landmarksToAngles, motionMetric, poseSimilarity, type PoseVector } from "../lib/pose/angles";
import { CONNECTIONS, type Landmark } from "../lib/pose/landmarks";
import { api } from "../lib/api";
import { NumberGate } from "../components/NumberGate";

export function Altar() {
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  if (!visitor) return <NumberGate title="Altar" onResolved={setVisitor} />;
  return <Gate visitor={visitor} />;
}

function Gate({ visitor }: { visitor: VisitorProfile }) {
  const template = (visitor.poseTemplate as PoseVector | undefined) ?? null;
  const [stillness] = useState(0.05);
  const [matchThresh] = useState(0.9);
  const [verifySec] = useState(1.5);

  const [verified, setVerified] = useState(!!visitor.poseVerifiedAt);
  const [archetype, setArchetype] = useState<string | null>(visitor.archetype ?? null);
  const [similarity, setSimilarity] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const verifiedRef = useRef(verified);
  verifiedRef.current = verified;
  const holdStartRef = useRef<number | null>(null);
  const prevVecRef = useRef<PoseVector | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  async function markVerified() {
    if (verifiedRef.current) return;
    setVerified(true);
    try { await api.verifyPose(visitor.id); }
    catch (e) { setError(String(e)); setVerified(false); }
  }

  async function pick(id: string) {
    setArchetype(id);
    try { await api.setPersona(visitor.id, id); }
    catch (e) { setError(String(e)); setArchetype(null); }
  }

  const draw = (lms: Landmark[] | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lms) return;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(231,227,218,0.7)";
    for (const [i, j] of CONNECTIONS) {
      const a = lms[i], b = lms[j];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
      ctx.stroke();
    }
  };

  const onFrame = useCallback((lms: Landmark[] | null, tMs: number) => {
    const canvas = canvasRef.current;
    const video = canvas?.previousElementSibling as HTMLVideoElement | null;
    if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    draw(lms);
    if (verifiedRef.current || !template || !lms) {
      holdStartRef.current = null; prevVecRef.current = null; return;
    }
    const vec = landmarksToAngles(lms);
    const bodyVisible = vec.weights.reduce((s, w) => s + w, 0) / vec.weights.length > 0.5;
    const motion = prevVecRef.current ? motionMetric(prevVecRef.current, vec) : 1;
    prevVecRef.current = vec;
    const sim = poseSimilarity(template, vec);
    setSimilarity(sim);
    const qualifies = bodyVisible && motion < stillness && sim >= matchThresh;
    if (!qualifies) { holdStartRef.current = null; setHoldProgress(0); return; }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    const prog = Math.min(1, (tMs - holdStartRef.current) / (verifySec * 1000));
    setHoldProgress(prog);
    if (prog >= 1) { holdStartRef.current = null; void markVerified(); }
  }, [template, stillness, matchThresh, verifySec]); // eslint-disable-line react-hooks/exhaustive-deps

  const { videoRef, status, error: camError, start } = usePoseLandmarker(onFrame);
  const ready = verified && !!archetype;

  return (
    <main className="void">
      <h1>Altar</h1>
      <p className="dim">Number {visitor.number} · {visitor.survey?.name ?? "—"}</p>
      {ready && <p className="poseflash">ORACLE READY — proceed to be channelled.</p>}
      {error && <p className="error">{error}</p>}

      <h3>1 · Validate your shape</h3>
      {!template && <p className="dim">No pose on file — use the manual override, or send them back to /bodyscan.</p>}
      <div className="posestage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {verified && <div className="poseflash">✓ VERIFIED</div>}
      </div>
      {!verified && (
        <div className="controls">
          {status !== "running" ? (
            <button className="submit" onClick={start} disabled={status === "loading" || !template}>
              {status === "loading" ? "loading model…" : "Start camera"}
            </button>
          ) : (
            <div className="posebars">
              <Bar label="similarity" value={similarity} text={`${(similarity * 100).toFixed(0)}%`} good={similarity >= matchThresh} />
              <Bar label="verify hold" value={holdProgress} text={`${(holdProgress * 100).toFixed(0)}%`} good={holdProgress >= 1} />
            </div>
          )}
          <button className="end" onClick={() => void markVerified()}>Manual unlock (override)</button>
        </div>
      )}
      {camError && <p className="error">camera/model error: {camError}</p>}

      <h3>2 · Choose the oracle</h3>
      <div className="choices oracle-choices">
        {ARCHETYPES.map((a) => (
          <button
            key={a.id}
            type="button"
            className={archetype === a.id ? "choice on" : "choice"}
            onClick={() => void pick(a.id)}
          >
            <strong>{a.label}</strong>
            <span className="dim">{a.blurb}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

function Bar({ label, value, text, good }: { label: string; value: number; text: string; good: boolean }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track"><div className={`fill${good ? " good" : ""}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
      <span className="val">{text}</span>
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `apps/stage/src/App.tsx`:**

```tsx
import { Altar } from "./routes/Altar";
// ...
const SCREENS = ["intake", "bodyscan", "altar", "station", "console", "souvenir"] as const;
// ...
<Route path="/altar" element={<Altar />} />
```

- [ ] **Step 3: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS.

- [ ] **Step 4: Manual browser smoke.** `http://localhost:5173/altar`:
  1. Number gate → the number you enrolled at `/bodyscan`.
  2. Start camera → return to your shape → "✓ VERIFIED" (or click **Manual unlock**).
  3. Click an oracle → it highlights; "ORACLE READY" banner appears once both are done.
  4. `GET /api/visitors` → that record has `poseVerifiedAt`, `archetype`, and `personaAt`. ✔

- [ ] **Step 5: Commit.**

```bash
git add apps/stage/src/routes/Altar.tsx apps/stage/src/App.tsx
git commit -m "feat(stage): /altar gates on pose verify + persona pick

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.5: `/station` → `/channel` — oracle-ready lobby, archetype from record, remove debug fetch

**Files:**
- Create: `apps/stage/src/routes/Channel.tsx` (from `Station.tsx`)
- Delete: `apps/stage/src/routes/Station.tsx`
- Modify: `apps/stage/src/App.tsx`

**Interfaces:**
- Consumes: the record's derived oracle-readiness (`!!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt`) and `v.archetype`.
- Produces: `/channel` route — lobby lists only oracle-ready visitors; debug `fetch` gone.

- [ ] **Step 1: Create `apps/stage/src/routes/Channel.tsx` from `Station.tsx`** with exactly three changes (everything else copied verbatim):

  **(a)** Rename the component: `export function Channel() {` (was `Station`).

  **(b)** Replace the lobby availability + label logic. Find:

```tsx
  const busyVisitorIds = new Set(roster.map((s) => s.visitorId));
  const available = visitors.filter((v) => !busyVisitorIds.has(v.id));
```

  with:

```tsx
  const busyVisitorIds = new Set(roster.map((s) => s.visitorId));
  const isOracleReady = (v: VisitorProfile) =>
    !!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt;
  const available = visitors.filter((v) => isOracleReady(v) && !busyVisitorIds.has(v.id));
```

  And in the lobby render, the archetype now comes from the record, not the survey. Find:

```tsx
          const archId = v.survey.archetype ?? ARCHETYPES[0].id;
```

  replace with:

```tsx
          const archId = v.archetype ?? ARCHETYPES[0].id;
```

  And the empty-state copy — find:

```tsx
          {visitors.length === 0
            ? "No visitors yet — waiting for intake submissions."
            : "All visitors are currently being channelled."}
```

  replace with:

```tsx
          {visitors.length === 0
            ? "No visitors yet — waiting for intake submissions."
            : "No one is oracle-ready yet (needs pose verify + persona at the altar)."}
```

  **(c)** Delete the debug instrumentation in `toggleMic` — remove the entire block:

```tsx
    // #region agent log
    fetch('http://127.0.0.1:7562/ingest/da9653ed-3e12-460e-b9be-18d71e0d2a0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ee986'},body:JSON.stringify({sessionId:'6ee986',location:'Station.tsx:toggleMic',message:'mic toggle',data:{listening,hasSession:!!mySessionIdRef.current,supported:rec.supported},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
```

- [ ] **Step 2: Delete `apps/stage/src/routes/Station.tsx`.**

```bash
git rm apps/stage/src/routes/Station.tsx
```

- [ ] **Step 3: Wire the route in `apps/stage/src/App.tsx`:**

```tsx
import { Channel } from "./routes/Channel";
// ...
const SCREENS = ["intake", "bodyscan", "altar", "channel", "console", "souvenir"] as const;
// ...
<Route path="/channel" element={<Channel />} />
```

(Remove the old `import { Station }` and `<Route path="/station" ... />`.)

- [ ] **Step 4: Verify typecheck + build.**

```bash
pnpm -r typecheck && pnpm --filter @channelers/stage build
```

Expected: PASS, 0 errors across all packages. (`Console.tsx` still reads `v.survey` — confirm it compiles since `survey` is optional; if it dereferences `v.survey.name` unguarded, change to `v.survey?.name`. That is the only place outside this plan's tasks that may need a `?.`.)

- [ ] **Step 5: Full manual smoke — the whole ritual.** `pnpm dev`, then for one visitor number `7`:
  1. `/intake` → number `7` → fill + submit.
  2. `/bodyscan` → number `7` → record + hold → SAVED.
  3. `/altar` → number `7` → verify (or manual unlock) + pick an oracle → ORACLE READY.
  4. `/channel` → visitor `7` appears in **Available visitors** with the chosen oracle → **Channel** → teleprompter opens with the opening line; type "hello" → an oracle reply streams (offline fallback if no key). ✔
  5. Confirm a visitor who only did `/intake` does **not** appear in `/channel`. ✔

- [ ] **Step 6: Commit.**

```bash
git add apps/stage/src/routes/Channel.tsx apps/stage/src/App.tsx
git commit -m "feat(stage): /channel lists oracle-ready visitors; drop debug fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed against the spec)

**Spec coverage (§ → task):** §3 identity/number/upsert → 0.2, 0.3, 0.4 · §3.2 state/timestamps → 0.2, 0.3 · §5 pose persist + altar verify → 0.4 (persist endpoint), 1.3 (enroll), 1.4 (verify) · §6 persona seam (set at altar, empty until then) → 0.4, 1.4 · §7 music early / persona-seed deleted → **partial** (music repointed to intake in 0.4; the seeds *split* + persona-seed deletion is deferred to Tier 2 — flagged below) · §13 debug-fetch removed → 1.5 · Routes (`/bodyscan`, `/altar`, `/channel`) → 1.3, 1.4, 1.5 · Intake drops scan+oracle → 1.2.

**Deliberate deferrals (not gaps):**
- The §7 **generation split** (music vs. choreography timing) and **deleting the dead `persona` seed** are **Tier 2** — Tier 1 keeps the existing `transform()` (it still emits the music seed at intake; the dance/persona seed fields are stored-and-unused, exactly as today). Re-pointing transform to intake (Task 0.4) is the only Tier-1 generation change.
- `location.state === "called"`, dwell timers, and the console overhaul are **Tier 3**. Tier 1 leaves `location` at `waiting` (stations may set `in_progress` in Tier 3; not required here).

**Type consistency:** `PoseVector {angles,weights}` is identical in shared (Task 0.2) and the stage pose lib (consumed unchanged in 1.3/1.4). `isOracleReady` uses `personaAt`/`poseVerifiedAt`/`sessionEndAt` exactly as defined in Task 0.2 and stamped in 0.3/0.5. `api` method names (`register/submitIntake/enrollPose/setPersona/verifyPose`) are consistent across 1.1 → 1.2/1.3/1.4. Endpoint paths match between Task 0.4 (server) and 1.1 (client).

**Placeholder scan:** no TBDs; every code step shows complete code. The one cross-file caveat (Console.tsx `v.survey?.name`) is called out explicitly in Task 1.5 Step 4.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-19-tier0-tier1-identity-and-single-visitor-path.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
