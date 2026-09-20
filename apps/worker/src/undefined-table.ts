/** Postgres meldet eine fehlende Tabelle oder Sicht mit SQLSTATE 42P01. */
export const UNDEFINED_TABLE = "42P01";

/**
 * Erkennt, ob ein Fehler auf eine noch nicht angelegte Tabelle zurueckgeht.
 *
 * Drizzle verpackt den Treiberfehler, deshalb wird die `cause`-Kette
 * mitgelesen; die Tiefe ist begrenzt, damit ein Zyklus die Schleife nicht
 * haelt.
 */
export function isUndefinedTableError(error: unknown): boolean {
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as { readonly code?: unknown; readonly cause?: unknown };
    if (row.code === UNDEFINED_TABLE) return true;
    candidate = row.cause;
  }
  return false;
}
