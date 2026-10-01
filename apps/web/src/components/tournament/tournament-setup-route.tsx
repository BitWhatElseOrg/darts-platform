"use client";

import { useQuery } from "@tanstack/react-query";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { boardListSchema, playerListSchema } from "@darts-platform/schemas";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { SetupSheet } from "./setup-sheet";
import { useTournamentOrganization } from "./use-tournament-organization";

export function TournamentSetupRoute({ requestedOrganizationId }: { readonly requestedOrganizationId: string | undefined }) {
  const { query: organizationsQuery, organization } = useTournamentOrganization(requestedOrganizationId);
  const playersQuery = useQuery({
    // Mitglieder und Gäste: das Vereinsduell braucht beide, das klassische Turnier filtert selbst.
    queryKey: ["players", organization?.id, "ALL"],
    queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization?.id ?? ""}/players?kind=ALL`, schema: playerListSchema, signal }),
    enabled: organization !== null,
  });
  const boardsQuery = useQuery({
    queryKey: ["boards", organization?.id],
    queryFn: ({ signal }) => apiRequest({ path: `/organizations/${organization?.id ?? ""}/boards`, schema: boardListSchema, signal }),
    enabled: organization !== null,
  });

  if (organizationsQuery.isPending || playersQuery.isPending || boardsQuery.isPending) return <Notice message="Turnierdaten werden geladen …" />;
  const error = organizationsQuery.error ?? playersQuery.error ?? boardsQuery.error;
  if (error) return <Notice message={userFacingErrorMessage(error)} />;
  if (organization === null) return <Notice message="Lege zuerst eine Organisation an." />;
  if (!hasOrganizationPermission(organization.role, "tournament:create")) {
    return <Notice message="Dir fehlt die Berechtigung, Turniere anzulegen." />;
  }
  return (
    <SetupSheet
      boards={(boardsQuery.data ?? []).filter((board) => board.status === "AVAILABLE")}
      key={organization.id}
      organizationId={organization.id}
      organizationName={organization.name}
      players={(playersQuery.data ?? []).filter((player) => player.status === "ACTIVE")}
    />
  );
}

function Notice({ message }: { readonly message: string }) {
  return <main className="sektorenring min-h-screen px-5 py-12"><div className="mx-auto max-w-2xl border border-sisal-400 bg-sisal-100 p-6 font-plate text-wedge-900">{message}</div></main>;
}
