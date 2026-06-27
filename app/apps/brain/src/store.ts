import { randomUUID } from "node:crypto";
import type {
  SurveyResponse, VisitorProfile, ScanResult, Seeds, ChoreoScore, PoseVector, VisitorLocation,
} from "@channelers/shared";

/** In-memory store — fine for the workshop. Swap for SQLite/Postgres if persistence is needed. */
export type VisitorRecord = VisitorProfile & { seeds?: Seeds; choreoFirstPass?: ChoreoScore };

const visitors = new Map<string, VisitorRecord>();
const byNumber = new Map<number, string>(); // number → id index

const now = () => new Date().toISOString();

export const store = {
  /** Create-or-fetch by ticket number. New records are born "waiting" with no survey (spec §3.1). */
  register(number: number): VisitorRecord {
    const existingId = byNumber.get(number);
    if (existingId) {
      const existing = visitors.get(existingId);
      if (existing) return existing;
    }
    const ts = now();
    const record: VisitorRecord = {
      id: randomUUID(),
      number,
      scans: [],
      location: { state: "waiting", since: ts },
      createdAt: ts,
    };
    visitors.set(record.id, record);
    byNumber.set(number, record.id);
    return record;
  },
  get(id: string): VisitorRecord | undefined {
    return visitors.get(id);
  },
  getByNumber(number: number): VisitorRecord | undefined {
    const id = byNumber.get(number);
    return id ? visitors.get(id) : undefined;
  },
  list(): VisitorRecord[] {
    return [...visitors.values()];
  },
  upsertSurvey(id: string, survey: SurveyResponse): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.survey = survey;
    v.intakeAt = now();
    return v;
  },
  setPoseTemplate(id: string, template: PoseVector): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.poseTemplate = template;
    v.poseAt = now();
    return v;
  },
  setArchetype(id: string, archetype: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.archetype = archetype;
    v.personaAt = now();
    return v;
  },
  setPoseVerified(id: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.poseVerifiedAt = now();
    return v;
  },
  setLocation(id: string, location: VisitorLocation): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.location = location;
    return v;
  },
  markSessionStart(id: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.sessionStartAt = now();
    v.sessionEndAt = undefined;
    return v;
  },
  markSessionEnd(id: string): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v.sessionEndAt = now();
    return v;
  },
  setSeeds(id: string, seeds: Seeds): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (v) v.seeds = seeds;
    return v;
  },
  setChoreoFirstPass(id: string, score: ChoreoScore): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (v) v.choreoFirstPass = score;
    return v;
  },
  addScan(id: string, scan: ScanResult): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (v) v.scans.push(scan);
    return v;
  },
  /** Stamp a milestone timestamp directly (operator "mark-complete" backstop, spec §10). */
  stampMilestone(
    id: string,
    field:
      | "intakeAt" | "poseAt" | "personaAt" | "paperAt" | "offeringAt"
      | "poseVerifiedAt" | "sessionStartAt" | "sessionEndAt",
  ): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (!v) return undefined;
    v[field] = now();
    return v;
  },
  /** Remove a record entirely (operator "remove", spec §10). Frees the number for reuse. */
  remove(id: string): boolean {
    const v = visitors.get(id);
    if (!v) return false;
    visitors.delete(id);
    byNumber.delete(v.number);
    return true;
  },
  /** Wipe all records — test isolation only. Do NOT call in production paths. */
  clear(): void {
    visitors.clear();
    byNumber.clear();
  },
};
