import { useState } from "react";
import { SURVEY, type SurveyResponse, type VibeAxis, type VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";
import { NumberGate } from "../components/NumberGate";

export function Intake() {
  const [visitor, setVisitor] = useState<VisitorProfile | null>(null);
  const [name, setName] = useState("");
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [phrases, setPhrases] = useState<Partial<Record<VibeAxis, string>>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visitor) return <NumberGate title="Intake" onResolved={setVisitor} />;

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
      await api.submitIntake(visitor.id, survey);
      setDone(true);
    } catch (e) {
      setError(String(e));
    }
  }

  if (done) {
    return (
      <main className="void">
        <h1>Processed.</h1>
        <p className="dim">
          Number {visitor.number} — proceed to the Physical Challenge when called.
        </p>
      </main>
    );
  }

  return (
    <main className="void form">
      <h1>Intake</h1>
      <p className="dim">Number {visitor.number}</p>
      {SURVEY.map((f) => {
        if (f.kind === "phrase") {
          return (
            <section key={f.axis} className="field">
              <label>{f.label}</label>
              <div className="choices">
                {f.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={phrases[f.axis] === o ? "choice on" : "choice"}
                    onClick={() => setPhrases((p) => ({ ...p, [f.axis]: o }))}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </section>
          );
        }
        const value = f.id === "name" ? name : freeText[f.id] ?? "";
        const set = (v: string) =>
          f.id === "name" ? setName(v) : setFreeText((s) => ({ ...s, [f.id]: v }));
        return (
          <section key={f.id} className="field">
            <label>{f.label}</label>
            {f.kind === "longtext" ? (
              <textarea value={value} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
            ) : (
              <input value={value} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
            )}
          </section>
        );
      })}
      {error && <p className="error">{error}</p>}
      <button className="submit" onClick={() => void submit()} disabled={!name.trim()}>
        Submit for processing
      </button>
    </main>
  );
}
