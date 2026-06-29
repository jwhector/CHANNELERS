import { useState } from "react";
import { SURVEY, type SurveyResponse, type VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { CalledGate } from "../components/CalledGate";
import { CrtShell } from "../components/CrtShell";
import { SegmentNumber } from "../components/SegmentNumber";
import { useStationPresence } from "../lib/useStationPresence";
import { useReleaseToGate } from "../lib/useReleaseToGate";

export function Intake() {
  const { connected, slot } = useStationPresence("intake");
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  // Every answer lives here keyed by field id (single = chosen option, scale = the number).
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  // Multi-select selections (built-in options only) — joined into freeText on submit.
  const [multi, setMulti] = useState<Record<string, string[]>>({});
  // "Other" free-text + whether it's the active choice, per field that allows it.
  const [otherOn, setOtherOn] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetKiosk() {
    setVisitor(null);
    setFreeText({});
    setMulti({});
    setOtherOn({});
    setOtherText({});
    setDone(false);
    setError(null);
  }

  useReleaseToGate(visitor, slot, done, resetKiosk);

  const status = connected ? "" : "";

  if (!visitor) {
    return (
      <CrtShell statusLabel={status}>
        <CalledGate station="intake" title="Intake" connected={connected} slot={slot} skin="crt" onArrived={setVisitor} />
      </CrtShell>
    );
  }

  async function submit() {
    if (!visitor) return;
    setError(null);
    // Collapse every field into the freeText map: multi → joined options (+ Other),
    // single with Other active → the typed text. The visitor has no name field, so we
    // use their ticket number as the name (keeps the rest of the app's name plumbing intact).
    const answers: Record<string, string> = { ...freeText };
    for (const f of SURVEY) {
      if (f.kind === "multi") {
        const picked = [...(multi[f.id] ?? [])];
        if (f.allowOther && otherOn[f.id] && otherText[f.id]?.trim()) picked.push(otherText[f.id].trim());
        answers[f.id] = picked.join(", ");
      } else if (f.kind === "single" && f.allowOther && otherOn[f.id]) {
        answers[f.id] = otherText[f.id]?.trim() ?? "";
      }
    }
    const survey: SurveyResponse = {
      name: String(visitor.number),
      freeText: answers,
      phrases: [],
    };
    try {
      setDone(true);
      setTimeout(resetKiosk, 5000);
      await api.submitIntake(visitor.id, survey);
    } catch (e) {
      setError(String(e));
    }
  }

  if (done) {
    return (
      <CrtShell statusLabel={status}>
        <ExitScreen />
      </CrtShell>
    );
  }

  const setText = (id: string, v: string) => setFreeText((s) => ({ ...s, [id]: v }));
  const setOther = (id: string, v: string) => setOtherText((s) => ({ ...s, [id]: v }));
  const toggleMulti = (id: string, opt: string, max?: number) =>
    setMulti((s) => {
      const cur = s[id] ?? [];
      if (cur.includes(opt)) return { ...s, [id]: cur.filter((o) => o !== opt) };
      if (max != null && cur.length >= max) return s; // at the cap — ignore new picks
      return { ...s, [id]: [...cur, opt] };
    });

  return (
    <CrtShell statusLabel={status}>
      <div className="win">
        <div className="win-title">
          <span>INTAKE.EXE — FORM 7-A</span>
          <span className="win-controls" aria-hidden>_ □ ✕</span>
        </div>
        <div className="win-body">
          <p className="win-subject">
            no. <SegmentNumber value={visitor.number} className="seg-inline" />
          </p>
          {SURVEY.map((f) => {
            if (f.kind === "scale") {
              const value = freeText[f.id] ?? "";
              return (
                <div key={f.id} className="win-field-row">
                  <label>{f.label}</label>
                  <div className="win-scale">
                    <span className="win-scale-anchor">{f.minLabel}</span>
                    <div className="win-chips">
                      {Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={value === String(n) ? "win-chip on" : "win-chip"}
                          onClick={() => setText(f.id, String(n))}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <span className="win-scale-anchor">{f.maxLabel}</span>
                  </div>
                </div>
              );
            }

            if (f.kind === "single" || f.kind === "multi") {
              const max = f.kind === "multi" ? f.max : undefined;
              const selected = f.kind === "multi" ? multi[f.id] ?? [] : [];
              const atMax = max != null && selected.length >= max;
              const isOn = (opt: string) =>
                f.kind === "multi"
                  ? selected.includes(opt)
                  : !otherOn[f.id] && freeText[f.id] === opt;
              const pick = (opt: string) => {
                if (f.kind === "multi") return toggleMulti(f.id, opt, max);
                setOtherOn((s) => ({ ...s, [f.id]: false }));
                setText(f.id, opt);
              };
              return (
                <div key={f.id} className="win-field-row">
                  <label>
                    {f.label}
                    {max != null && <span className="win-count"> ({selected.length}/{max})</span>}
                  </label>
                  <div className="win-chips">
                    {f.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={isOn(opt) ? "win-chip on" : "win-chip"}
                        disabled={atMax && !isOn(opt)}
                        onClick={() => pick(opt)}
                      >
                        {opt}
                      </button>
                    ))}
                    {f.allowOther && (
                      <button
                        type="button"
                        className={otherOn[f.id] ? "win-chip on" : "win-chip"}
                        onClick={() => setOtherOn((s) => ({ ...s, [f.id]: !s[f.id] }))}
                      >
                        Other
                      </button>
                    )}
                  </div>
                  {f.allowOther && otherOn[f.id] && (
                    <input
                      className="win-field"
                      value={otherText[f.id] ?? ""}
                      placeholder="Other…"
                      onChange={(e) => setOther(f.id, e.target.value)}
                    />
                  )}
                </div>
              );
            }

            const value = freeText[f.id] ?? "";
            return (
              <div key={f.id} className="win-field-row">
                <label>{f.label}</label>
                {f.kind === "longtext" ? (
                  <textarea className="win-field" value={value} placeholder={f.placeholder} onChange={(e) => setText(f.id, e.target.value)} />
                ) : (
                  <input className="win-field" value={value} placeholder={f.placeholder} onChange={(e) => setText(f.id, e.target.value)} />
                )}
              </div>
            );
          })}
          {error && <p className="crt-err">SIGNAL LOST — {error}</p>}
          <button className="win-btn" onClick={() => void submit()}>
            SUBMIT
          </button>
        </div>
      </div>
    </CrtShell>
  );
}

/**
 * Post-submit screen (#9): the terminal sends the visitor onward. No number —
 * just a large thematic directive to vacate the kiosk for the next arrival.
 */
export function ExitScreen() {
  return (
    <div className="crt-processed">
      <p className="crt-exit">
        You have completed the intake survey.
        <span className="crt-exit-note">Please continue to your next station.</span>
      </p>
    </div>
  );
}
