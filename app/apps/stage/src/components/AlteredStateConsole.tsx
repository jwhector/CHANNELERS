import {
  PRESETS,
  DEFAULT_TUNING,
  type OracleTuning,
  type OracleTone,
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

        <section>
          <h4>sampling {hot && <span className="as-warn">⚠ word-salad zone</span>}</h4>
          <Slider label="temperature" value={tuning.sampling.temperature} min={0} max={2} step={0.05} onChange={(v) => setSampling("temperature", v)} />
          <Slider label="top_p" value={tuning.sampling.top_p} min={0} max={1} step={0.01} onChange={(v) => setSampling("top_p", v)} />
          <Slider label="presence_penalty" value={tuning.sampling.presence_penalty} min={-2} max={2} step={0.05} onChange={(v) => setSampling("presence_penalty", v)} />
          <Slider label="frequency_penalty" value={tuning.sampling.frequency_penalty} min={-2} max={2} step={0.05} onChange={(v) => setSampling("frequency_penalty", v)} />
          <Slider label="max_tokens" value={tuning.sampling.max_completion_tokens} min={16} max={2000} step={10} fmt={(v) => String(v)} onChange={(v) => setSampling("max_completion_tokens", Math.round(v))} />
        </section>

        <section>
          <h4>
            effects
            <Toggle label="drive sampling" checked={tuning.effectsDriveSampling} onChange={(c) => onChange({ ...tuning, effectsDriveSampling: c })} />
          </h4>
          <Slider label="creativityBoost" value={tuning.effects.creativityBoost} min={0} max={5} step={0.05} onChange={(v) => setEffect("creativityBoost", v)} />
          <Slider label="cognitionFlexibility" value={tuning.effects.cognitionFlexibility} min={0} max={5} step={0.05} onChange={(v) => setEffect("cognitionFlexibility", v)} />
          <Slider label="memoryBlend" value={tuning.effects.memoryBlend} min={0} max={5} step={0.05} onChange={(v) => setEffect("memoryBlend", v)} />
          <Slider label="driftIntensity" value={tuning.effects.driftIntensity} min={0} max={5} step={0.05} onChange={(v) => setEffect("driftIntensity", v)} />
          <Slider label="hallucinationFactor" value={tuning.effects.hallucinationFactor} min={0} max={1} step={0.05} onChange={(v) => setEffect("hallucinationFactor", v)} />
          <Slider label="decenteringScore" value={tuning.effects.decenteringScore} min={0} max={5} step={0.05} onChange={(v) => setEffect("decenteringScore", v)} />
          <Toggle label="egoDissolution" checked={tuning.effects.egoDissolution} onChange={(c) => setEffect("egoDissolution", c)} />
        </section>

        <section>
          <h4>text pipeline</h4>
          <Toggle label="promptDrift (inject directive)" checked={tuning.pipeline.promptDrift} onChange={(c) => setPipeline({ promptDrift: c })} />
          <Toggle label="outputMangle (buffers — no streaming)" checked={tuning.pipeline.outputMangle} onChange={(c) => setPipeline({ outputMangle: c })} />
          <Toggle label="microDrift (asides)" checked={tuning.pipeline.microDrift} onChange={(c) => setPipeline({ microDrift: c })} />
          <label className="as-row">
            <span>tone</span>
            <select value={tuning.pipeline.tone} onChange={(e) => setPipeline({ tone: e.target.value as OracleTone })}>
              <option value="none">none</option>
              <option value="explorer_dreamy">explorer_dreamy</option>
            </select>
          </label>
          <Slider label="semanticDrift" value={tuning.pipeline.semanticDrift} min={0} max={1} step={0.05} onChange={(v) => setPipeline({ semanticDrift: v })} />
          <Slider label="hallucinationBudget" value={tuning.pipeline.hallucinationBudget} min={0} max={1} step={0.05} onChange={(v) => setPipeline({ hallucinationBudget: v })} />
        </section>

        <section>
          <h4>scope</h4>
          <Toggle label="apply to oracle" checked={tuning.scope.applyToOracle} onChange={(c) => setScope({ applyToOracle: c })} />
          <Toggle label="apply to seeds transform" checked={tuning.scope.applyToTransform} onChange={(c) => setScope({ applyToTransform: c })} />
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="as-row">
      <span className="as-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="as-val">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="as-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
