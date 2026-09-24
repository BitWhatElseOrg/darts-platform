"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { hasOrganizationPermission } from "@darts-platform/domain";
import {
  playerListSchema,
  teamListSchema,
  type OrganizationSummary,
} from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import { activeTeamsByPlayer } from "@/lib/list-filter";
import { WorkspaceShell } from "@/components/workspace-shell";

import { InvitationForm } from "./invitation-form";
import { PlayerForm } from "./player-form";
import { PlayerList } from "./player-list";

export function RosterRoute({ requestedOrganizationId }: { readonly requestedOrganizationId: string | undefined }) {
  return (
    <WorkspaceShell
      lead="Spielerinnen und Spieler pflegen, Profile öffnen und Mitglieder in die Organisation einladen."
      requestedOrganizationId={requestedOrganizationId}
      title="Spieler & Team"
    >
      {(organization) => <Roster organization={organization} />}
    </WorkspaceShell>
  );
}

function Roster({ organization }: { readonly organization: OrganizationSummary }) {
  const playersQuery = useQuery({
    queryKey: ["players", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/players`, schema: playerListSchema, signal }),
  });
  // Die Mannschaftszugehoerigkeit steht schon im Teams-Endpunkt; `team:read`
  // hat auch MEMBER. Deshalb braucht die Team-Spalte keine Aenderung an der
  // Spieler-API (Spec 2026-09-15, E2).
  const teamsQuery = useQuery({
    queryKey: ["teams", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/teams`, schema: teamListSchema, signal }),
  });

  const teamsByPlayer = useMemo(
    () => activeTeamsByPlayer(teamsQuery.data ?? []),
    [teamsQuery.data],
  );

  const canManageMembers = hasOrganizationPermission(organization.role, "organization:manage_members");
  const canCreatePlayers = hasOrganizationPermission(organization.role, "player:create");
  const canEditPlayers = hasOrganizationPermission(organization.role, "player:update");
  const canArchivePlayers = hasOrganizationPermission(organization.role, "player:archive");
  const canDeletePlayers = hasOrganizationPermission(organization.role, "player:delete");

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <h2 className="font-numerals text-title font-bold text-white">Spieler</h2>

        {canCreatePlayers ? <PlayerForm organizationId={organization.id} /> : null}

        <PlayerList
          canArchive={canArchivePlayers}
          canDelete={canDeletePlayers}
          canEdit={canEditPlayers}
          isPending={playersQuery.isPending}
          organizationId={organization.id}
          players={playersQuery.data ?? []}
          teamsByPlayer={teamsByPlayer}
        />
      </section>

      {canManageMembers ? (
        <section className="space-y-4 border-t border-slate-800 pt-8">
          <div>
            <h2 className="font-numerals text-title font-bold text-white">Team</h2>
            <p className="mt-1 text-body text-slate-400">
              Lade Personen mit einer Rolle ein. Der Einladungscode wird nur einmal angezeigt.
            </p>
          </div>
          <InvitationForm
            organizationId={organization.id}
            players={playersQuery.data ?? []}
          />
        </section>
      ) : null}
    </div>
  );
}
