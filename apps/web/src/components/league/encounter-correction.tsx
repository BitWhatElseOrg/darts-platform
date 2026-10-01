"use client";

import { Control } from "@darts-platform/ui";
import { useState } from "react";

export interface EncounterCorrectionProps {
  /** Eindeutig je Slot -- mehrere Zeilen der Spielliste tragen das Feld gleichzeitig. */
  readonly slotId: string;
  readonly busy: boolean;
  readonly onCorrect: (slotId: string, reason: string) => void;
}

/**
 * «Resultat korrigieren» für ein gespieltes Spiel einer abgeschlossenen
 * Begegnung (Spec 2026-10-01-liga-resultatkorrektur §4). Muster:
 * `apps/web/src/components/tournament/results-panel.tsx` (Turnier-Pendant).
 * Das Feld «Korrekturgrund» wird nur im offenen Zustand gemountet.
 */
export function EncounterCorrection({ busy, onCorrect, slotId }: EncounterCorrectionProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <Control
        density="tight"
        disabled={busy}
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
        variant="wire"
      >
        Resultat korrigieren
      </Control>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className="font-plate text-caption font-semibold uppercase tracking-[0.12em] text-sisal-500"
        htmlFor={`encounter-correction-${slotId}`}
      >
        Korrekturgrund
      </label>
      <textarea
        className="min-h-20 border border-sisal-400 bg-sisal-50 p-3 font-plate text-body text-wedge-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
        id={`encounter-correction-${slotId}`}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        placeholder="z. B. Aufnahme falsch erfasst"
        value={reason}
      />
      <div className="flex flex-wrap gap-2">
        <Control
          density="tight"
          disabled={busy || reason.trim().length < 3}
          onClick={() => onCorrect(slotId, reason.trim())}
          variant="plate"
        >
          Korrektur starten
        </Control>
        <Control density="tight" disabled={busy} onClick={() => setOpen(false)} variant="wire">
          Abbrechen
        </Control>
      </div>
      <p className="font-plate text-caption text-sisal-500">
        Das Spiel öffnet sich auf seiner Scheibe mit zurückgenommener letzter Aufnahme und wird neu
        gescort.
      </p>
    </div>
  );
}
