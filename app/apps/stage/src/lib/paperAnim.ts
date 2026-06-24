/**
 * Pure animation core for the /feed "into the matrix" effect.
 *
 * The fed OCR text is laid out as fixed-width monospace cells (so a letter→digit swap never
 * shifts the layout). The whole text fades in readable, holds, then its letters convert to
 * constantly-flipping 0/1 in a quick per-cell ripple. After a binary hold, a **black hole** opens
 * at the centre of the screen: cells are ripped in one at a time in a random order, each flung
 * toward the centre (translate + spin + shrink) where it vanishes, until the field is empty.
 * These functions are deterministic (time/index in, value out) so the machinery is unit-testable;
 * the cell→centre travel itself is GPU CSS keyframes driven by the per-cell timings computed here.
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
  /** Hold in flipping binary after the ripple, before the black hole opens (ms). */
  binaryHoldMs: number;
  /** Spread of the per-character shred starts (ms): each cell is pulled in at a random offset in
   *  [0, shredWindowMs). Larger → a slower, more drawn-out character-by-character rip; smaller →
   *  the field collapses inward more at once. */
  shredWindowMs: number;
  /** How long a single character takes to travel into the centre and vanish (ms). */
  shredDurationMs: number;
};

export const DEFAULT_KNOBS: PaperAnimKnobs = {
  readHoldMs: 1000,
  transformStaggerMs: 4,
  flipMinMs: 70,
  flipMaxMs: 140,
  binaryHoldMs: 600,
  shredWindowMs: 2600,
  shredDurationMs: 750,
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

/** When the black hole opens — after the last cell converts to binary + the binary hold. */
export function shredBeginMs(cellCount: number, k: PaperAnimKnobs): number {
  const lastConvertsAt = k.readHoldMs + Math.max(0, cellCount - 1) * k.transformStaggerMs;
  return lastConvertsAt + k.binaryHoldMs;
}

/** Deterministic per-cell offset in [0, shredWindowMs): when this character starts getting ripped
 *  in, relative to the black hole opening. The hash scatters the order so the rip looks random. */
export function shredDelayFor(cellIndex: number, k: PaperAnimKnobs): number {
  const h = ((cellIndex * 2654435761) >>> 0) % 10000;
  return (h / 10000) * k.shredWindowMs;
}

/** Deterministic per-cell spin (deg) applied as the character spirals into the centre. */
export function shredSpinDeg(cellIndex: number): number {
  const h = ((cellIndex * 40503) >>> 0) % 720; // 0..719
  return h - 360; // -360..359
}

/** When the whole sequence is done and the field is empty (last possible vanish). */
export function totalMs(cellCount: number, k: PaperAnimKnobs): number {
  return shredBeginMs(cellCount, k) + k.shredWindowMs + k.shredDurationMs;
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
