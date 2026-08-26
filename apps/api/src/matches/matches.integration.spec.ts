import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { boards, memberships, organizations, outboxEvents, players, users, visits } from "@darts-platform/database";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { MatchesRepository } from "./matches.repository.js";
import { MatchesService } from "./matches.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const repository = new MatchesRepository(databaseService);
const service = new MatchesService(repository, access);
const organizationId = randomUUID();
const userId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();
const boardId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `match-${userId}@example.test`, name: "Match Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database.insert(organizations).values({ id: organizationId, name: "Match Integration Club", slug: `match-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(players).values([
    { id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" },
    { id: playerTwoId, organizationId, displayName: "Player Two", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(boards).values({ id: boardId, organizationId, name: "Board 1" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("persistent X01 match", () => {
  it("is idempotent, rejects stale versions, supports undo and completes 501", async () => {
    let state = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId, bestOfLegs: 1, bestOfSets: 1 }, auth, audit });
    const firstCommandId = randomUUID();
    state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: firstCommandId, expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3 }, auth, audit });
    expect(state.version).toBe(1);
    const duplicate = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: firstCommandId, expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3 }, auth, audit });
    expect(duplicate.version).toBe(1);
    expect(duplicate.visits.filter((visit) => !visit.reverted)).toHaveLength(1);

    await expect(service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 0, playerId: playerTwoId, points: 60, dartsThrown: 3 }, auth, audit })).rejects.toMatchObject({
      status: 409,
      response: { code: "MATCH_VERSION_CONFLICT", details: { currentState: { version: 1 } } },
    });
    state = await service.undo({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 1 }, auth, audit });
    expect(state.participants[0].remaining).toBe(501);
    expect(state.currentPlayerId).toBe(playerOneId);

    const score = async (playerId: string, points: number, checkoutDouble?: number) => {
      state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3, ...(checkoutDouble === undefined ? {} : { checkoutDouble }) }, auth, audit });
    };
    await score(playerOneId, 180);
    await score(playerTwoId, 60);
    await score(playerOneId, 180);
    await score(playerTwoId, 60);
    await score(playerOneId, 141, 12);
    expect(state.status).toBe("COMPLETED");
    expect(state.winnerPlayerId).toBe(playerOneId);
    expect(state.participants[0].remaining).toBe(0);

    const [board] = await databaseService.database.select().from(boards).where(and(eq(boards.organizationId, organizationId), eq(boards.id, boardId)));
    expect(board?.status).toBe("AVAILABLE");
    const persistedVisits = await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)));
    expect(persistedVisits).toHaveLength(6);
    const events = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId, organizationId), eq(outboxEvents.aggregateId, state.id)));
    expect(events.some((event) => event.eventType === "MATCH_COMPLETED")).toBe(true);
  });
});
