import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { boardDevices, boards, organizations, users } from "@darts-platform/database";
import { createBoardDeviceSecret, hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";

import { BoardDeviceAuthenticator } from "../auth/board-device-authenticator.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);

const organizationId = randomUUID();
const ownerId = randomUUID();
const boardId = randomUUID();

let app: NestFastifyApplication;
let bearer: { readonly authorization: string };

/**
 * Eigene Anwendung mit eng gesetzten Grenzen (Task 7, Brief): die allgemeine
 * und die oeffentliche Stufe laufen ueber IP (5/Minute), die Geraete-Stufe
 * eigens ueber das Geraet (8/Minute), die sensible Stufe bleibt bei 2/Minute
 * auch fuer ein gueltiges Geraet.
 */
beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: ownerId,
    email: `rate-limit-device-owner-${ownerId}@example.test`,
    displayName: "Rate Limit Device Owner",
  });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Rate Limit Device Club",
    slug: `rate-limit-device-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(boards).values({ id: boardId, organizationId, name: "Scheibe 1" });

  app = await createApiTestApplication({
    RATE_LIMIT_MAX_PER_MINUTE: 5,
    RATE_LIMIT_DEVICE_MAX_PER_MINUTE: 8,
    RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 2,
  });

  const secret = createBoardDeviceSecret();
  await databaseService.database.insert(boardDevices).values({
    organizationId,
    boardId,
    secretHash: hashBoardDeviceSecret(secret),
    label: "iPad Rate Limit Test",
    createdBy: ownerId,
  });
  bearer = { authorization: `Bearer ${secret}` };
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, ownerId));
  await databaseService.onApplicationShutdown();
});

describe("Rate-Limit-Stufe fuer Scheiben-Tablets", () => {
  it("zählt ein gültiges Gerät pro Gerät, nicht gegen die Grenze der IP", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      statuses.push(
        (await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer })).statusCode,
      );
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer })).statusCode,
    ).toBe(429);
  });

  it("zählt einen unbekannten Schlüssel gegen die Grenze der IP", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/board-devices/me",
            headers: { authorization: `Bearer bd_zufall${index}` },
            remoteAddress: "203.0.113.9",
          })
        ).statusCode,
      );
    }

    expect(statuses.at(-1)).toBe(429);
  });

  it("lässt die enge Grenze für Passwort-Reset auch mit gültigem Geräteschlüssel stehen", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      statuses.push(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/auth/request-password-reset",
            headers: { ...bearer, "content-type": "application/json" },
            payload: { email: "niemand@example.test" },
            remoteAddress: "203.0.113.20",
          })
        ).statusCode,
      );
    }

    expect(statuses.at(-1)).toBe(429);
  });

  it("faellt bei einer werfenden Geraete-Einordnung auf die IP-Adresse zurueck, statt mit 500 zu scheitern", async () => {
    const classifySpy = vi
      .spyOn(app.get(BoardDeviceAuthenticator), "classify")
      .mockRejectedValue(new Error("Datenbank nicht erreichbar"));

    try {
      const statuses: number[] = [];
      for (let index = 0; index < 6; index += 1) {
        statuses.push(
          (
            await app.inject({
              method: "GET",
              url: "/api/v1/board-devices/me",
              headers: bearer,
              remoteAddress: "203.0.113.42",
            })
          ).statusCode,
        );
      }

      // Faellt auf die allgemeine IP-Grenze (5) zurueck statt auf die
      // Geraete-Grenze (8) oder ein 500: kein einziger der sechs Versuche
      // wirft, und der sechste (ueber der IP-Grenze) wird abgelehnt.
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    } finally {
      classifySpy.mockRestore();
    }
  });
});
