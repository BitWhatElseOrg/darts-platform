import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
    <section className="max-w-lg rounded-2xl border border-amber-300/40 bg-slate-900 p-7">
      <h1 className="font-numerals text-headline font-bold">DartBase bleibt bereit</h1>
      <p className="mt-3 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.12em] text-amber-300">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-300" />
        Keine Verbindung
      </p>
      <p className="mt-4 max-w-[65ch] prose-de text-body text-slate-300">Die App-Oberfläche ist offline verfügbar. Bereits geöffnete Board-Matches speichern neue Aufnahmen auf diesem Gerät und übertragen sie nach Wiederherstellung der Verbindung.</p>
    </section>
  </main>;
}
