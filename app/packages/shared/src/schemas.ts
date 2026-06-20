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

/** A pose reduced to one interior angle per measured joint + a per-joint trust weight.
 *  This is the persisted body-scan "identity token" (see spec §5). Mirrors the stage's
 *  PoseVector in apps/stage/src/lib/pose/angles.ts — keep the two in sync. */
export const PoseVector = z.object({
  angles: z.array(z.number()),
  weights: z.array(z.number()),
});
export type PoseVector = z.infer<typeof PoseVector>;

/** The three dispatchable stations (spec §4). */
export const Station = z.enum(["intake", "bodyscan", "altar"]);
export type Station = z.infer<typeof Station>;

/** Transient dispatch location — a visitor is in exactly one place at a time (spec §3.2).
 *  Tier 1 only ever uses "waiting"/"in_progress"; "called" is Tier 3 (the dispatcher). */
export const VisitorLocation = z.object({
  state: z.enum(["waiting", "called", "in_progress"]),
  station: Station.optional(),
  since: z.string(),
});
export type VisitorLocation = z.infer<typeof VisitorLocation>;

export const VisitorProfile = z.object({
  id: z.string(),
  /** Human ticket number — the cross-station lookup key (spec §3.1). */
  number: z.number().int(),
  /** Present once intake is completed; absent for a just-registered visitor. */
  survey: SurveyResponse.optional(),
  /** Oracle archetype, chosen at the altar (spec §6) — NOT during intake. */
  archetype: z.string().optional(),
  /** Self-invented pose template, enrolled at the body-scan station (spec §5). */
  poseTemplate: PoseVector.optional(),
  /** Legacy scan results (unused by the new flow; kept for back-compat). */
  scans: z.array(ScanResult),
  location: VisitorLocation,
  /** Milestone timestamps (ISO). Present = that milestone is done (spec §3.2). */
  createdAt: z.string(), // = registeredAt
  intakeAt: z.string().optional(),
  poseAt: z.string().optional(),
  personaAt: z.string().optional(),
  poseVerifiedAt: z.string().optional(),
  sessionStartAt: z.string().optional(),
  sessionEndAt: z.string().optional(),
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
