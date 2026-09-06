import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { createStructuredLogEmitter, parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, legs, matches, matchParticipantPlayers, matchParticipants, outboxEvents, playerStatisticAggregates, players, visits } from "@darts-platform/database";
import { calculatePlayerStatistics } from "@darts-platform/statistics";

import { buildStatisticsMatches } from "./statistics/build-statistics-matches.js";
import { pruneProcessedOutboxEvents } from "./prune-outbox.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const logger = createStructuredLogEmitter("worker", environment.LOG_LEVEL);
let working = false;

async function rebuild(playerId: string, organizationId: string): Promise<void> {
  const matchRows = await connection.database.select({ id: matches.id, winnerSeat: matches.winnerSeat, completedAt: matches.completedAt, outRule: matches.outRule })
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
  const statisticsMatches = buildStatisticsMatches({
    matches: completed,
    participants: participantRows,
    legs: legRows.map((leg) => ({ id: leg.id, matchId: leg.matchId, winnerSeat: leg.winnerSeat })),
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
  await connection.database.insert(playerStatisticAggregates).values({ playerId, organizationId, payload: aggregate.career, sourceUpdatedAt: now })
    .onConflictDoUpdate({ target: playerStatisticAggregates.playerId, set: { payload: aggregate.career, sourceUpdatedAt: now, updatedAt: now } });
}

async function run(): Promise<void> {
  if (working) return;
  working = true;
  try {
    const events = await connection.database.select().from(outboxEvents).where(and(eq(outboxEvents.eventType, "MATCH_COMPLETED"), isNull(outboxEvents.statisticsProcessedAt))).orderBy(asc(outboxEvents.sequence)).limit(20);
    for (const event of events) {
      const participantRows = await connection.database.select({ playerId: matchParticipantPlayers.playerId, participantId: matchParticipantPlayers.participantId }).from(matchParticipantPlayers).where(and(eq(matchParticipantPlayers.organizationId, event.organizationId), eq(matchParticipantPlayers.matchId, event.aggregateId)));
      // Ein Doppel traegt je Sitz mehr als eine Person und zaehlt in der
      // Einzelrangliste nicht mit (Spec "Statistik"). Das Ereignis gilt
      // trotzdem als verarbeitet, sonst laeuft der Poller ewig dagegen.
      const seats = new Set(participantRows.map((participant) => participant.participantId));
      if (seats.size === participantRows.length) {
        for (const participant of participantRows) await rebuild(participant.playerId, event.organizationId);
      }
      await connection.database.update(outboxEvents).set({ statisticsProcessedAt: new Date() }).where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.statisticsProcessedAt)));
    }
  } catch (error) {
    logger.emit("error", {
      event: "statistics.tick_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  finally { working = false; }
}

let pruning = false;

/**
 * Stuendlich, nicht sekuendlich: die Aufraeumregel raeumt einen Rueckstand von
 * Tagen ab und muss nicht schneller laufen als er entsteht.
 */
async function prune(): Promise<void> {
  if (pruning) return;
  pruning = true;
  try {
    const removed = await pruneProcessedOutboxEvents(connection.database, new Date());
    if (removed > 0) console.log(`Outbox aufgeraeumt: ${removed} verarbeitete Zeilen entfernt`);
  } catch (error) { console.error("Outbox-Aufraeumen fehlgeschlagen", error); }
  finally { pruning = false; }
}

setInterval(() => void run(), 1_000);
void run();
setInterval(() => void prune(), 3_600_000);
void prune();
process.on("SIGTERM", () => void connection.close().finally(() => process.exit(0)));
process.on("SIGINT", () => void connection.close().finally(() => process.exit(0)));
