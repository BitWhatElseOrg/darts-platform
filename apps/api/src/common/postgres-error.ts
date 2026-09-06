/**
 * Postgres bricht bei einem Sperrzyklus eine der beteiligten Transaktionen ab
 * (SQLSTATE 40P01). Fachlich ist das kein Serverfehler: der Zustand hat sich
 * unter der Anfrage bewegt. Der Client synchronisiert und schickt erneut —
 * dank commandId ohne Doppelschreiben.
 */
export const DEADLOCK_DETECTED = "40P01";

export function isDeadlockError(error: unknown): boolean {
  // Drizzle verpackt den Treiberfehler; die Kennung steht erst in `cause`.
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as { readonly code?: unknown; readonly cause?: unknown };
    if (row.code === DEADLOCK_DETECTED) return true;
    candidate = row.cause;
  }
  return false;
}
