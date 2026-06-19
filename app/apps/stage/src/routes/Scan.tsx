import { useCallback, useRef, useState } from "react";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import {
  landmarksToAngles,
  motionMetric,
  poseSimilarity,
  type PoseVector,
} from "../lib/pose/angles";
import { CONNECTIONS, JOINTS, type Landmark } from "../lib/pose/landmarks";

/**
 * Pose scan station — iteration 1 (self-recorded round-trip). See ARCHITECTURE.md §6.
 * Strike a pose and hold it → it locks in as a template → later, return to that
 * shape and hold briefly → it confirms the match. Record and detect are the same
 * "hold a qualifying state for N seconds" machine; only the predicate differs
 * (record = just be still; detect = be still AND match the template).
 *
 * Functional debug view: live skeleton, motion/similarity/hold telemetry, a
 * per-joint table, and live-tunable thresholds. Themed UI comes later.
 */

type Phase = "ready" | "record" | "watch" | "matched";

type Telemetry = {
  fps: number;
  motion: number; // radians/frame; low = holding still
  similarity: number; // 0..1 vs. template
  holdProgress: number; // 0..1
  bodyVisible: boolean;
  live: PoseVector | null;
};

const EMPTY: Telemetry = { fps: 0, motion: 1, similarity: 0, holdProgress: 0, bodyVisible: false, live: null };

export function Scan() {
  // ── tunables (live sliders) ──
  const [stillness, setStillness] = useState(0.05); // max rad/frame to count as "still"
  const [matchThresh, setMatchThresh] = useState(0.9); // min similarity to count as a match
  const [recordSec, setRecordSec] = useState(3.5);
  const [watchSec, setWatchSec] = useState(1.5);

  const [phase, setPhase] = useState<Phase>("ready");
  const [tel, setTel] = useState<Telemetry>(EMPTY);
  const [template, setTemplate] = useState<PoseVector | null>(null);

  // Machine state the per-frame loop reads/writes without waiting on React.
  const phaseRef = useRef<Phase>("ready");
  const templateRef = useRef<PoseVector | null>(null);
  const prevVecRef = useRef<PoseVector | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const lastFrameRef = useRef(-1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Advance the hold timer only while `qualifies`; reset the instant it fails.
  const updateHold = (qualifies: boolean, tMs: number, durMs: number) => {
    if (!qualifies) {
      holdStartRef.current = null;
      return 0;
    }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    return Math.min(1, (tMs - holdStartRef.current) / durMs);
  };

  const drawSkeleton = (lms: Landmark[] | null) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lms) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(231,227,218,0.7)";
    for (const [i, j] of CONNECTIONS) {
      const a = lms[i];
      const b = lms[j];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * W, a.y * H);
      ctx.lineTo(b.x * W, b.y * H);
      ctx.stroke();
    }
    for (const lm of lms) {
      const v = lm.visibility ?? 1;
      ctx.fillStyle = v > 0.6 ? "#ff5a3c" : "rgba(123,134,148,0.6)";
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const onFrame = useCallback(
    (lms: Landmark[] | null, tMs: number) => {
      // size the overlay to the video frame once we know it
      const canvas = canvasRef.current;
      const video = canvas?.previousElementSibling as HTMLVideoElement | null;
      if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      drawSkeleton(lms);

      const fps = lastFrameRef.current > 0 ? 1000 / (tMs - lastFrameRef.current) : 0;
      lastFrameRef.current = tMs;

      if (!lms) {
        holdStartRef.current = null;
        prevVecRef.current = null;
        setTel({ ...EMPTY, fps });
        return;
      }

      const vec = landmarksToAngles(lms);
      const bodyVisible = vec.weights.reduce((s, w) => s + w, 0) / vec.weights.length > 0.5;
      const motion = prevVecRef.current ? motionMetric(prevVecRef.current, vec) : 1;
      prevVecRef.current = vec;
      const still = motion < stillness && bodyVisible;
      const similarity = templateRef.current ? poseSimilarity(templateRef.current, vec) : 0;

      let holdProgress = 0;
      const ph = phaseRef.current;
      if (ph === "record") {
        holdProgress = updateHold(still, tMs, recordSec * 1000);
        if (holdProgress >= 1) {
          templateRef.current = vec;
          setTemplate(vec);
          holdStartRef.current = null;
          setPhaseBoth("watch");
        }
      } else if (ph === "watch") {
        holdProgress = updateHold(still && similarity >= matchThresh, tMs, watchSec * 1000);
        if (holdProgress >= 1) {
          holdStartRef.current = null;
          setPhaseBoth("matched");
          // hold the confirmation a beat, then return to watching
          setTimeout(() => {
            if (phaseRef.current === "matched") setPhaseBoth("watch");
          }, 2500);
        }
      }

      setTel({ fps, motion, similarity, holdProgress, bodyVisible, live: vec });
    },
    [stillness, matchThresh, recordSec, watchSec],
  );

  const { videoRef, status, error, start } = usePoseLandmarker(onFrame);

  const beginRecord = () => {
    templateRef.current = null;
    setTemplate(null);
    prevVecRef.current = null;
    holdStartRef.current = null;
    setPhaseBoth("record");
  };

  const prompt = {
    ready: "Press start, then strike a pose.",
    record: "Strike a pose — and hold it.",
    watch: "Pose locked. Return to your shape to be recognized.",
    matched: "Recognized.",
  }[phase];

  return (
    <main className="void">
      <h1>Scanning Station</h1>
      <p className="dim">
        Take the shape of your spirit animal for processing. {status === "running" ? `· ${tel.fps.toFixed(0)} fps` : ""}
      </p>

      <div className="posestage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {phase === "matched" && <div className="poseflash">✓ MATCH</div>}
      </div>

      <p style={{ fontSize: 20, minHeight: 28 }}>{prompt}</p>

      <div className="controls">
        {status !== "running" ? (
          <button className="submit" onClick={start} disabled={status === "loading"}>
            {status === "loading" ? "loading model…" : "Start camera"}
          </button>
        ) : (
          <button className="submit" onClick={beginRecord}>
            {template ? "Record new pose" : "Record pose"}
          </button>
        )}
        {!tel.bodyVisible && status === "running" && <span className="dim">· step into frame (full body)</span>}
      </div>
      {error && <p className="error">camera/model error: {error}</p>}

      {status === "running" && (
        <>
          <div className="posebars">
            <Bar label="motion" value={1 - Math.min(1, tel.motion / 0.3)} text={tel.motion.toFixed(3)} good={tel.motion < stillness} />
            <Bar label="similarity" value={tel.similarity} text={`${(tel.similarity * 100).toFixed(0)}%`} good={tel.similarity >= matchThresh} />
            <Bar label={phase === "record" ? "record hold" : "match hold"} value={tel.holdProgress} text={`${(tel.holdProgress * 100).toFixed(0)}%`} good={tel.holdProgress >= 1} />
          </div>

          <details>
            <summary className="dim">tuning</summary>
            <div className="tuners">
              <Tuner label="stillness (rad)" min={0.01} max={0.2} step={0.005} value={stillness} onChange={setStillness} />
              <Tuner label="match threshold" min={0.5} max={0.99} step={0.01} value={matchThresh} onChange={setMatchThresh} fmt={(v) => v.toFixed(2)} />
              <Tuner label="record hold (s)" min={1} max={6} step={0.5} value={recordSec} onChange={setRecordSec} />
              <Tuner label="match hold (s)" min={0.5} max={4} step={0.5} value={watchSec} onChange={setWatchSec} />
            </div>
          </details>

          {tel.live && (
            <table className="jointgrid">
              <thead>
                <tr>
                  <th>joint</th>
                  <th>live°</th>
                  <th>template°</th>
                  <th>Δ°</th>
                  <th>weight</th>
                </tr>
              </thead>
              <tbody>
                {JOINTS.map((j, i) => {
                  const live = (tel.live!.angles[i] * 180) / Math.PI;
                  const tpl = template ? (template.angles[i] * 180) / Math.PI : null;
                  return (
                    <tr key={j.name}>
                      <td>{j.name}</td>
                      <td>{live.toFixed(0)}</td>
                      <td>{tpl == null ? "–" : tpl.toFixed(0)}</td>
                      <td>{tpl == null ? "–" : Math.abs(live - tpl).toFixed(0)}</td>
                      <td>{tel.live!.weights[i].toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}

function Bar({ label, value, text, good }: { label: string; value: number; text: string; good: boolean }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track">
        <div className={`fill${good ? " good" : ""}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </div>
      <span className="val">{text}</span>
    </div>
  );
}

function Tuner({
  label,
  min,
  max,
  step,
  value,
  onChange,
  fmt,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="tuner">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{(fmt ?? ((v) => v.toFixed(3)))(value)}</span>
    </div>
  );
}
