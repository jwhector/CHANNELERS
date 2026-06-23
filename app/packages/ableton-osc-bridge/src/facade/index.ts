import type { VerbProvider } from "../transport";
import { Live } from "./generated";

export * from "./generated";

/** Wrap any VerbProvider (the local core or the network client) in the typed facade. */
export function createLive(provider: VerbProvider): Live {
  return new Live(provider);
}
