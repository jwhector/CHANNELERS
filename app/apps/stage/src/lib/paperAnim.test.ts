import { expect, test } from "vitest";
import {
  tokenize, wordCount, cellPhaseAt, binaryDigit, shredBeginMs, shredDelayFor, shredSpinDeg,
  totalMs, largestFitting, DEFAULT_KNOBS,
} from "./paperAnim";

test("tokenize splits into fixed cells with word indices, spaces reserved", () => {
  const cells = tokenize("hi yo");
  expect(cells).toHaveLength(5);
  expect(cells[0]).toMatchObject({ char: "h", isSpace: false, wordIndex: 0, cellIndex: 0 });
  expect(cells[1]).toMatchObject({ char: "i", isSpace: false, wordIndex: 0 });
  expect(cells[2]).toMatchObject({ char: " ", isSpace: true });
  expect(cells[3]).toMatchObject({ char: "y", isSpace: false, wordIndex: 1 });
  expect(wordCount(cells)).toBe(2);
});

test("cellPhaseAt: whole text readable at once, then a quick per-cell ripple into binary", () => {
  const k = DEFAULT_KNOBS;
  expect(cellPhaseAt(0, 0, k)).toBe("letter");
  expect(cellPhaseAt(50, 0, k)).toBe("letter"); // every cell is readable at t=0
  expect(cellPhaseAt(0, k.readHoldMs + 1, k)).toBe("binary");
  // later cells convert a touch later (the quick ripple), not all at once
  expect(cellPhaseAt(10, k.readHoldMs + 1, k)).toBe("letter");
  expect(cellPhaseAt(10, k.readHoldMs + 10 * k.transformStaggerMs + 1, k)).toBe("binary");
});

test("binaryDigit is deterministic, flips over time, and shimmers across cells", () => {
  const k = DEFAULT_KNOBS;
  expect(["0", "1"]).toContain(binaryDigit(0, 0, k));
  const overTime = new Set([0, 100, 200, 300, 400].map((t) => binaryDigit(3, t, k)));
  expect(overTime.size).toBe(2); // the cell flips between 0 and 1
  const acrossCells = new Set([0, 1, 2, 3, 4, 5].map((c) => binaryDigit(c, 130, k)));
  expect(acrossCells.size).toBe(2); // cells are not all in lockstep
});

test("shredBeginMs (black hole opens) accounts for the ripple across all cells + the binary hold", () => {
  const k = DEFAULT_KNOBS;
  expect(shredBeginMs(5, k)).toBe(k.readHoldMs + 4 * k.transformStaggerMs + k.binaryHoldMs);
});

test("shredDelayFor is deterministic, inside [0, shredWindowMs), and scatters the rip order", () => {
  const k = DEFAULT_KNOBS;
  for (const i of [0, 1, 7, 42, 99]) {
    const d = shredDelayFor(i, k);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(k.shredWindowMs);
    expect(shredDelayFor(i, k)).toBe(d); // deterministic
  }
  // consecutive cells do NOT get monotonic delays — the rip looks random, not left-to-right
  const seq = [0, 1, 2, 3, 4, 5].map((i) => shredDelayFor(i, k));
  const sorted = [...seq].sort((a, b) => a - b);
  expect(seq).not.toEqual(sorted);
});

test("shredSpinDeg is deterministic and spins both directions", () => {
  expect(shredSpinDeg(3)).toBe(shredSpinDeg(3));
  const spins = [0, 1, 2, 3, 4, 5, 6, 7].map(shredSpinDeg);
  expect(spins.some((s) => s < 0)).toBe(true);
  expect(spins.some((s) => s > 0)).toBe(true);
});

test("totalMs covers the whole sequence: black hole open + full shred window + one cell's travel", () => {
  const k = DEFAULT_KNOBS;
  expect(totalMs(5, k)).toBe(shredBeginMs(5, k) + k.shredWindowMs + k.shredDurationMs);
});

test("largestFitting binary-searches the biggest fitting size", () => {
  expect(largestFitting(8, 100, (px) => px <= 37)).toBe(37);
  expect(largestFitting(8, 100, () => true)).toBe(100);
  expect(largestFitting(8, 100, () => false)).toBe(8); // none fit → min
});
