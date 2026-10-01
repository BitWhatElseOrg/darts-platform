import type { StateTone } from "@darts-platform/ui";

import { legsLabel } from "@/lib/club-duel-view";

/**
 * Was in der Ergebnis-Spalte eines Spiels steht. Ein kampfloser Sieg hat keine
 * Legs; statt «–» und «gespielt» nennt die Anzeige den Sieger in Worten.
 * Ob kampflos, entscheidet der Server (resultType bzw. Sieger ohne Legs).
 */
export function matchOutcomeText(
  match: { readonly legs: readonly [number, number] | null; readonly winnerPlayerId: string | null },
  walkover: boolean,
  name: (playerId: string | null) => string,
): string {
  return walkover ? `kampflos · Sieg ${name(match.winnerPlayerId)}` : legsLabel(match.legs);
}

export const walkoverState: { readonly tone: StateTone; readonly label: string } = { tone: "finish", label: "kampflos" };
