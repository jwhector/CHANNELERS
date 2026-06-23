import { useCallback, useEffect, useRef, useState } from "react";
import type { WsServerMsg } from "@channelers/shared";
import { useBrainSocket } from "../lib/useBrainSocket";
import { useDevices } from "../lib/devices";
import { DevicePicker } from "../components/DevicePicker";
import { api } from "../lib/api";
import { paperFedText, captureDataUrl } from "../lib/paperFeed";
import { FeedMatrix } from "../components/FeedMatrix";
import "../styles/feed.css";

/** Presentational "into the matrix" surface — the fed text dissolving, or an idle prompt. */
export function FeedDisplay({
  text, capturing, connected,
}: { text: string | null; capturing: boolean; connected: boolean }) {
  return (
    <div className="feed-matrix">
      {text ? (
        <FeedMatrix key={text} text={text} />
      ) : (
        <p className="feed-idle">Feed a page to the machine.</p>
      )}
      {capturing && <p className="feed-status" aria-live="polite">capturing…</p>}
      <span className={connected ? "led on" : "led"} aria-hidden />
    </div>
  );
}

/** The /feed station: webcam over the slot, physical button (keypress) grabs a frame → OCR → animate. */
export function Feed() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const cam = useDevices("videoinput", "channelers.feedCam", "cam");

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    const fed = paperFedText(m);
    if (fed !== null) setText(fed);
  });

  // attach the selected camera to the <video> for the screen's lifetime
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cam.deviceId ? { deviceId: { exact: cam.deviceId } } : true,
          audio: false,
        });
        const video = videoRef.current;
        if (!video || cancelled) return;
        (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
      } catch {
        /* no camera in dev / permission denied — the idle prompt is fine */
      }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cam.deviceId]);

  const fire = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    const dataUrl = captureDataUrl(video);
    if (!dataUrl) return;
    setCapturing(true);
    try {
      await api.feedPaper(dataUrl); // the text comes back via the paper.fed WS event
    } catch {
      /* swallow — the operator/visitor can re-press */
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  // a USB arcade button / footswitch presents as a keypress (Space/Enter by default)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); void fire(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fire]);

  return (
    <div className="feed-route">
      <video ref={videoRef} className="feed-cam" playsInline muted />
      <FeedDisplay text={text} capturing={capturing} connected={connected} />
      <div className="feed-controls">
        <DevicePicker
          kind="videoinput"
          label="Camera"
          devices={cam.devices}
          value={cam.deviceId}
          onChange={cam.setDeviceId}
          needsPermission={cam.needsPermission}
          onEnableLabels={cam.enableLabels}
        />
        <button type="button" onClick={() => void fire()}>Feed (Space)</button>
      </div>
    </div>
  );
}
