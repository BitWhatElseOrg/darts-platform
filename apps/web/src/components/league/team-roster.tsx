"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTeamSchema,
  playerListSchema,
  teamListSchema,
  teamSchema,
  type CreateTeamInput,
  type OrganizationSummary,
  type TeamMember,
  type TeamPlayerRole,
  type TeamResponse,
} from "@darts-platform/schemas";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { Control, Field, FieldRow, Rule, SelectInput, SheetLabel, StateTag, TextInput, Wedge } from "@darts-platform/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { NavLink, PageNav } from "@/components/page-nav";
import { useTournamentOrganization } from "@/components/tournament/use-tournament-organization";
import { calendarDate } from "@/lib/tournament-format";

/**
 * Formularwerte sind Zeichenketten; der Vertrag prüft beim Absenden. Das ist
 * dieselbe Aufteilung wie im Turnier-Setup: die Wahrheit steht im Zod-Schema,
 * nicht im Formularzustand.
 */
interface TeamFormValues {
  readonly name: string;
  readonly shortName: string;
}

const teamFieldMessages: Readonly<Record<string, string>> = {
  name: "Das Team braucht einen Namen, unter dem es in der Liste auffindbar ist.",
  shortName: "Der Kurzname ist höchstens 20 Zeichen lang.",
};

/** Der Kader ist zeitgültig; nur offene Mitgliedschaften spielen heute. */
function activeMembers(team: TeamResponse): readonly TeamMember[] {
  return team.members
    .filter((member) => member.validTo === null)
    .sort((first, second) => first.displayName.localeCompare(second.displayName, "de-CH"));
}

function roleLabel(role: TeamPlayerRole): string {
  return role === "CAPTAIN" ? "Captain" : "Spielerin oder Spieler";
}

export function TeamRoster({
  requestedOrganizationId,
}: {
  readonly requestedOrganizationId: string | undefined;
}) {
  const router = useRouter();
  const { query: organizationsQuery, organization } = useTournamentOrganization(
    requestedOrganizationId,
  );

  return (
    <main className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1100px] px-5 py-8 xl:px-9">
        <PageNav>
          <NavLink href="/">Übersicht</NavLink>
          {organization === null ? null : (
            <NavLink href={`/liga?organisation=${organization.id}`}>Liga</NavLink>
          )}
        </PageNav>

        <div>
          <h1 className="font-numerals text-headline font-bold text-wedge-900">
            Teams
          </h1>
          <p className="mt-1.5 max-w-[65ch] prose-de font-plate text-body text-sisal-500">
            Mannschaften und ihre Kader. Eine Meldung wird gegen den Kader zum Ansetzungszeitpunkt
            der Begegnung geprüft.
          </p>
        </div>

        <Rule className="mt-6" />

        {organizationsQuery.data && organizationsQuery.data.length > 1 ? (
          <div className="mt-5 max-w-sm">
            <Field htmlFor="team-organization" label="Organisation">
              <SelectInput
                id="team-organization"
                onChange={(event) => router.push(`/teams?organisation=${event.target.value}`)}
                value={organization?.id ?? ""}
              >
                {organizationsQuery.data.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : null}

        {organizationsQuery.isPending ? (
          <Notice>Organisation wird geladen …</Notice>
        ) : organizationsQuery.error ? (
          <Notice>{userFacingErrorMessage(organizationsQuery.error)}</Notice>
        ) : organization === null ? (
          <Notice>Lege zuerst auf der Startseite eine Organisation an.</Notice>
        ) : (
          <TeamList organization={organization} />
        )}

        <Rule className="mt-10" />
        <p className="pt-4 font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase">
          DartBase · Ligabetrieb · Serverdaten
        </p>
      </div>
    </main>
  );
}

function TeamList({ organization }: { readonly organization: OrganizationSummary }) {
  const queryClient = useQueryClient();
  const canManage = hasOrganizationPermission(organization.role, "team:manage");
  const teamsKey = ["teams", organization.id] as const;

  const teamsQuery = useQuery({
    queryKey: teamsKey,
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/teams`, schema: teamListSchema, signal }),
  });
  const playersQuery = useQuery({
    queryKey: ["players", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organization.id}/players`,
        schema: playerListSchema,
        signal,
      }),
  });

  const [formErrors, setFormErrors] = useState<Readonly<Record<string, string>>>({});
  const form = useForm<TeamFormValues>({ defaultValues: { name: "", shortName: "" } });
  const createTeam = useMutation({
    mutationFn: (data: CreateTeamInput) =>
      apiRequest({
        path: `/organizations/${organization.id}/teams`,
        method: "POST",
        body: data,
        schema: teamSchema,
      }),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: teamsKey });
    },
  });

  function submitTeam(values: TeamFormValues) {
    const parsed = createTeamSchema.safeParse({
      name: values.name,
      shortName: values.shortName.trim() === "" ? null : values.shortName,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        next[key] = teamFieldMessages[key] ?? issue.message;
      }
      setFormErrors(next);
      return;
    }
    setFormErrors({});
    createTeam.mutate(parsed.data);
  }

  if (teamsQuery.isPending || playersQuery.isPending) return <Notice>Teams werden geladen …</Notice>;
  if (teamsQuery.error) return <Notice>{userFacingErrorMessage(teamsQuery.error)}</Notice>;

  const teams = teamsQuery.data ?? [];
  const players = playersQuery.data ?? [];

  return (
    <div className="mt-7 flex flex-col gap-8">
      {canManage ? (
        <section aria-labelledby="team-create-heading">
          <SheetLabel as="h2" id="team-create-heading">
            Team anlegen
          </SheetLabel>
          <Rule className="mt-2" />
          <FieldRow
            as="form"
            className="mt-4 sm:grid-cols-[1fr_14rem_auto]"
            onSubmit={form.handleSubmit(submitTeam)}
          >
            <Field error={formErrors.name ?? null} htmlFor="team-name" label="Name">
              <TextInput
                aria-describedby={formErrors.name ? "team-name-error" : undefined}
                id="team-name"
                placeholder="Bulls Ost 1"
                {...form.register("name")}
              />
            </Field>
            <Field
              error={formErrors.shortName ?? null}
              hint="Kurzform für Tabellen, höchstens 20 Zeichen."
              htmlFor="team-short-name"
              label="Kurzname"
            >
              <TextInput id="team-short-name" placeholder="BUO1" {...form.register("shortName")} />
            </Field>
            <Control disabled={createTeam.isPending} type="submit" variant="go">
              {createTeam.isPending ? "Legt an …" : "Team anlegen"}
            </Control>
          </FieldRow>
          {createTeam.error ? (
            <Wedge className="mt-4 p-4" tone="alarm">
              <SheetLabel as="h3" tone="alarm">
                Team nicht angelegt
              </SheetLabel>
              <p className="mt-1.5 font-plate text-body text-wedge-900">
                {userFacingErrorMessage(createTeam.error)}
              </p>
            </Wedge>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="team-list-heading">
        <div className="flex items-baseline justify-between gap-3">
          <SheetLabel as="h2" id="team-list-heading">
            Mannschaften
          </SheetLabel>
          <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">
            {teams.length}
          </span>
        </div>
        <Rule className="mt-2" />

        {teams.length === 0 ? (
          <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-12 text-center">
            <p className="font-numerals text-title font-bold text-wedge-900">
              Noch kein Team angelegt
            </p>
            <p className="mx-auto mt-2 max-w-md font-plate text-body text-sisal-500">
              Ein Team führt einen Kader. Aus dem Kader wird am Spielabend die Aufstellung gemeldet;
              wer nicht im Kader steht, wird als Aushilfe erfasst.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            {teams.map((team) => (
              <TeamCard
                canManage={canManage}
                key={team.id}
                organizationId={organization.id}
                players={players}
                team={team}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TeamCard({
  canManage,
  organizationId,
  players,
  team,
}: {
  readonly canManage: boolean;
  readonly organizationId: string;
  readonly players: readonly { readonly id: string; readonly displayName: string }[];
  readonly team: TeamResponse;
}) {
  const queryClient = useQueryClient();
  const teamsKey = ["teams", organizationId] as const;
  const [playerId, setPlayerId] = useState("");
  const [role, setRole] = useState<TeamPlayerRole>("PLAYER");

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: teamsKey });
  };
  const addMember = useMutation({
    mutationFn: (input: { readonly playerId: string; readonly role: TeamPlayerRole }) =>
      apiRequest({
        path: `/organizations/${organizationId}/teams/${team.id}/members`,
        method: "POST",
        body: input,
        schema: teamSchema,
      }),
    onSuccess: async () => {
      setPlayerId("");
      await invalidate();
    },
  });
  const removeMember = useMutation({
    mutationFn: (memberPlayerId: string) =>
      apiRequest({
        path: `/organizations/${organizationId}/teams/${team.id}/members/${memberPlayerId}`,
        method: "DELETE",
        schema: teamSchema,
      }),
    onSuccess: invalidate,
  });
  const archiveTeam = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/organizations/${organizationId}/teams/${team.id}`,
        method: "PATCH",
        body: { status: "ARCHIVED" },
        schema: teamSchema,
      }),
    onSuccess: invalidate,
  });

  const members = activeMembers(team);
  const memberIds = new Set(members.map((member) => member.playerId));
  const selectable = players.filter((player) => !memberIds.has(player.id));
  const busy = addMember.isPending || removeMember.isPending || archiveTeam.isPending;
  const error = addMember.error ?? removeMember.error ?? archiveTeam.error;

  return (
    <Wedge aria-labelledby={`team-${team.id}-heading`} as="article" className="p-5" tone="plate">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3
            className="font-numerals text-title font-bold text-wedge-900"
            id={`team-${team.id}-heading`}
          >
            {team.name}
          </h3>
          <p className="mt-0.5 font-plate text-body text-sisal-500">
            {team.shortName ?? "ohne Kurzname"} · {members.length}{" "}
            {members.length === 1 ? "Person" : "Personen"} im Kader
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StateTag
            label={team.status === "ACTIVE" ? "aktiv" : "archiviert"}
            tone={team.status === "ACTIVE" ? "free" : "blocked"}
          />
          {canManage && team.status === "ACTIVE" ? (
            <Control
              density="tight"
              disabled={busy}
              onClick={() => archiveTeam.mutate()}
              variant="wire"
            >
              Archivieren
            </Control>
          ) : null}
        </div>
      </div>

      <Rule className="mt-4" />

      {members.length === 0 ? (
        <p className="mt-4 font-plate text-body text-sisal-500">
          Der Kader ist leer. Ohne Kader kann für dieses Team nur mit Aushilfen gemeldet werden.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col">
          {members.map((member) => (
            <li
              className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-sisal-300 py-3"
              key={member.playerId}
            >
              <span className="min-w-0 flex-1 font-plate text-field text-wedge-900">
                {member.displayName}
              </span>
              <span className="font-plate text-caption tracking-[0.1em] text-sisal-500 uppercase">
                {roleLabel(member.role)}
              </span>
              <span className="font-plate text-caption text-sisal-500">
                seit {calendarDate(member.validFrom)}
              </span>
              {canManage ? (
                <Control
                  density="tight"
                  disabled={busy}
                  onClick={() => removeMember.mutate(member.playerId)}
                  variant="wire"
                >
                  Aus dem Kader nehmen
                </Control>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && team.status === "ACTIVE" ? (
        <FieldRow
          as="form"
          className="mt-4 sm:grid-cols-[1fr_14rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (playerId === "") return;
            addMember.mutate({ playerId, role });
          }}
        >
          <Field
            {...(selectable.length === 0
              ? { hint: "Alle Personen der Organisation stehen bereits im Kader." }
              : {})}
            htmlFor={`team-${team.id}-player`}
            label="Person aufnehmen"
          >
            <SelectInput
              disabled={selectable.length === 0}
              id={`team-${team.id}-player`}
              onChange={(event) => setPlayerId(event.target.value)}
              value={playerId}
            >
              <option value="">Person wählen …</option>
              {selectable.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.displayName}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field htmlFor={`team-${team.id}-role`} label="Rolle">
            <SelectInput
              id={`team-${team.id}-role`}
              onChange={(event) => setRole(event.target.value === "CAPTAIN" ? "CAPTAIN" : "PLAYER")}
              value={role}
            >
              <option value="PLAYER">Spielerin oder Spieler</option>
              <option value="CAPTAIN">Captain</option>
            </SelectInput>
          </Field>
          <Control disabled={busy || playerId === ""} type="submit" variant="plate">
            Aufnehmen
          </Control>
        </FieldRow>
      ) : null}

      {error ? (
        <p className="mt-3 font-plate text-body text-ring-red-deep" role="alert">
          {userFacingErrorMessage(error)}
        </p>
      ) : null}

      {players.length === 0 ? (
        <p className="mt-3 font-plate text-body text-sisal-500">
          Diese Organisation führt noch keine Spieler.{" "}
          <Link className="underline underline-offset-4" href={`/spieler?organisation=${organizationId}`}>
            Spieler anlegen
          </Link>
        </p>
      ) : null}
    </Wedge>
  );
}


function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-10 text-center font-plate text-body text-wedge-900">
      {children}
    </div>
  );
}
