"use client";

import { useQuery } from "@tanstack/react-query";

import { playerListSchema, type OrganizationSummary } from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import { MatchWorkspace } from "@/components/match-workspace";
import { WorkspaceShell } from "@/components/workspace-shell";

export function MatchDirectoryRoute({ requestedOrganizationId }: { readonly requestedOrganizationId: string | undefined }) {
  return (
    <WorkspaceShell
      lead="Boards anlegen, Matches starten und laufende Partien im Blick behalten."
      requestedOrganizationId={requestedOrganizationId}
      title="Matches"
    >
      {(organization) => <MatchDirectory organization={organization} />}
    </WorkspaceShell>
  );
}

function MatchDirectory({ organization }: { readonly organization: OrganizationSummary }) {
  const playersQuery = useQuery({
    queryKey: ["players", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/players`, schema: playerListSchema, signal }),
  });

  return <MatchWorkspace organization={organization} players={playersQuery.data ?? []} />;
}
