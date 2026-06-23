import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import { speak, stopSpeaking } from "../lib/speech";
import { useDevices } from "../lib/devices";
import { DevicePicker } from "../components/DevicePicker";

type CueLine = { sessionId: string; text: string };

/**
 * Pure presentational cue display — unit-testable without a socket.
 * (MVP: cues from concurrent sessions share one line; acceptable while the altar is one-at-a-time.)
 */
export function ChoreoDisplay({
  cue, log, reactToOracle, connected, onToggle, speakCues, onToggleSpeak, outputPicker,
}: {
  cue: string;
  log: CueLine[];
  reactToOracle: boolean;
  connected: boolean;
  onToggle: (next: boolean) => void;
  speakCues: boolean;
  onToggleSpeak: (next: boolean) => void;
  outputPicker?: ReactNode;
}) {
  return (
    <main className="void choreo">
      <header>
        <h1>Choreography</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        <label className="toggle" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={speakCues} onChange={(e) => onToggleSpeak(e.target.checked)} />{" "}
          speak cues
        </label>
        <label className="toggle">
          <input type="checkbox" checked={reactToOracle} onChange={(e) => onToggle(e.target.checked)} />{" "}
          react to oracle reply
        </label>
        {outputPicker}
      </header>
      <div className="teleprompter choreo-cue">{cue || "…"}</div>
      <ul className="transcript">
        {log.map((l, i) => (
          <li key={i} className="bubble oracle"><span>{l.text}</span></li>
        ))}
      </ul>
    </main>
  );
}

/** The /choreo route: live movement-cue feed, reactToOracle timing, and in-ear TTS (on by default). */
export function Choreo() {
  const [cue, setCue] = useState("");
  const [log, setLog] = useState<CueLine[]>([]);
  const [reactToOracle, setReactToOracle] = useState(true);
  const [speakCues, setSpeakCues] = useState(true);
  const live = useRef("");

  const out = useDevices("audiooutput", "out.choreo", "out");
  const outRef = useRef(out.deviceId);
  outRef.current = out.deviceId;
  const speakRef = useRef(speakCues);
  speakRef.current = speakCues;

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "choreo.delta") {
      live.current += m.text;
      setCue(live.current);
    } else if (m.kind === "choreo.done") {
      live.current = "";
      setCue(m.text);
      setLog((l) => [{ sessionId: m.sessionId, text: m.text }, ...l].slice(0, 30));
      if (speakRef.current) void speak(m.text, { sinkId: outRef.current }); // no archetype → neutral voice
    }
  });

  useEffect(() => {
    void api.choreo.config().then((c) => setReactToOracle(c.reactToOracle));
    return () => stopSpeaking();
  }, []);

  function toggle(next: boolean) {
    setReactToOracle(next);
    void api.choreo.setConfig(next);
  }
  function toggleSpeak(next: boolean) {
    setSpeakCues(next);
    if (!next) stopSpeaking();
  }

  const picker = (
    <DevicePicker
      kind="audiooutput"
      label="out"
      devices={out.devices}
      value={out.deviceId}
      onChange={out.setDeviceId}
      needsPermission={out.needsPermission}
      onEnableLabels={out.enableLabels}
    />
  );

  return (
    <ChoreoDisplay
      cue={cue}
      log={log}
      reactToOracle={reactToOracle}
      connected={connected}
      onToggle={toggle}
      speakCues={speakCues}
      onToggleSpeak={toggleSpeak}
      outputPicker={picker}
    />
  );
}
