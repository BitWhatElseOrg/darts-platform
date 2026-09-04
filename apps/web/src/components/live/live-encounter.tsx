"use client";

import { useQuery } from "@tanstack/react-query";
import { publicEncounterSchema, type PublicEncounter } from "@darts-platform/schemas";

import { apiRequest } from "@/lib/api-client";
import {
  disciplineLabel,
  encounterOutcomeLabel,
  encounterStatusLabel,
  slotOutcomeLabel,
  slotStatusLabel,
} from "@/lib/league-format";
import { calendarDate, clockTime } from "@/lib/tournament-format";

type PublicSlot = PublicEncounter["slots"][number];

function names(players: readonly { readonly displayName: string }[]): string {
  return players.length === 0 ? "noch offen" : players.map((player) => player.displayName).join(" · ");
}

/**
 * Die öffentliche Ansicht kennt nur die `publicId`. Der Socket-Raum heisst
 * nach der internen id und gehört nicht ins Publikum, deshalb aktualisiert
 * diese Fläche über ein Intervall statt über ein Abonnement.
 */
export function LiveEncounter({ publicId }: { readonly publicId: string }) {
  const query = useQuery({
    queryKey: ["public-encounter", publicId],
    queryFn: ({ signal }) =>
      apiRequest({ path: `/public/encounters/${publicId}`, schema: publicEncounterSchema, signal }),
    refetchInterval: 15_000,
  });

  if (query.isPending) return <LiveNotice text="Begegnung wird geladen …" />;
  if (query.data === undefined) {
    return <LiveNotice text="Diese Begegnung gibt es nicht oder sie ist nicht öffentlich." />;
  }

  const encounter = query.data;

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-7">
      <header className="mx-auto flex max-w-[1100px] flex-wrap items-end justify-between gap-4 border-b border-emerald-400/40 pb-5">
        <div>
          <h1 className="font-numerals text-headline font-bold">
            {encounter.homeTeamName} gegen {encounter.awayTeamName}
          </h1>
          <p className="mt-2 text-body text-slate-400">
            {encounter.competitionName} · Spieltag {encounter.matchday} ·{" "}
            {calendarDate(encounter.scheduledAt)} · {clockTime(encounter.scheduledAt)} Uhr
            {encounter.venue === null ? "" : ` · ${encounter.venue}`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-body">
          <span
            aria-hidden="true"
            className={`h-3 w-3 rounded-full ${
              encounter.status === "RUNNING" ? "bg-emerald-400" : "bg-slate-500"
            }`}
          />
          <span>
            {encounterStatusLabel(encounter.status)} · aktualisiert alle 15 Sekunden
          </span>
        </div>
      </header>

      <section aria-label="Zwischenstand" className="mx-auto mt-7 max-w-[1100px]">
        <dl className="grid gap-5 sm:grid-cols-3">
          <Tally
            away={encounter.awayPoints}
            home={encounter.homePoints}
            label="Punkte"
            prominent
          />
          <Tally away={encounter.awayGames} home={encounter.homeGames} label="Spiele" />
          <Tally away={encounter.awayLegs} home={encounter.homeLegs} label="Sätze" />
        </dl>
        {encounter.result === null ? null : (
          <p className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-5 py-4 font-numerals text-title font-bold">
            {encounterOutcomeLabel({
              result: encounter.result,
              resultType: encounter.resultType,
            })}
          </p>
        )}
      </section>

      <section aria-labelledby="public-slots" className="mx-auto mt-9 max-w-[1100px]">
        <h2
          className="mb-3 text-caption font-semibold tracking-[0.12em] text-slate-400 uppercase"
          id="public-slots"
        >
          Spiele
        </h2>
        <ol className="overflow-hidden rounded-xl border border-slate-800">
          {[...encounter.slots]
            .sort((first, second) => first.sequence - second.sequence)
            .map((slot) => (
              <SlotRow key={slot.sequence} slot={slot} />
            ))}
        </ol>
      </section>
    </main>
  );
}

function Tally({
  away,
  home,
  label,
  prominent = false,
}: {
  readonly away: number;
  readonly home: number;
  readonly label: string;
  readonly prominent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
      <dt className="text-label font-semibold text-slate-400 uppercase">{label}</dt>
      <dd className={`mt-1 font-numerals font-bold tabular ${prominent ? "text-display" : "text-data"}`}>
        {home}:{away}
      </dd>
    </div>
  );
}

function SlotRow({ slot }: { readonly slot: PublicSlot }) {
  return (
    <li className="grid gap-2 border-t border-slate-800 px-4 py-3 first:border-t-0 sm:grid-cols-[2.5rem_1fr_5rem_11rem] sm:items-center sm:gap-4">
      <span className="text-body font-bold tabular-nums text-slate-400">{slot.sequence}</span>
      <span className="min-w-0">
        <span className="block text-body font-semibold">
          {names(slot.home.players)} <span className="text-slate-500">gegen</span>{" "}
          {names(slot.away.players)}
        </span>
        <span className="block text-caption text-slate-500">
          {slot.label} · {disciplineLabel(slot.discipline)}
          {slot.boardName === null ? "" : ` · ${slot.boardName}`}
        </span>
      </span>
      <span className="text-body font-bold tabular-nums">
        {slot.homeLegs}:{slot.awayLegs}
      </span>
      <span className="text-caption text-slate-400">
        {slotStatusLabel(slot.status)}
        {slot.winnerSide === null
          ? ""
          : ` · ${slotOutcomeLabel({ winnerSide: slot.winnerSide, resultType: slot.resultType })}`}
      </span>
    </li>
  );
}

function LiveNotice({ text }: { readonly text: string }) {
  return <main className="min-h-screen bg-slate-950 p-8 text-slate-200">{text}</main>;
}
