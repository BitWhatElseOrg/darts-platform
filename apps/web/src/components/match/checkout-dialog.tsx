"use client";

import { useEffect, useRef } from "react";
import { Button, cn } from "@darts-platform/ui";

const fieldSelectClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";

const dartsButtonClassName =
  "min-h-14 rounded-lg text-title-sm font-numerals font-bold tabular transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

/**
 * Checkout-Schritt des Runden-Modus (siehe `match-scoreboard.tsx`,
 * `handleRoundSubmit` für die Auslösebedingung). `onBust` sendet die
 * Aufnahme ohne Doppelangabe raus, wenn das Doppel tatsächlich nicht sass —
 * die Engine wertet sie dann korrekt als Bust statt das Leg offenzuhalten.
 */
export function CheckoutDialog({
  darts,
  error,
  field,
  onBust,
  onCancel,
  onDartsChange,
  onFieldChange,
  onSubmit,
  open,
  pending,
  points,
}: {
  readonly darts: 1 | 2 | 3;
  readonly error: string | null;
  readonly field: string;
  readonly onBust: () => void;
  readonly onCancel: () => void;
  readonly onDartsChange: (darts: 1 | 2 | 3) => void;
  readonly onFieldChange: (field: string) => void;
  readonly onSubmit: () => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly points: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      aria-labelledby="checkout-dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-emerald-400/40 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      ref={dialogRef}
    >
      <form className="space-y-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div>
          <h4 className="font-numerals text-title font-bold" id="checkout-dialog-title">Checkout erfassen</h4>
          <p className="mt-2 text-body text-slate-300">{points} Punkte auf 0. Wähle das letzte Doppel und die benötigten Darts — oder melde, dass kein Doppel sass.</p>
        </div>
        <label className="block space-y-2 text-body font-semibold text-slate-200">
          <span>Checkout-Feld</span>
          <select autoFocus className={fieldSelectClassName} required value={field} onChange={(event) => onFieldChange(event.target.value)}>
            <option value="">Doppel wählen</option>
            {Array.from({ length: 20 }, (_, index) => index + 1).map((double) => <option key={double} value={double}>D{double}</option>)}
            <option value={25}>Bull (Double 25)</option>
          </select>
        </label>
        <div className="space-y-2 text-body font-semibold text-slate-200">
          <span>Benötigte Darts</span>
          <div className="grid grid-cols-3 gap-3">
            {([1, 2, 3] as const).map((count) => (
              <button
                aria-label={`${count} ${count === 1 ? "Dart" : "Darts"}`}
                aria-pressed={darts === count}
                className={cn(dartsButtonClassName, darts === count ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-white hover:bg-slate-700")}
                key={count}
                onClick={() => onDartsChange(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        {error ? <p className="text-body text-rose-300" role="alert">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">Abbrechen</Button>
          <Button className="border-rose-500/60 text-rose-300 hover:bg-rose-500/10" disabled={pending} onClick={onBust} type="button" variant="outline">Kein Doppel getroffen (Bust)</Button>
        </div>
        <Button disabled={pending || field === ""} type="submit">Checkout speichern</Button>
      </form>
    </dialog>
  );
}
