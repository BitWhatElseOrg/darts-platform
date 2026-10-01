import type { QueueReadiness, TournamentFormat } from "@darts-platform/schemas";

/**
 * Die Warteschlange, wie die Kommandozentrale sie zeigt.
 *
 * Im Vereinsduell stehen die N²+2 Platzhalter der Finalrunde schon ab dem
 * Start in der Warteschlange und verstopfen die Liste. Ausgeblendet wird nur
 * in der Anzeige; der Server behaelt die Wahrheit. Andere Formate bekommen
 * die Liste unveraendert (dieselbe Referenz) zurueck.
 */
export function visibleQueue<Entry extends { readonly readiness: QueueReadiness }>(
  queue: readonly Entry[],
  format: TournamentFormat,
): readonly Entry[] {
  if (format !== "CLUB_DUEL") return queue;
  return queue.filter((entry) => entry.readiness !== "BLOCKED_PARTICIPANT_UNDECIDED");
}
