import { DEFAULT_TUNING, type OracleTuning } from "@channelers/shared";
import type { Bus } from "./bus";

/**
 * The live Altered-State tuning — one global config (mixing-desk model) the oracle loop and the
 * intake transform read on every call. Edited from the `/channel` console over the WS bus.
 *
 * Kept off the ShowEvent/OSC contract (like dispatcher logistics): it rides its own
 * `tuning.set` (client) / `tuning.state` (server) WS messages.
 */
let current: OracleTuning = DEFAULT_TUNING;

/** Read the current tuning. Divination + transform call this per request. */
export function getTuning(): OracleTuning {
  return current;
}

/** Wire the bus: sync joiners with current state, and store + rebroadcast operator edits. */
export function registerTuning(bus: Bus): void {
  bus.onConnect((reply) => reply({ kind: "tuning.state", tuning: current }));
  bus.onCommand((cmd) => {
    if (cmd.kind !== "tuning.set") return; // fan-out: ignore commands we don't own
    current = cmd.tuning; // already zod-validated by the bus on arrival
    bus.broadcast({ kind: "tuning.state", tuning: current });
  });
}
