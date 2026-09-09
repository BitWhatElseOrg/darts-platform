"use client";

import type { FrequentScores } from "@darts-platform/schemas";
import { cn, Rule } from "@darts-platform/ui";
import { quickScoresSourceLabel } from "@/lib/scoreboard-view";
import { BackspaceKey } from "./backspace-key";
import { keypadKeyClassName } from "./keypad-key";

/**
 * Absendeknopf als gezeichnete Marke statt eines Unicode-Chevrons —
 * DESIGN.md: „Marks are drawn SVG … there are no … unicode glyphs standing
 * in for a mark." Rein dekorativ, die zugängliche Bezeichnung trägt der
 * Knopf.
 */
function SubmitMark() {
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
 * Runden-Keypad: die getippte Rundensumme über dem Feld, darunter zwei
 * Zeilen zu drei Schnellwerten (mit ihrer Herkunft beschriftet, siehe
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
 *
 * Die Aktionszeile steht ausserhalb des scrollenden Bereichs: bei 360 × 640
 * (das schmalste erwartete Boardgerät) brauchte der Inhalt 473 px bei 392 px
 * Platz, und der Absendeknopf lag damit unter der Kante — erreichbar nur
 * durch Scrollen im Keypad, mitten im häufigsten Handgriff der Fläche.
 * Schnellwerte und Ziffern scrollen notfalls, Rücktaste und Absenden nie.
 */
export function RoundKeypad({ value, quickScores, quickScoresSource, submittable, disabled, undoAvailable, undoPoints, onDigit, onQuickScore, onBackspace, onSubmit }: {
  readonly value: string;
  readonly quickScores: readonly number[];
  readonly quickScoresSource: FrequentScores["source"];
  readonly submittable: boolean;
  readonly disabled: boolean;
  readonly undoAvailable: boolean;
  readonly undoPoints: number | null;
  readonly onDigit: (digit: number) => void;
  readonly onQuickScore: (score: number) => void;
  readonly onBackspace: () => void;
  readonly onSubmit: () => void;
}) {
  const quickScoreRows = [quickScores.slice(0, 3), quickScores.slice(3, 6)];

  // Leer zeigt "–", nicht "0": die Rücktaste wirkt bei beidem anders (leer
  // -> Server-Undo, getippte Null -> nimmt nur die Ziffer zurück) und muss
  // dafür sichtbar UND für die Live-Region hörbar unterscheidbar bleiben.
  // Der Platzhalter steht in `spider-dim` (6,9:1 gegen den Grund); in
  // `sisal-300` erreichte er 2,7:1 und las sich wie ein Ziehgriff.
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] gap-2">
      <p
        aria-live="polite"
        className={cn(
          "text-center font-numerals text-data font-bold tabular",
          value === "" ? "text-spider-dim" : "text-chalk",
        )}
      >
        {value === "" ? "–" : value}
      </p>
      <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-2 overflow-y-auto">
        <div className="space-y-1">
          <p className="text-center text-caption font-semibold uppercase tracking-[0.12em] text-spider-dim">
            {quickScoresSourceLabel(quickScoresSource)}
          </p>
          <div className="grid grid-rows-2 gap-2">
            {quickScoreRows.map((row, rowIndex) => (
              <div className="grid grid-cols-3 gap-2" key={rowIndex}>
                {row.map((score) => (
                  <button
                    aria-label={`${score} Punkte`}
                    className={cn(keypadKeyClassName, "bg-wedge-800")}
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
        {/* Schnellwerte und Ziffern sind beides Reihen zu drei gleich
            aussehenden Tasten; ohne Kante verschwimmen sie zu einem Feld und
            60/81/85 werden mit 6/8/5 verwechselt. `Rule` ist der einzige
            Trenner dieses Systems (DESIGN.md, „Dividers") — ein
            `border-slate-800` stand 1,4:1 über dem Grund und war auf dem
            Telefon unsichtbar. Die Schnellwerte tragen zusätzlich den
            helleren Feld-Grund (#334155), die Ziffern den dunkleren (#1e293b). */}
        <Rule tone="ink" />
        <div className="grid grid-rows-3 gap-2">
          {digitRows.map((row, rowIndex) => (
            <div className="grid grid-cols-3 gap-2" key={rowIndex}>
              {row.map((digit) => (
                <button
                  aria-label={`Ziffer ${digit}`}
                  // Auf einem Tablet ist die Taste rund 110 px hoch; eine
                  // 18-px-Ziffer darin liest sich wie ein leerer Kasten.
                  className={cn(keypadKeyClassName, "[@media(min-height:56rem)]:text-title")}
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
      </div>
      <div className="grid grid-cols-3 gap-2">
        <BackspaceKey
          disabled={disabled}
          entryEmpty={value === ""}
          onPress={onBackspace}
          undoAvailable={undoAvailable}
          undoPoints={undoPoints}
        />
        <button
          aria-label="Ziffer 0"
          className={keypadKeyClassName}
          disabled={disabled}
          onClick={() => onDigit(0)}
          type="button"
        >
          0
        </button>
        <button
          aria-label="Aufnahme erfassen"
          className={cn(keypadKeyClassName, "border-ring-green bg-ring-green text-chalk hover:enabled:bg-ring-green-deep")}
          disabled={disabled || !submittable}
          onClick={onSubmit}
          type="button"
        >
          <SubmitMark />
        </button>
      </div>
    </div>
  );
}
