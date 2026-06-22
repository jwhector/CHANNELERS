/**
 * A seven-segment LED number (DSEG font). The ghost layer renders all-`8`s at the
 * unlit-segment colour so the dark segments stay visible behind the lit value —
 * the deli-counter / DMV "now serving" look. Pads to `digits` but never truncates.
 */
export function SegmentNumber({
  value,
  digits = 3,
  glitch = false,
  className = "",
}: {
  value: number;
  digits?: number;
  glitch?: boolean;
  className?: string;
}) {
  const text = String(value).padStart(digits, "0");
  const ghost = "8".repeat(text.length);
  return (
    <div
      className={`seg${glitch ? " seg-glitch" : ""}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={String(value)}
    >
      <span className="seg-ghost" aria-hidden>{ghost}</span>
      <span className="seg-front" aria-hidden>{text}</span>
    </div>
  );
}
