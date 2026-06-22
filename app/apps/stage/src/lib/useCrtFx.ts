import { useCallback, useState } from "react";

const KEY = "channelers.crt";

/** Initial CRT-FX state: `?crt=off` forces off; else persisted choice; else on. */
function initial(): boolean {
  if (new URLSearchParams(location.search).get("crt") === "off") return false;
  return localStorage.getItem(KEY) !== "off";
}

/**
 * Toggle for the simulated-CRT post-processing layer (scanlines/curvature/flicker).
 * Default ON so it reads right on a dev LCD; flip OFF on the real tube to avoid
 * doubling its native scanlines. Choice persists; `?crt=off` is a hard override.
 */
export function useCrtFx(): { fx: boolean; toggle: () => void } {
  const [fx, setFx] = useState(initial);
  const toggle = useCallback(() => {
    setFx((on) => {
      const next = !on;
      localStorage.setItem(KEY, next ? "on" : "off");
      return next;
    });
  }, []);
  return { fx, toggle };
}
