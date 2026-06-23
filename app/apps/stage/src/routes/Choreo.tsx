import { useEffect, useRef, useState } from "react";
import type { WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

type CueLine = { sessionId: string; text: string };

/**
 * Pure presentational cue display — unit-testable without a socket.
 * (MVP: cues from concurrent sessions share one line; acceptable while the altar is one-at-a-time.)
 */
export function ChoreoDisplay({
  cue, log, reactToOracle, connected, onToggle,
}: {
  cue: string;
  log: CueLine[];
  reactToOracle: boolean;
  connected: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <main className="void choreo">
      <header>
        <h1>Choreography</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        <label className="toggle" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={reactToOracle} onChange={(e) => onToggle(e.target.checked)} />{" "}
          react to oracle reply
        </label>
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

/** The /choreo route: live movement-cue feed + the operator's reactToOracle timing toggle. */
export function Choreo() {
  const [cue, setCue] = useState("");
  const [log, setLog] = useState<CueLine[]>([]);
  const [reactToOracle, setReactToOracle] = useState(true);
  const live = useRef("");

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "choreo.delta") {
      live.current += m.text;
      setCue(live.current);
    } else if (m.kind === "choreo.done") {
      live.current = "";
      setCue(m.text);
      setLog((l) => [{ sessionId: m.sessionId, text: m.text }, ...l].slice(0, 30));
    }
  });

  useEffect(() => {
    void api.choreo.config().then((c) => setReactToOracle(c.reactToOracle));
  }, []);

  function toggle(next: boolean) {
    setReactToOracle(next);
    void api.choreo.setConfig(next);
  }

  return (
    <ChoreoDisplay cue={cue} log={log} reactToOracle={reactToOracle} connected={connected} onToggle={toggle} />
  );
}
