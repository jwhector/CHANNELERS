import { useCallback, useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./landmarks";

/**
 * Wraps MediaPipe Tasks-for-Web (the Pose Landmarker) + the webcam into one hook.
 * Attach `videoRef` to a <video>, call `start()` once the user opts in, and
 * `onFrame` fires every detection with the landmarks (or null when no body is
 * seen) plus the frame timestamp. Drawing + the state machine live in the caller.
 *
 * Model/WASM load from the MediaPipe CDN for now; for offline-resilient venue use
 * we'll vendor the .task + wasm locally (ARCHITECTURE.md §2). — workshop MVP.
 */

// Pose Landmarker comes in lite/full/heavy. `full` is the speed/accuracy sweet
// spot for a single station; swap to `heavy` if landmark quality is the limiter.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

export type PoseStatus = "idle" | "loading" | "running" | "error";

export function usePoseLandmarker(onFrame: (lms: Landmark[] | null, tMs: number) => void) {
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(-1);

  // Keep the callback fresh without restarting the loop.
  const cb = useRef(onFrame);
  cb.current = onFrame;

  const loop = useCallback(() => {
    const video = videoRef.current;
    const lm = landmarkerRef.current;
    if (video && lm && video.readyState >= 2) {
      // detectForVideo requires a strictly increasing timestamp (ms).
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;
      const res = lm.detectForVideo(video, ts);
      cb.current(res.landmarks[0] ?? null, ts);
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(async () => {
    if (status === "loading" || status === "running") return;
    setStatus("loading");
    setError(null);
    try {
      if (!landmarkerRef.current) {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) throw new Error("video element not mounted");
      video.srcObject = stream;
      await video.play();
      setStatus("running");
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [status, loop]);

  // Tear down on unmount: stop the loop, release the camera, free the model.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  return { videoRef, status, error, start };
}
