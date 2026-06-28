/**
 * Dev seed: fabricate several ALTAR-ready visitors so you can test the altar gate
 * (/console), the Pluribus "completed the stationing process" broadcast, the /board
 * ALTAR READY label, and the dispatcher's altar-ready count + list — without walking
 * a crowd through the whole station circuit.
 *
 * Each fake visitor drives the SAME public endpoints a real one would, in order:
 *   register → intake (survey) → pose (body-scan) → paper (Done) → offering (Done)
 * which stamps all four pre-altar milestones (intakeAt, poseAt, paperAt, offeringAt)
 * and leaves the visitor `waiting` with no `sessionEndAt` — exactly the predicate the
 * system keys "altar-ready" off of (shared `isAltarReady` / `clearedPreAltarStations`).
 *
 * Paper + offering are completed through the operator-override path (`POST /api/checkin`
 * → `POST /api/dispatch/complete`), so no new brain routes. Because every station is
 * done, an altar-ready seed is no longer eligible for any soak station — it just waits.
 *
 * Deliberately NO persona/verify: the archetype is chosen AT the altar, so an
 * altar-ready visitor has none yet. (For an oracle-ready visitor that /channel can
 * list, use `seed.ts` / `pnpm seed` instead.)
 *
 * No new brain routes, no kiosk flow. The brain must already be running.
 *
 *   pnpm seed:altar               # 3 altar-ready visitors (default)
 *   pnpm seed:altar --count 8     # eight of them
 *   pnpm seed:altar --name Mara   # names them "Mara 1".."Mara N"
 *   pnpm seed:altar --number 9100 # start ticket numbers at 9100
 *
 * Targets localhost by default; point at a remote deploy with `--base <url>` or
 * `SEED_BASE` (flag wins):
 *
 *   pnpm seed:altar --base https://channelers.fly.dev --count 5
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VisitorProfile } from "@channelers/shared";
import {
  completeStation,
  flags,
  makeClient,
  nextDevNumber,
  parseCount,
  resolveBase,
  sampleSurvey,
  samplePose,
} from "./seed-lib";

const DEFAULT_COUNT = 3;

const BASE = resolveBase(flags(process.argv.slice(2)));
const client = makeClient(BASE);
const { get, post } = client;

/** Drive one visitor through every pre-altar station, leaving them altar-ready. */
async function seedOne(number: number, name: string): Promise<VisitorProfile> {
  const registered = await post<VisitorProfile>("/api/register", { number });
  const id = registered.id;
  await post<VisitorProfile>(`/api/visitors/${id}/intake`, { survey: sampleSurvey(name) }); // → intakeAt
  await post<VisitorProfile>(`/api/visitors/${id}/pose`, { template: samplePose() });        // → poseAt
  await completeStation(client, number, id, "paper");                                         // → paperAt
  await completeStation(client, number, id, "offering");                                      // → offeringAt
  return get<VisitorProfile>(`/api/visitors/by-number/${number}`);                            // final, all four stamped
}

async function main() {
  const f = flags(process.argv.slice(2));
  const count = parseCount(f, DEFAULT_COUNT);
  const baseName = f.name ?? "Altar Tester";

  // Reserve a contiguous block of dev numbers up front so we don't re-scan per visitor.
  const start = f.number ? Number(f.number) : await nextDevNumber(client);
  if (!Number.isInteger(start)) throw new Error(`--number must be an integer, got "${f.number}"`);

  const made: VisitorProfile[] = [];
  for (let i = 0; i < count; i++) {
    made.push(await seedOne(start + i, `${baseName} ${i + 1}`));
  }

  const numbers = made.map((v) => `#${v.number}`).join(", ");
  console.log(
    `[seed:altar] ${made.length} altar-ready visitor(s): ${numbers}\n` +
      `             each cleared every pre-altar station (intake, body-scan, paper, offering) and is waiting.\n` +
      `             open /console to open the altar (and Pluribus-broadcast); /board shows them ALTAR READY.`,
  );
}

/** True only when run as the CLI entry (`tsx src/seed-altar.ts`), false when imported by tests. */
function isEntrypoint(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error(`[seed:altar] could not reach the brain at ${BASE} — is it running? (pnpm dev)`);
    } else {
      console.error(`[seed:altar] ${msg}`);
    }
    process.exit(1);
  });
}
