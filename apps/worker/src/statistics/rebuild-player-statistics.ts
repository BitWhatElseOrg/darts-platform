import { and, asc, eq, inArray } from "drizzle-orm";
import {
  legs,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  playerStatisticAggregates,
  players,
  visits,
  type Database,
} from "@darts-platform/database";
import { calculatePlayerStatistics } from "@darts-platform/statistics";

import { buildStatisticsMatches } from "./build-statistics-matches.js";

export type RebuildPlayerStatistics = (
  playerId: string,
  organizationId: string,
) => Promise<void>;

/**
 * Rechnet die Karriereaggregate einer Person vollstaendig neu (ADR 0009:
 * Aggregate sind nie die einzige Wahrheit). Die volle Neuberechnung macht
 * einen wiederholten Lauf ueber dasselbe Ereignis unschaedlich.
 *
 * Alle Abfragen sind auf `organizationId` eingeschraenkt: der aufrufende
 * Poller liest zwar organisationsuebergreifend, rechnet aber je Ereignis
 * ausschliesslich in dessen eigener Organisation weiter.
 */
export async function rebuildPlayerStatistics(
  database: Database,
  playerId: string,
  organizationId: string,
): Promise<void> {
  const matchRows = await database
    .select({
      id: matches.id,
      winnerSeat: matches.winnerSeat,
      completedAt: matches.completedAt,
      outRule: matches.outRule,
    })
    .from(matchParticipantPlayers)
    .innerJoin(
      matches,
      and(
        eq(matches.id, matchParticipantPlayers.matchId),
        eq(matches.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(matchParticipantPlayers.organizationId, organizationId),
        eq(matchParticipantPlayers.playerId, playerId),
        eq(matches.status, "COMPLETED"),
      ),
    );
  const completed = matchRows.filter(
    (match): match is typeof match & { winnerSeat: number; completedAt: Date } =>
      match.winnerSeat !== null && match.completedAt !== null,
  );
  const ids = completed.map((match) => match.id);
  if (ids.length === 0) return;

  const [participantRows, legRows, visitRows] = await Promise.all([
    database
      .select({
        matchId: matchParticipants.matchId,
        seat: matchParticipants.seat,
        playerId: matchParticipantPlayers.playerId,
        displayName: players.displayName,
        legsWon: matchParticipants.legsWon,
      })
      .from(matchParticipants)
      .innerJoin(
        matchParticipantPlayers,
        and(
          eq(matchParticipantPlayers.participantId, matchParticipants.id),
          eq(matchParticipantPlayers.organizationId, organizationId),
        ),
      )
      .innerJoin(
        players,
        and(
          eq(players.id, matchParticipantPlayers.playerId),
          eq(players.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(matchParticipants.organizationId, organizationId),
          inArray(matchParticipants.matchId, ids),
        ),
      )
      .orderBy(asc(matchParticipants.seat), asc(matchParticipantPlayers.position)),
    database
      .select()
      .from(legs)
      .where(and(eq(legs.organizationId, organizationId), inArray(legs.matchId, ids))),
    database
      .select()
      .from(visits)
      .where(
        and(eq(visits.organizationId, organizationId), inArray(visits.matchId, ids)),
      ),
  ]);

  const statisticsMatches = buildStatisticsMatches({
    matches: completed,
    participants: participantRows,
    legs: legRows.map((leg) => ({
      id: leg.id,
      matchId: leg.matchId,
      winnerSeat: leg.winnerSeat,
    })),
    visits: visitRows.map((visit) => ({
      matchId: visit.matchId,
      legId: visit.legId,
      throwerPlayerId: visit.throwerPlayerId,
      appliedPoints: visit.appliedPoints,
      dartsThrown: visit.dartsThrown,
      checkoutAttempts: visit.checkoutAttempts,
      outcome: visit.outcome,
      revertedAt: visit.revertedAt,
    })),
  });

  const aggregate = calculatePlayerStatistics(playerId, statisticsMatches);
  const now = new Date();
  await database
    .insert(playerStatisticAggregates)
    .values({
      playerId,
      organizationId,
      payload: aggregate.career,
      sourceUpdatedAt: now,
    })
    .onConflictDoUpdate({
      target: playerStatisticAggregates.playerId,
      set: { payload: aggregate.career, sourceUpdatedAt: now, updatedAt: now },
    });
}
