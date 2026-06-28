import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { store, type VisitorRecord } from "../src/store";
import {
  serializeStore, writeSnapshot, readSnapshot, hydrateFromSnapshot, startSnapshotLoop,
} from "../src/persistence";

const tmpFile = (name = "visitors.json") =>
  join(mkdtempSync(join(tmpdir(), "chan-persist-")), name);

function rec(number: number, over: Partial<VisitorRecord> = {}): VisitorRecord {
  const ts = "2026-06-28T00:00:00.000Z";
  return {
    id: `id-${number}`,
    number,
    scans: [],
    location: { state: "waiting", since: ts },
    createdAt: ts,
    ...over,
  };
}

describe("store.load (hydrate from records)", () => {
  beforeEach(() => store.clear());

  it("replaces store contents and rebuilds the number index", () => {
    store.register(111); // pre-existing record that load must clear
    store.load([
      rec(222, {
        survey: { name: "Mara", freeText: {}, phrases: [] },
        intakeAt: "2026-06-28T00:00:01.000Z",
      }),
    ]);
    expect(store.getByNumber(111)).toBeUndefined(); // old record gone
    const v = store.getByNumber(222);
    expect(v?.id).toBe("id-222");
    expect(v?.survey?.name).toBe("Mara");
    expect(store.list()).toHaveLength(1);
  });
});

describe("snapshot read/write round-trip", () => {
  beforeEach(() => store.clear());

  it("serializeStore emits versioned JSON with the live records", () => {
    store.register(501);
    const parsed = JSON.parse(serializeStore());
    expect(parsed.version).toBe(1);
    expect(parsed.savedAt).toBeTruthy();
    expect(parsed.visitors).toHaveLength(1);
    expect(parsed.visitors[0].number).toBe(501);
  });

  it("write then read returns the same records", () => {
    store.register(502);
    const path = tmpFile();
    expect(writeSnapshot(path, serializeStore())).toBe(true);
    const back = readSnapshot(path);
    expect(back?.[0].number).toBe(502);
  });

  it("readSnapshot returns null for a missing file (no throw)", () => {
    expect(readSnapshot(join(tmpdir(), "does-not-exist-xyz.json"))).toBeNull();
  });

  it("readSnapshot returns null for a corrupt file (no throw)", () => {
    const path = tmpFile();
    writeFileSync(path, "{ not valid json");
    expect(readSnapshot(path)).toBeNull();
  });

  it("readSnapshot returns null when a record fails schema validation", () => {
    const path = tmpFile();
    writeFileSync(path, JSON.stringify({ version: 1, savedAt: "x", visitors: [{ id: "bad" }] }));
    expect(readSnapshot(path)).toBeNull();
  });

  it("hydrateFromSnapshot loads records into the store and returns the count", () => {
    store.register(503);
    const path = tmpFile();
    writeSnapshot(path, serializeStore());
    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(hydrateFromSnapshot(path)).toBe(1);
    expect(store.getByNumber(503)?.number).toBe(503);
  });

  it("hydrateFromSnapshot returns 0 for a missing file and leaves the store empty", () => {
    const missing = join(tmpdir(), "nope-xyz.json");
    expect(hydrateFromSnapshot(missing)).toBe(0);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("startSnapshotLoop", () => {
  beforeEach(() => store.clear());

  it("writes after a change, skips when unchanged, and stop() halts writes", () => {
    vi.useFakeTimers();
    const path = tmpFile();
    const stop = startSnapshotLoop(path, 1000);

    store.register(601);
    vi.advanceTimersByTime(1000);
    expect(readSnapshot(path)?.length).toBe(1); // wrote on change

    stop();
    store.register(602);
    vi.advanceTimersByTime(5000);
    expect(readSnapshot(path)?.length).toBe(1); // no writes after stop

    vi.useRealTimers();
  });
});
