import { BadRequestException, ConflictException } from "@nestjs/common";

import { ScoringValidationError } from "@darts-platform/scoring-engine";

/**
 * Die Scoring Engine wirft `ScoringValidationError` aus dem Match-Repository —
 * und zwar nicht nur an Match-Endpunkten: `correctTournamentResult` liegt
 * ebenfalls dort und schlaegt bei einer fremden `commandId` mit
 * `COMMAND_ID_ALREADY_USED` an. Solange nur `MatchesService` diese Abbildung
 * kannte, kam derselbe Eingabefehler am Turnier-Endpunkt als 500 heraus.
 * Deshalb steht die Zuordnung hier einmal und wird von beiden Services
 * benutzt (Vorbild: `league-error.ts`).
 *
 * Regelfall ist 400: ein Kommando, das die Engine so nicht annimmt, ist ein
 * Eingabefehler. Zwei Codes sind es nicht — sie beschreiben einen Zustand,
 * der der ansonsten gueltigen Anfrage entgegensteht, und gehoeren damit zu
 * 409:
 *
 * - `ROUND_LIMIT_NOT_REACHED`: ein zu fruehes Ausbullen ist kein
 *   Eingabefehler, die Rundengrenze ist schlicht noch nicht erreicht.
 * - `BOARD_NOT_AVAILABLE`: eine belegte Scheibe macht die Anfrage nicht
 *   ungueltig, der Zustand steht ihr entgegen.
 */
const conflictCodes: ReadonlySet<string> = new Set([
  "ROUND_LIMIT_NOT_REACHED",
  "BOARD_NOT_AVAILABLE",
]);

/** Übersetzt einen Engine-Fehler in die HTTP-Antwort; alles andere fliegt weiter. */
export function rethrowScoringError(error: unknown): never {
  if (error instanceof ScoringValidationError) {
    const body = { code: error.code, message: error.message };
    throw conflictCodes.has(error.code)
      ? new ConflictException(body)
      : new BadRequestException(body);
  }
  throw error;
}
