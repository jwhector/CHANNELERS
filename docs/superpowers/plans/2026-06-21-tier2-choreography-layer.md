# CHANNELERS — Tier 2: Choreography Layer (design + plan)

> Status: **plan, awaiting review** · Date: **2026-06-21** · Owner: Jared
> Implements **Tier 2** of `docs/superpowers/specs/2026-06-19-multi-station-architecture-design.md` (§7 pipeline split, §8 the two AI loops).
> Tier 0, Tier 1, and Tier 3 are already built. This is the last tier. This doc is both the spec and the task-by-task plan, behind one review gate.

---

## 1. Header

- **Goal:** Add a second live AI loop that turns each divination turn into natural-language movement cues for dancers — seeded at persona-set, reacting per-turn, on its own feed off the same session as the oracle.
- **Approach:** (1) Reconcile the generation pipeline per spec §7 — `transform()` becomes **music-only**, the dead `dance`/`persona` seeds are deleted, and an archetype-aware **choreography first-pass** is generated at persona-set. (2) Add a **choreographer agent** that fans out from each visitor utterance in `say()`, streaming `choreo.delta`/`choreo.done` on a screens-only WS channel, with **configurable** timing (reacts to the oracle reply, or runs independently). (3) A read-only **`/choreo`** view renders the cues and hosts the timing toggle.
- **Tech stack:** TypeScript monorepo (pnpm). Brain = Fastify + `ws` + OpenAI SDK; stage = Vite/React; `packages/shared` (zod + protocol), `packages/oracles` (prompt builders). Tests: vitest. LLM = **OpenAI gpt-4o** (`config.choreoModel`, default `gpt-4o`).

## 2. Why / design

### Problem
The spec (2026-06-19) predates the work that has since landed: Tier 3 dispatcher, the Altered-State Console tuning system, the OpenAI provider switch (the spec says "Sonnet 4.6" — the project uses **gpt-4o**), and cloud STT/TTS. Tier 2 is the only unbuilt tier. It must slot into the *current* code, not the spec's assumptions.

Today `transform()` makes all three seeds (`music` + `dance` + `persona`) at intake-submit. Two of those are dead/stale: `seeds.persona` is never read (the live loop builds the persona fresh via `buildPersona()`), and `seeds.dance` is archetype-agnostic and consumed by nothing. The choreography layer needs the archetype, which only arrives at the altar — so generation must split by input-readiness (spec §7).

### Scope (decided with the owner)
- **Full §7 split** — delete the dead `persona` seed, make `transform()` music-only, and let the persona-set **choreography first-pass** be the archetype-aware movement score (it replaces the old agnostic `dance` seed).
- **Configurable cue timing** — a live-toggleable `reactToOracle` flag: when on, the per-turn cue reacts to the visitor utterance **and** the oracle reply (spec §8 default); when off, it runs in parallel from the utterance alone, independent of the oracle.
- **WS stream + `/choreo` view** — `choreo.delta`/`choreo.done` over WebSocket (screens-only, off the OSC contract), plus a minimal read-only `/choreo` screen to watch/project. Final in-ear vs loudspeaker **routing stays deferred** (open question).
- **Baseline tuning for MVP** — the choreographer uses baseline sampling; the Altered-State dials stay oracle/transform-only (no `applyToChoreo` axis yet).

### Approaches considered
- **Additive-only** (leave `transform()` untouched, add choreo alongside): smallest blast radius, but leaves the stale agnostic `dance` seed and dead `persona` seed in place — deferring §7 indefinitely. **Rejected** in favor of doing §7 now while we're in this code.
- **Structured first-pass** (reuse a `DanceScore`-shaped object): more parseable, but the whole live layer is NL by spec §8 and the first-pass only feeds the live agent's prompt — a structured object would just be re-serialized into text. **Rejected** in favor of an NL movement score.
- **Config-only timing** (env + restart): a brain restart wipes the in-memory visitor store mid-rehearsal. **Rejected** in favor of a live in-memory toggle (`POST /api/choreo/config`).
- **Choreo on the OSC contract** (emit a `choreo.cue` ShowEvent): choreography is outward-facing, but it's a per-token *stream* (doesn't fit OSC), and the project precedent is that non-event live channels (dispatcher, tuning) ride their own WS messages. **Deferred** — a final-cue ShowEvent can be added later if a collaborator needs it over OSC.

### Decision log
- **D1 — Pipeline split (§7):** `Seeds = { music }`; `dance`/`persona` deleted; choreography first-pass generated at persona-set. *Why:* archetype arrives late; remove dead/stale code.
- **D2 — First-pass = NL score** (`ChoreoScore = { score: string }`). *Why:* the layer is NL end-to-end; it only seeds the live agent's prompt.
- **D3 — Fan-out point = `say()`**, fire-and-forget + try/catch. *Why:* a choreo failure must never disturb the oracle turn (offline-resilient principle).
- **D4 — Timing configurable & live** (`reactToOracle`, default `true`). *Why:* the owner wants to flip behavior during rehearsal without a store-wiping restart.
- **D5 — `choreo.delta`/`choreo.done` are `WsServerMsg`, not `ShowEvent`s.** *Why:* same precedent as dispatcher + tuning — non-event live channels stay off the OSC contract.
- **D6 — Model = `config.choreoModel` (default gpt-4o), streaming**, mirroring the oracle loop. *Why:* proven pattern in `divination.ts`; closes the spec's "Sonnet 4.6" drift.
- **D7 — Baseline sampling for choreo** (no tuning scope). *Why:* keep scope tight; add `applyToChoreo` later if wanted.

## 3. Global constraints

Every task implicitly includes these.

- **Language/typecheck:** all TypeScript. After each task: `pnpm -r typecheck` must report **0 errors** across all 4 packages.
- **Tests run offline:** the test environment has **no `OPENAI_API_KEY`**, so all AI calls take the deterministic fallback/stub path. Every new test relies on that determinism — never asserts on live model output.
- **Offline-resilient:** every new AI call (`generateFirstPass`, `streamCue`) MUST degrade to a deterministic local result when `config.openaiApiKey` is unset or the call throws. The oracle turn must succeed even if choreo throws.
- **Off the OSC contract:** `choreo.*` is screens-only WS. Do **not** add anything to `packages/shared/src/events.ts` or `OSC_ADDRESSES`.
- **OpenAI usage:** mirror the existing streaming pattern in [divination.ts:259](../../../app/apps/brain/src/divination.ts#L259) — `client.chat.completions.create({ model, stream: true, messages })`, iterated `for await … chunk.choices[0]?.delta?.content`. OpenAI caches prompt prefixes automatically (no manual step). Per `docs/CLAUDE.md`, sanity-check the OpenAI reference at build if anything looks off — but this is the same call the oracle already makes.
- **Verification commands** (exact):
  - `pnpm -r typecheck`
  - `pnpm --filter @channelers/brain test`
  - `pnpm --filter @channelers/stage test`
  - `pnpm --filter @channelers/stage build`
- **Changelog:** each task appends a `docs/CHANGELOG.md` entry (newest on top: what / why / files-areas / docs-touched), per project convention.
- **Working directory:** all paths below are relative to `app/` (the monorepo root). Run pnpm commands from `app/`.

## 4. File structure

**Created:**
- `app/packages/oracles/src/choreographer.ts` — pure prompt builders + clarity instruction for the choreographer (no API calls). Mirrors `buildPrompt.ts`/`denylist.ts`.
- `app/apps/brain/src/choreo.ts` — brain-side choreo engine: first-pass generation, live cue streaming, deterministic fallbacks, and the live `reactToOracle` flag. Mirrors `transform.ts`/`tuning.ts`.
- `app/apps/stage/src/routes/Choreo.tsx` — the `/choreo` view: `Choreo` (socket-wired route) + `ChoreoDisplay` (pure, unit-testable presentational export).
- `app/apps/brain/test/transform.test.ts` — music-only transform.
- `app/apps/brain/test/choreographer.test.ts` — pure choreographer prompt builders.
- `app/apps/brain/test/choreo.test.ts` — first-pass + live cue offline determinism + the live toggle.
- `app/apps/stage/src/routes/Choreo.test.tsx` — `ChoreoDisplay` render + toggle.

**Modified:**
- `app/packages/shared/src/schemas.ts` — `Seeds → { music }`; delete `DanceScore`; add `ChoreoScore`.
- `app/packages/shared/src/protocol.ts` — add `choreo.delta` / `choreo.done` to `WsServerMsg`.
- `app/packages/oracles/src/index.ts` — export `./choreographer`.
- `app/apps/brain/src/transform.ts` — music-only stub + prompt.
- `app/apps/brain/src/config.ts` — `choreoModel` + `choreo.reactToOracle`.
- `app/apps/brain/src/store.ts` — `choreoFirstPass` field + `setChoreoFirstPass`.
- `app/apps/brain/src/divination.ts` — `Session` choreo context; `say()` fan-out to `runChoreo`.
- `app/apps/brain/src/app.ts` — persona endpoint kicks off first-pass; `GET`/`POST /api/choreo/config`.
- `app/apps/stage/src/lib/api.ts` — `choreo.config` / `choreo.setConfig`.
- `app/apps/stage/src/App.tsx` — `/choreo` route + `SCREENS`.
- `app/apps/brain/test/schema.test.ts` — `ChoreoScore` parse.
- `app/apps/brain/test/store.test.ts` — `setChoreoFirstPass`.
- `app/apps/brain/test/endpoints.test.ts` — persona populates first-pass; `/api/choreo/config`; the ws fan-out integration test.
- Docs: `docs/ARCHITECTURE.md`, `app/CLAUDE.md`, `docs/CHANGELOG.md`.

---

## 5. Tasks

### Task 1 — Slim `Seeds` to music-only (delete dead `dance`/`persona` seeds)

Removes the §7 dead code so the choreography first-pass can own movement generation. Confirmed safe: `dance`/`persona` seeds have **zero consumers** (the live loop builds its persona via `buildPersona`; nothing reads `seeds.dance`).

**Files:**
- Modify `packages/shared/src/schemas.ts`
- Modify `apps/brain/src/transform.ts`
- Create `apps/brain/test/transform.test.ts`

**Interfaces:**
- Consumes: `MusicSeed`, `OraclePersona` (unchanged, stay exported).
- Produces: `Seeds = { music: MusicSeed }` (narrowed). `DanceScore` removed.

**Steps:**
- [ ] Write the failing test `apps/brain/test/transform.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { transform } from "../src/transform";
  import { Seeds, type VisitorProfile } from "@channelers/shared";

  const ts = "2026-06-21T00:00:00.000Z";
  const profile: VisitorProfile = {
    id: "t1", number: 1, scans: [],
    location: { state: "waiting", since: ts }, createdAt: ts,
    survey: { name: "Jo", freeText: { lost: "my keys" }, phrases: [] },
  };

  describe("transform (music-only, §7)", () => {
    it("returns a music seed and no dance/persona (offline stub)", async () => {
      const seeds = await transform(profile);
      expect(seeds.music.mood).toBeTruthy();
      expect((seeds as Record<string, unknown>).dance).toBeUndefined();
      expect((seeds as Record<string, unknown>).persona).toBeUndefined();
      expect(Seeds.safeParse(seeds).success).toBe(true);
    });
  });
  ```
- [ ] Run it, expect FAIL (the stub still returns `dance`/`persona`): `pnpm --filter @channelers/brain test transform`
- [ ] In `packages/shared/src/schemas.ts`, delete the `DanceScore` schema+type (lines defining `export const DanceScore` / `export type DanceScore`) and narrow `Seeds`:
  ```ts
  export const Seeds = z.object({
    music: MusicSeed,
  });
  export type Seeds = z.infer<typeof Seeds>;
  ```
  Leave `MusicSeed` and `OraclePersona` exactly as they are (both still used elsewhere).
- [ ] In `apps/brain/src/transform.ts`, replace the `stubSeeds` body and the prompt so neither mentions dance/persona:
  ```ts
  function stubSeeds(profile: VisitorProfile): Seeds {
    const lost = profile.survey?.freeText.lost ?? "something nameless";
    return {
      music: {
        mood: "fluorescent melancholy",
        tempoBpm: 96,
        key: "A minor",
        lyricThemes: ["waiting rooms", lost, "being processed"],
        synthPalette: ["detuned saw pad", "DX bell", "tape hiss"],
      },
    };
  }
  ```
  And the system-prompt content in the live call:
  ```ts
          content:
            "You convert an absurdist DMV-style intake survey into JSON 'seeds' for a performance. " +
            "Return ONLY JSON of this shape: " +
            "{ music:{ mood, tempoBpm, key, lyricThemes[], synthPalette[] } }.",
  ```
- [ ] Run the test, expect PASS: `pnpm --filter @channelers/brain test transform`
- [ ] Typecheck all packages, expect 0 errors: `pnpm -r typecheck`
- [ ] Append a CHANGELOG entry, then commit:
  ```bash
  git add -A && git commit -m "feat(shared,brain): slim Seeds to music-only (delete dead dance/persona seeds, §7)"
  ```

---

### Task 2 — Shared: `ChoreoScore` type + `choreo.delta`/`choreo.done` WS messages

Adds the data vocabulary the rest of the tier consumes. Purely additive.

**Files:**
- Modify `packages/shared/src/schemas.ts`
- Modify `packages/shared/src/protocol.ts`
- Modify `apps/brain/test/schema.test.ts`

**Interfaces:**
- Produces: `ChoreoScore = { score: string }`; `WsServerMsg` gains `{ kind: "choreo.delta"; sessionId; text }` and `{ kind: "choreo.done"; sessionId; text }`.

**Steps:**
- [ ] Append a failing test to `apps/brain/test/schema.test.ts`:
  ```ts
  describe("ChoreoScore", () => {
    it("parses a movement score", () => {
      const r = ChoreoScore.safeParse({ score: "Step forward. Freeze." });
      expect(r.success).toBe(true);
    });
    it("rejects a missing score", () => {
      expect(ChoreoScore.safeParse({}).success).toBe(false);
    });
  });
  ```
  Add `ChoreoScore` to the existing `@channelers/shared` import at the top of the file.
- [ ] Run it, expect FAIL (ChoreoScore undefined): `pnpm --filter @channelers/brain test schema`
- [ ] In `packages/shared/src/schemas.ts`, add next to `MusicSeed`:
  ```ts
  /** Choreography first-pass: an NL movement "score" generated at persona-set (spec §7). */
  export const ChoreoScore = z.object({
    score: z.string(),
  });
  export type ChoreoScore = z.infer<typeof ChoreoScore>;
  ```
- [ ] In `packages/shared/src/protocol.ts`, add to the `WsServerMsg` union (next to `oracle.delta`/`oracle.done`):
  ```ts
    | { kind: "choreo.delta"; sessionId: string; text: string }
    | { kind: "choreo.done"; sessionId: string; text: string }
  ```
- [ ] Run the test, expect PASS: `pnpm --filter @channelers/brain test schema`
- [ ] Typecheck, expect 0 errors: `pnpm -r typecheck`
- [ ] Append a CHANGELOG entry, then commit:
  ```bash
  git add -A && git commit -m "feat(shared): ChoreoScore type + choreo.delta/choreo.done WS messages"
  ```

---

### Task 3 — Choreographer prompt module (`packages/oracles`)

Pure prompt builders + the clarity instruction (the §8 "clarity mirror of the oracle's anti-slop deny-list"). No API calls — mirrors `buildPrompt.ts`.

**Files:**
- Create `packages/oracles/src/choreographer.ts`
- Modify `packages/oracles/src/index.ts`
- Create `apps/brain/test/choreographer.test.ts`

**Interfaces:**
- Consumes: `SurveyResponse` (from `@channelers/shared`).
- Produces: `CHOREO_CLARITY_INSTRUCTION`, `CHOREO_SCORE_INSTRUCTION`, `buildChoreoFirstPassPrompt(survey, archetype) → { system, user }`, `buildChoreoSystemPrompt(survey, archetype, firstPass) → string`, `buildChoreoTurnPrompt({ visitor, oracle? }) → string`.

**Steps:**
- [ ] Write the failing test `apps/brain/test/choreographer.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    CHOREO_CLARITY_INSTRUCTION,
    buildChoreoFirstPassPrompt,
    buildChoreoSystemPrompt,
    buildChoreoTurnPrompt,
  } from "@channelers/oracles";
  import type { SurveyResponse } from "@channelers/shared";

  const survey: SurveyResponse = {
    name: "Jo", freeText: { lost: "my keys" },
    phrases: [{ axis: "tension", choice: "a held breath" }],
  };

  describe("choreographer prompts", () => {
    it("first-pass prompt embeds the archetype and the intake facts", () => {
      const { system, user } = buildChoreoFirstPassPrompt(survey, "tree");
      expect(system).toContain("tree");
      expect(user).toContain("my keys");
    });
    it("live system prompt embeds the first pass + the clarity rules", () => {
      const sys = buildChoreoSystemPrompt(survey, "tree", "Enter slowly.");
      expect(sys).toContain("Enter slowly.");
      expect(sys).toContain(CHOREO_CLARITY_INSTRUCTION);
    });
    it("turn prompt includes the oracle reply only when given", () => {
      expect(buildChoreoTurnPrompt({ visitor: "hi" })).not.toContain("oracle replied");
      expect(buildChoreoTurnPrompt({ visitor: "hi", oracle: "sit" })).toContain("oracle replied");
    });
  });
  ```
- [ ] Run it, expect FAIL (module missing): `pnpm --filter @channelers/brain test choreographer`
- [ ] Create `packages/oracles/src/choreographer.ts`:
  ```ts
  import type { SurveyResponse } from "@channelers/shared";

  /**
   * The choreographer translates each divination turn into a movement cue for live dancers.
   * Its system prompt is functional (an instructor to bodies), NOT a character — the clarity
   * rules below are the mirror of the oracle's ANTI_SLOP_INSTRUCTION (spec §8).
   */
  const CLARITY_CORE =
    "Name concrete, performable actions — body part, direction, quality, timing. " +
    "Present tense, addressed to the dancers' bodies. " +
    "No abstract-only or metaphor-only directions, no questions, no explanations, no lists, no stage jargon. " +
    "Anyone reading it cold must be able to perform it immediately.";

  /** Per-turn cue: a single short, followable movement. */
  export const CHOREO_CLARITY_INSTRUCTION =
    "Output ONE movement cue of one or two short imperative sentences. " + CLARITY_CORE;

  /** First pass: a short opening score of a few movement ideas. */
  export const CHOREO_SCORE_INSTRUCTION =
    "Write a 2–4 line opening movement score, each line one performable movement idea. " + CLARITY_CORE;

  function facts(survey: SurveyResponse): string {
    return [
      `Name: ${survey.name}`,
      ...Object.entries(survey.freeText).map(([k, v]) => `${k}: ${v}`),
      ...survey.phrases.map((p) => `${p.axis}: ${p.choice}`),
    ].join("\n");
  }

  /** f(intake, archetype) — generated at persona-set. Split system/user so the call can prompt-cache. */
  export function buildChoreoFirstPassPrompt(
    survey: SurveyResponse,
    archetype: string,
  ): { system: string; user: string } {
    const system = [
      "You are a choreographer translating a person's absurdist DMV-intake into a short movement score for live dancers.",
      `The oracle they will meet is the "${archetype}" archetype — let it color the movement's quality.`,
      CHOREO_SCORE_INSTRUCTION,
      "Return only the score lines — no preamble.",
    ].join("\n\n");
    return { system, user: facts(survey) };
  }

  /** Stable per-session prefix for the live loop: persona-colored first pass + intake + clarity rules. */
  export function buildChoreoSystemPrompt(
    survey: SurveyResponse,
    archetype: string,
    firstPass: string,
  ): string {
    return [
      `You are the choreographer for a live divination ritual. The visitor is meeting the "${archetype}" oracle.`,
      "Each turn you receive what the visitor said (and sometimes the oracle's reply); you answer with ONE movement cue for the dancers.",
      "",
      "Your opening movement score (the first pass, from their intake):",
      firstPass,
      "",
      "Their intake, for reference:",
      facts(survey),
      "",
      CHOREO_CLARITY_INSTRUCTION,
    ].join("\n");
  }

  /** The per-turn user message. Includes the oracle reply only when timing reacts to it. */
  export function buildChoreoTurnPrompt(turn: { visitor: string; oracle?: string }): string {
    const lines = [`The visitor said: "${turn.visitor}"`];
    if (turn.oracle) lines.push(`The oracle replied: "${turn.oracle}"`);
    lines.push("Give the next movement cue.");
    return lines.join("\n");
  }
  ```
- [ ] Add to `packages/oracles/src/index.ts`:
  ```ts
  export * from "./choreographer";
  ```
- [ ] Run the test, expect PASS: `pnpm --filter @channelers/brain test choreographer`
- [ ] Typecheck, expect 0 errors: `pnpm -r typecheck`
- [ ] Append a CHANGELOG entry, then commit:
  ```bash
  git add -A && git commit -m "feat(oracles): choreographer prompt builders + clarity instruction (§8)"
  ```

---

### Task 4 — Brain choreo module: config, first-pass generation, store, live toggle

The brain-side engine. First-pass generation (called at persona-set), the deterministic fallbacks, and the live `reactToOracle` flag with its endpoints. The live per-turn streaming is added in Task 5.

**Files:**
- Modify `apps/brain/src/config.ts`
- Modify `apps/brain/src/store.ts`
- Create `apps/brain/src/choreo.ts`
- Modify `apps/brain/src/app.ts`
- Modify `apps/brain/test/store.test.ts`
- Create `apps/brain/test/choreo.test.ts`
- Modify `apps/brain/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `buildChoreoFirstPassPrompt` (Task 3); `ChoreoScore` (Task 2); `VisitorRecord` (store).
- Produces:
  - `config.choreoModel: string`, `config.choreo.reactToOracle: boolean`.
  - `store.setChoreoFirstPass(id, score: ChoreoScore)`; `VisitorRecord.choreoFirstPass?: ChoreoScore`.
  - `choreo.ts`: `generateFirstPass(visitor) → Promise<ChoreoScore>`, `stubFirstPass(survey, archetype) → ChoreoScore`, `getChoreoConfig() → { reactToOracle }`, `setChoreoConfig({ reactToOracle }) → { reactToOracle }`.
  - HTTP: `GET /api/choreo/config`, `POST /api/choreo/config { reactToOracle }`.

**Steps:**
- [ ] Add to `apps/brain/src/config.ts` (inside the exported `config` object, after `elevenLabsModel`):
  ```ts
    // Choreography agent: second live loop (apps/brain/src/choreo.ts). Mirrors the oracle model.
    choreoModel: process.env.CHOREO_MODEL ?? "gpt-4o",
    choreo: {
      /** When true, the per-turn cue reacts to the visitor utterance AND the oracle reply (spec §8);
       *  when false it runs in parallel from the utterance alone. Live-toggleable at /api/choreo/config. */
      reactToOracle: process.env.CHOREO_REACT_TO_ORACLE !== "false",
    },
  ```
- [ ] Write the failing store test — append to `apps/brain/test/store.test.ts`:
  ```ts
  it("stores a choreography first-pass on the record", () => {
    const v = store.register(7701);
    store.upsertSurvey(v.id, { name: "Jo", freeText: {}, phrases: [] });
    const out = store.setChoreoFirstPass(v.id, { score: "Enter slowly." });
    expect(out?.choreoFirstPass?.score).toBe("Enter slowly.");
  });
  ```
- [ ] Run it, expect FAIL: `pnpm --filter @channelers/brain test store`
- [ ] In `apps/brain/src/store.ts`: import `ChoreoScore` (add to the existing `@channelers/shared` type import), extend the record type and add the setter:
  ```ts
  export type VisitorRecord = VisitorProfile & { seeds?: Seeds; choreoFirstPass?: ChoreoScore };
  ```
  ```ts
    setChoreoFirstPass(id: string, score: ChoreoScore): VisitorRecord | undefined {
      const v = visitors.get(id);
      if (v) v.choreoFirstPass = score;
      return v;
    },
  ```
- [ ] Run the store test, expect PASS: `pnpm --filter @channelers/brain test store`
- [ ] Write the failing choreo test `apps/brain/test/choreo.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { generateFirstPass, getChoreoConfig, setChoreoConfig } from "../src/choreo";
  import { store } from "../src/store";

  describe("choreo first-pass (offline stub)", () => {
    it("produces a non-empty deterministic score from intake + archetype", async () => {
      const v = store.register(7801);
      store.upsertSurvey(v.id, { name: "Jo", freeText: { lost: "my keys" }, phrases: [] });
      store.setArchetype(v.id, "tree");
      const a = await generateFirstPass(store.get(v.id)!);
      const b = await generateFirstPass(store.get(v.id)!);
      expect(a.score.length).toBeGreaterThan(0);
      expect(a.score).toBe(b.score); // deterministic offline
    });
  });

  describe("choreo live config flag", () => {
    beforeEach(() => setChoreoConfig({ reactToOracle: true }));
    it("toggles reactToOracle", () => {
      expect(getChoreoConfig().reactToOracle).toBe(true);
      expect(setChoreoConfig({ reactToOracle: false }).reactToOracle).toBe(false);
      expect(getChoreoConfig().reactToOracle).toBe(false);
    });
  });
  ```
- [ ] Run it, expect FAIL (module missing): `pnpm --filter @channelers/brain test choreo`
- [ ] Create `apps/brain/src/choreo.ts` (first-pass + fallbacks + flag; `streamCue` is added in Task 5):
  ```ts
  import { buildChoreoFirstPassPrompt, buildChoreoTurnPrompt } from "@channelers/oracles";
  import type { ChoreoScore, SurveyResponse } from "@channelers/shared";
  import { config } from "./config";
  import type { VisitorRecord } from "./store";

  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── live, in-memory config (flippable at /api/choreo/config, no restart) ──
  let reactToOracle = config.choreo.reactToOracle;
  export function getChoreoConfig(): { reactToOracle: boolean } {
    return { reactToOracle };
  }
  export function setChoreoConfig(next: { reactToOracle: boolean }): { reactToOracle: boolean } {
    reactToOracle = next.reactToOracle;
    return getChoreoConfig();
  }

  // ── deterministic offline content (mirrors transform.stubSeeds / divination.fallbackLine) ──
  export function stubFirstPass(survey: SurveyResponse, archetype: string): ChoreoScore {
    const lost = survey.freeText.lost ?? "something nameless";
    return {
      score: [
        "Enter slowly, single file, as if waiting to be processed.",
        `Reach one hand toward "${lost}", then withdraw it.`,
        `Shape the whole body to the idea of a ${archetype}, and hold.`,
      ].join("\n"),
    };
  }

  export function fallbackCue(visitor: string, oracle?: string): string {
    const src = (oracle ?? visitor).split(/\s+/).slice(0, 4).join(" ") || "this moment";
    return `Step forward together, then freeze as if the words "${src}" just landed on your shoulders.`;
  }

  /** Stream a fixed line word-by-word (offline cadence), mirroring divination.streamWords. */
  async function streamWords(line: string, onDelta: (chunk: string) => void): Promise<string> {
    let acc = "";
    for (const word of line.split(" ")) {
      const chunk = acc ? ` ${word}` : word;
      acc += chunk;
      onDelta(chunk);
      await delay(35);
    }
    return acc;
  }

  /** f(intake, archetype) → an NL movement score, generated at persona-set. Stub when no key/on error. */
  export async function generateFirstPass(visitor: VisitorRecord): Promise<ChoreoScore> {
    const archetype = visitor.archetype ?? "tree";
    if (!visitor.survey) return { score: "" };
    if (!config.openaiApiKey) return stubFirstPass(visitor.survey, archetype);
    try {
      const { system, user } = buildChoreoFirstPassPrompt(visitor.survey, archetype);
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: config.openaiApiKey });
      const completion = await client.chat.completions.create({
        model: config.choreoModel,
        max_completion_tokens: 256,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const score = completion.choices[0]?.message?.content?.trim();
      return score ? { score } : stubFirstPass(visitor.survey, archetype);
    } catch (err) {
      console.warn("[choreo] first-pass fell back to stub:", err);
      return stubFirstPass(visitor.survey, archetype);
    }
  }

  // buildChoreoTurnPrompt is re-exported for the live loop (Task 5) to keep the import surface here.
  export { buildChoreoTurnPrompt };
  ```
- [ ] Run the choreo test, expect PASS: `pnpm --filter @channelers/brain test choreo`
- [ ] Wire the persona endpoint + config endpoints in `apps/brain/src/app.ts`. Add the import near the others:
  ```ts
  import { generateFirstPass, getChoreoConfig, setChoreoConfig } from "./choreo";
  ```
  In `POST /api/visitors/:id/persona`, after the `oracle.selected` publish and before `return v;`, add the fire-and-forget first-pass (mirrors the intake→seeds pattern):
  ```ts
    void generateFirstPass(v).then((fp) => store.setChoreoFirstPass(v.id, fp));
  ```
  Add the two config endpoints (e.g. just after the `/api/tts` route):
  ```ts
  app.get("/api/choreo/config", async () => getChoreoConfig());
  const ChoreoConfigBody = z.object({ reactToOracle: z.boolean() });
  app.post("/api/choreo/config", async (req, reply) => {
    const parsed = ChoreoConfigBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return setChoreoConfig(parsed.data);
  });
  ```
- [ ] Append endpoint tests to `apps/brain/test/endpoints.test.ts` (inside a new `describe`):
  ```ts
  describe("choreo first-pass + config", () => {
    it("setting persona populates a choreography first-pass on the record", async () => {
      const v = await register(6101);
      await app.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
        payload: { survey: { name: "Jo", freeText: { lost: "my keys" }, phrases: [] } } });
      await app.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`, payload: { archetype: "tree" } });
      // first-pass is generated fire-and-forget; poll the record briefly
      let score = "";
      for (let i = 0; i < 20 && !score; i++) {
        const rec = (await app.inject({ method: "GET", url: "/api/visitors" })).json()
          .find((r: { id: string }) => r.id === v.id);
        score = rec?.choreoFirstPass?.score ?? "";
        if (!score) await new Promise((r) => setTimeout(r, 25));
      }
      expect(score.length).toBeGreaterThan(0);
    });

    it("GET/POST /api/choreo/config round-trips the flag", async () => {
      const set = await app.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: false } });
      expect(set.json().reactToOracle).toBe(false);
      const get = await app.inject({ method: "GET", url: "/api/choreo/config" });
      expect(get.json().reactToOracle).toBe(false);
      // restore default so later tests see the spec-default behavior
      await app.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: true } });
    });
  });
  ```
- [ ] Run the brain suite, expect PASS: `pnpm --filter @channelers/brain test`
- [ ] Typecheck, expect 0 errors: `pnpm -r typecheck`
- [ ] Append a CHANGELOG entry, then commit:
  ```bash
  git add -A && git commit -m "feat(brain): choreo engine — first-pass at persona-set, store, live reactToOracle toggle"
  ```

---

### Task 5 — Live fan-out: `Session` choreo context + `say()` → `runChoreo`

The core of the tier: each visitor utterance fans out to the choreographer, streaming `choreo.delta`/`choreo.done`, with the configurable timing branch.

**Files:**
- Modify `apps/brain/src/choreo.ts` (add `streamCue`)
- Modify `apps/brain/src/divination.ts`
- Modify `apps/brain/test/choreo.test.ts`
- Modify `apps/brain/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `getChoreoConfig`, `stubFirstPass`, `streamCue` (choreo.ts); `buildChoreoSystemPrompt`, `buildChoreoTurnPrompt` (oracles).
- Produces: `streamCue(ctx, onDelta) → Promise<string>`; `choreo.delta`/`choreo.done` broadcasts per turn.

**Steps:**
- [ ] Add the failing `streamCue` test — append to the `describe("choreo first-pass (offline stub)"` area of `apps/brain/test/choreo.test.ts`:
  ```ts
  describe("choreo live cue (offline stub)", () => {
    it("streams a deterministic fallback cue and returns the full text", async () => {
      const { streamCue } = await import("../src/choreo");
      let streamed = "";
      const full = await streamCue(
        { systemPrompt: "sys", history: [], visitor: "where do I go", oracle: "nowhere" },
        (chunk) => { streamed += chunk; },
      );
      expect(full.length).toBeGreaterThan(0);
      expect(streamed).toBe(full); // every chunk was emitted
    });
  });
  ```
- [ ] Run it, expect FAIL (`streamCue` undefined): `pnpm --filter @channelers/brain test choreo`
- [ ] Add `streamCue` to `apps/brain/src/choreo.ts` (after `generateFirstPass`):
  ```ts
  type ChoreoTurn = { role: "user" | "assistant"; content: string };

  /** One per-turn cue. Streams via onDelta; falls back to a deterministic cue with no key/on error. */
  export async function streamCue(
    ctx: { systemPrompt: string; history: ChoreoTurn[]; visitor: string; oracle?: string },
    onDelta: (chunk: string) => void,
  ): Promise<string> {
    const userMsg = buildChoreoTurnPrompt({ visitor: ctx.visitor, oracle: ctx.oracle });
    if (!config.openaiApiKey) {
      return streamWords(fallbackCue(ctx.visitor, ctx.oracle), onDelta);
    }
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: config.openaiApiKey });
      const stream = await client.chat.completions.create({
        model: config.choreoModel,
        stream: true,
        messages: [
          { role: "system", content: ctx.systemPrompt },
          ...ctx.history.map((t) => ({ role: t.role, content: t.content })),
          { role: "user", content: userMsg },
        ],
      });
      let full = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      }
      return full || fallbackCue(ctx.visitor, ctx.oracle);
    } catch (err) {
      console.warn("[choreo] live cue fell back to stub:", err);
      return streamWords(fallbackCue(ctx.visitor, ctx.oracle), onDelta);
    }
  }
  ```
  Export the turn type for divination:
  ```ts
  export type { ChoreoTurn };
  ```
- [ ] Run the choreo test, expect PASS: `pnpm --filter @channelers/brain test choreo`
- [ ] Wire divination. In `apps/brain/src/divination.ts`:
  - Add to the `@channelers/oracles` import: `buildChoreoSystemPrompt`.
  - Add an import: `import { getChoreoConfig, streamCue, stubFirstPass, type ChoreoTurn } from "./choreo";`
  - Extend the `Session` interface:
    ```ts
      /** Stable per-session choreographer prefix (intake + archetype + first-pass). */
      choreoSystemPrompt: string;
      /** The choreographer's own running history (separate from the oracle's). */
      choreoHistory: ChoreoTurn[];
    ```
  - In `start()`, after `persona` is built and before constructing `session`, build the choreo context (the `if (!visitor.survey)` guard above guarantees `survey` exists here):
    ```ts
      const firstPass = visitor.choreoFirstPass?.score ?? stubFirstPass(visitor.survey, archetypeId).score;
      const choreoSystemPrompt = buildChoreoSystemPrompt(visitor.survey, archetypeId, firstPass);
    ```
    and add `choreoSystemPrompt` + `choreoHistory: []` to the `session` object literal.
  - Add a `runChoreo` closure inside `registerDivination` (next to `say`):
    ```ts
    /** Fan-out consumer: a movement cue per turn. Fire-and-forget — never disturbs the oracle turn. */
    async function runChoreo(session: Session, turn: { visitor: string; oracle?: string }): Promise<void> {
      const sessionId = session.id;
      try {
        const cue = await streamCue(
          { systemPrompt: session.choreoSystemPrompt, history: session.choreoHistory, ...turn },
          (chunk) => {
            if (sessions.has(sessionId)) bus.broadcast({ kind: "choreo.delta", sessionId, text: chunk });
          },
        );
        session.choreoHistory.push({ role: "user", content: buildChoreoTurnPrompt(turn) });
        session.choreoHistory.push({ role: "assistant", content: cue });
        if (sessions.has(sessionId)) bus.broadcast({ kind: "choreo.done", sessionId, text: cue });
      } catch (err) {
        console.warn("[choreo] turn failed:", err);
      }
    }
    ```
    Add `buildChoreoTurnPrompt` to the `./choreo` import (it's re-exported there).
  - In `say()`, branch the fan-out around the existing oracle stream. Replace the body from the `session.history.push({ role: "user", ... })` line through the `try { … } catch` with:
    ```ts
      session.history.push({ role: "user", content: text });
      bus.broadcast({ kind: "session.transcript", sessionId, role: "visitor", text });

      const reactToOracle = getChoreoConfig().reactToOracle;
      // Independent mode: kick the cue off in parallel from the utterance alone.
      if (!reactToOracle) void runChoreo(session, { visitor: text });

      try {
        const full = await streamReply(session, (chunk) => {
          if (sessions.has(sessionId)) bus.broadcast({ kind: "oracle.delta", sessionId, text: chunk });
        });
        session.history.push({ role: "assistant", content: full });
        bus.broadcast({ kind: "oracle.done", sessionId, text: full });
        bus.broadcast(rosterMsg());
        // Reactive mode: now that the oracle reply exists, react to utterance + reply.
        if (reactToOracle) void runChoreo(session, { visitor: text, oracle: full });
      } catch (err) {
        bus.broadcast({ kind: "session.error", sessionId, message: String(err) });
      }
    ```
- [ ] Add the failing ws fan-out integration test — append to `apps/brain/test/endpoints.test.ts` a new `describe` (mirrors the "divination guards" harness; uses its own listening app + numbers ≥ 9400 to avoid store collisions):
  ```ts
  describe("choreo fan-out (both timings)", () => {
    let cApp: FastifyInstance;
    let cPort: number;
    beforeAll(async () => {
      cApp = await buildApp();
      await cApp.listen({ host: "127.0.0.1", port: 0 });
      cPort = (cApp.server.address() as { port: number }).port;
    });
    afterAll(async () => { await cApp.close(); });

    async function oracleReady(n: number): Promise<string> {
      const v = (await cApp.inject({ method: "POST", url: "/api/register", payload: { number: n } })).json() as { id: string };
      await cApp.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
        payload: { survey: { name: "Jo", freeText: { lost: "keys" }, phrases: [] } } });
      await cApp.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`, payload: { archetype: "tree" } });
      await cApp.inject({ method: "POST", url: `/api/visitors/${v.id}/verify` });
      return v.id;
    }

    /** Start a session for visitorId, say one line, resolve with the set of message kinds seen. */
    function sayAndCollect(visitorId: string): Promise<Set<string>> {
      return new Promise((resolve, reject) => {
        const sock = new WebSocket(`ws://127.0.0.1:${cPort}/ws`);
        const seen = new Set<string>();
        const timer = setTimeout(() => { sock.close(); resolve(seen); }, 4000);
        let sid = "";
        sock.on("open", () => sock.send(JSON.stringify({ kind: "session.start", visitorId })));
        sock.on("message", (raw) => {
          const m = JSON.parse(raw.toString());
          if (m.kind === "session.started" && m.visitorId === visitorId) {
            sid = m.sessionId;
            sock.send(JSON.stringify({ kind: "session.say", sessionId: sid, text: "where do I go" }));
          }
          if (m.sessionId && m.sessionId === sid) seen.add(m.kind);
          if (seen.has("oracle.done") && seen.has("choreo.done")) {
            clearTimeout(timer); sock.close(); resolve(seen);
          }
        });
        sock.on("error", (e) => { clearTimeout(timer); reject(e); });
      });
    }

    it("reactive mode emits both oracle.* and choreo.*", async () => {
      await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: true } });
      const seen = await sayAndCollect(await oracleReady(9401));
      expect(seen.has("oracle.done")).toBe(true);
      expect(seen.has("choreo.delta")).toBe(true);
      expect(seen.has("choreo.done")).toBe(true);
    });

    it("independent mode still emits choreo.* (parallel to the oracle)", async () => {
      await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: false } });
      const seen = await sayAndCollect(await oracleReady(9402));
      expect(seen.has("choreo.done")).toBe(true);
      await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: true } });
    });
  });
  ```
- [ ] Run the brain suite, expect PASS: `pnpm --filter @channelers/brain test`
- [ ] Typecheck, expect 0 errors: `pnpm -r typecheck`
- [ ] Append a CHANGELOG entry, then commit:
  ```bash
  git add -A && git commit -m "feat(brain): live choreography fan-out in say() with configurable oracle-reactive timing"
  ```

> **Note (MVP limitation, log it):** `choreo.delta` carries `sessionId` but the MVP `/choreo` view does not de-multiplex concurrent sessions — with two simultaneous readings the live cue line interleaves. Acceptable while the altar is one-at-a-time; revisit with feed routing (open question §15/§12).
> **Note (rejoin):** choreo cues are ephemeral and are NOT replayed on `session.rejoin` (only the oracle history is). Acceptable for MVP.

---

### Task 6 — `/choreo` stage view + reactToOracle toggle + wiring

The verification/projection surface and the operator's live timing toggle.

**Files:**
- Modify `apps/stage/src/lib/api.ts`
- Create `apps/stage/src/routes/Choreo.tsx`
- Modify `apps/stage/src/App.tsx`
- Create `apps/stage/src/routes/Choreo.test.tsx`

**Interfaces:**
- Consumes: `useBrainSocket`, `api.choreo.config`/`setConfig`, `WsServerMsg` (`choreo.delta`/`choreo.done`).
- Produces: `Choreo` (route), `ChoreoDisplay` (pure presentational export).

**Steps:**
- [ ] Add to `apps/stage/src/lib/api.ts` inside the `api` object (e.g. after the `dispatch` group):
  ```ts
    choreo: {
      config: () => fetch("/api/choreo/config").then((r) => json<{ reactToOracle: boolean }>(r)),
      setConfig: (reactToOracle: boolean) =>
        post<{ reactToOracle: boolean }>("/api/choreo/config", { reactToOracle }),
    },
  ```
- [ ] Write the failing render test `apps/stage/src/routes/Choreo.test.tsx`:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { expect, test, vi } from "vitest";
  import { ChoreoDisplay } from "./Choreo";

  test("renders the current cue", () => {
    render(<ChoreoDisplay cue="Lower your gaze." log={[]} reactToOracle connected onToggle={() => {}} />);
    expect(screen.getByText("Lower your gaze.")).toBeInTheDocument();
  });

  test("toggling the checkbox fires onToggle with the new value", async () => {
    const onToggle = vi.fn();
    render(<ChoreoDisplay cue="" log={[]} reactToOracle={true} connected={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
  ```
- [ ] Run it, expect FAIL (module missing): `pnpm --filter @channelers/stage test Choreo`
- [ ] Create `apps/stage/src/routes/Choreo.tsx`:
  ```tsx
  import { useEffect, useRef, useState } from "react";
  import type { WsServerMsg } from "@channelers/shared";
  import { api } from "../lib/api";
  import { useBrainSocket } from "../lib/useBrainSocket";

  type CueLine = { sessionId: string; text: string };

  /** Pure presentational cue display — unit-testable without a socket. */
  export function ChoreoDisplay({
    cue, log, reactToOracle, connected, onToggle,
  }: {
    cue: string;
    log: CueLine[];
    reactToOracle: boolean;
    connected: boolean;
    onToggle: (next: boolean) => void;
  }) {
    return (
      <main className="void choreo">
        <header>
          <h1>Choreography</h1>
          <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
          <label className="toggle" style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={reactToOracle} onChange={(e) => onToggle(e.target.checked)} />{" "}
            react to oracle reply
          </label>
        </header>
        <div className="teleprompter choreo-cue">{cue || "…"}</div>
        <ul className="transcript">
          {log.map((l, i) => (
            <li key={i} className="bubble oracle"><span>{l.text}</span></li>
          ))}
        </ul>
      </main>
    );
  }

  export function Choreo() {
    const [cue, setCue] = useState("");
    const [log, setLog] = useState<CueLine[]>([]);
    const [reactToOracle, setReactToOracle] = useState(true);
    const live = useRef("");

    const { connected } = useBrainSocket((m: WsServerMsg) => {
      if (m.kind === "choreo.delta") {
        live.current += m.text;
        setCue(live.current);
      } else if (m.kind === "choreo.done") {
        live.current = "";
        setCue(m.text);
        setLog((l) => [{ sessionId: m.sessionId, text: m.text }, ...l].slice(0, 30));
      }
    });

    useEffect(() => {
      void api.choreo.config().then((c) => setReactToOracle(c.reactToOracle));
    }, []);

    function toggle(next: boolean) {
      setReactToOracle(next);
      void api.choreo.setConfig(next);
    }

    return (
      <ChoreoDisplay cue={cue} log={log} reactToOracle={reactToOracle} connected={connected} onToggle={toggle} />
    );
  }
  ```
- [ ] Wire the route in `apps/stage/src/App.tsx`: add the import `import { Choreo } from "./routes/Choreo";`, add `"choreo"` to the `SCREENS` tuple, and add `<Route path="/choreo" element={<Choreo />} />` next to `/channel`.
- [ ] Run the stage test, expect PASS: `pnpm --filter @channelers/stage test Choreo`
- [ ] Typecheck + build, expect 0 errors / success: `pnpm -r typecheck && pnpm --filter @channelers/stage build`
- [ ] Append a CHANGELOG entry, then commit:
  ```bash
  git add -A && git commit -m "feat(stage): /choreo view (live cues + reactToOracle toggle)"
  ```

---

### Task 7 — Docs reconciliation (ARCHITECTURE / app CLAUDE / CHANGELOG roll-up)

A dedicated pass so the source-of-truth docs match the built reality (per the project's reconciliation convention — implementation entries cover CHANGELOG, but ARCHITECTURE/CLAUDE need a deliberate sweep).

**Files:**
- Modify `docs/ARCHITECTURE.md`
- Modify `app/CLAUDE.md`
- Modify `docs/CHANGELOG.md`

**Steps:**
- [ ] `docs/ARCHITECTURE.md` §5.2 (Transform): change "turns the profile into the three seeds" → music-only; note the dance/persona seeds were removed and choreography moved to persona-set (§7). Update the "music seed → Anna; dance score → …; persona → …" bullet to reflect music-only output + the choreography first-pass at the altar.
- [ ] `docs/ARCHITECTURE.md` — add a short **§5.6 Choreography (the second live loop)** subsection: first-pass `f(intake, archetype)` at persona-set (`generateFirstPass`, `choreographer.ts`); the live fan-out in `say()` with the configurable `reactToOracle` timing; the `choreo.delta`/`choreo.done` screens-only channel (off OSC, like dispatcher/tuning); `/choreo` view + the live toggle endpoint; offline fallbacks. Reference this plan.
- [ ] `docs/ARCHITECTURE.md` §8 — add to the "Brain → client messages" block:
  ```
  choreo.delta    { sessionId, text }                  streaming movement cue chunk
  choreo.done     { sessionId, text }                  full movement cue for the turn
  ```
  and note in prose that, like `dispatch.state`/`tuning.*`, the `choreo.*` channel is screens-only and deliberately off the `ShowEvent`/OSC contract.
- [ ] `docs/ARCHITECTURE.md` §12 (open questions): mark **"Choreography agent model"** resolved → gpt-4o (`config.choreoModel`, `CHOREO_MODEL`); keep **"Choreography feed routing"** open (in-ear vs loudspeaker) and add a note that the cue de-multiplexing for concurrent sessions is deferred with it.
- [ ] `app/CLAUDE.md` — add `/choreo` to the stage route list (read-only cue display + reactToOracle toggle); update the `packages/oracles` line to mention the choreographer prompt builders; note `apps/brain/src/choreo.ts` as the second live loop; update the pipeline note that `transform()` is music-only.
- [ ] Add a final CHANGELOG roll-up entry summarizing the whole Tier 2 build (referencing this plan), then commit:
  ```bash
  git add -A && git commit -m "docs: reconcile ARCHITECTURE + app CLAUDE for Tier 2 choreography layer"
  ```

---

## 6. Final verification (after all tasks)

- [ ] `pnpm -r typecheck` → 0 errors (4 packages)
- [ ] `pnpm --filter @channelers/brain test` → all pass (incl. new transform/choreographer/choreo/store/endpoints tests)
- [ ] `pnpm --filter @channelers/stage test` → all pass (incl. `Choreo.test.tsx`)
- [ ] `pnpm --filter @channelers/stage build` → succeeds
- [ ] Manual smoke (optional, needs running app): `pnpm dev`, open `/channel` + `/choreo`, drive a seeded oracle-ready visitor (`pnpm seed`), claim + say a line, confirm cues stream to `/choreo` in both toggle states. (Live-model behavior needs `OPENAI_API_KEY`; offline the deterministic fallback cue appears.)
