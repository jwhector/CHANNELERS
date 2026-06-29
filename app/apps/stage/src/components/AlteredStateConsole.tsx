import {
  PRESETS,
  DEFAULT_TUNING,
  type OracleTuning,
} from "@channelers/shared";

/**
 * Operator-facing generation control panel for `/channel` (no audience sees it). Exposes every
 * lever of the Altered-State tuning derived from the PHARMAICY module: presets, raw sampling,
 * the effects vocabulary, the theatrical text pipeline, and scope. Presentational — the parent
 * owns the tuning state and pushes `tuning.set` over the bus.
 */
export function AlteredStateConsole({
  tuning,
  onChange,
  connected,
}: {
  tuning: OracleTuning;
  onChange: (next: OracleTuning) => void;
  connected: boolean;
}) {
  // Editing a concrete value detaches from the named preset.
  const setSampling = (k: keyof OracleTuning["sampling"], v: number) =>
    onChange({ ...tuning, intensity: "custom", sampling: { ...tuning.sampling, [k]: v } });
  const setEffect = (k: keyof OracleTuning["effects"], v: number | boolean) =>
    onChange({ ...tuning, intensity: "custom", effects: { ...tuning.effects, [k]: v } });
  const setPipeline = (patch: Partial<OracleTuning["pipeline"]>) =>
    onChange({ ...tuning, pipeline: { ...tuning.pipeline, ...patch } });
  const setScope = (patch: Partial<OracleTuning["scope"]>) =>
    onChange({ ...tuning, scope: { ...tuning.scope, ...patch } });

  const applyPreset = (name: keyof typeof PRESETS) => {
    const p = PRESETS[name];
    onChange({
      ...tuning,
      intensity: name,
      sampling: { ...p.sampling },
      effects: { ...p.effects },
      pipeline: { ...tuning.pipeline, semanticDrift: p.semanticDrift, hallucinationBudget: p.hallucinationBudget },
    });
  };
  const reset = () => onChange(structuredClone(DEFAULT_TUNING));

  const presetNames = Object.keys(PRESETS) as (keyof typeof PRESETS)[];
  const hot = tuning.sampling.temperature > 1.3; // non-blocking "word-salad" marker

  return (
    <details className="altered-state" open={false}>
      <summary>
        ALTERED STATE
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        <span className="as-badge">{tuning.intensity}</span>
        {!tuning.scope.applyToOracle && <span className="as-badge muted">oracle off</span>}
      </summary>

      <div className="as-body">
        <div className="as-presets">
          {presetNames.map((n) => (
            <button
              key={n}
              className={`as-preset ${tuning.intensity === n ? "on" : ""}`}
              onClick={() => applyPreset(n)}
            >
              {n}
            </button>
          ))}
          <button className="as-preset reset" onClick={reset}>
            reset
          </button>
        </div>
        <p className="as-hint as-presets-hint">quick intensity jumps — move temperature &amp; sampling together. light = safest, surreal = most unhinged. reset = back to baseline.</p>

        <section>
          <h4>sampling {hot && <span className="as-warn">⚠ word-salad zone</span>}</h4>
          <Slider label="temperature" hint="wildness of word choice. ↑ more surprising & erratic (risk of word-salad past ~1.3); ↓ safer, more predictable." value={tuning.sampling.temperature} min={0} max={2} step={0.05} onChange={(v) => setSampling("temperature", v)} />
          <Slider label="top_p" hint="how much of the vocabulary it draws from. ↓ tightens to the likeliest words; leave at 1.00 unless reining in chaos." value={tuning.sampling.top_p} min={0} max={1} step={0.01} onChange={(v) => setSampling("top_p", v)} />
          <Slider label="presence_penalty" hint="↓ (negative) lets it fixate, loop & repeat — can feel incantatory; ↑ pushes it to keep changing subject." value={tuning.sampling.presence_penalty} min={-2} max={2} step={0.05} onChange={(v) => setSampling("presence_penalty", v)} />
          <Slider label="frequency_penalty" hint="↑ discourages reusing the same words (fewer verbal tics); ↓ allows repetition." value={tuning.sampling.frequency_penalty} min={-2} max={2} step={0.05} onChange={(v) => setSampling("frequency_penalty", v)} />
          <Slider label="max_tokens" hint="hard length cap (~¾ word per token). lower = curt & clipped; higher = room to ramble. 300 ≈ 220 words." value={tuning.sampling.max_completion_tokens} min={16} max={2000} step={10} fmt={(v) => String(v)} onChange={(v) => setSampling("max_completion_tokens", Math.round(v))} />
        </section>

        <section>
          <h4>altered perception</h4>
          <Toggle label="promptDrift" hint="asks the model itself to loosen — fragmented, sensory, dream-logic. the tasteful 'weird' switch; off = plain voice." checked={tuning.pipeline.promptDrift} onChange={(c) => setPipeline({ promptDrift: c })} />
          <Slider label="semanticDrift" hint="how far promptDrift pushes — ↑ looser, more blurred associations. (only bites when promptDrift is on)" value={tuning.pipeline.semanticDrift} min={0} max={1} step={0.05} onChange={(v) => setPipeline({ semanticDrift: v })} />
          <Slider label="hallucinationFactor" hint="lets it speak small impossible images as if true — ↑ more untethered & visionary. (only bites when promptDrift is on)" value={tuning.effects.hallucinationFactor} min={0} max={1} step={0.05} onChange={(v) => setEffect("hallucinationFactor", v)} />
        </section>

        <section>
          <h4>scope</h4>
          <Toggle label="apply to oracle" hint="master switch. off = the oracle ignores this whole panel and runs at safe defaults." checked={tuning.scope.applyToOracle} onChange={(c) => setScope({ applyToOracle: c })} />
        </section>
      </div>
    </details>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
  hint?: string;
}) {
  return (
    <div className="as-field">
      <label className="as-row">
        <span className="as-label">{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="as-val">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </label>
      {hint && <p className="as-hint">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (c: boolean) => void; hint?: string }) {
  return (
    <div className="as-field">
      <label className="as-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <p className="as-hint">{hint}</p>}
    </div>
  );
}
