import { describe, it, expect } from "vitest";
import type { DispatchState } from "@channelers/shared";
import { boardRows } from "./Board";

const base: DispatchState = {
  slots: [], queue: [], completed: [], surplus: [],
  stationsOnline: { intake: false, bodyscan: false, altar: false, paper: false, offering: false },
  altarReady: 0, altarReadyList: [], altarOpen: false,
  bodyscanIdle: false, bodyscanBlocked: "none",
};

describe("boardRows", () => {
  it("labels a plain waiting visitor WAITING (lobby overflow)", () => {
    const rows = boardRows({ ...base, queue: [{ id: "a", number: 12, eligible: ["intake"], waitingSince: "", flags: [] }] });
    expect(rows.find((r) => r.id === "a")?.loc).toBe("WAITING");
  });
  it("labels a held visitor ON HOLD", () => {
    const rows = boardRows({ ...base, queue: [{ id: "b", number: 13, eligible: ["intake"], waitingSince: "", flags: [], holdReason: "intro" }] });
    expect(rows.find((r) => r.id === "b")?.loc).toBe("ON HOLD");
  });
  it("labels an altar-ready-but-unplaced visitor ALTAR READY", () => {
    const rows = boardRows({ ...base, altarReadyList: [{ id: "c", number: 14 }] });
    expect(rows.find((r) => r.id === "c")?.loc).toBe("ALTAR READY");
  });
  it("labels an altar-ready visitor still in the queue ALTAR READY (not WAITING ROOM)", () => {
    const rows = boardRows({
      ...base,
      queue: [{ id: "c", number: 14, eligible: ["altar"], waitingSince: "", flags: [] }],
      altarReadyList: [{ id: "c", number: 14 }],
    });
    expect(rows.find((r) => r.id === "c")?.loc).toBe("ALTAR READY");
  });
  it("does not double-list an altar-ready visitor already in the queue", () => {
    const rows = boardRows({
      ...base,
      queue: [{ id: "c", number: 14, eligible: ["altar"], waitingSince: "", flags: [] }],
      altarReadyList: [{ id: "c", number: 14 }],
    });
    expect(rows.filter((r) => r.id === "c")).toHaveLength(1);
  });
  it("shows ON HOLD for a held altar-ready visitor (hold wins over ALTAR READY)", () => {
    const rows = boardRows({
      ...base,
      queue: [{ id: "c", number: 14, eligible: ["altar"], waitingSince: "", flags: [], holdReason: "no-show" }],
      altarReadyList: [{ id: "c", number: 14 }],
    });
    expect(rows.find((r) => r.id === "c")?.loc).toBe("ON HOLD");
  });
});
