"use client";

import { cn } from "@darts-platform/ui";
import { keypadKeyClassName } from "./keypad-key";

/**
 * Rücktaste als gezeichnete Marke statt eines Unicode-Chevrons — DESIGN.md:
 * „Marks are drawn SVG … there are no … unicode glyphs standing in for a
 * mark." Rein dekorativ, die zugängliche Bezeichnung trägt der Knopf.
 */
function BackspaceMark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Die Rücktaste beider Keypads — eine Taste mit zwei Bedeutungen, und
 * deshalb mit zwei sichtbaren Identitäten.
 *
 * Bei angefangener Eingabe nimmt sie den letzten Wurf beziehungsweise die
 * letzte Ziffer zurück: neutraler Grund, nur die Marke. Bei leerer Eingabe
 * nimmt sie die letzte bereits gesendete Aufnahme serverseitig zurück — das
 * ist eine andere Handlung mit anderer Reichweite, also trägt die Taste dann
 * die rote Rendition, die zurückzunehmende Punktzahl als Beleg und einen
 * zugänglichen Namen, der die Handlung benennt statt der Taste.
 *
 * Ohne rücknehmbare Aufnahme, offline oder während eine Rücknahme läuft ist
 * sie in dieser zweiten Identität gesperrt: `undoVisit` geht bewusst nicht in
 * die Offline-Warteschlange (`use-match-scoring.ts`) und könnte dort nur
 * fehlschlagen. Diese Sperren trug bis zum Wegfall des eigenen Knopfes
 * dessen `disabled`-Ausdruck.
 */
export function BackspaceKey({ className, disabled, entryEmpty, onPress, undoAvailable, undoPoints }: {
  readonly className?: string;
  /** Sperre der ganzen Fläche — gilt in beiden Identitäten. */
  readonly disabled: boolean;
  /** Leere Eingabe: die Taste trifft die letzte gesendete Aufnahme. */
  readonly entryEmpty: boolean;
  readonly onPress: () => void;
  readonly undoAvailable: boolean;
  readonly undoPoints: number | null;
}) {
  const undoMode = entryEmpty;
  return (
    <button
      aria-label={
        undoMode
          ? undoPoints === null
            ? "Keine Aufnahme zum Zurücknehmen"
            : `Letzte Aufnahme zurücknehmen: ${undoPoints} Punkte`
          : "Rücktaste"
      }
      className={cn(
        keypadKeyClassName,
        undoMode
          ? "border-ring-red bg-sisal-100 text-ring-red hover:enabled:bg-wedge-900"
          : "bg-wedge-800 hover:enabled:bg-wedge-700",
        className,
      )}
      disabled={disabled || (undoMode && !undoAvailable)}
      onClick={onPress}
      type="button"
    >
      <BackspaceMark />
      {undoMode && undoPoints !== null ? (
        <span className="font-numerals text-title-sm font-bold tabular">{undoPoints}</span>
      ) : null}
    </button>
  );
}
