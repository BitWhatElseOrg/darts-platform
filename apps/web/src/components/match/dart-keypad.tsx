"use client";

import { Fragment } from "react";
import { cn } from "@darts-platform/ui";
import { isSegmentAvailable } from "@/lib/dart-entry";
import { dartKeypadLabel } from "@/lib/scoreboard-view";

const keyClassName =
  "min-h-14 rounded-lg text-title-sm font-numerals font-semibold tabular text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Rücktaste als gezeichnete Marke statt eines Unicode-Chevrons — DESIGN.md:
 * „Marks are drawn SVG … there are no … unicode glyphs standing in for a
 * mark." Rein dekorativ, die zugängliche Bezeichnung trägt der Knopf.
 */
function BackspaceIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M15 18 9 12l6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Vier Segmenttasten je Zeile, 1–20 der Reihe nach. */
const numberRows: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/**
 * Rechte Spalte neben den vier Zahlen: Rücktaste, Fehlwurf, Bull, Bullseye —
 * je eine pro Zeile; die fünfte Zeile bleibt dort ohne Taste.
 */
const sideKeys: readonly (number | "backspace" | null)[] = ["backspace", 0, 25, 50, null];

/**
 * Wurf-für-Wurf-Keypad: 1–20, Fehlwurf, Bull, Bullseye, Rücktaste, dazu die
 * Umschalter DOUBLE und TRIPLE. Das Keypad entscheidet nichts selbst — es
 * meldet nur die gedrückte Taste; welcher Wurf daraus wird (insbesondere die
 * Abbildung der Bullseye-Taste auf Doppel 25) entscheidet der Reducer aus
 * `dart-entry.ts`.
 */
export function DartKeypad({ disabled, modifier, onSegment, onModifier, onBackspace }: {
  readonly disabled: boolean;
  readonly modifier: 1 | 2 | 3;
  readonly onSegment: (segment: number) => void;
  readonly onModifier: (multiplier: 2 | 3) => void;
  readonly onBackspace: () => void;
}) {
  const segmentButton = (segment: number) => {
    const available = isSegmentAvailable(segment, modifier);
    const isDisabled = disabled || !available;
    return (
      <button
        aria-disabled={isDisabled}
        aria-label={dartKeypadLabel(segment, modifier)}
        className={cn(keyClassName, "bg-slate-800 hover:enabled:bg-slate-700")}
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
    <div className="grid h-full grid-rows-[1fr_auto] gap-2">
      <div className="grid grid-cols-5 gap-2">
        {numberRows.map((row, rowIndex) => {
          const sideKey = sideKeys[rowIndex];
          return (
            <Fragment key={row.join("-")}>
              {row.map((segment) => segmentButton(segment))}
              {sideKey === "backspace" ? (
                <button
                  aria-label="Rücktaste"
                  className={cn(keyClassName, "bg-slate-700 hover:enabled:bg-slate-600")}
                  disabled={disabled}
                  onClick={onBackspace}
                  type="button"
                >
                  <BackspaceIcon />
                </button>
              ) : sideKey === null || sideKey === undefined ? (
                <div aria-hidden="true" />
              ) : (
                segmentButton(sideKey)
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          aria-label="Umschalter Doppel"
          aria-pressed={modifier === 2}
          className={cn(keyClassName, modifier === 2 ? "bg-emerald-500 text-slate-950" : "bg-slate-800 hover:enabled:bg-slate-700")}
          disabled={disabled}
          onClick={() => onModifier(2)}
          type="button"
        >
          DOUBLE
        </button>
        <button
          aria-label="Umschalter Triple"
          aria-pressed={modifier === 3}
          className={cn(keyClassName, modifier === 3 ? "bg-emerald-500 text-slate-950" : "bg-slate-800 hover:enabled:bg-slate-700")}
          disabled={disabled}
          onClick={() => onModifier(3)}
          type="button"
        >
          TRIPLE
        </button>
      </div>
    </div>
  );
}
