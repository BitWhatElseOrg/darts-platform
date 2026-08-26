import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, legs, matches, matchParticipants, outboxEvents, playerStatisticAggregates, players, visits } from "@darts-platform/database";
import { calculatePlayerStatistics, type StatisticsMatch } from "@darts-platform/statistics";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
let working = false;

async function rebuild(playerId: string, organizationId: string): Promise<void> {
  const matchRows = await connection.database.select({ id: matches.id, winnerPlayerId: matches.winnerPlayerId, completedAt: matches.completedAt })
    .from(matchParticipants).innerJoin(matches, and(eq(matches.id, matchParticipants.matchId), eq(matches.organizationId, organizationId)))
    .where(and(eq(matchParticipants.organizationId, organizationId), eq(matchParticipants.playerId, playerId), eq(matches.status, "COMPLETED")));
  const completed = matchRows.filter((match): match is typeof match & { winnerPlayerId: string; completedAt: Date } => match.winnerPlayerId !== null && match.completedAt !== null);
  const ids = completed.map((match) => match.id);
  if (ids.length === 0) return;
  const [participantRows, legRows, visitRows] = await Promise.all([
    connection.database.select({ matchId: matchParticipants.matchId, playerId: matchParticipants.playerId, displayName: players.displayName, legsWon: matchParticipants.legsWon })
      .from(matchParticipants).innerJoin(players, and(eq(players.id, matchParticipants.playerId), eq(players.organizationId, organizationId)))
      .where(and(eq(matchParticipants.organizationId, organizationId), inArray(matchParticipants.matchId, ids))).orderBy(asc(matchParticipants.seat)),
    connection.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), inArray(legs.matchId, ids))),
    connection.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), inArray(visits.matchId, ids))),
  ]);
  const statisticsMatches: StatisticsMatch[] = completed.flatMap((match) => {
    const participants = participantRows.filter((participant) => participant.matchId === match.id);
    const first = participants[0]; const second = participants[1];
    if (first === undefined || second === undefined) return [];
    return [{ id: match.id, completedAt: match.completedAt, winnerPlayerId: match.winnerPlayerId, participants: [
      { playerId: first.playerId, displayName: first.displayName, legsWon: first.legsWon, setsWon: first.playerId === match.winnerPlayerId ? 1 : 0 },
      { playerId: second.playerId, displayName: second.displayName, legsWon: second.legsWon, setsWon: second.playerId === match.winnerPlayerId ? 1 : 0 },
    ], legs: legRows.filter((leg) => leg.matchId === match.id).map((leg) => ({ id: leg.id, winnerPlayerId: leg.winnerPlayerId })), visits: visitRows.filter((visit) => visit.matchId === match.id).map((visit) => ({ legId: visit.legId, playerId: visit.playerId, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown, checkoutAttempts: visit.checkoutAttempts, outcome: visit.outcome as "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON", reverted: visit.revertedAt !== null })) }];
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
      const participantRows = await connection.database.select({ playerId: matchParticipants.playerId }).from(matchParticipants).where(and(eq(matchParticipants.organizationId, event.organizationId), eq(matchParticipants.matchId, event.aggregateId)));
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
