import { useCallback, useEffect, useRef, useState } from "react";
import type { SlotOccupant, WsServerMsg } from "@channelers/shared";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import { bodyCoverage, isBodyFramed, landmarksToAngles, motionMetric, type PoseVector } from "../lib/pose/angles";
import { type Landmark } from "../lib/pose/landmarks";
import { api } from "../lib/api";
import { drawSkeleton } from "../components/poseUI";
import { useStationPresence } from "../lib/useStationPresence";
import { useBrainSocket } from "../lib/useBrainSocket";
import { useDevices } from "../lib/devices";
import { SegmentNumber } from "../components/SegmentNumber";
import "../styles/crt.css"; // .seg + DSEG7 font
import "../styles/bodyscan.css";

type ArmRef = { current: (() => void) | null };

/**
 * The /bodyscan FRONT display — a controls-free TV in front of the visitor.
 * Renders purely from dispatch.state (no CalledGate, no visitor fetch):
 *   - no/ pending occupant → dim standby readout
 *   - called occupant      → the retro number, "proceed to body scan"
 *   - in_progress occupant → full-bleed camera + skeleton; the operator arms capture from /station
 * Camera selection lives here (always mounted): the kiosk reports its cameras to the brain so the
 * performer can pick one remotely on /station, and a relayed set-camera command switches it.
 */
export function BodyScan() {
  const { connected, slot } = useStationPresence("bodyscan");
  const occ = slot?.occupant;
  const kioskId = slot?.kioskId;
  const cam = useDevices("videoinput", "cam.bodyscan", "cam");
  const [savedNumber, setSavedNumber] = useState<number | null>(null);
  const armRef = useRef<(() => void) | null>(null);

  // Publish this kiosk's cameras so /station can pick one remotely (works in standby too).
  useEffect(() => {
    if (!kioskId || cam.devices.length === 0) return;
    void api.reportBodyscanCameras(
      kioskId,
      cam.devices.map((d) => ({ id: d.deviceId, label: d.label })),
      cam.deviceId || undefined,
    );
  }, [kioskId, cam.devices, cam.deviceId]);

  // Relayed operator commands for this kiosk: set-camera (switch) + capture (arm the in-progress hold).
  useBrainSocket((m: WsServerMsg) => {
    if (m.kind !== "station.cmd" || m.station !== "bodyscan") return;
    if (m.action === "set-camera" && m.kioskId === kioskId) cam.setDeviceId(m.deviceId);
    else if (m.action === "capture" && occ?.phase === "in_progress" && m.visitorId === occ.visitorId) armRef.current?.();
  });

  useEffect(() => {
    if (savedNumber == null) return;
    const t = setTimeout(() => setSavedNumber(null), 3000);
    return () => clearTimeout(t);
  }, [savedNumber]);

  if (savedNumber != null) return <BodyScanSaved number={savedNumber} />;
  if (occ?.phase === "in_progress")
    return (
      <BodyScanCamera
        visitorId={occ.visitorId}
        number={occ.number}
        deviceId={cam.deviceId}
        armRef={armRef}
        onCameraReady={cam.refresh}
        onSaved={setSavedNumber}
      />
    );
  return <BodyScanStandby occ={occ} connected={connected} />;
}

function BodyScanStandby({ occ, connected }: { occ: SlotOccupant | undefined; connected: boolean }) {
  const called = occ && occ.phase !== "pending";
  return (
    <main className="bodyscan-standby">
      <span className={`bodyscan-led ${connected ? "led on" : "led"}`} title={connected ? "live" : "offline"} />
      {called ? (
        <>
          <p className="bodyscan-eyebrow">now serving</p>
          <SegmentNumber value={occ.number} glitch />
          <p className="bodyscan-eyebrow">proceed to body scan</p>
        </>
      ) : (
        <>
          <SegmentNumber value={0} className="seg-dim" />
          <p className="bodyscan-eyebrow">awaiting designation</p>
        </>
      )}
    </main>
  );
}

const RECORD_SEC = 3.5; // hold-still duration before the pose is saved
const STILLNESS = 0.05; // max per-frame motion (radians) that still counts as "held"

function BodyScanCamera({
  visitorId,
  number,
  deviceId,
  armRef,
  onCameraReady,
  onSaved,
}: {
  visitorId: string;
  number: number;
  deviceId: string;
  armRef: ArmRef;
  onCameraReady?: () => void;
  onSaved: (n: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevVecRef = useRef<PoseVector | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const framedRef = useRef(false);
  const armedRef = useRef(false);
  const savingRef = useRef(false);
  const readyRef = useRef(false);
  const [framed, setFramed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);

  const updateFramed = (coverage: number) => {
    const next = isBodyFramed(coverage, framedRef.current);
    if (next !== framedRef.current) { framedRef.current = next; setFramed(next); }
    return next;
  };

  // Toggle the armed (hold-watching) state and reset any hold in progress.
  const toggleArmed = useCallback(() => {
    const v = !armedRef.current;
    armedRef.current = v;
    setArmed(v);
    holdStartRef.current = null;
    setHoldProgress(0);
    if (v) savingRef.current = false;
  }, []);

  const persist = useCallback(async (vec: PoseVector) => {
    if (savingRef.current) return;
    savingRef.current = true;
    armedRef.current = false; setArmed(false);
    try {
      await api.enrollPose(visitorId, vec);
      onSaved(number); // dispatcher frees the slot on poseAt; the parent shows the flash
    } catch {
      savingRef.current = false; // let the operator re-arm and retry
    }
  }, [visitorId, number, onSaved]);

  // The operator arms capture from /station (relayed via the parent's armRef); only then does the
  // kiosk run the stillness-hold — which advances ONLY while the body is framed AND held still, and
  // saves at the top. So a capture is impossible without a valid, in-frame pose.
  const onFrame = useCallback((lms: Landmark[] | null, tMs: number) => {
    const canvas = canvasRef.current;
    const video = canvas?.previousElementSibling as HTMLVideoElement | null;
    if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    drawSkeleton(canvasRef.current, lms);
    if (!lms) {
      prevVecRef.current = null; holdStartRef.current = null; updateFramed(0);
      if (armedRef.current) setHoldProgress(0);
      return;
    }
    const vec = landmarksToAngles(lms);
    const framedNow = updateFramed(bodyCoverage(vec));
    const motion = prevVecRef.current ? motionMetric(prevVecRef.current, vec) : 1;
    prevVecRef.current = vec;

    if (!armedRef.current) return;
    const still = motion < STILLNESS && framedNow;
    if (!still) { holdStartRef.current = null; setHoldProgress(0); return; }
    if (holdStartRef.current == null) holdStartRef.current = tMs;
    const prog = Math.min(1, (tMs - holdStartRef.current) / (RECORD_SEC * 1000));
    setHoldProgress(prog);
    if (prog >= 1) { holdStartRef.current = null; void persist(vec); }
  }, [persist]);

  const { videoRef, status, error, start } = usePoseLandmarker(onFrame, deviceId);

  // No Start button on a controls-free display — auto-start once the model is idle.
  useEffect(() => { if (status === "idle") void start(); }, [status, start]);

  // Expose the arm-toggle to the parent's relay; once the camera is live, refresh the parent's
  // device list so its now-permitted camera labels reach the operator's picker.
  useEffect(() => {
    armRef.current = toggleArmed;
    return () => { armRef.current = null; };
  }, [armRef, toggleArmed]);
  useEffect(() => {
    if (status === "running" && !readyRef.current) { readyRef.current = true; onCameraReady?.(); }
  }, [status, onCameraReady]);

  const showFrameHint = status === "running" && !framed;

  return (
    <div className="bodyscan-cam">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
      {showFrameHint && <div className="framehint">Step back so your whole body is in frame.</div>}
      {armed && !showFrameHint && (
        <div className="bodyscan-hold">
          <p className="bodyscan-hold-label">hold your shape</p>
          <div className="bodyscan-hold-track">
            <div className="bodyscan-hold-fill" style={{ width: `${Math.round(holdProgress * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <div className="framehint">camera unavailable — {error}</div>}
    </div>
  );
}

function BodyScanSaved({ number }: { number: number }) {
  return (
    <main className="bodyscan-saved">
      <SegmentNumber value={number} />
      <p className="bodyscan-eyebrow">✓ saved</p>
      <p className="bodyscan-eyebrow">proceed to the waiting room</p>
    </main>
  );
}
