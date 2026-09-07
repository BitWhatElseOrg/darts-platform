"use client";

import { useQuery } from "@tanstack/react-query";
import { hasOrganizationPermission } from "@darts-platform/domain";
import { tournamentListSchema } from "@darts-platform/schemas";
import { MarkFlight, Rule, SelectInput, SheetLabel, StateTag } from "@darts-platform/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { NavLink, PageNav } from "@/components/page-nav";
import { apiRequest } from "@/lib/api-client";
import { calendarDate, statusLabel } from "@/lib/tournament-format";
import { useTournamentOrganization } from "./use-tournament-organization";

export function TournamentList({ requestedOrganizationId }: { readonly requestedOrganizationId: string | undefined }) {
  const router = useRouter();
  const { query: organizationsQuery, organization } = useTournamentOrganization(requestedOrganizationId);
  const tournamentsQuery = useQuery({
    queryKey: ["tournaments", organization?.id],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organization?.id ?? ""}/tournaments`,
        schema: tournamentListSchema,
        signal,
      }),
    enabled: organization !== null,
  });
  const tournaments = tournamentsQuery.data ?? [];
  const canCreate =
    organization !== null && hasOrganizationPermission(organization.role, "tournament:create");

  return (
    <main className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1100px] px-5 py-8 xl:px-9">
        <PageNav>
          <NavLink href="/">Übersicht</NavLink>
        </PageNav>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h1 className="font-numerals text-headline font-bold text-wedge-900">Turniere</h1>
            <p className="mt-1.5 font-plate text-body text-sisal-500">Vereinsmeisterschaften, Cups und Serien von DartBase.</p>
          </div>
          {canCreate ? <div className="flex flex-wrap gap-3">
            <Link className="inline-flex min-h-11 items-center rounded-lg border border-wedge-900 px-5 font-plate text-body font-semibold uppercase tracking-[0.1em] text-wedge-900" href={`/turniere/formate?organisation=${organization.id}`}>Formatwerkstatt</Link>
            <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-wedge-900 px-5 font-plate text-body font-semibold uppercase tracking-[0.1em] text-chalk transition-colors hover:bg-wedge-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green" href={`/turniere/neu?organisation=${organization.id}`}><MarkFlight size={13} /> Turnier anlegen</Link>
          </div> : null}
        </div>

        <Rule className="mt-6" />

        {organizationsQuery.data && organizationsQuery.data.length > 1 ? (
          <div className="mt-5 max-w-sm">
            <label className="font-plate text-caption font-semibold uppercase tracking-[0.14em] text-sisal-500" htmlFor="tournament-organization">Organisation</label>
            <SelectInput id="tournament-organization" onChange={(event) => router.push(`/turniere?organisation=${event.target.value}`)} value={organization?.id ?? ""}>
              {organizationsQuery.data.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </SelectInput>
          </div>
        ) : null}

        {organizationsQuery.isPending || tournamentsQuery.isPending ? (
          <Notice>Turniere werden geladen …</Notice>
        ) : organizationsQuery.error || tournamentsQuery.error ? (
          <Notice>{organizationsQuery.error?.message ?? tournamentsQuery.error?.message ?? "Turniere konnten nicht geladen werden."}</Notice>
        ) : organization === null ? (
          <Notice>Lege zuerst auf der Startseite eine Organisation an.</Notice>
        ) : tournaments.length === 0 ? (
          <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-12 text-center">
            <p className="font-numerals text-title font-bold text-wedge-900">Noch kein Turnier angelegt</p>
            <p className="mx-auto mt-2 max-w-md font-plate text-body text-sisal-500">Ein Turnier braucht einen Namen, eine Teilnehmerliste und mindestens ein Board. Danach erzeugt die Turnier-Engine Gruppen, Setzung und Spielplan.</p>
            {canCreate ? (
              <Link className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ring-green px-5 font-plate text-body font-semibold uppercase tracking-[0.1em] text-chalk transition-colors hover:bg-ring-green-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green" href={`/turniere/neu?organisation=${organization.id}`}>
                <MarkFlight size={13} /> Erstes Turnier anlegen
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="mt-4">
            {tournaments.map((tournament) => {
              const share = tournament.totalMatches === 0 ? 0 : Math.round((tournament.playedMatches / tournament.totalMatches) * 100);
              return (
                <li className="border-b border-sisal-300" key={tournament.id}>
                  <Link className="group flex flex-wrap items-center gap-x-6 gap-y-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green" href={`/turniere/${tournament.id}?organisation=${organization.id}`}>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-numerals text-title font-bold text-wedge-900 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">{tournament.name}</h2>
                      <p className="mt-0.5 font-plate text-body text-sisal-500">{calendarDate(tournament.startsAt)} · {tournament.participantCount} Teilnehmer · {tournament.boardCount} Boards</p>
                    </div>
                    <div className="w-28">
                      <SheetLabel>Fortschritt</SheetLabel>
                      <p className="mt-1 font-numerals text-counter font-bold tabular text-wedge-900">{tournament.playedMatches}/{tournament.totalMatches}</p>
                      <div aria-hidden="true" className="mt-1 h-1 w-full border border-sisal-400 bg-sisal-50"><div className="h-full bg-ring-green" style={{ width: `${share}%` }} /></div>
                    </div>
                    <div className="w-32">
                      <SheetLabel>Zustand</SheetLabel>
                      <p className="mt-1.5"><StateTag label={statusLabel(tournament.status)} tone={tournament.status === "COMPLETED" ? "waiting" : tournament.status === "DRAFT" ? "blocked" : "live"} /></p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Rule className="mt-10" />
        <p className="pt-4 font-plate text-caption font-semibold uppercase tracking-[0.14em] text-sisal-500">DartBase · Turnier Plattform · Serverdaten</p>
      </div>
    </main>
  );
}

function Notice({ children }: { readonly children: ReactNode }) {
  return <div className="mt-6 border border-sisal-400 bg-sisal-100 px-6 py-10 text-center font-plate text-body text-wedge-900">{children}</div>;
}
