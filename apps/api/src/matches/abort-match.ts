import { and, eq } from "drizzle-orm";

import {
  boardControllerLeases,
  boards,
  legs,
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
  const discarded = await transaction
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.organizationId, input.organizationId), eq(visits.matchId, input.match.id)));
  await transaction.delete(visits).where(and(eq(visits.organizationId, input.organizationId), eq(visits.matchId, input.match.id)));
  await transaction.delete(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.match.id)));
  await transaction.update(matchParticipants).set({ legsWon: 0 }).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.match.id)));
  await transaction.delete(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.match.id)));
  await transaction.update(matches).set({
    status: "ABORTED",
    boardId: null,
    currentSeat: null,
    winnerSeat: null,
    completedAt: null,
    version: input.match.version + 1,
    updatedAt: new Date(),
  }).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.match.id)));
  if (input.match.boardId !== null) {
    await transaction.update(boards).set({ status: "AVAILABLE", updatedAt: new Date() }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.match.boardId)));
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
