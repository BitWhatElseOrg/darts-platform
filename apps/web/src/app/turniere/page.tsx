import { MarkFlight, Rule, SheetLabel, StateTag } from "@darts-platform/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { calendarDate, statusLabel } from "@/lib/tournament-format";
import { loadTournaments } from "@/lib/tournament-demo";

export const metadata: Metadata = {
  title: "Turniere",
  description: "Turniere der Organisation anlegen, führen und abschliessen.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TournamentListPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const showEmpty = query.leer === "1";
  const tournaments = showEmpty ? [] : loadTournaments();

  return (
    <main className="sektorenring min-h-screen">
      <div className="mx-auto max-w-[1100px] px-5 py-8 xl:px-9">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h1 className="font-numerals text-[2.75rem] leading-[0.9] font-bold tracking-[-0.02em] text-wedge-900">
              Turniere
            </h1>
            <p className="mt-1.5 font-plate text-[0.875rem] text-sisal-500">
              Vereinsmeisterschaften, Cups und Serien dieser Organisation.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center gap-2 bg-wedge-900 px-5 font-plate text-[0.875rem] font-semibold uppercase tracking-[0.1em] text-chalk transition-colors hover:bg-wedge-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
            href="/turniere/neu"
          >
            <MarkFlight size={13} />
            Turnier anlegen
          </Link>
        </div>

        <Rule className="mt-6" />

        {tournaments.length === 0 ? (
          <div className="border border-sisal-400 bg-sisal-100 px-6 py-12 text-center">
            <p className="font-numerals text-[1.5rem] leading-tight font-bold text-wedge-900">
              Noch kein Turnier angelegt
            </p>
            <p className="mx-auto mt-2 max-w-md font-plate text-[0.875rem] leading-relaxed text-sisal-500">
              Ein Turnier braucht einen Namen, eine Teilnehmerliste und mindestens ein Board.
              Danach erzeugt die Turnier-Engine Gruppen, Setzung und Spielplan.
            </p>
            <Link
              className="mt-6 inline-flex min-h-11 items-center gap-2 bg-ring-green px-5 font-plate text-[0.875rem] font-semibold uppercase tracking-[0.1em] text-chalk transition-colors hover:bg-ring-green-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
              href="/turniere/neu"
            >
              <MarkFlight size={13} />
              Erstes Turnier anlegen
            </Link>
          </div>
        ) : (
          <ul>
            {tournaments.map((tournament) => {
              const share =
                tournament.totalMatches === 0
                  ? 0
                  : Math.round((tournament.playedMatches / tournament.totalMatches) * 100);
              return (
                <li className="border-b border-sisal-300" key={tournament.id}>
                  <Link
                    className="group flex flex-wrap items-center gap-x-6 gap-y-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green"
                    href={`/turniere/${tournament.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <h2 className="font-numerals text-[1.5rem] leading-tight font-bold tracking-[-0.01em] text-wedge-900 group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                        {tournament.name}
                      </h2>
                      <p className="mt-0.5 font-plate text-[0.875rem] text-sisal-500">
                        {calendarDate(tournament.startsAt)} · {tournament.participantCount}{" "}
                        Teilnehmer · {tournament.boardCount} Boards
                      </p>
                    </div>
                    <div className="w-28">
                      <SheetLabel>Fortschritt</SheetLabel>
                      <p className="mt-1 font-numerals text-[1rem] font-bold tabular text-wedge-900">
                        {tournament.playedMatches}/{tournament.totalMatches}
                      </p>
                      <div
                        aria-hidden="true"
                        className="mt-1 h-1 w-full border border-sisal-400 bg-sisal-50"
                      >
                        <div className="h-full bg-wedge-900" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                    <div className="w-32">
                      <SheetLabel>Zustand</SheetLabel>
                      <p className="mt-1.5">
                        <StateTag
                          label={statusLabel(tournament.status)}
                          tone={
                            tournament.status === "COMPLETED"
                              ? "waiting"
                              : tournament.status === "DRAFT"
                                ? "blocked"
                                : "live"
                          }
                        />
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Rule className="mt-10" />
        <p className="pt-4 font-plate text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-sisal-500">
          Synthetische Daten ·{" "}
          <Link
            className="underline decoration-sisal-400 decoration-1 underline-offset-4 hover:text-wedge-900"
            href={showEmpty ? "/turniere" : "/turniere?leer=1"}
          >
            {showEmpty ? "Liste mit Turnieren zeigen" : "Leerzustand zeigen"}
          </Link>
        </p>
      </div>
    </main>
  );
}
