import { Wedge } from "@darts-platform/ui";

export const CLUB_DUEL_UNAVAILABLE_TEXT = "Vereinsduell-Ansicht derzeit nicht verfügbar.";

/**
 * Fehlt die Vereinsduell-Projektion (`clubDuel === null`) bei einem Turnier im
 * Format CLUB_DUEL, steht hier ein sichtbarer Hinweis statt einer leeren
 * klassischen Rangliste (AGENTS.md §18: Fehlerzustaende sichtbar).
 */
export function ClubDuelUnavailableNotice({ className }: { readonly className?: string }) {
  return (
    <Wedge className={className === undefined ? "p-4" : `p-4 ${className}`} lift={false} role="status" tone="plate">
      <p className="font-plate text-body text-wedge-900">{CLUB_DUEL_UNAVAILABLE_TEXT}</p>
    </Wedge>
  );
}
