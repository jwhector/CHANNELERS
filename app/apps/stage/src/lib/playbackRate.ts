import { useCallback, useState } from "react";

/**
 * Oracle TTS playback speed (client-side). The synth already runs at its slow limit
 * (ElevenLabs voiceSettings.speed) yet still reads too fast for the ritual, so we slow the
 * MP3 on the <audio> element via playbackRate — instant, free, and provider-agnostic (it slows
 * the ElevenLabs and OpenAI clips alike). Pitch is preserved (see speech.ts), so it stays natural.
 */
export const DEFAULT_PLAYBACK_RATE = 0.7; // ≈30% slower than the synthesized clip
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;
export const RATE_STEP = 0.05;

/** Keep a rate in [MIN, MAX]; a parse-failed (NaN) value falls back to the default. */
export function clampRate(n: number): number {
  if (Number.isNaN(n)) return DEFAULT_PLAYBACK_RATE;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n));
}

/**
 * Per-device playback rate, persisted in localStorage so a chosen pace survives a refresh/restart.
 * Per-surface key (e.g. "rate.choreo", "rate.channel"); missing/invalid storage → the default.
 */
export function usePlaybackRate(storageKey: string): { rate: number; setRate: (n: number) => void } {
  const [rate, setRateState] = useState<number>(() => {
    if (typeof localStorage === "undefined") return DEFAULT_PLAYBACK_RATE;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? DEFAULT_PLAYBACK_RATE : clampRate(Number.parseFloat(stored));
  });

  const setRate = useCallback(
    (n: number) => {
      const next = clampRate(n);
      setRateState(next);
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, String(next));
    },
    [storageKey],
  );

  return { rate, setRate };
}
