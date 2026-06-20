import { useEffect, useState } from "react";
import {
  ARCHETYPES,
  type DispatchState,
  type SessionSummary,
  type ShowEvent,
  type VisitorProfile,
  type WsServerMsg,
} from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const dwell = (since?: string) =>
  since ? `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s` : "—";

/** Master overseer: visitor table + controls, flow funnel + station LEDs, sessions + event log (spec §11). */
export function Console() {
  const [visitors, setVisitors] = useState<VisitorProfile[]>([]);
  const [roster, setRoster] = useState<SessionSummary[]>([]);
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);
  const [events, setEvents] = useState<{ at: string; event: ShowEvent }[]>([]);
  const [, forceTick] = useState(0);

  async function refresh() {
    setVisitors(await api.listVisitors());
  }

  const { connected, send } = useBrainSocket((m: WsServerMsg) => {
    switch (m.kind) {
      case "roster":
        setRoster(m.sessions);
        break;
      case "dispatch.state":
        setDispatch(m.state);
        break;
      case "event":
        setEvents((e) => [{ at: new Date().toLocaleTimeString(), event: m.event }, ...e].slice(0, 50));
        if (m.event.type === "visitor.submitted" || m.event.type === "seeds.ready" || m.event.type === "oracle.selected") {
          void refresh();
        }
        break;
    }
  });

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { forceTick((n) => n + 1); void refresh(); }, 2000);
    return () => clearInterval(t);
  }, []);

  const archLabel = (id?: string) => (id ? ARCHETYPES.find((a) => a.id === id)?.label ?? id : "—");
  const milestone = (v: VisitorProfile) =>
    [
      v.intakeAt && "intake",
      v.poseAt && "pose",
      v.personaAt && "persona",
      v.poseVerifiedAt && "verified",
      v.sessionStartAt && !v.sessionEndAt && "channelling",
      v.sessionEndAt && "done",
    ].filter(Boolean).join(" · ") || "registered";

  // Panel 2 — flow funnel counts
  const counts = {
    registered: visitors.length,
    intake: visitors.filter((v) => v.intakeAt).length,
    pose: visitors.filter((v) => v.poseAt).length,
    oracleReady: visitors.filter((v) => v.personaAt && v.poseVerifiedAt && !v.sessionEndAt).length,
    channelling: roster.length,
    done: visitors.filter((v) => v.sessionEndAt).length,
  };

  return (
    <main className="void console master">
      <header>
        <h1>Console</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>

      {/* ── Panel 2: flow + stations ── */}
      <h3>Flow</h3>
      <ul className="funnel">
        {Object.entries(counts).map(([k, n]) => (
          <li key={k}><strong>{n}</strong> <span className="dim">{k}</span></li>
        ))}
      </ul>
      {dispatch && (
        <ul className="visitors">
          {(["intake", "bodyscan", "altar"] as const).map((s) => (
            <li key={s}>
              <div className="row">
                <strong>{s}</strong>
                <span className={dispatch.stations[s] ? "led on" : "led"} title={dispatch.stations[s] ? "online" : "offline"} />
                <span className="dim">{dispatch.slots[s].occupants.length}/{dispatch.slots[s].capacity}</span>
                <span className="dim">{dispatch.slots[s].occupants.map((o) => `#${o.number}(${o.state} ${dwell(o.since)})`).join("  ")}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Panel 1: visitors + controls ── */}
      <h3>Visitors ({visitors.length})</h3>
      <ul className="visitors">
        {visitors.map((v) => (
          <li key={v.id}>
            <div className="row">
              <strong>#{v.number}</strong>
              <span className="dim">{v.survey?.name || "(no name)"}</span>
              <span className="dim">{archLabel(v.archetype)}</span>
              <span className="dim">{milestone(v)}</span>
              <span className="dim">{v.location.state}{v.location.station ? `@${v.location.station}` : ""} · {dwell(v.location.since)}</span>
              {!v.poseVerifiedAt && <button className="choice" onClick={() => void api.verifyPose(v.id).then(refresh)}>unlock</button>}
              <select
                className="choice"
                value={v.archetype ?? ""}
                onChange={(e) => void api.setPersona(v.id, e.target.value).then(refresh)}
              >
                <option value="" disabled>set persona…</option>
                {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <button className="choice" onClick={() => void api.dispatch.repool(v.id).then(refresh)}>re-pool</button>
              <button className="end" onClick={() => void api.dispatch.remove(v.id).then(refresh)}>remove</button>
            </div>
          </li>
        ))}
      </ul>

      {/* ── Panel 3: sessions + events ── */}
      <h3>Active sessions ({roster.length})</h3>
      {roster.length === 0 && <p className="dim">None.</p>}
      <ul className="visitors">
        {roster.map((s) => (
          <li key={s.sessionId}>
            <div className="row">
              <strong>{s.visitorName || "(no name)"}</strong>
              <span className="dim">{archLabel(s.archetype)}</span>
              <span className="dim">{s.turns} {s.turns === 1 ? "turn" : "turns"}</span>
              <button className="choice" onClick={() => send({ kind: "session.rejoin", sessionId: s.sessionId })}>reclaim</button>
              <button className="end" onClick={() => send({ kind: "session.end", sessionId: s.sessionId })}>end</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Events</h3>
      <ul className="eventlog">
        {events.map((e, i) => (
          <li key={i} className="dim"><code>{e.at}</code> {e.event.type}</li>
        ))}
      </ul>
    </main>
  );
}
