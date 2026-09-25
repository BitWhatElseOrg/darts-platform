"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { hasOrganizationPermission } from "@darts-platform/domain";
import {
  playerListSchema,
  teamListSchema,
  type OrganizationSummary,
} from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import { activeTeamsByPlayer } from "@/lib/list-filter";
import { WorkspaceShell } from "@/components/workspace-shell";

import { PlayerForm } from "./player-form";
import { PlayerList } from "./player-list";

export function RosterRoute({ requestedOrganizationId }: { readonly requestedOrganizationId: string | undefined }) {
  return (
    <WorkspaceShell
      lead="Spielerinnen und Spieler pflegen und Profile öffnen. Einladen und Rollen vergeben gehört zu Mitglieder."
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

  const canCreatePlayers = hasOrganizationPermission(organization.role, "player:create");
  const canEditPlayers = hasOrganizationPermission(organization.role, "player:update");
  const canArchivePlayers = hasOrganizationPermission(organization.role, "player:archive");
  const canDeletePlayers = hasOrganizationPermission(organization.role, "player:delete");

  // Fokusziel nach erfolgreichem endgueltigem Loeschen (Task 1): die Zeile
  // samt Loeschen-Button verschwindet mit ihr, `tabIndex={-1}` macht die
  // sonst nicht fokussierbare Ueberschrift zu einem gueltigen Ziel.
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <h2 className="font-numerals text-title font-bold text-white" ref={headingRef} tabIndex={-1}>
          Spieler
        </h2>

        {canCreatePlayers ? <PlayerForm organizationId={organization.id} /> : null}

        <PlayerList
          canArchive={canArchivePlayers}
          canDelete={canDeletePlayers}
          canEdit={canEditPlayers}
          headingRef={headingRef}
          isPending={playersQuery.isPending}
          organizationId={organization.id}
          players={playersQuery.data ?? []}
          teamsByPlayer={teamsByPlayer}
        />
      </section>
    </div>
  );
}
