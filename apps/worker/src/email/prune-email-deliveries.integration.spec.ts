import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, emailDeliveries, organizations } from "@darts-platform/database";

import { EMAIL_DELIVERY_RETENTION_DAYS, pruneEmailDeliveries } from "./prune-email-deliveries.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const organizationId = randomUUID();
const now = new Date("2026-09-20T12:00:00.000Z");
const old = new Date(now.getTime() - (EMAIL_DELIVERY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
const recent = new Date(now.getTime() - 60 * 1000);

beforeAll(async () => {
  await connection.database.insert(organizations).values({
    id: organizationId,
    name: "Prune Mail",
    slug: `prune-mail-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await connection.database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("pruneEmailDeliveries", () => {
  it("entfernt nur alte versendete oder dead-geletterte Zeilen", async () => {
    const base = { kind: "INVITATION", recipient: "x@example.test", organizationId, createdAt: old };
    const rows = await connection.database
      .insert(emailDeliveries)
      .values([
        // 0: alt, versendet -> weg
        { ...base, payload: null, sentAt: old },
        // 1: alt, dead-gelettet -> weg
        { ...base, payload: null, deadLetteredAt: old, attempts: 8 },
        // 2: alt, aber offen -> bleibt
        { ...base, payload: {} },
        // 3: frisch versendet -> bleibt
        { ...base, payload: null, sentAt: recent, createdAt: recent },
      ])
      .returning({ id: emailDeliveries.id });
    const ids = rows.map((row) => row.id);

    const removed = await pruneEmailDeliveries(connection.database, now);

    expect(removed).toBeGreaterThanOrEqual(2);
    const remaining = await connection.database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(inArray(emailDeliveries.id, ids));
    expect(new Set(remaining.map((row) => row.id))).toEqual(new Set([ids[2], ids[3]]));
  }, 30_000);

  it("begrenzt einen Lauf auf die Batchgroesse", async () => {
    const rows = await connection.database
      .insert(emailDeliveries)
      .values(
        Array.from({ length: 5 }, () => ({
          kind: "INVITATION",
          recipient: "x@example.test",
          organizationId,
          payload: null,
          sentAt: old,
          createdAt: old,
        })),
      )
      .returning({ id: emailDeliveries.id });
    const ids = rows.map((row) => row.id);
    const removed = await pruneEmailDeliveries(
      connection.database,
      now,
      EMAIL_DELIVERY_RETENTION_DAYS,
      2,
    );
    expect(removed).toBeLessThanOrEqual(2);
    await connection.database.delete(emailDeliveries).where(inArray(emailDeliveries.id, ids));
  }, 30_000);
});
