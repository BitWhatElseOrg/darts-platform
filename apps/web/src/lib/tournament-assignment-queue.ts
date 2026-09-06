import { z } from "zod";

import type { OfflineCommand } from "./offline-command-queue";

/**
 * Die Board-Zuweisungen der Kommandozentrale liegen in derselben
 * IndexedDB-Warteschlange wie die Aufnahmen der Scoringflaeche
 * (`offline-command-queue.ts`), unter eigenem `scope`. Vorher lebten sie nur
 * in `useState`: ein Neuladen ohne Verbindung verwarf sie still (Befund K4).
 */
export function tournamentQueueScope(organizationId: string, tournamentId: string): string {
  return `tournament:${organizationId}:${tournamentId}`;
}

/** Die Nutzlast einer Zuweisung, so wie sie an die API geht. */
const assignmentBodySchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  matchId: z.uuid(),
  boardId: z.uuid(),
});

export interface AssignmentQueueEntry {
  readonly command: OfflineCommand;
  readonly matchId: string;
  readonly boardId: string;
  /**
   * Die beim Einreihen gespeicherte Version -- nur ein Anzeigehinweis und
   * kann veraltet sein. Gesendet wird sie nicht mehr: seit PR-Agent-Befund F2
   * ("Stale Versions") baut die Wiedergabe die tatsaechliche
   * `expectedVersion` aus dem zuletzt bestaetigten Serverstand
   * (`offline-replay.ts`, `replayWithCurrentVersion`).
   */
  readonly expectedVersion: number;
}

/**
 * Nutzlast einer Zuweisung fuer die API. `expectedVersion` wird immer
 * explizit uebergeben, nie aus der Warteschlange gelesen -- die dort
 * gespeicherte Version ist nur ein Anzeigehinweis, kein Sendewert (siehe
 * `AssignmentQueueEntry.expectedVersion`). Dieselbe Funktion baut sowohl die
 * Nutzlast fuer das direkte Senden als auch fuer das Einreihen, damit beide
 * dieselbe Form erzeugen.
 */
export function assignmentRequestBody(
  command: { readonly commandId: string; readonly matchId: string; readonly boardId: string },
  expectedVersion: number,
): { readonly commandId: string; readonly expectedVersion: number; readonly matchId: string; readonly boardId: string } {
  return { commandId: command.commandId, expectedVersion, matchId: command.matchId, boardId: command.boardId };
}

/**
 * Liest die Warteschlange als Zuweisungen. Eintraege mit fremder oder
 * beschaedigter Nutzlast werden uebergangen statt geraten — die Zentrale
 * zeigt lieber eine Zuweisung weniger an, als eine falsche.
 */
export function assignmentQueueEntries(queued: readonly OfflineCommand[]): readonly AssignmentQueueEntry[] {
  return queued.flatMap((command) => {
    const parsed = assignmentBodySchema.safeParse(command.body);
    return parsed.success
      ? [{ command, matchId: parsed.data.matchId, boardId: parsed.data.boardId, expectedVersion: parsed.data.expectedVersion }]
      : [];
  });
}

/**
 * Zuweisungen, die noch an den Server gehen sollen oder auf eine
 * Entscheidung warten. Nur sie belegen Board und Match in der Disposition und
 * zaehlen fuer die erwartete Turnierversion; eine abgelehnte Zuweisung ist nie
 * geschehen und gibt Board wie Match wieder frei.
 */
export function unsentAssignments(entries: readonly AssignmentQueueEntry[]): readonly AssignmentQueueEntry[] {
  return entries.filter((entry) => entry.command.status === "PENDING" || entry.command.status === "CONFLICT");
}
