/** Whole seconds remaining until `untilMs`, clamped at 0 (rounds up). */
export const remainingSec = (untilMs: number, now: number): number =>
  Math.max(0, Math.ceil((untilMs - now) / 1000));

/** Seconds → "m:ss" (≥60s) or "Ns" (<60s). */
export const fmtClock = (sec: number): string =>
  sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec}s`;

/** No-show deadline (epoch ms) for a called occupant. */
export const noShowDeadline = (since: string, noShowMs: number): number =>
  Date.parse(since) + noShowMs;
