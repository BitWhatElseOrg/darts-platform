import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { organizations, outboxEvents } from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import { OutboxHealthService } from "./outbox-health.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const database = databaseService.database;
const service = new OutboxHealthService(databaseService);
const organizationId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Outbox Health",
    slug: `outbox-health-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.onApplicationShutdown();
});

describe("OutboxHealthService", () => {
  it("misst das Alter des aeltesten offenen Ereignisses je Konsument", async () => {
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Match",
      aggregateId: randomUUID(),
      eventType: "MATCH_COMPLETED",
      payload: {},
      occurredAt: new Date(Date.now() - 3_600_000),
    });

    const health = await service.read();

    expect(health.publishLagSeconds).not.toBeNull();
    expect(health.publishLagSeconds ?? 0).toBeGreaterThanOrEqual(3_600);
    expect(health.statisticsLagSeconds ?? 0).toBeGreaterThanOrEqual(3_600);
  });

  it("zaehlt Dead Letter und laesst sie nicht als Rueckstand gelten", async () => {
    const before = await service.read();
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Match",
      aggregateId: randomUUID(),
      eventType: "MATCH_COMPLETED",
      payload: {},
      occurredAt: new Date("2020-01-01T00:00:00.000Z"),
      publishDeadLetteredAt: new Date(),
      statisticsDeadLetteredAt: new Date(),
      publishAttempts: 5,
      statisticsAttempts: 5,
    });

    const after = await service.read();

    expect(after.deadLettered).toBe(before.deadLettered + 1);
    // Die Dead-Letter-Zeile ist aelter als alles andere; tauchte sie im
    // Rueckstand auf, waere der Wert jetzt jenseits von 2020.
    expect(after.publishLagSeconds).toBe(before.publishLagSeconds);
  });

  it("ignoriert Ereignistypen, die der Statistik-Konsument nie verarbeitet", async () => {
    const before = await service.read();
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Encounter",
      aggregateId: randomUUID(),
      eventType: "ENCOUNTER_STARTED",
      payload: {},
      occurredAt: new Date("2019-01-01T00:00:00.000Z"),
      statisticsProcessedAt: null,
      publishedAt: new Date(),
    });

    const after = await service.read();

    expect(after.statisticsLagSeconds).toBe(before.statisticsLagSeconds);
  });
});
