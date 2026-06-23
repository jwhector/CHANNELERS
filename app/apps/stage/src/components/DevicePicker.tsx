import { canRouteAudio, type DeviceKind } from "../lib/devices";

/** Compact output/camera selector for a screen header. value="" = system/default device. */
export function DevicePicker({
  kind,
  label,
  devices,
  value,
  onChange,
  needsPermission,
  onEnableLabels,
  warn,
}: {
  kind: DeviceKind;
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  needsPermission: boolean;
  onEnableLabels: () => void;
  warn?: boolean;
}) {
  const showWarn = warn ?? (kind === "audiooutput" && !canRouteAudio());
  const noun = kind === "audiooutput" ? "Output" : kind === "audioinput" ? "Mic" : "Camera";
  const defaultLabel =
    kind === "audiooutput" ? "System default" : kind === "audioinput" ? "Default mic" : "Default camera";
  return (
    <span className="device-picker">
      <label>
        {label}{" "}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{defaultLabel}</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${noun} ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {needsPermission && (
        <button type="button" className="link" onClick={onEnableLabels}>
          enable names
        </button>
      )}
      {showWarn && (
        <span
          className="device-warn"
          title="This browser can't route to a chosen output — using the system default"
        >
          ⚠ default only
        </span>
      )}
    </span>
  );
}
