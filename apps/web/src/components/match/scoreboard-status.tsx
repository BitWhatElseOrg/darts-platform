"use client";

import { Button, cn } from "@darts-platform/ui";
import type { BoardLockState } from "@/lib/use-board-controller-lock";

/**
 * Statuszeile direkt unter der Kopfzeile: nur bei einem Vorkommnis sichtbar,
 * sonst kostet sie keine Höhe. Reihenfolge bei mehreren gleichzeitigen
 * Vorkommnissen: fremde oder noch nicht bestätigte Board-Steuerung,
 * Offline-Zustand, wartende Aufnahmen, freie Fehlermeldung. Jede Meldung
 * trägt ihren Text selbst — die Farbe ist nie der einzige Kanal.
 *
 * `lockState` folgt `BoardLockState` aus `use-board-controller-lock.ts`
 * (`EIGEN` / `FREMD` / `WIRD_ÜBERNOMMEN`) statt eines eigens erfundenen
 * `UNBEKANNT`: der Hook kennt dieses dritte Wort nicht.
 *
 * `WIRD_ÜBERNOMMEN` ist ein eigenes Vorkommnis, kein stiller Normalzustand:
 * `mayControl` ist dann false (`use-match-scoring.ts`), das Eingabefeld also
 * gesperrt, und ein anhaltender Lease-Fehler
 * (`use-board-controller-lock.ts`) hält diesen Zustand ohne weiteres Wort
 * unbegrenzt — `navigator.onLine` bleibt dabei true, die Offline-Zeile
 * greift also nicht. Ohne eigene Meldung wäre die Fläche stumm gesperrt.
 *
 * Der Container selbst bleibt immer im DOM, `role="status"` eingeschlossen:
 * ein `return null` würde die Live-Region erst zusammen mit ihrem Inhalt
 * einhängen, und viele Screenreader sagen einen Knoten, der gleichzeitig mit
 * seinem Text erscheint, gar nicht erst an. Ohne Vorkommnis trägt der
 * Container weder Rahmen noch Innenabstand und bleibt damit ohne eigene
 * Höhe — nur sein Inhalt ist bedingt, nicht der Knoten.
 */
export function ScoreboardStatus({ lockState, online, queuedCount, message, onTakeOver }: {
  readonly lockState: BoardLockState;
  readonly online: boolean;
  readonly queuedCount: number;
  readonly message: string | null;
  readonly onTakeOver: () => void;
}) {
  const hasIncident = lockState !== "EIGEN" || !online || queuedCount > 0 || message !== null;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-body",
        hasIncident && "border-b border-slate-800 bg-slate-900 px-4 py-2",
      )}
      role="status"
    >
      {lockState === "FREMD" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-slate-200">
          <span>Ein anderes Gerät steuert dieses Board.</span>
          <Button onClick={onTakeOver} variant="outline">Steuerung übernehmen</Button>
        </div>
      ) : lockState === "WIRD_ÜBERNOMMEN" ? (
        <p className="text-slate-200">Board-Steuerung wird übernommen …</p>
      ) : null}
      {!online ? <p className="text-slate-200">Offline · Aufnahmen werden lokal gespeichert.</p> : null}
      {queuedCount > 0 ? (
        <p className="text-slate-200">
          {queuedCount} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.
        </p>
      ) : null}
      {message !== null ? <p className="text-rose-300" role="alert">{message}</p> : null}
    </div>
  );
}
