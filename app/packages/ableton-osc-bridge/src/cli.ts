import { createInterface } from "node:readline";
import { WebSocket } from "ws";
import { createAbletonLive } from "./core/live";
import { serve } from "./daemon/serve";
import { AbletonBridgeClient, type WebSocketCtor } from "./client/index";

export interface BridgeConfig {
  host: string;
  sendPort: number;
  recvPort: number;
  httpPort: number;
  token?: string;
  dialUrl?: string;
  queryTimeoutMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  return {
    host: env.ABLETON_OSC_HOST ?? "127.0.0.1",
    sendPort: Number(env.ABLETON_OSC_SEND_PORT ?? 11000),
    recvPort: Number(env.ABLETON_OSC_RECV_PORT ?? 11001),
    httpPort: Number(env.BRIDGE_HTTP_PORT ?? 8788),
    token: env.BRIDGE_TOKEN || undefined,
    dialUrl: env.BRIDGE_DIAL_URL || undefined,
    queryTimeoutMs: Number(env.BRIDGE_QUERY_TIMEOUT_MS ?? 1000),
  };
}

async function runServe(cfg: BridgeConfig): Promise<void> {
  const live = createAbletonLive({ host: cfg.host, sendPort: cfg.sendPort, recvPort: cfg.recvPort, defaultTimeoutMs: cfg.queryTimeoutMs });
  const handle = serve({ provider: live, port: cfg.httpPort, token: cfg.token });
  console.log(`[bridge] serving playground + ws on http://127.0.0.1:${handle.port}  (Ableton ${cfg.host}:${cfg.sendPort}/${cfg.recvPort})`);
  if (cfg.dialUrl) {
    const { dialHome } = await import("./daemon/dial-home");
    dialHome({ provider: live, url: cfg.dialUrl, token: cfg.token });
    console.log(`[bridge] dialing home → ${cfg.dialUrl}`);
  }
}

function clientFor(cfg: BridgeConfig): AbletonBridgeClient {
  const url = `ws://127.0.0.1:${cfg.httpPort}/ws`;
  return new AbletonBridgeClient(url, { token: cfg.token, WebSocketImpl: WebSocket as unknown as WebSocketCtor, autoReconnect: true });
}

async function runRepl(cfg: BridgeConfig): Promise<void> {
  const client = clientFor(cfg);
  await client.connect();
  console.log("ableton-osc-bridge REPL. Type an address (query) or `send <addr> [args]`. Ctrl-D to exit.");
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: ">>> " });
  rl.prompt();
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      const parts = trimmed.split(/\s+/);
      const isSend = parts[0] === "send";
      const address = isSend ? parts[1] : parts[0];
      const args = (isSend ? parts.slice(2) : parts.slice(1)).map((x) => (isNaN(Number(x)) ? x : Number(x)));
      try {
        if (isSend) { client.send(address, args); console.log("(sent)"); }
        else console.log(JSON.stringify(await client.query(address, args)));
      } catch (err) { console.error("error:", (err as Error).message); }
    }
    rl.prompt();
  });
  rl.on("close", () => { client.close(); process.exit(0); });
}

async function runPing(cfg: BridgeConfig): Promise<void> {
  const client = clientFor(cfg);
  await client.connect();
  client.send("/live/test");
  try { console.log("tempo:", await client.query("/live/song/get/tempo")); }
  catch (err) { console.error("no reply (is the daemon serving and Ableton running?):", (err as Error).message); }
  client.close();
}

export async function main(argv: string[]): Promise<void> {
  const cfg = readConfig(process.env);
  const cmd = argv[2] ?? "serve";
  if (cmd === "serve") await runServe(cfg);
  else if (cmd === "repl") await runRepl(cfg);
  else if (cmd === "test") await runPing(cfg);
  else { console.error(`unknown command: ${cmd} (use: serve | repl | test)`); process.exit(1); }
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv);
}
