"use client";

import { Button } from "@darts-platform/ui";
import type { BoardLockState } from "@/lib/use-board-controller-lock";

/**
 * Statuszeile direkt unter der Kopfzeile: nur bei einem Vorkommnis sichtbar,
 * sonst kostet sie keine Höhe. Reihenfolge bei mehreren gleichzeitigen
 * Vorkommnissen: fremde Board-Steuerung, Offline-Zustand, wartende
 * Aufnahmen, freie Fehlermeldung. Jede Meldung trägt ihren Text selbst —
 * die Farbe ist nie der einzige Kanal.
 *
 * `lockState` folgt `BoardLockState` aus `use-board-controller-lock.ts`
 * (`EIGEN` / `FREMD` / `WIRD_ÜBERNOMMEN`) statt eines eigens erfundenen
 * `UNBEKANNT`: der Hook kennt dieses dritte Wort nicht, und die Statuszeile
 * hat ohnehin nichts zu melden, solange die Steuerung nicht fremd ist.
 */
export function ScoreboardStatus({ lockState, online, queuedCount, message, onTakeOver }: {
  readonly lockState: BoardLockState;
  readonly online: boolean;
  readonly queuedCount: number;
  readonly message: string | null;
  readonly onTakeOver: () => void;
}) {
  const hasIncident = lockState === "FREMD" || !online || queuedCount > 0 || message !== null;
  if (!hasIncident) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2 text-body" role="status">
      {lockState === "FREMD" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-slate-200">
          <span>Ein anderes Gerät steuert dieses Board.</span>
          <Button onClick={onTakeOver} variant="outline">Steuerung übernehmen</Button>
        </div>
      ) : null}
      {!online ? <p className="text-slate-200">Offline · Aufnahmen werden lokal gespeichert.</p> : null}
      {queuedCount > 0 ? (
        <p className="text-amber-300">
          {queuedCount} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.
        </p>
      ) : null}
      {message !== null ? <p className="text-rose-300" role="alert">{message}</p> : null}
    </div>
  );
}
