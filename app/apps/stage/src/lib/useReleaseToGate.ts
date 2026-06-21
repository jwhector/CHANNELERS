import { useEffect, useRef } from "react";
import type { Slot, VisitorProfile } from "@channelers/shared";

/**
 * Fire onRelease() when we hold a visitor but the slot's occupant is no longer
 * that visitor in_progress — i.e. the dispatcher released/re-pooled/reassigned
 * the slot — UNLESS suppress is set (the work UI is showing its own done screen).
 */
export function useReleaseToGate(
  visitor: VisitorProfile | null,
  slot: Slot | undefined,
  suppress: boolean,
  onRelease: () => void,
): void {
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  useEffect(() => {
    if (!visitor || suppress) return;
    const occupantIsUs =
      slot?.occupant?.visitorId === visitor.id &&
      slot?.occupant?.phase === "in_progress";
    if (!occupantIsUs) onReleaseRef.current();
  }, [visitor, slot?.occupant?.visitorId, slot?.occupant?.phase, suppress]);
}
