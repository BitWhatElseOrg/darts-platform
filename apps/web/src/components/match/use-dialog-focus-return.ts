"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Fokusfang und -rückgabe für ein `<dialog>`, das dauerhaft gerendert bleibt
 * (kein `if (!open) return null` mehr — das entfernt den Knoten aus dem DOM,
 * bevor der schliessende Effekt ihn über den Ref noch erreichen kann; native
 * `<dialog>`-Elemente geben den Fokus beim Schliessen ausserdem nicht
 * zuverlässig zurück, siehe unten) und nur imperativ per `showModal()`/
 * `close()` gesteuert wird — verwendet von `checkout-dialog.tsx`,
 * `abort-match-dialog.tsx` und `scoreboard-settings-dialog.tsx` (Task 14,
 * Review-Befund 3).
 *
 * `document.activeElement` direkt im öffnenden Effekt zu lesen reicht nicht
 * in jedem Fall: wird der aufrufende Knopf im SELBEN Commit deaktiviert (z. B.
 * das Runden-Keypad während `checkoutOpen`, siehe `match-scoreboard.tsx`),
 * verliert er den Fokus schon VOR diesem Effekt — React wendet DOM-Mutationen
 * für einen Commit vor jedem Effekt an. Mit Playwright gemessen: die
 * Erfassung liefert in diesem Fall bereits `<body>` statt des eigentlichen
 * Knopfs. Ein `focusout`-Listener auf `document` fängt den Zielknoten
 * dagegen im Moment des tatsächlichen Fokusverlusts ab, unabhängig vom Grund
 * (`showModal()` selbst oder ein Deaktivieren des Aufrufers).
 */
export function useDialogFocusReturn(dialogRef: RefObject<HTMLDialogElement | null>, open: boolean): void {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleFocusOut = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      const target = event.target;
      if (dialog === null || !(target instanceof HTMLElement) || dialog.contains(target)) return;
      previouslyFocused.current = target;
    };
    document.addEventListener("focusout", handleFocusOut, true);
    return () => document.removeEventListener("focusout", handleFocusOut, true);
  }, [dialogRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open) {
      if (dialog.open) dialog.close();
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [dialogRef, open]);
}
