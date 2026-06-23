import { expect, test } from "vitest";
import { initialChoreoFeed, reduceChoreoFeed } from "./choreoFeed";

const delta = (sessionId: string, text: string) => ({ kind: "choreo.delta" as const, sessionId, text });
const done = (sessionId: string, text: string) => ({ kind: "choreo.done" as const, sessionId, text });

/** Fold a sequence of messages, returning the final state. */
function play(msgs: Array<ReturnType<typeof delta> | ReturnType<typeof done>>) {
  return msgs.reduce(reduceChoreoFeed, initialChoreoFeed);
}

test("a single session's deltas accumulate into the cue", () => {
  const s = play([delta("a", "Lower"), delta("a", " your"), delta("a", " gaze.")]);
  expect(s.cue).toBe("Lower your gaze.");
});

test("a completed cue replaces the live text, logs it, and signals to speak", () => {
  const s = play([delta("a", "Lower your"), done("a", "Lower your gaze.")]);
  expect(s.cue).toBe("Lower your gaze.");
  expect(s.log).toEqual([{ sessionId: "a", text: "Lower your gaze." }]);
  expect(s.speak).toEqual({ sessionId: "a", text: "Lower your gaze." });
});

test("concurrent sessions never interleave — the focused session owns the cue", () => {
  // 'a' is adopted first; 'b' streams at the same time but must not garble the line.
  const s = play([
    delta("a", "Reach"),
    delta("b", "Collapse"),
    delta("a", " forward."),
    delta("b", " inward."),
  ]);
  expect(s.cue).toBe("Reach forward."); // pure 'a', no characters of 'b' mixed in
});

test("a background session's done is logged but NOT spoken while another is focused", () => {
  const s = play([
    delta("a", "Reach forward."), // 'a' holds the teleprompter
    done("b", "Collapse inward."), // 'b' finishes in the background
  ]);
  expect(s.cue).toBe("Reach forward."); // active cue undisturbed
  expect(s.speak).toBeNull(); // not voiced — no talking over 'a'
  expect(s.log).toEqual([{ sessionId: "b", text: "Collapse inward." }]); // still recorded
});

test("once the focused session completes, a waiting session takes over the cue", () => {
  const s = play([
    delta("a", "Reach"),
    delta("b", "Collapse"), // buffered silently while 'a' is focused
    done("a", "Reach forward."), // releases the teleprompter
    delta("b", " inward."), // 'b' now adopts, with its buffered text intact
  ]);
  expect(s.cue).toBe("Collapse inward.");
  expect(s.active).toBe("b");
});

test("the log keeps newest-first and is capped at 30", () => {
  const msgs = Array.from({ length: 35 }, (_, i) => done(`s${i}`, `cue ${i}`));
  const s = play(msgs);
  expect(s.log).toHaveLength(30);
  expect(s.log[0]).toEqual({ sessionId: "s34", text: "cue 34" });
});
