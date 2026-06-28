import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DispatchState, Slot, Station as StationName, WsServerMsg } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import { useNow } from "../lib/useNow";
import { remainingSec, fmtClock, noShowDeadline } from "../lib/dispatchTiming";

/**
 * Stations a performer admits arrivals for from this screen. Intake self-confirms;
 * altar admits on its own /altar surface (operator-confirmed there) — neither is here.
 */
const PERFORMER_STATIONS: StationName[] = ["bodyscan", "paper", "offering"];

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

  const now = useNow();
  const slots = (state?.slots ?? []).filter((s) => s.station === station);
  return (
    <StationOpsView
      station={station}
      connected={connected}
      called={slots.filter((s) => s.occupant?.phase === "called")}
      inProgress={slots.filter((s) => s.occupant?.phase === "in_progress")}
      dwellMs={state?.timedDwellMs?.[station]}
      noShowMs={state?.noShowMs}
      now={now}
      busyId={busyId}
      onArrive={(id) => void run(id, () => api.arrive(id))}
      onRelease={(id) => void run(id, () => api.dispatch.repool(id))}
      // Manual checkout (Done): paper (always — its only exit), any timed station (early-complete),
      // and bodyscan as a fallback to approve a visitor when the kiosk pose-capture won't cooperate
      // (markComplete stamps poseAt — the same milestone enrollPose sets — and frees the slot).
      onComplete={
        station === "paper" || station === "bodyscan" || state?.timedDwellMs?.[station] !== undefined
          ? (id) => void run(id, () => api.dispatch.complete(id))
          : undefined
      }
      onCapture={station === "bodyscan" ? (id) => void run(id, () => api.captureBodyscan(id)) : undefined}
      cameraSlots={station === "bodyscan" ? slots.filter((s) => s.online && s.cameras && s.cameras.length > 0) : undefined}
      onSetCamera={station === "bodyscan" ? (kioskId, deviceId) => void api.setBodyscanCamera(kioskId, deviceId) : undefined}
    />
  );
}

/** Presentational — admit list + in-progress status. */
export function StationOpsView({
  station, connected, called, inProgress, dwellMs, noShowMs, now, busyId, onArrive, onRelease, onComplete, onCapture, cameraSlots, onSetCamera,
}: {
  station: StationName;
  connected: boolean;
  called: Slot[];
  inProgress: Slot[];
  dwellMs?: number;
  noShowMs?: number;
  now?: number;
  busyId: string | null;
  onArrive: (visitorId: string) => void;
  onRelease: (visitorId: string) => void;
  onComplete?: (visitorId: string) => void;
  /** Provided only for bodyscan: relay a manual pose-capture to the kiosk. */
  onCapture?: (visitorId: string) => void;
  /** Online bodyscan slots that reported cameras, for the remote camera picker. */
  cameraSlots?: Slot[];
  /** Provided only for bodyscan: switch a kiosk's camera remotely. */
  onSetCamera?: (kioskId: string, deviceId: string) => void;
}) {
  const nowMs = now ?? Date.now();
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
              {noShowMs !== undefined && (
                <span className="dim">no-show in {fmtClock(remainingSec(noShowDeadline(o.since, noShowMs), nowMs))}</span>
              )}
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
              {onCapture && (
                <button className="submit" disabled={busyId === o.visitorId}
                  onClick={() => onCapture(o.visitorId)}>
                  Capture pose
                </button>
              )}
              {onComplete && (
                <>
                  <button className="submit" disabled={busyId === o.visitorId}
                    onClick={() => onComplete(o.visitorId)}>
                    Done
                  </button>
                  <button className="ghost" disabled={busyId === o.visitorId}
                    onClick={() => onRelease(o.visitorId)}>
                    Release
                  </button>
                </>
              )}
            </div>
          );
        })}
      </section>

      {onSetCamera && cameraSlots && cameraSlots.length > 0 && (
        <section className="ops-group">
          <h2>Camera</h2>
          {cameraSlots.map((s) => (
            <div key={s.id} className="ops-row">
              <span className="dim">{s.id}</span>
              <select
                value={s.activeCameraId ?? ""}
                onChange={(e) => s.kioskId && onSetCamera(s.kioskId, e.target.value)}
              >
                {s.cameras?.map((c) => (
                  <option key={c.id} value={c.id}>{c.label || `Camera ${c.id.slice(0, 6)}`}</option>
                ))}
              </select>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
