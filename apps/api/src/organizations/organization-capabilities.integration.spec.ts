/**
 * Die Faehigkeiten-Route ist der einzige Weg, auf dem die Oberflaeche den
 * Betriebsschalter `ALLOW_SELF_SERVICE_ORGANIZATIONS` erfaehrt. Dass der
 * Dienst das Flag richtig abbildet, prueft `organizations.integration.spec`;
 * hier zaehlt die HTTP-Kante: Sitzung erforderlich, Antwort gemaess Schema,
 * Wert folgt der Umgebung. Bewusst eine eigene Datei — die Anwendung wird
 * je Flag-Stellung einmal gebaut, die Dienst-Spec kommt ohne Anwendung aus.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { organizationCapabilitiesSchema } from "@darts-platform/schemas";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const url = "/api/v1/organizations/capabilities";
const userId = randomUUID();
const auth: AuthContext = {
  user: {
    id: userId,
    email: `capabilities-${userId}@example.test`,
    name: "Faehigkeiten",
  },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

describe("Faehigkeiten-Route bei offener Selbstbedienung", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication({
      ALLOW_SELF_SERVICE_ORGANIZATIONS: true,
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("weist eine Anfrage ohne Sitzung ab", async () => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  }, 30_000);

  it("meldet der angemeldeten Person den offenen Weg", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(auth);

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(organizationCapabilitiesSchema.parse(response.json())).toEqual({
      selfServiceEnabled: true,
    });
  }, 30_000);
});

describe("Faehigkeiten-Route bei gesperrter Selbstbedienung", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication({
      ALLOW_SELF_SERVICE_ORGANIZATIONS: false,
    });
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("meldet der angemeldeten Person den gesperrten Weg", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(auth);

    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(200);
    expect(organizationCapabilitiesSchema.parse(response.json())).toEqual({
      selfServiceEnabled: false,
    });
  }, 30_000);
});
