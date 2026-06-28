import { describe, it, expect, beforeEach } from "vitest";
import { store, type VisitorRecord } from "../src/store";

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
