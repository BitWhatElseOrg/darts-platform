"use client";

import { useQuery } from "@tanstack/react-query";
import { competitionListSchema, type CompetitionStatus } from "@darts-platform/schemas";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { MarkFlight, Rule, SelectInput, SheetLabel, StateTag } from "@darts-platform/ui";
import type { StateTone } from "@darts-platform/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { competitionStatusLabel } from "@/lib/league-format";
import { useTournamentOrganization } from "@/components/tournament/use-tournament-organization";

function competitionTone(status: CompetitionStatus): StateTone {
  switch (status) {
    case "ACTIVE":
      return "live";
    case "DRAFT":
      return "waiting";
    case "COMPLETED":
      return "finish";
    case "CANCELLED":
      return "blocked";
  }
}

export function CompetitionList({
  requestedOrganizationId,
}: {
  readonly requestedOrganizationId: string | undefined;
}) {
  const router = useRouter();
  const { query: organizationsQuery, organization } = useTournamentOrganization(
    requestedOrganizationId,
  );
  const competitionsQuery = useQuery({
    queryKey: ["competitions", organization?.id],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organization?.id ?? ""}/competitions`,
        schema: competitionListSchema,
        signal,
      }),
    enabled: organization !== null,
  });
  const competitions = competitionsQuery.data ?? [];
  const canManage =
    organization !== null && hasOrganizationPermission(organization.role, "competition:manage");

  return (
    <main className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1100px] px-5 py-8 xl:px-9">
        <nav className="mb-5 flex flex-wrap gap-5">
          <Link className={navLinkClassName} href="/">
            Übersicht
          </Link>
          {organization === null ? null : (
            <Link className={navLinkClassName} href={`/teams?organisation=${organization.id}`}>
              Teams
            </Link>
          )}
        </nav>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h1 className="font-numerals text-headline font-bold text-wedge-900">
              Liga
            </h1>
            <p className="mt-1.5 font-plate text-body text-sisal-500">
              Ligawettbewerbe mit Begegnungsvorlage, Aufstellungs- und Wertungsregeln.
            </p>
          </div>
          {canManage ? (
            <Link
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-wedge-900 px-5 font-plate text-body font-semibold tracking-[0.1em] text-chalk uppercase transition-colors hover:bg-wedge-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
              href={`/liga/neu?organisation=${organization.id}`}
            >
              <MarkFlight size={13} /> Wettbewerb anlegen
            </Link>
          ) : null}
        </div>

        <Rule className="mt-6" />

        {organizationsQuery.data && organizationsQuery.data.length > 1 ? (
          <div className="mt-5 max-w-sm">
            <label
              className="font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase"
              htmlFor="competition-organization"
            >
              Organisation
            </label>
            <SelectInput
              id="competition-organization"
              onChange={(event) => router.push(`/liga?organisation=${event.target.value}`)}
              value={organization?.id ?? ""}
            >
              {organizationsQuery.data.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </SelectInput>
          </div>
        ) : null}

        {organizationsQuery.isPending || competitionsQuery.isPending ? (
          <Notice>Wettbewerbe werden geladen …</Notice>
        ) : organizationsQuery.error || competitionsQuery.error ? (
          <Notice>
            {userFacingErrorMessage(
              organizationsQuery.error ?? competitionsQuery.error,
              "Wettbewerbe konnten nicht geladen werden.",
            )}
          </Notice>
        ) : organization === null ? (
          <Notice>Lege zuerst auf der Startseite eine Organisation an.</Notice>
        ) : competitions.length === 0 ? (
          <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-12 text-center">
            <p className="font-numerals text-title font-bold text-wedge-900">
              Noch kein Wettbewerb angelegt
            </p>
            <p className="mx-auto mt-2 max-w-md font-plate text-body text-sisal-500">
              Ein Ligawettbewerb trägt die Begegnungsvorlage — die nummerierten Spiele eines Abends
              — sowie die Aufstellungs- und Wertungsregeln. Begegnungen werden darin angesetzt.
            </p>
            {canManage ? (
              <Link
                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ring-green px-5 font-plate text-body font-semibold tracking-[0.1em] text-chalk uppercase transition-colors hover:bg-ring-green-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
                href={`/liga/neu?organisation=${organization.id}`}
              >
                <MarkFlight size={13} /> Ersten Wettbewerb anlegen
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="mt-4">
            {competitions.map((competition) => (
              <li className="border-b border-sisal-300" key={competition.id}>
                <Link
                  className="group flex flex-wrap items-center gap-x-6 gap-y-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
                  href={`/liga/${competition.id}?organisation=${organization.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="font-numerals text-title font-bold text-wedge-900 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                      {competition.name}
                    </h2>
                    <p className="mt-0.5 font-plate text-body text-sisal-500">
                      {competition.slug} · {competition.slotCount} Spiele je Begegnung ·{" "}
                      {competition.lineupPositions} Aufstellungspositionen
                    </p>
                  </div>
                  <div className="w-32">
                    <SheetLabel>Begegnungen</SheetLabel>
                    <p className="mt-1 font-numerals text-counter font-bold tabular text-wedge-900">
                      {competition.encounterCount}
                    </p>
                  </div>
                  <div className="w-32">
                    <SheetLabel>Zustand</SheetLabel>
                    <p className="mt-1.5">
                      <StateTag
                        label={competitionStatusLabel(competition.status)}
                        tone={competitionTone(competition.status)}
                      />
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Rule className="mt-10" />
        <p className="pt-4 font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase">
          DartBase · Ligabetrieb · Serverdaten
        </p>
      </div>
    </main>
  );
}

const navLinkClassName =
  "font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase underline decoration-sisal-400 decoration-1 underline-offset-4 hover:text-wedge-900";

function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-10 text-center font-plate text-body text-wedge-900">
      {children}
    </div>
  );
}
