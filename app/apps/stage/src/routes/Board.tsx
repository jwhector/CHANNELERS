import { useEffect, useState } from "react";
import type { DispatchState, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const STATION_LABEL: Record<string, string> = {
  intake: "INTAKE",
  bodyscan: "BODY SCAN",
  altar: "ALTAR",
};

/** Public lobby display — the called visitors, big. Updates live off dispatch.state. */
export function Board() {
  const [state, setState] = useState<DispatchState | null>(null);

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
  }, []);

  // Derive the call list from slots: a visitor in the `called` phase sits at its slot's station.
  const board = (state?.slots ?? [])
    .filter((s) => s.occupant?.phase === "called")
    .map((s) => ({ id: s.occupant!.visitorId, number: s.occupant!.number, station: s.station }));

  return (
    <main className="void board">
      <header>
        <h1>NOW SERVING</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>
      {board.length === 0 && <p className="dim">Please wait to be called.</p>}
      <ul className="board-calls">
        {board.map((c) => (
          <li key={c.id} className="board-call">
            <span className="board-number">#{c.number}</span>
            <span className="board-arrow">→</span>
            <span className="board-station">{STATION_LABEL[c.station] ?? c.station}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
