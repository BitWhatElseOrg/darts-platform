"use client";

import { useQuery } from "@tanstack/react-query";
import { matchStateSchema } from "@darts-platform/schemas";

import { NavLink, PageNav } from "@/components/page-nav";
import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { useTournamentOrganization } from "../tournament/use-tournament-organization";
import { MatchScoreboard } from "./match-scoreboard";

export function MatchScoreboardRoute({ matchId, requestedOrganizationId }: {
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

  const backHref = "/";
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
      <main className="sektorenring flex min-h-screen flex-col px-4 py-6 text-white sm:px-6">
        <PageNav className="mt-0">
          <NavLink href={backHref}>Zurück</NavLink>
        </PageNav>
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900/80 p-5 text-body text-slate-300" role="status">
          {message}
        </p>
      </main>
    );
  }

  const match = matchQuery.data;
  const canScore = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR", "SCORER"].includes(organization.role);
  const canAbort = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(organization.role);

  return (
    <main className="sektorenring flex min-h-screen flex-col px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <PageNav className="mt-0 mb-0">
            <NavLink href={backHref}>Zurück</NavLink>
          </PageNav>
          <p className="truncate text-body text-slate-400" title={organization.name}>{organization.name}</p>
        </div>
        <h1
          className="mt-4 truncate font-numerals text-title font-bold text-white"
          title={`${match.participants[0].displayName} – ${match.participants[1].displayName}`}
        >
          {match.participants[0].displayName} <span className="text-slate-500">–</span> {match.participants[1].displayName}
        </h1>
        <div className="mt-4">
          <MatchScoreboard canAbort={canAbort} canScore={canScore} match={match} organizationId={organization.id} />
        </div>
      </div>
    </main>
  );
}

