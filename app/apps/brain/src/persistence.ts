import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
    mkdirSync(dirname(path), { recursive: true }); // ensure the target dir exists (no-op if it does)
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
