/**
 * Dev seed: fabricate a fully oracle-ready visitor so you can test the /channel
 * performer page without walking someone through the intake + body-scan kiosks.
 *
 * It drives the SAME public endpoints a real visitor would hit, in order:
 *   register → intake (survey) → persona (archetype) → verify (pose unlock)
 * which stamps `personaAt` + `poseVerifiedAt` and leaves `sessionEndAt` unset —
 * exactly the predicate /channel uses to list a visitor as channellable
 * (Channel.tsx: `!!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt`).
 *
 * For ALTAR-ready visitors (cleared intake + body-scan, waiting for the altar to
 * open) use `seed-altar.ts` (`pnpm seed:altar`) instead.
 *
 * No new brain routes, no kiosk flow. The brain must already be running.
 *
 *   pnpm --filter @channelers/brain seed:visitor
 *   pnpm --filter @channelers/brain seed:visitor --name "Mara" --archetype drugged_ai
 *   pnpm --filter @channelers/brain seed:visitor --number 9042
 *
 * OR
 *
 *  pnpm seed
 *
 * Targets localhost by default; point at a remote deploy with `--base <url>` or
 * `SEED_BASE` (flag wins) — e.g. seed the Fly app straight from your laptop:
 *
 *   pnpm seed --base https://channelers.fly.dev
 *   SEED_BASE=https://channelers.fly.dev pnpm seed --name "Mara"
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, type VisitorProfile } from "@channelers/shared";
import { flags, makeClient, nextDevNumber, resolveBase, sampleSurvey } from "./seed-lib";

// Re-exported so existing importers (e.g. test/seed.test.ts) keep working.
export { resolveBase } from "./seed-lib";

const BASE = resolveBase(flags(process.argv.slice(2)));
const { get, post } = makeClient(BASE);

async function main() {
  const f = flags(process.argv.slice(2));

  const archetype = f.archetype ?? "child"; // single-persona show (was "tree")
  if (!ARCHETYPES.some((a) => a.id === archetype)) {
    const ids = ARCHETYPES.map((a) => a.id).join(", ");
    throw new Error(`unknown archetype "${archetype}" — choose one of: ${ids}`);
  }

  const number = f.number ? Number(f.number) : await nextDevNumber({ get, post });
  if (!Number.isInteger(number)) throw new Error(`--number must be an integer, got "${f.number}"`);
  const name = f.name ?? "Test Visitor";

  const survey = sampleSurvey(name);

  const registered = await post<VisitorProfile>("/api/register", { number });
  const id = registered.id;
  await post<VisitorProfile>(`/api/visitors/${id}/intake`, { survey }); // → survey + intakeAt, fires seeds
  await post<VisitorProfile>(`/api/visitors/${id}/persona`, { archetype }); // → archetype + personaAt
  const ready = await post<VisitorProfile>(`/api/visitors/${id}/verify`); // → poseVerifiedAt

  const label = ARCHETYPES.find((a) => a.id === archetype)?.label ?? archetype;
  console.log(
    `[seed] oracle-ready visitor #${ready.number} "${name}" channelling ${label} (${archetype})\n` +
      `       id=${id}\n` +
      `       open /channel — it appears under "Available visitors", tap Channel to start.`,
  );
}

/** True only when run as the CLI entry (`tsx src/seed.ts`), false when imported by tests
 *  — so importing for `resolveBase` never fires the live HTTP run or its `process.exit`. */
function isEntrypoint(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`[seed] could not reach the brain at ${BASE} — is it running? (pnpm dev)`);
    } else {
      console.error(`[seed] ${msg}`);
    }
    process.exit(1);
  });
}
