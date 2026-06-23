# CHANNELERS — project root

Experimental AI-driven performance piece: a "DMV-esque void" where visitors fill out absurdist intake surveys that seed generated music and dance, culminating in a divination ritual where they talk to AI Oracle personae **channelled live by performers via in-ear receivers**. Themes: surveillance, transactional AI, bodily/ecological autonomy. Workshop deadline: **June 22–28, 2026** — build toward a working-for-the-workshop MVP, not a tour-hardened product.

## Layout
- **`docs/`** — planning + source of truth. Start here.
  - `CHANGELOG.md` — what's been built and why. **Read this first** to get current.
  - `ARCHITECTURE.md` — system design, data model, roadmap, and open questions for the team (§12).
  - `CLAUDE.md` — decisions & conventions · `intake.md` — the survey · `emails.md`, `annaoxygenwebsite.md` — the brief.
- **`app/`** — the application (pnpm + TypeScript monorepo). See `app/CLAUDE.md`.

Each subdirectory has its own `CLAUDE.md` with specifics; this file is the top-level map, loaded as a parent for sessions anywhere in the tree.

## Always
- **After every change, update `docs/CHANGELOG.md`** (newest entry on top: what / why / files-areas / docs-touched) and any docs the change affects. This is how context transfers between sessions — required, not optional.
- Update `docs/ARCHITECTURE.md` after any architectural deviations from the existing document.
- New questions for the team go in `docs/ARCHITECTURE.md` §12, not a new file.
- For anything touching the OpenAI API (models, params, caching, fine-tuning), check the current reference rather than relying on memory.
