"use client";

import { useEffect, useRef } from "react";

/**
 * Startet beim `online`-Ereignis genau EINEN Uebertragungslauf.
 *
 * Zwei Wachen stecken darin, beide aus dem Bestand der Scoringflaeche
 * (`use-match-scoring.ts`):
 *
 * - `running` verhindert einen zweiten, verschachtelten Durchgang bei einem
 *   flackernden Uplink. Die Reihenfolge der Warteschlange ist verbindlich; zwei
 *   gleichzeitige Laeufe wuerden dieselben Kommandos doppelt absetzen. Ein
 *   gescheiterter Lauf gibt die Wache wieder frei -- das naechste Ereignis darf
 *   es erneut versuchen.
 * - `latest` haelt die aktuelle Fassung von `flush`. Der Listener wird einmal
 *   angemeldet; haenge er stattdessen an `flush` in den Abhaengigkeiten, meldete
 *   ihn jede Neuberechnung des Callbacks ab und wieder an -- und ein Ereignis
 *   genau dazwischen ginge verloren.
 */
export function useOnlineFlush(flush: () => Promise<void>): void {
  const latest = useRef(flush);
  const running = useRef(false);

  useEffect(() => {
    latest.current = flush;
  });

  useEffect(() => {
    const becameOnline = (): void => {
      if (running.current) return;
      running.current = true;
      // `flush` (die geteilte Wiedergabe der Zentrale bzw. der Scoringflaeche)
      // faengt ihre eigenen Fehler intern ab und meldet sie ueber den
      // Warteschlangen-Zustand, nicht ueber eine Ablehnung dieses Versprechens.
      // `catch` faengt trotzdem ab, statt es dem globalen Handler zu ueberlassen
      // -- eine unbehandelte Ablehnung darf `running` nicht offen lassen und
      // soll nicht als ungefangener Fehler in der Konsole landen.
      void latest.current()
        .catch(() => undefined)
        .finally(() => {
          running.current = false;
        });
    };
    window.addEventListener("online", becameOnline);
    return () => {
      window.removeEventListener("online", becameOnline);
    };
  }, []);
}
