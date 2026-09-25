"use client";

import { useQuery } from "@tanstack/react-query";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { matchStateSchema } from "@darts-platform/schemas";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { matchLoadMessage, matchRefetchInterval, shouldRetryMatchLoad } from "@/lib/match-load-state";
import { matchBackLink } from "@/lib/match-navigation";
import { useTournamentOrganization } from "../tournament/use-tournament-organization";
import { MatchScoreboard } from "./match-scoreboard";

/**
 * Die Vollbildfläche verzichtet auf die übliche Seitenhülle (`PageNav`,
 * Organisationsname, Match-Titel): sie füllt `100dvh`, und der Rückweg
 * wandert als `backHref`/`backLabel` in die Kopfzeile der Fläche selbst.
 */
export function MatchScoreboardRoute({ encounterId, matchId, requestedOrganizationId }: {
  readonly encounterId?: string | undefined;
  readonly matchId: string;
  readonly requestedOrganizationId: string | undefined;
}) {
  const { query: organizationQuery, organization } = useTournamentOrganization(requestedOrganizationId);
  const matchQuery = useQuery({
    queryKey: ["match", organization?.id, matchId],
    queryFn: ({ signal }) => apiRequest({
      path: `/organizations/${organization?.id ?? ""}/matches/${matchId}`,
      schema: matchStateSchema,
      signal,
    }),
    enabled: organization !== null,
    // Ein 404 ist endgueltig: nicht weiter pollen, nicht wiederholen
    // (Probelauf 25.09.2026, Befund 3). Alles andere erholt sich von selbst.
    refetchInterval: (query) => matchRefetchInterval(query.state.error),
    retry: shouldRetryMatchLoad,
  });

  const back = matchBackLink({
    organizationId: organization?.id ?? "",
    encounterId: encounterId ?? null,
  });
  const message = organizationQuery.isPending
    ? "Organisation wird geladen …"
    : organizationQuery.error
      ? userFacingErrorMessage(organizationQuery.error)
      : organization === null
        ? "Keine zugängliche Organisation gefunden."
        : matchQuery.isPending
          ? "Match wird geladen …"
          : matchQuery.error
            ? matchLoadMessage(matchQuery.error)
            : null;

  if (message !== null || organization === null || matchQuery.data === undefined) {
    return (
      <main className="sektorenring flex min-h-screen items-center justify-center bg-sisal-200 px-4 py-6 text-chalk">
        <div className="flex flex-col items-start gap-3 rounded-xl border border-sisal-400 bg-sisal-100/80 p-5 text-body text-spider">
          <p role="status">{message}</p>
          {matchQuery.error && organization !== null ? (
            <a className="underline underline-offset-2" href={back.href}>
              {back.label}
            </a>
          ) : null}
        </div>
      </main>
    );
  }

  const match = matchQuery.data;
  const canScore = hasOrganizationPermission(organization.role, "match:score");
  const canAbort = hasOrganizationPermission(organization.role, "match:abort");

  return (
    <main className="sektorenring bg-sisal-200">
      <MatchScoreboard
        backHref={back.href}
        backLabel={back.label}
        canAbort={canAbort}
        canScore={canScore}
        match={match}
        organizationId={organization.id}
      />
    </main>
  );
}
