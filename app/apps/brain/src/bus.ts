import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { toOsc, WsClientMsg, type ShowEvent, type WsServerMsg } from "@channelers/shared";
import { config } from "./config";

type OscSend = (address: string, ...args: Array<string | number>) => void;
type ReplyFn = (msg: WsServerMsg) => void;

/**
 * The event bus + WebSocket hub.
 *  - publish(event): a ShowEvent → all screens (wrapped) AND OSC (Anna/Jeff).
 *  - broadcast(msg): any server message (divination streaming, etc.) → all screens.
 *  - setCommandHandler: receive validated client commands with a per-socket reply fn and a stable
 *    connId for targeted responses (errors, ownership conflicts) that shouldn't go to everyone.
 *  - onConnect: called for each new socket with a reply fn + connId — used to send the current
 *    roster snapshot so the lobby is accurate immediately on load / reconnect.
 *  - onDisconnect: called with the connId when a socket closes — used to reap sessions whose
 *    owning performer has gone away (after a grace period).
 * OSC is optional and lazily loaded — if it can't start, the bus keeps working.
 */
export class Bus {
  private wss: WebSocketServer;
  private osc: OscSend | null = null;
  private onCmd: ((cmd: WsClientMsg, reply: ReplyFn, connId: string) => void) | null = null;
  private onConnectHook: ((reply: ReplyFn, connId: string) => void) | null = null;
  private onDisconnectHook: ((connId: string) => void) | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws) => {
      const connId = randomUUID();
      const reply: ReplyFn = (msg) => this.sendTo(ws, msg);
      this.sendTo(ws, { kind: "hello" });
      this.onConnectHook?.(reply, connId);
      ws.on("message", (raw) => {
        const parsed = WsClientMsg.safeParse(safeJson(raw.toString()));
        if (parsed.success) this.onCmd?.(parsed.data, reply, connId);
      });
      ws.on("close", () => this.onDisconnectHook?.(connId));
    });
    if (config.osc.enabled) void this.initOsc();
  }

  setCommandHandler(fn: (cmd: WsClientMsg, reply: ReplyFn, connId: string) => void): void {
    this.onCmd = fn;
  }

  /** Called once per new connection; use to push current state (e.g. roster) to the joiner. */
  onConnect(fn: (reply: ReplyFn, connId: string) => void): void {
    this.onConnectHook = fn;
  }

  /** Called when a socket closes; use to reap state owned by that connection. */
  onDisconnect(fn: (connId: string) => void): void {
    this.onDisconnectHook = fn;
  }

  broadcast(msg: WsServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  publish(event: ShowEvent): void {
    this.broadcast({ kind: "event", event });
    if (this.osc) {
      const { address, args } = toOsc(event);
      this.osc(address, ...args);
    }
  }

  private sendTo(ws: WebSocket, msg: WsServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private async initOsc(): Promise<void> {
    try {
      const { Client } = await import("node-osc");
      const client = new Client(config.osc.host, config.osc.port);
      this.osc = (address, ...args) => client.send(address, ...args, () => {});
      console.log(`[bus] OSC → ${config.osc.host}:${config.osc.port}`);
    } catch (err) {
      console.warn("[bus] OSC disabled (node-osc unavailable):", err);
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
