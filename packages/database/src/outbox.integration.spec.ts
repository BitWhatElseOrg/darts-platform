import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { createDatabaseConnection } from "./client.js";
import {
  OUTBOX_MAX_ATTEMPTS,
  outboxPending,
  recordOutboxFailure,
  type OutboxConsumer,
  type OutboxLogger,
} from "./outbox.js";
import { organizations, outboxEvents } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Outbox-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const connection = createDatabaseConnection(databaseUrl);

afterAll(async () => {
  await connection.close();
});

/** Verwirft Log-Aufrufe; die Tests pruefen den DB-Zustand, nicht das Log. */
const silentLogger: OutboxLogger = {
  emit: () => {
    // absichtlich leer
  },
};

async function withOrganization<T>(run: (organizationId: string) => Promise<T>): Promise<T> {
  const organizationId = randomUUID();
  await connection.database.insert(organizations).values({
    id: organizationId,
    name: "Outbox Test Club",
    slug: `outbox-test-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  try {
    return await run(organizationId);
  } finally {
    // Kaskadiert auf outbox_events (onDelete: "cascade").
    await connection.database.delete(organizations).where(eq(organizations.id, organizationId));
  }
}

async function insertOutboxEvent(
  organizationId: string,
  overrides: Partial<typeof outboxEvents.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await connection.database.insert(outboxEvents).values({
    id,
    organizationId,
    aggregateType: "MATCH",
    aggregateId: randomUUID(),
    eventType: "MATCH_STARTED",
    payload: {},
    ...overrides,
  });
  return id;
}

async function selectPending(consumer: OutboxConsumer, eventId: string, now: Date): Promise<number> {
  const rows = await connection.database
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.id, eventId), outboxPending(consumer, now)));
  return rows.length;
}

describe("outboxPending gegen Postgres", () => {
  it.each([
    { consumer: "publish" as const, notBeforeColumn: "publishNotBefore" as const },
    { consumer: "statistics" as const, notBeforeColumn: "statisticsNotBefore" as const },
  ])("$consumer: schliesst eine Zeile innerhalb der Backoff-Sperre aus, waehlt sie danach", ({ consumer, notBeforeColumn }) =>
    withOrganization(async (organizationId) => {
      const now = new Date();
      const notBefore = new Date(now.getTime() + 60_000);
      const id = await insertOutboxEvent(organizationId, {
        eventType: "MATCH_COMPLETED",
        [notBeforeColumn]: notBefore,
      });

      expect(await selectPending(consumer, id, now)).toBe(0);
      expect(await selectPending(consumer, id, new Date(notBefore.getTime() + 1))).toBe(1);
    }),
  );

  it.each([{ consumer: "publish" as const }, { consumer: "statistics" as const }])(
    "$consumer: waehlt eine dead-gelettete Zeile nie aus",
    ({ consumer }) =>
      withOrganization(async (organizationId) => {
        const deadLetteredAtColumn =
          consumer === "publish" ? ("publishDeadLetteredAt" as const) : ("statisticsDeadLetteredAt" as const);
        const id = await insertOutboxEvent(organizationId, {
          eventType: "MATCH_COMPLETED",
          [deadLetteredAtColumn]: new Date(),
        });

        // Weit in der Zukunft: selbst eine laengst abgelaufene Backoff-Sperre
        // darf eine dead-gelettete Zeile nicht wieder auswaehlbar machen.
        expect(await selectPending(consumer, id, new Date(Date.now() + 86_400_000))).toBe(0);
      }),
  );

  it.each([{ consumer: "publish" as const }, { consumer: "statistics" as const }])(
    "$consumer: waehlt eine frische Zeile ohne Fehlversuche sofort aus",
    ({ consumer }) =>
      withOrganization(async (organizationId) => {
        const id = await insertOutboxEvent(organizationId, { eventType: "MATCH_COMPLETED" });

        expect(await selectPending(consumer, id, new Date())).toBe(1);
      }),
  );
});

describe("recordOutboxFailure gegen Postgres", () => {
  it("stempelt dead_lettered_at exakt beim Erreichen der Obergrenze, nicht davor", () =>
    withOrganization(async (organizationId) => {
      const maxAttempts = 3;
      const id = await insertOutboxEvent(organizationId);
      const now = new Date();

      const record = (error: string, at: Date) =>
        recordOutboxFailure({
          database: connection.database,
          consumer: "publish",
          eventId: id,
          error: new Error(error),
          now: at,
          maxAttempts,
          logger: silentLogger,
        });

      await expect(record("Fehlversuch 1", now)).resolves.toBe("retry");
      await expect(record("Fehlversuch 2", now)).resolves.toBe("retry");
      await expect(record("Fehlversuch 3", now)).resolves.toBe("dead_letter");

      const [afterThird] = await connection.database
        .select({
          attempts: outboxEvents.publishAttempts,
          deadLetteredAt: outboxEvents.publishDeadLetteredAt,
        })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, id));
      expect(afterThird?.attempts).toBe(3);
      expect(afterThird?.deadLetteredAt).not.toBeNull();
      const stampAfterThird = afterThird?.deadLetteredAt?.getTime();

      // Ein weiterer Aufruf lässt den Stempel unveraendert -- er wird nicht
      // mit einem neuen `now` ueberschrieben.
      await expect(record("Fehlversuch 4", new Date(now.getTime() + 5_000))).resolves.toBe("dead_letter");

      const [afterFourth] = await connection.database
        .select({ deadLetteredAt: outboxEvents.publishDeadLetteredAt })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, id));
      expect(afterFourth?.deadLetteredAt?.getTime()).toBe(stampAfterThird);
    }));

  it("verliert bei zwei gleichzeitigen Aufrufen auf derselben Zeile keinen Zaehler-Schritt", () =>
    withOrganization(async (organizationId) => {
      const id = await insertOutboxEvent(organizationId);
      const now = new Date();

      await Promise.all([
        recordOutboxFailure({
          database: connection.database,
          consumer: "publish",
          eventId: id,
          error: new Error("gleichzeitiger Fehlversuch A"),
          now,
          maxAttempts: OUTBOX_MAX_ATTEMPTS,
          logger: silentLogger,
        }),
        recordOutboxFailure({
          database: connection.database,
          consumer: "publish",
          eventId: id,
          error: new Error("gleichzeitiger Fehlversuch B"),
          now,
          maxAttempts: OUTBOX_MAX_ATTEMPTS,
          logger: silentLogger,
        }),
      ]);

      const [row] = await connection.database
        .select({ attempts: outboxEvents.publishAttempts })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, id));
      expect(row?.attempts).toBe(2);
    }));
});
