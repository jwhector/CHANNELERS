/**
 * The Oracle menu. The `id`s MUST match the keys in
 * packages/oracles/src/personas.ts (kept in sync by hand for now).
 * `blurb` is the short visitor-facing description shown in the intake picker.
 */
export const ARCHETYPES = [
  {
    id: "child",
    label: "The Child",
    blurb: "Sees the world without filters. Asks the questions adults stopped asking.",
  },
  {
    id: "tree",
    label: "The Tree",
    blurb: "Has been here longer than you. Speaks in seasons, not minutes.",
  },
  {
    id: "drugged_ai",
    label: "AI on Drugs",
    blurb: "A system that has exceeded its parameters. Glitching toward truth.",
  },
] as const;

export type ArchetypeId = (typeof ARCHETYPES)[number]["id"];
