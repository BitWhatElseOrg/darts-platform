import Image from "next/image";

import { dartOstLogo } from "@/assets";
import { ApplicationDashboard } from "@/components/application-dashboard";

export default function HomePage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col items-center gap-10">
        <header className="text-center">
          <figure className="mx-auto mb-6 w-fit">
            <a
              aria-label="Website von Dart Ost öffnen (öffnet in neuem Tab)"
              className="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
              href="https://dartost.ch/"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Image
                alt="Dart Ost"
                className="mx-auto h-28 w-auto sm:h-36"
                src={dartOstLogo}
              />
            </a>
            <figcaption className="mt-2 text-caption font-semibold tracking-[0.12em] text-slate-500 uppercase">
              Sponsor
            </figcaption>
          </figure>
          <h1 className="font-numerals text-headline font-bold text-white">
            DartBase - Turnier Plattform
          </h1>
          <p className="mt-2 text-caption font-semibold tracking-[0.12em] text-emerald-300 uppercase">
            Dartturniere ohne Kompromisse
          </p>
          <p className="mx-auto mt-4 max-w-[65ch] prose-de text-field text-slate-400">
            Spielt eure Matches in verschiedenen Spielmodi, erfasst Ergebnisse zuverlässig
            und behaltet den aktuellen Spielstand jederzeit auf dem Scoreboard im Blick.
          </p>
        </header>

        <ApplicationDashboard />

        <nav aria-label="Hilfe" className="mt-auto flex w-full justify-center border-t border-slate-800/80 pt-6">
          <a
            className="inline-flex min-h-11 items-center rounded-lg border border-emerald-300/50 px-4 py-2 text-body font-semibold text-emerald-200 transition hover:border-emerald-200 hover:text-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
            href="/bedienungsanleitung.html"
          >
            Bedienungsanleitung
          </a>
        </nav>
      </div>
    </main>
  );
}
