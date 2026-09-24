"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState, type RefObject } from "react";
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

/**
 * Einmal je Liste statt je Zeile (Task 1): vorher registrierte jede
 * `PlayerRow` eigene `ConfirmDialog`-Instanzen (Archivieren, Löschen) und bei
 * Bedarf einen `PlayerEditDialog`, jede mit eigenem dokumentweiten
 * `focusout`-Listener aus `useDialogFocusReturn`. Diese diskriminierte Union
 * erzwingt zusaetzlich Exklusivitaet: es kann nie mehr als eine Absicht
 * gleichzeitig offen sein (vorher konnten z. B. das Archivieren-Dialog von
 * Spieler A und das Loeschen-Dialog von Spieler B gleichzeitig offen bleiben,
 * weil jede Zeile ihren eigenen Zustand hielt).
 */
type PlayerDialogState =
  | { readonly kind: "edit"; readonly player: PlayerResponse }
  | { readonly kind: "archive"; readonly player: PlayerResponse }
  | { readonly kind: "delete"; readonly player: PlayerResponse };

export function PlayerList({
  players,
  teamsByPlayer,
  organizationId,
  isPending,
  canEdit,
  canArchive,
  canDelete,
  headingRef,
}: {
  readonly players: readonly PlayerResponse[];
  readonly teamsByPlayer: ReadonlyMap<string, readonly string[]>;
  readonly organizationId: string;
  readonly isPending: boolean;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  // Ziel fuer den Fokus nach erfolgreichem endgueltigem Loeschen (Task 1):
  // die Zeile samt Loeschen-Button verschwindet, `useDialogFocusReturn`
  // faende also kein Rueckgabeziel mehr vor. `roster-route.tsx` uebergibt
  // hier den Ref auf die Ueberschrift "Spieler".
  readonly headingRef?: RefObject<HTMLElement | null>;
}) {
  const [filter, setFilter] = useState<PlayerFilter>(defaultPlayerFilter);
  const [dialog, setDialog] = useState<PlayerDialogState | null>(null);
  const [deletedAnnouncement, setDeletedAnnouncement] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Laeuft erst, NACHDEM das Kind `ConfirmDialog` seinen eigenen
  // schliessenden Effekt (Fokus-Rueckgabe an den -- nach dem Loeschen bereits
  // entfernten -- auslösenden Button) durchlaufen hat: React fuehrt Effekte
  // von Kindern vor denen der Elternkomponente aus. Der Griff auf die
  // Ueberschrift gewinnt dadurch deterministisch, statt auf einen Timer zu
  // setzen.
  useEffect(() => {
    if (deletedAnnouncement !== null) headingRef?.current?.focus();
  }, [deletedAnnouncement, headingRef]);

  const invalidatePlayers = () => queryClient.invalidateQueries({ queryKey: ["players", organizationId] });

  const archiveMutation = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}`,
        method: "DELETE",
        schema: playerSchema,
      }),
    onSuccess: async () => {
      await invalidatePlayers();
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}/permanent`,
        method: "DELETE",
        schema: z.undefined(),
      }),
    onSuccess: async () => {
      const deletedName = dialog !== null && dialog.kind === "delete" ? dialog.player.displayName : "Der Spieler";
      await invalidatePlayers();
      setDialog(null);
      setDeletedAnnouncement(`${deletedName} wurde gelöscht.`);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${playerId}`,
        method: "PATCH",
        body: { status: "ACTIVE" },
        schema: playerSchema,
      }),
    onSuccess: () => invalidatePlayers(),
  });

  const openEdit = (player: PlayerResponse) => {
    setDeletedAnnouncement(null);
    setDialog({ kind: "edit", player });
  };
  const openArchive = (player: PlayerResponse) => {
    setDeletedAnnouncement(null);
    archiveMutation.reset();
    setDialog({ kind: "archive", player });
  };
  const openDelete = (player: PlayerResponse) => {
    // Beide Mutationen zuruecksetzen, nicht nur deleteMutation: ein
    // vorheriger Archivieren-Fehlversuch (derselbe oder ein anderer Spieler,
    // da die Mutation jetzt Listen- statt Zeilen-Zustand ist) darf im
    // Loeschen-Dialog nicht als stille Karteikarte wieder auftauchen.
    setDeletedAnnouncement(null);
    deleteMutation.reset();
    archiveMutation.reset();
    setDialog({ kind: "delete", player });
  };

  const canOfferArchiveInstead =
    dialog !== null &&
    dialog.kind === "delete" &&
    deleteMutation.isError &&
    deleteMutation.error instanceof ApiClientError &&
    deleteMutation.error.code === "PLAYER_HAS_HISTORY" &&
    dialog.player.status === "ACTIVE" &&
    canArchive;

  const archiveDescription =
    dialog !== null
      ? `${dialog.player.displayName} kann danach keine neuen Matches und Turniere bestreiten. Resultate und Statistik bleiben erhalten, und du kannst den Spieler jederzeit reaktivieren.`
      : "";
  const deleteDescription =
    dialog !== null
      ? `${dialog.player.displayName} wird mit Profilbild und Statistik gelöscht. Das lässt sich nicht rückgängig machen. Spieler, die bereits gespielt haben oder in einem Turnier, Team oder einer Begegnung stehen, lassen sich nur archivieren.${
          dialog.player.hasAccount
            ? " Die Verknüpfung mit dem Benutzerkonto wird dabei aufgehoben; das Konto selbst bleibt bestehen."
            : ""
        }`
      : "";

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

      {deletedAnnouncement !== null ? (
        <p className="text-body text-slate-300" role="status">
          {deletedAnnouncement}
        </p>
      ) : null}

      <div className="space-y-3">
        {isPending ? <p className="text-body text-slate-400">Spieler werden geladen …</p> : null}
        {visible.map((player) => (
          <PlayerRow
            canArchive={canArchive}
            canDelete={canDelete}
            canEdit={canEdit}
            key={player.id}
            onArchive={openArchive}
            onDelete={openDelete}
            onEdit={openEdit}
            onReactivate={(target) => reactivateMutation.mutate(target.id)}
            organizationId={organizationId}
            player={player}
            reactivateError={
              reactivateMutation.isError && reactivateMutation.variables === player.id
                ? userFacingErrorMessage(reactivateMutation.error)
                : null
            }
            reactivatePending={reactivateMutation.isPending && reactivateMutation.variables === player.id}
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

      {dialog?.kind === "edit" ? (
        <PlayerEditDialog onClose={() => setDialog(null)} organizationId={organizationId} player={dialog.player} />
      ) : null}

      <ConfirmDialog
        confirmLabel={dialog?.kind === "archive" ? "Archivieren" : "Endgültig löschen"}
        confirmVariant={dialog?.kind === "archive" ? "primary" : "danger"}
        description={dialog?.kind === "archive" ? archiveDescription : deleteDescription}
        error={
          dialog?.kind === "archive"
            ? archiveMutation.isError
              ? userFacingErrorMessage(archiveMutation.error)
              : null
            : dialog?.kind === "delete"
              ? deleteMutation.isError
                ? userFacingErrorMessage(deleteMutation.error)
                : null
              : null
        }
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog === null) return;
          if (dialog.kind === "archive") archiveMutation.mutate(dialog.player.id);
          else if (dialog.kind === "delete") deleteMutation.mutate(dialog.player.id);
        }}
        open={dialog?.kind === "archive" || dialog?.kind === "delete"}
        pending={dialog?.kind === "archive" ? archiveMutation.isPending : deleteMutation.isPending}
        title={dialog?.kind === "archive" ? "Spieler archivieren" : "Spieler endgültig löschen"}
      >
        {canOfferArchiveInstead ? (
          <>
            <Button
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (dialog !== null) archiveMutation.mutate(dialog.player.id);
              }}
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

function PlayerRow({
  player,
  teams,
  organizationId,
  canEdit,
  canArchive,
  canDelete,
  onEdit,
  onArchive,
  onDelete,
  onReactivate,
  reactivatePending,
  reactivateError,
}: {
  readonly player: PlayerResponse;
  readonly teams: readonly string[];
  readonly organizationId: string;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  readonly onEdit: (player: PlayerResponse) => void;
  readonly onArchive: (player: PlayerResponse) => void;
  readonly onDelete: (player: PlayerResponse) => void;
  readonly onReactivate: (player: PlayerResponse) => void;
  readonly reactivatePending: boolean;
  readonly reactivateError: string | null;
}) {
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
            <Button variant="outline" onClick={() => onEdit(player)}>
              Bearbeiten
            </Button>
          ) : null}
          {canArchive && player.status === "ACTIVE" ? (
            <Button variant="outline" onClick={() => onArchive(player)}>
              Archivieren
            </Button>
          ) : null}
          {canEdit && player.status === "INACTIVE" ? (
            <Button disabled={reactivatePending} onClick={() => onReactivate(player)} variant="outline">
              Reaktivieren
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="outline" onClick={() => onDelete(player)}>
              Löschen
            </Button>
          ) : null}
        </div>
      </div>
      {reactivateError !== null ? (
        <p className="mt-2 text-body text-rose-300" role="alert">
          {reactivateError}
        </p>
      ) : null}
    </div>
  );
}
