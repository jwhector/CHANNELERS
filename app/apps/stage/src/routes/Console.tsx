import { useEffect, useState } from "react";
import { ARCHETYPES, type SessionSummary, type VisitorProfile, type WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

/**
 * Passive stage-manager monitor.
 * Read-only: shows all active sessions and the waiting queue.
 * No controls — performers manage their own sessions via /station.
 */
export function Console() {
  const [visitors, setVisitors] = useState<VisitorProfile[]>([]);
  const [roster, setRoster] = useState<SessionSummary[]>([]);

  async function refresh() {
    setVisitors(await api.listVisitors());
  }

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    switch (m.kind) {
      case "roster":
        setRoster(m.sessions);
        break;
      case "event":
        if (m.event.type === "visitor.submitted" || m.event.type === "seeds.ready") {
          void refresh();
        }
        break;
    }
  });

  useEffect(() => {
    void refresh();
  }, []);

  const busyVisitorIds = new Set(roster.map((s) => s.visitorId));
  const waiting = visitors.filter((v) => !busyVisitorIds.has(v.id));

  const archetypeLabel = (id: string) =>
    ARCHETYPES.find((a) => a.id === id)?.label ?? id;

  return (
    <main className="void console">
      <header>
        <h1>Monitor</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>

      <h3>Active ({roster.length})</h3>
      {roster.length === 0 && <p className="dim">No sessions in progress.</p>}
      <ul className="visitors">
        {roster.map((s) => (
          <li key={s.sessionId}>
            <div className="row">
              <strong>{s.visitorName || "(no name)"}</strong>
              <span className="dim">{archetypeLabel(s.archetype)}</span>
              <span className="dim">{s.turns} {s.turns === 1 ? "turn" : "turns"}</span>
            </div>
          </li>
        ))}
      </ul>

      <h3>Waiting ({waiting.length})</h3>
      {waiting.length === 0 && <p className="dim">No visitors waiting.</p>}
      <ul className="visitors">
        {waiting.map((v) => (
          <li key={v.id}>
            <div className="row">
              <strong>{v.survey?.name || "(no name)"}</strong>
              <span className="dim">
                {v.archetype ? archetypeLabel(v.archetype) : "no oracle chosen"}
              </span>
              <code>{v.id.slice(0, 8)}</code>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
