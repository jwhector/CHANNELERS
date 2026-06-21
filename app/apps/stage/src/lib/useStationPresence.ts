import { useEffect, useMemo, useState } from "react";
import type { Station, Slot, DispatchState, WsServerMsg } from "@channelers/shared";
import { useBrainSocket } from "./useBrainSocket";

/** Stable per-screen kiosk id: from ?kiosk=, else a localStorage UUID. */
function kioskId(): string {
  const url = new URLSearchParams(location.search).get("kiosk");
  if (url) return url;
  const KEY = "channelers.kioskId";
  let id = localStorage.getItem(KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
  return id;
}

/**
 * Announce this screen as a station kiosk and track its bound slot.
 * Sends station.hello { station, kioskId, slotHint? } on every (re)connect (spec §4),
 * and returns the slot this kiosk is bound to (from dispatch.state), or undefined.
 */
export function useStationPresence(station: Station): { connected: boolean; slot: Slot | undefined } {
  const id = useMemo(kioskId, []);
  const slotHint = useMemo(() => new URLSearchParams(location.search).get("slot") ?? undefined, []);
  const [slots, setSlots] = useState<Slot[]>([]);

  const { connected, send } = useBrainSocket((m: WsServerMsg) => {
    if (m.kind === "dispatch.state") setSlots((m.state as DispatchState).slots);
  });

  useEffect(() => {
    if (connected) send({ kind: "station.hello", station, kioskId: id, slotHint });
  }, [connected, send, station, id, slotHint]);

  const slot = slots.find((s) => s.kioskId === id);
  return { connected, slot };
}
