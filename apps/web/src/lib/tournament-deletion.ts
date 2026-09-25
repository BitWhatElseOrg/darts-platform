/**
 * Warum ein Turnier (noch) nicht geloescht werden kann -- oder `null`, wenn
 * nichts dagegen spricht (Spec 2026-09-25-lease-karenz-turnier-loeschen,
 * Befund 7). Der Server entscheidet verbindlich (409 `TOURNAMENT_HAS_RESULTS`);
 * die Flaeche nennt den Grund vorab, damit der Knopf nicht ins Leere fuehrt.
 *
 * `recentResults` fuehrt gespielte und Walkover-Ergebnisse (gekappt auf zehn,
 * aber nie leer, sobald eines vorliegt); Freilose stehen nicht darin und
 * zaehlen auch serverseitig nicht als gespielt.
 */
export function tournamentDeletionBlocker(dashboard: {
  readonly recentResults: readonly unknown[];
  readonly boards: readonly { readonly state: string }[];
}): string | null {
  if (dashboard.recentResults.length > 0) {
    return "Es liegen bereits Ergebnisse vor. Ein gespieltes Turnier bleibt erhalten.";
  }
  if (dashboard.boards.some((board) => board.state === "PLAYING")) {
    return "Auf einem Board läuft noch ein Match.";
  }
  return null;
}
