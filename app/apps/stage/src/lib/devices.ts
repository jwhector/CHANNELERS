import { useCallback, useEffect, useState } from "react";

export type DeviceKind = "audiooutput" | "videoinput";

/** True when the browser can route an <audio> element to a chosen output device. */
export function canRouteAudio(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** enumerateDevices() filtered to one kind. Labels are blank until permission is granted. */
export async function listDevices(kind: DeviceKind): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === kind);
}

/** Grant the matching permission so enumerateDevices() returns labels, then drop the stream. */
export async function unlockLabels(kind: DeviceKind): Promise<void> {
  const constraints = kind === "videoinput" ? { video: true } : { audio: true };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  stream.getTracks().forEach((t) => t.stop());
}

/**
 * Resolve a deviceId: URL param (label substring, case-insensitive) wins, then the per-tab
 * stored choice (if still present, or if labels aren't loaded yet), else "" (system default).
 */
export function resolveDeviceId(
  urlValue: string | null,
  stored: string | null,
  devices: MediaDeviceInfo[],
): string {
  if (urlValue) {
    const hit = devices.find((d) => d.label.toLowerCase().includes(urlValue.toLowerCase()));
    if (hit) return hit.deviceId;
  }
  if (stored && (devices.length === 0 || devices.some((d) => d.deviceId === stored))) return stored;
  return "";
}

/**
 * Enumerate + persist a chosen output/camera device. Resolution order (see resolveDeviceId):
 * URL param (?out= / ?cam=, label substring) → per-tab sessionStorage → "" (system default).
 * Per-tab so each performer window keeps its own output, matching the kiosk-identity precedent.
 */
export function useDevices(kind: DeviceKind, storageKey: string, urlParam: string) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setId] = useState<string>("");
  const [needsPermission, setNeedsPermission] = useState(true);

  const refresh = useCallback(async () => {
    const list = await listDevices(kind);
    setDevices(list);
    setNeedsPermission(list.length === 0 || list.every((d) => !d.label));
    const url = new URLSearchParams(window.location.search).get(urlParam);
    const stored = sessionStorage.getItem(storageKey);
    setId((cur) => cur || resolveDeviceId(url, stored, list));
  }, [kind, storageKey, urlParam]);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [refresh]);

  const setDeviceId = useCallback(
    (id: string) => {
      setId(id);
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    },
    [storageKey],
  );

  const enableLabels = useCallback(async () => {
    try {
      await unlockLabels(kind);
    } finally {
      await refresh();
    }
  }, [kind, refresh]);

  return { devices, deviceId, setDeviceId, needsPermission, enableLabels, refresh };
}
