import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, organizations, outboxEvents } from "@darts-platform/database";

import { OUTBOX_RETENTION_DAYS, pruneProcessedOutboxEvents } from "./prune-outbox.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const organizationId = randomUUID();
const now = new Date("2026-09-06T12:00:00.000Z");
const old = new Date(now.getTime() - (OUTBOX_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
const recent = new Date(now.getTime() - 60 * 1000);

beforeAll(async () => {
  await connection.database.insert(organizations).values({
    id: organizationId,
    name: "Retention Club",
    slug: `retention-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await connection.database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("pruneProcessedOutboxEvents", () => {
  it("entfernt nur alte, vollstaendig verarbeitete Zeilen", async () => {
    const rows = await connection.database
      .insert(outboxEvents)
      .values([
        // 0: alt, verteilt, statistisch verarbeitet -> weg
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "MATCH_COMPLETED", payload: {}, occurredAt: old, publishedAt: old, statisticsProcessedAt: old },
        // 1: alt, verteilt, aber statistisch offen -> bleibt
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "MATCH_COMPLETED", payload: {}, occurredAt: old, publishedAt: old },
        // 2: alt, verteilt, kein Statistikereignis -> weg
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "VISIT_RECORDED", payload: {}, occurredAt: old, publishedAt: old },
        // 3: alt, noch nicht verteilt -> bleibt
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "VISIT_RECORDED", payload: {}, occurredAt: old },
        // 4: frisch und vollstaendig verarbeitet -> bleibt
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "MATCH_COMPLETED", payload: {}, occurredAt: recent, publishedAt: recent, statisticsProcessedAt: recent },
      ])
      .returning({ id: outboxEvents.id });
    const ids = rows.map((row) => row.id);

    const removed = await pruneProcessedOutboxEvents(connection.database, now);

    // Mind. die beiden eigenen Treffer: der Rueckstand im geteilten Dev-Setup
    // ist nicht kontrollierbar, deshalb keine exakte Zahl.
    expect(removed).toBeGreaterThanOrEqual(2);
    const remaining = await connection.database
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, ids));
    expect(new Set(remaining.map((row) => row.id))).toEqual(new Set([ids[1], ids[3], ids[4]]));
  }, 30_000);

  /**
   * M4: ein Lauf begrenzt sich auf einen Batch, statt die gesamte
   * Treffermenge in einer Anweisung zu loeschen. Fuenf eigene Zeilen mit
   * `batchSize` 2 belegen das direkt ueber den Rueckgabewert — der darf den
   * Batch nie ueberschreiten — und darueber, dass von den eigenen Zeilen nie
   * mehr als der Batch verschwindet.
   */
  it("begrenzt einen Lauf auf die Batchgroesse", async () => {
    const batchSize = 2;
    const rows = await connection.database
      .insert(outboxEvents)
      .values(
        Array.from({ length: 5 }, () => ({
          organizationId,
          aggregateType: "Match",
          aggregateId: randomUUID(),
          eventType: "VISIT_RECORDED",
          payload: {},
          occurredAt: old,
          publishedAt: old,
        })),
      )
      .returning({ id: outboxEvents.id });
    const ids = rows.map((row) => row.id);

    const removed = await pruneProcessedOutboxEvents(connection.database, now, OUTBOX_RETENTION_DAYS, batchSize);

    expect(removed).toBeLessThanOrEqual(batchSize);
    const remaining = await connection.database
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, ids));
    expect(remaining.length).toBeGreaterThanOrEqual(ids.length - batchSize);

    // Aufraeumen: die Zeilen, die der begrenzte Lauf absichtlich stehen liess.
    await connection.database.delete(outboxEvents).where(inArray(outboxEvents.id, ids));
  }, 30_000);
});
