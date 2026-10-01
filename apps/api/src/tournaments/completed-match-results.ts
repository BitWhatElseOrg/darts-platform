import { and, eq } from "drizzle-orm";

import { matchParticipantPlayers, matchParticipants, type tournamentMatches } from "@darts-platform/database";
import type { GroupMatchResult } from "@darts-platform/tournament-engine";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
type TournamentMatchRow = typeof tournamentMatches.$inferSelect;

export interface CompletedMatchResults {
  readonly results: readonly GroupMatchResult[];
  /** Kampflose Siege ohne Gegner (Vereinsduell: unbesetzter Finalrunden-Platz). */
  readonly unopposedWalkoverWinnerIds: readonly string[];
}

/**
 * Resultate abgeschlossener Turniermatches: Walkover als 0:0 mit Sieger,
 * gespielte Matches mit den Legs aus der Scoring-Projektion. Gemeinsame Basis
 * fuer Gruppenaufloesung und Vereinsduell.
 */
export async function loadCompletedMatchResults(
  transaction: DatabaseTransaction,
  organizationId: string,
  matches: readonly TournamentMatchRow[],
): Promise<CompletedMatchResults> {
  const results: GroupMatchResult[] = [];
  const unopposedWalkoverWinnerIds: string[] = [];
  for (const match of matches) {
    if (match.status !== "COMPLETED") continue;
    if (match.winnerPlayerId === null) throw new Error("Completed tournament match invariant violated.");
    if (match.participantOneId === null || match.participantTwoId === null) {
      if (match.resultType !== "WALKOVER") throw new Error("Completed tournament match invariant violated.");
      unopposedWalkoverWinnerIds.push(match.winnerPlayerId);
      continue;
    }
    if (match.resultType === "WALKOVER") {
      results.push({ type: "WALKOVER", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: match.winnerPlayerId });
      continue;
    }
    if (match.scoringMatchId === null) throw new Error("Completed tournament match invariant violated.");
    const rows = await transaction
      .select({ playerId: matchParticipantPlayers.playerId, legsWon: matchParticipants.legsWon })
      .from(matchParticipants)
      .innerJoin(matchParticipantPlayers, and(eq(matchParticipantPlayers.participantId, matchParticipants.id), eq(matchParticipantPlayers.organizationId, organizationId)))
      .where(and(eq(matchParticipants.organizationId, organizationId), eq(matchParticipants.matchId, match.scoringMatchId)));
    const first = rows.find((row) => row.playerId === match.participantOneId);
    const second = rows.find((row) => row.playerId === match.participantTwoId);
    if (first === undefined || second === undefined) throw new Error("Completed match participant invariant violated.");
    results.push({ type: "PLAYED", playerOneId: first.playerId, playerTwoId: second.playerId, playerOneLegs: first.legsWon, playerTwoLegs: second.legsWon, winnerPlayerId: match.winnerPlayerId });
  }
  return { results, unopposedWalkoverWinnerIds };
}
