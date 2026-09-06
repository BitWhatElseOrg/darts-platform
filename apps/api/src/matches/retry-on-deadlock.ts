import { isDeadlockError } from "../common/postgres-error.js";

/**
 * Ein Sperrzyklus (40P01) trifft eine der beteiligten Transaktionen zufaellig;
 * die Wiederholung laeuft in aller Regel durch. Sie ist gefahrlos: die
 * abgebrochene Transaktion hat nichts hinterlassen, und dieselbe commandId
 * kann kein zweites Mal schreiben (AGENTS.md 11). Bleibt es beim Zyklus, ist
 * die Antwort ein Versionskonflikt mit dem aktuellen Serverzustand
 * (AGENTS.md 12, 15) — nie ein 500 mitten im entscheidenden Wurf.
 */
export async function retryOnDeadlock<T>(command: () => Promise<T>, conflictResult: T): Promise<T> {
  try {
    return await command();
  } catch (error) {
    if (!isDeadlockError(error)) throw error;
    try {
      return await command();
    } catch (retryError) {
      if (isDeadlockError(retryError)) return conflictResult;
      throw retryError;
    }
  }
}
