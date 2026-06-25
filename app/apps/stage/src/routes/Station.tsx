import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DispatchState, Slot, Station as StationName, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";

/** Stations a performer admits arrivals for. Intake self-confirms; it is not here. */
const PERFORMER_STATIONS: StationName[] = ["bodyscan", "altar", "paper"];

/** Route entry: bare /station shows a picker; /station/:station opens that station's view. */
export function Station() {
  const { station } = useParams<{ station?: string }>();
  if (!station || !PERFORMER_STATIONS.includes(station as StationName)) return <StationPicker />;
  return <StationContainer station={station as StationName} />;
}

function StationPicker() {
  return (
    <main className="void">
      <h1>Station confirm</h1>
      <p className="dim">Open the station you are manning.</p>
      <nav className="stations">
        {PERFORMER_STATIONS.map((s) => (
          <Link key={s} to={`/station/${s}`} className="station">{s}</Link>
        ))}
      </nav>
    </main>
  );
}

/** Passive container: reads dispatch.state, POSTs arrive/repool. Sends NO station.hello. */
function StationContainer({ station }: { station: StationName }) {
  const [state, setState] = useState<DispatchState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { connected } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  async function run(visitorId: string, fn: () => Promise<unknown>) {
    setBusyId(visitorId);
    try { await fn(); } finally { setBusyId(null); }
  }

  const slots = (state?.slots ?? []).filter((s) => s.station === station);
  return (
    <StationOpsView
      station={station}
      connected={connected}
      called={slots.filter((s) => s.occupant?.phase === "called")}
      inProgress={slots.filter((s) => s.occupant?.phase === "in_progress")}
      dwellMs={state?.timedDwellMs?.[station]}
      busyId={busyId}
      onArrive={(id) => void run(id, () => api.arrive(id))}
      onRelease={(id) => void run(id, () => api.dispatch.repool(id))}
    />
  );
}

/** Presentational — admit list + in-progress status. */
export function StationOpsView({
  station, connected, called, inProgress, dwellMs, busyId, onArrive, onRelease,
}: {
  station: StationName;
  connected: boolean;
  called: Slot[];
  inProgress: Slot[];
  dwellMs?: number;
  busyId: string | null;
  onArrive: (visitorId: string) => void;
  onRelease: (visitorId: string) => void;
}) {
  return (
    <main className="void stationops">
      <header>
        <h1>Station · {station}</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>

      <section className="ops-group">
        <h2>Called — awaiting arrival</h2>
        {called.length === 0 && <p className="dim">No one is called to {station}.</p>}
        {called.map((s) => {
          const o = s.occupant!;
          const noShow = o.flags?.some((fl) => fl.type === "no-show");
          return (
            <div key={s.id} className={`ops-row${noShow ? " warn" : ""}`}>
              <span className="ops-num">#{o.number}</span>
              {noShow && <span className="ops-flag">no-show?</span>}
              <button className="submit" disabled={busyId === o.visitorId} onClick={() => onArrive(o.visitorId)}>
                Confirm arrival
              </button>
              <button className="ghost" disabled={busyId === o.visitorId} onClick={() => onRelease(o.visitorId)}>
                Release
              </button>
            </div>
          );
        })}
      </section>

      <section className="ops-group">
        <h2>In progress</h2>
        {inProgress.length === 0 && <p className="dim">No one in progress.</p>}
        {inProgress.map((s) => {
          const o = s.occupant!;
          return (
            <div key={s.id} className="ops-row">
              <span className="ops-num">#{o.number}</span>
              <span className="dim">{dwellMs ? "dwell running" : "in progress"}</span>
            </div>
          );
        })}
      </section>
    </main>
  );
}
