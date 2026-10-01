import type { TournamentDashboard } from "@darts-platform/schemas";
import { Rule, SheetLabel } from "@darts-platform/ui";

import { ClubDuelPanel, clubDuelTabForStatus } from "./club-duel/club-duel-panel";
import { ClubDuelUnavailableNotice } from "./club-duel/club-duel-unavailable";
import { StandingsSheet } from "./standings-sheet";

/**
 * Wertungsbereich der Kommandozentrale: Vereinsduell-Ansicht, Hinweis bei
 * fehlender Vereinsduell-Projektion oder die klassische Rangliste.
 */
export function TournamentStandingsArea({ dashboard }: { readonly dashboard: TournamentDashboard }) {
  if (dashboard.clubDuel !== null) {
    return (
      <section aria-labelledby="club-duel-heading">
        <SheetLabel as="h2" id="club-duel-heading">Vereinsduell</SheetLabel>
        <Rule className="mt-2" />
        {/* Kein key auf defaultTab: der Tab springt bei Statuswechsel nicht von selbst um. */}
        <div className="mt-4"><ClubDuelPanel clubDuel={dashboard.clubDuel} defaultTab={clubDuelTabForStatus(dashboard.tournament.status)} participants={dashboard.participants} /></div>
      </section>
    );
  }
  if (dashboard.tournament.format === "CLUB_DUEL") {
    return (
      <section aria-labelledby="club-duel-heading">
        <SheetLabel as="h2" id="club-duel-heading">Vereinsduell</SheetLabel>
        <Rule className="mt-2" />
        <ClubDuelUnavailableNotice className="mt-4" />
      </section>
    );
  }
  return <StandingsSheet format={dashboard.tournament.format} groups={dashboard.groups} />;
}
