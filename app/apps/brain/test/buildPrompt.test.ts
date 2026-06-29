import { describe, expect, test } from "vitest";
import { buildSystemPrompt, PERSONAS } from "@channelers/oracles";
import type { SurveyResponse } from "@channelers/shared";

/** A representative intake: a mix of weighty "confessions" and absurdist form trivia. */
const survey: SurveyResponse = {
  name: "42",
  phrases: [],
  freeText: {
    broughtYou: "my sister made me come",
    knowConfident: "that I locked the door",
    dontKnowConfident: "whether my mother forgives me",
    aiFeeling: "it watches me and I let it",
    happyMemory: "swimming at night as a kid",
    anyQuestion: "will I be okay",
    tenderTexture: "Popped Bubblewrap",
    cryFrequency: "Weekly",
    birthMonth: "March",
    birthPlace: "Cleveland",
    eyeColor: "brown",
    occupation: "dental hygienist",
    shoeSize: "10.5",
    broughtWater: "No",
    touchedBodyPart: "left earlobe",
    backupFrequency: "Never",
    passiveAggression: "4",
    relationshipPhrases: "Chewing gum, Dry Lightning",
    weekMood: "Moody Sky",
  },
};

describe("buildSystemPrompt — intake rendering", () => {
  const prompt = buildSystemPrompt(PERSONAS.child, survey);

  test("keeps the persona voice scaffold", () => {
    expect(prompt).toContain("You are The Child");
    expect(prompt).toContain(PERSONAS.child.fewShot[0]);
  });

  test("renders confessions with human phrasings, not raw field ids", () => {
    expect(prompt).toContain("How AI makes them feel: it watches me and I let it");
    expect(prompt).toContain("Something they're sure they don't know: whether my mother forgives me");
    expect(prompt).not.toContain("aiFeeling");
    expect(prompt).not.toContain("dontKnowConfident");
  });

  test("keeps absurdist trivia as ignorable texture", () => {
    expect(prompt).toContain("Shoe size: 10.5");
    expect(prompt).toContain("Just touched: left earlobe");
  });

  test("instructs an elegant collision across both buckets, not a recital", () => {
    expect(prompt).toContain("at least one");
    expect(prompt).toContain("collide");
    // the old "use it all" instruction and the vestigial phrases line are gone
    expect(prompt).not.toContain("use the visitor's information");
  });

  test("identifies the visitor by ticket number", () => {
    expect(prompt).toContain("ticket #42");
  });
});
