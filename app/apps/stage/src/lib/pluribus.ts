import { isAltarReady, type DispatchReady, type VisitorProfile } from "@channelers/shared";

/** Numbers of altar-ready visitors (completed the pre-altar stations, waiting), ascending. */
export function altarReadyNumbers(visitors: VisitorProfile[]): number[] {
  return visitors
    .filter(isAltarReady)
    .map((v) => v.number)
    .sort((a, b) => a - b);
}

/** Same set, from the dispatcher's already-filtered altar-ready list (DispatchState.altarReadyList). */
export function readyNumbers(ready: DispatchReady[]): number[] {
  return ready.map((r) => r.number).sort((a, b) => a - b);
}

/** Join numbers for natural speech: [3]→"3", [3,7]→"3 and 7", [3,7,12]→"3, 7, and 12". */
export function formatNumberList(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  if (numbers.length === 2) return `${numbers[0]} and ${numbers[1]}`;
  return `${numbers.slice(0, -1).join(", ")}, and ${numbers[numbers.length - 1]}`;
}

/** The Pluribus broadcast line for the given visitor numbers (caller ensures non-empty). */
export function buildPluribusBroadcast(numbers: number[]): string {
  const word = numbers.length === 1 ? "USER" : "USERS";
  return `INCOMING BROADCAST - PREPARE FOR PLURIBUS: 3... 2... 1... ${word} ${formatNumberList(numbers)}, YOU HAVE COMPLETED THE STATIONING PROCESS`;
}
