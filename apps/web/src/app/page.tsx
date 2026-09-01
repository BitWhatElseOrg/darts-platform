import Image from "next/image";

import { dartOstLogo } from "@/assets";
import { ApplicationDashboard } from "@/components/application-dashboard";

export default function HomePage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-6xl flex-col items-center gap-10">
        <header className="text-center">
          <figure className="mx-auto mb-6 w-fit">
            <Image
              alt="Dart Ost"
              className="mx-auto h-28 w-auto sm:h-36"
              src={dartOstLogo}
            />
            <figcaption className="mt-2 text-xs font-semibold tracking-[0.16em] text-slate-500 uppercase">
              Sponsor
            </figcaption>
          </figure>
          <p className="mb-3 text-sm font-semibold tracking-[0.28em] text-emerald-300 uppercase">
            Dartturniere ohne Kompromisse
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
            DartBase - Turnier Plattform
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-400 sm:text-lg">
            Spielt eure Matches in verschiedenen Spielmodi, erfasst Ergebnisse zuverlässig
            und behaltet den aktuellen Spielstand jederzeit auf dem Scoreboard im Blick.
          </p>
          <a
            className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-emerald-300/50 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-200 hover:text-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
            href="/bedienungsanleitung.html"
          >
            Bedienungsanleitung
          </a>
        </header>

        <ApplicationDashboard />
      </div>
    </main>
  );
}
