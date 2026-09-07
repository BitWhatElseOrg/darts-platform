import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, users } from "@darts-platform/database";
import { apiErrorSchema } from "@darts-platform/schemas";

import { AuthService } from "../auth/auth.service.js";
import { BoardsService } from "../boards/boards.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

/**
 * Ruling E1: statt eines eigenen Testmoduls (Brief) laeuft dieser Test gegen
 * die echte, per `createApiTestApplication` gebaute Anwendung — dieselbe
 * Pipeline wie in Produktion (CORS -> Helmet -> Rate-Limit ->
 * `ApiExceptionFilter` -> Logging-Interceptor). Authentifiziert wird ueber
 * denselben Seam wie im letzten Test von `memberships.integration.spec.ts`:
 * `AuthService.getSession` wird je Test per Spy auf eine Session gestellt.
 * Als real existierende Endpunkte dienen `GET/POST
 * organizations/:organizationId/boards` (Guard + `OrganizationAccessService`
 * + `BOARD_NAME_TAKEN`-Konflikt) und der oeffentliche `GET health`.
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);

const organizationId = randomUUID();
const ownerUserId = randomUUID();
const outsiderUserId = randomUUID();

function authFor(userId: string, name: string): AuthContext {
  return {
    user: { id: userId, email: `${name}-${userId}@example.test`, name },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

// OWNER: traegt alle Berechtigungen (packages/domain/src/permissions.ts),
// damit die Anfrage an der echten Rollenpruefung durchkommt.
const ownerAuth = authFor(ownerUserId, "owner");
// Keine Mitgliedschaft in `organizationId` -> `OrganizationAccessService`
// weist real ab, nicht nur simuliert.
const outsiderAuth = authFor(outsiderUserId, "outsider");

let app: NestFastifyApplication;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: ownerUserId, email: ownerAuth.user.email, displayName: "Besitzerin" },
    { id: outsiderUserId, email: outsiderAuth.user.email, displayName: "Aussenstehend" },
  ]);
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "HTTP-Grenze Club",
    slug: `http-boundary-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId: ownerUserId,
    role: "OWNER",
    status: "ACTIVE",
  });

  // Grosszuegige Grenzen: die Handvoll Anfragen dieser Datei duerfen nicht an
  // einem Rate-Limit scheitern, das mit einer anderen Frage nichts zu tun hat.
  app = await createApiTestApplication({
    RATE_LIMIT_MAX_PER_MINUTE: 1000,
    RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: 1000,
    RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 1000,
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(inArray(users.id, [ownerUserId, outsiderUserId]));
  await databaseService.onApplicationShutdown();
});

describe("HTTP-Grenze: AuthGuard und ApiExceptionFilter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("weist eine Anfrage ohne Session mit 401 im einheitlichen Format ab", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/boards`,
    });

    expect(response.statusCode).toBe(401);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe("AUTHENTICATION_REQUIRED");
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(response.headers["x-correlation-id"]).toBe(parsed.error.correlationId);
  }, 30_000);

  it("weist eine Session ohne Mitgliedschaft mit 403 ab", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(outsiderAuth);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/boards`,
    });

    expect(response.statusCode).toBe(403);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe("PERMISSION_DENIED");
  }, 30_000);

  it("laesst eine Mitgliedschaft mit der Berechtigung durch", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/boards`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  }, 30_000);

  it("laesst einen @Public()-Endpunkt ohne Session durch", async () => {
    const getSession = vi.spyOn(app.get(AuthService), "getSession");

    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(getSession).not.toHaveBeenCalled();
  }, 30_000);

  /**
   * Der Unbekannt-Zweig des Filters: kein Produktionsendpunkt wirft heute
   * einen rohen `Error`, aber jeder Programmierfehler kaeme genau hier heraus.
   * Geprueft wird, dass davon nichts nach aussen dringt — kein Stacktrace,
   * keine Fehlermeldung des Originals, nur der einheitliche Koerper mit
   * `INTERNAL_ERROR` und einer Correlation-Id, ueber die sich der Vorfall im
   * Log wiederfinden laesst.
   */
  it("maskiert einen unbekannten Fehler als 500 INTERNAL_ERROR", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
    // Die Fehlermeldung traegt einen erkennbaren Marker: taeuchte sie in der
    // Antwort auf, waere die Maskierung wirkungslos.
    vi.spyOn(app.get(BoardsService), "list").mockRejectedValue(
      new Error("interner Zustand: geheime-tabelle.spalte fehlt"),
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/boards`,
    });

    expect(response.statusCode).toBe(500);
    const parsed = apiErrorSchema.parse(response.json());
    expect(parsed.error.code).toBe("INTERNAL_ERROR");
    expect(parsed.error.message).toBe("An internal server error occurred.");
    expect(parsed.error.correlationId.length).toBeGreaterThan(0);
    expect(response.headers["x-correlation-id"]).toBe(parsed.error.correlationId);

    const body = response.body;
    expect(body).not.toContain("geheime-tabelle");
    expect(body).not.toContain("at ");
    expect(body).not.toContain("stack");
  }, 30_000);

  /**
   * Ein rohes Objekt statt eines `Error` — so wirft zum Beispiel eine
   * Bibliothek, die mit `Promise.reject({ ... })` arbeitet. Auch das darf
   * nichts durchreichen.
   */
  it("maskiert auch einen geworfenen Nicht-Error", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
    vi.spyOn(app.get(BoardsService), "list").mockRejectedValue({
      internal: "geheime-tabelle",
      hint: "nicht nach aussen",
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/boards`,
    });

    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("INTERNAL_ERROR");
    expect(response.body).not.toContain("geheime-tabelle");
  }, 30_000);

  it("gibt den Fehlercode einer Domain-Exception unveraendert weiter", async () => {
    vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
    const boardName = `Boundary-${randomUUID()}`;

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/boards`,
      payload: { name: boardName },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/boards`,
      payload: { name: boardName },
    });

    expect(second.statusCode).toBe(409);
    const parsed = apiErrorSchema.parse(second.json());
    expect(parsed.error.code).toBe("BOARD_NAME_TAKEN");
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(second.body).not.toMatch(/stack/i);
    expect(second.body).not.toMatch(/trace/i);
  }, 30_000);
});
