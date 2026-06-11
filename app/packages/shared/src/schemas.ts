import { z } from "zod";

/** The three "vibe phrase" axes from the intake survey. */
export const VibeAxis = z.enum(["vulnerability", "tension", "hopefulness"]);
export type VibeAxis = z.infer<typeof VibeAxis>;

export const VibePhrase = z.object({
  axis: VibeAxis,
  choice: z.string(),
});
export type VibePhrase = z.infer<typeof VibePhrase>;

/** A completed intake survey. `freeText` holds the absurdist open answers keyed by field id. */
export const SurveyResponse = z.object({
  name: z.string().min(1),
  freeText: z.record(z.string(), z.string()),
  phrases: z.array(VibePhrase),
  /** The oracle archetype the visitor chose during intake. */
  archetype: z.string().optional(),
});
export type SurveyResponse = z.infer<typeof SurveyResponse>;

/** Result of a body-scanning station (see ARCHITECTURE.md §6). */
export const PoseScan = z.object({
  kind: z.literal("pose"),
  archetypeGuess: z.string(),
  keypoints: z.array(z.array(z.number())),
  confidence: z.number(),
});
export const FiducialScan = z.object({
  kind: z.literal("fiducial"),
  cards: z.array(z.object({ id: z.number(), slot: z.number() })),
});
export const ScanResult = z.discriminatedUnion("kind", [PoseScan, FiducialScan]);
export type ScanResult = z.infer<typeof ScanResult>;

export const VisitorProfile = z.object({
  id: z.string(),
  survey: SurveyResponse,
  scans: z.array(ScanResult),
  createdAt: z.string(),
});
export type VisitorProfile = z.infer<typeof VisitorProfile>;

/** ── Generated seeds (intake → AI transform output) ── */

export const MusicSeed = z.object({
  mood: z.string(),
  tempoBpm: z.number(),
  key: z.string(),
  lyricThemes: z.array(z.string()),
  synthPalette: z.array(z.string()),
});
export type MusicSeed = z.infer<typeof MusicSeed>;

export const DanceScore = z.object({
  qualities: z.array(z.string()),
  spatial: z.string(),
  spiritAnimalShape: z.string(),
  cues: z.array(z.string()),
});
export type DanceScore = z.infer<typeof DanceScore>;

export const OraclePersona = z.object({
  archetype: z.string(),
  systemPrompt: z.string(),
  openingLine: z.string(),
});
export type OraclePersona = z.infer<typeof OraclePersona>;

export const Seeds = z.object({
  music: MusicSeed,
  dance: DanceScore,
  persona: OraclePersona,
});
export type Seeds = z.infer<typeof Seeds>;
