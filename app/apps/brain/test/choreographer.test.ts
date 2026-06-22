import { describe, it, expect } from "vitest";
import {
  CHOREO_CLARITY_INSTRUCTION,
  buildChoreoFirstPassPrompt,
  buildChoreoSystemPrompt,
  buildChoreoTurnPrompt,
} from "@channelers/oracles";
import type { SurveyResponse } from "@channelers/shared";

const survey: SurveyResponse = {
  name: "Jo",
  freeText: { lost: "my keys" },
  phrases: [{ axis: "tension", choice: "a held breath" }],
};

describe("choreographer prompts", () => {
  it("first-pass prompt embeds the archetype and the intake facts", () => {
    const { system, user } = buildChoreoFirstPassPrompt(survey, "tree");
    expect(system).toContain("tree");
    expect(user).toContain("my keys");
  });

  it("live system prompt embeds the first pass + the clarity rules", () => {
    const sys = buildChoreoSystemPrompt(survey, "tree", "Enter slowly.");
    expect(sys).toContain("Enter slowly.");
    expect(sys).toContain(CHOREO_CLARITY_INSTRUCTION);
  });

  it("turn prompt includes the oracle reply only when given", () => {
    expect(buildChoreoTurnPrompt({ visitor: "hi" })).not.toContain("oracle replied");
    expect(buildChoreoTurnPrompt({ visitor: "hi", oracle: "sit" })).toContain("oracle replied");
  });
});
