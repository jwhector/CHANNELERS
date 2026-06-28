import {
  CSSProperties, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import {
  tokenize, cellPhaseAt, binaryDigit, shredBeginMs, shredDelayFor, shredSpinDeg, totalMs,
  largestFitting, DEFAULT_KNOBS, type Cell, type PaperAnimKnobs,
} from "../lib/paperAnim";

/**
 * The "into the matrix" surface. The fed text is laid out as fixed-width monospace cells; the whole
 * text fades in readable, holds, then converts to constantly-flipping 0/1 in a quick ripple. A black
 * hole then opens at the centre of the screen and rips the characters in one at a time, in a random
 * order, each spiralling toward the centre where it vanishes — until the field is empty. Sized to fit
 * the viewport. Pass `nowMs` to drive the timeline deterministically (tests); otherwise it runs off an
 * internal rAF clock.
 */
export function FeedMatrix({
  text, onDone, nowMs, knobs = DEFAULT_KNOBS,
}: {
  text: string;
  onDone?: () => void;
  nowMs?: number;
  knobs?: PaperAnimKnobs;
}) {
  const displayText = useMemo(() => text.trim().replace(/\s+/g, " "), [text]);
  const cells = useMemo(() => tokenize(displayText), [displayText]);
  const words = useMemo(() => groupWords(cells), [cells]);

  const [now, setNow] = useState(nowMs ?? 0);
  const gridRef = useRef<HTMLDivElement>(null);

  // Per-cell vector (px) from where the character sits to the centre of the screen — measured once,
  // the instant the black hole opens, so the CSS keyframes can fling each cell to the centre.
  const [pulls, setPulls] = useState<Map<number, { dx: number; dy: number }> | null>(null);

  // Timeline clock: controlled (tests) or an internal rAF loop that restarts on each new text.
  useEffect(() => {
    if (nowMs !== undefined) { setNow(nowMs); return; }
    if (typeof requestAnimationFrame === "undefined" || typeof performance === "undefined") return;
    const start = performance.now();
    let raf = 0;
    const tick = () => { setNow(performance.now() - start); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nowMs, displayText]);

  // New text → fresh animation: drop any measured pull vectors from the previous shred.
  useEffect(() => { setPulls(null); }, [displayText]);

  // Fire onDone once the whole sequence (reveal → binary → black-hole shred) has played.
  useEffect(() => {
    if (nowMs !== undefined || !onDone) return;
    const id = setTimeout(() => onDone(), totalMs(cells.length, knobs));
    return () => clearTimeout(id);
  }, [displayText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the full text to the viewport: binary-search the largest font-size that doesn't overflow.
  useLayoutEffect(() => {
    const el = gridRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const refit = () => {
      const maxW = parent.clientWidth * 0.92;
      const maxH = parent.clientHeight * 0.8;
      if (!maxW || !maxH) return; // no layout (e.g. jsdom) — leave the CSS default
      const fits = (px: number) => {
        el.style.fontSize = `${px}px`;
        return el.scrollWidth <= maxW && el.scrollHeight <= maxH;
      };
      el.style.fontSize = `${largestFitting(12, 200, fits)}px`;
    };
    refit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(refit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [displayText]);

  const shredding = now >= shredBeginMs(cells.length, knobs);

  // The instant the black hole opens, measure each (still-static) cell's distance to the centre of
  // the viewport; that vector drives the per-cell CSS travel. Measured once per animation.
  useLayoutEffect(() => {
    if (!shredding || pulls || typeof window === "undefined") return;
    const el = gridRef.current;
    if (!el) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const next = new Map<number, { dx: number; dy: number }>();
    el.querySelectorAll<HTMLElement>("[data-ci]").forEach((node) => {
      const r = node.getBoundingClientRect();
      if (!r.width && !r.height) return; // no layout (e.g. jsdom) — skip; cells stay in place
      next.set(Number(node.dataset.ci), { dx: cx - (r.left + r.width / 2), dy: cy - (r.top + r.height / 2) });
    });
    if (next.size) setPulls(next);
  }, [shredding, pulls]);

  return (
    <div ref={gridRef} className="feed-matrix-grid" aria-label={displayText}>
      {words.map((word, gi) => (
        <Fragment key={gi}>
          {gi > 0 ? " " : null}
          <span className="feed-word">
            {word.map((c) => {
              const phase = cellPhaseAt(c.cellIndex, now, knobs);
              const pull = shredding ? pulls?.get(c.cellIndex) : undefined;
              const style = pull
                ? ({
                    "--dx": `${pull.dx}px`,
                    "--dy": `${pull.dy}px`,
                    "--spin": `${shredSpinDeg(c.cellIndex)}deg`,
                    animationDelay: `${shredDelayFor(c.cellIndex, knobs)}ms`,
                    animationDuration: `${knobs.shredDurationMs}ms`,
                  } as CSSProperties)
                : undefined;
              return (
                <span
                  key={c.cellIndex}
                  data-ci={c.cellIndex}
                  className={`feed-cell ${phase}${pull ? " shred" : ""}`}
                  style={style}
                >
                  {phase === "binary" ? binaryDigit(c.cellIndex, now, knobs) : c.char}
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Group tokenized cells into words (drops the reserved space cells; spacing is rendered between). */
function groupWords(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let cur: Cell[] = [];
  for (const c of cells) {
    if (c.isSpace) { if (cur.length) { out.push(cur); cur = []; } }
    else cur.push(c);
  }
  if (cur.length) out.push(cur);
  return out;
}
