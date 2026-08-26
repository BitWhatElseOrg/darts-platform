import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  boards,
  memberships,
  organizations,
  outboxEvents,
  players,
  tournamentMatches,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { TournamentsRepository } from "./tournaments.repository.js";
import { TournamentsService } from "./tournaments.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const matchesRepository = new MatchesRepository(databaseService);
const matchesService = new MatchesService(matchesRepository, access);
const repository = new TournamentsRepository(databaseService);
const service = new TournamentsService(repository, matchesRepository, access);
const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const foreignUserId = randomUUID();
const playerIds = Array.from({ length: 4 }, () => randomUUID());
const boardIds = [randomUUID(), randomUUID()] as const;
const auth: AuthContext = {
  user: { id: userId, email: `tournament-${userId}@example.test`, name: "Tournament Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const foreignAuth: AuthContext = {
  user: { id: foreignUserId, email: `foreign-${foreignUserId}@example.test`, name: "Foreign Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: foreignUserId, email: foreignAuth.user.email, displayName: foreignAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Tournament Club", slug: `tournament-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Club", slug: `foreign-tournament-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId: foreignOrganizationId, userId: foreignUserId, role: "OWNER", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(players).values(
    playerIds.map((id, index) => ({
      id,
      organizationId,
      displayName: `Tournament Player ${index + 1}`,
      status: "ACTIVE",
    })),
  );
  await databaseService.database.insert(boards).values(
    boardIds.map((id, index) => ({ id, organizationId, name: `Tournament Board ${index + 1}` })),
  );
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, foreignUserId));
  await databaseService.onApplicationShutdown();
});

describe("persistent tournament MVP", () => {
  it("creates a tenant-safe plan, assigns idempotently and synchronizes a completed match", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: "Integration Championship",
        startsAt: new Date("2026-09-12T12:00:00.000Z"),
        format: "GROUPS_THEN_KNOCKOUT",
        startingScore: 301,
        doubleOut: true,
        bestOfLegs: 1,
        participantIds: playerIds,
        groupCount: 2,
        qualifyPerGroup: 1,
        knockoutSize: 2,
        seeding: "SEEDED",
        boardIds: [...boardIds],
      },
      auth,
      audit,
    });
    expect(created).toMatchObject({ participantCount: 4, boardCount: 2, totalMatches: 3 });
    await expect(
      service.list({ organizationId, auth: foreignAuth }),
    ).rejects.toMatchObject({ status: 403 });

    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.queue.filter((entry) => entry.readiness === "READY")).toHaveLength(2);
    const firstReady = dashboard.queue.find((entry) => entry.readiness === "READY");
    if (firstReady === undefined) throw new Error("Expected a ready tournament match.");
    const commandId = randomUUID();
    dashboard = await service.assign({
      organizationId,
      tournamentId: created.id,
      data: { commandId, expectedVersion: 0, matchId: firstReady.matchId, boardId: boardIds[0] },
      auth,
      audit,
    });
    expect(dashboard.tournament.version).toBe(1);
    expect(dashboard.boards[0]?.state).toBe("PLAYING");
    const duplicate = await service.assign({
      organizationId,
      tournamentId: created.id,
      data: { commandId, expectedVersion: 0, matchId: firstReady.matchId, boardId: boardIds[0] },
      auth,
      audit,
    });
    expect(duplicate.tournament.version).toBe(1);
    await expect(
      service.assign({
        organizationId,
        tournamentId: created.id,
        data: { commandId: randomUUID(), expectedVersion: 0, matchId: firstReady.matchId, boardId: boardIds[1] },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "TOURNAMENT_VERSION_CONFLICT", details: { currentState: { tournament: { version: 1 } } } },
    });

    const [scheduled] = await databaseService.database
      .select()
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.id, firstReady.matchId),
        ),
      );
    if (scheduled?.scoringMatchId === null || scheduled?.scoringMatchId === undefined) {
      throw new Error("Expected a linked scoring match.");
    }
    let match = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
    const [firstPlayer, secondPlayer] = match.participants;
    match = await matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, playerId: firstPlayer.playerId, points: 180, dartsThrown: 3 },
      auth,
      audit,
    });
    match = await matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, playerId: secondPlayer.playerId, points: 60, dartsThrown: 3 },
      auth,
      audit,
    });
    match = await matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, playerId: firstPlayer.playerId, points: 121, dartsThrown: 3, checkoutDouble: 20 },
      auth,
      audit,
    });
    expect(match.status).toBe("COMPLETED");
    dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.tournament.playedMatches).toBe(1);
    expect(dashboard.boards[0]?.state).toBe("FREE");
    expect(dashboard.groups.reduce((total, group) => total + group.playedMatches, 0)).toBe(1);
    expect(dashboard.recentResults[0]).toMatchObject({
      matchId: firstReady.matchId,
      winnerPlayerId: firstPlayer.playerId,
    });

    await expect(
      matchesService.undo({
        organizationId,
        matchId: match.id,
        data: { commandId: randomUUID(), expectedVersion: match.version },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: "TOURNAMENT_RESULT_REQUIRES_CORRECTION" },
    });

    const correctionCommandId = randomUUID();
    dashboard = await service.correctResult({
      organizationId,
      tournamentId: created.id,
      data: {
        commandId: correctionCommandId,
        expectedVersion: dashboard.tournament.version,
        matchId: firstReady.matchId,
        reason: "Der entscheidende Visit wurde falsch erfasst.",
      },
      auth,
      audit,
    });
    expect(dashboard.tournament.version).toBe(3);
    expect(dashboard.tournament.playedMatches).toBe(0);
    expect(dashboard.boards[0]?.state).toBe("PLAYING");
    expect(dashboard.recentResults).toHaveLength(0);
    const duplicateCorrection = await service.correctResult({
      organizationId,
      tournamentId: created.id,
      data: {
        commandId: correctionCommandId,
        expectedVersion: 2,
        matchId: firstReady.matchId,
        reason: "Der entscheidende Visit wurde falsch erfasst.",
      },
      auth,
      audit,
    });
    expect(duplicateCorrection.tournament.version).toBe(3);

    match = await matchesService.get({ organizationId, matchId: match.id, auth });
    expect(match.status).toBe("IN_PROGRESS");
    match = await matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: match.version,
        playerId: firstPlayer.playerId,
        points: 121,
        dartsThrown: 3,
        checkoutDouble: 20,
      },
      auth,
      audit,
    });
    expect(match.status).toBe("COMPLETED");
    dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.tournament.version).toBe(4);
    expect(dashboard.tournament.playedMatches).toBe(1);

    const tournamentAudit = await databaseService.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId));
    const tournamentOutbox = await databaseService.database
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, organizationId), eq(outboxEvents.aggregateId, created.id)));
    expect(tournamentAudit.some((event) => event.action === "TOURNAMENT_CREATED")).toBe(true);
    expect(tournamentAudit.some((event) => event.action === "TOURNAMENT_RESULT_CORRECTED")).toBe(true);
    expect(tournamentOutbox.some((event) => event.eventType === "TOURNAMENT_MATCH_ASSIGNED")).toBe(true);
    expect(tournamentOutbox.some((event) => event.eventType === "TOURNAMENT_MATCH_COMPLETED")).toBe(true);
  });
});
