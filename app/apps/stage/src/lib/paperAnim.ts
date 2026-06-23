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
  /** How long the whole text stays readable before it transforms into binary (ms). */
  readHoldMs: number;
  /** Per-cell delay across the transform so it ripples into binary quickly rather than all at once (ms). */
  transformStaggerMs: number;
  /** Per-cell binary flip period range (ms) — varied per cell for shimmer. */
  flipMinMs: number;
  flipMaxMs: number;
  /** Hold in flipping binary after the transform, before the field fades out (ms). */
  endHoldMs: number;
  /** Final fade-out duration (ms). */
  fadeOutMs: number;
};

export const DEFAULT_KNOBS: PaperAnimKnobs = {
  readHoldMs: 1000,
  transformStaggerMs: 8,
  flipMinMs: 70,
  flipMaxMs: 140,
  endHoldMs: 1400,
  fadeOutMs: 900,
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

/**
 * Phase of a cell at elapsed time t. The whole text is readable from the start ("letter"); after
 * `readHoldMs` it transforms into binary, rippling quickly across cells by `transformStaggerMs`.
 */
export function cellPhaseAt(cellIndex: number, tMs: number, k: PaperAnimKnobs): CellPhase {
  const convertAt = k.readHoldMs + cellIndex * k.transformStaggerMs;
  return tMs < convertAt ? "letter" : "binary";
}

/** Deterministic flipping digit for a binary cell — per-cell period + offset give an alive shimmer. */
export function binaryDigit(cellIndex: number, tMs: number, k: PaperAnimKnobs): "0" | "1" {
  const span = Math.max(1, k.flipMaxMs - k.flipMinMs + 1);
  const period = k.flipMinMs + ((cellIndex * 37) % span);
  const offset = (cellIndex * 131) % period;
  return Math.floor((tMs + offset) / period) % 2 === 0 ? "0" : "1";
}

/** When the whole field should begin fading out (after the last cell converts + end hold). */
export function fadeStartMs(cellCount: number, k: PaperAnimKnobs): number {
  const lastConvertsAt = k.readHoldMs + Math.max(0, cellCount - 1) * k.transformStaggerMs;
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
