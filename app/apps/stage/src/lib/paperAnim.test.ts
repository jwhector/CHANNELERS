import { expect, test } from "vitest";
import {
  tokenize, wordCount, cellPhaseAt, binaryDigit, fadeStartMs, largestFitting, DEFAULT_KNOBS,
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

test("cellPhaseAt reveals words sequentially: hidden → letter → binary", () => {
  const k = DEFAULT_KNOBS;
  expect(cellPhaseAt(0, 0, k)).toBe("letter");
  expect(cellPhaseAt(0, k.readHoldMs + 40, k)).toBe("binary");
  expect(cellPhaseAt(1, 0, k)).toBe("hidden");
  expect(cellPhaseAt(1, k.wordStepMs, k)).toBe("letter"); // word 1 fades in as word 0 converts
  expect(cellPhaseAt(1, k.wordStepMs + k.readHoldMs + 40, k)).toBe("binary");
});

test("binaryDigit is deterministic, flips over time, and shimmers across cells", () => {
  const k = DEFAULT_KNOBS;
  expect(["0", "1"]).toContain(binaryDigit(0, 0, k));
  const overTime = new Set([0, 100, 200, 300, 400].map((t) => binaryDigit(3, t, k)));
  expect(overTime.size).toBe(2); // the cell flips between 0 and 1
  const acrossCells = new Set([0, 1, 2, 3, 4, 5].map((c) => binaryDigit(c, 130, k)));
  expect(acrossCells.size).toBe(2); // cells are not all in lockstep
});

test("fadeStartMs accounts for all words + the end hold", () => {
  const k = DEFAULT_KNOBS;
  expect(fadeStartMs(2, k)).toBe(1 * k.wordStepMs + k.readHoldMs + k.endHoldMs);
});

test("largestFitting binary-searches the biggest fitting size", () => {
  expect(largestFitting(8, 100, (px) => px <= 37)).toBe(37);
  expect(largestFitting(8, 100, () => true)).toBe(100);
  expect(largestFitting(8, 100, () => false)).toBe(8); // none fit → min
});
