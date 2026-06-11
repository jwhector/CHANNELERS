import type { VibeAxis } from "./schemas";

/**
 * The intake survey, transcribed from docs/intake.md. This is content the team will
 * keep editing — it drives the /intake form directly so there's one source of truth.
 */
export type SurveyField =
  | { kind: "text"; id: string; label: string; placeholder?: string }
  | { kind: "longtext"; id: string; label: string; placeholder?: string }
  | { kind: "phrase"; axis: VibeAxis; label: string; options: string[] }
  | { kind: "scan"; station: "pose" | "fiducial"; label: string; instruction: string }
  | { kind: "oracle"; label: string; instruction: string };

export const SURVEY: SurveyField[] = [
  { kind: "text", id: "name", label: "Name" },
  { kind: "longtext", id: "tender", label: "Do you consider yourself tender? Describe below:" },
  { kind: "text", id: "shoeSize", label: "What is your shoe size?" },
  { kind: "longtext", id: "lost", label: "Describe something you recently lost" },
  { kind: "text", id: "ssn", label: "Provide your social security number", placeholder: "###-##-####" },
  {
    kind: "phrase",
    axis: "vulnerability",
    label: "Choose one phrase that describes a close relationship you are in — State of vulnerability",
    options: ["Basement Riser", "Moody Sky", "Artistic Facts"],
  },
  {
    kind: "phrase",
    axis: "tension",
    label: "Choose a secondary phrase for the same relationship — State of Tension",
    options: ["Hard Times", "Legendary Emulation", "Sync Wheel"],
  },
  {
    kind: "phrase",
    axis: "hopefulness",
    label: "Choose a tertiary phrase for the same relationship — State of hopefulness",
    options: ["Heavenly Sky", "Night Drive", "Underwater"],
  },
  {
    kind: "scan",
    station: "pose",
    label: "Physical Challenge",
    instruction: "Proceed to the scanning station and take the shape of your spirit animal for processing.",
  },
  {
    kind: "scan",
    station: "fiducial",
    label: "Physical Challenge",
    instruction: "Proceed to the next scanning station and place the images in their correct place.",
  },
  {
    kind: "oracle",
    label: "Choose your oracle",
    instruction: "Select the entity that will divine your future today.",
  },
];
