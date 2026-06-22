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
 * No new brain routes, no kiosk flow. The brain must already be running.
 *
 *   pnpm --filter @channelers/brain seed:visitor
 *   pnpm --filter @channelers/brain seed:visitor --name "Mara" --archetype drugged_ai
 *   pnpm --filter @channelers/brain seed:visitor --number 9042
 * 
 * OR
 * 
 *  pnpm seed
 */
import { ARCHETYPES, type SurveyResponse, type VisitorProfile } from "@channelers/shared";
import { config } from "./config";

const BASE = `http://${config.host}:${config.port}`;

/** Tiny `--flag value` / `--flag=value` parser over argv. */
function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    }
  }
  return out;
}

async function req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    // Only declare a JSON body when we actually send one — a bare content-type with an
    // empty body trips Fastify's FST_ERR_CTP_EMPTY_JSON_BODY (e.g. the bodyless /verify).
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const get = <T>(path: string) => req<T>("GET", path);
const post = <T>(path: string, body?: unknown) => req<T>("POST", path, body);

/** First free ticket number at/above 9000 — keeps dev dummies visually distinct from real ones. */
async function nextDevNumber(): Promise<number> {
  const visitors = await get<VisitorProfile[]>("/api/visitors");
  const taken = new Set(visitors.map((v) => v.number));
  let n = 9000;
  while (taken.has(n)) n++;
  return n;
}

async function main() {
  const f = flags(process.argv.slice(2));

  const archetype = f.archetype ?? "tree";
  if (!ARCHETYPES.some((a) => a.id === archetype)) {
    const ids = ARCHETYPES.map((a) => a.id).join(", ");
    throw new Error(`unknown archetype "${archetype}" — choose one of: ${ids}`);
  }

  const number = f.number ? Number(f.number) : await nextDevNumber();
  if (!Number.isInteger(number)) throw new Error(`--number must be an integer, got "${f.number}"`);
  const name = f.name ?? "Test Visitor";

  // A plausible filled-in survey (real field ids from packages/shared/src/survey.ts).
  const survey: SurveyResponse = {
    name,
    freeText: {
      tender: "Only on alternate Tuesdays, and never in writing.",
      shoeSize: "10.5",
      lost: "a sense of the appropriate volume for indoor voices",
      ssn: "000-00-0000",
    },
    phrases: [
      { axis: "vulnerability", choice: "Moody Sky" },
      { axis: "tension", choice: "Hard Times" },
      { axis: "hopefulness", choice: "Night Drive" },
    ],
  };

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

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    console.error(`[seed] could not reach the brain at ${BASE} — is it running? (pnpm dev)`);
  } else {
    console.error(`[seed] ${msg}`);
  }
  process.exit(1);
});
