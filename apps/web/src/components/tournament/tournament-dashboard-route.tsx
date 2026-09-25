"use client";

import { hasOrganizationPermission } from "@darts-platform/domain";

import { CommandCentre } from "./command-centre";
import { userFacingErrorMessage } from "@/lib/api-client";
import { useTournamentOrganization } from "./use-tournament-organization";

export function TournamentDashboardRoute({ requestedOrganizationId, tournamentId }: {
  readonly requestedOrganizationId: string | undefined;
  readonly tournamentId: string;
}) {
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);
  if (query.isPending) return <Notice message="Organisation wird geladen …" />;
  if (query.error) return <Notice message={userFacingErrorMessage(query.error)} />;
  if (organization === null) return <Notice message="Keine zugängliche Organisation gefunden." />;
  const canCorrect = hasOrganizationPermission(organization.role, "tournament:update");
  // `tournament:share` -- eine eigene Berechtigung fuer die
  // Anzeige-Schluessel-Verwaltung (Task 6), zu unterscheiden von `canShare`
  // oben (`tournament:update`, ein Namenszufall -- siehe `display-keys-panel.tsx`).
  const canManageDisplayKeys = hasOrganizationPermission(organization.role, "tournament:share");
  const canDelete = hasOrganizationPermission(organization.role, "tournament:delete");
  return (
    <CommandCentre
      canCorrect={canCorrect}
      canDelete={canDelete}
      canManageDisplayKeys={canManageDisplayKeys}
      canShare={canCorrect}
      canWithdraw={canCorrect}
      organizationId={organization.id}
      tournamentId={tournamentId}
    />
  );
}

function Notice({ message }: { readonly message: string }) {
  return <main className="sektorenring min-h-screen px-5 py-12"><div className="mx-auto max-w-2xl border border-sisal-400 bg-sisal-100 p-6 font-plate text-wedge-900">{message}</div></main>;
}
