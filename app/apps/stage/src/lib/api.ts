import type { SurveyResponse, VisitorProfile, Seeds } from "@channelers/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  listVisitors: () => fetch("/api/visitors").then((r) => json<VisitorProfile[]>(r)),
  submitSurvey: (survey: SurveyResponse) =>
    fetch("/api/visitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(survey),
    }).then((r) => json<VisitorProfile>(r)),
  generateSeeds: (id: string) =>
    fetch(`/api/visitors/${id}/seeds`, { method: "POST" }).then((r) => json<Seeds>(r)),
};
