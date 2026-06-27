import { CONNECTIONS, type Landmark } from "../lib/pose/landmarks";

export function Bar({ label, value, text, good }: { label: string; value: number; text: string; good: boolean }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track"><div className={`fill${good ? " good" : ""}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
      <span className="val">{text}</span>
    </div>
  );
}

export function drawSkeleton(canvas: HTMLCanvasElement | null, lms: Landmark[] | null) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lms) return;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(231,227,218,0.7)";
  for (const [i, j] of CONNECTIONS) {
    const a = lms[i], b = lms[j];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }
}

// Visibility a landmark needs before we paint a blob for it.
const AURA_VIS = 0.5;

/**
 * The bodyscan's fully-stylized render: an opaque void background (this is what
 * removes the webcam) with additive glowing bones and a colorblob at each visible
 * landmark. The altar keeps drawSkeleton — that camera is an operator diagnostic.
 */
export function drawAura(canvas: HTMLCanvasElement | null, lms: Landmark[] | null) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, w, h); // opaque background — removes the webcam feed
  if (!lms) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: overlapping glow blooms brighter

  // Glowing bones.
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(120,180,255,0.5)";
  ctx.shadowColor = "rgba(120,180,255,0.9)";
  ctx.shadowBlur = 24;
  for (const [i, j] of CONNECTIONS) {
    const a = lms[i], b = lms[j];
    if (!a || !b || (a.visibility ?? 1) < AURA_VIS || (b.visibility ?? 1) < AURA_VIS) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }

  // Colorblobs at each visible landmark — hue sweeps across the body.
  ctx.shadowBlur = 0;
  const r = Math.max(w, h) * 0.05;
  for (let k = 0; k < lms.length; k++) {
    const p = lms[k];
    if (!p || (p.visibility ?? 1) < AURA_VIS) continue;
    const cx = p.x * w, cy = p.y * h;
    const hue = (k / lms.length) * 300;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `hsla(${hue}, 90%, 70%, 0.9)`);
    g.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
