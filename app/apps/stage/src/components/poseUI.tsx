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
