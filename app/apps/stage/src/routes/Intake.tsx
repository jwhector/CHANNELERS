import { useState } from "react";
import { SURVEY, type SurveyResponse, type VibeAxis, type VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { CalledGate } from "../components/CalledGate";
import { CrtShell } from "../components/CrtShell";
import { SegmentNumber } from "../components/SegmentNumber";
import { useStationPresence } from "../lib/useStationPresence";
import { useReleaseToGate } from "../lib/useReleaseToGate";

export function Intake() {
  const { connected, slot } = useStationPresence("intake");
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  const [name, setName] = useState("");
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [phrases, setPhrases] = useState<Partial<Record<VibeAxis, string>>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetKiosk() {
    setVisitor(null);
    setName("");
    setFreeText({});
    setPhrases({});
    setDone(false);
    setError(null);
  }

  useReleaseToGate(visitor, slot, done, resetKiosk);

  const status = connected ? "INTAKE · LIVE" : "INTAKE · NO SIGNAL";

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
    const survey: SurveyResponse = {
      name,
      freeText,
      phrases: Object.entries(phrases).map(([axis, choice]) => ({
        axis: axis as VibeAxis,
        choice: choice as string,
      })),
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
        <div className="crt-processed">
          <p className="crt-eyebrow">● processed</p>
          <SegmentNumber value={visitor.number} />
          <p className="crt-sub">proceed to the physical challenge when called</p>
        </div>
      </CrtShell>
    );
  }

  return (
    <CrtShell statusLabel={status}>
      <div className="win">
        <div className="win-title">
          <span>INTAKE.EXE — FORM 7-A</span>
          <span className="win-controls" aria-hidden>_ □ ✕</span>
        </div>
        <div className="win-body">
          <p className="win-subject">
            subject no. <SegmentNumber value={visitor.number} className="seg-inline" />
          </p>
          {SURVEY.map((f) => {
            if (f.kind === "phrase") {
              return (
                <div key={f.axis} className="win-field-row">
                  <label>{f.label}</label>
                  <div className="win-chips">
                    {f.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className={phrases[f.axis] === o ? "win-chip on" : "win-chip"}
                        onClick={() => setPhrases((p) => ({ ...p, [f.axis]: o }))}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            const value = f.id === "name" ? name : freeText[f.id] ?? "";
            const set = (v: string) =>
              f.id === "name" ? setName(v) : setFreeText((s) => ({ ...s, [f.id]: v }));
            return (
              <div key={f.id} className="win-field-row">
                <label>{f.label}</label>
                {f.kind === "longtext" ? (
                  <textarea className="win-field" value={value} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
                ) : (
                  <input className="win-field" value={value} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
                )}
              </div>
            );
          })}
          {error && <p className="crt-err">SIGNAL LOST — {error}</p>}
          <button className="win-btn" onClick={() => void submit()} disabled={!name.trim()}>
            SUBMIT
          </button>
        </div>
      </div>
    </CrtShell>
  );
}
