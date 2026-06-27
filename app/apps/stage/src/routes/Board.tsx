import { useEffect, useState } from "react";
import type { DispatchState, WsServerMsg } from "@channelers/shared";
import { STATION_LABEL } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import "../styles/board.css";

type Tone = "now" | "at" | "wait" | "done";

/** One roster line: a visitor number and where they are. */
export type Row = { id: string; number: number; loc: string; tone: Tone };

const pad3 = (n: number) => String(n).padStart(3, "0");

/** Pure roster derivation — every visitor and where they are. A waiting visitor not at a station is
 *  lobby overflow ("WAITING", or "ON HOLD" while held); one who has cleared the pre-altar stations is
 *  "ALTAR READY" (#18), except held → "ON HOLD" wins. (The real held room shows its slot label
 *  STATION A - TIME OFFERING, not this overflow bucket.) */
export function boardRows(state: DispatchState | null): Row[] {
  const fromSlots: Row[] = (state?.slots ?? [])
    .filter((s) => s.occupant)
    .map((s) => {
      const o = s.occupant!;
      return { id: o.visitorId, number: o.number, loc: STATION_LABEL[s.station], tone: (o.phase === "called" ? "now" : "at") as Tone };
    });

  const inSlot = new Set(fromSlots.map((r) => r.id));
  const inQueue = new Set((state?.queue ?? []).map((q) => q.id));
  const altarReadyIds = new Set((state?.altarReadyList ?? []).map((v) => v.id));

  const fromQueue: Row[] = (state?.queue ?? []).map((q) => ({
    id: q.id,
    number: q.number,
    loc: (q.heldUntil ?? q.holdReason) ? "ON HOLD" : altarReadyIds.has(q.id) ? "ALTAR READY" : "WAITING",
    tone: "wait",
  }));

  // Altar-ready visitors who aren't otherwise placed (e.g. the altar is closed, so they're not
  // eligible for any open station) are still parked in the holding area, flagged "ALTAR READY". (#18, #24)
  const fromReady: Row[] = (state?.altarReadyList ?? [])
    .filter((v) => !inSlot.has(v.id) && !inQueue.has(v.id))
    .map((v) => ({ id: v.id, number: v.number, loc: "ALTAR READY", tone: "wait" as Tone }));

  const fromDone: Row[] = (state?.completed ?? []).map((c) => ({
    id: c.id, number: c.number, loc: "DONE", tone: "done",
  }));

  return [...fromSlots, ...fromQueue, ...fromReady, ...fromDone].sort((a, b) => a.number - b.number);
}

/** Public lobby roster — every visitor number and their current station, as one
 *  bare terminal. `called` = NOW SERVING (highlighted). Lives off dispatch.state. */
export function Board() {
  const [state, setState] = useState<DispatchState | null>(null);

  useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state);
  });

  useEffect(() => {
    void api.dispatch.state().then(setState).catch(() => {});
  }, []);

  const rows = boardRows(state);

  return (
    <main className="depboard">
      <div className="bd-term">
        {rows.length === 0 ? (
          <p className="bd-empty">awaiting records</p>
        ) : (
          <div className="bd-rows">
            {rows.map((r) => (
              <div key={r.id} className={`bd-row ${r.tone}`}>
                <span className="bd-num">{pad3(r.number)}</span>
                <span className="bd-loc">{r.loc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
