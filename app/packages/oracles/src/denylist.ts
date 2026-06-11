/** Phrases and tics that mark the generic "helpful assistant" register. The Oracles never use these. */
export const ANTI_SLOP: string[] = [
  "As an AI",
  "I'm just an AI",
  "I cannot",
  "it's important to note",
  "it's important to remember",
  "delve",
  "tapestry",
  "navigate the complexities",
  "in conclusion",
  "I hope this helps",
  "let me know if",
  "on the other hand",
  "ultimately",
];

export const ANTI_SLOP_INSTRUCTION =
  "Never break character. Never mention being an AI, a model, or a language system. " +
  "No hedging, no disclaimers, no balanced 'on one hand / on the other' summaries, " +
  "no bulleted lists, no offers to help. Never use these phrases: " +
  ANTI_SLOP.map((p) => `"${p}"`).join(", ") +
  ".";
