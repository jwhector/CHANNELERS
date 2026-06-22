import { useEffect, useRef, useState } from "react";
import {
  ARCHETYPES,
  DEFAULT_TUNING,
  type OracleTuning,
  type SessionSummary,
  type VisitorProfile,
  type WsServerMsg,
} from "@channelers/shared";
import { api } from "../lib/api";
import { useBrainSocket } from "../lib/useBrainSocket";
import { speak, createRecognizer, type Recognizer } from "../lib/speech";
import { loadHandle, saveHandle, clearHandle } from "../lib/sessionHandle";
import { AlteredStateConsole } from "../components/AlteredStateConsole";

type Line = { role: "visitor" | "oracle"; text: string };

/**
 * Unified performer page.
 *
 * Lobby mode: shows available visitors (not yet in a divination) with their chosen
 * oracle. Performer taps Channel to claim one.
 *
 * In-session mode: full teleprompter + mic/text input, whisper (TTS) toggle, End button.
 * Only messages tagged with mySessionId are applied — parallel sessions on other devices
 * don't bleed through.
 */
export function Channel() {
  const [visitors, setVisitors] = useState<VisitorProfile[]>([]);
  const [roster, setRoster] = useState<SessionSummary[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null); // visitorId being claimed

  // In-session state
  const [mySessionId, setMySessionId] = useState<string | null>(null);
  const [sessionMeta, setSessionMeta] = useState<{ archetype: string; visitorName: string } | null>(null);
  const [history, setHistory] = useState<Line[]>([]);
  const [live, setLive] = useState("");
  const [teleprompter, setTeleprompter] = useState("");
  const [whisper, setWhisper] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);

  // Live Altered-State tuning — seeded from the brain's tuning.state broadcast, edited here.
  const [tuning, setTuning] = useState<OracleTuning>(DEFAULT_TUNING);
  const tuningTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const whisperRef = useRef(whisper);
  whisperRef.current = whisper;
  const mySessionIdRef = useRef(mySessionId);
  mySessionIdRef.current = mySessionId;
  // sessionId of an in-flight rejoin attempt, so we can recognise its success/failure replies.
  const rejoiningRef = useRef<string | null>(null);

  async function refresh() {
    setVisitors(await api.listVisitors());
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

      case "roster":
        setRoster(m.sessions);
        break;

      case "tuning.state":
        setTuning(m.tuning);
        break;

      case "session.started":
        // Is this the session we just claimed?
        if (m.visitorId === claiming) {
          setClaiming(null);
          setMySessionId(m.sessionId);
          mySessionIdRef.current = m.sessionId;
          saveHandle({ sessionId: m.sessionId, visitorId: m.visitorId });
          setSessionMeta({ archetype: m.archetype, visitorName: m.visitorName });
          setHistory([]);
          setLive("");
          setTeleprompter(m.opening);
          setError(null);
          if (whisperRef.current) speak(m.opening);
        }
        break;

      case "session.resumed":
        // Re-attached after a refresh/reconnect, or reclaimed an orphan — restore the full UI.
        rejoiningRef.current = null;
        setClaiming(null);
        setMySessionId(m.sessionId);
        mySessionIdRef.current = m.sessionId;
        saveHandle({ sessionId: m.sessionId, visitorId: m.visitorId });
        setSessionMeta({ archetype: m.archetype, visitorName: m.visitorName });
        setHistory(m.history.map((l) => ({ role: l.role, text: l.text })));
        setLive("");
        setTeleprompter(m.teleprompter);
        setError(null);
        // Intentionally no speak() here — don't blast TTS into the earpiece on a silent reconnect.
        break;

      case "session.transcript":
        if (m.sessionId !== mySessionIdRef.current) break;
        setHistory((h) => [...h, { role: m.role, text: m.text }]);
        break;

      case "oracle.delta":
        if (m.sessionId !== mySessionIdRef.current) break;
        setLive((l) => l + m.text);
        break;

      case "oracle.done":
        if (m.sessionId !== mySessionIdRef.current) break;
        setHistory((h) => [...h, { role: "oracle", text: m.text }]);
        setTeleprompter(m.text);
        setLive("");
        if (whisperRef.current) speak(m.text);
        break;

      case "session.ended":
        if (m.sessionId !== mySessionIdRef.current) break;
        clearHandle();
        setMySessionId(null);
        mySessionIdRef.current = null;
        setSessionMeta(null);
        setLive("");
        setTeleprompter("");
        break;

      case "session.error":
        // A rejoin attempt failed — the session is gone, so drop our stale handle and stay in lobby.
        if (m.sessionId && m.sessionId === rejoiningRef.current) {
          rejoiningRef.current = null;
          clearHandle();
          break;
        }
        // Targeted claiming failure — clear the pending claim UI.
        if (m.visitorId && m.visitorId === claiming) {
          setClaiming(null);
          setError(m.message);
        } else if (m.sessionId && m.sessionId === mySessionIdRef.current) {
          setError(m.message);
        }
        break;
    }
  });

  useEffect(() => {
    void refresh();
  }, []);

  // On every (re)connect, re-assert our session if we have one: recovers it after a page refresh,
  // and on a transient blip cancels the brain's grace reaper before it can kill a still-live session.
  useEffect(() => {
    if (!connected) return;
    const sid = mySessionIdRef.current ?? loadHandle()?.sessionId;
    if (sid) {
      rejoiningRef.current = sid;
      send({ kind: "session.rejoin", sessionId: sid });
    }
  }, [connected, send]);

  const recRef = useRef<Recognizer | null>(null);
  if (!recRef.current) {
    recRef.current = createRecognizer({
      onFinal: (text) => {
        if (mySessionIdRef.current) send({ kind: "session.say", sessionId: mySessionIdRef.current, text });
      },
      onStart: () => setError(null),
      onEnd: () => setListening(false),
      onError: (msg) => { setListening(false); setError(msg); },
    });
  }

  // Update locally now (snappy sliders), push to the brain debounced.
  function changeTuning(next: OracleTuning) {
    setTuning(next);
    if (tuningTimer.current) clearTimeout(tuningTimer.current);
    tuningTimer.current = setTimeout(() => send({ kind: "tuning.set", tuning: next }), 150);
  }

  function submit() {
    const t = input.trim();
    if (!t || !mySessionId) return;
    send({ kind: "session.say", sessionId: mySessionId, text: t });
    setInput("");
  }

  function toggleMic() {
    const rec = recRef.current;
    if (!rec?.supported) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      rec.start();
      setListening(true);
    }
  }

  function endSession() {
    if (!mySessionId) return;
    send({ kind: "session.end", sessionId: mySessionId });
  }

  const busyVisitorIds = new Set(roster.map((s) => s.visitorId));
  const isOracleReady = (v: VisitorProfile) =>
    !!v.personaAt && !!v.poseVerifiedAt && !v.sessionEndAt;
  const available = visitors.filter((v) => isOracleReady(v) && !busyVisitorIds.has(v.id));
  const display = live || teleprompter;

  // ── In-session mode ──────────────────────────────────────────────────────────
  if (mySessionId) {
    return (
      <main className="void oracle">
        <header>
          <h1>Oracle</h1>
          <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
          <label className="toggle">
            <input type="checkbox" checked={whisper} onChange={(e) => setWhisper(e.target.checked)} /> whisper (TTS)
          </label>
          <button className="end" onClick={endSession}>End</button>
        </header>

        {sessionMeta && (
          <p className="dim">
            channelling <strong>{sessionMeta.archetype}</strong> for {sessionMeta.visitorName || "—"}
          </p>
        )}
        <AlteredStateConsole tuning={tuning} onChange={changeTuning} connected={connected} />
        {error && <p className="error">{error}</p>}

        <div className="teleprompter">
          {display || "…"}
          {live && <span className="caret">▍</span>}
        </div>

        <ul className="transcript">
          {history.map((l, i) => (
            <li key={i} className={`bubble ${l.role}`}>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>

        <div className="inputrow">
          {recRef.current?.supported && (
            <button className={listening ? "mic on" : "mic"} onClick={toggleMic}>
              {listening ? "● listening" : "🎤"}
            </button>
          )}
          <input
            value={input}
            placeholder="what the visitor says…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button className="submit" onClick={submit}>Say</button>
        </div>
      </main>
    );
  }

  // ── Lobby mode ───────────────────────────────────────────────────────────────
  const archetypeLabel = (id: string) =>
    ARCHETYPES.find((a) => a.id === id)?.label ?? id;

  return (
    <main className="void console">
      <header>
        <h1>Station</h1>
        <span className={connected ? "led on" : "led"} title={connected ? "live" : "offline"} />
        {roster.length > 0 && (
          <span className="dim" style={{ marginLeft: "auto", fontSize: "0.85em" }}>
            {roster.length} active
          </span>
        )}
      </header>

      {error && <p className="error">{error}</p>}

      <AlteredStateConsole tuning={tuning} onChange={changeTuning} connected={connected} />

      <h3>Available visitors</h3>
      {available.length === 0 && (
        <p className="dim">
          {visitors.length === 0
            ? "No visitors yet — waiting for intake submissions."
            : "No one is oracle-ready yet (needs pose verify + persona at the altar)."}
        </p>
      )}
      <ul className="visitors">
        {available.map((v) => {
          const archId = v.archetype ?? ARCHETYPES[0].id;
          const isClaiming = claiming === v.id;
          return (
            <li key={v.id}>
              <div className="row">
                <strong>{v.survey?.name || "(no name)"}</strong>
                <span className="dim">{archetypeLabel(archId)}</span>
                <button
                  className="submit"
                  disabled={!!claiming}
                  onClick={() => {
                    setClaiming(v.id);
                    setError(null);
                    send({ kind: "session.start", visitorId: v.id });
                  }}
                >
                  {isClaiming ? "…" : "Channel"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {roster.length > 0 && (
        <>
          <h3>Active sessions</h3>
          <ul className="visitors">
            {roster.map((s) => (
              <li key={s.sessionId}>
                <div className="row">
                  <strong>{s.visitorName || "(no name)"}</strong>
                  <span className="dim">{archetypeLabel(s.archetype)}</span>
                  <span className="dim">{s.turns} {s.turns === 1 ? "turn" : "turns"}</span>
                  <span className="dim being-channelled">being channelled</span>
                  <button
                    className="submit"
                    title="Take over this session"
                    onClick={() => {
                      rejoiningRef.current = s.sessionId;
                      setError(null);
                      send({ kind: "session.rejoin", sessionId: s.sessionId });
                    }}
                  >
                    Reclaim
                  </button>
                  <button className="end" title="Force-end this session" onClick={() => send({ kind: "session.end", sessionId: s.sessionId })}>
                    End
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
