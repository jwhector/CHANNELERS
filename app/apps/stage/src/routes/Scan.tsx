import { useBrainSocket } from "../lib/useBrainSocket";

export function Scan() {
  const { connected } = useBrainSocket();
  return (
    <main className="void">
      <h1>Scanning Station</h1>
      <p className="dim">{connected ? "connected to the brain" : "offline"}</p>
      <p>Take the shape of your spirit animal for processing.</p>
      <p className="todo">
        TODO: MediaPipe Tasks for Web pose capture → match a shape template → POST
        <code> /api/visitors/:id/scan</code> with <code>kind: "pose"</code>.
        <br />
        TODO: ArUco / js-aruco2 reader for the "place the images in their correct place" station
        (<code>kind: "fiducial"</code>). See ARCHITECTURE.md §6.
      </p>
    </main>
  );
}
