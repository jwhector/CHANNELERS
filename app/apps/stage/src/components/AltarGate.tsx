/**
 * Overseer altar gate: toggles whether the dispatcher may send waiting visitors
 * to the altar (the altar is a deferred/batch climax, default closed). Lives on
 * the `/console` master overseer; the lobby `/dispatch` board stays controls-light.
 */
export function AltarGate({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <div className="row">
      <button className={open ? "submit" : "ghost"} onClick={() => onToggle(!open)}>
        Altar: {open ? "OPEN" : "CLOSED"}
      </button>
    </div>
  );
}
