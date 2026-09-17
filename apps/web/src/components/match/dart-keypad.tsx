"use client";

import { Fragment } from "react";
import { cn, MarkCheck } from "@darts-platform/ui";
import { isSegmentAvailable } from "@/lib/dart-entry";
import { dartKeypadLabel } from "@/lib/scoreboard-view";
import { BackspaceKey } from "./backspace-key";
import { keypadActionKeyClassName, keypadKeyClassName } from "./keypad-key";

/** Vier Segmenttasten je Zeile, 1–20 der Reihe nach. */
const numberRows: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/**
 * Rechte Spalte neben den vier Zahlen: Fehlwurf, Bull, Bullseye, Rücktaste —
 * je eine pro Zeile; eine Zeile bleibt dort ohne Taste.
 *
 * Die Rücktaste stand bis zum UX-Test in der ersten Zeile, also oben rechts:
 * die schlechteste Daumenposition eines einhändig gehaltenen Telefons, und
 * seit dem Wegfall des Undo-Knopfes trägt sie die einzige destruktive
 * Alltagsfunktion der Fläche. Sie steht jetzt unten rechts, wo auch das
 * Runden-Keypad seine Aktionszeile hat.
 */
const sideKeys: readonly (number | "backspace" | null)[] = [0, 25, 50, null, "backspace"];

/**
 * Wurf-für-Wurf-Keypad: 1–20, Fehlwurf, Bull, Bullseye, Rücktaste, dazu die
 * Umschalter DOUBLE und TRIPLE. Das Keypad entscheidet nichts selbst — es
 * meldet nur die gedrückte Taste; welcher Wurf daraus wird (insbesondere die
 * Abbildung der Bullseye-Taste auf Doppel 25) entscheidet der Reducer aus
 * `dart-entry.ts`.
 *
 * `disabled` sperrt die ganze Fläche (Segmente, Umschalter, Rücktaste) —
 * etwa während die Bestätigung eingeblendet ist oder ohne Steuerungsrecht.
 * `segmentsLocked` sperrt NUR die Segmenttasten (1–20, Fehlwurf, Bull,
 * Bullseye): die laufende Aufnahme ist bereits abgeschlossen (Checkout oder
 * Bust), der Reducer verwirft jeden weiteren Wurf ohnehin stumm — sichtbar
 * gesperrt statt wirkungslos aktiv. Die Rücktaste bleibt dabei bedienbar,
 * denn sie ist der einzige Weg, die Aufnahme zu korrigieren (Review-Befund 2).
 */
export function DartKeypad({ disabled, entryEmpty, segmentsLocked, modifier, undoAvailable, undoPoints, onSegment, onModifier, onBackspace }: {
  readonly disabled: boolean;
  /** Leere Aufnahme: die Rücktaste trifft die letzte gesendete Aufnahme. */
  readonly entryEmpty: boolean;
  readonly segmentsLocked: boolean;
  readonly modifier: 1 | 2 | 3;
  readonly undoAvailable: boolean;
  readonly undoPoints: number | null;
  readonly onSegment: (segment: number) => void;
  readonly onModifier: (multiplier: 2 | 3) => void;
  readonly onBackspace: () => void;
}) {
  // Fehlwurf (0), Bull (25) und Bullseye (50) stehen in derselben Spalte wie
  // die Ruecktaste und waren von den Segmenten 1-20 typografisch nicht zu
  // unterscheiden. Sie tragen deshalb den helleren Feld-Grund.
  const specialSegments = new Set([0, 25, 50]);

  const segmentButton = (segment: number) => {
    const available = isSegmentAvailable(segment, modifier);
    const isDisabled = disabled || segmentsLocked || !available;
    return (
      <button
        aria-disabled={isDisabled}
        aria-label={dartKeypadLabel(segment, modifier)}
        className={cn(keypadKeyClassName, "[@media(min-height:56rem)]:text-title", specialSegments.has(segment) && "bg-wedge-800")}
        disabled={isDisabled}
        key={segment}
        onClick={() => onSegment(segment)}
        type="button"
      >
        {segment}
      </button>
    );
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-2 [@media(max-height:44rem)]:gap-1">
      {/* Die Umschalterzeile steht ausserhalb des mitwachsenden Bereichs: bei
          360 × 640 lagen DOUBLE und TRIPLE mit 9 von 56 px unter der Kante,
          und ohne Doppel ist unter Double Out kein Leg zu beenden.

          `grid-rows-5` macht die fünf Segmentreihen zu `1fr`-Zeilen: sie
          teilen sich den Platz, der bleibt, statt ihre Wunschhöhe zu fordern
          und den Rest ins Scrollen zu schieben (siehe `keypad-key.ts`).
          Darunter greift `min-h-11` als Untergrenze — und erst unterhalb von
          rund 600 px Sichthöhe, wo auch die nicht mehr passt, das
          `overflow-y-auto` als letzte Sicherung. */}
      <div className="grid min-h-0 grid-cols-5 grid-rows-5 gap-2 overflow-y-auto [@media(max-height:44rem)]:gap-1">
        {numberRows.map((row, rowIndex) => {
          const sideKey = sideKeys[rowIndex];
          return (
            <Fragment key={row.join("-")}>
              {row.map((segment) => segmentButton(segment))}
              {sideKey === "backspace" ? (
                <BackspaceKey
                  disabled={disabled}
                  entryEmpty={entryEmpty}
                  onPress={onBackspace}
                  undoAvailable={undoAvailable}
                  undoPoints={undoPoints}
                />
              ) : sideKey === null || sideKey === undefined ? (
                <div aria-hidden="true" />
              ) : (
                segmentButton(sideKey)
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 [@media(max-height:44rem)]:gap-1">
        <button
          aria-label="Umschalter DOUBLE"
          aria-pressed={modifier === 2}
          className={cn(keypadActionKeyClassName, modifier === 2 && "border-ring-green bg-ring-green text-chalk")}
          disabled={disabled}
          onClick={() => onModifier(2)}
          type="button"
        >
          {modifier === 2 ? <MarkCheck className="h-4 w-4" /> : null}
          DOUBLE
        </button>
        <button
          aria-label="Umschalter TRIPLE"
          aria-pressed={modifier === 3}
          className={cn(keypadActionKeyClassName, modifier === 3 && "border-ring-green bg-ring-green text-chalk")}
          disabled={disabled}
          onClick={() => onModifier(3)}
          type="button"
        >
          {modifier === 3 ? <MarkCheck className="h-4 w-4" /> : null}
          TRIPLE
        </button>
      </div>
    </div>
  );
}
