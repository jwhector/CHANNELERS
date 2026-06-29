import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { DispatchState } from "@channelers/shared";
import { STATION_LABEL } from "@channelers/shared";
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

// The roster row (.bd-row) is a fixed-width grid — `4ch` number + `1fr` location — and
// `.bd-loc` truncates with `text-overflow: ellipsis`, so the row must be wide enough for the
// longest STATION_LABEL or station names clip. `ch` is the advance of VT323's "0", but its
// letters run wider, so the design deliberately over-budgets the location column. The original
// design gave it ~1.2ch per label character (a 26.8ch budget for the 22-char "STATION B -
// TYPEWRITER"); this guards that that margin still covers the current longest label — the
// regression being "STATION A - TIME OFFERING" (25ch), which clipped under the old 34ch row.
describe("board.css .bd-row sizing", () => {
  const COMFORT_RATIO = 1.2; // location-column ch budget per label character (from the original design)

  const css = readFileSync(resolve(process.cwd(), "src/styles/board.css"), "utf8");
  const rowBlock = css.match(/\.bd-row\s*\{([^}]*)\}/)?.[1] ?? "";
  const ch = (decl: RegExp) => Number(rowBlock.match(decl)?.[1]);

  it("sizes the row so the longest STATION_LABEL fits the location column with the design's comfort margin", () => {
    const rowWidth = ch(/width:\s*([\d.]+)ch/);
    const numCol = ch(/grid-template-columns:\s*([\d.]+)ch/); // "4ch 1fr" → number column
    const gap = ch(/gap:\s*0\s+([\d.]+)ch/); //               "0 2ch"   → column gap
    const padX = ch(/padding:\s*0\s+([\d.]+)ch/); //          "0 0.6ch" → per-side horizontal padding

    // Fail loudly if the CSS shape changed out from under these regexes, rather than NaN-comparing.
    for (const v of [rowWidth, numCol, gap, padX]) expect(Number.isFinite(v)).toBe(true);

    const locBudget = rowWidth - numCol - gap - 2 * padX;
    const longest = Math.max(...Object.values(STATION_LABEL).map((l) => l.length));

    expect(locBudget / longest).toBeGreaterThanOrEqual(COMFORT_RATIO);
  });
});
