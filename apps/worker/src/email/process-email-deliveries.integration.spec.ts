import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  emailDeliveries,
  emailDeliveryPending,
  enqueueEmailDelivery,
  markEmailDeliverySent,
  OUTBOX_MAX_ATTEMPTS,
  organizations,
} from "@darts-platform/database";
import type { EmailMessage, EmailSender, EmailSendResult } from "@darts-platform/notifications";

import { processEmailDeliveries } from "./process-email-deliveries.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
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

class FakeSender implements EmailSender {
  public readonly calls: { message: EmailMessage; key: string }[] = [];
  public constructor(
    private readonly result: (message: EmailMessage) => EmailSendResult | Promise<EmailSendResult>,
  ) {}
  public async send(message: EmailMessage, key: string): Promise<EmailSendResult> {
    this.calls.push({ message, key });
    return this.result(message);
  }
}

/**
 * Fester Zeitpunkt lange vor jeder echten Zeile: `pnpm test` laeuft api-,
 * web- und worker-Paket gleichzeitig gegen dieselbe Datenbank, und die
 * API-Tests legen dabei eigene Versandauftraege an. Der Poller nimmt je Lauf
 * nur die `limit` aeltesten faelligen Zeilen — ohne Rueckdatierung
 * entscheidet der Zufall, ob die eigene Zeile darin liegt, und der Stapel
 * frisst fremde Auftraege mit. Zurueckdatiert plus passendes `limit` gilt:
 * eine faellige eigene Zeile wird immer zuerst beansprucht.
 *
 * Deshalb hat jeder Poller-Lauf in dieser Datei eigene faellige,
 * zurueckdatierte Zeilen im Stapel und fasst nie fremde Auftraege an. Dass
 * eine nicht faellige Zeile im Backoff uebersprungen wird, belegt der Test
 * ohne Poller-Lauf: er prueft die Auswahlbedingung
 * (`emailDeliveryPending`) direkt gegen die eigene Zeile.
 */
const enqueuedAt = new Date("2020-01-01T00:00:00.000Z");

async function enqueue(
  recipient: string,
  overrides: Partial<Parameters<typeof enqueueEmailDelivery>[1]> = {},
) {
  const row = await enqueueEmailDelivery(database, {
    kind: "INVITATION",
    recipient,
    organizationId,
    payload,
    ...overrides,
  });
  await database
    .update(emailDeliveries)
    .set({ createdAt: enqueuedAt })
    .where(eq(emailDeliveries.id, row.id));
  return row;
}

async function readRow(id: string) {
  const [row] = await database.select().from(emailDeliveries).where(eq(emailDeliveries.id, id));
  if (row === undefined) throw new Error("Zeile fehlt");
  return row;
}

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Worker Mail Club",
    slug: `worker-mail-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("processEmailDeliveries", () => {
  it("rendert, versendet mit der Zeilen-ID als Idempotency-Key und bucht den Erfolg", async () => {
    const recipient = `ok-${randomUUID()}@example.test`;
    const { id } = await enqueue(recipient);
    const sender = new FakeSender(() => ({ kind: "sent", providerMessageId: "msg_1" }));

    const processed = await processEmailDeliveries({ database, sender, logger, now: () => now, limit: 1 });

    expect(processed).toBeGreaterThanOrEqual(1);
    const call = sender.calls.find((entry) => entry.key === id);
    expect(call?.message.to).toBe(recipient);
    expect(call?.message.subject).toBe("Einladung zu Beispielverein auf DartBase");
    const row = await readRow(id);
    expect(row.sentAt).not.toBeNull();
    expect(row.providerMessageId).toBe("msg_1");
    expect(row.payload).toBeNull();
  });

  it("bucht retryable mit Backoff, nimmt die Zeile aus der Auswahl und sendet erst danach", async () => {
    const { id } = await enqueue(`retry-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => ({ kind: "retryable", reason: "503 service_unavailable" }));

    await processEmailDeliveries({ database, sender, logger, now: () => now, limit: 1 });
    const first = await readRow(id);
    expect(first.attempts).toBe(1);
    expect(first.notBefore?.getTime()).toBe(now.getTime() + 1_000);
    expect(first.payload).toEqual(payload);

    // Kein Poller-Lauf: die eigene Zeile ist jetzt nicht faellig, ein Lauf
    // griffe deshalb die aelteste fremde faellige Zeile — in `pnpm test`
    // einen Auftrag der API-Tests. Geprueft wird stattdessen genau das,
    // woran der Poller seinen Stapel waehlt: die Zeile faellt aus
    // `emailDeliveryPending` heraus.
    const due = await database
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.id, id), emailDeliveryPending(now)));
    expect(due).toHaveLength(0);

    const second = new FakeSender(() => ({ kind: "sent", providerMessageId: "x" }));
    await processEmailDeliveries({
      database,
      sender: second,
      logger,
      now: () => new Date(now.getTime() + 2_000),
      limit: 1,
    });
    expect(second.calls.some((entry) => entry.key === id)).toBe(true);
  });

  it("legt rejected sofort ins Dead-Letter und leert den Payload", async () => {
    const { id } = await enqueue(`rejected-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => ({
      kind: "rejected",
      reason: "422 validation_error: Invalid `to` field",
    }));

    await processEmailDeliveries({ database, sender, logger, now: () => now, limit: 1 });
    const row = await readRow(id);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.payload).toBeNull();
    expect(row.lastError).toContain("422");
    expect(logger.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ event: "email.dead_letter", deliveryId: id }),
    );
  });

  it("legt nach der Hoechstzahl Versuche ins Dead-Letter", async () => {
    const { id } = await enqueue(`max-${randomUUID()}@example.test`);
    await database
      .update(emailDeliveries)
      .set({ attempts: OUTBOX_MAX_ATTEMPTS - 1 })
      .where(eq(emailDeliveries.id, id));
    const sender = new FakeSender(() => ({ kind: "retryable", reason: "500" }));
    await processEmailDeliveries({ database, sender, logger, now: () => now, limit: 1 });
    const row = await readRow(id);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.payload).toBeNull();
  });

  it("legt einen Payload, der nicht zum Schema passt, ins Dead-Letter ohne zu senden", async () => {
    const { id } = await enqueue(`bad-${randomUUID()}@example.test`, {
      payload: { organizationName: "nur das" },
    });
    const sender = new FakeSender(() => ({ kind: "sent", providerMessageId: "x" }));
    await processEmailDeliveries({ database, sender, logger, now: () => now, limit: 1 });
    expect(sender.calls.some((entry) => entry.key === id)).toBe(false);
    const row = await readRow(id);
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.lastError).toContain("invitationUrl");
  });

  it("behandelt einen werfenden Sender wie retryable", async () => {
    const { id } = await enqueue(`throw-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => {
      throw new Error("kaputt");
    });
    await processEmailDeliveries({ database, sender, logger, now: () => now, limit: 1 });
    const row = await readRow(id);
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("kaputt");
    expect(row.deadLetteredAt).toBeNull();
  });

  it("bucht einen Fehlversuch nach, wenn die Erfolgsbuchung scheitert", async () => {
    const { id } = await enqueue(`booking-${randomUUID()}@example.test`);
    const sender = new FakeSender(() => ({ kind: "sent", providerMessageId: "msg_2" }));

    await processEmailDeliveries({
      database,
      sender,
      logger,
      now: () => now,
      limit: 1,
      // Nur die eine Zeile scheitert.
      markSent: async (executor, input) => {
        if (input.id === id) throw new Error("Buchung kaputt");
        return markEmailDeliverySent(executor, input);
      },
    });

    expect(sender.calls.filter((entry) => entry.key === id)).toHaveLength(1);
    const row = await readRow(id);
    expect(row.sentAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.notBefore?.getTime()).toBe(now.getTime() + 1_000);
    expect(row.payload).toEqual(payload);
    expect(row.lastError).toBe("Buchung kaputt");
    expect(logger.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ event: "email.booking_failed", deliveryId: id }),
    );
  });

  it("verteilt einen Stapel auf zwei gleichzeitige Laeufe ohne Doppelversand", async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, (_, index) => enqueue(`par-${index}-${randomUUID()}@example.test`)),
    );
    const keys = new Set(ids.map((entry) => entry.id));
    const slow = new FakeSender(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { kind: "sent", providerMessageId: "p" };
    });
    await Promise.all([
      processEmailDeliveries({ database, sender: slow, logger, now: () => now, limit: 3 }),
      processEmailDeliveries({ database, sender: slow, logger, now: () => now, limit: 3 }),
    ]);
    const ownCalls = slow.calls.filter((entry) => keys.has(entry.key)).map((entry) => entry.key);
    expect(new Set(ownCalls).size).toBe(ownCalls.length);
    const rows = await database
      .select({ sentAt: emailDeliveries.sentAt })
      .from(emailDeliveries)
      .where(inArray(emailDeliveries.id, [...keys]));
    expect(rows.every((row) => row.sentAt !== null)).toBe(true);
  }, 20_000);
});
