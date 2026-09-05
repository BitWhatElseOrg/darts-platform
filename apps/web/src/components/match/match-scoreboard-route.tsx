"use client";

import { useQuery } from "@tanstack/react-query";
import { matchStateSchema } from "@darts-platform/schemas";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
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
    refetchInterval: 4_000,
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
            ? userFacingErrorMessage(matchQuery.error)
            : null;

  if (message !== null || organization === null || matchQuery.data === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-6 text-white">
        <p className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 text-body text-slate-300" role="status">
          {message}
        </p>
      </main>
    );
  }

  const match = matchQuery.data;
  const canScore = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR", "SCORER"].includes(organization.role);
  const canAbort = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(organization.role);

  return (
    <main className="bg-slate-950">
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
