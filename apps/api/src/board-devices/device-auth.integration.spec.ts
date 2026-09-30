import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  boardDevices,
  boards,
  memberships,
  organizations,
  players,
  users,
} from "@darts-platform/database";
import { createBoardDeviceSecret, hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);

const organizationId = randomUUID();
const ownerId = randomUUID();
const boardId = randomUUID();
const otherBoardId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();

const ownerAuth: AuthContext = {
  user: { id: ownerId, email: `board-device-owner-${ownerId}@example.test`, name: "Board Device Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

let app: NestFastifyApplication;
let deviceId: string;
let bearer: { readonly authorization: string };

/** Legt ein Match ueber die echte Route an, damit die Fixture einer echten Spielanlage entspricht. */
async function createMatchOnBoard(targetBoardId: string): Promise<string> {
  vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAuth);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/organizations/${organizationId}/matches`,
    payload: { playerOneId, playerTwoId, boardId: targetBoardId, bestOfLegs: 1, bestOfSets: 1 },
  });
  vi.restoreAllMocks();
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: ownerId,
    email: ownerAuth.user.email,
    displayName: ownerAuth.user.name,
  });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Board Device Club",
    slug: `board-device-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId: ownerId,
    role: "OWNER",
    status: "ACTIVE",
  });
  await databaseService.database.insert(boards).values([
    { id: boardId, organizationId, name: "Scheibe 1" },
    { id: otherBoardId, organizationId, name: "Scheibe 2" },
  ]);
  await databaseService.database.insert(players).values([
    { id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" },
    { id: playerTwoId, organizationId, displayName: "Player Two", status: "ACTIVE" },
  ]);

  app = await createApiTestApplication();

  const secret = createBoardDeviceSecret();
  const [device] = await databaseService.database
    .insert(boardDevices)
    .values({
      organizationId,
      boardId,
      secretHash: hashBoardDeviceSecret(secret),
      label: "iPad Test",
      createdBy: ownerId,
    })
    .returning();
  if (device === undefined) throw new Error("Das Testgeraet wurde nicht angelegt.");
  deviceId = device.id;
  bearer = { authorization: `Bearer ${secret}` };
}, 60_000);

afterAll(async () => {
  await app.close();
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, ownerId));
  await databaseService.onApplicationShutdown();
});

describe("GET /api/v1/board-devices/me", () => {
  it("liefert Gerät, Scheibe und Organisation ohne laufendes Match", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      device: { id: deviceId, label: "iPad Test" },
      board: { id: boardId, name: "Scheibe 1" },
      organization: { id: organizationId, name: "Board Device Club" },
      currentMatchId: null,
    });
  });

  it("nennt das laufende Match der eigenen Scheibe, nicht das einer anderen", async () => {
    await createMatchOnBoard(otherBoardId);
    const matchOnOwnBoardId = await createMatchOnBoard(boardId);

    const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentMatchId).toBe(matchOnOwnBoardId);
  });

  it("aktualisiert last_seen_at", async () => {
    await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });

    const [row] = await databaseService.database.select().from(boardDevices).where(eq(boardDevices.id, deviceId));

    expect(row?.lastSeenAt).not.toBeNull();
  });

  it("lehnt einen unbekannten Schlüssel mit DEVICE_REVOKED ab", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/board-devices/me",
      headers: { authorization: "Bearer bd_unbekannt" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("DEVICE_REVOKED");
  });

  it("lehnt ein Gerät auf einer nicht freigegebenen Route ab", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/players`,
      headers: bearer,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_NOT_ALLOWED");
  });

  it("lehnt /board-devices/me ohne Schlüssel und ohne Session ab", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me" });

    expect(response.statusCode).toBe(401);
  });

  it("lässt den Authorization-Header per CORS zu", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/board-devices/me",
      headers: {
        origin: environment.WEB_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
    expect(response.headers["access-control-max-age"]).toBe("600");
  });

  it("lehnt einen widerrufenen Schlüssel sofort ab", async () => {
    await databaseService.database.update(boardDevices).set({ revokedAt: new Date() }).where(eq(boardDevices.id, deviceId));

    const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("DEVICE_REVOKED");
  });
});
