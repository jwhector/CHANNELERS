# Paper-station OCR: OpenAI vision → Tesseract.js

**Goal:** Replace the non-deterministic `gpt-4o` vision OCR in `apps/brain/src/paper.ts` with a deterministic, local, key-free Tesseract.js OCR.

**Approach:** Swap the OpenAI call for a lazily-created, reused `tesseract.js` English worker that OCRs the captured `data:` URL locally. Keep the exact `ocrPage(dataUrl) → string | null` contract so the `/api/paper/feed` caller and its placeholder-on-failure spectacle behaviour are unchanged. Add a global Tesseract mock to the brain test setup so the offline suite stays fast and network-free.

**Tech stack:** TypeScript, Fastify (brain), `tesseract.js` (pure JS/WASM, no native binary), vitest.

---

## Why / design

**Problem.** `paper.ts` OCRs a webcam frame of the visitor's typed page via `gpt-4o` vision. An LLM vision model is sampling-based: it paraphrases, "corrects", editorialises, and varies run-to-run even at temperature 0. For the paper station — where the read is *spectacle text* feeding the "into the matrix" animation — what's wanted is a faithful, **deterministic** transcription of literally-typed text, not model interpretation.

**Scope.** Only `paper.ts` (the OCR engine) and its tests, plus a one-line boot pre-warm and doc reconciliation. The `/api/paper/feed` endpoint, the `paper.fed` event/OSC contract, and the `PAPER_FALLBACK_TEXT` spectacle-never-blocks behaviour are all unchanged.

**Approaches considered.**
- **A — Replace entirely with `tesseract.js` (chosen).** Drop OpenAI from `paper.ts`; always OCR locally. Deterministic, free, no API key, no network at OCR time (after the model is cached). Same signature → zero caller churn. Tradeoff: weaker than an LLM on skewed/glare-y captures, but the page is typed text and the existing placeholder covers any illegible/failed read.
- **B — Keep OpenAI when keyed, Tesseract as fallback (rejected).** Mirrors `stt.ts`. Rejected: it *keeps* the non-determinism that motivated the change whenever a key is present.
- **C — `node-tesseract-ocr` (native CLI wrapper, rejected).** Requires installing a system `tesseract` binary — breaks the "all TypeScript, CV in-JS, no sidecar" convention and complicates workshop setup.
- Cloud OCR (Google Vision / Textract) — rejected: re-introduces a network/API dependency and cost, against the project's offline-resilience ethos.

**Model-data delivery.** `tesseract.js` fetches its WASM core + `eng.traineddata` (~10–15 MB) from its CDN on first use and caches to disk — the same first-run-download pattern the existing local Whisper (`Xenova/whisper-tiny.en` in `stt.ts`) already uses and the project already accepts. We **pre-warm** the worker at brain boot (fire-and-forget, guarded) so the first visitor doesn't eat the cold start; an offline boot logs a warning and the first capture retries (or falls back to placeholder). Vendoring the data fully offline is a deferred option, not in scope.

**Decision log.**
- One shared worker (singleton promise), not a pool: the paper station OCRs one page at a time. YAGNI.
- `ocrPage` keeps `→ string | null`; `null` now means "nothing legible" (empty result) rather than "offline". Caller behaviour is identical.
- Test seam: `ocrPage(dataUrl, recognize?)` takes an optional injected recognizer so unit tests are deterministic without loading the real WASM engine; the integration path (`/api/paper/feed`) is kept offline by a global `vi.mock("tesseract.js")` in `test/setup.ts`.
- Language hardcoded to `"eng"` (no config knob) — YAGNI; an `OCR_LANG` env override can come later if needed.
- `paper.ts` no longer imports `./config` (no API key needed). `config.transformModel` stays — the intake→seeds transform still uses it.

---

## Global constraints

- **Run before claiming done** (from `app/CLAUDE.md`): `pnpm -r typecheck` and `pnpm --filter @channelers/brain test` — both must pass.
- **Brain tests run offline by design** (`test/setup.ts` forces `OPENAI_API_KEY=""`). No test may hit the network or load the real Tesseract WASM/model.
- **vitest has no `globals`** (see `apps/brain/vitest.config.ts`) — `vi` must be imported where used (`test/setup.ts`).
- **Contract preserved:** `ocrPage(dataUrl: string) → Promise<string | null>`; `/api/paper/feed` and the `PAPER_FALLBACK_TEXT` path are untouched.
- **Docs upkeep** (`CLAUDE.md`): add the newest entry to `docs/CHANGELOG.md`; reconcile `docs/ARCHITECTURE.md` only if it names a paper-OCR model.

---

## File structure

- `app/apps/brain/package.json` — **modify:** add `tesseract.js` dependency.
- `app/apps/brain/src/paper.ts` — **modify (rewrite):** Tesseract worker + `ocrPage` + `warmOcr`; no OpenAI, no `config` import.
- `app/apps/brain/test/setup.ts` — **modify:** global `vi.mock("tesseract.js")` returning an empty-text worker (keeps the suite offline).
- `app/apps/brain/test/paper.test.ts` — **modify:** test the trim/`null` logic via the injected recognizer seam.
- `app/apps/brain/src/index.ts` — **modify:** fire-and-forget `warmOcr()` pre-warm at boot.
- `docs/CHANGELOG.md` — **modify:** new top entry.
- `docs/ARCHITECTURE.md` / `app/CLAUDE.md` — **modify only if** they name a paper-OCR model (grep first).

---

## Tasks

### Task 1 — Add the `tesseract.js` dependency

**Files:** `app/apps/brain/package.json` (modify).

**Interfaces:** Produces — `tesseract.js` importable in `apps/brain` (`createWorker`, with shipped TS types).

**Steps:**
- [ ] Verify the current major + the `createWorker` API before pinning: `npm view tesseract.js version`, and confirm the `createWorker(langs)` auto-load + `worker.recognize(image).data.text` shape against the tesseract.js docs (Context7 `tesseract.js`, or the GitHub README). The `createWorker("eng")` one-call auto-load is v5+.
- [ ] Install into the brain workspace: `pnpm --filter @channelers/brain add tesseract.js`
- [ ] Confirm it resolved: `pnpm --filter @channelers/brain ls tesseract.js` → prints the installed version. (No source change yet, so no test here — this is scaffolding for Task 2.)

### Task 2 — Rewrite `paper.ts` to OCR via Tesseract (TDD)

**Files:** `app/apps/brain/src/paper.ts` (modify), `app/apps/brain/test/paper.test.ts` (modify), `app/apps/brain/test/setup.ts` (modify).

**Interfaces:**
- Consumes — `createWorker` from `tesseract.js`.
- Produces — `ocrPage(dataUrl: string, recognize?: (image: Buffer) => Promise<string>): Promise<string | null>` and `warmOcr(): Promise<void>`.

**Steps:**

- [ ] **Write the failing tests.** Replace the whole body of `app/apps/brain/test/paper.test.ts` with (the injected recognizer makes this deterministic and engine-free):
  ```ts
  import { describe, it, expect } from "vitest";
  import { ocrPage } from "../src/paper";

  describe("ocrPage", () => {
    it("trims and returns recognized text", async () => {
      const out = await ocrPage("data:image/jpeg;base64,AAAA", async () => "  i confess nothing \n");
      expect(out).toBe("i confess nothing");
    });

    it("returns null when nothing legible is read", async () => {
      const out = await ocrPage("data:image/jpeg;base64,AAAA", async () => "   \n  ");
      expect(out).toBeNull();
    });
  });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @channelers/brain test -- paper.test.ts` → fails (current `ocrPage` has no `recognize` param and returns `null` offline). It is fine if it also can't compile yet — that counts as red.
- [ ] **Implement** — replace the whole body of `app/apps/brain/src/paper.ts` with:
  ```ts
  import { createWorker } from "tesseract.js";

  /**
   * Decode a `data:` URL (the stage grabs a webcam frame of the page) to raw image bytes.
   * tesseract.js accepts a Node Buffer directly, so we strip the base64 payload and decode it.
   */
  function dataUrlToBuffer(dataUrl: string): Buffer {
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return Buffer.from(base64, "base64");
  }

  // Lazily-created, reused English worker. tesseract.js fetches the WASM core + eng.traineddata
  // from its CDN on first use and caches them to disk, so later boots run offline. One worker is
  // plenty — the paper station OCRs one page at a time (no pool; YAGNI).
  let workerPromise: ReturnType<typeof createWorker> | null = null;
  function getWorker(): ReturnType<typeof createWorker> {
    if (!workerPromise) workerPromise = createWorker("eng");
    return workerPromise;
  }

  async function recognizeWithTesseract(image: Buffer): Promise<string> {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    return data.text;
  }

  /** Pre-warm the OCR worker (downloads + caches the model) so the first capture isn't a cold start. */
  export async function warmOcr(): Promise<void> {
    await getWorker();
  }

  /**
   * OCR a captured page image (a `data:` URL) to its text — deterministically and locally via Tesseract.
   * Returns null when nothing legible is read (empty result); the caller substitutes placeholder text so
   * the feed spectacle never blocks (project offline-resilience convention). The optional `recognize`
   * seam lets tests inject a deterministic recognizer instead of loading the real WASM engine.
   */
  export async function ocrPage(
    dataUrl: string,
    recognize: (image: Buffer) => Promise<string> = recognizeWithTesseract,
  ): Promise<string | null> {
    const text = (await recognize(dataUrlToBuffer(dataUrl))).trim();
    return text.length > 0 ? text : null;
  }
  ```
- [ ] **Keep the integration suite offline** — add a global Tesseract mock to `app/apps/brain/test/setup.ts` (so `/api/paper/feed` in `endpoints.test.ts` never loads real WASM). Add at the top `import { vi } from "vitest";` and, after the existing `process.env.OPENAI_API_KEY = "";` line:
  ```ts
  // Keep the offline suite engine-free: any un-injected ocrPage call (e.g. the /api/paper/feed
  // integration test) gets a Tesseract worker that reads nothing → ocrPage returns null → the
  // endpoint substitutes PAPER_FALLBACK_TEXT, exactly as the old no-key path did.
  vi.mock("tesseract.js", () => ({
    createWorker: vi.fn(async () => ({
      recognize: vi.fn(async () => ({ data: { text: "" } })),
      terminate: vi.fn(),
    })),
  }));
  ```
- [ ] **Run, expect PASS:** `pnpm --filter @channelers/brain test` → full brain suite green (incl. `paper.test.ts` and the `endpoints.test.ts` "paper feed → placeholder" case).
- [ ] **Typecheck:** `pnpm --filter @channelers/brain typecheck` → clean. (If `ReturnType<typeof createWorker>` or `data.text` mismatches the installed types, adjust to the verified API from Task 1.)
- [ ] **Commit:** `git add -A && git commit -m "feat(paper): OCR the paper station locally via Tesseract.js instead of gpt-4o vision"`

### Task 3 — Pre-warm the OCR worker at boot

**Files:** `app/apps/brain/src/index.ts` (modify).

**Interfaces:** Consumes — `warmOcr` from `./paper` (Task 2).

**Steps:**
- [ ] **Implement** — in `app/apps/brain/src/index.ts`, import `warmOcr` and kick it off fire-and-forget after `listen` so the model caches before the first capture without blocking startup. Resulting file:
  ```ts
  import { buildApp } from "./app";
  import { config } from "./config";
  import { warmOcr } from "./paper";

  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
  console.log(`[brain] http://${config.host}:${config.port}  •  ws://${config.host}:${config.port}/ws`);

  // Pre-warm Tesseract (downloads + caches eng.traineddata on first run) so the first paper capture
  // isn't a cold start. Non-blocking; an offline boot just logs and the first capture retries.
  void warmOcr().catch((err) => console.warn("[brain] OCR pre-warm failed (will retry on first capture):", err));
  ```
- [ ] **Verify it doesn't break boot/typecheck:** `pnpm --filter @channelers/brain typecheck` → clean. (`index.ts` is the entrypoint, not imported by any test, so no unit test; the existing `smoke.test.ts` builds the app independently and is unaffected.)
- [ ] **Commit:** `git add -A && git commit -m "feat(brain): pre-warm the Tesseract OCR worker at boot"`

### Task 4 — Reconcile comments + docs

**Files:** `app/apps/brain/src/app.ts` (modify, comment only), `docs/CHANGELOG.md` (modify), and `docs/ARCHITECTURE.md` / `app/CLAUDE.md` (modify only if they name a paper-OCR model).

**Steps:**
- [ ] **Update the stale endpoint comment** in `app/apps/brain/src/app.ts` (above `/api/paper/feed`, ~line 81-83): replace the "gpt-4o vision OCRs it; on no-key/failure we emit placeholder text" wording with Tesseract-accurate text, e.g.:
  ```ts
  // ── paper station: capture → OCR → animate (identity-agnostic spectacle, spec 2026-06-22) ──
  // Body is a data: URL (the stage grabs a webcam frame on a physical button). Tesseract.js OCRs it
  // locally (deterministic, key-free); on empty/failure we emit placeholder text so the "into the
  // matrix" animation never blocks.
  ```
- [ ] **Grep for any other gpt-4o/OpenAI paper-OCR mentions to fix:** `grep -rni "paper" docs/ARCHITECTURE.md app/CLAUDE.md docs/CLAUDE.md | grep -i "ocr\|gpt\|openai\|vision"` — update any that assert the paper station uses an OpenAI model. (`app/CLAUDE.md`'s "OpenAI = gpt-4o for the intake→seeds transform, the live oracle loop, and the choreographer" already omits paper OCR — leave it unless it changed.)
- [ ] **Add the CHANGELOG entry** (newest on top) to `docs/CHANGELOG.md`: what (paper OCR now Tesseract.js, local + deterministic, OpenAI dropped from `paper.ts`) / why (gpt-4o vision was non-deterministic for what is faithful spectacle transcription; removes API key, cost, and network from the paper path) / files-areas (`apps/brain/src/paper.ts`, `index.ts`, `app.ts` comment, `test/setup.ts`, `test/paper.test.ts`, `package.json`) / docs-touched (this entry; ARCHITECTURE only if it named the model).
- [ ] **Verify:** `pnpm -r typecheck` and `pnpm --filter @channelers/brain test` → both green.
- [ ] **Commit:** `git add -A && git commit -m "docs: reconcile paper-OCR references for the Tesseract swap"`
