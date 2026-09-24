"use client";

import { useId, useRef, type ReactNode } from "react";

import { Button } from "@darts-platform/ui";

import { useDialogFocusReturn } from "./match/use-dialog-focus-return";

/**
 * Gemeinsames Bestaetigungsdialog-Grundgerueist: Spieler archivieren/loeschen
 * (Task 3), Mitglied entfernen (Task 6), Organisation loeschen mit
 * Namensbestaetigung (Task 8, ueber `children`).
 *
 * Wie `checkout-dialog.tsx`/`abort-match-dialog.tsx`/
 * `scoreboard-settings-dialog.tsx`: das native `<dialog>` bleibt dauerhaft
 * gerendert und wird nur ueber `showModal()`/`close()` gesteuert
 * (`useDialogFocusReturn`) — kein `if (!open) return null`, das wuerde den
 * Knoten aus dem DOM entfernen, bevor der schliessende Effekt ihn ueber den
 * Ref noch erreichen kann (siehe die Begruendung dort). Geschlossen bleibt
 * das Element ueber die UA-Vorgabe `dialog:not([open]) { display: none }`
 * unsichtbar und ausserhalb der Accessibility-Baumes — "rendert nichts"
 * bedeutet das, nicht ein fehlender DOM-Knoten.
 *
 * `confirmVariant` ist ein eigenes, dialogspezifisches Vokabular ("primary"
 * fuer eine reversible Aktion wie Archivieren, "danger" fuer eine
 * destruktive) und wird auf die tatsaechlichen Button-Varianten aus
 * `@darts-platform/ui` (`default`/`danger`) abgebildet, die kein "primary"
 * kennen.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant,
  pending,
  error,
  confirmDisabled,
  onConfirm,
  onCancel,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly confirmVariant?: "danger" | "primary";
  readonly pending: boolean;
  readonly error: string | null;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogFocusReturn(dialogRef, open);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-ring-red-deep/50 bg-slate-950 p-5 text-white shadow-2xl sm:p-6"
      onCancel={(event) => {
        // Escape loest den nativen `cancel` immer aus, auch waehrend eine
        // Anfrage laeuft. Ohne diese Sperre wuerde der Dialog optisch
        // verschwinden, waehrend die Mutation im Hintergrund weiterlaeuft —
        // ein Fehlschlag danach faellt dann nirgendwo mehr auf.
        event.preventDefault();
        if (pending) return;
        onCancel();
      }}
      ref={dialogRef}
    >
      <div className="space-y-5">
        <div>
          <h3 className="font-numerals text-title font-bold" id={titleId}>
            {title}
          </h3>
          <p className="mt-2 text-body text-slate-300" id={descriptionId}>
            {description}
          </p>
        </div>
        {children}
        {error !== null ? (
          <p className="text-body text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={pending} onClick={onCancel} type="button" variant="outline">
            Abbrechen
          </Button>
          <Button
            disabled={pending || confirmDisabled === true}
            onClick={onConfirm}
            type="button"
            variant={confirmVariant === "primary" ? "default" : "danger"}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
