import { useState } from "react";
import type { VisitorProfile } from "@channelers/shared";
import { api } from "../lib/api";

/** The shared "enter your number" gate. Registers (create-or-fetch) and hands the
 *  resolved record up. Used by /intake, /bodyscan, and /altar (spec §3–§4). */
export function NumberGate({
  title,
  onResolved,
}: {
  title: string;
  onResolved: (visitor: VisitorProfile) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Enter the number on your ticket.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onResolved(await api.register(n));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="void form">
      <h1>{title}</h1>
      <section className="field">
        <label>Enter your number</label>
        <input
          inputMode="numeric"
          autoFocus
          value={value}
          placeholder="000"
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
        />
      </section>
      {error && <p className="error">{error}</p>}
      <button className="submit" onClick={() => void go()} disabled={busy || !value}>
        {busy ? "…" : "Continue"}
      </button>
    </main>
  );
}
