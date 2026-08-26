"use client";

import { CommandCentre } from "./command-centre";
import { useTournamentOrganization } from "./use-tournament-organization";

export function TournamentDashboardRoute({ requestedOrganizationId, tournamentId }: {
  readonly requestedOrganizationId: string | undefined;
  readonly tournamentId: string;
}) {
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);
  if (query.isPending) return <Notice message="Organisation wird geladen …" />;
  if (query.error) return <Notice message={query.error.message} />;
  if (organization === null) return <Notice message="Keine zugängliche Organisation gefunden." />;
  const canCorrect = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(organization.role);
  return <CommandCentre canCorrect={canCorrect} organizationId={organization.id} tournamentId={tournamentId} />;
}

function Notice({ message }: { readonly message: string }) {
  return <main className="sektorenring min-h-screen px-5 py-12"><div className="mx-auto max-w-2xl border border-sisal-400 bg-sisal-100 p-6 font-plate text-wedge-900">{message}</div></main>;
}
