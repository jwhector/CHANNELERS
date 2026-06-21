import { useEffect, useState } from "react";
import type { DispatchState, Station, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

const STATIONS: Station[] = ["intake", "bodyscan", "altar"];
const dwell = (since: string) => `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s`;

/** Lobby-operator console: register arrivals, confirm calls, watch the queue + slots (spec §9). */
export function Dispatch() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [arrival, setArrival] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
    const t = setInterval(() => forceTick((n) => n + 1), 1000); // refresh dwell timers
    return () => clearInterval(t);
  }, []);

  async function registerArrival() {
    const n = Number(arrival);
    if (!Number.isInteger(n) || n <= 0) { setError("Enter a ticket number."); return; }
    setError(null);
    try { await api.register(n); setArrival(""); }
    catch (e) { setError(String(e)); }
  }

  if (!state) {
    return (
      <main className="void console">
        <header><h1>Dispatch</h1><span className={connected ? "led on" : "led"} /></header>
        <p className="dim">Connecting…</p>
      </main>
    );
  }

  return (
    <main className="void console dispatch">
      <header>
        <h1>Dispatch</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        {!state.warmedUp && <span className="dim">warming up…</span>}
      </header>

      <section className="field arrivals">
        <label>Register arrival (ticket #)</label>
        <input
          inputMode="numeric"
          value={arrival}
          placeholder="000"
          onChange={(e) => setArrival(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void registerArrival(); }}
        />
        <button className="submit" onClick={() => void registerArrival()} disabled={!arrival}>Add</button>
      </section>
      {error && <p className="error">{error}</p>}

      <h3>Pending — confirm to call ({state.pending.length})</h3>
      {state.pending.length === 0 && <p className="dim">Nothing to confirm.</p>}
      <ul className="visitors">
        {state.pending.map((p) => (
          <li key={p.id}>
            <div className="row">
              <strong>#{p.number}</strong>
              <span className="dim">→ {p.station}</span>
              <button className="submit" onClick={() => void api.dispatch.confirm(p.id)}>Confirm call</button>
              <button className="end" onClick={() => void api.dispatch.repool(p.id)}>Skip</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Called — on the board ({state.board.length})</h3>
      <ul className="visitors">
        {state.board.map((c) => (
          <li key={c.id}>
            <div className="row">
              <strong>#{c.number}</strong>
              <span className="dim">→ {c.station} · {dwell(c.since)}</span>
              {c.flags?.some((f) => f.type === "no-show") && <span className="error">NO-SHOW</span>}
              <button className="submit" onClick={() => void api.dispatch.recall(c.id)}>Re-call</button>
              <button className="end" onClick={() => void api.dispatch.repool(c.id)}>Re-pool</button>
            </div>
          </li>
        ))}
      </ul>

      <h3>Slots</h3>
      <ul className="visitors">
        {STATIONS.map((s) => {
          const slot = state.slots[s];
          return (
            <li key={s}>
              <div className="row">
                <strong>{s}</strong>
                <span className="dim">{slot.occupants.length}/{slot.capacity}</span>
                <span className={state.stations[s] ? "led on" : "led"} title={state.stations[s] ? "screen online" : "screen offline"} />
                <span className="dim">{slot.occupants.map((o) => `#${o.number}(${o.state})`).join("  ")}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <h3>Queue ({state.queue.length})</h3>
      {state.queue.length === 0 && <p className="dim">Pool empty.</p>}
      <ul className="visitors">
        {state.queue.map((v) => (
          <li key={v.id}>
            <div className="row">
              <strong>#{v.number}</strong>
              <span className="dim">{v.name || "(no name)"}</span>
              <span className="dim">eligible: {v.eligible.join(", ") || "—"} · {dwell(v.waitingSince)}</span>
              {v.flags.map((f, i) => (
                <span key={i} className="dim">[{f.type}{f.reason ? `:${f.reason}` : ""}]</span>
              ))}
              {v.eligible.map((s) => (
                <button key={s} className="choice" onClick={() => void api.dispatch.assign(v.id, s)}>
                  assign {s}
                </button>
              ))}
              <button className="end" onClick={() => void api.dispatch.remove(v.id)}>remove</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
