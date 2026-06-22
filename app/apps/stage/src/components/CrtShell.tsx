import "../styles/crt.css";
import type { ReactNode } from "react";
import { useCrtFx } from "../lib/useCrtFx";

/**
 * The CRT vessel: vaporwave void + always-on static + toggleable scanline/curvature
 * post-processing, with a title-safe centre for `children` and a bezel status line.
 * Shared frame for every /intake state (standby · called · form · processed).
 */
export function CrtShell({
  children,
  statusLabel = "TERMINAL 1",
}: {
  children: ReactNode;
  statusLabel?: string;
}) {
  const { fx, toggle } = useCrtFx();
  return (
    <div className="crt" data-crt-fx={fx ? "on" : "off"}>
      <div className="crt-static" aria-hidden />
      <div className="crt-scanlines" aria-hidden />
      <div className="crt-safe">{children}</div>
      <div className="crt-curve" aria-hidden />
      <div className="crt-bezel">
        <span className="crt-led" aria-hidden /> {statusLabel}
        <button
          type="button"
          className="crt-fx-toggle"
          aria-pressed={fx}
          onClick={toggle}
          title="Toggle CRT effects"
        >
          CRT
        </button>
      </div>
    </div>
  );
}
