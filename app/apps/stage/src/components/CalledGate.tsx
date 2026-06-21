import { useEffect, useState } from "react";
import type { Station, VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { useStationPresence } from "../lib/useStationPresence";

/**
 * Confirm-at-station gate (spec §5). Replaces typing a number. Watches this screen's bound
 * slot; when a visitor is `called` there, shows the number + Confirm arrival. On confirm it
 * marks the visitor in_progress, loads their record, and hands it up to render the station work.
 */
export function CalledGate({
  station,
  title,
  onArrived,
}: {
  station: Station;
  title: string;
  onArrived: (visitor: VisitorProfile) => void;
}) {
  const { connected, slot } = useStationPresence(station);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occ = slot?.occupant;

  // Auto-advance once arrival is confirmed for THIS slot's occupant.
  useEffect(() => {
    if (occ?.phase !== "in_progress") return;
    let cancelled = false;
    void api.getByNumber(occ.number).then((v) => { if (!cancelled) onArrived(v); }).catch((e) => setError(String(e)));
    return () => { cancelled = true; };
  }, [occ?.phase, occ?.number, onArrived]);

  async function confirmArrival() {
    if (!occ) return;
    setBusy(true); setError(null);
    try { await api.arrive(occ.visitorId); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <main className="void calledgate">
      <header>
        <h1>{title}</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>
      {!slot && <p className="dim">No slot bound — open this screen with <code>?kiosk=&lt;id&gt;</code> or wait for a free {station} slot.</p>}
      {slot && !occ && <p className="dim">Slot {slot.id} ready. Waiting to be called…</p>}
      {occ && occ.phase !== "in_progress" && (
        <section className="called">
          <p className="dim">Now calling</p>
          <div className="called-number">#{occ.number}</div>
          <button className="submit" disabled={busy} onClick={() => void confirmArrival()}>
            {busy ? "…" : "Confirm arrival"}
          </button>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
