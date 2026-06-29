import { useEffect, useMemo, useRef, useState } from "react";
import {
  SURVEY,
  type SurveyField,
  type VisitorProfile,
  type WsServerMsg,
} from "@channelers/shared";
import { PERSONAS, PERSONA_IDS, buildSystemPrompt } from "@channelers/oracles";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import {
  emptyForm,
  formToSurvey,
  surveyToForm,
  randomFill,
  type LabForm,
} from "../lib/promptLab";
import "../styles/promptlab.css";

type Line = { role: "visitor" | "oracle"; text: string };

/**
 * Prompt Lab (`/prompt-lab`) — a workshop tool for iterating the oracle (docs/superpowers/specs).
 *
 * Compose or override a visitor's intake on the left, watch the exact assembled system prompt in
 * the middle (the same `buildSystemPrompt` the brain uses), and run a live divination on the right.
 * "Apply & channel" submits the intake (overwrites freely) then (re)starts a session; because the
 * brain rebuilds the prompt from the current survey at session start, each cycle reflects the edit.
 *
 * Frontend-only: reuses POST /api/visitors/:id/intake, GET /api/visitors, and the divination WS.
 * The prompt axis is preview-only — to change the prompt *text* you edit personas.ts / buildPrompt.ts
 * (tsx watch auto-reloads the brain); this page never sends an overridden prompt.
 */
export function PromptLab() {
  const [visitors, setVisitors] = useState<VisitorProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [personaId, setPersonaId] = useState<string>(PERSONA_IDS[0] ?? "child");
  const [form, setForm] = useState<LabForm>(() => emptyForm());
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  // Divination state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<Line[]>([]);
  const [live, setLive] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  // The visitor we're mid-start on, so we can recognise our own session.started reply.
  const startingRef = useRef<string | null>(null);
  // When set, a session.ended should immediately re-start this visitor (the regenerate continuation).
  const pendingStartRef = useRef<string | null>(null);

  async function refresh() {
    try {
      setVisitors(await api.listVisitors());
    } catch (e) {
      setError(String(e));
    }
  }

  const { connected, send } = useBrainSocket((m: WsServerMsg) => {
    switch (m.kind) {
      case "event":
        if (
          m.event.type === "visitor.submitted" ||
          m.event.type === "seeds.ready" ||
          m.event.type === "oracle.selected" ||
          m.event.type === "divination.ended"
        ) {
          void refresh();
        }
        break;

      case "session.started":
        if (m.visitorId === startingRef.current) {
          startingRef.current = null;
          setSessionId(m.sessionId);
          sessionRef.current = m.sessionId;
          setHistory(m.opening ? [{ role: "oracle", text: m.opening }] : []);
          setLive("");
          setError(null);
          setStatus("channelling — type what the visitor says, then Say");
        }
        break;

      case "session.transcript":
        if (m.sessionId !== sessionRef.current) break;
        setHistory((h) => [...h, { role: m.role, text: m.text }]);
        break;

      case "oracle.delta":
        if (m.sessionId !== sessionRef.current) break;
        setLive((l) => l + m.text);
        break;

      case "oracle.done":
        if (m.sessionId !== sessionRef.current) break;
        setHistory((h) => [...h, { role: "oracle", text: m.text }]);
        setLive("");
        break;

      case "session.ended": {
        if (m.sessionId !== sessionRef.current) break;
        setSessionId(null);
        sessionRef.current = null;
        // Regenerate continuation: the end we issued to clear the way for a fresh start.
        const next = pendingStartRef.current;
        if (next) {
          pendingStartRef.current = null;
          startingRef.current = next;
          setHistory([]);
          setLive("");
          send({ kind: "session.start", visitorId: next });
        }
        break;
      }

      case "session.error":
        if (m.visitorId && m.visitorId === startingRef.current) {
          startingRef.current = null;
          setError(m.message);
        } else if (m.sessionId && m.sessionId === sessionRef.current) {
          setError(m.message);
        } else if (!m.visitorId && !m.sessionId) {
          setError(m.message);
        }
        break;
    }
  });

  useEffect(() => {
    void refresh();
  }, []);

  // Visitors that can be channelled: staged through the altar (persona + pose verified) and have an
  // archetype. We deliberately do NOT exclude sessionEndAt — re-channelling an ended visitor is the
  // whole point of the regenerate loop, and the brain allows it.
  const channelable = visitors.filter((v) => v.archetype && v.personaAt && v.poseVerifiedAt);
  const selected = visitors.find((v) => v.id === selectedId) ?? null;

  const survey = useMemo(() => formToSurvey(form), [form]);
  const preview = useMemo(() => {
    const persona = PERSONAS[personaId];
    if (!persona) return `(unknown persona: ${personaId})`;
    return buildSystemPrompt(persona, survey);
  }, [personaId, survey]);

  function setValue(id: string, value: string) {
    setForm((f) => ({ ...f, values: { ...f.values, [id]: value } }));
  }

  function loadFromVisitor(id: string) {
    setSelectedId(id);
    const v = visitors.find((x) => x.id === id);
    if (v?.survey) {
      setForm(surveyToForm(v.survey));
      setStatus(`loaded #${v.survey.name}'s current intake — edit and re-apply`);
    }
    if (v?.archetype && PERSONAS[v.archetype]) setPersonaId(v.archetype);
  }

  function doRandom() {
    setForm((f) => {
      const next = randomFill(SURVEY, Math.random, f.name || String(9000 + Math.floor(Math.random() * 1000)));
      return next;
    });
    setStatus("randomised intake");
  }

  function enterRaw() {
    setRawText(JSON.stringify(formToSurvey(form), null, 2));
    setRawError(null);
    setRaw(true);
  }

  function applyRaw() {
    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed?.name !== "string" || typeof parsed?.freeText !== "object") {
        throw new Error("need { name: string, freeText: object }");
      }
      setForm(surveyToForm({ name: parsed.name, freeText: parsed.freeText, phrases: [] }));
      setRaw(false);
      setRawError(null);
      setStatus("applied raw JSON");
    } catch (e) {
      setRawError(String(e));
    }
  }

  async function applyIntake(): Promise<boolean> {
    if (!selectedId) {
      setError("pick a visitor first");
      return false;
    }
    try {
      await api.submitIntake(selectedId, formToSurvey(form));
      setStatus("intake applied ✓");
      setError(null);
      void refresh();
      return true;
    } catch (e) {
      setError(`intake failed: ${e}`);
      return false;
    }
  }

  function startOrRestart() {
    if (!selectedId) {
      setError("pick a visitor first");
      return;
    }
    setError(null);
    if (sessionRef.current) {
      // End the live session first; the session.ended handler fires the fresh start.
      pendingStartRef.current = selectedId;
      send({ kind: "session.end", sessionId: sessionRef.current });
    } else {
      startingRef.current = selectedId;
      setHistory([]);
      setLive("");
      send({ kind: "session.start", visitorId: selectedId });
    }
  }

  async function applyAndChannel() {
    const ok = await applyIntake();
    if (ok) startOrRestart();
  }

  function say() {
    const t = input.trim();
    if (!t || !sessionRef.current) return;
    send({ kind: "session.say", sessionId: sessionRef.current, text: t });
    setInput("");
  }

  function endSession() {
    if (sessionRef.current) send({ kind: "session.end", sessionId: sessionRef.current });
  }

  const display = live || (history.length ? "" : "…");

  return (
    <main className="lab">
      <header className="lab-head">
        <h1>Prompt Lab</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        <span className="lab-hint dim">
          intake + prompt iteration · prompt text edits live-reload via the brain watcher
        </span>
      </header>

      {error && <p className="lab-error">{error}</p>}
      {status && <p className="lab-status dim">{status}</p>}

      <div className="lab-grid">
        {/* ── Compose / override ─────────────────────────────── */}
        <section className="lab-col">
          <h3>Visitor</h3>
          <div className="lab-row">
            <select value={selectedId} onChange={(e) => loadFromVisitor(e.target.value)}>
              <option value="">— pick a seeded visitor —</option>
              {channelable.map((v) => (
                <option key={v.id} value={v.id}>
                  #{v.number} · {v.archetype}
                  {v.survey ? " · has intake" : ""}
                  {v.sessionEndAt ? " · channelled" : ""}
                </option>
              ))}
            </select>
            <button onClick={() => void refresh()} title="Refresh visitor list">↻</button>
          </div>
          {channelable.length === 0 && (
            <p className="dim">
              No channelable visitors. Seed a pool: <code>pnpm seed:no-intake --count 5</code>
            </p>
          )}

          <h3>Persona (preview)</h3>
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            {PERSONA_IDS.map((id) => (
              <option key={id} value={id}>{PERSONAS[id]?.name ?? id}</option>
            ))}
          </select>

          <div className="lab-row lab-spread">
            <h3>Intake</h3>
            <div className="lab-row">
              <button onClick={doRandom}>Randomise</button>
              {selected?.survey && (
                <button onClick={() => loadFromVisitor(selected.id)} title="Reload this visitor's stored survey">
                  Load current
                </button>
              )}
              {raw ? (
                <button onClick={applyRaw}>Apply JSON</button>
              ) : (
                <button onClick={enterRaw}>Raw JSON</button>
              )}
            </div>
          </div>

          <label className="lab-field">
            <span>Ticket #</span>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>

          {raw ? (
            <>
              {rawError && <p className="lab-error">{rawError}</p>}
              <textarea
                className="lab-raw"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                spellCheck={false}
              />
            </>
          ) : (
            SURVEY.map((f) => (
              <FieldInput key={f.id} field={f} value={form.values[f.id] ?? ""} onChange={(v) => setValue(f.id, v)} />
            ))
          )}
        </section>

        {/* ── Live prompt preview ────────────────────────────── */}
        <section className="lab-col">
          <h3>Assembled system prompt</h3>
          <p className="dim">
            Exactly what the brain builds at <code>session.start</code> for this intake + persona.
          </p>
          <pre className="lab-preview">{preview}</pre>
        </section>

        {/* ── Divination ─────────────────────────────────────── */}
        <section className="lab-col">
          <h3>Divination</h3>
          <div className="lab-row">
            <button className="lab-primary" onClick={() => void applyAndChannel()} disabled={!selectedId}>
              Apply &amp; channel
            </button>
            <button onClick={() => void applyIntake()} disabled={!selectedId}>Apply intake</button>
            <button onClick={startOrRestart} disabled={!selectedId}>
              {sessionId ? "Regenerate" : "Channel"}
            </button>
            {sessionId && <button className="lab-end" onClick={endSession}>End</button>}
          </div>

          <div className="lab-teleprompter">
            {display}
            {live && <span className="caret">▍</span>}
          </div>

          <div className="lab-row">
            <input
              value={input}
              placeholder="what the visitor says…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") say(); }}
              disabled={!sessionId}
            />
            <button onClick={say} disabled={!sessionId}>Say</button>
          </div>

          <ul className="lab-transcript">
            {history.map((l, i) => (
              <li key={i} className={`lab-bubble ${l.role}`}>{l.text}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

/** One survey field, rendered by kind. Values are plain strings (matching SurveyResponse.freeText). */
function FieldInput({ field, value, onChange }: { field: SurveyField; value: string; onChange: (v: string) => void }) {
  if (field.kind === "longtext") {
    return (
      <label className="lab-field">
        <span>{field.label}</span>
        <textarea value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  if (field.kind === "scale") {
    const n = Number(value) || field.min;
    return (
      <label className="lab-field">
        <span>{field.label}</span>
        <span className="lab-scale">
          <input
            type="range"
            min={field.min}
            max={field.max}
            value={n}
            onChange={(e) => onChange(e.target.value)}
          />
          <em>{value || "—"}</em>
        </span>
      </label>
    );
  }
  if (field.kind === "single") {
    const inOptions = field.options.includes(value);
    const isOther = !!value && !inOptions;
    return (
      <label className="lab-field">
        <span>{field.label}</span>
        <select
          value={isOther ? "__other__" : value}
          onChange={(e) => onChange(e.target.value === "__other__" ? " " : e.target.value)}
        >
          <option value="">— choose —</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          {field.allowOther && <option value="__other__">Other…</option>}
        </select>
        {field.allowOther && isOther && (
          <input value={value} placeholder="other…" onChange={(e) => onChange(e.target.value)} />
        )}
      </label>
    );
  }
  if (field.kind === "multi") {
    const chosen = value ? value.split(", ").filter(Boolean) : [];
    const toggle = (opt: string) => {
      const has = chosen.includes(opt);
      let next = has ? chosen.filter((c) => c !== opt) : [...chosen, opt];
      if (!has && field.max && next.length > field.max) return; // at cap
      onChange(next.join(", "));
    };
    return (
      <fieldset className="lab-field lab-multi">
        <legend>{field.label}{field.max ? ` (max ${field.max})` : ""}</legend>
        {field.options.map((o) => (
          <label key={o} className="lab-check">
            <input
              type="checkbox"
              checked={chosen.includes(o)}
              disabled={!chosen.includes(o) && !!field.max && chosen.length >= field.max}
              onChange={() => toggle(o)}
            />
            {o}
          </label>
        ))}
      </fieldset>
    );
  }
  // text
  return (
    <label className="lab-field">
      <span>{field.label}</span>
      <input value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
