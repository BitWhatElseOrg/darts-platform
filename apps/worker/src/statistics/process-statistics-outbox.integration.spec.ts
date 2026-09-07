import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  OUTBOX_MAX_ATTEMPTS,
  createDatabaseConnection,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  organizations,
  outboxEvents,
  players,
  type DatabaseConnection,
  type OutboxLogger,
} from "@darts-platform/database";

import { processStatisticsOutbox } from "./process-statistics-outbox.js";

const environment = parseApplicationEnvironment(process.env);
let connection: DatabaseConnection;

interface LoggedRecord {
  readonly level: "error" | "warn" | "log" | "debug";
  readonly fields: Readonly<Record<string, unknown>>;
}

function logRecorder(): OutboxLogger & { readonly records: LoggedRecord[] } {
  const records: LoggedRecord[] = [];
  return {
    records,
    emit(level, fields) {
      records.push({ level, fields });
    },
  };
}

const organizationId = randomUUID();
let poisonPlayerId = "";
let healthyPlayerId = "";
let poisonMatchId = "";
let healthyMatchId = "";

async function createCompletedMatch(playerId: string): Promise<string> {
  const database = connection.database;
  const [match] = await database
    .insert(matches)
    .values({
      organizationId,
      bestOfLegs: 3,
      startingSeat: 1,
      status: "COMPLETED",
      winnerSeat: 1,
      completedAt: new Date("2026-09-06T09:00:00.000Z"),
    })
    .returning();
  const [participant] = await database
    .insert(matchParticipants)
    .values({ organizationId, matchId: match?.id ?? "", seat: 1, legsWon: 2 })
    .returning();
  await database.insert(matchParticipantPlayers).values({
    organizationId,
    matchId: match?.id ?? "",
    participantId: participant?.id ?? "",
    playerId,
    position: 1,
  });
  return match?.id ?? "";
}

beforeAll(async () => {
  connection = createDatabaseConnection(environment.DATABASE_URL);
  const database = connection.database;
  await database.insert(organizations).values({
    id: organizationId,
    name: "Statistik Test",
    slug: `statistik-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  const [poisonPlayer] = await database
    .insert(players)
    .values({ organizationId, displayName: "Poison Person", status: "ACTIVE" })
    .returning();
  poisonPlayerId = poisonPlayer?.id ?? "";
  const [healthyPlayer] = await database
    .insert(players)
    .values({ organizationId, displayName: "Zweite Person", status: "ACTIVE" })
    .returning();
  healthyPlayerId = healthyPlayer?.id ?? "";
  poisonMatchId = await createCompletedMatch(poisonPlayerId);
  healthyMatchId = await createCompletedMatch(healthyPlayerId);
});

afterAll(async () => {
  await connection.database
    .delete(organizations)
    .where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("processStatisticsOutbox", () => {
  it("verarbeitet nachfolgende Ereignisse, obwohl eines fehlschlaegt", async () => {
    const database = connection.database;
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: poisonMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: poisonMatchId },
        occurredAt: new Date("2026-09-06T09:00:00.000Z"),
      })
      .returning();
    const [healthy] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: healthyMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: healthyMatchId },
        occurredAt: new Date("2026-09-06T09:00:01.000Z"),
      })
      .returning();
    const logger = logRecorder();
    const rebuilt: string[] = [];

    await processStatisticsOutbox({
      database,
      logger,
      limit: 500,
      rebuild: async (playerId) => {
        if (playerId === poisonPlayerId) {
          throw new Error("Aggregat nicht berechenbar");
        }
        rebuilt.push(playerId);
      },
    });

    expect(rebuilt).toContain(healthyPlayerId);
    const [storedHealthy] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, healthy?.id ?? ""));
    expect(storedHealthy?.statisticsProcessedAt).not.toBeNull();
    const [storedPoison] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(storedPoison?.statisticsProcessedAt).toBeNull();
    expect(storedPoison?.statisticsAttempts).toBe(1);
    expect(storedPoison?.statisticsNotBefore).not.toBeNull();
    expect(storedPoison?.statisticsLastError).toBe("Aggregat nicht berechenbar");
  });

  it("legt ein dauerhaft fehlschlagendes Ereignis nach OUTBOX_MAX_ATTEMPTS Versuchen ins Dead Letter", async () => {
    const database = connection.database;
    const start = new Date("2026-09-06T11:00:00.000Z");
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: poisonMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: poisonMatchId },
        occurredAt: start,
      })
      .returning();
    const logger = logRecorder();

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      const clock = new Date(start.getTime() + attempt * 600_000);
      await processStatisticsOutbox({
        database,
        logger,
        limit: 500,
        now: () => clock,
        rebuild: async (playerId) => {
          if (playerId === poisonPlayerId) {
            throw new Error("Aggregat nicht berechenbar");
          }
        },
      });
    }

    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(stored?.statisticsAttempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(stored?.statisticsDeadLetteredAt).not.toBeNull();
    const deadLetter = logger.records.find(
      (entry) =>
        entry.fields.event === "outbox.dead_letter" &&
        entry.fields.eventId === poison?.id,
    );
    expect(deadLetter?.level).toBe("error");
    expect(deadLetter?.fields).toMatchObject({
      consumer: "statistics",
      eventId: poison?.id,
      eventType: "MATCH_COMPLETED",
      aggregateId: poisonMatchId,
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: "Aggregat nicht berechenbar",
    });
  });

  it("protokolliert jede Verarbeitung mit Ereigniskennung", async () => {
    const database = connection.database;
    const [event] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Match",
        aggregateId: healthyMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: healthyMatchId },
      })
      .returning();
    const logger = logRecorder();

    await processStatisticsOutbox({
      database,
      logger,
      limit: 500,
      rebuild: async () => undefined,
    });

    const processed = logger.records.find(
      (entry) => entry.fields.eventId === event?.id,
    );
    expect(processed?.fields).toMatchObject({
      event: "statistics.event_processed",
      eventType: "MATCH_COMPLETED",
      aggregateId: healthyMatchId,
    });
  });
  /**
   * Derselbe Befund wie I8 beim Relay, hier fuer den Statistik-Konsumenten:
   * der Poller las ohne `FOR UPDATE SKIP LOCKED`. Zwei Worker-Repliken lesen
   * damit denselben Stapel und aggregieren jedes Ereignis zweimal —
   * idempotent, aber doppelte Arbeit. Zwanzig Ereignisse, damit das Fenster
   * zwischen Lesen und Stempeln im alten Verhalten sicher getroffen wird.
   */
  it("laesst eine zweite Replik denselben Stapel nicht ein zweites Mal aggregieren", async () => {
    const database = connection.database;
    await database.insert(outboxEvents).values(
      Array.from({ length: 20 }, (_unused, index) => ({
        organizationId,
        aggregateType: "Match",
        aggregateId: healthyMatchId,
        eventType: "MATCH_COMPLETED",
        payload: { matchId: healthyMatchId },
        occurredAt: new Date(Date.now() + index),
      })),
    );
    const logger = logRecorder();
    // Nur die eigenen Aufrufe zaehlen: der Poller arbeitet global, parallel
    // laufende Testdateien schreiben in dieselbe Outbox.
    const rebuilt: string[] = [];
    const countOwn = async (playerId: string): Promise<void> => {
      if (playerId === healthyPlayerId) rebuilt.push(playerId);
    };

    await Promise.all([
      processStatisticsOutbox({ database, logger, limit: 500, rebuild: countOwn }),
      processStatisticsOutbox({ database, logger, limit: 500, rebuild: countOwn }),
    ]);

    expect(rebuilt).toHaveLength(20);
  }, 30_000);
});
