/**
 * Shared plumbing for the dev seed scripts (`seed.ts` → oracle-ready visitor,
 * `seed-altar.ts` → altar-ready visitors). Both drive the SAME public endpoints a
 * real visitor would hit, so the only thing that differs between them is which
 * milestones they stamp. Keeping the HTTP client + fixtures here keeps that single.
 */
import { ARCHETYPES } from "@channelers/shared";
import type { PoseVector, Station, SurveyResponse } from "@channelers/shared";
import { config } from "./config";

/** Tiny `--flag value` / `--flag=value` parser over argv. */
export function flags(argv: string[]): Record<string, string> {
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

/**
 * Which brain the seed drives. Precedence: `--base <url>` flag › `SEED_BASE` env ›
 * the local dev brain (`config.host:port`). Lets one invocation seed a remote deploy
 * while a plain `pnpm seed` still hits localhost — backwards-compatible. Trailing
 * slashes are trimmed so `${BASE}${path}` never doubles up.
 */
export function resolveBase(
  f: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = f.base ?? env.SEED_BASE ?? `http://${config.host}:${config.port}`;
  return raw.replace(/\/+$/, "");
}

/** Parse a `--count N` flag into a positive integer, falling back when absent. */
export function parseCount(f: Record<string, string>, fallback: number): number {
  if (f.count === undefined) return fallback;
  const n = Number(f.count);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--count must be a positive integer, got "${f.count}"`);
  }
  return n;
}

/** Resolve a `--archetype <id>` flag against the persona library, falling back when absent. */
export function parseArchetype(f: Record<string, string>, fallback: string): string {
  const a = f.archetype ?? fallback;
  if (!ARCHETYPES.some((x) => x.id === a)) {
    const ids = ARCHETYPES.map((x) => x.id).join(", ");
    throw new Error(`unknown archetype "${a}" — choose one of: ${ids}`);
  }
  return a;
}

export type SeedClient = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
};

/** A minimal fetch wrapper bound to one brain base URL. */
export function makeClient(base: string): SeedClient {
  async function req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      // Only declare a JSON body when we actually send one — a bare content-type with an
      // empty body trips Fastify's FST_ERR_CTP_EMPTY_JSON_BODY (e.g. the bodyless /verify).
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
  return {
    get: (path) => req("GET", path),
    post: (path, body) => req("POST", path, body),
  };
}

/** First free ticket number at/above 9000 — keeps dev dummies visually distinct from real ones. */
export async function nextDevNumber(client: SeedClient): Promise<number> {
  const visitors = await client.get<{ number: number }[]>("/api/visitors");
  const taken = new Set(visitors.map((v) => v.number));
  let n = 9000;
  while (taken.has(n)) n++;
  return n;
}

/** Drive a station to completion via the operator-override path: force the visitor
 *  in_progress at the station, then Done (markComplete stamps its milestone, repools).
 *  Used to stamp the kiosk-less group stations (`paper`, `offering`) from a seed. */
export async function completeStation(
  client: SeedClient,
  number: number,
  visitorId: string,
  station: Station,
): Promise<void> {
  await client.post("/api/checkin", { number, station });
  await client.post("/api/dispatch/complete", { visitorId });
}

/** A plausible filled-in survey (real field ids from packages/shared/src/survey.ts). */
export function sampleSurvey(name: string): SurveyResponse {
  return {
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
}

/** A well-formed (but arbitrary) pose template — enough to stamp `poseAt` at body-scan.
 *  Altar-ready visitors never get pose-VERIFIED, so this only needs to be a valid vector,
 *  not match anything. Eight joints with mid-range angles and full confidence. */
export function samplePose(): PoseVector {
  return {
    angles: [90, 120, 95, 150, 100, 130, 110, 160],
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
  };
}
