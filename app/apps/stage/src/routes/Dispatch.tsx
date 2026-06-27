import { useEffect, useState } from "react";
import type { DispatchState, Slot, WsServerMsg } from "@channelers/shared";
import { STATION_LABEL } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import { useNow } from "../lib/useNow";
import { remainingSec, fmtClock } from "../lib/dispatchTiming";

const elapsed = (since: string) =>
  `${Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000))}s`;

const BLOCKED_MSG: Record<"none" | "soaking" | "held" | "empty", string> = {
  none: "",
  soaking: "candidates soaking",
  held: "candidates on hold",
  empty: "no one needs a scan",
};

/** Operator flow strip: altar-ready buffer + bodyscan idle/blocked health. (The altar
 * gate toggle and the Pluribus broadcast moved to the `/console` overseer.) */
export function FlowStrip({
  altarReady, bodyscanIdle, bodyscanBlocked,
}: {
  altarReady: number;
  bodyscanIdle: boolean;
  bodyscanBlocked: "none" | "soaking" | "held" | "empty";
}) {
  const warn = bodyscanIdle && bodyscanBlocked !== "none";
  return (
    <div className="flow-strip">
      <span className="flow-stat">altar-ready {altarReady}</span>
      <span className={`flow-stat${warn ? " warn" : ""}`}>
        bodyscan {bodyscanIdle ? "idle" : "busy"}
        {warn ? ` · ${BLOCKED_MSG[bodyscanBlocked]}` : ""}
      </span>
    </div>
  );
}

/** Lobby-operator board (spec §6): waiting pool · slots · altar-ready. No-scroll 3-zone. */
export function Dispatch() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [arrival, setArrival] = useState("");
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
  }, []);

  async function register() {
    const n = Number(arrival);
    if (!Number.isInteger(n) || n <= 0) { setError("Enter a ticket number."); return; }
    setError(null);
    try { await api.register(n); setArrival(""); }
    catch (e) { setError(String(e)); }
  }

  if (!state) {
    return <main className="void board"><header><h1>Dispatch</h1><span className={connected ? "led on" : "led"} /></header><p className="dim">Connecting…</p></main>;
  }

  const pendingBySlot = (s: Slot) => s.occupant?.phase === "pending" ? s.occupant : undefined;

  return (
    <main className="void board board-3zone">
      <header>
        <h1>Dispatch</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        <span className="arrivals">
          <input
            inputMode="numeric" value={arrival} placeholder="add #"
            onChange={(e) => setArrival(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") void register(); }}
          />
          <button className="submit" disabled={!arrival} onClick={() => void register()}>Add</button>
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      {state.surplus.length > 0 && (
        <p className="error">Surplus screens: {state.surplus.map((s) => `${s.station}/${s.kioskId.slice(0, 6)}`).join(", ")}</p>
      )}
      <FlowStrip
        altarReady={state.altarReady}
        bodyscanIdle={state.bodyscanIdle}
        bodyscanBlocked={state.bodyscanBlocked}
      />

      <div className="zones">
        {/* LEFT — waiting pool */}
        <section className="zone pool">
          <h3>Waiting ({state.queue.length})</h3>
          <ul className="pool-list">
            {state.queue.map((v) => (
              <li key={v.id} className="pool-item">
                <div className="pool-item-top">
                  <strong>#{v.number}</strong>
                  <span className="dim">{elapsed(v.waitingSince)}</span>
                </div>
                <div className="pool-item-name">{v.name || "(no name)"}</div>
                <div className="pool-item-meta">
                  {v.eligible.map((s) => <span key={s} className="pool-chip">{s}</span>)}
                  {v.flags.length > 0 && <span className="pool-flag">{v.flags.map((f) => f.type).join(" ")}</span>}
                  {v.heldUntil && (() => {
                    const sec = remainingSec(Date.parse(v.heldUntil), now);
                    return sec > 0 ? <span className="pool-flag hold">on hold · {v.holdReason} {fmtClock(sec)}</span> : null;
                  })()}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* CENTER — slots */}
        <section className="zone slots">
          <h3>Stations</h3>
          <div className="slot-grid">
            {state.slots.map((s) => {
              const pend = pendingBySlot(s);
              return (
                <div key={s.id} className="slot-wrap">
                  <div className={`slot-box ${s.online ? "on" : "off"} ${s.occupant ? s.occupant.phase : ""}`}>
                    <div className="slot-head">
                      <span className={s.online ? "led on" : "led"} />
                      <code title={s.id}>{STATION_LABEL[s.station]}</code>
                    </div>
                    <div className="slot-body">
                      {pend ? (
                        <>
                          <div className="slot-number">#{pend.number}</div>
                          <div className="slot-actions">
                            <button className="submit" onClick={() => void api.dispatch.confirm(pend.visitorId)}>Confirm call</button>
                            <button className="end" title="skip" onClick={() => void api.dispatch.repool(pend.visitorId)}>×</button>
                          </div>
                        </>
                      ) : s.occupant && s.occupant.phase !== "pending" ? (
                        <>
                          <div className="slot-number">#{s.occupant.number}</div>
                          <div className="dim">
                            {s.occupant.phase} · {elapsed(s.occupant.since)}
                            {(() => {
                              const dwell = state.timedDwellMs?.[s.station];
                              if (dwell === undefined) return null;
                              const rem = Math.max(0, Math.ceil((dwell - (Date.now() - Date.parse(s.occupant!.since))) / 1000));
                              return <> · <span className="slot-remaining">{rem}s left</span></>;
                            })()}
                          </div>
                          <div className="slot-actions">
                            <button className="end" onClick={() => void api.dispatch.repool(s.occupant!.visitorId)}>re-pool</button>
                          </div>
                        </>
                      ) : (
                        <div className="dim">{s.online ? "idle" : "offline"}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT — altar-ready */}
        <section className="zone ready">
          <h3>Altar-ready ({state.altarReadyList.length})</h3>
          <ul className="pool-list">
            {state.altarReadyList.map((v) => (
              <li key={v.id} className="pool-item" title={v.name || "(no name)"}>
                <strong>#{v.number}</strong>
                <span className="dim">ready</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
