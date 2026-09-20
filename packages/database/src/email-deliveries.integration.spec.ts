import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import {
  emailDeliveryPending,
  enqueueEmailDelivery,
  markEmailDeliverySent,
  recordEmailDeliveryFailure,
} from "./email-deliveries.js";
import { OUTBOX_MAX_ATTEMPTS } from "./outbox.js";
import { emailDeliveries, organizations } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL fehlt fuer den Integrationstest.");
const connection = createDatabaseConnection(databaseUrl);
const database = connection.database;
const organizationId = randomUUID();
const now = new Date("2026-09-20T12:00:00.000Z");
const logger = { emit: vi.fn() };

const payload = {
  organizationName: "Beispielverein",
  inviterName: "Alex",
  role: "MEMBER",
  invitationUrl: "https://dartbase.example/einladung/x#code=y",
  expiresAt: "2026-09-22T12:00:00.000Z",
};

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Mail Club",
    slug: `mail-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

async function readRow(id: string) {
  const [row] = await database.select().from(emailDeliveries).where(eq(emailDeliveries.id, id));
  if (row === undefined) throw new Error("Zeile fehlt");
  return row;
}

describe("email_deliveries", () => {
  it("legt einen offenen Auftrag mit Payload an, der im Pending-Praedikat erscheint", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    const [pending] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(pending?.id).toBe(id);
    const row = await readRow(id);
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.payload).toEqual(payload);
  });

  it("weist eine unbekannte Auftragsart per Check-Constraint ab", async () => {
    try {
      await database.insert(emailDeliveries).values({
        kind: "NEWSLETTER",
        recipient: "gast@example.test",
        organizationId,
        payload: {},
      });
    } catch (error) {
      // Drizzle/postgres-js legen die Postgres-Fehlermeldung in `error.cause`
      // ab; die aeussere Meldung nennt nur die fehlgeschlagene Abfrage.
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("email_deliveries_kind_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });

  it("weist einen offenen Auftrag ohne Payload ab", async () => {
    try {
      await database.insert(emailDeliveries).values({
        kind: "INVITATION",
        recipient: "gast@example.test",
        organizationId,
        payload: null,
      });
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("email_deliveries_open_has_payload_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });

  it("bucht den Erfolg und leert den Payload", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    const marked = await markEmailDeliverySent(database, { id, providerMessageId: "msg_1", now });
    expect(marked).toBe(true);
    const row = await readRow(id);
    expect(row.sentAt?.toISOString()).toBe(now.toISOString());
    expect(row.providerMessageId).toBe("msg_1");
    expect(row.payload).toBeNull();
    // Zweite Buchung trifft nichts mehr.
    expect(await markEmailDeliverySent(database, { id, providerMessageId: "msg_2", now })).toBe(false);
    const [stillPending] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(stillPending).toBeUndefined();
  });

  it("bucht einen wiederholbaren Fehler mit Backoff und behaelt den Payload", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "503 service_unavailable",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: false,
      logger,
    });
    expect(outcome).toBe("retry");
    const row = await readRow(id);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("503 service_unavailable");
    expect(row.notBefore?.getTime()).toBe(now.getTime() + 1_000);
    expect(row.payload).toEqual(payload);
    // Waehrend des Backoffs nicht pending, danach wieder.
    const [blocked] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(blocked).toBeUndefined();
    const [later] = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(new Date(now.getTime() + 2_000))));
    expect(later?.id).toBe(id);
  });

  it("legt nach der Hoechstzahl Versuche ins Dead-Letter und leert den Payload", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    await database.update(emailDeliveries).set({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }).where(eq(emailDeliveries.id, id));
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "500 application_error",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: false,
      logger,
    });
    expect(outcome).toBe("dead_letter");
    const row = await readRow(id);
    expect(row.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(row.deadLetteredAt?.toISOString()).toBe(now.toISOString());
    expect(row.notBefore).toBeNull();
    expect(row.payload).toBeNull();
    expect(logger.emit).toHaveBeenCalledWith("error", expect.objectContaining({ event: "email.dead_letter", deliveryId: id }));
  });

  it("legt einen endgueltig abgelehnten Auftrag sofort ins Dead-Letter", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "PASSWORD_RESET",
      recipient: "gast@example.test",
      payload: { recipientName: "A", resetUrl: "https://api.example/r" },
    });
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "422 validation_error: Invalid `to` field",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: true,
      logger,
    });
    expect(outcome).toBe("dead_letter");
    const row = await readRow(id);
    expect(row.attempts).toBe(1);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.payload).toBeNull();
    expect(row.organizationId).toBeNull();
  });

  it("meldet already_processed fuer eine bereits versendete Zeile", async () => {
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId,
      payload,
    });
    await markEmailDeliverySent(database, { id, providerMessageId: "msg", now });
    const outcome = await recordEmailDeliveryFailure({
      executor: database,
      id,
      reason: "spaet",
      now,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      permanent: false,
      logger,
    });
    expect(outcome).toBe("already_processed");
  });

  it("loescht Auftraege mit der Organisation", async () => {
    const orphanOrganizationId = randomUUID();
    await database.insert(organizations).values({
      id: orphanOrganizationId,
      name: "Weg",
      slug: `weg-${orphanOrganizationId}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });
    const { id } = await enqueueEmailDelivery(database, {
      kind: "INVITATION",
      recipient: "gast@example.test",
      organizationId: orphanOrganizationId,
      payload,
    });
    await database.delete(organizations).where(eq(organizations.id, orphanOrganizationId));
    const rows = await database.select({ id: emailDeliveries.id }).from(emailDeliveries).where(eq(emailDeliveries.id, id));
    expect(rows).toEqual([]);
  });

  it("zaehlt nur offene Zeilen ohne Backoff als pending", async () => {
    const rows = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(emailDeliveryPending(now), isNull(emailDeliveries.sentAt)));
    for (const row of rows) {
      const full = await readRow(row.id);
      expect(full.deadLetteredAt).toBeNull();
      expect(full.notBefore === null || full.notBefore <= now).toBe(true);
    }
  });
});
