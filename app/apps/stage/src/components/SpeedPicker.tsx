import { RATE_MAX, RATE_MIN, RATE_STEP } from "../lib/playbackRate";

/** Compact oracle-speed slider for a screen header. Lower = slower; 1.0× = the synth's own pace. */
export function SpeedPicker({
  value,
  onChange,
  label = "speed",
}: {
  value: number;
  onChange: (rate: number) => void;
  label?: string;
}) {
  return (
    <span className="speed-picker">
      <label>
        {label}{" "}
        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={RATE_STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
      <span className="speed-readout">{value.toFixed(2)}×</span>
    </span>
  );
}
