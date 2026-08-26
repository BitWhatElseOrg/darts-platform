import Link from "next/link";

import { ApplicationDashboard } from "@/components/application-dashboard";

export default function HomePage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-6xl flex-col items-center gap-10">
        <header className="text-center">
          <p className="mb-3 text-sm font-semibold tracking-[0.28em] text-emerald-300 uppercase">
            Phase 1 · Playable Match MVP
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Darts Platform
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-400 sm:text-lg">
            Play complete 501 Double-Out matches with reliable scoring,
            concurrency protection and a mobile-first scoreboard.
          </p>
        </header>

        <ApplicationDashboard />

        <Link
          className="inline-flex min-h-11 items-center border border-slate-700 px-5 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus-visible:outline-none"
          href="/turniere"
        >
          Turnierleitung
        </Link>
      </div>
    </main>
  );
}
