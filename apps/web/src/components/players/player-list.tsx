"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";

import { playerSchema, type PlayerResponse } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import {
  defaultPlayerFilter,
  filterPlayers,
  teamFilterOptions,
  type PlayerFilter,
} from "@/lib/list-filter";
import { ListFilterBar } from "@/components/list-filter-bar";

import { inputClassName } from "./form-styles";

export function PlayerList({
  players,
  teamsByPlayer,
  organizationId,
  isPending,
  canEdit,
  canArchive,
}: {
  readonly players: readonly PlayerResponse[];
  readonly teamsByPlayer: ReadonlyMap<string, readonly string[]>;
  readonly organizationId: string;
  readonly isPending: boolean;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<PlayerFilter>(defaultPlayerFilter);
  const archivePlayer = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}`,
        method: "DELETE",
        schema: playerSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
    },
  });

  const visible = useMemo(
    () => filterPlayers(players, filter, teamsByPlayer),
    [players, filter, teamsByPlayer],
  );
  const teamOptions = useMemo(() => teamFilterOptions(teamsByPlayer), [teamsByPlayer]);
  const isFiltered =
    filter.search.length > 0 ||
    filter.status !== "ALL" ||
    filter.teamId !== "ALL" ||
    filter.account !== "ALL";

  return (
    <div className="space-y-4">
      <ListFilterBar
        isFiltered={isFiltered}
        onReset={() => setFilter(defaultPlayerFilter)}
        onSearchChange={(search) => setFilter((current) => ({ ...current, search }))}
        resultLabel={`${visible.length} von ${players.length} Spielern`}
        search={filter.search}
        searchId="player-search"
        searchLabel="Spieler suchen"
        searchPlaceholder="Name oder Spitzname"
        selects={[
          {
            id: "player-status-filter",
            label: "Status",
            value: filter.status,
            onChange: (value) =>
              setFilter((current) => ({
                ...current,
                status: value as PlayerFilter["status"],
              })),
            options: [
              { value: "ALL", label: "Alle" },
              { value: "ACTIVE", label: "Aktiv" },
              { value: "INACTIVE", label: "Archiviert" },
            ],
          },
          {
            id: "player-team-filter",
            label: "Team",
            value: filter.teamId,
            onChange: (value) => setFilter((current) => ({ ...current, teamId: value })),
            options: [
              { value: "ALL", label: "Alle" },
              { value: "NONE", label: "Ohne Team" },
              ...teamOptions.map((team) => ({ value: team, label: team })),
            ],
          },
          {
            id: "player-account-filter",
            label: "Konto",
            value: filter.account,
            onChange: (value) =>
              setFilter((current) => ({
                ...current,
                account: value as PlayerFilter["account"],
              })),
            options: [
              { value: "ALL", label: "Alle" },
              { value: "WITH", label: "Mit Konto" },
              { value: "WITHOUT", label: "Ohne Konto" },
            ],
          },
        ]}
      />

      <div className="space-y-3">
        {isPending ? <p className="text-body text-slate-400">Spieler werden geladen …</p> : null}
        {visible.map((player) => (
          <PlayerRow
            canArchive={canArchive}
            canEdit={canEdit}
            key={player.id}
            onArchive={() => archivePlayer.mutate(player.id)}
            organizationId={organizationId}
            player={player}
            teams={teamsByPlayer.get(player.id) ?? []}
          />
        ))}
        {!isPending && players.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-5 text-body text-slate-400">
            Noch keine Spieler vorhanden.
          </p>
        ) : null}
        {!isPending && players.length > 0 && visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-5 text-body text-slate-400">
            Kein Spieler passt zu diesen Filtern.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  teams,
  organizationId,
  canEdit,
  canArchive,
  onArchive,
}: {
  readonly player: PlayerResponse;
  readonly teams: readonly string[];
  readonly organizationId: string;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly onArchive: () => void;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(player.displayName);
  const [nickname, setNickname] = useState(player.nickname ?? "");
  const updatePlayer = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}`,
        method: "PATCH",
        body: { displayName, nickname: nickname.trim().length === 0 ? null : nickname },
        schema: playerSchema,
      }),
    onSuccess: async () => {
      setIsEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
    },
  });

  return (
    <div className="min-h-16 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {isEditing ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              aria-label={`Anzeigename für ${player.displayName}`}
              className={inputClassName}
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
            <input
              aria-label={`Spitzname für ${player.displayName}`}
              className={inputClassName}
              placeholder="Spitzname (optional)"
              onChange={(event) => setNickname(event.target.value)}
              value={nickname}
            />
          </div>
        ) : (
          <div>
            <p className="font-semibold text-white">{player.displayName}</p>
            <p className="text-caption text-slate-400">
              {player.nickname ?? "Kein Spitzname"} · {player.status === "ACTIVE" ? "Aktiv" : "Archiviert"}
              {" · "}
              {teams.length > 0 ? teams.join(", ") : "Ohne Team"}
              {" · "}
              {player.hasAccount ? "Konto verknüpft" : "Kein Konto verknüpft"}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {isEditing ? (
            <>
              <Button
                disabled={displayName.trim().length === 0 || updatePlayer.isPending}
                onClick={() => updatePlayer.mutate()}
              >
                Speichern
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDisplayName(player.displayName);
                  setNickname(player.nickname ?? "");
                  setIsEditing(false);
                }}
              >
                Abbrechen
              </Button>
            </>
          ) : (
            <>
              <Link className="inline-flex min-h-10 items-center rounded-lg border border-slate-700 px-4 text-body font-medium text-slate-100" href={`/spieler/${player.id}?organisation=${organizationId}`}>Profil</Link>
              {canEdit ? (
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  Bearbeiten
                </Button>
              ) : null}
              {canArchive && player.status === "ACTIVE" ? (
                <Button variant="outline" onClick={onArchive}>Archivieren</Button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {updatePlayer.isError ? (
        <p className="mt-2 text-body text-rose-300" role="alert">
          {userFacingErrorMessage(updatePlayer.error)}
        </p>
      ) : null}
    </div>
  );
}
