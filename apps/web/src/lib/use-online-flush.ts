"use client";

import { useEffect, useRef } from "react";

/**
 * Startet genau EINEN Uebertragungslauf -- beim `online`-Ereignis, UND einmal
 * beim Einhaengen, sofern das Geraet bereits im Netz ist (gleiches Muster wie
 * der Einstiegseffekt der Scoringflaeche, `use-match-scoring.ts` ~236-241).
 * Ohne den Lauf beim Einhaengen blieb eine Warteschlange, die schon VOR dem
 * Betreten der Seite gefuellt war, liegen, bis entweder jemand "Jetzt
 * übertragen" traf oder ein weiteres `online`-Ereignis feuerte -- ein Geraet,
 * das durchgehend online bleibt, sieht so ein Ereignis nie.
 *
 * Zwei Wachen stecken darin, beide aus dem Bestand der Scoringflaeche
 * (`use-match-scoring.ts`):
 *
 * - `running` verhindert einen zweiten, verschachtelten Durchgang -- sowohl
 *   bei einem flackernden Uplink (zwei `online`-Ereignisse) als auch, wenn das
 *   Geraet online startet und deshalb der Einhaenge-Lauf UND ein moegliches,
 *   fast gleichzeitiges `online`-Ereignis um denselben Durchgang konkurrieren.
 *   Die Reihenfolge der Warteschlange ist verbindlich; zwei gleichzeitige
 *   Laeufe wuerden dieselben Kommandos doppelt absetzen. Ein gescheiterter
 *   Lauf gibt die Wache wieder frei -- der naechste Ausloeser darf es erneut
 *   versuchen.
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
    const startFlush = (): void => {
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
    window.addEventListener("online", startFlush);
    if (navigator.onLine) startFlush();
    return () => {
      window.removeEventListener("online", startFlush);
    };
  }, []);
}
