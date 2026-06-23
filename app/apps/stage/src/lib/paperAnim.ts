/**
 * Pure animation core for the /feed "into the matrix" effect.
 *
 * The fed OCR text is laid out as fixed-width monospace cells (so a letter→digit swap never
 * shifts the layout). Words reveal one at a time: a word fades in readable, holds briefly, then
 * its letters convert to constantly-flipping 0/1 — and word i converts exactly as word i+1 fades
 * in. After the last word converts + an end hold, the whole field fades out. These functions are
 * deterministic (time in, value out) so the visual machinery is unit-testable.
 */

export type Cell = { char: string; isSpace: boolean; wordIndex: number; cellIndex: number };
export type CellPhase = "hidden" | "letter" | "binary";

export type PaperAnimKnobs = {
  /** Cadence between consecutive word reveals (ms). */
  wordStepMs: number;
  /** How long a word stays readable before its letters convert to binary (ms). */
  readHoldMs: number;
  /** Per-cell binary flip period range (ms) — varied per cell for shimmer. */
  flipMinMs: number;
  flipMaxMs: number;
  /** Hold after the last word converts, before the whole field fades out (ms). */
  endHoldMs: number;
  /** Final fade-out duration (ms). */
  fadeOutMs: number;
};

export const DEFAULT_KNOBS: PaperAnimKnobs = {
  wordStepMs: 560,
  readHoldMs: 560,
  flipMinMs: 90,
  flipMaxMs: 160,
  endHoldMs: 1200,
  fadeOutMs: 1500,
};

/** Split text into fixed cells. Non-space runs are words (0,1,2…); whitespace cells reserve space. */
export function tokenize(text: string): Cell[] {
  const cells: Cell[] = [];
  let wordIndex = -1;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isSpace = /\s/.test(char);
    if (isSpace) {
      inWord = false;
      cells.push({ char, isSpace: true, wordIndex: -1, cellIndex: i });
    } else {
      if (!inWord) { wordIndex++; inWord = true; }
      cells.push({ char, isSpace: false, wordIndex, cellIndex: i });
    }
  }
  return cells;
}

/** Number of words (non-space runs). */
export function wordCount(cells: Cell[]): number {
  return cells.reduce((max, c) => (c.wordIndex > max ? c.wordIndex : max), -1) + 1;
}

/** Phase of a word's cells at elapsed time t. */
export function cellPhaseAt(wordIndex: number, tMs: number, k: PaperAnimKnobs): CellPhase {
  const start = wordIndex * k.wordStepMs;
  if (tMs < start) return "hidden";
  if (tMs < start + k.readHoldMs) return "letter";
  return "binary";
}

/** Deterministic flipping digit for a binary cell — per-cell period + offset give an alive shimmer. */
export function binaryDigit(cellIndex: number, tMs: number, k: PaperAnimKnobs): "0" | "1" {
  const span = Math.max(1, k.flipMaxMs - k.flipMinMs + 1);
  const period = k.flipMinMs + ((cellIndex * 37) % span);
  const offset = (cellIndex * 131) % period;
  return Math.floor((tMs + offset) / period) % 2 === 0 ? "0" : "1";
}

/** When the whole field should begin fading out (after the last word converts + end hold). */
export function fadeStartMs(words: number, k: PaperAnimKnobs): number {
  const lastConvertsAt = (Math.max(1, words) - 1) * k.wordStepMs + k.readHoldMs;
  return lastConvertsAt + k.endHoldMs;
}

/** Largest integer px in [min,max] for which `fits(px)` holds (assumes monotonic); min if none fit. */
export function largestFitting(min: number, max: number, fits: (px: number) => boolean): number {
  let lo = min, hi = max, best = min;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}
