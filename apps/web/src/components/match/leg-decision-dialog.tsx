"use client";

import { useRef } from "react";
import { Button } from "@darts-platform/ui";
import type { PendingLegDecision } from "@/lib/scoreboard-view";
import { useDialogFocusReturn } from "./use-dialog-focus-return";

/**
 * Der Entscheid, der dem naechsten Wurf vorausgeht — Anwurf ausbullen
 * (Reglement 2.2.9) oder Leg an der Rundengrenze ausbullen (Anhang 2).
 *
 * Beide Male wird nur das ERGEBNIS erfasst, nicht der Vorgang: wer wirft,
 * in welcher Reihenfolge und wie oft wiederholt wird, steht im Reglement und
 * passiert an der Scheibe. Die Flaeche haelt fest, wie es ausgegangen ist.
 *
 * Der Dialog ist bewusst nicht abbrechbar: solange der Entscheid aussteht,
 * nimmt der Server keine Aufnahme fuer dieses Leg an, ein Wegklicken liesse
 * die Flaeche also nur in einem Zustand stehen, in dem nichts geht.
 */
export function LegDecisionDialog({ decision, error, onDecide, pending, sideNames }: {
  readonly decision: PendingLegDecision | null;
  readonly error: string | null;
  readonly onDecide: (seat: 1 | 2) => void;
  readonly pending: boolean;
  readonly sideNames: readonly [string, string];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocusReturn(dialogRef, decision !== null);

  const bullOff = decision?.kind === "LEG_BY_BULL";
  const title = bullOff ? "Rundengrenze erreicht" : `Leg ${decision?.legNumber ?? ""} · Anwurf ausbullen`;
  const description = bullOff
    ? "Die festgelegte Rundenzahl ist gespielt. Das Leg wird ausgebullt: Es gewinnt, wessen Dart am nächsten der Scheibenmitte steckt."
    : "Die Startfolge wird mit je einem Wurf auf das Bull ausgespielt. Es beginnt, wessen Dart am nächsten der Scheibenmitte steckt.";
  const question = bullOff ? "Wer gewinnt das Leg?" : "Wer beginnt das Leg?";

  return (
    <dialog
      aria-describedby="leg-decision-description"
      aria-labelledby="leg-decision-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-emerald-500/50 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80"
      // Kein Schliessen per Escape: ohne Entscheid geht es nicht weiter.
      onCancel={(event) => event.preventDefault()}
      ref={dialogRef}
    >
      <div className="space-y-5 p-5 sm:p-6">
        <div>
          <h4 className="font-numerals text-title font-bold" id="leg-decision-title">{title}</h4>
          <p className="mt-2 text-body text-slate-300" id="leg-decision-description">{description}</p>
        </div>
        <p className="text-body font-semibold text-slate-200">{question}</p>
        <div className="grid gap-3">
          {([1, 2] as const).map((seat) => (
            <Button
              autoFocus={seat === 1}
              className="min-h-14 justify-start text-left"
              disabled={pending}
              key={seat}
              onClick={() => onDecide(seat)}
              type="button"
              variant="outline"
            >
              {sideNames[seat - 1]}
            </Button>
          ))}
        </div>
        {error ? <p className="text-body text-rose-300" role="alert">{error}</p> : null}
      </div>
    </dialog>
  );
}
