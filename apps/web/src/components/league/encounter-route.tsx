"use client";

import { hasOrganizationPermission } from "@darts-platform/domain";

import { userFacingErrorMessage } from "@/lib/api-client";
import { EncounterCommandCentre } from "./encounter-command-centre";
import { useTournamentOrganization } from "@/components/tournament/use-tournament-organization";

/**
 * Die Rechte werden aus derselben Tabelle gelesen, die der Server benutzt.
 * Ein ausgeblendetes Bedienelement ist trotzdem keine Autorisierungsgrenze —
 * der Server prüft jede Mutation erneut (AGENTS.md §13).
 */
export function EncounterRoute({
  encounterId,
  requestedOrganizationId,
}: {
  readonly encounterId: string;
  readonly requestedOrganizationId: string | undefined;
}) {
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);
  if (query.isPending) return <Notice message="Organisation wird geladen …" />;
  if (query.error) return <Notice message={userFacingErrorMessage(query.error)} />;
  if (organization === null) return <Notice message="Keine zugängliche Organisation gefunden." />;

  return (
    <EncounterCommandCentre
      abilities={{
        manage: hasOrganizationPermission(organization.role, "encounter:manage"),
        lineup: hasOrganizationPermission(organization.role, "encounter:lineup"),
        score: hasOrganizationPermission(organization.role, "match:score"),
      }}
      encounterId={encounterId}
      organizationId={organization.id}
    />
  );
}

function Notice({ message }: { readonly message: string }) {
  return (
    <main className="sektorenring min-h-screen px-5 py-12">
      <div className="mx-auto max-w-2xl border border-sisal-400 bg-sisal-100 p-6 font-plate text-wedge-900">
        {message}
      </div>
    </main>
  );
}
