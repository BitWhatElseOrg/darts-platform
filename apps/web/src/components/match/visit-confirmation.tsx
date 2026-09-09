"use client";

import { useEffect, useRef } from "react";
import { cn } from "@darts-platform/ui";

/**
 * Rücktaste als gezeichnete Marke statt eines Unicode-Chevrons — DESIGN.md:
 * „Marks are drawn SVG … there are no … unicode glyphs standing in for a
 * mark." Rein dekorativ, die zugängliche Bezeichnung trägt der Knopf.
 */
function BackArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Bestätigungsfläche über dem Keypad, sobald eine Aufnahme abgeschlossen ist
 * (drei Würfe, Checkout oder Bust). `WEITER` sendet, die Rücktaste verwirft
 * nur die Bestätigung — die Würfe bleiben zum Korrigieren stehen, das
 * erledigt die aufrufende Fläche. Ein Klick oder Tipp irgendwo auf der
 * Fläche wirkt wie `WEITER` (auch bei automatischem Bestätigen ein
 * sofortiges Absenden); Tastaturfokus liegt beim Öffnen auf `WEITER`.
 *
 * `points` ist die angerechnete Zahl, `thrownPoints` die geworfene. Unter
 * Double In laufen sie bis zur Eröffnung auseinander (T20/T20/D20: 40
 * angerechnet, 160 geworfen) — dann nennt die Fläche beide, statt eine der
 * beiden Zahlen als die ganze Wahrheit auszugeben.
 */
export function VisitConfirmation({ points, thrownPoints, bust, onBack, onConfirm }: {
  readonly points: number;
  readonly thrownPoints: number;
  readonly bust: boolean;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Auch ein Bust kann angerechnete und geworfene Summe auseinanderlaufen
  // lassen: unter Double In eroeffnet ein Doppel mitten in der Aufnahme, und
  // die Wuerfe davor zaehlen nicht. Dann gehoeren beide Zahlen auf die
  // Flaeche, nicht nur eine.
  const partiallyCounted = thrownPoints !== points;

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-0 bg-slate-950/95">
      {/* Faengt Klicks auf der gesamten Flaeche auf; aus Tastatur- und
          Screenreader-Sicht unsichtbar (kein zweiter „WEITER"-Stopp). */}
      <button
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        onClick={onConfirm}
        tabIndex={-1}
        type="button"
      />
      <div className="pointer-events-none relative flex h-full flex-col items-center justify-center gap-6 p-4 text-center">
        <div aria-live="polite" className="flex flex-col items-center gap-2">
          <span className={cn("font-numerals font-bold text-display tabular", bust ? "text-rose-400" : "text-white")}>
            {points}
          </span>
          <span className={cn("text-label", bust ? "text-rose-300" : "text-emerald-300")}>
            {bust ? "BUST" : partiallyCounted ? "ANGERECHNET" : "GEWORFEN"}
          </span>
          {partiallyCounted ? (
            <span className="text-body text-slate-300">von {thrownPoints} geworfen</span>
          ) : null}
        </div>
        <div className="pointer-events-auto grid w-full max-w-md grid-cols-[auto_1fr] gap-3">
          <button
            aria-label="Eingabe korrigieren"
            className="min-h-14 rounded-lg bg-slate-800 px-6 text-title-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            onClick={onBack}
            type="button"
          >
            <BackArrowIcon />
          </button>
          <button
            className="min-h-14 rounded-lg bg-ring-green text-title-sm font-bold text-chalk transition hover:bg-ring-green-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
            onClick={onConfirm}
            ref={confirmRef}
            type="button"
          >
            WEITER
          </button>
        </div>
      </div>
    </div>
  );
}
