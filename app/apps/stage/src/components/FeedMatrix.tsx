import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  tokenize, cellPhaseAt, binaryDigit, fadeStartMs, largestFitting,
  DEFAULT_KNOBS, type Cell, type PaperAnimKnobs,
} from "../lib/paperAnim";

/**
 * The "into the matrix" surface. The fed text is laid out as fixed-width monospace cells; words
 * reveal one at a time (fade in readable → hold → convert to constantly-flipping 0/1, accumulating),
 * then the whole field fades out. Sized to fit the viewport. Pass `nowMs` to drive the timeline
 * deterministically (tests); otherwise it runs off an internal rAF clock.
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

  // Fire onDone once the whole sequence (reveal + end hold + fade-out) has played.
  useEffect(() => {
    if (nowMs !== undefined || !onDone) return;
    const total = fadeStartMs(words.length, knobs) + knobs.fadeOutMs;
    const id = setTimeout(() => onDone(), total);
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

  const fading = now >= fadeStartMs(words.length, knobs);

  return (
    <div
      ref={gridRef}
      className={`feed-matrix-grid${fading ? " fading" : ""}`}
      aria-label={displayText}
    >
      {words.map((word, gi) => {
        const phase = cellPhaseAt(gi, now, knobs);
        return (
          <Fragment key={gi}>
            {gi > 0 ? " " : null}
            <span className="feed-word">
              {word.map((c) => (
                <span key={c.cellIndex} className={`feed-cell ${phase}`}>
                  {phase === "binary" ? binaryDigit(c.cellIndex, now, knobs) : c.char}
                </span>
              ))}
            </span>
          </Fragment>
        );
      })}
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
