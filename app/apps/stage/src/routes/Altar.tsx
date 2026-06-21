import { useCallback, useRef, useState } from "react";
import { ARCHETYPES, type VisitorProfile } from "@channelers/shared";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import { landmarksToAngles, motionMetric, poseSimilarity, type PoseVector } from "../lib/pose/angles";
import { type Landmark } from "../lib/pose/landmarks";
import { api } from "../lib/api";
import { CalledGate } from "../components/CalledGate";
import { Bar, drawSkeleton } from "../components/poseUI";

export function Altar() {
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  if (!visitor) return <CalledGate station="altar" title="Altar" onArrived={setVisitor} />;
  return <Gate visitor={visitor} />;
}

function Gate({ visitor }: { visitor: VisitorProfile }) {
  const template = (visitor.poseTemplate as PoseVector | undefined) ?? null;
  const [stillness] = useState(0.05);
  const [matchThresh] = useState(0.9);
  const [verifySec] = useState(1.5);

  const [verified, setVerified] = useState(!!visitor.poseVerifiedAt);
  const [archetype, setArchetype] = useState<string | null>(visitor.archetype ?? null);
  const [similarity, setSimilarity] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const verifiedRef = useRef(verified);
  verifiedRef.current = verified;
  const holdStartRef = useRef<number | null>(null);
  const prevVecRef = useRef<PoseVector | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  async function markVerified() {
    if (verifiedRef.current) return;
    setVerified(true);
    try { await api.verifyPose(visitor.id); }
    catch (e) { setError(String(e)); setVerified(false); }
  }

  async function pick(id: string) {
    setArchetype(id);
    try { await api.setPersona(visitor.id, id); }
    catch (e) { setError(String(e)); setArchetype(null); }
  }

  const onFrame = useCallback((lms: Landmark[] | null, tMs: number) => {
    const canvas = canvasRef.current;
    const video = canvas?.previousElementSibling as HTMLVideoElement | null;
    if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    drawSkeleton(canvasRef.current, lms);
    if (verifiedRef.current || !template || !lms) {
      holdStartRef.current = null; prevVecRef.current = null; return;
    }
    const vec = landmarksToAngles(lms);
    const bodyVisible = vec.weights.reduce((s, w) => s + w, 0) / vec.weights.length > 0.5;
    const motion = prevVecRef.current ? motionMetric(prevVecRef.current, vec) : 1;
    prevVecRef.current = vec;
    const sim = poseSimilarity(template, vec);
    setSimilarity(sim);
    const qualifies = bodyVisible && motion < stillness && sim >= matchThresh;
    if (!qualifies) { holdStartRef.current = null; setHoldProgress(0); return; }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    const prog = Math.min(1, (tMs - holdStartRef.current) / (verifySec * 1000));
    setHoldProgress(prog);
    if (prog >= 1) { holdStartRef.current = null; void markVerified(); }
  }, [template, stillness, matchThresh, verifySec]); // eslint-disable-line react-hooks/exhaustive-deps

  const { videoRef, status, error: camError, start } = usePoseLandmarker(onFrame);
  const ready = verified && !!archetype;

  return (
    <main className="void">
      <h1>Altar</h1>
      <p className="dim">Number {visitor.number} · {visitor.survey?.name ?? "—"}</p>
      {ready && <p className="poseflash">ORACLE READY — proceed to be channelled.</p>}
      {error && <p className="error">{error}</p>}

      <h3>1 · Validate your shape</h3>
      {!template && <p className="dim">No pose on file — use the manual override, or send them back to /bodyscan.</p>}
      <div className="posestage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {verified && <div className="poseflash">✓ VERIFIED</div>}
      </div>
      {!verified && (
        <div className="controls">
          {status !== "running" ? (
            <button className="submit" onClick={start} disabled={status === "loading" || !template}>
              {status === "loading" ? "loading model…" : "Start camera"}
            </button>
          ) : (
            <div className="posebars">
              <Bar label="similarity" value={similarity} text={`${(similarity * 100).toFixed(0)}%`} good={similarity >= matchThresh} />
              <Bar label="verify hold" value={holdProgress} text={`${(holdProgress * 100).toFixed(0)}%`} good={holdProgress >= 1} />
            </div>
          )}
          <button className="end" onClick={() => void markVerified()}>Manual unlock (override)</button>
        </div>
      )}
      {camError && <p className="error">camera/model error: {camError}</p>}

      <h3>2 · Choose the oracle</h3>
      <div className="choices oracle-choices">
        {ARCHETYPES.map((a) => (
          <button
            key={a.id}
            type="button"
            className={archetype === a.id ? "choice on" : "choice"}
            onClick={() => void pick(a.id)}
          >
            <strong>{a.label}</strong>
            <span className="dim">{a.blurb}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
