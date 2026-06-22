import { useEffect, useState } from "react";
import type { Slot, Station, VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { SegmentNumber } from "./SegmentNumber";

/**
 * Confirm-at-station gate (spec §5). Presentational: presence tracking lives at the
 * parent route so the socket outlives this gate's unmount on arrival.
 */
export function CalledGate({
  station,
  title,
  connected,
  slot,
  onArrived,
  skin = "default",
}: {
  station: Station;
  title: string;
  connected: boolean;
  slot: Slot | undefined;
  onArrived: (visitor: VisitorProfile) => void;
  /** "crt" renders shell-less CRT content meant to live inside Intake's <CrtShell>. */
  skin?: "crt" | "default";
}) {
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

  if (skin === "crt") {
    return (
      <>
        {!slot && (
          <p className="crt-dim">
            no slot bound — open with <code>?kiosk=&lt;id&gt;</code>
          </p>
        )}
        {slot && (!occ || occ.phase === "pending") && (
          <div className="crt-standby">
            <p className="crt-eyebrow">▮ standby</p>
            <SegmentNumber value={0} className="seg-dim" />
            <p className="crt-sub">awaiting designation</p>
          </div>
        )}
        {occ && occ.phase !== "in_progress" && occ.phase !== "pending" && (
          <div className="crt-called">
            <div className="crt-readout">
              <p className="crt-eyebrow">now serving</p>
              <SegmentNumber value={occ.number} glitch/>
            </div>
            <div className="crt-confirm">
              <button className="crt-iam" disabled={busy} onClick={() => void confirmArrival()}>
                {busy ? "…" : "I AM"}
              </button>
              <p className="crt-sub">confirm to proceed</p>
            </div>
          </div>
        )}
        {error && <p className="crt-err">SIGNAL LOST — {error}</p>}
      </>
    );
  }

  return (
    <main className="void calledgate">
      <header>
        <h1>{title}</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
      </header>
      {!slot && <p className="dim">No slot bound — open this screen with <code>?kiosk=&lt;id&gt;</code> or wait for a free {station} slot.</p>}
      {slot && !occ && <p className="dim">Slot {slot.id} ready. Waiting to be called…</p>}
      {occ && occ.phase !== "in_progress" && occ.phase !=="pending" && (
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
