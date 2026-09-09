"use client";

import { useRef, useState } from "react";
import { Control } from "@darts-platform/ui";
import { useDialogFocusReturn } from "./use-dialog-focus-return";

/**
 * Abbruch-Dialog mit Begründungspflicht, aus `match-scoreboard.tsx`
 * herausgezogen (Task 14, Review-Befund 2 — Datei sollte kleiner werden,
 * nicht wachsen). Fokusfang und -rückgabe kommen aus `use-dialog-focus-return.ts`
 * (Review-Befund 3: derselbe Mangel wie im Einstellungs-Modal).
 */
export function AbortMatchDialog({ error, onCancel, onSubmit, open, pending, queuedCount }: {
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSubmit: (reason: string) => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly queuedCount: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocusReturn(dialogRef, open);
  const [reason, setReason] = useState("");

  // Reines Zurücksetzen von Zustand anhand einer geänderten Prop gehört
  // nicht in einen Effect (react-hooks/set-state-in-effect) — angepasst
  // während des Renders, wie an anderer Stelle in `match-scoreboard.tsx`.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason("");
  }

  return (
    <dialog aria-describedby="abort-match-description" aria-labelledby="abort-match-title" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-ring-red/50 bg-sisal-200 p-0 text-chalk shadow-2xl backdrop:bg-sisal-200/80" onCancel={(event) => { event.preventDefault(); onCancel(); }} ref={dialogRef}>
      <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(reason.trim()); }}>
        <div>
          <h4 className="font-numerals text-title font-bold" id="abort-match-title">Match abbrechen</h4>
          <p className="mt-2 text-body text-spider" id="abort-match-description">Alle Aufnahmen und Legs dieses Matches werden unwiderruflich verworfen. {queuedCount} lokal gespeicherte {queuedCount === 1 ? "Aufnahme wird" : "Aufnahmen werden"} verworfen. Das Board wird freigegeben; eine Turnierpaarung wechselt zurück auf READY.</p>
        </div>
        <label className="block space-y-2 text-body font-semibold text-spider">
          <span>Abbruchgrund</span>
          <textarea autoFocus className="min-h-24 w-full rounded-lg border border-sisal-300 bg-sisal-200 p-3 text-base text-chalk outline-none transition focus:border-ring-red focus:ring-2 focus:ring-ring-red-deep/30" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="z. B. falsche Board-Zuweisung" required value={reason} />
        </label>
        {error ? <p className="text-body text-ring-red-deep" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Control disabled={pending} onClick={onCancel} variant="wireInk">Zurück zum Match</Control>
          <Control disabled={pending || reason.trim().length < 3} type="submit" variant="danger">Match endgültig abbrechen</Control>
        </div>
      </form>
    </dialog>
  );
}
