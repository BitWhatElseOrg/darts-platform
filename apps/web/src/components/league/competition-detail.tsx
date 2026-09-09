"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  competitionDetailSchema,
  createEncounterSchema,
  encounterDetailSchema,
  encounterListSchema,
  teamListSchema,
  type CompetitionDetail as CompetitionDetailResponse,
  type CreateEncounterInput,
  type OrganizationSummary,
} from "@darts-platform/schemas";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { Control, Field, FieldRow, Rule, SelectInput, SheetLabel, StateTag, TextInput, Wedge } from "@darts-platform/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import {
  competitionStatusLabel,
  encounterOutcomeLabel,
  encounterStatusLabel,
  encounterTone,
} from "@/lib/league-format";
import { calendarDate, clockTime } from "@/lib/tournament-format";
import { StandingsTable } from "./standings-table";
import { PlayerRankingTable } from "./player-ranking-table";
import { TemplateTable } from "./template-table";
import { NavLink, PageNav } from "@/components/page-nav";
import { useTournamentOrganization } from "@/components/tournament/use-tournament-organization";

interface ScheduleFormValues {
  readonly matchday: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly scheduledAt: string;
  readonly venue: string;
}

const messages: Readonly<Record<string, string>> = {
  matchday: "Der Spieltag ist eine Zahl ab 1.",
  homeTeamId: "Wähle die Heimmannschaft.",
  awayTeamId: "Wähle die Gastmannschaft; sie muss eine andere sein.",
  scheduledAt: "Wähle Datum und Zeit des Spielabends.",
};

export function CompetitionDetail({
  competitionId,
  requestedOrganizationId,
}: {
  readonly competitionId: string;
  readonly requestedOrganizationId: string | undefined;
}) {
  const { query, organization } = useTournamentOrganization(requestedOrganizationId);

  return (
    <main className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1100px] px-5 py-8 xl:px-9">
        <PageNav>
          <NavLink href={organization === null ? "/liga" : `/liga?organisation=${organization.id}`}>
            Alle Wettbewerbe
          </NavLink>
          {organization === null ? null : (
            <NavLink href={`/teams?organisation=${organization.id}`}>Teams</NavLink>
          )}
        </PageNav>

        {query.isPending ? (
          <Notice>Organisation wird geladen …</Notice>
        ) : organization === null ? (
          <Notice>Keine zugängliche Organisation gefunden.</Notice>
        ) : (
          <CompetitionBody competitionId={competitionId} organization={organization} />
        )}
      </div>
    </main>
  );
}

function CompetitionBody({
  competitionId,
  organization,
}: {
  readonly competitionId: string;
  readonly organization: OrganizationSummary;
}) {
  const competitionQuery = useQuery({
    queryKey: ["competition", organization.id, competitionId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organization.id}/competitions/${competitionId}`,
        schema: competitionDetailSchema,
        signal,
      }),
  });
  const encountersQuery = useQuery({
    queryKey: ["encounters", organization.id, competitionId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organization.id}/competitions/${competitionId}/encounters`,
        schema: encounterListSchema,
        signal,
      }),
  });

  if (competitionQuery.isPending) return <Notice>Wettbewerb wird geladen …</Notice>;
  if (competitionQuery.data === undefined) {
    return <Notice>{userFacingErrorMessage(competitionQuery.error)}</Notice>;
  }

  const competition = competitionQuery.data;
  const canManageEncounters = hasOrganizationPermission(organization.role, "encounter:manage");
  const encounters = [...(encountersQuery.data ?? [])].sort(
    (first, second) => second.matchday - first.matchday,
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-numerals text-headline font-bold text-wedge-900">
            {competition.name}
          </h1>
          <p className="mt-1.5 font-plate text-body text-sisal-500">
            {competition.slug} · {competition.slotCount} Spiele je Begegnung
          </p>
        </div>
        <StateTag
          label={competitionStatusLabel(competition.status)}
          tone={competition.status === "ACTIVE" ? "live" : "waiting"}
        />
      </div>

      <Rule className="mt-6" />

      <p className="mt-4 max-w-[65ch] prose-de font-plate text-body text-wedge-900">
        {competition.pointsWin} Punkte für den Sieg, bei Gleichstand je {competition.pointsDraw}
        {competition.deciderRule === "EXTRA_SLOT"
          ? ` und ${competition.pointsDeciderBonus} Zusatzpunkt für den Sieger des Entscheidungsdoppels`
          : ""}
        . {competition.lineupPositions} Aufstellungspositionen, Mindestmeldung{" "}
        {competition.minNominations}, im Ausnahmefall {competition.minNominationsShorthanded},
        höchstens {competition.maxSubstitutionsPerEncounter} Auswechslungen je Begegnung.
      </p>

      <details className="mt-6 border border-sisal-400 bg-sisal-100 p-4">
        <summary className="cursor-pointer font-plate text-body font-semibold text-wedge-900">
          Begegnungsvorlage · {competition.slots.length} Spiele
        </summary>
        <div className="mt-4">
          <TemplateTable slots={competition.slots} />
        </div>
      </details>

      <StandingsTable competitionId={competitionId} organizationId={organization.id} />

      <PlayerRankingTable competitionId={competitionId} organizationId={organization.id} />

      {canManageEncounters ? (
        <ScheduleSection competition={competition} organization={organization} />
      ) : null}

      <section aria-labelledby="encounters-heading" className="mt-9">
        <div className="flex items-baseline justify-between gap-3">
          <SheetLabel as="h2" id="encounters-heading">
            Begegnungen
          </SheetLabel>
          <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">
            {encounters.length}
          </span>
        </div>
        <Rule className="mt-2" />

        {encountersQuery.isPending ? (
          <Notice>Begegnungen werden geladen …</Notice>
        ) : encounters.length === 0 ? (
          <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-12 text-center">
            <p className="font-numerals text-title font-bold text-wedge-900">
              Noch keine Begegnung angesetzt
            </p>
            <p className="mx-auto mt-2 max-w-md font-plate text-body text-sisal-500">
              Der Ablauf eines Spieltags: Begegnung ansetzen, beide Meldungen erfassen, starten. Die
              Doppelpaarungen folgen erst am Abend.
            </p>
          </div>
        ) : (
          <ul className="mt-4">
            {encounters.map((encounter) => (
              <li className="border-b border-sisal-300" key={encounter.id}>
                <Link
                  className="group flex flex-wrap items-center gap-x-6 gap-y-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
                  href={`/liga/begegnungen/${encounter.id}?organisation=${organization.id}`}
                >
                  <div className="w-20 shrink-0">
                    <SheetLabel>Spieltag</SheetLabel>
                    <p className="mt-1 font-numerals text-title font-bold tabular text-wedge-900">
                      {encounter.matchday}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 basis-[calc(100%-6.5rem)] sm:basis-0">
                    <h3 className="font-numerals text-title font-bold text-wedge-900 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                      {encounter.homeTeamName} gegen {encounter.awayTeamName}
                    </h3>
                    <p className="mt-0.5 font-plate text-body text-sisal-500">
                      {calendarDate(encounter.scheduledAt)} · {clockTime(encounter.scheduledAt)} Uhr
                      {encounter.venue === null ? "" : ` · ${encounter.venue}`}
                    </p>
                  </div>
                  <div className="min-w-0 basis-full shrink-0 sm:w-52 sm:basis-auto">
                    <SheetLabel>Stand</SheetLabel>
                    <p className="mt-1 font-plate text-body tabular text-wedge-900">
                      {encounter.homePoints}:{encounter.awayPoints} Punkte · {encounter.homeGames}:
                      {encounter.awayGames} Spiele · {encounter.homeLegs}:{encounter.awayLegs} Sätze
                    </p>
                  </div>
                  <div className="min-w-0 basis-full shrink-0 sm:w-36 sm:basis-auto">
                    <SheetLabel>Zustand</SheetLabel>
                    <p className="mt-1.5">
                      <StateTag
                        label={encounterStatusLabel(encounter.status)}
                        tone={encounterTone(encounter.status)}
                      />
                    </p>
                    {encounter.result === null ? null : (
                      <p className="mt-1 font-plate text-caption text-sisal-500">
                        {encounterOutcomeLabel({
                          result: encounter.result,
                          resultType: encounter.resultType,
                        })}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Rule className="mt-10" />
      <p className="pt-4 font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase">
        DartBase · Ligabetrieb · Serverdaten
      </p>
    </div>
  );
}

function ScheduleSection({
  competition,
  organization,
}: {
  readonly competition: CompetitionDetailResponse;
  readonly organization: OrganizationSummary;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formErrors, setFormErrors] = useState<Readonly<Record<string, string>>>({});
  const teamsQuery = useQuery({
    queryKey: ["teams", organization.id],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/organizations/${organization.id}/teams`, schema: teamListSchema, signal }),
  });
  const { control, handleSubmit, register } = useForm<ScheduleFormValues>({
    defaultValues: { matchday: "1", homeTeamId: "", awayTeamId: "", scheduledAt: "", venue: "" },
  });
  const values = useWatch({ control });
  const schedule = useMutation({
    mutationFn: (data: CreateEncounterInput) =>
      apiRequest({
        path: `/organizations/${organization.id}/competitions/${competition.id}/encounters`,
        method: "POST",
        body: data,
        schema: encounterDetailSchema,
      }),
    onSuccess: async (encounter) => {
      await queryClient.invalidateQueries({
        queryKey: ["encounters", organization.id, competition.id],
      });
      router.push(`/liga/begegnungen/${encounter.id}?organisation=${organization.id}`);
    },
  });

  const teams = (teamsQuery.data ?? []).filter((team) => team.status === "ACTIVE");

  function onSubmit(formValues: ScheduleFormValues) {
    const parsed = createEncounterSchema.safeParse({
      matchday: Number(formValues.matchday),
      homeTeamId: formValues.homeTeamId,
      awayTeamId: formValues.awayTeamId,
      scheduledAt:
        formValues.scheduledAt === "" ? new Date(Number.NaN) : new Date(formValues.scheduledAt),
      venue: formValues.venue.trim() === "" ? null : formValues.venue,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        next[key] = messages[key] ?? issue.message;
      }
      setFormErrors(next);
      return;
    }
    if (parsed.data.homeTeamId === parsed.data.awayTeamId) {
      setFormErrors({ awayTeamId: messages.awayTeamId ?? "Wähle eine andere Mannschaft." });
      return;
    }
    setFormErrors({});
    schedule.mutate(parsed.data);
  }

  return (
    <section aria-labelledby="schedule-heading" className="mt-9">
      <SheetLabel as="h2" id="schedule-heading">
        Begegnung ansetzen
      </SheetLabel>
      <Rule className="mt-2" />

      {teams.length < 2 ? (
        <p className="mt-4 font-plate text-body text-sisal-500">
          Eine Begegnung braucht zwei aktive Mannschaften.{" "}
          <Link className="underline underline-offset-4" href={`/teams?organisation=${organization.id}`}>
            Teams anlegen
          </Link>
        </p>
      ) : (
        <FieldRow
          as="form"
          className="mt-4 sm:grid-cols-2 lg:grid-cols-[6rem_1fr_1fr_1fr_1fr_auto]"
          from="lg"
          onSubmit={handleSubmit(onSubmit)}
        >
          <Field error={formErrors.matchday ?? null} htmlFor="encounter-matchday" label="Spieltag">
            <TextInput id="encounter-matchday" inputMode="numeric" {...register("matchday")} />
          </Field>
          <Field error={formErrors.homeTeamId ?? null} htmlFor="encounter-home" label="Heim">
            <SelectInput id="encounter-home" {...register("homeTeamId")}>
              <option value="">Mannschaft wählen …</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field error={formErrors.awayTeamId ?? null} htmlFor="encounter-away" label="Gast">
            <SelectInput id="encounter-away" {...register("awayTeamId")}>
              <option value="">Mannschaft wählen …</option>
              {teams
                .filter((team) => team.id !== values.homeTeamId)
                .map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
            </SelectInput>
          </Field>
          <Field
            error={formErrors.scheduledAt ?? null}
            htmlFor="encounter-scheduled-at"
            label="Spielabend"
          >
            <TextInput
              id="encounter-scheduled-at"
              type="datetime-local"
              {...register("scheduledAt")}
            />
          </Field>
          <Field htmlFor="encounter-venue" label="Ort">
            <TextInput id="encounter-venue" placeholder="Clublokal" {...register("venue")} />
          </Field>
          <Control disabled={schedule.isPending} type="submit" variant="go">
            {schedule.isPending ? "Setzt an …" : "Ansetzen"}
          </Control>
        </FieldRow>
      )}

      {schedule.error ? (
        <Wedge className="mt-4 p-4" tone="alarm">
          <SheetLabel as="h3" tone="alarm">
            Begegnung nicht angesetzt
          </SheetLabel>
          <p className="mt-1.5 font-plate text-body text-wedge-900">
            {userFacingErrorMessage(schedule.error)}
          </p>
        </Wedge>
      ) : null}
    </section>
  );
}


function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-10 text-center font-plate text-body text-wedge-900">
      {children}
    </div>
  );
}
