import type { Metadata } from "next";

import { StateTag } from "@darts-platform/ui";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return <main className="sektorenring flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
    <section className="max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-7">
      <h1 className="font-numerals text-headline font-bold">DartBase bleibt bereit</h1>
      <p className="mt-3">
        <StateTag label="Keine Verbindung" on="ink" tone="waiting" />
      </p>
      <p className="mt-4 max-w-[65ch] prose-de text-body text-slate-300">Die App-Oberfläche ist offline verfügbar. Bereits geöffnete Board-Matches speichern neue Aufnahmen auf diesem Gerät und übertragen sie nach Wiederherstellung der Verbindung.</p>
    </section>
  </main>;
}
