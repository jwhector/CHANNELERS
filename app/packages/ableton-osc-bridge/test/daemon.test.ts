import { describe, it, expect, vi } from "vitest";
import { attachConnection, type Conn } from "../src/daemon/daemon";
import type { ServerMessage } from "../src/protocol";
import type { VerbProvider, Subscription } from "../src/transport";
import { serve } from "../src/daemon/serve";

const noopProvider: VerbProvider = {
  send: () => {},
  query: async () => [],
  subscribe: () => ({ unsubscribe: () => {} }),
};

function fakeConn() {
  const out: ServerMessage[] = [];
  let onMsg: (raw: string) => void = () => {};
  let onClose: () => void = () => {};
  const conn: Conn = {
    send: (m) => out.push(m),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onClose = cb; },
  };
  return { conn, out, recv: (m: object) => onMsg(JSON.stringify(m)), close: () => onClose() };
}

function fakeProvider() {
  const calls: string[] = [];
  let lastSubCb: ((args: number[]) => void) | null = null;
  const provider: VerbProvider = {
    send: (a) => { calls.push(`send ${a}`); },
    query: async (a) => { calls.push(`query ${a}`); return [120]; },
    subscribe: (a, _args, cb): Subscription => {
      calls.push(`subscribe ${a}`);
      lastSubCb = cb as (args: number[]) => void;
      return { unsubscribe: () => calls.push("unsubscribe") };
    },
  };
  return { provider, calls, fire: (args: number[]) => lastSubCb?.(args) };
}

describe("attachConnection", () => {
  it("greets with hello", () => {
    const { conn, out } = fakeConn();
    attachConnection(fakeProvider().provider, conn);
    expect(out[0]).toEqual({ kind: "hello" });
  });

  it("answers a query with a reply carrying the same id", async () => {
    const { conn, out, recv } = fakeConn();
    attachConnection(fakeProvider().provider, conn);
    recv({ id: "q1", kind: "query", address: "/live/song/get/tempo", args: [] });
    await vi.waitFor(() => expect(out).toContainEqual({ kind: "reply", id: "q1", args: [120] }));
  });

  it("streams subscription updates as events, then stops after unsubscribe", () => {
    const { conn, out, recv } = fakeConn();
    const p = fakeProvider();
    attachConnection(p.provider, conn);
    recv({ id: "1", kind: "subscribe", subId: "s1", address: "/live/song/start_listen/beat", args: [] });
    p.fire([1]);
    recv({ id: "2", kind: "unsubscribe", subId: "s1" });
    p.fire([2]);
    expect(out).toContainEqual({ kind: "event", subId: "s1", address: "/live/song/start_listen/beat", args: [1] });
    expect(out).not.toContainEqual({ kind: "event", subId: "s1", address: "/live/song/start_listen/beat", args: [2] });
    expect(p.calls).toContain("unsubscribe");
  });

  it("cleans up subscriptions when the connection closes", () => {
    const { conn, recv, close } = fakeConn();
    const p = fakeProvider();
    attachConnection(p.provider, conn);
    recv({ id: "1", kind: "subscribe", subId: "s1", address: "/live/song/start_listen/beat", args: [] });
    close();
    expect(p.calls).toContain("unsubscribe");
  });
});

describe("serve playground", () => {
  it("serves the playground HTML at /", async () => {
    const handle = serve({ provider: noopProvider, port: 8799 });
    const res = await fetch("http://127.0.0.1:8799/");
    const body = await res.text();
    await handle.close();
    expect(res.status).toBe(200);
    expect(body).toContain("ableton-osc-bridge");
    expect(body).toContain("Subscribe"); // a control from the full page
  });
});
