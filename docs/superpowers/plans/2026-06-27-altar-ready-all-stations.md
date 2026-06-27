# Altar-ready requires ALL stations

**Goal:** A visitor counts as altar-ready only after clearing **every** non-altar station — intake, bodyscan, paper, and time-offering — and both the per-visitor predicate and the dispatcher's altar gate enforce this; the `seed:altar` command is updated to produce genuinely-complete visitors.

**Approach:** Introduce one shared helper `clearedPreAltarStations(v)` (all four milestones set) and route both gating points — `isAltarReady()` (shared) and the dispatcher's altar-eligibility line — through it, so they can never drift. Stations stay freely orderable; only the altar waits for all four. Update the seed to drive paper + offering to completion via the existing operator-override endpoints.

**Tech stack:** TypeScript pnpm monorepo (`@channelers/shared`, `@channelers/brain`, `@channelers/stage`); vitest; zod.

---

## Why / design

### Problem
Today "altar-ready" means only intake + bodyscan are done (`isAltarReady` = `waiting && intakeAt && poseAt && !sessionEndAt`). Paper (`STATION B - TYPEWRITER`) and the time-offering room (`STATION A - TIME OFFERING`, `offeringAt`) are **non-gating** — a visitor can reach the altar without them. The desired performance flow is that a visitor must complete the **entire** station circuit before the altar admits them.

### Scope
- **In:** the two altar gates (`isAltarReady`, dispatcher altar eligibility) now require `intakeAt && poseAt && paperAt && offeringAt`; the `seed:altar` script; affected tests; docs.
- **Out:** station **ordering** (confirmed: stations stay parallel / any-order); the `/channel` oracle-ready predicate (`personaAt && poseVerifiedAt` — a different, post-altar concept); the operator altar open/close gate (`altarOpen`); `/board`, the Pluribus broadcast, and the `/dispatch` flow strip (all derive from the two gates above and update automatically).

### Approaches considered
- **(A) Single shared helper `clearedPreAltarStations(v)`** ✅ chosen — both gates call one function; the milestone list lives in exactly one place. Directly serves the goal of treating every station as gating *consistently*.
- (B) Inline `&& paperAt && offeringAt` in both spots — smaller diff, but duplicates the milestone list across `shared` and `brain` and invites drift.
- (C) Data-drive from `Station.options` minus `altar` via a station→milestone map — over-engineered for four stations, and the `bodyscan → poseAt` naming mismatch makes the map awkward.

### Decision log
- **All four required, any order** (user-confirmed). The altar simply waits for all four milestones; the four non-altar stations remain parallel-eligible and `fillPriority` is unchanged.
- **Single shared predicate** for both gating points (approach A).
- **Seed completes paper + offering via existing endpoints** — `POST /api/checkin {number, station}` (operator override → forces `in_progress` at the station) then `POST /api/dispatch/complete {visitorId}` (→ `markComplete` stamps the station's milestone, returns to `waiting`). No new brain routes, consistent with the seed's "drive real endpoints" philosophy.
- **Seed stays strictly fully-altar-ready** (user-confirmed "as is") — no partial-state flag.
- **Welcome side effect:** under the new rule an altar-ready visitor has already done paper + offering, so they are no longer eligible for those soak stations — the prior "pending-paper occupant blocks altar dispatch" wrinkle disappears on its own.

---

## Global constraints

Apply to every task:

- **Verification commands** (exact):
  - Brain types: `pnpm --filter @channelers/brain typecheck`
  - Stage types: `pnpm --filter @channelers/stage typecheck`
  - Brain tests: `pnpm --filter @channelers/brain test`
  - Stage tests: `pnpm --filter @channelers/stage test`
- **TDD:** write the failing test, watch it fail for the right reason, minimal implementation, watch it pass, then commit.
- **Commits:** conventional-commit style matching the repo (`feat(dispatch): …`), one per task, staging only that task's files (the working tree already has unrelated unstaged edits to `Dispatch.tsx`, `styles.css`, `docs/CHANGELOG.md` — do **not** sweep those in). End each commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** `friday-preshow` (current).
- **No behavior may gate on station order** — eligibility for intake/bodyscan/paper/offering stays independent.

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `app/packages/shared/src/schemas.ts` | Modify | Add `clearedPreAltarStations(v)`; rewrite `isAltarReady` on top of it; update the doc comment. |
| `app/packages/shared/src/protocol.ts` | Modify | Fix two doc comments that describe altar-ready as "intake + bodyscan done". |
| `app/apps/brain/src/dispatcher.ts` | Modify | Altar-eligibility line uses `clearedPreAltarStations`. |
| `app/apps/brain/src/seed-altar.ts` | Modify | After intake+pose, complete paper + offering; update header docs; return the final profile. |
| `app/apps/brain/test/schema.test.ts` | Modify | New unit test for `isAltarReady` / `clearedPreAltarStations`. |
| `app/apps/brain/test/dispatcher.test.ts` | Modify | "counts altar-ready" fixture gets paper+offering (Task 1); "altar gate" + "socket-drop" get paper+offering and a new discriminating test (Task 2). |
| `app/apps/stage/src/lib/pluribus.test.ts` | Modify | `altarReadyNumbers` fixtures get paper+offering. |
| `docs/ARCHITECTURE.md` | Modify | §5 selection eligibility + altar-ready definition. |
| `docs/CHANGELOG.md` | Modify | New top entry. |

---

## Task 1 — Shared: `clearedPreAltarStations` + stricter `isAltarReady`

Make the predicate require all four milestones, and bring every consumer of the predicate back to green.

**Files:** `app/packages/shared/src/schemas.ts`, `app/packages/shared/src/protocol.ts`, `app/apps/brain/test/schema.test.ts`, `app/apps/brain/test/dispatcher.test.ts`, `app/apps/stage/src/lib/pluribus.test.ts`

**Interfaces:**
- Produces: `clearedPreAltarStations(v: VisitorProfile): boolean`; `isAltarReady(v: VisitorProfile): boolean` (signature unchanged, behavior stricter).
- Consumes: nothing new.

**Steps:**

- [ ] Add the failing unit test to `app/apps/brain/test/schema.test.ts` (after the `schema: VisitorProfile` describe block, near the top-level imports add `isAltarReady, clearedPreAltarStations` to the `@channelers/shared` import):

  ```ts
  describe("isAltarReady / clearedPreAltarStations", () => {
    const base = {
      id: "u1", number: 1, scans: [],
      location: { state: "waiting", since: "t" } as const,
      createdAt: "t",
    };
    const withMilestones = (m: Partial<Record<"intakeAt" | "poseAt" | "paperAt" | "offeringAt", string>>) =>
      VisitorProfile.parse({ ...base, ...m });

    it("is NOT altar-ready with only intake + bodyscan done (paper + offering still pending)", () => {
      const v = withMilestones({ intakeAt: "t", poseAt: "t" });
      expect(clearedPreAltarStations(v)).toBe(false);
      expect(isAltarReady(v)).toBe(false);
    });

    it("is altar-ready once all four pre-altar stations are done and the visitor is waiting", () => {
      const v = withMilestones({ intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t" });
      expect(clearedPreAltarStations(v)).toBe(true);
      expect(isAltarReady(v)).toBe(true);
    });

    it("drops back out of altar-ready once the reading has ended", () => {
      const v = withMilestones({ intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t" });
      expect(isAltarReady({ ...v, sessionEndAt: "t" })).toBe(false);
    });
  });
  ```

- [ ] Run it, expect FAIL (the first test fails: `isAltarReady` currently returns `true` for intake+pose):

  ```
  pnpm --filter @channelers/brain test schema
  # → "is NOT altar-ready with only intake + bodyscan done" fails: expected false, got true
  ```

- [ ] Implement in `app/packages/shared/src/schemas.ts` — replace the existing `isAltarReady` block (currently lines ~97-104):

  ```ts
  /**
   * Has the visitor cleared every pre-altar station? = all stations except the altar itself
   * (intake, bodyscan, paper, time-offering). The single source of truth for what gates the altar,
   * shared by `isAltarReady` (here) and the dispatcher's altar eligibility.
   */
  export function clearedPreAltarStations(v: VisitorProfile): boolean {
    return !!v.intakeAt && !!v.poseAt && !!v.paperAt && !!v.offeringAt;
  }

  /**
   * "Altar-ready": cleared ALL pre-altar stations and waiting in the pool, not yet through
   * divination. The dispatcher's altar-ready count + list and the Pluribus "completed the
   * stationing process" broadcast all key off this single predicate.
   */
  export function isAltarReady(v: VisitorProfile): boolean {
    return v.location.state === "waiting" && clearedPreAltarStations(v) && !v.sessionEndAt;
  }
  ```

- [ ] Run it, expect PASS:

  ```
  pnpm --filter @channelers/brain test schema
  # → all schema tests pass
  ```

- [ ] Bring the brain dispatcher count test back to green — in `app/apps/brain/test/dispatcher.test.ts`, the `flow-health snapshot fields` test "counts altar-ready waiting visitors…" (currently ~lines 165-168) sets only intake+pose; add the two milestones right after `setPoseTemplate`:

  ```ts
  const v = store.register(NUM());
  store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] });
  store.setPoseTemplate(v.id, { angles: [0], weights: [1] });
  store.stampMilestone(v.id, "paperAt");      // all four stations now done →
  store.stampMilestone(v.id, "offeringAt");   // genuinely altar-ready
  store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });
  ```

- [ ] Bring the stage Pluribus test back to green — in `app/apps/stage/src/lib/pluribus.test.ts`, extend the `v()` helper's option type and the `ready` factory so an altar-ready fixture sets all four milestones:

  ```ts
  const v = (
    number: number,
    o: { state?: "waiting" | "called" | "in_progress"; intakeAt?: string; poseAt?: string; paperAt?: string; offeringAt?: string; sessionEndAt?: string } = {},
  ): VisitorProfile =>
    ({
      id: `v${number}`,
      number,
      location: { state: o.state ?? "waiting" },
      createdAt: "t",
      intakeAt: o.intakeAt,
      poseAt: o.poseAt,
      paperAt: o.paperAt,
      offeringAt: o.offeringAt,
      sessionEndAt: o.sessionEndAt,
    }) as VisitorProfile;
  ```

  and in the `altarReadyNumbers` test, update the `ready` factory plus the now-stale "excluded" comment for #5:

  ```ts
  const ready = (n: number) => v(n, { intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t" });
  expect(
    altarReadyNumbers([
      ready(7),
      ready(3),
      v(5, { intakeAt: "t", poseAt: "t" }), // paper + offering not done → excluded
      v(9, { intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t", sessionEndAt: "t" }), // done → excluded
      v(11, { intakeAt: "t", poseAt: "t", paperAt: "t", offeringAt: "t", state: "in_progress" }), // not waiting → excluded
    ]),
  ).toEqual([3, 7]);
  ```

- [ ] Update the two doc comments in `app/packages/shared/src/protocol.ts`:
  - line ~116: `/** An altar-ready visitor (all pre-altar stations done, waiting) — divination prerequisites met. */`
  - line ~136: `/** Waiting visitors who are altar-ready (all pre-altar stations done, not yet read) — the operator's buffer gauge. */`

- [ ] Run the full affected suites, expect PASS:

  ```
  pnpm --filter @channelers/brain test
  pnpm --filter @channelers/stage test
  # → all green
  ```

- [ ] Commit:

  ```
  git add app/packages/shared/src/schemas.ts app/packages/shared/src/protocol.ts \
          app/apps/brain/test/schema.test.ts app/apps/brain/test/dispatcher.test.ts \
          app/apps/stage/src/lib/pluribus.test.ts
  git commit -m "$(cat <<'EOF'
  feat(shared): altar-ready requires all pre-altar stations (intake+bodyscan+paper+offering)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2 — Dispatcher: altar eligibility uses the shared predicate

The dispatcher decides altar dispatch via its own `eligibleStations` line, separate from `isAltarReady`. Route it through the same helper.

**Files:** `app/apps/brain/src/dispatcher.ts`, `app/apps/brain/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `clearedPreAltarStations` (Task 1) — imported from `@channelers/shared` (the file already imports `isAltarReady` from there).
- Produces: no new exports.

**Steps:**

- [ ] Add the discriminating failing test to `app/apps/brain/test/dispatcher.test.ts` inside the `describe("altar gate", …)` block (after the existing test):

  ```ts
  it("requires every pre-altar station, not just intake+pose, before dispatching to the altar", () => {
    f.hello("altar", "ka", "ca"); // altar-0 online
    d.setAltarOpen(true);
    const v = store.register(NUM());
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] }); // intakeAt
    store.setPoseTemplate(v.id, { angles: [0], weights: [1] });          // poseAt
    store.setLocation(v.id, { state: "waiting", since: new Date().toISOString() });

    d.kick();
    // intake + pose alone is no longer enough — paper + offering still pending
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant).toBeUndefined();

    store.stampMilestone(v.id, "paperAt");
    store.stampMilestone(v.id, "offeringAt");
    d.kick();
    expect(d.snapshot().slots.find((s) => s.station === "altar")?.occupant?.visitorId).toBe(v.id);
  });
  ```

- [ ] Run it, expect FAIL (the first assertion fails: current code dispatches on intake+pose):

  ```
  pnpm --filter @channelers/brain test dispatcher
  # → "requires every pre-altar station…" fails: altar occupant defined when it should be undefined
  ```

- [ ] Implement in `app/apps/brain/src/dispatcher.ts`:
  - Add `clearedPreAltarStations` to the existing shared import (line 3): `import { clearedPreAltarStations, isAltarReady } from "@channelers/shared";`
  - Replace the altar line in `eligibleStations` (currently line ~100):

    ```ts
    if (altarOpen && clearedPreAltarStations(v) && !v.sessionEndAt) out.push("altar");
    ```

- [ ] Run it, expect PASS for the new test:

  ```
  pnpm --filter @channelers/brain test dispatcher
  # → "requires every pre-altar station…" passes
  ```

- [ ] Fix the two existing dispatcher tests that assumed intake+pose was enough (they will now fail). In the `altar gate` test "does not dispatch to a closed altar; setAltarOpen opens it", add the two stamps after `setPoseTemplate` (line ~144):

  ```ts
  store.setPoseTemplate(v.id, { angles: [0], weights: [1] });          // poseAt
  store.stampMilestone(v.id, "paperAt");                               // + paper
  store.stampMilestone(v.id, "offeringAt");                            // + offering → altar-eligible
  ```

  In the "socket-drop after grace repools the slot's occupant" test, add the same two stamps after `setPoseTemplate` (line ~297):

  ```ts
  store.setPoseTemplate(v.id, { angles: [0], weights: [1] }); // poseAt
  store.stampMilestone(v.id, "paperAt");
  store.stampMilestone(v.id, "offeringAt"); // now altar-eligible
  ```

- [ ] Run the full brain suite, expect PASS:

  ```
  pnpm --filter @channelers/brain test
  pnpm --filter @channelers/brain typecheck
  # → all green, 0 type errors
  ```

- [ ] Commit:

  ```
  git add app/apps/brain/src/dispatcher.ts app/apps/brain/test/dispatcher.test.ts
  git commit -m "$(cat <<'EOF'
  feat(dispatch): altar eligibility gates on all pre-altar stations

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — Seed: complete paper + offering so `seed:altar` is genuinely altar-ready

After Task 1, `seed:altar` (intake+pose only) produces visitors that are no longer altar-ready. Drive paper + offering to completion via the operator-override endpoints. (Like the existing seeds, there is no offline unit test of the HTTP flow — the gate is a live smoke test; the pure helpers in `seed-altar.test.ts` are unaffected.)

**Files:** `app/apps/brain/src/seed-altar.ts`

**Interfaces:**
- Consumes: `POST /api/register`, `POST /api/visitors/:id/intake`, `POST /api/visitors/:id/pose`, `POST /api/checkin {number, station}`, `POST /api/dispatch/complete {visitorId}`, `GET /api/visitors/by-number/:number` (all existing).
- Produces: visitors with `intakeAt + poseAt + paperAt + offeringAt`, `waiting`.

**Steps:**

- [ ] In `app/apps/brain/src/seed-altar.ts`, import `Station` type and pull `get` off the client:

  ```ts
  import type { Station, VisitorProfile } from "@channelers/shared";
  ```
  ```ts
  const client = makeClient(BASE);
  const { get, post } = client;
  ```

- [ ] Replace `seedOne` and add a `completeStation` helper:

  ```ts
  /** Drive a station to completion via the operator-override path: force the visitor
   *  in_progress at the station, then Done (markComplete stamps its milestone, repools). */
  async function completeStation(number: number, visitorId: string, station: Station): Promise<void> {
    await post("/api/checkin", { number, station });
    await post("/api/dispatch/complete", { visitorId });
  }

  /** Drive one visitor through every pre-altar station, leaving them altar-ready. */
  async function seedOne(number: number, name: string): Promise<VisitorProfile> {
    const registered = await post<VisitorProfile>("/api/register", { number });
    const id = registered.id;
    await post<VisitorProfile>(`/api/visitors/${id}/intake`, { survey: sampleSurvey(name) }); // → intakeAt
    await post<VisitorProfile>(`/api/visitors/${id}/pose`, { template: samplePose() });        // → poseAt
    await completeStation(number, id, "paper");                                                 // → paperAt
    await completeStation(number, id, "offering");                                              // → offeringAt
    return get<VisitorProfile>(`/api/visitors/by-number/${number}`);                            // final, all four stamped
  }
  ```

- [ ] Rewrite the header docblock so it reflects the new flow (replace the lines describing `register → intake → pose` and the now-obsolete paper-soak note):

  ```
   * Each fake visitor drives the SAME public endpoints a real one would, in order:
   *   register → intake (survey) → pose (body-scan) → paper (Done) → offering (Done)
   * which stamps all four pre-altar milestones (intakeAt, poseAt, paperAt, offeringAt) and
   * leaves the visitor `waiting` with no `sessionEndAt` — exactly the predicate the system keys
   * "altar-ready" off of (shared `isAltarReady` / `clearedPreAltarStations`).
   *
   * Paper + offering are completed through the operator-override path (`POST /api/checkin` →
   * `POST /api/dispatch/complete`), so no new brain routes. Because every station is done, an
   * altar-ready seed is no longer eligible for any soak station — it just waits for the altar.
  ```
  (Delete the old "Note: a fresh registrant is held out of dispatch…/pending paper occupant" paragraph — it no longer applies.)

- [ ] Typecheck, expect PASS:

  ```
  pnpm --filter @channelers/brain typecheck
  # → 0 errors
  ```

- [ ] Live smoke against an isolated brain (does not touch a running dev brain on :8787):

  ```
  cd app && PORT=8799 OSC_PORT=57130 pnpm --filter @channelers/brain start &   # wait until ":8799" logged
  pnpm seed:altar --count 4 --base http://127.0.0.1:8799
  curl -s http://127.0.0.1:8799/api/dispatch | python3 -c "import sys,json; d=json.load(sys.stdin); print('altarReady', d['altarReady'], [e['number'] for e in d['altarReadyList']])"
  # → expect: altarReady 4 [9000, 9001, 9002, 9003]
  ```
  Then per-visitor confirm all four milestones are set:
  ```
  curl -s http://127.0.0.1:8799/api/visitors | python3 -c "
  import sys,json
  for v in json.load(sys.stdin):
      ok = all(v.get(k) for k in ('intakeAt','poseAt','paperAt','offeringAt')) and v['location']['state']=='waiting'
      print(f\"#{v['number']} intake={bool(v.get('intakeAt'))} pose={bool(v.get('poseAt'))} paper={bool(v.get('paperAt'))} offering={bool(v.get('offeringAt'))} altarReady={ok}\")
  "
  # → every row altarReady=True
  ```
  Stop the isolated brain (`kill %1` / the printed pid) when done.

- [ ] Commit:

  ```
  git add app/apps/brain/src/seed-altar.ts
  git commit -m "$(cat <<'EOF'
  feat(seed): seed:altar completes paper + offering so visitors are truly altar-ready

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — Docs

**Files:** `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`

**Steps:**

- [ ] In `docs/ARCHITECTURE.md` §5 "Selection" (line ~184), update the altar eligibility clause from `altar ← intakeAt + poseAt set, no sessionEndAt, and the operator altar gate is open` to: `altar ← ALL pre-altar stations done (intakeAt + poseAt + paperAt + offeringAt), no sessionEndAt, and the operator altar gate is open`. Update any nearby "altar-ready (count of waiting intake+pose visitors)" phrasing (e.g. the `dispatch.state` description, line ~217) to "waiting visitors who have cleared all pre-altar stations".

- [ ] In §5.7 / the §5.x altar-ready definition, note that altar-readiness now requires the full circuit including `paper` and `offering`, via the shared `clearedPreAltarStations` predicate.

- [ ] Add the top entry to `docs/CHANGELOG.md`:

  ```
  ## 2026-06-27 — Altar-ready now requires the full station circuit (paper + time-offering gate too)

  - **What:** "Altar-ready" went from intake + bodyscan to **all four** pre-altar stations — intake, bodyscan, paper, and the time-offering room. New shared `clearedPreAltarStations(v)` (`intakeAt && poseAt && paperAt && offeringAt`) is the single source of truth; both `isAltarReady` (shared) and the dispatcher's altar-eligibility line route through it. `/board` ALTAR READY, the Pluribus broadcast, the `/dispatch` flow strip + right-column roster, and the altar dispatch all tighten automatically. Stations stay any-order; only the altar waits for the full set. `pnpm seed:altar` now completes paper + offering (via `POST /api/checkin` → `POST /api/dispatch/complete`) so its visitors are genuinely altar-ready.
  - **Why:** The performance flow requires a visitor to complete the whole circuit before divination. Side benefit: an altar-ready visitor has already done the soak stations, so the prior "pending-paper occupant can block altar dispatch" wrinkle is gone.
  - **Files/areas:** `packages/shared/src/{schemas,protocol}.ts`; `apps/brain/src/{dispatcher,seed-altar}.ts` (+ tests `{schema,dispatcher}.test.ts`, `apps/stage/src/lib/pluribus.test.ts`). Branch `friday-preshow`. Plan: `docs/superpowers/plans/2026-06-27-altar-ready-all-stations.md`.
  - **Verification:** TDD red→green; `pnpm --filter @channelers/brain typecheck` + `pnpm --filter @channelers/stage typecheck` 0 errors; brain + stage suites green. Live smoke: isolated brain on :8799, `pnpm seed:altar --count 4` → `altarReady: 4`, every seeded visitor has all four milestones.
  - **Docs touched:** this entry; `docs/ARCHITECTURE.md` (§5 selection eligibility + altar-ready definition).
  ```

- [ ] Commit:

  ```
  git add docs/ARCHITECTURE.md docs/CHANGELOG.md
  git commit -m "$(cat <<'EOF'
  docs: altar-ready requires the full station circuit

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Verification checklist (whole change)

- [ ] `pnpm --filter @channelers/brain typecheck` — 0 errors
- [ ] `pnpm --filter @channelers/stage typecheck` — 0 errors
- [ ] `pnpm --filter @channelers/brain test` — green
- [ ] `pnpm --filter @channelers/stage test` — green
- [ ] Live: `seed:altar --count N` against an isolated brain → `altarReady === N`, every visitor has intakeAt+poseAt+paperAt+offeringAt and is `waiting`
- [ ] A visitor with only intake+pose is NOT dispatched to an open altar (the discriminating dispatcher test)
