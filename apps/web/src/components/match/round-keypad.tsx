"use client";

import type { FrequentScores } from "@darts-platform/schemas";
import { cn } from "@darts-platform/ui";
import { quickScoresSourceLabel } from "@/lib/scoreboard-view";

const keyClassName =
  "min-h-14 rounded-lg text-title-sm font-numerals font-semibold tabular text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Rücktaste und Absendeknopf als gezeichnete Marken statt Unicode-Chevrons —
 * DESIGN.md: „Marks are drawn SVG … there are no … unicode glyphs standing
 * in for a mark." Rein dekorativ, die zugängliche Bezeichnung trägt der
 * jeweilige Knopf.
 */
function BackspaceIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SubmitIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Drei Zeilen zu drei Ziffern, 1–9 der Reihe nach. */
const digitRows: readonly (readonly number[])[] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

/**
 * Runden-Keypad: die getippte Rundensumme gross über dem Feld, darunter
 * zwei Zeilen zu drei Schnellwerten (mit ihrer Herkunft beschriftet, siehe
 * `quickScoresSourceLabel`), darunter drei Zeilen Ziffern (1–9), unten
 * Rücktaste, `0` und der Absendeknopf. Das Keypad entscheidet nichts selbst
 * — Ziffern- und Schnellwertlogik liegen in `round-entry.ts`, die
 * Attainability-Prüfung für den Absendeknopf ebenfalls dort
 * (`isRoundEntrySubmittable`, hier nur als `submittable` entgegengenommen).
 *
 * `disabled` sperrt die ganze Fläche (etwa ohne Steuerungsrecht oder während
 * der Checkout-Schritt offen ist); der Absendeknopf ist zusätzlich gesperrt,
 * solange `submittable` falsch ist — eine mit drei Darts nicht werfbare Summe
 * lässt sich zwar weiter eintippen, aber nicht abschicken.
 */
export function RoundKeypad({ value, quickScores, quickScoresSource, submittable, disabled, onDigit, onQuickScore, onBackspace, onSubmit }: {
  readonly value: string;
  readonly quickScores: readonly number[];
  readonly quickScoresSource: FrequentScores["source"];
  readonly submittable: boolean;
  readonly disabled: boolean;
  readonly onDigit: (digit: number) => void;
  readonly onQuickScore: (score: number) => void;
  readonly onBackspace: () => void;
  readonly onSubmit: () => void;
}) {
  const quickScoreRows = [quickScores.slice(0, 3), quickScores.slice(3, 6)];

  // Leer zeigt "–", nicht "0": die Rücktaste wirkt bei beidem anders (leer
  // -> Server-Undo, getippte Null -> nimmt nur die Ziffer zurück) und muss
  // dafür sichtbar UND für die Live-Region hörbar unterscheidbar bleiben.
  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto] gap-2">
      <p
        aria-live="polite"
        className={cn(
          "text-center font-numerals text-display font-bold tabular",
          value === "" ? "text-slate-600" : "text-white",
        )}
      >
        {value === "" ? "–" : value}
      </p>
      <div className="space-y-1">
        <p className="text-center text-caption uppercase tracking-[0.08em] text-slate-400">
          {quickScoresSourceLabel(quickScoresSource)}
        </p>
        <div className="grid grid-rows-2 gap-2">
          {quickScoreRows.map((row, rowIndex) => (
            <div className="grid grid-cols-3 gap-2" key={rowIndex}>
              {row.map((score) => (
                <button
                  aria-label={`${score} Punkte`}
                  className={cn(keyClassName, "bg-slate-800 hover:enabled:bg-slate-700")}
                  disabled={disabled}
                  key={score}
                  onClick={() => onQuickScore(score)}
                  type="button"
                >
                  {score}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-rows-3 gap-2">
        {digitRows.map((row, rowIndex) => (
          <div className="grid grid-cols-3 gap-2" key={rowIndex}>
            {row.map((digit) => (
              <button
                aria-label={`Ziffer ${digit}`}
                className={cn(keyClassName, "bg-slate-800 hover:enabled:bg-slate-700")}
                disabled={disabled}
                key={digit}
                onClick={() => onDigit(digit)}
                type="button"
              >
                {digit}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          aria-label="Rücktaste"
          className={cn(keyClassName, "bg-slate-700 hover:enabled:bg-slate-600")}
          disabled={disabled}
          onClick={onBackspace}
          type="button"
        >
          <BackspaceIcon />
        </button>
        <button
          aria-label="Ziffer 0"
          className={cn(keyClassName, "bg-slate-800 hover:enabled:bg-slate-700")}
          disabled={disabled}
          onClick={() => onDigit(0)}
          type="button"
        >
          0
        </button>
        <button
          aria-label="Aufnahme erfassen"
          className={cn(keyClassName, "bg-emerald-500 text-slate-950 hover:enabled:bg-emerald-400")}
          disabled={disabled || !submittable}
          onClick={onSubmit}
          type="button"
        >
          <SubmitIcon />
        </button>
      </div>
    </div>
  );
}
