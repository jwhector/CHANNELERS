import { useEffect, useMemo, useState } from "react";
import type { Station, Slot, DispatchState, WsServerMsg } from "@channelers/shared";
import { useBrainSocket } from "./useBrainSocket";

/** Stable per-tab kiosk id: from ?kiosk=, else a sessionStorage UUID (one tab = one kiosk). */
function kioskId(): string {
  const url = new URLSearchParams(location.search).get("kiosk");
  if (url) return url;
  const KEY = "channelers.kioskId";          // per-tab via sessionStorage (a tab renders one station)
  let id = sessionStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(KEY, id); }
  return id;
}

/**
 * Announce this screen as a station kiosk and track its bound slot.
 * Sends station.hello { station, kioskId, slotHint? } on every (re)connect (spec §4),
 * and returns the slot this kiosk is bound to (from dispatch.state), or undefined.
 * Also surfaces the full dispatch.state so an operator station (e.g. /altar) can read
 * altarOpen / altarReadyList without opening a second socket.
 */
export function useStationPresence(station: Station): {
  connected: boolean;
  slot: Slot | undefined;
  state: DispatchState | undefined;
} {
  const id = useMemo(kioskId, []);
  const slotHint = useMemo(() => new URLSearchParams(location.search).get("slot") ?? undefined, []);
  const [state, setState] = useState<DispatchState>();

  const { connected, send } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setState(m.state as DispatchState);
  });

  useEffect(() => {
    if (connected) send({ kind: "station.hello", station, kioskId: id, slotHint });
  }, [connected, send, station, id, slotHint]);

  const slot = state?.slots.find((s) => s.kioskId === id && s.station === station);
  return { connected, slot, state };
}
