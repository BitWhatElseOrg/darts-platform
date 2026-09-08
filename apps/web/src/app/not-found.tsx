import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Nicht gefunden · DartBase" };

/**
 * Eine Adresse ohne Inhalt sagt das auch. Vorher lief so ein Aufruf in eine
 * Abfrage mit ungültiger Kennung und endete in „Die Anfrage konnte nicht
 * ausgeführt werden".
 */
export default function NotFoundPage() {
  return (
    <main className="sektorenring flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg border border-sisal-400 bg-sisal-100 px-6 py-10 text-center">
        <p className="font-plate text-caption font-semibold tracking-[0.14em] text-sisal-500 uppercase">
          Nicht gefunden
        </p>
        <h1 className="mt-2 font-numerals text-title font-bold text-wedge-900">
          Diese Adresse führt ins Leere
        </h1>
        <p className="mx-auto mt-2 max-w-md font-plate text-body text-sisal-500">
          Die Seite gibt es nicht oder sie braucht eine Kennung, die in der Adresse fehlt.
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center border border-wedge-900 px-4 font-plate text-caption font-semibold tracking-[0.12em] text-wedge-900 uppercase hover:bg-sisal-50"
          href="/"
        >
          Zur Übersicht
        </Link>
      </div>
    </main>
  );
}
