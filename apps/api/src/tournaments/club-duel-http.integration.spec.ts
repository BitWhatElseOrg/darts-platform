import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { boards, memberships, organizations, players, tournaments, users } from "@darts-platform/database";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

/**
 * HTTP-Pfad des Vereinsduells: Controller, Zod-Validierung (inklusive
 * Refines der diskriminierten Union) und Fehlerformat, wie der Client sie sieht.
 */
const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const organizationId = randomUUID();
const userId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `club-duel-http-${userId}@example.test`, name: "Club Duel HTTP" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const memberIds = [randomUUID(), randomUUID()] as const;
const guestIds = [randomUUID(), randomUUID()] as const;
const boardId = randomUUID();

let app: NestFastifyApplication;

function clubDuelBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Vereinsduell HTTP ${randomUUID()}`,
    startsAt: "2026-10-10T18:00:00.000Z",
    format: "CLUB_DUEL",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    bestOfSets: 1,
    boardIds: [boardId],
    sideAName: "VFC",
    sideBName: "DC Musterdorf",
    qualifyingRounds: 1,
    finalRoundSize: 2,
    thirdPlaceMatch: true,
    participants: [
      ...memberIds.map((playerId) => ({ playerId, side: "A" })),
      ...guestIds.map((playerId) => ({ playerId, side: "B" })),
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  const database = databaseService.database;
  await database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await database.insert(organizations).values({ id: organizationId, name: "Club Duel HTTP", slug: `club-duel-http-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await database.insert(players).values([
    ...memberIds.map((id, index) => ({ id, organizationId, displayName: `Mitglied HTTP ${index + 1}`, status: "ACTIVE" })),
    ...guestIds.map((id, index) => ({ id, organizationId, displayName: `Gast HTTP ${index + 1}`, status: "ACTIVE", kind: "GUEST", guestClubName: "DC Musterdorf" })),
  ]);
  await database.insert(boards).values({ id: boardId, organizationId, name: "HTTP Board" });
  app = await createApiTestApplication({ RATE_LIMIT_MAX_PER_MINUTE: 100_000, RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000 });
}, 60_000);

beforeEach(() => {
  vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(auth);
});

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("POST /api/v1/organizations/:org/tournaments (CLUB_DUEL)", () => {
  it("legt ein Vereinsduell an und antwortet 201 mit format CLUB_DUEL", async () => {
    const body = clubDuelBody();
    const response = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/tournaments`, payload: body });
    expect(response.statusCode).toBe(201);
    const summary = response.json<{ id: string; format: string; status: string; name: string }>();
    expect(summary).toMatchObject({ format: "CLUB_DUEL", status: "GROUP_STAGE", name: body.name });
    const [row] = await databaseService.database.select().from(tournaments).where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, summary.id)));
    expect(row).toMatchObject({ format: "CLUB_DUEL", sideAName: "VFC", sideBName: "DC Musterdorf", finalRoundSize: 2 });
  }, 30_000);

  it("lehnt eine Seite kleiner als die Finalrunde mit 400 ab und legt nichts an", async () => {
    const body = clubDuelBody({
      participants: [
        ...memberIds.map((playerId) => ({ playerId, side: "A" })),
        { playerId: guestIds[0], side: "B" },
      ],
    });
    const response = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/tournaments`, payload: body });
    expect(response.statusCode).toBe(400);
    const error = response.json<{ error: { code: string; message: string } }>().error;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("participants");
    expect(await databaseService.database.select().from(tournaments).where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.name, String(body.name))))).toHaveLength(0);
  });
});

describe("GET /api/v1/organizations/:org/players?kind=", () => {
  const url = `/api/v1/organizations/${organizationId}/players`;
  const namesOf = (payload: readonly { displayName: string }[]) => payload.map((player) => player.displayName).sort();

  it("lehnt einen unbekannten kind-Wert mit 400 INVALID_QUERY ab", async () => {
    const response = await app.inject({ method: "GET", url: `${url}?kind=BOGUS` });
    expect(response.statusCode).toBe(400);
    const error = response.json<{ error: { code: string; message: string } }>().error;
    expect(error.code).toBe("INVALID_QUERY");
    expect(error.message).toContain("kind");
  });

  it("liefert ohne kind nur Mitglieder, mit GUEST nur Gaeste und mit ALL beide", async () => {
    const standard = await app.inject({ method: "GET", url });
    expect(standard.statusCode).toBe(200);
    expect(namesOf(standard.json())).toEqual(["Mitglied HTTP 1", "Mitglied HTTP 2"]);

    const guests = await app.inject({ method: "GET", url: `${url}?kind=GUEST` });
    expect(guests.statusCode).toBe(200);
    const guestPayload = guests.json<{ displayName: string; kind: string }[]>();
    expect(namesOf(guestPayload)).toEqual(["Gast HTTP 1", "Gast HTTP 2"]);
    expect(guestPayload.every((player) => player.kind === "GUEST")).toBe(true);

    const all = await app.inject({ method: "GET", url: `${url}?kind=ALL` });
    expect(all.statusCode).toBe(200);
    expect(namesOf(all.json())).toEqual(["Gast HTTP 1", "Gast HTTP 2", "Mitglied HTTP 1", "Mitglied HTTP 2"]);
  });
});
