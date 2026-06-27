import { useEffect, useState } from "react";
import type { DispatchState, WsServerMsg } from "@channelers/shared";
import { STATION_LABEL } from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import "../styles/board.css";

type Tone = "now" | "at" | "wait" | "done";

/** One roster line: a visitor number and where they are. */
type Row = { id: string; number: number; loc: string; tone: Tone };

const pad3 = (n: number) => String(n).padStart(3, "0");

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

  const fromSlots: Row[] = (state?.slots ?? [])
    .filter((s) => s.occupant)
    .map((s) => {
      const o = s.occupant!;
      const loc = STATION_LABEL[s.station];
      return { id: o.visitorId, number: o.number, loc, tone: o.phase === "called" ? "now" : "at" };
    });

  const fromQueue: Row[] = (state?.queue ?? []).map((q) => ({
    id: q.id,
    number: q.number,
    loc: q.heldUntil ?? q.holdReason ? "ON HOLD" : "WAITING",
    tone: "wait",
  }));

  const fromDone: Row[] = (state?.completed ?? []).map((c) => ({
    id: c.id,
    number: c.number,
    loc: "DONE",
    tone: "done",
  }));

  const rows = [...fromSlots, ...fromQueue, ...fromDone].sort((a, b) => a.number - b.number);

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
