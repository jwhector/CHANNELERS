import { expect, test } from "vitest";
import { paperFedText } from "./paperFeed";

test("returns the text for a paper.fed event", () => {
  const out = paperFedText({ kind: "event", event: { type: "paper.fed", text: "burn it", fedAt: "t" } });
  expect(out).toBe("burn it");
});

test("ignores other event types and message kinds", () => {
  expect(paperFedText({ kind: "event", event: { type: "divination.started", profileId: "p" } })).toBeNull();
  expect(paperFedText({ kind: "hello" })).toBeNull();
});
