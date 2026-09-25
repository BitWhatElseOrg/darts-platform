import { ApiClientError } from "./api-error";
import { userFacingErrorMessage } from "./api-client";

/**
 * Wie die Scoringflaeche mit dem Laden eines Matches umgeht.
 *
 * Ein 404 ist endgueltig: das Match gibt es nicht (falsche ID, etwa die
 * Turniermatch-ID aus dem Board-Slot statt der Scoring-Match-ID) oder nicht
 * mehr. Weiter zu pollen aendert daran nichts, und "Pruefe die Eingaben"
 * hilft niemandem, der nichts eingegeben hat (Probelauf 25.09.2026, Befund 3).
 * Jeder andere Fehler bleibt vorlaeufig -- ein Netzabbruch, ein Neustart der
 * API -- und die Flaeche soll sich davon von selbst erholen.
 */
const POLL_INTERVAL_MS = 4_000;
const MAX_RETRIES = 3;

function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

export function matchRefetchInterval(error: unknown): number | false {
  return isNotFound(error) ? false : POLL_INTERVAL_MS;
}

export function shouldRetryMatchLoad(failureCount: number, error: unknown): boolean {
  if (isNotFound(error)) return false;
  return failureCount < MAX_RETRIES;
}

export function matchLoadMessage(error: unknown): string {
  if (isNotFound(error)) {
    return "Dieses Match gibt es nicht oder nicht mehr. Öffne die Scoringfläche über die Matches-Seite.";
  }
  return userFacingErrorMessage(error);
}
