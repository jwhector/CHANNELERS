import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { toOsc, WsClientMsg, type ShowEvent, type WsServerMsg } from "@channelers/shared";
import { config } from "./config";

type OscSend = (address: string, ...args: Array<string | number>) => void;
type ReplyFn = (msg: WsServerMsg) => void;
/** ws sockets, tagged with the keepalive liveness flag (true since the last pong). */
type LiveSocket = WebSocket & { isAlive?: boolean };

/**
 * The event bus + WebSocket hub.
 *  - publish(event): a ShowEvent → all screens (wrapped) AND OSC (Anna/Jeff).
 *  - broadcast(msg): any server message (divination streaming, etc.) → all screens.
 *  - onCommand: register a command handler; multiple subsystems may register (fan-out).
 *    Each receives every client command; subsystems early-return for commands they don't own.
 *  - onConnect: called for each new socket with a reply fn + connId — multiple subscribers
 *    (divination pushes roster; dispatcher pushes dispatch.state).
 *  - onDisconnect: called with the connId when a socket closes — multiple subscribers
 *    (divination reaps orphaned sessions; dispatcher reaps in-progress visitors on station drop).
 * OSC is optional and lazily loaded — if it can't start, the bus keeps working.
 */
export class Bus {
  private wss: WebSocketServer;
  private osc: OscSend | null = null;
  private onCmdHooks: Array<(cmd: WsClientMsg, reply: ReplyFn, connId: string) => void> = [];
  private onConnectHooks: Array<(reply: ReplyFn, connId: string) => void> = [];
  private onDisconnectHooks: Array<(connId: string) => void> = [];
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(server: Server, opts: { heartbeatMs?: number } = {}) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws: LiveSocket) => {
      const connId = randomUUID();
      const reply: ReplyFn = (msg) => this.sendTo(ws, msg);
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });
      this.sendTo(ws, { kind: "hello" });
      for (const hook of this.onConnectHooks) hook(reply, connId);
      ws.on("message", (raw) => {
        const parsed = WsClientMsg.safeParse(safeJson(raw.toString()));
        if (parsed.success) for (const hook of this.onCmdHooks) hook(parsed.data, reply, connId);
      });
      ws.on("close", () => {
        for (const hook of this.onDisconnectHooks) hook(connId);
      });
    });
    const heartbeatMs = opts.heartbeatMs ?? config.wsHeartbeatMs;
    if (heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => this.pingTick(), heartbeatMs);
      this.heartbeatTimer.unref(); // never keep the process (or a test) alive
    }
    if (config.osc.enabled) void this.initOsc();
  }

  /**
   * One keepalive tick: ping every live socket, and terminate any that hasn't
   * answered (ponged) since the previous tick. Keeps idle sockets warm through
   * NAT/proxy idle timeouts and reaps half-open connections.
   */
  pingTick(): void {
    for (const client of this.wss.clients) {
      const ws = client as LiveSocket;
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  /** Stop the keepalive timer (wired to Fastify onClose). */
  dispose(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** Register a command handler. Multiple subsystems may register; each sees every command. */
  onCommand(fn: (cmd: WsClientMsg, reply: ReplyFn, connId: string) => void): void {
    this.onCmdHooks.push(fn);
  }

  /** Called once per new connection; push current state (roster, dispatch.state) to the joiner. */
  onConnect(fn: (reply: ReplyFn, connId: string) => void): void {
    this.onConnectHooks.push(fn);
  }

  /** Called when a socket closes; reap state owned by that connection. */
  onDisconnect(fn: (connId: string) => void): void {
    this.onDisconnectHooks.push(fn);
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
