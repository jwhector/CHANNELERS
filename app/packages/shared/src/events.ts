import { z } from "zod";

/**
 * The show event bus. Every outward-facing thing that happens is one of these,
 * broadcast over WebSocket (to the screens) and OSC (to Anna & Jeff).
 * This union IS the integration contract — ARCHITECTURE.md §8.
 */
export const ShowEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("visitor.submitted"), profileId: z.string() }),
  z.object({ type: z.literal("seeds.ready"), profileId: z.string() }),
  z.object({ type: z.literal("scan.pose"), archetypeGuess: z.string(), confidence: z.number() }),
  z.object({ type: z.literal("scan.fiducial"), cards: z.array(z.number()) }),
  z.object({ type: z.literal("oracle.selected"), profileId: z.string(), archetype: z.string() }),
  z.object({ type: z.literal("divination.started"), profileId: z.string() }),
  z.object({ type: z.literal("divination.ended"), profileId: z.string() }),
  z.object({ type: z.literal("souvenir.minted"), profileId: z.string(), url: z.string() }),
  z.object({ type: z.literal("paper.fed"), text: z.string(), fedAt: z.string() }),
]);
export type ShowEvent = z.infer<typeof ShowEvent>;
export type ShowEventType = ShowEvent["type"];

/** OSC address space — the lingua franca for TouchDesigner / Max / Ableton. */
export const OSC_ADDRESSES: Record<ShowEventType, string> = {
  "visitor.submitted": "/channelers/visitor/submitted",
  "seeds.ready": "/channelers/seeds/ready",
  "scan.pose": "/channelers/scan/pose",
  "scan.fiducial": "/channelers/scan/fiducial",
  "oracle.selected": "/channelers/oracle/selected",
  "divination.started": "/channelers/divination/started",
  "divination.ended": "/channelers/divination/ended",
  "souvenir.minted": "/channelers/souvenir/minted",
  "paper.fed": "/channelers/paper/fed",
};

/** Flatten a ShowEvent into an OSC (address, args) tuple. */
export function toOsc(event: ShowEvent): { address: string; args: Array<string | number> } {
  const address = OSC_ADDRESSES[event.type];
  switch (event.type) {
    case "visitor.submitted":
    case "seeds.ready":
    case "divination.started":
    case "divination.ended":
      return { address, args: [event.profileId] };
    case "scan.pose":
      return { address, args: [event.archetypeGuess, event.confidence] };
    case "scan.fiducial":
      return { address, args: event.cards };
    case "oracle.selected":
      return { address, args: [event.profileId, event.archetype] };
    case "souvenir.minted":
      return { address, args: [event.profileId, event.url] };
    case "paper.fed":
      return { address, args: [event.text, event.fedAt] };
  }
}
