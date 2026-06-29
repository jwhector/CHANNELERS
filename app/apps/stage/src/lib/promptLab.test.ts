import { describe, it, expect } from "vitest";
import { SURVEY, type SurveyField } from "@channelers/shared";
import { emptyForm, formToSurvey, surveyToForm, randomFill } from "./promptLab";

/** A deterministic "rand" stand-in: cycles a fixed sequence so tests are reproducible. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("emptyForm", () => {
  it("has an entry for every survey field and an empty name", () => {
    const form = emptyForm();
    expect(form.name).toBe("");
    for (const f of SURVEY) expect(form.values[f.id]).toBe("");
  });
});

describe("formToSurvey", () => {
  it("wraps the form into a SurveyResponse with empty phrases", () => {
    const form = { name: "9001", values: { broughtYou: "curiosity", shoeSize: "10" } };
    const survey = formToSurvey(form);
    expect(survey).toEqual({ name: "9001", freeText: { broughtYou: "curiosity", shoeSize: "10" }, phrases: [] });
  });
});

describe("surveyToForm <-> formToSurvey round-trip", () => {
  it("preserves name and values across a round-trip", () => {
    const form = emptyForm();
    form.name = "9042";
    form.values.broughtYou = "I was sent";
    form.values.weekMood = "Moody Sky";
    const back = surveyToForm(formToSurvey(form));
    expect(back).toEqual(form);
  });

  it("keeps freeText keys that are not in the field list (override of legacy data)", () => {
    const survey = { name: "7", freeText: { broughtYou: "x", legacyField: "kept" }, phrases: [] };
    const form = surveyToForm(survey);
    expect(form.values.legacyField).toBe("kept");
    expect(form.values.broughtYou).toBe("x");
    // round-trips back without losing the legacy key
    expect(formToSurvey(form).freeText.legacyField).toBe("kept");
  });
});

describe("randomFill", () => {
  const fields = SURVEY;
  const form = randomFill(fields, seq([0.0, 0.33, 0.5, 0.66, 0.99, 0.2, 0.8]), "9100");

  it("uses the supplied name", () => {
    expect(form.name).toBe("9100");
  });

  it("fills every field with a non-empty value", () => {
    for (const f of fields) expect(form.values[f.id]).not.toBe("");
  });

  it("picks single-choice values from the field's options", () => {
    for (const f of fields as SurveyField[]) {
      if (f.kind === "single") expect(f.options).toContain(form.values[f.id]);
    }
  });

  it("keeps scale values as an integer inside the field's range", () => {
    for (const f of fields as SurveyField[]) {
      if (f.kind === "scale") {
        const n = Number(form.values[f.id]);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(f.min);
        expect(n).toBeLessThanOrEqual(f.max);
      }
    }
  });

  it("picks multi values from options, within the max, all distinct", () => {
    for (const f of fields as SurveyField[]) {
      if (f.kind === "multi") {
        const chosen = form.values[f.id].split(", ").filter(Boolean);
        expect(chosen.length).toBeGreaterThanOrEqual(1);
        if (f.max) expect(chosen.length).toBeLessThanOrEqual(f.max);
        expect(new Set(chosen).size).toBe(chosen.length);
        for (const c of chosen) expect(f.options).toContain(c);
      }
    }
  });

  it("is deterministic for a given rand sequence", () => {
    const a = randomFill(fields, seq([0.1, 0.7, 0.4]), "9");
    const b = randomFill(fields, seq([0.1, 0.7, 0.4]), "9");
    expect(a).toEqual(b);
  });
});
