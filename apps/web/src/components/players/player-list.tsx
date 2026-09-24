"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { z } from "zod";

import { playerSchema, type PlayerResponse } from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, ApiClientError, userFacingErrorMessage } from "@/lib/api-client";
import {
  defaultPlayerFilter,
  filterPlayers,
  teamFilterOptions,
  type PlayerFilter,
} from "@/lib/list-filter";
import { ListFilterBar } from "@/components/list-filter-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";

import { PlayerAvatar } from "./player-avatar";
import { PlayerEditDialog } from "./player-edit-dialog";

export function PlayerList({
  players,
  teamsByPlayer,
  organizationId,
  isPending,
  canEdit,
  canArchive,
  canDelete,
}: {
  readonly players: readonly PlayerResponse[];
  readonly teamsByPlayer: ReadonlyMap<string, readonly string[]>;
  readonly organizationId: string;
  readonly isPending: boolean;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
}) {
  const [filter, setFilter] = useState<PlayerFilter>(defaultPlayerFilter);

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
            canDelete={canDelete}
            canEdit={canEdit}
            key={player.id}
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
  canDelete,
}: {
  readonly player: PlayerResponse;
  readonly teams: readonly string[];
  readonly organizationId: string;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}`,
        method: "DELETE",
        schema: playerSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
      setArchiveConfirmOpen(false);
      setDeleteConfirmOpen(false);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}`,
        method: "PATCH",
        body: { status: "ACTIVE" },
        schema: playerSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}/permanent`,
        method: "DELETE",
        schema: z.undefined(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
      setDeleteConfirmOpen(false);
    },
  });

  const canOfferArchiveInstead =
    deleteMutation.isError &&
    deleteMutation.error instanceof ApiClientError &&
    deleteMutation.error.code === "PLAYER_HAS_HISTORY" &&
    player.status === "ACTIVE" &&
    canArchive;

  return (
    <div className="min-h-16 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <PlayerAvatar decorative organizationId={organizationId} player={player} size={40} />
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
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex min-h-10 items-center rounded-lg border border-slate-700 px-4 text-body font-medium text-slate-100" href={`/spieler/${player.id}?organisation=${organizationId}`}>Profil</Link>
          {canEdit ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Bearbeiten
            </Button>
          ) : null}
          {canArchive && player.status === "ACTIVE" ? (
            <Button
              variant="outline"
              onClick={() => {
                archiveMutation.reset();
                setArchiveConfirmOpen(true);
              }}
            >
              Archivieren
            </Button>
          ) : null}
          {canEdit && player.status === "INACTIVE" ? (
            <Button
              disabled={reactivateMutation.isPending}
              onClick={() => reactivateMutation.mutate()}
              variant="outline"
            >
              Reaktivieren
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="outline"
              onClick={() => {
                // Beide Mutationen zuruecksetzen, nicht nur deleteMutation:
                // ein vorheriger Archivieren-Fehlversuch (derselbe Spieler,
                // andere Aktion) darf im Loeschen-Dialog nicht als stille
                // Karteikarte wieder auftauchen.
                deleteMutation.reset();
                archiveMutation.reset();
                setDeleteConfirmOpen(true);
              }}
            >
              Löschen
            </Button>
          ) : null}
        </div>
      </div>
      {reactivateMutation.isError ? (
        <p className="mt-2 text-body text-rose-300" role="alert">
          {userFacingErrorMessage(reactivateMutation.error)}
        </p>
      ) : null}

      {editOpen ? (
        <PlayerEditDialog
          onClose={() => setEditOpen(false)}
          organizationId={organizationId}
          player={player}
        />
      ) : null}

      <ConfirmDialog
        confirmLabel="Archivieren"
        confirmVariant="primary"
        description={`${player.displayName} kann danach keine neuen Matches und Turniere bestreiten. Resultate und Statistik bleiben erhalten, und du kannst den Spieler jederzeit reaktivieren.`}
        error={archiveMutation.isError ? userFacingErrorMessage(archiveMutation.error) : null}
        onCancel={() => setArchiveConfirmOpen(false)}
        onConfirm={() => archiveMutation.mutate()}
        open={archiveConfirmOpen}
        pending={archiveMutation.isPending}
        title="Spieler archivieren"
      />

      <ConfirmDialog
        confirmLabel="Endgültig löschen"
        description={`${player.displayName} wird mit Profilbild und Statistik gelöscht. Das lässt sich nicht rückgängig machen. Spieler, die bereits gespielt haben oder in einem Turnier, Team oder einer Begegnung stehen, lassen sich nur archivieren.`}
        error={deleteMutation.isError ? userFacingErrorMessage(deleteMutation.error) : null}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        open={deleteConfirmOpen}
        pending={deleteMutation.isPending}
        title="Spieler endgültig löschen"
      >
        {canOfferArchiveInstead ? (
          <>
            <Button
              disabled={archiveMutation.isPending}
              onClick={() => archiveMutation.mutate()}
              type="button"
              variant="outline"
            >
              Stattdessen archivieren
            </Button>
            {archiveMutation.isError ? (
              <p className="text-body text-rose-300" role="alert">
                {userFacingErrorMessage(archiveMutation.error)}
              </p>
            ) : null}
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
