import { ApplicationDashboard } from "@/components/application-dashboard";

export default function HomePage() {
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-6xl flex-col items-center gap-10">
        <header className="text-center">
          <p className="mb-3 text-sm font-semibold tracking-[0.28em] text-emerald-300 uppercase">
            Phase 0 · Foundation complete
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Darts Platform
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-400 sm:text-lg">
            Secure organization and player management for reliable, multi-tenant
            tournament operations.
          </p>
        </header>

        <ApplicationDashboard />
      </div>
    </main>
  );
}
