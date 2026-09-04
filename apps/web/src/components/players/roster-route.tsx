"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  createInvitationSchema,
  createdInvitationSchema,
  createPlayerSchema,
  playerListSchema,
  playerSchema,
  type OrganizationSummary,
  type PlayerResponse,
} from "@darts-platform/schemas";
import { Button } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { WorkspaceShell } from "@/components/workspace-shell";

const playerFormSchema = createPlayerSchema.pick({ displayName: true, nickname: true });
const invitationFormSchema = createInvitationSchema;

type PlayerFormData = z.infer<typeof playerFormSchema>;
type InvitationFormData = z.infer<typeof invitationFormSchema>;

const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-body text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const labelClassName = "block text-body font-medium text-slate-300";

function messageFrom(error: unknown): string {
  return userFacingErrorMessage(error);
}

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
  const queryClient = useQueryClient();
  const playersQuery = useQuery({
    queryKey: ["players", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/players`, schema: playerListSchema, signal }),
  });
  const playerForm = useForm<PlayerFormData>({
    resolver: zodResolver(playerFormSchema),
    defaultValues: { displayName: "", nickname: null },
  });
  const invitationForm = useForm<InvitationFormData>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: { email: "", role: "MEMBER" },
  });
  const createPlayer = useMutation({
    mutationFn: (data: PlayerFormData) =>
      apiRequest({
        path: `/organizations/${organization.id}/players`,
        method: "POST",
        body: data,
        schema: playerSchema,
      }),
    onSuccess: async () => {
      playerForm.reset();
      await queryClient.invalidateQueries({ queryKey: ["players", organization.id] });
    },
  });
  const archivePlayer = useMutation({
    mutationFn: (playerId: string) =>
      apiRequest({
        path: `/organizations/${organization.id}/players/${playerId}`,
        method: "DELETE",
        schema: playerSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["players", organization.id] });
    },
  });
  const inviteMember = useMutation({
    mutationFn: (data: InvitationFormData) =>
      apiRequest({
        path: `/organizations/${organization.id}/invitations`,
        method: "POST",
        body: data,
        schema: createdInvitationSchema,
      }),
    onSuccess: () => invitationForm.reset(),
  });
  const canManageMembers = ["OWNER", "ADMIN"].includes(organization.role);
  const canCreatePlayers = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(organization.role);
  const canArchivePlayers = ["OWNER", "ADMIN"].includes(organization.role);

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <h2 className="font-numerals text-title font-bold text-white">Spieler</h2>

        {canCreatePlayers ? (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(event) => void playerForm.handleSubmit((data) => createPlayer.mutate(data))(event)}
          >
            <div className="space-y-2">
              <label className={labelClassName} htmlFor="player-display-name">Anzeigename</label>
              <input id="player-display-name" className={inputClassName} placeholder="Anzeigename" {...playerForm.register("displayName")} />
            </div>
            <div className="space-y-2">
              <label className={labelClassName} htmlFor="player-nickname">Spitzname (optional)</label>
              <input id="player-nickname" className={inputClassName} placeholder="Spitzname (optional)" {...playerForm.register("nickname")} />
            </div>
            <Button disabled={createPlayer.isPending} type="submit">Spieler hinzufügen</Button>
          </form>
        ) : null}

        {createPlayer.isError ? (
          <p role="alert" className="text-body text-rose-300">{messageFrom(createPlayer.error)}</p>
        ) : null}

        <div className="space-y-3">
          {playersQuery.isPending ? <p className="text-body text-slate-400">Spieler werden geladen …</p> : null}
          {playersQuery.data?.map((player) => (
            <PlayerRow
              canArchive={canArchivePlayers}
              canEdit={canCreatePlayers}
              key={player.id}
              onArchive={() => archivePlayer.mutate(player.id)}
              organizationId={organization.id}
              player={player}
            />
          ))}
          {playersQuery.data?.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-700 p-5 text-body text-slate-400">
              Noch keine Spieler vorhanden.
            </p>
          ) : null}
        </div>
      </section>

      {canManageMembers ? (
        <section className="space-y-4 border-t border-slate-800 pt-8">
          <div>
            <h2 className="font-numerals text-title font-bold text-white">Team</h2>
            <p className="mt-1 text-body text-slate-400">
              Lade Personen mit einer Rolle ein. Der Einladungscode wird nur einmal angezeigt.
            </p>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
            onSubmit={(event) => void invitationForm.handleSubmit((data) => inviteMember.mutate(data))(event)}
          >
            <div className="space-y-2">
              <label className={labelClassName} htmlFor="invitation-email">E-Mail-Adresse für Einladung</label>
              <input id="invitation-email" className={inputClassName} type="email" placeholder="member@example.com" {...invitationForm.register("email")} />
            </div>
            <div className="space-y-2">
              <label className={labelClassName} htmlFor="invitation-role">Rolle</label>
              <select id="invitation-role" className={inputClassName} {...invitationForm.register("role")}>
                <option value="ADMIN">Admin</option>
                <option value="TOURNAMENT_DIRECTOR">Turnierleitung</option>
                <option value="SCORER">Scorer</option>
                <option value="MEMBER">Mitglied</option>
                <option value="VIEWER">Zuschauer</option>
              </select>
            </div>
            <Button disabled={inviteMember.isPending} type="submit">Einladen</Button>
            {inviteMember.isSuccess ? (
              <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 sm:col-span-3">
                <p className="text-body text-emerald-100">
                  Einladung erstellt. Teile diesen einmal angezeigten Code sicher mit der eingeladenen Person.
                </p>
                <label className={labelClassName} htmlFor="created-invitation-claim">Einladungscode</label>
                <input
                  id="created-invitation-claim"
                  className={`${inputClassName} font-mono`}
                  readOnly
                  value={inviteMember.data.claimToken}
                />
              </div>
            ) : null}
            {inviteMember.isError ? (
              <p role="alert" className="text-body text-rose-300 sm:col-span-3">{messageFrom(inviteMember.error)}</p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}

function PlayerRow({
  player,
  organizationId,
  canEdit,
  canArchive,
  onArchive,
}: {
  readonly player: PlayerResponse;
  readonly organizationId: string;
  readonly canEdit: boolean;
  readonly canArchive: boolean;
  readonly onArchive: () => void;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(player.displayName);
  const updatePlayer = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/players/${player.id}`,
        method: "PATCH",
        body: { displayName },
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
          <input
            aria-label={`Anzeigename für ${player.displayName}`}
            className={inputClassName}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        ) : (
          <div>
            <p className="font-semibold text-white">{player.displayName}</p>
            <p className="text-caption text-slate-400">
              {player.nickname ?? "Kein Spitzname"} · {player.status === "ACTIVE" ? "Aktiv" : "Archiviert"}
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
          {messageFrom(updatePlayer.error)}
        </p>
      ) : null}
    </div>
  );
}
