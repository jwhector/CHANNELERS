import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, test, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { DispatchState } from "@channelers/shared";
import { STATION_LABEL } from "@channelers/shared";

// Drive the brain socket by hand: capture Board's dispatch.state handler so tests can push state.
const { socketCb } = vi.hoisted(() => ({ socketCb: { current: null as null | ((m: unknown) => void) } }));
vi.mock("../lib/useBrainSocket", () => ({
  useBrainSocket: (cb: (m: unknown) => void) => { socketCb.current = cb; return { connected: true, send: vi.fn() }; },
}));
vi.mock("../lib/api", () => ({ api: { dispatch: { state: () => new Promise(() => {}) } } }));

import { boardRows, nextBoardView, Board } from "./Board";

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

// ── /board altar video cue ───────────────────────────────────────────────────
// The altar open/close signal already rides dispatch.state, so the board reuses it as a media
// cue: roster → (altar opens) play one fullscreen clip → (clip ends) black, and stay black for
// the rest of the run. A sessionStorage flag makes an accidental reload stay black, not replay.
beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("nextBoardView", () => {
  it("stays on the roster while the altar is closed", () => {
    expect(nextBoardView("roster", false)).toBe("roster");
  });
  it("switches to the video when the altar opens", () => {
    expect(nextBoardView("roster", true)).toBe("video");
  });
  it("keeps playing the video even if the altar closes mid-clip", () => {
    expect(nextBoardView("video", false)).toBe("video");
  });
  it("never replays once black, even if the altar re-opens (one-shot)", () => {
    expect(nextBoardView("black", true)).toBe("black");
  });
});

describe("Board altar video cue", () => {
  const push = (s: Partial<DispatchState>) =>
    act(() => socketCb.current?.({ kind: "dispatch.state", state: { ...base, ...s } }));

  test("stays on the roster before the altar opens (no video)", () => {
    const { container } = render(<Board />);
    push({ altarOpen: false, queue: [{ id: "a", number: 1, eligible: ["intake"], waitingSince: "", flags: [] }] });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".bd-rows")).not.toBeNull();
  });

  test("plays the video once when the altar opens", () => {
    const { container } = render(<Board />);
    push({ altarOpen: true });
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "/altar.mp4");
    expect(video).not.toHaveAttribute("loop"); // one-shot, never loops
  });

  test("?src overrides the clip path (swap the clip without a rebuild)", () => {
    window.history.replaceState({}, "", "/board?src=/finale.webm");
    const { container } = render(<Board />);
    push({ altarOpen: true });
    expect(container.querySelector("video")).toHaveAttribute("src", "/finale.webm");
  });

  test("goes black when the video finishes", () => {
    const { container } = render(<Board />);
    push({ altarOpen: true });
    fireEvent.ended(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".bd-rows")).toBeNull();
    expect(container.querySelector(".bd-black")).not.toBeNull();
  });

  test("a media-load failure degrades to clean black (retryable: no played flag set)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<Board />);
    push({ altarOpen: true });
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".bd-black")).not.toBeNull();
    // a failed load is not a completed play — leave the cue re-armed so a reload retries during setup
    expect(window.sessionStorage.getItem("channelers.board.played")).toBeNull();
    errSpy.mockRestore();
  });

  test("stays black on reload after the cue has played (no replay)", () => {
    window.sessionStorage.setItem("channelers.board.played", "1");
    const { container } = render(<Board />);
    push({ altarOpen: true });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".bd-black")).not.toBeNull();
  });

  test("?reset clears the played flag so the cue can be re-tested", () => {
    window.sessionStorage.setItem("channelers.board.played", "1");
    window.history.replaceState({}, "", "/board?reset");
    const { container } = render(<Board />);
    push({ altarOpen: false });
    expect(container.querySelector(".bd-black")).toBeNull();
    expect(window.sessionStorage.getItem("channelers.board.played")).toBeNull();
  });
});
