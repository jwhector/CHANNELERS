import type { SurveyResponse, VisitorProfile, PoseVector, Station, DispatchState, ChoreoConfig } from "@channelers/shared";

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
  /** Paper station: send a captured page (data: URL) → OCR → emits paper.fed. Identity-agnostic. */
  feedPaper: (image: string) => post<{ text: string; fedAt: string }>("/api/paper/feed", { image }),
  /** Confirm-at-station arrival (spec §5): called → in_progress for the slot's occupant. */
  arrive: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/arrive", { visitorId }),
  /** Bodyscan kiosk capture (cross-device): brain relays a station.cmd to the kiosk holding the camera. */
  captureBodyscan: (visitorId: string) => post<{ ok: boolean }>("/api/bodyscan/capture", { visitorId }),
  checkin: (number: number, station: Station) =>
    post<{ record: VisitorProfile }>("/api/checkin", { number, station }),
  dispatch: {
    state: () => fetch("/api/dispatch").then((r) => json<DispatchState>(r)),
    confirm: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/confirm", { visitorId }),
    assign: (visitorId: string, slotId: string) =>
      post<{ ok: boolean }>("/api/dispatch/assign", { visitorId, slotId }),
    repool: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/repool", { visitorId }),
    complete: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/complete", { visitorId }),
    remove: (visitorId: string) => post<{ ok: boolean }>("/api/dispatch/remove", { visitorId }),
    altar: (open: boolean) =>
      post<{ ok: boolean; altarOpen: boolean }>("/api/dispatch/altar", { open }),
  },
  choreo: {
    config: () => fetch("/api/choreo/config").then((r) => json<ChoreoConfig>(r)),
    setConfig: (cfg: ChoreoConfig) => post<ChoreoConfig>("/api/choreo/config", cfg),
  },
};
