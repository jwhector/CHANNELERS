import { useCallback, useEffect, useRef, useState } from "react";
import type { SlotOccupant, WsServerMsg } from "@channelers/shared";
import { usePoseLandmarker } from "../lib/pose/usePoseLandmarker";
import { bodyCoverage, isBodyFramed, landmarksToAngles, type PoseVector } from "../lib/pose/angles";
import { type Landmark } from "../lib/pose/landmarks";
import { api } from "../lib/api";
import { drawSkeleton } from "../components/poseUI";
import { useStationPresence } from "../lib/useStationPresence";
import { useBrainSocket } from "../lib/useBrainSocket";
import { useDevices } from "../lib/devices";
import { DevicePicker } from "../components/DevicePicker";
import { SegmentNumber } from "../components/SegmentNumber";
import "../styles/crt.css"; // .seg + DSEG7 font
import "../styles/bodyscan.css";

/**
 * The /bodyscan FRONT display — a controls-free TV in front of the visitor.
 * It renders purely from dispatch.state (no CalledGate, no visitor fetch):
 *   - no/ pending occupant → dim standby readout
 *   - called occupant      → the retro number, "proceed to body scan"
 *   - in_progress occupant → full-bleed camera + skeleton; performer captures from /station
 * After a pose is enrolled the dispatcher frees the slot, so standby returns on its own;
 * a brief "✓ saved" flash bridges that gap so the visitor still sees confirmation.
 */
export function BodyScan() {
  const { connected, slot } = useStationPresence("bodyscan");
  const occ = slot?.occupant;
  const [savedNumber, setSavedNumber] = useState<number | null>(null);

  useEffect(() => {
    if (savedNumber == null) return;
    const t = setTimeout(() => setSavedNumber(null), 3000);
    return () => clearTimeout(t);
  }, [savedNumber]);

  if (savedNumber != null) return <BodyScanSaved number={savedNumber} />;
  if (occ?.phase === "in_progress")
    return <BodyScanCamera visitorId={occ.visitorId} number={occ.number} onSaved={setSavedNumber} />;
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

function BodyScanCamera({
  visitorId,
  number,
  onSaved,
}: {
  visitorId: string;
  number: number;
  onSaved: (n: number) => void;
}) {
  const cam = useDevices("videoinput", "cam.bodyscan", "cam");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastVecRef = useRef<PoseVector | null>(null);
  const framedRef = useRef(false);
  const savingRef = useRef(false);
  const [framed, setFramed] = useState(false);
  const setup = new URLSearchParams(location.search).get("setup") != null;

  const updateFramed = (coverage: number) => {
    const next = isBodyFramed(coverage, framedRef.current);
    if (next !== framedRef.current) { framedRef.current = next; setFramed(next); }
  };

  // Continuously track the latest pose; manual capture persists whatever it sees.
  const onFrame = useCallback((lms: Landmark[] | null) => {
    const canvas = canvasRef.current;
    const video = canvas?.previousElementSibling as HTMLVideoElement | null;
    if (canvas && video && video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    }
    drawSkeleton(canvasRef.current, lms);
    if (!lms) { lastVecRef.current = null; updateFramed(0); return; }
    const vec = landmarksToAngles(lms);
    lastVecRef.current = vec;
    updateFramed(bodyCoverage(vec));
  }, []);

  const { videoRef, status, error, start } = usePoseLandmarker(onFrame, cam.deviceId);

  // No Start button on a controls-free display — auto-start once the model is idle.
  useEffect(() => { if (status === "idle") void start(); }, [status, start]);

  const capture = useCallback(async () => {
    const vec = lastVecRef.current;
    if (!vec || savingRef.current) return;
    savingRef.current = true;
    try {
      await api.enrollPose(visitorId, vec);
      onSaved(number); // dispatcher frees the slot on poseAt; the parent shows the flash
    } catch {
      savingRef.current = false; // let the performer retry
    }
  }, [visitorId, number, onSaved]);

  // Hear the performer's Capture tap, relayed by the brain to this kiosk's occupant.
  useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "station.cmd" && m.station === "bodyscan" && m.action === "capture" && m.visitorId === visitorId) {
      void capture();
    }
  });

  const showFrameHint = status === "running" && !framed;

  return (
    <div className="bodyscan-cam">
      <video ref={videoRef} playsInline muted />
      <canvas ref={canvasRef} />
      {showFrameHint && <div className="framehint">Step back so your whole body — head to toe — is in frame.</div>}
      {error && <div className="framehint">camera unavailable — {error}</div>}
      {setup && (
        <div className="bodyscan-setup">
          <DevicePicker
            kind="videoinput"
            label="camera"
            devices={cam.devices}
            value={cam.deviceId}
            onChange={cam.setDeviceId}
            needsPermission={cam.needsPermission}
            onEnableLabels={cam.enableLabels}
          />
        </div>
      )}
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
