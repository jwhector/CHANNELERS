import type { VerbProvider, Subscription } from "../transport";
import { parseClientMessage, type ServerMessage } from "../protocol";

/** Transport-agnostic view of one bidirectional connection (a WS socket, in practice). */
export interface Conn {
  send(msg: ServerMessage): void;
  onMessage(cb: (raw: string) => void): void;
  onClose(cb: () => void): void;
}

/**
 * Wire one connection to the shared provider: translate the id-based wire protocol
 * to/from the provider's verbs. Subscriptions are per-connection and reaped on close.
 */
export function attachConnection(provider: VerbProvider, conn: Conn): void {
  const subs = new Map<string, Subscription>();
  conn.send({ kind: "hello" });

  conn.onMessage((raw) => {
    const msg = parseClientMessage(raw);
    if (!msg) {
      conn.send({ kind: "error", message: "malformed message" });
      return;
    }
    switch (msg.kind) {
      case "send":
        provider.send(msg.address, msg.args);
        break;
      case "query":
        provider
          .query(msg.address, msg.args, msg.timeoutMs)
          .then((args) => conn.send({ kind: "reply", id: msg.id, args }))
          .catch((err: Error) => conn.send({ kind: "error", id: msg.id, message: err.message }));
        break;
      case "subscribe": {
        const subId = msg.subId;
        const subscription = provider.subscribe(msg.address, msg.args, (args) => {
          // Guard against late callbacks after teardown: only forward while the
          // subscription is still active for this connection.
          if (subs.has(subId)) conn.send({ kind: "event", subId, address: msg.address, args });
        });
        subs.set(subId, subscription);
        break;
      }
      case "unsubscribe": {
        subs.get(msg.subId)?.unsubscribe();
        subs.delete(msg.subId);
        break;
      }
    }
  });

  conn.onClose(() => {
    for (const s of subs.values()) s.unsubscribe();
    subs.clear();
  });
}
