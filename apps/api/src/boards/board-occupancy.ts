import { and, asc, eq, inArray } from "drizzle-orm";

import {
  encounterSlots,
  matchParticipantPlayers,
  matches,
  players,
  tournamentMatches,
  type Database,
} from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<
  Parameters<DatabaseService["database"]["transaction"]>[0]
>[0];

/**
 * Lesender Zugriff auf die Belegung — entweder auf der offenen Verbindung
 * (Anzeige) oder innerhalb einer Transaktion (Startpfad). Beide Aufrufer
 * muessen dieselbe Menge sehen, sonst zeigt die Warteschlange „bereit“, was
 * der Start ablehnt.
 */
export type BoardOccupancyExecutor = Database | DatabaseTransaction;

/**
 * Der Name des partiellen Unique-Index, der eine physische Scheibe gegen zwei
 * laufende Matches sichert (`packages/database/src/schema.ts`).
 */
export const BOARD_IN_PROGRESS_UNIQUE = "matches_board_in_progress_unique";

/**
 * Turnier und Liga schreiben in getrennte Tabellen; kein Fremdschluessel
 * verbindet sie. Eine Scheibe gilt deshalb erst dann als frei, wenn weder ein
 * Turniermatch noch ein Ligaslot darauf laeuft. Beide Quellen zaehlen.
 */
export async function isBoardOccupied(
  executor: BoardOccupancyExecutor,
  organizationId: string,
  boardId: string,
): Promise<boolean> {
  const [tournamentUse] = await executor
    .select({ id: tournamentMatches.id })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.organizationId, organizationId),
        eq(tournamentMatches.boardId, boardId),
        eq(tournamentMatches.status, "IN_PROGRESS"),
      ),
    )
    .limit(1);
  if (tournamentUse !== undefined) return true;
  const [encounterUse] = await executor
    .select({ id: encounterSlots.id })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.boardId, boardId),
        eq(encounterSlots.status, "IN_PROGRESS"),
      ),
    )
    .limit(1);
  return encounterUse !== undefined;
}

/**
 * Dieselbe Belegt-Menge wie {@link isBoardOccupied}, nur gebuendelt fuer die
 * Anzeige: eine Abfrage je Quelle statt eine je Scheibe.
 */
export async function loadOccupiedBoardIds(
  executor: BoardOccupancyExecutor,
  organizationId: string,
): Promise<ReadonlySet<string>> {
  const tournamentRows = await executor
    .select({ boardId: tournamentMatches.boardId })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.organizationId, organizationId),
        eq(tournamentMatches.status, "IN_PROGRESS"),
      ),
    );
  const encounterRows = await executor
    .select({ boardId: encounterSlots.boardId })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.status, "IN_PROGRESS"),
      ),
    );
  return new Set(
    [...tournamentRows, ...encounterRows].flatMap((row) =>
      row.boardId === null ? [] : [row.boardId],
    ),
  );
}

/**
 * Alle Personen, die im Verein gerade an einer Scheibe stehen — unabhaengig
 * davon, ob das Match aus einem Turnier, einer Begegnung oder einer freien
 * Paarung stammt. `matches` ist die gemeinsame Wurzel aller drei Wege.
 */
export async function loadActivePlayerIds(
  executor: BoardOccupancyExecutor,
  organizationId: string,
): Promise<ReadonlySet<string>> {
  const rows = await executor
    .select({ playerId: matchParticipantPlayers.playerId })
    .from(matchParticipantPlayers)
    .innerJoin(matches, eq(matches.id, matchParticipantPlayers.matchId))
    .where(
      and(
        eq(matchParticipantPlayers.organizationId, organizationId),
        eq(matches.status, "IN_PROGRESS"),
      ),
    );
  return new Set(rows.map((row) => row.playerId));
}

/**
 * Die Sperre auf der Turnier- oder Begegnungszeile serialisiert nur den
 * eigenen Wettbewerb. Eine Person kann aber in zwei Turnieren desselben
 * Vereins gemeldet sein; ohne Sperre saehen zwei gleichzeitige Zuweisungen sie
 * beide als frei und stellten sie an zwei Scheiben. Gesperrt wird deshalb ueber
 * die beteiligten Personen, und zwar in fester Reihenfolge, damit sich zwei
 * Zuweisungen nicht gegenseitig blockieren.
 */
export async function lockPlayers(
  transaction: DatabaseTransaction,
  organizationId: string,
  playerIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(playerIds)].sort();
  if (ids.length === 0) return;
  await transaction
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.organizationId, organizationId), inArray(players.id, ids)))
    .orderBy(asc(players.id))
    .for("update");
}

/**
 * Der partielle Unique-Index ist die letzte Klammer, wenn zwei Zuweisungen die
 * Anwendungspruefung gleichzeitig passieren. Sein Verstoss ist fachlich eine
 * belegte Scheibe und wird als solche beantwortet — die Postgres-Meldung
 * erreicht den Client nie.
 */
export function isBoardInProgressConflict(error: unknown): boolean {
  // Drizzle verpackt den Treiberfehler; die Kennung steht erst in `cause`.
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as {
      readonly code?: unknown;
      readonly constraint_name?: unknown;
      readonly cause?: unknown;
    };
    if (row.code === "23505" && row.constraint_name === BOARD_IN_PROGRESS_UNIQUE) return true;
    candidate = row.cause;
  }
  return false;
}
