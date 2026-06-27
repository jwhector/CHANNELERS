import { useEffect } from "react";
import { speak, stopSpeaking } from "../lib/speech";
import { useDevices } from "../lib/devices";
import { DEFAULT_PLAYBACK_RATE } from "../lib/playbackRate";
import { DevicePicker } from "./DevicePicker";
import { SpeedPicker } from "./SpeedPicker";
import { buildPluribusBroadcast } from "../lib/pluribus";

/**
 * Overseer control shared by /console and /dispatch: voices the Pluribus
 * "completed the stationing process" line for the given (altar-ready) visitor
 * numbers, routed to a chosen output. Disabled when the set is empty.
 * `storageKey` namespaces the per-tab output choice per screen.
 *
 * When `onChangeRate` is wired, a speed dial (the same SpeedPicker as /choreo and
 * /channel) lets the operator slow the broadcast to ritual pace; `rate` is threaded
 * into speak() so the TTS clip plays back at the chosen ×N. The parent owns the
 * persisted rate so it survives a refresh, matching the other screens.
 */
export function PluribusBroadcast({
  numbers,
  storageKey,
  rate,
  onChangeRate,
}: {
  numbers: number[];
  storageKey: string;
  rate?: number;
  onChangeRate?: (rate: number) => void;
}) {
  const out = useDevices("audiooutput", storageKey, "out");
  useEffect(() => () => stopSpeaking(), []);
  function go() {
    if (numbers.length === 0) return;
    void speak(buildPluribusBroadcast(numbers), { sinkId: out.deviceId, rate });
  }
  return (
    <div className="row">
      <button className="choice" disabled={numbers.length === 0} onClick={go}>
        ▶ PLURIBUS BROADCAST{numbers.length ? ` (${numbers.length})` : ""}
      </button>
      <span className="dim">
        {numbers.length ? `users ${numbers.join(", ")}` : "no altar-ready users yet"}
      </span>
      {onChangeRate && <SpeedPicker value={rate ?? DEFAULT_PLAYBACK_RATE} onChange={onChangeRate} />}
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
