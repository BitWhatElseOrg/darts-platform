import Image from "next/image";

import { dartOstLogo } from "@/assets";
import { ApplicationDashboard } from "@/components/application-dashboard";

export default function HomePage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-6xl flex-col items-center gap-10">
        <header className="text-center">
          <Image
            alt="Dart Ost"
            className="mx-auto mb-6 h-28 w-auto sm:h-36"
            src={dartOstLogo}
          />
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
        </header>

        <ApplicationDashboard />
      </div>
    </main>
  );
}
