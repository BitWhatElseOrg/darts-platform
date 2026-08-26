import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
    <section className="max-w-lg rounded-2xl border border-amber-300/40 bg-slate-900 p-7">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Keine Verbindung</p>
      <h1 className="mt-2 text-3xl font-black">Dart Ost bleibt bereit</h1>
      <p className="mt-4 leading-relaxed text-slate-300">Die App-Oberfläche ist offline verfügbar. Bereits geöffnete Board-Matches speichern neue Aufnahmen auf diesem Gerät und übertragen sie nach dem Reconnect.</p>
    </section>
  </main>;
}
