import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import WebSocket from "ws";
import { Bus } from "../src/bus";

// The Bus owns the WebSocket hub; the keepalive lives there. Test it directly
// against a real http server + real ws clients (no app, no mocks).
let server: Server | undefined;
let bus: Bus | undefined;

async function start(): Promise<number> {
  server = createServer();
  bus = new Bus(server);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return (server!.address() as { port: number }).port;
}

function open(port: number, opts?: WebSocket.ClientOptions) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, opts);
  const opened = new Promise<void>((res) => ws.on("open", () => res()));
  return { ws, opened };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(async () => {
  bus?.dispose();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  bus = undefined;
});

describe("ws keepalive", () => {
  it("pings a connected client and keeps a responsive one alive across ticks", async () => {
    const port = await start();
    const { ws, opened } = open(port); // autoPong on by default → it answers pings
    await opened;

    const pinged = new Promise<void>((res) => ws.on("ping", () => res()));
    bus!.pingTick();
    await pinged; // proves the keepalive actually pings idle sockets
    await wait(50); // let the auto-pong land → server re-marks the socket alive

    bus!.pingTick(); // next tick sees a live socket → pings again, never reaps
    await wait(50);
    expect(ws.readyState).toBe(WebSocket.OPEN); // a ponging client is never reaped

    ws.close();
  });

  it("terminates a client that did not pong since the previous tick", async () => {
    const port = await start();
    const { ws, opened } = open(port, { autoPong: false }); // never answers pings
    await opened;

    const closed = new Promise<void>((res) => ws.on("close", () => res()));
    bus!.pingTick(); // mark not-alive + ping
    await wait(50); // a live client would have ponged by now; this one won't
    bus!.pingTick(); // still not-alive → terminate
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});
