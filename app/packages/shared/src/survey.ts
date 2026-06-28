/** The intake survey, transcribed from docs/intake.md — content the team keeps editing.
 *  Drives /intake directly (one source of truth). Every answer (text, choice, scale,
 *  multi-select) is stored as a string in `SurveyResponse.freeText`, keyed by field id —
 *  single = the chosen option, multi = options joined by ", ", scale = the number.
 *  Scan stations and oracle choice are not part of the form (spec §3–§6). */
export type SurveyField =
  | { kind: "text"; id: string; label: string; placeholder?: string }
  | { kind: "longtext"; id: string; label: string; placeholder?: string }
  /** Pick exactly one option. `allowOther` adds an "Other" choice with a free-text input. */
  | { kind: "single"; id: string; label: string; options: string[]; allowOther?: boolean }
  /** Pick options. `max` caps how many may be selected; `allowOther` adds an "Other" choice. */
  | { kind: "multi"; id: string; label: string; options: string[]; max?: number; allowOther?: boolean }
  /** A 1–N rating with a label anchoring each end of the range. */
  | { kind: "scale"; id: string; label: string; min: number; max: number; minLabel: string; maxLabel: string };

export const SURVEY: SurveyField[] = [
  { kind: "text", id: "birthMonth", label: "Month of Birth" },
  { kind: "text", id: "birthPlace", label: "Location of Birth" },
  { kind: "text", id: "eyeColor", label: "Eye Color" },
  { kind: "text", id: "occupation", label: "Occupation" },
  { kind: "longtext", id: "broughtYou", label: "What brought you here today?" },
  {
    kind: "scale", id: "passiveAggression",
    label: "Rate your level of passive aggressiveness on a scale of 1-5",
    min: 1, max: 5,
    minLabel: "Straight shooter (not passive aggressive at all)",
    maxLabel: "Repressed misfires (very passive)",
  },
  {
    kind: "single", id: "tenderTexture", allowOther: true,
    label: "What is the texture of your tenderness?",
    options: [
      "Crosshatching", "Mic on Teeth", "Popped Bubblewrap",
      "Styrofoam Flaking", "Barnacle", "Frayed rope", "Lego block",
    ],
  },
  { kind: "longtext", id: "knowConfident", label: "What is something you are confident that you know?" },
  { kind: "longtext", id: "dontKnowConfident", label: "What is something that you are confident you don't know?" },
  {
    kind: "single", id: "backupFrequency",
    label: "How often do you currently back up your data?",
    options: ["Continuously", "More than once per day", "Daily", "Weekly", "Less often than weekly", "Never"],
  },
  {
    kind: "single", id: "cryFrequency", allowOther: true,
    label: "How often do you cry?",
    options: ["Continuously", "More than once per day", "Daily", "Weekly", "Less often than weekly", "Never"],
  },
  {
    kind: "multi", id: "relationshipPhrases", max: 3,
    label:
      "Please choose three phrases from below to BEST describe a close relationship you are in " +
      "with either a friend, family member, partner or co-worker",
    options: [
      "Chewing gum", "Legendary Emulation", "Sync Wheel", "Clothespin in Wind",
      "Timing Belt Squeal Song", "Stiletto Lawn Walk", "Dry Lightning",
    ],
  },
  { kind: "text", id: "shoeSize", label: "What is your shoe size?" },
  { kind: "single", id: "broughtWater", label: "Did you bring water?", options: ["Yes", "No"] },
  {
    kind: "text", id: "touchedBodyPart",
    label: "Please touch a body part. Enter what you touched",
    placeholder: "e.g. left earlobe",
  },
  { kind: "longtext", id: "happyMemory", label: "What is a happy memory you have?" },
  { kind: "longtext", id: "aiFeeling", label: "How does AI make you feel?" },
  {
    kind: "single", id: "weekMood",
    label:
      'Please choose one option to complete the sentence — "The mood of my current week could be ' +
      'described as…" (this answer directly affects the sonic landscape of our provided services)',
    options: ["Basement Riser", "Moody Sky", "Disco Love", "Excited Drive"],
  },
  { kind: "longtext", id: "anyQuestion", label: "If you could know the answer to any question, what would it be?" },
];
