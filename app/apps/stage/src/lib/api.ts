import type { SurveyResponse, VisitorProfile, PoseVector, Station, DispatchState } from "@channelers/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const post = <T>(url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    // Only declare a JSON body when we actually send one — a bare
    // content-type: application/json with an empty body makes Fastify
    // reject the request (FST_ERR_CTP_EMPTY_JSON_BODY).
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<T>(r));

export const api = {
  listVisitors: () => fetch("/api/visitors").then((r) => json<VisitorProfile[]>(r)),
  register: (number: number) => post<VisitorProfile>("/api/register", { number }),
  getByNumber: (number: number) =>
    fetch(`/api/visitors/by-number/${number}`).then((r) => json<VisitorProfile>(r)),
  submitIntake: (id: string, survey: SurveyResponse) =>
    post<VisitorProfile>(`/api/visitors/${id}/intake`, { survey }),
  enrollPose: (id: string, template: PoseVector) =>
    post<VisitorProfile>(`/api/visitors/${id}/pose`, { template }),
  setPersona: (id: string, archetype: string) =>
    post<VisitorProfile>(`/api/visitors/${id}/persona`, { archetype }),
  verifyPose: (id: string) => post<VisitorProfile>(`/api/visitors/${id}/verify`),
  checkin: (number: number, station: Station) =>
    post<{ record: VisitorProfile; superseded: number[] }>("/api/checkin", { number, station }),
  dispatch: {
    state: () => fetch("/api/dispatch").then((r) => json<DispatchState>(r)),
    confirm: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/confirm", { visitorId }),
    assign: (visitorId: string, station: Station) =>
      post<{ ok: boolean }>("/api/dispatch/assign", { visitorId, station }),
    recall: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/recall", { visitorId }),
    repool: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/repool", { visitorId }),
    complete: (visitorId: string, station: Station) =>
      post<{ ok: boolean }>("/api/dispatch/complete", { visitorId, station }),
    remove: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/remove", { visitorId }),
  },
};
