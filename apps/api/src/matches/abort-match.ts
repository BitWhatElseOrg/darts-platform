import { and, eq, isNull } from "drizzle-orm";

import {
  boardControllerLeases,
  boards,
  matches,
  matchParticipants,
  scoreCommands,
  visits,
  type Database,
  type Match,
} from "@darts-platform/database";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface AbortedScoringMatch {
  readonly matchId: string;
  readonly boardId: string | null;
  readonly discardedVisitCount: number;
  readonly previousVersion: number;
}

export async function abortScoringMatch(transaction: Transaction, input: {
  readonly organizationId: string;
  readonly match: Match;
  readonly commandId: string;
  readonly tournamentMatchId: string | null;
  readonly reason?: string;
  readonly source: "DIRECT" | "TOURNAMENT_WITHDRAWAL" | "ENCOUNTER_BOARD_RELEASE";
}): Promise<AbortedScoringMatch> {
  const now = new Date();
  // Befund I9: Aufnahmen und Legs werden entwertet, nicht geloescht. Ein
  // versehentlicher Abbruch bleibt so rekonstruierbar, und `visit_darts`
  // haengt weiter an seiner Aufnahme. Dieselbe Systematik wie beim Undo
  // (`reverted_at`, `reverted_by_command_id`); alle Leseabfragen des
  // laufenden Spiels filtern bereits auf `reverted_at is null`.
  const discarded = await transaction
    .update(visits)
    .set({ revertedAt: now, revertedByCommandId: input.commandId })
    .where(and(
      eq(visits.organizationId, input.organizationId),
      eq(visits.matchId, input.match.id),
      isNull(visits.revertedAt),
    ))
    .returning({ id: visits.id });
  // Die Legs bleiben stehen: `visits.leg_id` ist NOT NULL und zeigt auf sie.
  // Ihr Status bleibt unveraendert und erfuellt damit `legs_completion_check`
  // (Migration 0023) — ein laufendes Leg ohne Gewinner, ein abgeschlossenes
  // mit. Ein abgebrochenes Match wird nie fortgesetzt: der Turnier- und der
  // Ligapfad legen bei der naechsten Zuweisung ein neues Match an.
  await transaction.update(matchParticipants).set({ legsWon: 0 }).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.match.id)));
  await transaction.delete(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.match.id)));
  await transaction.update(matches).set({
    status: "ABORTED",
    boardId: null,
    currentSeat: null,
    winnerSeat: null,
    completedAt: null,
    version: input.match.version + 1,
    updatedAt: now,
  }).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.match.id)));
  if (input.match.boardId !== null) {
    await transaction.update(boards).set({ status: "AVAILABLE", updatedAt: now }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.match.boardId)));
  }
  const payload = {
    type: "ABORT_MATCH" as const,
    commandId: input.commandId,
    tournamentMatchId: input.tournamentMatchId,
    discardedVisitCount: discarded.length,
    reason: input.reason ?? null,
    source: input.source,
  };
  await transaction.insert(scoreCommands).values({
    commandId: input.commandId,
    organizationId: input.organizationId,
    matchId: input.match.id,
    type: payload.type,
    payload,
    resultingVersion: input.match.version + 1,
  });
  return { matchId: input.match.id, boardId: input.match.boardId, discardedVisitCount: discarded.length, previousVersion: input.match.version };
}
