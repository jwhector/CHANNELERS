/**
 * Dev seed: fabricate a visitor who has completed EVERYTHING except intake — pose
 * (body-scan), paper, time-offering, plus the altar's persona pick + pose-verify — so
 * the only thing left is the intake survey. Built to test how the oracle responds to
 * different intakes without re-walking the whole circuit each time.
 *
 * The loop:
 *   pnpm seed:no-intake            # one such visitor (archetype "child")
 *   → submit any intake survey for them (the /intake kiosk, or POST /api/visitors/:id/intake)
 *   → channel them on /channel — the oracle builds its prompt from THAT fresh survey
 *   (the divination reads `visitor.survey` live at session start; buildPrompt.ts).
 * Vary the survey, repeat, and compare the oracle's voice.
 *
 * Each fake visitor drives the SAME public endpoints a real one would (no intake):
 *   register → pose → paper (Done) → offering (Done) → persona → verify
 * which stamps `poseAt`, `paperAt`, `offeringAt`, `personaAt` (+ archetype), and
 * `poseVerifiedAt`, leaving `intakeAt` (the survey) the only missing milestone. Paper +
 * offering go through the operator-override path (`POST /api/checkin` → `…/complete`).
 *
 * Because persona + pose-verify are set, they ALSO show on /channel as oracle-ready —
 * but a session won't start until intake lands ("visitor has not completed intake"),
 * which is exactly the gate this seed is for. The archetype is fixed (so intake is the
 * only variable); pass `--archetype <id>` to test an archetype × intake combination.
 *
 * No new brain routes, no kiosk flow. The brain must already be running.
 *
 *   pnpm seed:no-intake                      # 1 visitor, archetype "child"
 *   pnpm seed:no-intake --count 3            # three of them
 *   pnpm seed:no-intake --archetype drugged_ai
 *   pnpm seed:no-intake --number 9100        # start ticket numbers at 9100
 *
 * Targets localhost by default; point at a remote deploy with `--base <url>` or
 * `SEED_BASE` (flag wins):
 *
 *   pnpm seed:no-intake --base https://channelers.fly.dev --archetype child
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, type VisitorProfile } from "@channelers/shared";
import {
  completeStation,
  flags,
  makeClient,
  nextDevNumber,
  parseArchetype,
  parseCount,
  resolveBase,
  samplePose,
} from "./seed-lib";

const DEFAULT_COUNT = 1;
const DEFAULT_ARCHETYPE = "child";

const BASE = resolveBase(flags(process.argv.slice(2)));
const client = makeClient(BASE);
const { get, post } = client;

/** Drive one visitor through everything except intake, leaving only the survey to submit. */
async function seedOne(number: number, archetype: string): Promise<VisitorProfile> {
  const registered = await post<VisitorProfile>("/api/register", { number });
  const id = registered.id;
  await post<VisitorProfile>(`/api/visitors/${id}/pose`, { template: samplePose() }); // → poseAt
  await completeStation(client, number, id, "paper");                                  // → paperAt
  await completeStation(client, number, id, "offering");                               // → offeringAt
  await post<VisitorProfile>(`/api/visitors/${id}/persona`, { archetype });            // → personaAt + archetype
  await post<VisitorProfile>(`/api/visitors/${id}/verify`);                            // → poseVerifiedAt
  return get<VisitorProfile>(`/api/visitors/by-number/${number}`);                     // final (intakeAt still absent)
}

async function main() {
  const f = flags(process.argv.slice(2));
  const count = parseCount(f, DEFAULT_COUNT);
  const archetype = parseArchetype(f, DEFAULT_ARCHETYPE);

  const start = f.number ? Number(f.number) : await nextDevNumber(client);
  if (!Number.isInteger(start)) throw new Error(`--number must be an integer, got "${f.number}"`);

  const made: VisitorProfile[] = [];
  for (let i = 0; i < count; i++) {
    made.push(await seedOne(start + i, archetype));
  }

  const label = ARCHETYPES.find((a) => a.id === archetype)?.label ?? archetype;
  const numbers = made.map((v) => `#${v.number}`).join(", ");
  console.log(
    `[seed:no-intake] ${made.length} visitor(s) staged with everything but intake: ${numbers}\n` +
      `                 archetype ${label} (${archetype}); only the intake survey is missing.\n` +
      `                 submit an intake survey for one, then channel it on /channel to hear the oracle.`,
  );
}

/** True only when run as the CLI entry (`tsx src/seed-no-intake.ts`), false when imported by tests. */
function isEntrypoint(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`[seed:no-intake] could not reach the brain at ${BASE} — is it running? (pnpm dev)`);
    } else {
      console.error(`[seed:no-intake] ${msg}`);
    }
    process.exit(1);
  });
}
