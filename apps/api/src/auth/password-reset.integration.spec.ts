import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { emailDeliveries, users, verifications } from "@darts-platform/database";
import { passwordResetEmailPayloadSchema } from "@darts-platform/schemas";

import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const userId = randomUUID();
const email = `reset-${userId}@example.test`;
const redirectTo = `${environment.WEB_ORIGIN}/passwort/neu`;
let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createApiTestApplication();
  await databaseService.database
    .insert(users)
    .values({ id: userId, email, displayName: "Reset Person" });
}, 60_000);

afterAll(async () => {
  // Weder `email_deliveries` noch das Reset-Token in `verifications` haengen
  // per Fremdschluessel am Konto: ohne eigenes Aufraeumen bleiben beide nach
  // dem Loeschen der Testperson in der Datenbank stehen.
  await databaseService.database
    .delete(emailDeliveries)
    .where(eq(emailDeliveries.recipient, email));
  await databaseService.database
    .delete(verifications)
    .where(eq(verifications.value, userId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
  await app.close();
});

async function resetDeliveriesFor(recipient: string) {
  return databaseService.database
    .select()
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.recipient, recipient),
        eq(emailDeliveries.kind, "PASSWORD_RESET"),
      ),
    );
}

describe("Passwort-Reset", () => {
  it("legt fuer ein bekanntes Konto eine PASSWORD_RESET-Zeile mit der Better-Auth-URL an", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: { email, redirectTo },
      headers: { origin: environment.WEB_ORIGIN },
    });
    expect(response.statusCode).toBe(200);

    // Better Auth ruft den Hook ueber `runInBackgroundOrAwait`; kurz pollen.
    await expect
      .poll(async () => (await resetDeliveriesFor(email)).length, { timeout: 5_000 })
      .toBe(1);
    const [row] = await resetDeliveriesFor(email);
    expect(row?.organizationId).toBeNull();
    expect(row?.invitationId).toBeNull();
    const payload = passwordResetEmailPayloadSchema.parse(row?.payload);
    expect(payload.recipientName).toBe("Reset Person");
    expect(payload.resetUrl).toContain("/api/v1/auth/reset-password/");
    expect(payload.resetUrl).toContain(`callbackURL=${encodeURIComponent(redirectTo)}`);
  });

  it("antwortet fuer eine unbekannte Adresse gleich, legt aber keine Zeile an", async () => {
    const unknown = `nobody-${randomUUID()}@example.test`;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: { email: unknown, redirectTo },
      headers: { origin: environment.WEB_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await resetDeliveriesFor(unknown)).toEqual([]);
  });

  it("lehnt einen redirectTo ausserhalb der vertrauten Urspruenge ab", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/request-password-reset",
      payload: { email, redirectTo: "https://boese.example/phish" },
      headers: { origin: environment.WEB_ORIGIN },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
