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

/** SQLSTATE 23505: ein Unique-Index oder -Constraint wurde verletzt. */
export const UNIQUE_VIOLATION = "23505";

/**
 * Trifft die Verletzung genau diesen Constraint? Drizzle verpackt den
 * Treiberfehler, deshalb wird die `cause`-Kette wie bei `isDeadlockError`
 * durchlaufen.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as {
      readonly code?: unknown;
      readonly constraint_name?: unknown;
      readonly cause?: unknown;
    };
    if (row.code === UNIQUE_VIOLATION && row.constraint_name === constraint) return true;
    candidate = row.cause;
  }
  return false;
}
