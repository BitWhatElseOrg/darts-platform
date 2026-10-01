import { and, eq, inArray } from "drizzle-orm";

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

/** Gewonnene Legs einer Person in einem Scoring-Match; `undefined`, wenn unbekannt. */
export type LegsOf = (scoringMatchId: string, playerId: string) => number | undefined;

/** Die Felder eines Turniermatches, die das Resultat bestimmen. */
export type CompletedResultSource = Pick<
  TournamentMatchRow,
  "status" | "winnerPlayerId" | "participantOneId" | "participantTwoId" | "resultType" | "scoringMatchId"
>;

/**
 * Reines Mapping eines Turniermatches auf sein Resultat: Walkover als 0:0 mit
 * Sieger, kampfloser Sieg ohne Gegner als `"unopposed"`, gespielte Matches mit
 * den Legs aus `legsOf`. `null`, wenn das Match (noch) kein verwertbares
 * Resultat traegt – der Lesepfad ueberspringt es, der Schreibpfad
 * (`loadCompletedMatchResults`) wertet das bei COMPLETED als Invariantenbruch.
 */
export function toCompletedResult(match: CompletedResultSource, legsOf: LegsOf): GroupMatchResult | "unopposed" | null {
  if (match.status !== "COMPLETED" || match.winnerPlayerId === null) return null;
  if (match.participantOneId === null || match.participantTwoId === null) return match.resultType === "WALKOVER" ? "unopposed" : null;
  if (match.resultType === "WALKOVER") {
    return { type: "WALKOVER", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: match.winnerPlayerId };
  }
  if (match.scoringMatchId === null) return null;
  const playerOneLegs = legsOf(match.scoringMatchId, match.participantOneId);
  const playerTwoLegs = legsOf(match.scoringMatchId, match.participantTwoId);
  if (playerOneLegs === undefined || playerTwoLegs === undefined) return null;
  return { type: "PLAYED", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs, playerTwoLegs, winnerPlayerId: match.winnerPlayerId };
}

/**
 * Resultate abgeschlossener Turniermatches (Mapping: `toCompletedResult`).
 * Gemeinsame Basis fuer Gruppenaufloesung und Vereinsduell. Ein COMPLETED-
 * Match ohne verwertbares Resultat ist hier ein Invariantenbruch.
 */
export async function loadCompletedMatchResults(
  transaction: DatabaseTransaction,
  organizationId: string,
  matches: readonly TournamentMatchRow[],
): Promise<CompletedMatchResults> {
  // Ein Roundtrip fuer alle gespielten Matches statt einer je Match.
  const playedScoringIds = matches.flatMap((match) =>
    match.status === "COMPLETED" && match.resultType !== "WALKOVER" && match.participantOneId !== null && match.participantTwoId !== null && match.scoringMatchId !== null
      ? [match.scoringMatchId]
      : []);
  const legRows = playedScoringIds.length === 0
    ? []
    : await transaction
        .select({ matchId: matchParticipants.matchId, playerId: matchParticipantPlayers.playerId, legsWon: matchParticipants.legsWon })
        .from(matchParticipants)
        .innerJoin(matchParticipantPlayers, and(eq(matchParticipantPlayers.participantId, matchParticipants.id), eq(matchParticipantPlayers.organizationId, organizationId)))
        .where(and(eq(matchParticipants.organizationId, organizationId), inArray(matchParticipants.matchId, playedScoringIds)));
  const legsByKey = new Map(legRows.map((row) => [`${row.matchId}:${row.playerId}`, row.legsWon]));
  const legsOf: LegsOf = (scoringMatchId, playerId) => legsByKey.get(`${scoringMatchId}:${playerId}`);
  const results: GroupMatchResult[] = [];
  const unopposedWalkoverWinnerIds: string[] = [];
  for (const match of matches) {
    if (match.status !== "COMPLETED") continue;
    const result = toCompletedResult(match, legsOf);
    if (result === null) throw new Error("Completed tournament match invariant violated.");
    if (result === "unopposed") {
      // toCompletedResult liefert "unopposed" nur mit gesetztem Sieger.
      if (match.winnerPlayerId === null) throw new Error("Completed tournament match invariant violated.");
      unopposedWalkoverWinnerIds.push(match.winnerPlayerId);
      continue;
    }
    results.push(result);
  }
  return { results, unopposedWalkoverWinnerIds };
}
