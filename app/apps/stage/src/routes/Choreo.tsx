import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_CHOREO_CONFIG, type ChoreoConfig, type WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import { speak, stopSpeaking } from "../lib/speech";
import { useDevices } from "../lib/devices";
import { usePlaybackRate, DEFAULT_PLAYBACK_RATE } from "../lib/playbackRate";
import { DevicePicker } from "../components/DevicePicker";
import { SpeedPicker } from "../components/SpeedPicker";
import { initialChoreoFeed, reduceChoreoFeed, type CueLine } from "../lib/choreoFeed";

/**
 * Pure presentational cue display — unit-testable without a socket.
 * (MVP: cues from concurrent sessions share one line; acceptable while the altar is one-at-a-time.)
 */
export function ChoreoDisplay({
  cue, log, reactToOracle, connected, onToggle, speakCues, onToggleSpeak, outputPicker,
  mimicking, mimicManual, onToggleMimic, cadenceEnabled, onToggleCadence, everyN, onChangeEveryN,
  rate, onChangeRate,
}: {
  cue: string;
  log: CueLine[];
  reactToOracle: boolean;
  connected: boolean;
  onToggle: (next: boolean) => void;
  speakCues: boolean;
  onToggleSpeak: (next: boolean) => void;
  outputPicker?: ReactNode;
  mimicking?: boolean;
  mimicManual?: boolean;
  onToggleMimic?: (next: boolean) => void;
  cadenceEnabled?: boolean;
  onToggleCadence?: (next: boolean) => void;
  everyN?: number;
  onChangeEveryN?: (next: number) => void;
  rate?: number;
  onChangeRate?: (next: number) => void;
}) {
  return (
    <main className="void choreo">
      <header className="choreo-head">
        <div className="head-title">
          <h1>Choreography</h1>
          <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        </div>
        <div className="head-controls">
          <label className="toggle">
            <input type="checkbox" checked={speakCues} onChange={(e) => onToggleSpeak(e.target.checked)} />{" "}
            speak cues
          </label>
          <label className="toggle">
            <input type="checkbox" checked={reactToOracle} onChange={(e) => onToggle(e.target.checked)} />{" "}
            react to oracle
          </label>
          {onToggleMimic && (
            <label className="toggle">
              <input type="checkbox" checked={!!mimicManual} onChange={(e) => onToggleMimic(e.target.checked)} />{" "}
              mimic oracle
            </label>
          )}
          {onToggleCadence && (
            <label className="toggle">
              <input type="checkbox" checked={!!cadenceEnabled} onChange={(e) => onToggleCadence(e.target.checked)} />{" "}
              cadence
            </label>
          )}
          {onChangeEveryN && (
            <span className="toggle period">
              every{" "}
              <input
                type="number"
                min={1}
                value={everyN ?? 3}
                className="turns-input"
                onChange={(e) => onChangeEveryN(Math.max(1, Number(e.target.value) || 1))}
              />{" "}
              turns
            </span>
          )}
          {onChangeRate && <SpeedPicker value={rate ?? DEFAULT_PLAYBACK_RATE} onChange={onChangeRate} />}
          {outputPicker}
        </div>
      </header>
      {mimicking && <div className="mimic-banner">▶ channelling — mimic the voice</div>}
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
  const [cfg, setCfg] = useState<ChoreoConfig>(DEFAULT_CHOREO_CONFIG);
  const [mimicking, setMimicking] = useState(false);
  const [speakCues, setSpeakCues] = useState(true);
  const feed = useRef(initialChoreoFeed);

  const out = useDevices("audiooutput", "out.choreo", "out");
  const outRef = useRef(out.deviceId);
  outRef.current = out.deviceId;
  const speakRef = useRef(speakCues);
  speakRef.current = speakCues;
  const { rate, setRate } = usePlaybackRate("rate.choreo");
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    const next = reduceChoreoFeed(feed.current, m);
    if (next === feed.current) return; // not a choreo.* message
    feed.current = next;
    setCue(next.cue);
    setLog(next.log);
    setMimicking(next.mimicking);
    // The focused session voices a cue (neutral) or a mimic line (persona voice via archetype);
    // speak() itself preempts any in-flight clip.
    if (next.speak && speakRef.current)
      void speak(next.speak.text, { sinkId: outRef.current, archetype: next.speak.archetype, rate: rateRef.current });
  });

  useEffect(() => {
    void api.choreo.config().then(setCfg);
    return () => stopSpeaking();
  }, []);

  function update(patch: Partial<ChoreoConfig>) {
    const nextCfg = { ...cfg, ...patch };
    setCfg(nextCfg);
    void api.choreo.setConfig(nextCfg);
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
      reactToOracle={cfg.reactToOracle}
      connected={connected}
      onToggle={(v) => update({ reactToOracle: v })}
      speakCues={speakCues}
      onToggleSpeak={toggleSpeak}
      outputPicker={picker}
      mimicking={mimicking}
      mimicManual={cfg.mimicManual}
      onToggleMimic={(v) => update({ mimicManual: v })}
      cadenceEnabled={cfg.mimicCadenceEnabled}
      onToggleCadence={(v) => update({ mimicCadenceEnabled: v })}
      everyN={cfg.mimicEveryNTurns}
      onChangeEveryN={(n) => update({ mimicEveryNTurns: n })}
      rate={rate}
      onChangeRate={setRate}
    />
  );
}
