"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { hasOrganizationPermission } from "@darts-platform/domain";
import {
  createInvitationSchema,
  createOrganizationSchema,
  createPlayerSchema,
  invitationListSchema,
  invitationSchema,
  organizationListSchema,
  organizationSummarySchema,
  playerListSchema,
  playerSchema,
  type OrganizationSummary,
  type PlayerResponse,
} from "@darts-platform/schemas";
import { Button, buttonVariants, cn } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { MatchWorkspace } from "./match-workspace";

const organizationFormSchema = createOrganizationSchema.pick({
  name: true,
  slug: true,
});
const playerFormSchema = createPlayerSchema.pick({
  displayName: true,
  nickname: true,
});
const invitationFormSchema = createInvitationSchema;

type OrganizationFormData = z.infer<typeof organizationFormSchema>;
type PlayerFormData = z.infer<typeof playerFormSchema>;
type InvitationFormData = z.infer<typeof invitationFormSchema>;

const acceptedSchema = z.object({ accepted: z.literal(true) });
const inputClassName =
  "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30";
const labelClassName = "block text-sm font-medium text-slate-300";

function messageFrom(error: unknown): string {
  return userFacingErrorMessage(error);
}

interface TenantDashboardProps {
  readonly userName: string;
  readonly userEmail: string;
  readonly onSignOut: () => Promise<void>;
}

export function TenantDashboard({
  userName,
  userEmail,
  onSignOut,
}: TenantDashboardProps) {
  const queryClient = useQueryClient();
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(
    null,
  );
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/organizations", schema: organizationListSchema, signal }),
  });
  const invitationsQuery = useQuery({
    queryKey: ["invitations"],
    queryFn: ({ signal }) =>
      apiRequest({ path: "/invitations", schema: invitationListSchema, signal }),
  });

  const resolvedActiveOrganizationId =
    organizationsQuery.data?.some(
      (organization) => organization.id === activeOrganizationId,
    ) === true
      ? activeOrganizationId
      : (organizationsQuery.data?.[0]?.id ?? null);
  const activeOrganization = organizationsQuery.data?.find(
    (organization) => organization.id === resolvedActiveOrganizationId,
  );
  const tournamentOrganization =
    activeOrganization !== undefined &&
    hasOrganizationPermission(activeOrganization.role, "tournament:update")
      ? activeOrganization
      : organizationsQuery.data?.find((organization) =>
          hasOrganizationPermission(organization.role, "tournament:update"),
        );

  const acceptInvitation = useMutation({
    mutationFn: (invitationId: string) =>
      apiRequest({
        path: `/invitations/${invitationId}/accept`,
        method: "POST",
        schema: acceptedSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["invitations"] }),
      ]);
    },
  });

  return (
    <div className="w-full space-y-6">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{userName}</p>
          <p className="text-sm text-slate-400">{userEmail}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {tournamentOrganization !== undefined ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/turniere?organisation=${tournamentOrganization.id}`}
            >
              Turnierleitung
            </Link>
          ) : null}
          <Button variant="outline" onClick={() => void onSignOut()}>
            Abmelden
          </Button>
        </div>
      </section>

      {invitationsQuery.data?.length ? (
        <section className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5">
          <h2 className="font-semibold text-amber-100">Offene Einladungen</h2>
          <div className="mt-3 space-y-3">
            {invitationsQuery.data.map((invitation) => (
              <div
                className="flex flex-col gap-3 rounded-xl bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                key={invitation.id}
              >
                <p className="text-sm text-slate-200">
                  {invitation.organizationName ?? "Organisation"} · {roleLabel(invitation.role)}
                </p>
                <Button
                  disabled={acceptInvitation.isPending}
                  onClick={() => acceptInvitation.mutate(invitation.id)}
                >
                  Annehmen
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.5fr)]">
        <OrganizationsPanel
          activeOrganizationId={resolvedActiveOrganizationId}
          organizations={organizationsQuery.data ?? []}
          onSelect={setActiveOrganizationId}
        />

        {activeOrganization === undefined ? (
          <section className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
            Erstelle eine Organisation, um Spieler zu verwalten.
          </section>
        ) : (
          <OrganizationWorkspace organization={activeOrganization} />
        )}
      </div>
    </div>
  );
}

function OrganizationsPanel({
  organizations,
  activeOrganizationId,
  onSelect,
}: {
  readonly organizations: readonly OrganizationSummary[];
  readonly activeOrganizationId: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: { name: "", slug: "" },
  });
  const createOrganization = useMutation({
    mutationFn: (data: OrganizationFormData) =>
      apiRequest({
        path: "/organizations",
        method: "POST",
        body: data,
        schema: organizationSummarySchema,
      }),
    onSuccess: async (organization) => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      onSelect(organization.id);
    },
  });
  const submit = form.handleSubmit((data) => createOrganization.mutate(data));

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
      <h2 className="text-lg font-semibold text-white">Organisationen</h2>
      <div className="mt-4 space-y-2">
        {organizations.map((organization) => (
          <button
            className={cn(
              "min-h-12 w-full rounded-xl border px-4 text-left text-sm transition",
              organization.id === activeOrganizationId
                ? "border-emerald-400 bg-emerald-400/10 text-white"
                : "border-slate-800 text-slate-300 hover:border-slate-600",
            )}
            key={organization.id}
            onClick={() => onSelect(organization.id)}
            type="button"
          >
            <span className="block font-semibold">{organization.name}</span>
            <span className="text-xs text-slate-400">{roleLabel(organization.role)}</span>
          </button>
        ))}
      </div>

      <form className="mt-6 space-y-3 border-t border-slate-800 pt-5" onSubmit={(event) => void submit(event)}>
        <h3 className="text-sm font-semibold text-slate-200">Organisation erstellen</h3>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="organization-name">Organisationsname</label>
          <input id="organization-name" className={inputClassName} placeholder="Vereinsname" {...form.register("name")} />
        </div>
        <div className="space-y-2">
          <label className={labelClassName} htmlFor="organization-slug">Organisationskürzel</label>
          <input id="organization-slug" className={inputClassName} placeholder="club-slug" {...form.register("slug")} />
        </div>
        {createOrganization.isError ? (
          <p role="alert" className="text-sm text-rose-300">
            {messageFrom(createOrganization.error)}
          </p>
        ) : null}
        <Button className="w-full" disabled={createOrganization.isPending} type="submit">
          Erstellen
        </Button>
      </form>
    </section>
  );
}

function OrganizationWorkspace({
  organization,
}: {
  readonly organization: OrganizationSummary;
}) {
  const queryClient = useQueryClient();
  const playersQuery = useQuery({
    queryKey: ["players", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organization.id}/players`,
        schema: playerListSchema,
        signal,
      }),
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
        schema: invitationSchema,
      }),
    onSuccess: () => invitationForm.reset(),
  });
  const canManageMembers = ["OWNER", "ADMIN"].includes(organization.role);
  const canCreatePlayers = ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"].includes(
    organization.role,
  );
  const canArchivePlayers = ["OWNER", "ADMIN"].includes(organization.role);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6">
      <div className="flex flex-col gap-1 border-b border-slate-800 pb-5">
        <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">
          {organization.slug}
        </p>
        <h2 className="text-2xl font-semibold text-white">{organization.name}</h2>
      </div>

      {canCreatePlayers ? (
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
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
        <p role="alert" className="mt-3 text-sm text-rose-300">{messageFrom(createPlayer.error)}</p>
      ) : null}

      <div className="mt-6 space-y-3">
        {playersQuery.isPending ? <p className="text-sm text-slate-400">Spieler werden geladen …</p> : null}
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
          <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">
            Noch keine Spieler vorhanden.
          </p>
        ) : null}
      </div>

      <MatchWorkspace organization={organization} players={playersQuery.data ?? []} />

      {canManageMembers ? (
        <form
          className="mt-8 grid gap-3 border-t border-slate-800 pt-6 sm:grid-cols-[1fr_auto_auto] sm:items-end"
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
            <p className="text-sm text-emerald-300 sm:col-span-3">Einladung erstellt.</p>
          ) : null}
          {inviteMember.isError ? (
            <p role="alert" className="text-sm text-rose-300 sm:col-span-3">{messageFrom(inviteMember.error)}</p>
          ) : null}
        </form>
      ) : null}
    </section>
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
            <p className="text-xs text-slate-400">
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
              <Link className="inline-flex min-h-10 items-center rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-100" href={`/spieler/${player.id}?organisation=${organizationId}`}>Profil</Link>
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
        <p className="mt-2 text-sm text-rose-300" role="alert">
          {messageFrom(updatePlayer.error)}
        </p>
      ) : null}
    </div>
  );
}

function roleLabel(role: string): string {
  return ({ OWNER: "Inhaber", ADMIN: "Administration", TOURNAMENT_DIRECTOR: "Turnierleitung", SCORER: "Scorer", MEMBER: "Mitglied", VIEWER: "Zuschauer" } as Readonly<Record<string, string>>)[role] ?? role;
}
