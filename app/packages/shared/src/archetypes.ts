/**
 * The Oracle menu. The `id`s MUST match the keys in
 * packages/oracles/src/personas.ts (kept in sync by hand for now).
 * `blurb` is the short visitor-facing description shown in the intake picker.
 */
export const ARCHETYPES = [
  {
    id: "child",
    label: "The Child",
    blurb: "",
  },
  {
    id: "tree",
    label: "The Tree",
    blurb: "",
  },
  {
    id: "drugged_ai",
    label: "Stoned Senior",
    blurb: "",
  },
] as const;

export type ArchetypeId = (typeof ARCHETYPES)[number]["id"];
