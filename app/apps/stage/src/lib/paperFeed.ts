import type { WsServerMsg } from "@channelers/shared";

/** Pure selector: the fed page's text from a paper.fed event, else null. */
export function paperFedText(m: WsServerMsg): string | null {
  return m.kind === "event" && m.event.type === "paper.fed" ? m.event.text : null;
}

/** Grab a single still frame from a live <video> as a JPEG data URL. Null until the stream has dimensions. */
export function captureDataUrl(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  // Quality 0.92 (not the usual ~0.85): JPEG ringing around glyph edges costs OCR accuracy, and a
  // single still page is cheap to send at higher fidelity.
  return canvas.toDataURL("image/jpeg", 0.92);
}
