/**
 * Persists the performer's handle to their current divination session so a page refresh or
 * transient reconnect can re-attach (session.rejoin) instead of stranding the session. The
 * brain owns the session; this is just the key needed to find our way back to it.
 */
const KEY = "channelers.session";

export interface SessionHandle {
  sessionId: string;
  visitorId: string;
}

export function loadHandle(): SessionHandle | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw);
    return typeof h?.sessionId === "string" && typeof h?.visitorId === "string" ? h : null;
  } catch {
    return null;
  }
}

export function saveHandle(h: SessionHandle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* private mode / disabled storage — recovery just won't be available */
  }
}

export function clearHandle(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
