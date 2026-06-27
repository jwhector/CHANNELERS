import { useState, type ReactNode } from "react";
import { Altar } from "./Altar";
import { Channel } from "./Channel";
import { Choreo } from "./Choreo";
import { Console } from "./Console";
import { Dispatch } from "./Dispatch";

type Tab = "altar" | "channel" | "choreo" | "console" | "dispatch";
const TABS: Tab[] = ["altar", "channel", "choreo", "console", "dispatch"];

/**
 * One-device performer shell: altar (entry) · channel (oracle) · choreo (cues) · console (overseer) · dispatch (queue).
 * All regions stay mounted; inactive ones are `hidden` (display:none) so
 * each child's WebSocket, claimed session, and audio never drop on a tab switch —
 * choreo ear-audio keeps playing while the performer is on another tab.
 */
export function PerformShell({
  altar, channel, choreo, console, dispatch,
}: {
  altar: ReactNode;
  channel: ReactNode;
  choreo: ReactNode;
  console: ReactNode;
  dispatch: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("altar");
  const region: Record<Tab, ReactNode> = { altar, channel, choreo, console, dispatch };
  return (
    <div className="perform">
      <nav className="perform-tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "choice on" : "choice"} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {TABS.map((t) => (
        <div key={t} data-tabpanel={t} hidden={t !== tab}>
          {region[t]}
        </div>
      ))}
    </div>
  );
}

export function Perform() {
  return (
    <PerformShell
      altar={<Altar showCamera={false} />}
      channel={<Channel />}
      choreo={<Choreo />}
      console={<Console />}
      dispatch={<Dispatch />}
    />
  );
}
