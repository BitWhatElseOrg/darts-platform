import { eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, matches } from "@darts-platform/database";

/**
 * Setzt Ein- und Ausgangsregel aller Matches einer Organisation.
 *
 * Die Oberfläche legt ein freies Match ohne Regelwahl an (`matches`-Formular:
 * Spieler, Legs, Board), die Regeln kommen aus den Datenbank-Vorgaben
 * `STRAIGHT`/`DOUBLE` beziehungsweise aus Wettbewerb und Turnier. Für einen
 * gezielten Regel-Test wäre der Weg über einen ganzen Ligawettbewerb
 * unverhältnismässig; deshalb dieselbe Abkürzung wie in den
 * API-Integrationstests, hier über eine eigens angelegte Testorganisation.
 *
 * Die Scoringfläche fragt den Matchzustand alle vier Sekunden neu ab
 * (`match-scoreboard-route.tsx`), ein Neuladen ist also nicht nötig — die
 * aufrufende Stelle wartet auf die Variante in der Kopfzeile.
 */
export async function applyMatchRules(
  organizationId: string,
  rules: {
    readonly inRule?: "STRAIGHT" | "DOUBLE";
    readonly outRule?: "SINGLE" | "DOUBLE" | "MASTER";
    /** Reglement 2.2.9: das Entscheidungsdoppel bullt schon Leg eins aus. */
    readonly bullOffFromLegOne?: boolean;
  },
): Promise<void> {
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);
  try {
    await connection.database.update(matches).set(rules).where(eq(matches.organizationId, organizationId));
  } finally {
    await connection.close();
  }
}
