import { randomUUID } from "node:crypto";
import { buildPersona, buildChoreoSystemPrompt } from "@channelers/oracles";
import {
  DEFAULT_TUNING,
  resolveSampling,
  buildDriftDirective,
  mangleOutput,
  type OraclePersona,
  type WsClientMsg,
  type WsServerMsg,
} from "@channelers/shared";
import { store } from "./store";
import { config } from "./config";
import { getTuning } from "./tuning";
import { getChoreoConfig, streamCue, stubFirstPass, buildChoreoTurnPrompt, type ChoreoTurn } from "./choreo";
import type { Bus } from "./bus";

type Turn = { role: "user" | "assistant"; content: string };
type ReplyFn = (msg: WsServerMsg) => void;

interface Session {
  id: string;
  visitorId: string;
  visitorName: string;
  archetype: string;
  persona: OraclePersona;
  history: Turn[];
  /** Stable per-session choreographer prefix (intake + archetype + first-pass). */
  choreoSystemPrompt: string;
  /** The choreographer's own running history (separate from the oracle's). */
  choreoHistory: ChoreoTurn[];
  /** Connection currently channelling this session; rebinds on rejoin. Drives the grace reaper. */
  ownerConn: string;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * How long an orphaned session lingers after its performer's socket drops before it's reaped.
 * Long enough to ride out a page refresh / transient blip (client reconnects in ~1s and rejoins),
 * short enough that an abandoned tab frees the visitor reasonably quickly.
 */
const SESSION_GRACE_MS = 90_000;

/**
 * Manages concurrent divination sessions — one per visitor, keyed by sessionId.
 * The bus hands us a per-socket `reply` fn for targeted errors; everything else
 * is broadcast so every screen (station, monitor) stays up to date.
 */
export function registerDivination(bus: Bus): void {
  const sessions = new Map<string, Session>();
  const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearReap(sessionId: string): void {
    const t = reapTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      reapTimers.delete(sessionId);
    }
  }

  function rosterMsg(): WsServerMsg {
    return {
      kind: "roster",
      sessions: [...sessions.values()].map((s) => ({
        sessionId: s.id,
        visitorId: s.visitorId,
        visitorName: s.visitorName,
        archetype: s.archetype,
        turns: s.history.filter((t) => t.role === "user").length,
      })),
    };
  }

  // Send current roster to each new client so the lobby is accurate on load / reconnect.
  bus.onConnect((reply, _connId) => reply(rosterMsg()));

  bus.onCommand((cmd, reply, connId) => void handle(cmd, reply, connId));

  // A performer's socket dropped: give them a grace window to refresh/reconnect (the client
  // re-asserts ownership via session.rejoin, which cancels this), then reap the orphan so the
  // visitor frees up instead of being stuck "being channelled" forever.
  bus.onDisconnect((connId) => {
    for (const session of sessions.values()) {
      if (session.ownerConn !== connId || reapTimers.has(session.id)) continue;
      const sessionId = session.id;
      reapTimers.set(
        sessionId,
        setTimeout(() => {
          reapTimers.delete(sessionId);
          const s = sessions.get(sessionId);
          if (!s || s.ownerConn !== connId) return; // someone re-attached — leave it alone
          reap(sessionId);
        }, SESSION_GRACE_MS),
      );
    }
  });

  async function handle(cmd: WsClientMsg, reply: ReplyFn, connId: string): Promise<void> {
    if (cmd.kind === "session.start") return start(cmd.visitorId, reply, connId);
    if (cmd.kind === "session.rejoin") return rejoin(cmd.sessionId, reply, connId);
    if (cmd.kind === "session.end") return end(cmd.sessionId, reply);
    if (cmd.kind === "session.say") return say(cmd.sessionId, cmd.text, reply);
  }

  /** Tear down a session and tell every screen. Used by explicit end and by the grace reaper. */
  function reap(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    clearReap(sessionId);
    sessions.delete(sessionId);
    store.markSessionEnd(session.visitorId);
    bus.publish({ type: "divination.ended", profileId: session.visitorId });
    bus.broadcast({ kind: "session.ended", sessionId });
    bus.broadcast(rosterMsg());
  }

  function start(visitorId: string, reply: ReplyFn, connId: string): void {
    const visitor = store.get(visitorId);
    if (!visitor) {
      reply({ kind: "session.error", visitorId, message: "unknown visitor" });
      return;
    }
    if (!visitor.survey) {
      reply({ kind: "session.error", visitorId, message: "visitor has not completed intake" });
      return;
    }
    if (!visitor.archetype) {
      reply({ kind: "session.error", visitorId, message: "no oracle selected yet" });
      return;
    }

    const already = [...sessions.values()].find((s) => s.visitorId === visitorId);
    if (already) {
      reply({ kind: "session.error", visitorId, message: "visitor already in a divination" });
      return;
    }

    const archetypeId = visitor.archetype;
    let persona: OraclePersona;
    try {
      persona = buildPersona(archetypeId, visitor);
    } catch {
      reply({ kind: "session.error", visitorId, message: `unknown archetype: ${archetypeId}` });
      return;
    }

    // Choreographer context for the fan-out loop: the first-pass (generated at persona-set) seeds
    // a stable system prefix; if it never landed (e.g. set before this feature), fall back to a stub.
    const firstPass = visitor.choreoFirstPass?.score ?? stubFirstPass(visitor.survey, archetypeId).score;
    const choreoSystemPrompt = buildChoreoSystemPrompt(visitor.survey, archetypeId, firstPass);

    const session: Session = {
      id: randomUUID(),
      visitorId,
      visitorName: visitor.survey.name,
      archetype: archetypeId,
      persona,
      history: [],
      choreoSystemPrompt,
      choreoHistory: [],
      ownerConn: connId,
    };
    sessions.set(session.id, session);
    store.markSessionStart(visitorId);

    bus.publish({ type: "oracle.selected", profileId: visitorId, archetype: archetypeId });
    bus.publish({ type: "divination.started", profileId: visitorId });
    bus.broadcast({
      kind: "session.started",
      sessionId: session.id,
      visitorId,
      visitorName: session.visitorName,
      archetype: archetypeId,
      opening: persona.openingLine,
    });
    bus.broadcast(rosterMsg());
  }

  function end(sessionId: string, reply: ReplyFn): void {
    if (!sessions.has(sessionId)) {
      reply({ kind: "session.error", sessionId, message: "no session with that id" });
      return;
    }
    reap(sessionId);
  }

  /**
   * Re-attach to an existing session after the client lost its handle (page refresh, transient
   * socket drop, or a different performer reclaiming an orphan). Cancels any pending reap, rebinds
   * ownership to the new connection, and replays full state so the in-session UI restores exactly.
   */
  function rejoin(sessionId: string, reply: ReplyFn, connId: string): void {
    const session = sessions.get(sessionId);
    if (!session) {
      // Session is gone (ended or reaped) — tell the client so it drops its stale handle.
      reply({ kind: "session.error", sessionId, message: "no session with that id" });
      return;
    }
    clearReap(sessionId);
    session.ownerConn = connId;

    const history = session.history.map((t) => ({
      role: t.role === "user" ? ("visitor" as const) : ("oracle" as const),
      text: t.content,
    }));
    const lastOracle = [...session.history].reverse().find((t) => t.role === "assistant");
    reply({
      kind: "session.resumed",
      sessionId: session.id,
      visitorId: session.visitorId,
      visitorName: session.visitorName,
      archetype: session.archetype,
      history,
      teleprompter: lastOracle?.content ?? session.persona.openingLine,
    });
  }

  /**
   * Fan-out consumer (spec §8): a movement cue per turn, on the separate choreo.* feed.
   * Fire-and-forget — wrapped so a choreo failure NEVER disturbs the oracle turn.
   */
  async function runChoreo(session: Session, turn: { visitor: string; oracle?: string }): Promise<void> {
    const sessionId = session.id;
    try {
      const cue = await streamCue(
        { systemPrompt: session.choreoSystemPrompt, history: session.choreoHistory, ...turn },
        (chunk) => {
          if (sessions.has(sessionId)) bus.broadcast({ kind: "choreo.delta", sessionId, text: chunk });
        },
      );
      session.choreoHistory.push({ role: "user", content: buildChoreoTurnPrompt(turn) });
      session.choreoHistory.push({ role: "assistant", content: cue });
      if (sessions.has(sessionId)) bus.broadcast({ kind: "choreo.done", sessionId, text: cue });
    } catch (err) {
      console.warn("[choreo] turn failed:", err);
    }
  }

  async function say(sessionId: string, rawText: string, reply: ReplyFn): Promise<void> {
    const session = sessions.get(sessionId);
    const text = rawText.trim();
    if (!session) {
      reply({ kind: "session.error", sessionId, message: "no active session" });
      return;
    }
    if (!text) return;

    session.history.push({ role: "user", content: text });
    bus.broadcast({ kind: "session.transcript", sessionId, role: "visitor", text });

    const reactToOracle = getChoreoConfig().reactToOracle;
    // Independent mode: kick the cue off in parallel from the utterance alone.
    if (!reactToOracle) void runChoreo(session, { visitor: text });

    try {
      const full = await streamReply(session, (chunk) => {
        if (sessions.has(sessionId)) bus.broadcast({ kind: "oracle.delta", sessionId, text: chunk });
      });
      session.history.push({ role: "assistant", content: full });
      bus.broadcast({ kind: "oracle.done", sessionId, text: full });
      bus.broadcast(rosterMsg());
      // Reactive mode: now that the oracle reply exists, react to utterance + reply.
      if (reactToOracle) void runChoreo(session, { visitor: text, oracle: full });
    } catch (err) {
      bus.broadcast({ kind: "session.error", sessionId, message: String(err) });
    }
  }
}

async function streamReply(session: Session, onDelta: (chunk: string) => void): Promise<string> {
  // Live Altered-State tuning (global). When scope.applyToOracle is off, fall back to the
  // baseline (today's) behavior; otherwise honor the operator's dials.
  const tuning = getTuning();
  const active = tuning.scope.applyToOracle;
  const mangle = active && tuning.pipeline.outputMangle;
  // Deterministic per-turn seed for the text pipeline (turn N → same mangle every replay).
  const seed = session.history.filter((t) => t.role === "assistant").length;

  if (!config.openaiApiKey) {
    const line = fallbackLine(session);
    // outputMangle works offline too, so the text pipeline is testable with no API key.
    if (mangle) {
      const out = mangleOutput(line, tuning, seed);
      onDelta(out);
      return out;
    }
    return streamWords(line, onDelta);
  }

  const sampling = resolveSampling(active ? tuning : DEFAULT_TUNING);
  const systemPrompt = session.persona.systemPrompt + (active ? buildDriftDirective(tuning) : "");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  // OpenAI puts the system prompt in the messages array (no separate `system` param).
  const stream = await client.chat.completions.create({
    model: config.oracleModel,
    ...sampling,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...session.history.map((t) => ({ role: t.role, content: t.content })),
    ],
  });
  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      full += delta;
      // When mangling, buffer the whole reply (we transform it before showing it).
      if (!mangle) onDelta(delta);
    }
  }
  if (mangle) {
    const out = mangleOutput(full, tuning, seed);
    onDelta(out);
    return out;
  }
  return full;
}

/** The deterministic offline oracle line (3-turn rotation), no streaming. */
function fallbackLine(session: Session): string {
  const said = session.history[session.history.length - 1]?.content ?? "";
  const echo = said.split(/\s+/).slice(-3).join(" ");
  const turn = session.history.filter((t) => t.role === "assistant").length;
  const lines = [
    `I heard "${echo}". The window for that closed in another season.`,
    `Take a number. What you seek — "${echo}" — was already inside you.`,
    `The forms are processing. "${echo}" is not a question I can stamp today.`,
  ];
  return lines[turn % lines.length] ?? session.persona.openingLine;
}

/** Stream a fixed line word-by-word with the original cadence. */
async function streamWords(line: string, onDelta: (chunk: string) => void): Promise<string> {
  let acc = "";
  for (const word of line.split(" ")) {
    const chunk = acc ? ` ${word}` : word;
    acc += chunk;
    onDelta(chunk);
    await delay(45);
  }
  return acc;
}
