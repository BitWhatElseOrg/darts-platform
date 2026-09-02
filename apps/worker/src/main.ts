import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, legs, matches, matchParticipantPlayers, matchParticipants, outboxEvents, playerStatisticAggregates, players, visits } from "@darts-platform/database";
import { calculatePlayerStatistics, type StatisticsMatch } from "@darts-platform/statistics";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
let working = false;

async function rebuild(playerId: string, organizationId: string): Promise<void> {
  const matchRows = await connection.database.select({ id: matches.id, winnerSeat: matches.winnerSeat, completedAt: matches.completedAt })
    .from(matchParticipantPlayers).innerJoin(matches, and(eq(matches.id, matchParticipantPlayers.matchId), eq(matches.organizationId, organizationId)))
    .where(and(eq(matchParticipantPlayers.organizationId, organizationId), eq(matchParticipantPlayers.playerId, playerId), eq(matches.status, "COMPLETED")));
  const completed = matchRows.filter((match): match is typeof match & { winnerSeat: number; completedAt: Date } => match.winnerSeat !== null && match.completedAt !== null);
  const ids = completed.map((match) => match.id);
  if (ids.length === 0) return;
  const [participantRows, legRows, visitRows] = await Promise.all([
    connection.database.select({ matchId: matchParticipants.matchId, seat: matchParticipants.seat, playerId: matchParticipantPlayers.playerId, displayName: players.displayName, legsWon: matchParticipants.legsWon })
      .from(matchParticipants)
      .innerJoin(matchParticipantPlayers, and(eq(matchParticipantPlayers.participantId, matchParticipants.id), eq(matchParticipantPlayers.organizationId, organizationId)))
      .innerJoin(players, and(eq(players.id, matchParticipantPlayers.playerId), eq(players.organizationId, organizationId)))
      .where(and(eq(matchParticipants.organizationId, organizationId), inArray(matchParticipants.matchId, ids)))
      .orderBy(asc(matchParticipants.seat), asc(matchParticipantPlayers.position)),
    connection.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), inArray(legs.matchId, ids))),
    connection.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), inArray(visits.matchId, ids))),
  ]);
  const statisticsMatches: StatisticsMatch[] = completed.flatMap((match) => {
    const participants = participantRows.filter((participant) => participant.matchId === match.id);
    const first = participants[0]; const second = participants[1];
    if (first === undefined || second === undefined) return [];
    // Ein Sitz traegt in dieser Phase genau eine Person; die Statistik bleibt personenbezogen.
    const playerOfSeat = (seat: number | null): string | null =>
      seat === null ? null : (participants.find((participant) => participant.seat === seat)?.playerId ?? null);
    const winnerPlayerId = playerOfSeat(match.winnerSeat);
    if (winnerPlayerId === null) return [];
    return [{ id: match.id, completedAt: match.completedAt, winnerPlayerId, participants: [
      { playerId: first.playerId, displayName: first.displayName, legsWon: first.legsWon, setsWon: first.seat === match.winnerSeat ? 1 : 0 },
      { playerId: second.playerId, displayName: second.displayName, legsWon: second.legsWon, setsWon: second.seat === match.winnerSeat ? 1 : 0 },
    ], legs: legRows.filter((leg) => leg.matchId === match.id).map((leg) => ({ id: leg.id, winnerPlayerId: playerOfSeat(leg.winnerSeat) })), visits: visitRows.filter((visit) => visit.matchId === match.id).map((visit) => ({ legId: visit.legId, playerId: visit.throwerPlayerId, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown, checkoutAttempts: visit.checkoutAttempts, outcome: visit.outcome as "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON", reverted: visit.revertedAt !== null })) }];
  });
  const aggregate = calculatePlayerStatistics(playerId, statisticsMatches);
  const now = new Date();
  await connection.database.insert(playerStatisticAggregates).values({ playerId, organizationId, payload: aggregate.career, sourceUpdatedAt: now })
    .onConflictDoUpdate({ target: playerStatisticAggregates.playerId, set: { payload: aggregate.career, sourceUpdatedAt: now, updatedAt: now } });
}

async function run(): Promise<void> {
  if (working) return;
  working = true;
  try {
    const events = await connection.database.select().from(outboxEvents).where(and(eq(outboxEvents.eventType, "MATCH_COMPLETED"), isNull(outboxEvents.statisticsProcessedAt))).orderBy(asc(outboxEvents.occurredAt)).limit(20);
    for (const event of events) {
      const participantRows = await connection.database.select({ playerId: matchParticipantPlayers.playerId }).from(matchParticipantPlayers).where(and(eq(matchParticipantPlayers.organizationId, event.organizationId), eq(matchParticipantPlayers.matchId, event.aggregateId)));
      for (const participant of participantRows) await rebuild(participant.playerId, event.organizationId);
      await connection.database.update(outboxEvents).set({ statisticsProcessedAt: new Date() }).where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.statisticsProcessedAt)));
    }
  } catch (error) { console.error("Statistik-Aggregation fehlgeschlagen", error); }
  finally { working = false; }
}

setInterval(() => void run(), 1_000);
void run();
process.on("SIGTERM", () => void connection.close().finally(() => process.exit(0)));
process.on("SIGINT", () => void connection.close().finally(() => process.exit(0)));
