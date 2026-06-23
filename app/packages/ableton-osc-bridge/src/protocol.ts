import { z } from "zod";

export const OscArgZ = z.union([z.string(), z.number()]);

/** client → daemon */
export const ClientMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("send"), id: z.string(), address: z.string(), args: z.array(OscArgZ).default([]) }),
  z.object({ kind: z.literal("query"), id: z.string(), address: z.string(), args: z.array(OscArgZ).default([]), timeoutMs: z.number().optional() }),
  z.object({ kind: z.literal("subscribe"), id: z.string(), subId: z.string(), address: z.string(), args: z.array(OscArgZ).default([]) }),
  z.object({ kind: z.literal("unsubscribe"), id: z.string(), subId: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** daemon → client */
export const ServerMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello") }),
  z.object({ kind: z.literal("reply"), id: z.string(), args: z.array(OscArgZ) }),
  z.object({ kind: z.literal("event"), subId: z.string(), address: z.string(), args: z.array(OscArgZ) }),
  z.object({ kind: z.literal("error"), id: z.string().optional(), message: z.string() }),
  z.object({ kind: z.literal("status"), ableton: z.enum(["up", "down"]) }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Safe-parse a raw WS string into a ClientMessage, or null. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessage.safeParse(json);
  return result.success ? result.data : null;
}
