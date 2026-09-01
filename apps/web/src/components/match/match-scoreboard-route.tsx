"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { matchStateSchema } from "@darts-platform/schemas";

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
      <main className="flex min-h-screen flex-col bg-slate-950 px-4 py-6 text-white sm:px-6">
        <BackLink href={backHref} />
        <p className="mt-8 rounded-xl border border-slate-800 bg-slate-900/80 p-5 text-sm text-slate-300" role="status">
          {message}
        </p>
      </main>
    );
  }

  const match = matchQuery.data;
  const canScore = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR", "SCORER"].includes(organization.role);
  const canAbort = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(organization.role);

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <BackLink href={backHref} />
          <p className="truncate text-sm text-slate-400">{organization.name}</p>
        </div>
        <h1 className="mt-4 truncate text-xl font-bold text-white sm:text-2xl">
          {match.participants[0].displayName} <span className="text-slate-500">–</span> {match.participants[1].displayName}
        </h1>
        <div className="mt-4">
          <MatchScoreboard canAbort={canAbort} canScore={canScore} match={match} organizationId={organization.id} />
        </div>
      </div>
    </main>
  );
}

function BackLink({ href }: { readonly href: string }) {
  return (
    <Link
      className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-emerald-300 transition hover:text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
      href={href}
    >
      ‹ Zurück
    </Link>
  );
}
