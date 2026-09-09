"use client";

import { cn, Control } from "@darts-platform/ui";
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
export function ScoreboardStatus({ busy, lockState, online, queuedCount, message, onTakeOver }: {
  readonly lockState: BoardLockState;
  readonly online: boolean;
  readonly queuedCount: number;
  readonly message: string | null;
  /**
   * Eine laufende Mutation, die keine eigene Fläche hat. Die Rücknahme ist
   * seit dem Wegfall ihres Knopfes nur noch eine Taste im Keypad; ohne diese
   * Zeile bliebe sie zwischen Tastendruck und Serverantwort ohne jede
   * Rückmeldung (`undoPending` hatte danach keinen Konsumenten mehr).
   */
  readonly busy: string | null;
  readonly onTakeOver: () => void;
}) {
  const hasIncident = lockState !== "EIGEN" || !online || queuedCount > 0 || message !== null || busy !== null;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 text-body",
        hasIncident && "border-b border-sisal-300 bg-sisal-100 px-4 py-2",
      )}
      role="status"
    >
      {lockState === "FREMD" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-spider">
          <span>Ein anderes Gerät steuert dieses Board.</span>
          <Control density="tight" onClick={onTakeOver} variant="wireInk">Steuerung übernehmen</Control>
        </div>
      ) : lockState === "WIRD_ÜBERNOMMEN" ? (
        <p className="text-spider">Board-Steuerung wird übernommen …</p>
      ) : null}
      {!online ? <p className="text-spider">Offline · Aufnahmen werden lokal gespeichert.</p> : null}
      {queuedCount > 0 ? (
        <p className="text-spider">
          {queuedCount} Aufnahme wartet dauerhaft gespeichert auf die Übertragung.
        </p>
      ) : null}
      {busy !== null ? <p className="text-spider">{busy}</p> : null}
      {message !== null ? <p className="text-ring-red-deep" role="alert">{message}</p> : null}
    </div>
  );
}
