import { useEffect } from "react";
import { speak, stopSpeaking } from "../lib/speech";
import { useDevices } from "../lib/devices";
import { DevicePicker } from "./DevicePicker";
import { buildPluribusBroadcast } from "../lib/pluribus";

/**
 * Overseer control shared by /console and /dispatch: voices the Pluribus
 * "completed the stationing process" line for the given (altar-ready) visitor
 * numbers, routed to a chosen output. Disabled when the set is empty.
 * `storageKey` namespaces the per-tab output choice per screen.
 */
export function PluribusBroadcast({
  numbers,
  storageKey,
}: {
  numbers: number[];
  storageKey: string;
}) {
  const out = useDevices("audiooutput", storageKey, "out");
  useEffect(() => () => stopSpeaking(), []);
  function go() {
    if (numbers.length === 0) return;
    void speak(buildPluribusBroadcast(numbers), { sinkId: out.deviceId });
  }
  return (
    <div className="row">
      <button className="choice" disabled={numbers.length === 0} onClick={go}>
        ▶ PLURIBUS BROADCAST{numbers.length ? ` (${numbers.length})` : ""}
      </button>
      <span className="dim">
        {numbers.length ? `users ${numbers.join(", ")}` : "no altar-ready users yet"}
      </span>
      <DevicePicker
        kind="audiooutput"
        label="out"
        devices={out.devices}
        value={out.deviceId}
        onChange={out.setDeviceId}
        needsPermission={out.needsPermission}
        onEnableLabels={out.enableLabels}
      />
    </div>
  );
}
