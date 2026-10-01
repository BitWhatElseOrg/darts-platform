export const KIOSK_POLL_MS = 5_000;
export const KIOSK_END_HOLD_MS = 30_000;

export type KioskView =
  | { readonly kind: "idle" }
  | { readonly kind: "match"; readonly matchId: string }
  | { readonly kind: "ended"; readonly matchId: string };

/**
 * Was das Tablet zeigt. Ein laufendes Match der Scheibe hat immer Vorrang;
 * ein gerade beendetes bleibt `KIOSK_END_HOLD_MS` stehen, damit die
 * Spielenden das Ergebnis sehen – oder bis jemand «Weiter» tippt.
 */
export function kioskView(input: {
  readonly currentMatchId: string | null;
  readonly lastMatchId: string | null;
  readonly lastMatchCompletedAt: number | null;
  readonly dismissedMatchId: string | null;
  readonly now: number;
}): KioskView {
  if (input.currentMatchId !== null) return { kind: "match", matchId: input.currentMatchId };
  if (
    input.lastMatchId !== null &&
    input.lastMatchCompletedAt !== null &&
    input.dismissedMatchId !== input.lastMatchId &&
    input.now - input.lastMatchCompletedAt < KIOSK_END_HOLD_MS
  ) {
    return { kind: "ended", matchId: input.lastMatchId };
  }
  return { kind: "idle" };
}
