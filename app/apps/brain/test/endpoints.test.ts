import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import type { FastifyInstance } from "fastify";
import { DEFAULT_CHOREO_CONFIG } from "@channelers/shared";
import WebSocket from "ws";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

async function register(n: number) {
  const res = await app.inject({ method: "POST", url: "/api/register", payload: { number: n } });
  return res.json() as any;
}

describe("registration + lookup", () => {
  it("registers by number and is idempotent", async () => {
    const a = await register(101);
    const b = await register(101);
    expect(a.number).toBe(101);
    expect(b.id).toBe(a.id);
  });

  it("looks a visitor up by number", async () => {
    await register(102);
    const res = await app.inject({ method: "GET", url: "/api/visitors/by-number/102" });
    expect(res.statusCode).toBe(200);
    expect(res.json().number).toBe(102);
  });

  it("404s an unknown number", async () => {
    const res = await app.inject({ method: "GET", url: "/api/visitors/by-number/999999" });
    expect(res.statusCode).toBe(404);
  });
});

describe("station upserts attach to the record", () => {
  it("intake → pose → persona → verify progress the milestones", async () => {
    const v = await register(200);
    const intake = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "Jo", freeText: {}, phrases: [] } } });
    expect(intake.json().survey.name).toBe("Jo");
    expect(intake.json().intakeAt).toBeTruthy();

    const pose = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/pose`,
      payload: { template: { angles: [0.1, 0.2], weights: [1, 1] } } });
    expect(pose.json().poseTemplate.angles).toEqual([0.1, 0.2]);

    const persona = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`,
      payload: { archetype: "tree" } });
    expect(persona.json().archetype).toBe("tree");
    expect(persona.json().personaAt).toBeTruthy();

    const verify = await app.inject({ method: "POST", url: `/api/visitors/${v.id}/verify` });
    expect(verify.json().poseVerifiedAt).toBeTruthy();
  });

  it("404s a station write to an unknown id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/visitors/nope/pose",
      payload: { template: { angles: [], weights: [] } } });
    expect(res.statusCode).toBe(404);
  });
});

describe("divination guards", () => {
  // A separate listening app so we can open a real WebSocket connection.
  // The process-global store is shared, so use numbers (9301, 9302) that
  // don't collide with any other test in this file.
  let gApp: FastifyInstance;
  let gPort: number;

  beforeAll(async () => {
    gApp = await buildApp();
    await gApp.listen({ host: "127.0.0.1", port: 0 });
    gPort = (gApp.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await gApp.close();
  });

  /** Open a ws client, send one session.start command, and resolve with the
   *  first session.error message received (or reject after 3 s). */
  function sendAndAwaitError(visitorId: string): Promise<{ kind: string; visitorId?: string; message: string }> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${gPort}/ws`);
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error("timeout waiting for session.error"));
      }, 3000);
      sock.on("open", () => sock.send(JSON.stringify({ kind: "session.start", visitorId })));
      sock.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.kind === "session.error") {
          clearTimeout(timer);
          sock.close();
          resolve(msg);
        }
      });
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  it("visitor with no survey gets 'visitor has not completed intake'", async () => {
    // Register via inject (shares the same in-process store as gApp).
    const res = await gApp.inject({ method: "POST", url: "/api/register", payload: { number: 9301 } });
    const v = res.json() as any;

    const err = await sendAndAwaitError(v.id);
    expect(err.kind).toBe("session.error");
    expect(err.message).toBe("visitor has not completed intake");
  });

  it("visitor WITH a survey but NO archetype gets 'no oracle selected yet'", async () => {
    const res = await gApp.inject({ method: "POST", url: "/api/register", payload: { number: 9302 } });
    const v = res.json() as any;

    // Post an intake survey so the visitor passes the first guard.
    await gApp.inject({
      method: "POST",
      url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "TestUser", freeText: {}, phrases: [] } },
    });

    const err = await sendAndAwaitError(v.id);
    expect(err.kind).toBe("session.error");
    expect(err.message).toBe("no oracle selected yet");
  });
});

describe("dispatch endpoints", () => {
  it("manual check-in override forces a visitor in_progress", async () => {
    const ci = await app.inject({ method: "POST", url: "/api/checkin", payload: { number: 4001, station: "bodyscan" } });
    expect(ci.statusCode).toBe(200);
    expect(ci.json().record.location).toMatchObject({ state: "in_progress", station: "bodyscan" });

    const lookup = await app.inject({ method: "GET", url: "/api/visitors/by-number/4001" });
    expect(lookup.json().location).toMatchObject({ state: "in_progress", station: "bodyscan" });
  });

  it("400s a check-in with a bad station", async () => {
    const res = await app.inject({ method: "POST", url: "/api/checkin", payload: { number: 4002, station: "lobby" } });
    expect(res.statusCode).toBe(400);
  });

  it("repool returns a checked-in visitor to waiting", async () => {
    const ci = await app.inject({ method: "POST", url: "/api/checkin", payload: { number: 4003, station: "intake" } });
    const id = ci.json().record.id;
    const rp = await app.inject({ method: "POST", url: "/api/dispatch/repool", payload: { visitorId: id } });
    expect(rp.statusCode).toBe(200);
    const lookup = await app.inject({ method: "GET", url: "/api/visitors/by-number/4003" });
    expect(lookup.json().location.state).toBe("waiting");
  });
});

describe("WS broadcasts coexist (bus multiplex)", () => {
  it("a new socket receives BOTH a roster and a dispatch.state on connect", async () => {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const kinds = await new Promise<string[]>((resolve, reject) => {
      const seen: string[] = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        seen.push(m.kind);
        if (seen.includes("roster") && seen.includes("dispatch.state")) resolve(seen);
      });
      ws.on("error", reject);
      setTimeout(() => resolve(seen), 1000);
    });
    ws.close();
    expect(kinds).toContain("roster");
    expect(kinds).toContain("dispatch.state");
  });
});

describe("arrive + assign-by-slot endpoints", () => {
  it("a bound kiosk: assign→confirm→arrive drives called→in_progress over HTTP", async () => {
    if (!app.server.address()) await app.listen({ host: "127.0.0.1", port: 0 }); // coexist with the WS-coexistence test's listen
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    // register BEFORE binding: with no online slot yet, the register-kick can't auto-pin anyone
    const reg = await app.inject({ method: "POST", url: "/api/register", payload: { number: 5101 } });
    const id = reg.json().id;

    // bind an intake kiosk to intake-0 over a real socket (binding does not auto-fill)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.on("open", () => r()));
    ws.send(JSON.stringify({ kind: "station.hello", station: "intake", kioskId: "kioskZ", slotHint: "intake-0" }));
    await new Promise((r) => setTimeout(r, 50));

    // deterministically pin THIS visitor to the online slot, then confirm→arrive
    const asg = await app.inject({ method: "POST", url: "/api/dispatch/assign", payload: { visitorId: id, slotId: "intake-0" } });
    expect(asg.json().ok).toBe(true);
    const conf = await app.inject({ method: "POST", url: "/api/dispatch/confirm", payload: { visitorId: id } });
    expect(conf.json().ok).toBe(true);
    const arrive = await app.inject({ method: "POST", url: "/api/dispatch/arrive", payload: { visitorId: id } });
    expect(arrive.json().ok).toBe(true);

    const lookup = await app.inject({ method: "GET", url: "/api/visitors/by-number/5101" });
    expect(lookup.json().location).toMatchObject({ state: "in_progress", station: "intake" });
    ws.close();
  });

  it("assign requires a slotId and 400s on a missing one", async () => {
    const reg = await app.inject({ method: "POST", url: "/api/register", payload: { number: 5102 } });
    const res = await app.inject({ method: "POST", url: "/api/dispatch/assign", payload: { visitorId: reg.json().id } });
    expect(res.statusCode).toBe(400);
  });
});

describe("choreo first-pass + config", () => {
  it("setting persona populates a choreography first-pass on the record", async () => {
    const v = await register(6101);
    await app.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "Jo", freeText: { lost: "my keys" }, phrases: [] } } });
    await app.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`, payload: { archetype: "tree" } });
    // first-pass is generated fire-and-forget; poll the record briefly
    let score = "";
    for (let i = 0; i < 20 && !score; i++) {
      const rec = ((await app.inject({ method: "GET", url: "/api/visitors" })).json() as { id: string; choreoFirstPass?: { score: string } }[])
        .find((r) => r.id === v.id);
      score = rec?.choreoFirstPass?.score ?? "";
      if (!score) await new Promise((r) => setTimeout(r, 25));
    }
    expect(score.length).toBeGreaterThan(0);
  });

  it("GET/POST /api/choreo/config round-trips the full config", async () => {
    const payload = { reactToOracle: false, mimicManual: true, mimicCadenceEnabled: true, mimicEveryNTurns: 5 };
    const set = await app.inject({ method: "POST", url: "/api/choreo/config", payload });
    expect(set.json()).toMatchObject(payload);
    const get = await app.inject({ method: "GET", url: "/api/choreo/config" });
    expect(get.json()).toMatchObject(payload);
    // restore default so later tests see the spec-default behavior
    await app.inject({ method: "POST", url: "/api/choreo/config", payload: { ...DEFAULT_CHOREO_CONFIG } });
  });
});

describe("choreo fan-out (both timings)", () => {
  let cApp: FastifyInstance;
  let cPort: number;
  beforeAll(async () => {
    cApp = await buildApp();
    await cApp.listen({ host: "127.0.0.1", port: 0 });
    cPort = (cApp.server.address() as { port: number }).port;
  });
  afterAll(async () => { await cApp.close(); });

  async function oracleReady(n: number): Promise<string> {
    const v = (await cApp.inject({ method: "POST", url: "/api/register", payload: { number: n } })).json() as { id: string };
    await cApp.inject({ method: "POST", url: `/api/visitors/${v.id}/intake`,
      payload: { survey: { name: "Jo", freeText: { lost: "keys" }, phrases: [] } } });
    await cApp.inject({ method: "POST", url: `/api/visitors/${v.id}/persona`, payload: { archetype: "tree" } });
    await cApp.inject({ method: "POST", url: `/api/visitors/${v.id}/verify` });
    return v.id;
  }

  /** Start a session for visitorId, say one line, resolve with the set of message kinds seen. */
  function sayAndCollect(visitorId: string): Promise<Set<string>> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${cPort}/ws`);
      const seen = new Set<string>();
      const timer = setTimeout(() => { sock.close(); resolve(seen); }, 4000);
      let sid = "";
      sock.on("open", () => sock.send(JSON.stringify({ kind: "session.start", visitorId })));
      sock.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.kind === "session.started" && m.visitorId === visitorId) {
          sid = m.sessionId;
          sock.send(JSON.stringify({ kind: "session.say", sessionId: sid, text: "where do I go" }));
        }
        if (m.sessionId && m.sessionId === sid) seen.add(m.kind);
        if (seen.has("oracle.done") && seen.has("choreo.done")) {
          clearTimeout(timer); sock.close(); resolve(seen);
        }
      });
      sock.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
  }

  it("reactive mode emits both oracle.* and choreo.*", async () => {
    await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: true } });
    const seen = await sayAndCollect(await oracleReady(9401));
    expect(seen.has("oracle.done")).toBe(true);
    expect(seen.has("choreo.delta")).toBe(true);
    expect(seen.has("choreo.done")).toBe(true);
  });

  it("independent mode still emits choreo.* (parallel to the oracle)", async () => {
    await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: false } });
    const seen = await sayAndCollect(await oracleReady(9402));
    expect(seen.has("choreo.done")).toBe(true);
    await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { reactToOracle: true } });
  });

  /** Say one line and resolve once the turn settles (oracle.done + the choreo.mimic payload). */
  function sayAndCollectMimic(visitorId: string): Promise<{ kinds: Set<string>; mimic: any }> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${cPort}/ws`);
      const seen = new Set<string>();
      let mimic: any = null;
      let sid = "";
      const timer = setTimeout(() => { sock.close(); resolve({ kinds: seen, mimic }); }, 4000);
      sock.on("open", () => sock.send(JSON.stringify({ kind: "session.start", visitorId })));
      sock.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.kind === "session.started" && m.visitorId === visitorId) {
          sid = m.sessionId;
          sock.send(JSON.stringify({ kind: "session.say", sessionId: sid, text: "where do I go" }));
        }
        if (m.sessionId && m.sessionId === sid) {
          seen.add(m.kind);
          if (m.kind === "choreo.mimic") mimic = m;
        }
        if (seen.has("oracle.done") && mimic) { clearTimeout(timer); sock.close(); resolve({ kinds: seen, mimic }); }
      });
      sock.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
  }

  it("manual mimic suppresses cues and emits choreo.mimic with the oracle line + archetype", async () => {
    await cApp.inject({ method: "POST", url: "/api/choreo/config",
      payload: { ...DEFAULT_CHOREO_CONFIG, mimicManual: true } });
    const { kinds, mimic } = await sayAndCollectMimic(await oracleReady(9403));
    expect(kinds.has("oracle.done")).toBe(true);
    expect(kinds.has("choreo.mimic")).toBe(true);
    expect(kinds.has("choreo.delta")).toBe(false); // choreographer suppressed
    expect(kinds.has("choreo.done")).toBe(false);
    expect(mimic.archetype).toBe("tree");
    expect(typeof mimic.text).toBe("string");
    await cApp.inject({ method: "POST", url: "/api/choreo/config", payload: { ...DEFAULT_CHOREO_CONFIG } });
  });
});

describe("paper feed", () => {
  it("feeds a page → returns text + fedAt (offline → placeholder)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/paper/feed",
      payload: { image: "data:image/jpeg;base64,AAAA" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.text).toBe("string");
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.fedAt).toBeTruthy();
  });

  it("400s a feed with no image", async () => {
    const res = await app.inject({ method: "POST", url: "/api/paper/feed", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
