import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { auditEvents, boardControllerLeases, boards, legs, matches, memberships, organizations, outboxEvents, players, scoreCommands, users, visits } from "@darts-platform/database";
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
const scorerUserId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `match-${userId}@example.test`, name: "Match Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;
const scorerAuth: AuthContext = {
  user: { id: scorerUserId, email: `scorer-${scorerUserId}@example.test`, name: "Match Scorer" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: scorerUserId, email: scorerAuth.user.email, displayName: scorerAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values({ id: organizationId, name: "Match Integration Club", slug: `match-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(memberships).values({ organizationId, userId: scorerUserId, role: "SCORER", status: "ACTIVE" });
  await databaseService.database.insert(players).values([
    { id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" },
    { id: playerTwoId, organizationId, displayName: "Player Two", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(boards).values({ id: boardId, organizationId, name: "Board 1" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, scorerUserId));
  await databaseService.onApplicationShutdown();
});

describe("persistent X01 match", () => {
  it("aborts an active scoring session transactionally and idempotently", async () => {
    let state = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId, bestOfLegs: 1, bestOfSets: 1 }, auth, audit });
    const controllerId = randomUUID();
    await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId, force: false, auth, audit });
    state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId, points: 100, dartsThrown: 3, controllerId }, auth, audit });

    await expect(service.abort({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, controllerId }, auth: scorerAuth, audit })).rejects.toMatchObject({ status: 403 });
    await expect(service.abort({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version - 1, controllerId }, auth, audit })).rejects.toMatchObject({ status: 409 });
    await expect(service.abort({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, controllerId: randomUUID() }, auth, audit })).rejects.toMatchObject({ status: 409 });

    const commandId = randomUUID();
    const input = { organizationId, matchId: state.id, data: { commandId, expectedVersion: state.version, controllerId, reason: "Board neu starten" }, auth, audit };
    await expect(service.abort(input)).resolves.toEqual({ matchId: state.id, status: "ABORTED", tournamentMatchId: null });
    await expect(service.abort(input)).resolves.toEqual({ matchId: state.id, status: "ABORTED", tournamentMatchId: null });

    expect(await service.list({ organizationId, auth })).not.toContainEqual(expect.objectContaining({ id: state.id }));
    expect(await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)))).toHaveLength(0);
    expect(await databaseService.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, state.id)))).toHaveLength(0);
    expect(await databaseService.database.select().from(boardControllerLeases).where(eq(boardControllerLeases.matchId, state.id))).toHaveLength(0);
    expect((await databaseService.database.select().from(matches).where(eq(matches.id, state.id)))[0]?.status).toBe("ABORTED");
    expect((await databaseService.database.select().from(boards).where(eq(boards.id, boardId)))[0]?.status).toBe("AVAILABLE");
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, commandId))).toHaveLength(1);
    expect((await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, state.id), eq(outboxEvents.eventType, "MATCH_ABORTED"))))).toHaveLength(1);
    expect((await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, state.id), eq(auditEvents.action, "MATCH_ABORTED"))))).toHaveLength(1);
  });

  it("is idempotent, rejects stale versions, supports undo and completes 501", async () => {
    let state = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId, bestOfLegs: 1, bestOfSets: 1 }, auth, audit });
    const firstControllerId = randomUUID();
    const controllerId = randomUUID();
    expect((await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId: firstControllerId, force: false, auth, audit })).owned).toBe(true);
    expect((await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId, force: false, auth, audit })).owned).toBe(false);
    expect((await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId, force: true, auth, audit })).owned).toBe(true);
    await expect(service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3, controllerId: firstControllerId }, auth, audit })).rejects.toMatchObject({
      status: 409,
      response: { code: "BOARD_CONTROLLER_CONFLICT", details: { currentState: { version: 0 } } },
    });
    const firstCommandId = randomUUID();
    state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: firstCommandId, expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3, controllerId }, auth, audit });
    expect(state.version).toBe(1);
    const duplicate = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: firstCommandId, expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3 }, auth, audit });
    expect(duplicate.version).toBe(1);
    expect(duplicate.visits.filter((visit) => !visit.reverted)).toHaveLength(1);

    await expect(service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 0, playerId: playerTwoId, points: 60, dartsThrown: 3 }, auth, audit })).rejects.toMatchObject({
      status: 409,
      response: { code: "MATCH_VERSION_CONFLICT", details: { currentState: { version: 1 } } },
    });
    state = await service.undo({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 1, controllerId }, auth, audit });
    expect(state.participants[0].remaining).toBe(501);
    expect(state.currentPlayerId).toBe(playerOneId);

    const score = async (playerId: string, points: number, checkoutDouble?: number) => {
      state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3, controllerId, ...(checkoutDouble === undefined ? {} : { checkoutDouble }) }, auth, audit });
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
