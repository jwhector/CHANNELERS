import { useCallback, useRef, useState } from "react";
import type { VisitorProfile } from "@channelers/shared";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import { bodyCoverage, isBodyFramed, landmarksToAngles, motionMetric, type PoseVector } from "../lib/pose/angles";
import { type Landmark } from "../lib/pose/landmarks";
import { api } from "../lib/api";
import { CalledGate } from "../components/CalledGate";
import { Bar, drawSkeleton } from "../components/poseUI";

type Phase = "ready" | "record" | "saving" | "enrolled";

export function BodyScan() {
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  if (!visitor) return <CalledGate station="bodyscan" title="Body Scan" onArrived={setVisitor} />;
  return <Enroll visitor={visitor} />;
}

function Enroll({ visitor }: { visitor: VisitorProfile }) {
  const [stillness, setStillness] = useState(0.05);
  const [recordSec, setRecordSec] = useState(3.5);
  const [phase, setPhase] = useState<Phase>("ready");
  const [motion, setMotion] = useState(1);
  const [holdProgress, setHoldProgress] = useState(0);
  const [framed, setFramed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("ready");
  const prevVecRef = useRef<PoseVector | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const framedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Hysteretic framing flag, mirrored into state for render. Threading the
  // previous value through isBodyFramed keeps the "step into frame" warning from
  // strobing when coverage sits at the boundary.
  const updateFramed = (coverage: number) => {
    const next = isBodyFramed(coverage, framedRef.current);
    if (next !== framedRef.current) { framedRef.current = next; setFramed(next); }
    return next;
  };

  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  async function persist(vec: PoseVector) {
    setPhaseBoth("saving");
    try {
      await api.enrollPose(visitor.id, vec);
      setPhaseBoth("enrolled");
    } catch (e) {
      setError(String(e));
      setPhaseBoth("ready");
    }
  }

  const onFrame = useCallback((lms: Landmark[] | null, tMs: number) => {
    const canvas = canvasRef.current;
    const video = canvas?.previousElementSibling as HTMLVideoElement | null;
    if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    drawSkeleton(canvasRef.current, lms);
    if (!lms) { holdStartRef.current = null; prevVecRef.current = null; setMotion(1); updateFramed(0); return; }

    const vec = landmarksToAngles(lms);
    const framedNow = updateFramed(bodyCoverage(vec));
    const m = prevVecRef.current ? motionMetric(prevVecRef.current, vec) : 1;
    prevVecRef.current = vec;
    setMotion(m);

    if (phaseRef.current !== "record") return;
    const still = m < stillness && framedNow;
    if (!still) { holdStartRef.current = null; setHoldProgress(0); return; }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    const prog = Math.min(1, (tMs - holdStartRef.current) / (recordSec * 1000));
    setHoldProgress(prog);
    if (prog >= 1) { holdStartRef.current = null; void persist(vec); }
  }, [stillness, recordSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const { videoRef, status, error: camError, start } = usePoseLandmarker(onFrame);

  const prompt = {
    ready: "Press start, then invent a shape only you will remember.",
    record: "Strike your shape — and hold it.",
    saving: "Saving your shape…",
    enrolled: "Your shape is saved. Return to the waiting room until you are called.",
  }[phase];

  // The hold only counts while the whole body is framed, so warn the visitor the
  // moment they're cut off — but only while we're actually looking (ready/record).
  const showFrameHint = status === "running" && !framed && (phase === "ready" || phase === "record");

  return (
    <main className="void">
      <h1>Body Scan</h1>
      <p className="dim">Number {visitor.number} · invent and hold a shape — it becomes your key.</p>

      <div className={`posestage${showFrameHint ? " unframed" : ""}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {showFrameHint && (
          <div className="framehint">Step back so your whole body — head to toe — is in frame.</div>
        )}
        {phase === "enrolled" && <div className="poseflash">✓ SAVED</div>}
      </div>

      <p style={{ fontSize: 20, minHeight: 28 }}>{prompt}</p>

      <div className="controls">
        {status !== "running" ? (
          <button className="submit" onClick={start} disabled={status === "loading"}>
            {status === "loading" ? "loading model…" : "Start camera"}
          </button>
        ) : phase === "ready" || phase === "enrolled" ? (
          <button className="submit" onClick={() => setPhaseBoth("record")}>
            {phase === "enrolled" ? "Re-record shape" : "Record shape"}
          </button>
        ) : null}
      </div>
      {(error || camError) && <p className="error">{error ?? `camera/model error: ${camError}`}</p>}

      {status === "running" && (
        <>
          <div className="posebars">
            <Bar label="motion" value={1 - Math.min(1, motion / 0.3)} text={motion.toFixed(3)} good={motion < stillness} />
            <Bar label="record hold" value={holdProgress} text={`${(holdProgress * 100).toFixed(0)}%`} good={holdProgress >= 1} />
          </div>
          <details>
            <summary className="dim">tuning</summary>
            <div className="tuners">
              <Tuner label="stillness (rad)" min={0.01} max={0.2} step={0.005} value={stillness} onChange={setStillness} />
              <Tuner label="record hold (s)" min={1} max={6} step={0.5} value={recordSec} onChange={setRecordSec} />
            </div>
          </details>
        </>
      )}
    </main>
  );
}

function Tuner({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="tuner">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{value.toFixed(3)}</span>
    </div>
  );
}
