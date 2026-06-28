# Visitor-Store Snapshot Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Survive a Brain crash/redeploy without losing visitor data — periodically snapshot the in-memory visitor store to a JSON file and hydrate it back on boot, so participant surveys/poses/archetypes/milestones are recovered.

**Architecture:** A new, fully **additive** persistence module (`apps/brain/src/persistence.ts`) serializes the existing `store` to a single JSON file on a short interval (atomic temp-file + rename, skip-if-unchanged) and validates+loads it back at startup. It is wired only in the process entry point (`index.ts`) and is **active only when `VISITOR_SNAPSHOT_PATH` is set** — so dev, tests, and any deploy that doesn't set it behave exactly as today. No mutator, no route, and no WS protocol message changes. On the cloud, the file lives on a mounted Fly volume so it survives machine restarts.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Node `node:fs` (synchronous writes), zod (existing `VisitorProfile` schema for hydrate-validation), vitest, Fastify (unchanged), Fly.io volumes.

## Global Constraints

- **All TypeScript**, ESM modules, `node:`-prefixed core imports (matches `store.ts`/`config.ts`).
- **Additive + gated.** The feature must be OFF unless `VISITOR_SNAPSHOT_PATH` is set. With it unset, runtime behavior is byte-for-byte identical to today. This is the rollback guarantee.
- **Never throw on persistence I/O.** A missing/corrupt/unwritable snapshot must degrade to "no persistence" (today's behavior), never crash the Brain or block boot. Wrap all fs in try/catch; log and continue.
- **Offline-resilient / single-instance** stays true (ARCHITECTURE §2, DEPLOY.md): one always-on machine, in-memory store remains the source of truth; the snapshot is a recovery cache, not a database.
- **Scope = visitor store only.** Dispatcher slot occupancy and divination sessions are explicitly NOT persisted (see "What survives" below). Do not touch `dispatcher.ts`, `divination.ts`, `tuning.ts`, `choreo.ts`, `bus.ts`, or `app.ts`.
- Run `pnpm --filter @channelers/brain test` and `pnpm -r typecheck` before claiming any task done. Commands run from the `app/` directory.

## What survives a restart (and what doesn't)

| State | Persisted? | After restart |
|---|---|---|
| Visitor records — name, survey, pose template, archetype, **all milestone timestamps**, seeds, choreo first-pass | ✅ yes | Fully restored (≤ `VISITOR_SNAPSHOT_MS` of loss; default 2 s) |
| Dispatcher slot occupancy / called positions | ❌ no | Re-derives as kiosks reconnect; operator re-places anyone caught mid-station |
| Divination sessions (live conversation history) | ❌ no | A reading in progress at the crash is lost; the visitor is still fully in the system and altar-ready |
| Operator tuning / choreo dials | ❌ no | Revert to defaults |

This is the deliberate "minimal" scope: it preserves the **irreplaceable** participant data (a 20-minute ritual's worth) with a tiny, fail-safe blast radius. Dispatcher/session recovery is a larger, hotter-path change deferred to post-workshop.

## File structure

- **Create** `apps/brain/src/persistence.ts` — serialize / atomic-write / read+validate / hydrate / snapshot-loop. One responsibility: durability of the visitor store. Pure, unit-testable functions; the loop is a thin `setInterval` wrapper.
- **Create** `apps/brain/test/persistence.test.ts` — unit tests for the above.
- **Modify** `apps/brain/src/store.ts` — add one method, `load(records)`, beside `clear()`.
- **Modify** `apps/brain/src/config.ts` — add a `persistence` config block.
- **Modify** `apps/brain/src/index.ts` — hydrate on boot, start the loop, flush on graceful shutdown (all gated on the configured path).
- **Modify** `fly.toml` + `DEPLOY.md` — mount a volume, set the env var, document the ops change.
- **Modify** `docs/CHANGELOG.md` + `docs/ARCHITECTURE.md` §12 — record the change.

---

### Task 1: `store.load()` — repopulate the store from a record array

**Files:**
- Modify: `apps/brain/src/store.ts` (add `load` beside `clear`, ~line 124)
- Test: `apps/brain/test/persistence.test.ts` (new file; Task 1 + 2 + 3 tests share it)

**Interfaces:**
- Consumes: existing module-level `visitors`/`byNumber` Maps and the exported `VisitorRecord` type.
- Produces: `store.load(records: VisitorRecord[]): void` — clears both maps, then inserts every record and rebuilds the `byNumber` index from each record's `number`. (Mirrors `clear()`; `byNumber` is derived, never persisted separately.)

- [ ] **Step 1: Write the failing test**

Create `apps/brain/test/persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { store, type VisitorRecord } from "../src/store";

function rec(number: number, over: Partial<VisitorRecord> = {}): VisitorRecord {
  const ts = "2026-06-28T00:00:00.000Z";
  return {
    id: `id-${number}`,
    number,
    scans: [],
    location: { state: "waiting", since: ts },
    createdAt: ts,
    ...over,
  };
}

describe("store.load (hydrate from records)", () => {
  beforeEach(() => store.clear());

  it("replaces store contents and rebuilds the number index", () => {
    store.register(111); // pre-existing record that load must clear
    store.load([rec(222, { survey: { name: "Mara", freeText: {}, phrases: [] }, intakeAt: "2026-06-28T00:00:01.000Z" })]);
    expect(store.getByNumber(111)).toBeUndefined();          // old record gone
    const v = store.getByNumber(222);
    expect(v?.id).toBe("id-222");
    expect(v?.survey?.name).toBe("Mara");
    expect(store.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @channelers/brain test persistence`
Expected: FAIL — `store.load is not a function`.

- [ ] **Step 3: Add the `load` method**

In `apps/brain/src/store.ts`, add immediately above `clear()` (currently ~line 125):

```ts
  /** Replace all records (boot-time hydrate from a snapshot). Rebuilds the number index. */
  load(records: VisitorRecord[]): void {
    visitors.clear();
    byNumber.clear();
    for (const r of records) {
      visitors.set(r.id, r);
      byNumber.set(r.number, r.id);
    }
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @channelers/brain test persistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/store.ts apps/brain/test/persistence.test.ts
git commit -m "feat(brain): store.load() to hydrate the visitor store from records"
```

---

### Task 2: persistence module — serialize, atomic write, read+validate, hydrate

**Files:**
- Create: `apps/brain/src/persistence.ts`
- Test: `apps/brain/test/persistence.test.ts` (append)

**Interfaces:**
- Consumes: `store` + `VisitorRecord` (Task 1's `store.load`); `VisitorProfile`, `Seeds`, `ChoreoScore` zod schemas from `@channelers/shared`.
- Produces:
  - `serializeStore(): string` — `{ version: 1, savedAt, visitors: store.list() }` as JSON.
  - `writeSnapshot(path: string, data: string): boolean` — atomic (`<path>.tmp` → rename); never throws; `false` on failure.
  - `readSnapshot(path: string): VisitorRecord[] | null` — read+`JSON.parse`+zod-validate; `null` on missing/corrupt/invalid; never throws.
  - `hydrateFromSnapshot(path: string): number` — loads validated records via `store.load`; returns count (0 if none).

- [ ] **Step 1: Write the failing tests**

Append to `apps/brain/test/persistence.test.ts` (and extend the import line):

```ts
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  serializeStore, writeSnapshot, readSnapshot, hydrateFromSnapshot,
} from "../src/persistence";

const tmpFile = (name = "visitors.json") => join(mkdtempSync(join(tmpdir(), "chan-persist-")), name);

describe("snapshot read/write round-trip", () => {
  beforeEach(() => store.clear());

  it("serializeStore emits versioned JSON with the live records", () => {
    store.register(501);
    const parsed = JSON.parse(serializeStore());
    expect(parsed.version).toBe(1);
    expect(parsed.savedAt).toBeTruthy();
    expect(parsed.visitors).toHaveLength(1);
    expect(parsed.visitors[0].number).toBe(501);
  });

  it("write then read returns the same records", () => {
    store.register(502);
    const path = tmpFile();
    expect(writeSnapshot(path, serializeStore())).toBe(true);
    const back = readSnapshot(path);
    expect(back?.[0].number).toBe(502);
  });

  it("readSnapshot returns null for a missing file (no throw)", () => {
    expect(readSnapshot(join(tmpdir(), "does-not-exist-xyz.json"))).toBeNull();
  });

  it("readSnapshot returns null for a corrupt file (no throw)", () => {
    const path = tmpFile();
    writeFileSync(path, "{ not valid json");
    expect(readSnapshot(path)).toBeNull();
  });

  it("readSnapshot returns null when a record fails schema validation", () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify({ version: 1, savedAt: "x", visitors: [{ id: "bad" }] }));
    expect(readSnapshot(path)).toBeNull();
  });

  it("hydrateFromSnapshot loads records into the store and returns the count", () => {
    store.register(503);
    const path = tmpFile();
    writeSnapshot(path, serializeStore());
    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(hydrateFromSnapshot(path)).toBe(1);
    expect(store.getByNumber(503)?.number).toBe(503);
  });

  it("hydrateFromSnapshot returns 0 for a missing file and leaves the store empty", () => {
    expect(hydrateFromSnapshot(join(tmpdir(), "nope-xyz.json"))).toBe(0);
    expect(existsSync(join(tmpdir(), "nope-xyz.json"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @channelers/brain test persistence`
Expected: FAIL — cannot find module `../src/persistence`.

- [ ] **Step 3: Write the module**

Create `apps/brain/src/persistence.ts`:

```ts
import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { VisitorProfile, Seeds, ChoreoScore } from "@channelers/shared";
import { store, type VisitorRecord } from "./store";

const SNAPSHOT_VERSION = 1;

/** A stored visitor = the shared VisitorProfile plus the brain-only generated fields. */
const VisitorRecordSchema = VisitorProfile.extend({
  seeds: Seeds.optional(),
  choreoFirstPass: ChoreoScore.optional(),
});

const SnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  savedAt: z.string(),
  visitors: z.array(VisitorRecordSchema),
});

/** Full snapshot JSON written to disk (includes a timestamp). */
export function serializeStore(): string {
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    visitors: store.list(),
  });
}

/** Atomic write: temp file then rename, so a crash mid-write never corrupts the snapshot.
 *  Synchronous (data is small) and never throws — a failure degrades to "no persistence". */
export function writeSnapshot(path: string, data: string): boolean {
  try {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, path);
    return true;
  } catch (err) {
    console.error("[persistence] snapshot write failed:", err);
    return false;
  }
}

/** Read + validate a snapshot. Returns the records, or null on missing/corrupt/invalid. */
export function readSnapshot(path: string): VisitorRecord[] | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = SnapshotSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      console.error("[persistence] snapshot invalid, ignoring:", parsed.error.message);
      return null;
    }
    return parsed.data.visitors as VisitorRecord[];
  } catch (err) {
    console.error("[persistence] snapshot read failed:", err);
    return null;
  }
}

/** Boot-time hydrate. Returns the number of records loaded (0 = nothing to restore). */
export function hydrateFromSnapshot(path: string): number {
  const records = readSnapshot(path);
  if (!records || records.length === 0) return 0;
  store.load(records);
  return records.length;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @channelers/brain test persistence`
Expected: PASS (all round-trip tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/persistence.ts apps/brain/test/persistence.test.ts
git commit -m "feat(brain): snapshot serialize/write/read/hydrate for the visitor store"
```

---

### Task 3: the periodic snapshot loop

**Files:**
- Modify: `apps/brain/src/persistence.ts` (add `startSnapshotLoop`)
- Test: `apps/brain/test/persistence.test.ts` (append)

**Interfaces:**
- Consumes: `serializeStore`, `writeSnapshot`, `store` (Task 2).
- Produces: `startSnapshotLoop(path: string, intervalMs: number): () => void` — a `setInterval` that writes a snapshot **only when the visitor payload changed** since the last write; returns a stop function. The timer is `unref()`'d so it never keeps the process alive on its own.

- [ ] **Step 1: Write the failing test**

Append to `apps/brain/test/persistence.test.ts` (extend imports with `vi` and `startSnapshotLoop`):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
// ...add to the existing "../src/persistence" import: startSnapshotLoop

describe("startSnapshotLoop", () => {
  beforeEach(() => store.clear());

  it("writes after a change, skips when unchanged, and stop() halts writes", () => {
    vi.useFakeTimers();
    const path = tmpFile();
    const stop = startSnapshotLoop(path, 1000);

    store.register(601);
    vi.advanceTimersByTime(1000);
    expect(readSnapshot(path)?.length).toBe(1);   // wrote on change

    stop();
    store.register(602);
    vi.advanceTimersByTime(5000);
    expect(readSnapshot(path)?.length).toBe(1);   // no writes after stop

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @channelers/brain test persistence`
Expected: FAIL — `startSnapshotLoop is not exported`.

- [ ] **Step 3: Add the loop to `persistence.ts`**

Append to `apps/brain/src/persistence.ts`:

```ts
/** Snapshot the store every `intervalMs`, writing only when the visitor payload changed.
 *  Returns a stop function. The interval is unref()'d so it doesn't hold the event loop open. */
export function startSnapshotLoop(path: string, intervalMs: number): () => void {
  let last = ""; // empty → the first non-empty state forces an initial write
  const tick = setInterval(() => {
    const digest = JSON.stringify(store.list());
    if (digest === last) return;
    if (writeSnapshot(path, serializeStore())) last = digest;
  }, intervalMs);
  if (typeof (tick as { unref?: () => void }).unref === "function") {
    (tick as { unref: () => void }).unref();
  }
  return () => clearInterval(tick);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @channelers/brain test persistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/brain/src/persistence.ts apps/brain/test/persistence.test.ts
git commit -m "feat(brain): periodic skip-if-unchanged snapshot loop"
```

---

### Task 4: config knob + wire into the process entry point

**Files:**
- Modify: `apps/brain/src/config.ts` (add `persistence` block)
- Modify: `apps/brain/src/index.ts` (hydrate → listen → start loop → flush on shutdown)

**Interfaces:**
- Consumes: `hydrateFromSnapshot`, `startSnapshotLoop`, `writeSnapshot`, `serializeStore` (Tasks 2–3); `config` (this task).
- Produces: `config.persistence = { path?: string; intervalMs: number }`. Feature is active iff `config.persistence.path` is truthy. (No unit test — this is the composition root; it is covered by the module tests above and the Task 5 rehearsal acceptance test. `index.ts` is not imported by any test, so dev/test behavior is unchanged.)

- [ ] **Step 1: Add the config block**

In `apps/brain/src/config.ts`, add a top-level key on the `config` object (e.g. immediately after the `dispatcher: { … }` block, before the closing `};`):

```ts
  persistence: {
    /** When set, the visitor store is snapshotted to this file every `intervalMs` and hydrated
     *  from it on boot (crash/redeploy recovery for participant data). Unset → OFF (dev/test
     *  default; behavior identical to no persistence). On Fly this points into a mounted volume. */
    path: process.env.VISITOR_SNAPSHOT_PATH,
    intervalMs: Number(process.env.VISITOR_SNAPSHOT_MS ?? 2_000),
  },
```

- [ ] **Step 2: Wire `index.ts`**

Replace the entire contents of `apps/brain/src/index.ts` with:

```ts
import { buildApp } from "./app";
import { config } from "./config";
import { hydrateFromSnapshot, startSnapshotLoop, writeSnapshot, serializeStore } from "./persistence";

const snapshotPath = config.persistence.path;

// Recover participant data before serving traffic (no-op + 0 when the file is absent).
if (snapshotPath) {
  const restored = hydrateFromSnapshot(snapshotPath);
  console.log(`[brain] persistence on (${snapshotPath}) — restored ${restored} visitor(s)`);
}

const app = await buildApp();
await app.listen({ host: config.host, port: config.port });
console.log(`[brain] http://${config.host}:${config.port}  •  ws://${config.host}:${config.port}/ws`);

if (snapshotPath) {
  const stop = startSnapshotLoop(snapshotPath, config.persistence.intervalMs);
  // Flush a final snapshot on a graceful redeploy (Fly sends SIGTERM/SIGINT). A hard crash is
  // already covered by the periodic loop (≤ intervalMs of loss).
  const shutdown = () => {
    stop();
    writeSnapshot(snapshotPath, serializeStore());
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

- [ ] **Step 3: Typecheck + full brain suite (prove nothing regressed)**

Run: `pnpm -r typecheck && pnpm --filter @channelers/brain test`
Expected: typecheck clean; **all** brain tests pass (the existing suite is unaffected because persistence is off with no `VISITOR_SNAPSHOT_PATH`).

- [ ] **Step 4: Commit**

```bash
git add apps/brain/src/config.ts apps/brain/src/index.ts
git commit -m "feat(brain): wire visitor-store snapshot (gated on VISITOR_SNAPSHOT_PATH)"
```

---

### Task 5: Acceptance test — local crash-recovery rehearsal

**Files:** none (manual verification — this is the test the feature exists for).

This proves the end-to-end recovery the user cares about. Run from `app/`.

- [ ] **Step 1: Start the Brain with persistence on (fast snapshot)**

```bash
mkdir -p ./tmp
VISITOR_SNAPSHOT_PATH="$PWD/tmp/visitors.json" VISITOR_SNAPSHOT_MS=2000 \
  pnpm --filter @channelers/brain start
```
Expected log: `persistence on (…/tmp/visitors.json) — restored 0 visitor(s)` then the listen line.

- [ ] **Step 2: Create a few visitors**

In a second terminal — either open `http://127.0.0.1:8787/intake` in a browser and complete intake for 2–3 numbers, or seed a fully altar-ready dummy:
```bash
pnpm --filter @channelers/brain seed:altar
```
Wait > 2 s, then confirm the snapshot is being written:
```bash
cat tmp/visitors.json
curl -s http://127.0.0.1:8787/api/visitors        # the same visitors, with full data
```

- [ ] **Step 3: Simulate a HARD crash (not a graceful stop)**

Find the brain process and `kill -9` it (bypasses the SIGTERM flush, so this proves the *periodic* snapshot recovers, not the shutdown handler):
```bash
pkill -9 -f "tsx src/index.ts"
```

- [ ] **Step 4: Restart and confirm recovery**

```bash
VISITOR_SNAPSHOT_PATH="$PWD/tmp/visitors.json" VISITOR_SNAPSHOT_MS=2000 \
  pnpm --filter @channelers/brain start
```
Expected log: `restored N visitor(s)` (N = how many you created).
```bash
curl -s http://127.0.0.1:8787/api/visitors        # same visitors, same surveys/poses/milestones
```
Open `http://127.0.0.1:8787/console` → the visitors are present. Confirm an altar-ready visitor still shows as altar-ready (milestones survived). **Expected divergence (by design):** a visitor who was mid-station at the kill returns to the waiting pool / re-derived dispatcher position; an active reading is gone. Re-place such a visitor with the operator controls.

- [ ] **Step 5: Confirm the OFF path is unchanged**

Stop the Brain, restart WITHOUT the env var:
```bash
pnpm --filter @channelers/brain start
```
Expected: no `persistence on` log; `/api/visitors` is empty; behavior identical to today. (This is the rollback.)

---

### Task 6: Fly volume + deploy config + ops docs

**Files:**
- Modify: `fly.toml`
- Modify: `DEPLOY.md`

The cloud filesystem is ephemeral, so the snapshot must live on a **mounted volume** to survive a machine restart. (Caveat to document: a Fly volume is pinned to one machine in one region — consistent with the existing single always-on machine. It protects against process crash / redeploy / restart on that machine; a host-level move that abandons the volume is not covered. That is an acceptable, documented limit for the workshop; stronger durability = post-workshop external store.)

- [ ] **Step 1: Create the volume** (region must match `primary_region` in `fly.toml`, currently `sjc` — change both together if you move regions):

```bash
fly volumes create channelers_data --region sjc --size 1 --yes
```

- [ ] **Step 2: Edit `fly.toml`** — add the env var to the existing `[env]` block and append a mount:

```toml
[env]
  HOST = '0.0.0.0'
  PORT = '8080'
  SERVE_STAGE = 'true'
  VISITOR_SNAPSHOT_PATH = '/data/visitors.json'

[[mounts]]
  source = 'channelers_data'
  destination = '/data'
```

- [ ] **Step 3: Deploy**

```bash
fly deploy
```

- [ ] **Step 4: Verify on the remote**

```bash
fly logs            # look for: persistence on (/data/visitors.json) — restored 0 visitor(s)
fly ssh console -C "ls -la /data"                 # /data is writable by the container
# create a visitor (browser /intake on the deploy, or: pnpm seed:altar --base https://<app>.fly.dev), wait >2s:
fly ssh console -C "cat /data/visitors.json"       # the snapshot exists and holds the visitor
```
If `ls -la /data` shows the dir but writes fail, the logs will show `[persistence] snapshot write failed` and the Brain keeps running unpersisted (safe). Fix container write perms (the Dockerfile `USER`) and redeploy.

- [ ] **Step 5: Smoke the recovery on the remote (optional but recommended pre-show)**

```bash
fly apps restart channelers        # or `fly machine restart <id>`
fly logs                           # restored N visitor(s)
```
Confirm `/console` on the deploy still shows the visitor.

- [ ] **Step 6: Update `DEPLOY.md`** — replace the "State is volatile" caveat so it reflects the opt-in snapshot:

Change the first bullet under **Operating caveats** from the current "State is volatile…" text to:

```markdown
- **State recovery (opt-in).** Set `VISITOR_SNAPSHOT_PATH=/data/visitors.json` (a mounted
  volume — see `[[mounts]]` in `fly.toml`) and the Brain snapshots the visitor store every
  `VISITOR_SNAPSHOT_MS` (default 2 s) and restores it on boot — so a crash/redeploy recovers
  participant data (surveys, poses, archetypes, milestones). **Not** restored: live divination
  sessions and dispatcher slot positions (they re-derive as screens reconnect; re-place anyone
  caught mid-station). Unset the var → fully volatile, as before. A redeploy mid-show is still
  best avoided, but is now recoverable rather than total data loss.
- **Single instance only** — in-memory store + sticky WS + a single-machine volume. Never
  scale horizontally.
```

- [ ] **Step 7: Commit**

```bash
git add fly.toml DEPLOY.md
git commit -m "feat(deploy): mount a Fly volume + enable visitor snapshot on the cloud Brain"
```

---

### Task 7: Project docs (CHANGELOG + ARCHITECTURE §12)

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md` (§12 deployment bullet)

- [ ] **Step 1: Add a CHANGELOG entry** (newest on top), matching the existing what/why/files/docs format:

```markdown
## Visitor-store snapshot persistence (opt-in crash recovery) — 2026-06-28

**What:** The Brain can now snapshot its in-memory visitor store to a JSON file every ~2 s
(atomic write, skip-if-unchanged) and hydrate it on boot. Active only when
`VISITOR_SNAPSHOT_PATH` is set; on Fly the file lives on a mounted volume. New `store.load()`,
new `apps/brain/src/persistence.ts`, wired in `index.ts`; flushes a final snapshot on SIGTERM/SIGINT.

**Why:** A mid-show crash/redeploy previously wiped all participant data. This recovers the
irreplaceable part — surveys, poses, archetypes, milestones — with a fully additive, gated,
fail-safe change (unset the var → behavior identical to before). Dispatcher slot positions and
live divination sessions are intentionally out of scope (they re-derive on reconnect).

**Files/areas:** `apps/brain/src/{persistence.ts,store.ts,config.ts,index.ts}`,
`apps/brain/test/persistence.test.ts`, `fly.toml`, `DEPLOY.md`.

**Docs touched:** `CHANGELOG.md`, `ARCHITECTURE.md` §12, `DEPLOY.md`,
`docs/superpowers/plans/2026-06-28-visitor-store-snapshot-persistence.md`.
```

- [ ] **Step 2: Update `ARCHITECTURE.md` §12** — in the "Deployment — cloud Brain" subsection, amend the volatility note. Replace the clause *"accept that **state is volatile across redeploys** (fine for the workshop — don't redeploy mid-show)"* with:

```markdown
  state across redeploys is **recoverable but not transactional**: an opt-in visitor-store
  snapshot (`VISITOR_SNAPSHOT_PATH` → a mounted Fly volume, 2 s cadence, hydrate-on-boot;
  built 2026-06-28) restores participant data after a crash/redeploy, while dispatcher slot
  positions and live divination sessions still re-derive on reconnect. Avoid redeploying
  mid-show, but a crash is no longer total data loss.
```

- [ ] **Step 3: Commit**

```bash
git add docs/CHANGELOG.md docs/ARCHITECTURE.md
git commit -m "docs: record visitor-store snapshot persistence"
```

---

## Risks & mitigations

- **Snapshot file unwritable on Fly (volume perms / not mounted).** Mitigated: writes are try/catch → log + no-op; the Brain runs unpersisted (= today). Task 6 step 4 verifies the path is writable before relying on it.
- **Restore "storm" mass-reaps visitors.** Out of scope by construction — only the visitor store is hydrated; the dispatcher starts empty and re-fills from reconnecting kiosks. No reap is triggered by a fresh boot (slot-drop reap fires on a socket *close* event, which a fresh boot never emits). Verified behaviorally in Task 5.
- **Schema drift between snapshot format and code.** Mitigated: `version` field + zod validation; an unreadable/old snapshot → `null` → boot empty (logged), never a crash.
- **Write amplification.** Mitigated: skip-if-unchanged digest; a 2 s small-file write is negligible. Raise `VISITOR_SNAPSHOT_MS` if ever needed.

## Rollback

Unset `VISITOR_SNAPSHOT_PATH` (remove from `fly.toml` `[env]` and redeploy, or `fly secrets unset` if set as a secret). Runtime reverts to exactly today's in-memory-only behavior — no code revert required. The added code (`persistence.ts`, `store.load`, the `index.ts` guard) is inert when the path is unset.

## Self-review notes

- **Spec coverage:** snapshot ✅ (T2/T3), hydrate-on-boot ✅ (T2/T4), gated/additive ✅ (T4 config + index guard), durable on cloud ✅ (T6 volume), fail-safe ✅ (try/catch throughout + T5 step 5 OFF-path check), tested-at-rehearsal ✅ (T5), docs ✅ (T6/T7).
- **Type consistency:** `store.load(records: VisitorRecord[])` (T1) consumed by `hydrateFromSnapshot` (T2); `VisitorRecordSchema = VisitorProfile.extend({ seeds, choreoFirstPass })` infers exactly `VisitorRecord` (store.ts:7); `serializeStore`/`writeSnapshot`/`readSnapshot`/`startSnapshotLoop` signatures identical across T2/T3/T4.
- **No placeholders:** every code/verification step is concrete.
