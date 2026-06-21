import { useEffect } from "react";
import type { Station } from "@channelers/shared";
import { useBrainSocket } from "./useBrainSocket";

/**
 * Announce this screen's station role to the brain so the dispatcher can show an online LED
 * and bind socket-drop recovery to it (spec §10–§11). Re-announces on every (re)connect.
 */
export function useStationPresence(station: Station): { connected: boolean } {
  const { connected, send } = useBrainSocket();
  useEffect(() => {
    if (connected) send({ kind: "station.hello", station });
  }, [connected, send, station]);
  return { connected };
}
