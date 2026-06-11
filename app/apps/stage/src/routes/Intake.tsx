import { useState } from "react";
import { ARCHETYPES, SURVEY, type SurveyResponse, type VibeAxis } from "@channelers/shared";
import { api } from "../lib/api";

export function Intake() {
  const [name, setName] = useState("");
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [phrases, setPhrases] = useState<Partial<Record<VibeAxis, string>>>({});
  const [archetype, setArchetype] = useState<string>("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const survey: SurveyResponse = {
      name,
      freeText,
      phrases: Object.entries(phrases).map(([axis, choice]) => ({
        axis: axis as VibeAxis,
        choice: choice as string,
      })),
      archetype: archetype || undefined,
    };
    try {
      const profile = await api.submitSurvey(survey);
      setTicket(profile.id);
    } catch (e) {
      setError(String(e));
    }
  }

  if (ticket) {
    return (
      <main className="void">
        <h1>Processed.</h1>
        <p className="dim">Ticket {ticket.slice(0, 8)} — proceed to the scanning station.</p>
      </main>
    );
  }

  return (
    <main className="void form">
      <h1>Intake</h1>
      {SURVEY.map((f) => {
        if (f.kind === "scan") {
          return (
            <section key={`${f.label}-${f.station}`} className="field scan">
              <h3>{f.label}</h3>
              <p className="dim">{f.instruction}</p>
              <em className="dim">(completed at the scanning station — /scan)</em>
            </section>
          );
        }
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
        if (f.kind === "oracle") {
          return (
            <section key="oracle" className="field">
              <label>{f.label}</label>
              <p className="dim">{f.instruction}</p>
              <div className="choices oracle-choices">
                {ARCHETYPES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={archetype === a.id ? "choice on" : "choice"}
                    onClick={() => setArchetype(a.id)}
                  >
                    <strong>{a.label}</strong>
                    <span className="dim">{a.blurb}</span>
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
      <button className="submit" onClick={submit} disabled={!name.trim()}>
        Submit for processing
      </button>
    </main>
  );
}
