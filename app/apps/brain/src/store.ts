import { randomUUID } from "node:crypto";
import type { SurveyResponse, VisitorProfile, ScanResult, Seeds } from "@channelers/shared";

/** In-memory store — fine for the workshop. Swap for SQLite/Postgres if persistence is needed. */
export type VisitorRecord = VisitorProfile & { seeds?: Seeds };

const visitors = new Map<string, VisitorRecord>();

export const store = {
  create(survey: SurveyResponse): VisitorRecord {
    const profile: VisitorRecord = {
      id: randomUUID(),
      survey,
      scans: [],
      createdAt: new Date().toISOString(),
    };
    visitors.set(profile.id, profile);
    return profile;
  },
  get(id: string): VisitorRecord | undefined {
    return visitors.get(id);
  },
  list(): VisitorRecord[] {
    return [...visitors.values()];
  },
  addScan(id: string, scan: ScanResult): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (v) v.scans.push(scan);
    return v;
  },
  setSeeds(id: string, seeds: Seeds): VisitorRecord | undefined {
    const v = visitors.get(id);
    if (v) v.seeds = seeds;
    return v;
  },
};
