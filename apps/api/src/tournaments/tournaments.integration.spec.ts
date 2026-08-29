import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  boards,
  memberships,
  matches,
  organizations,
  outboxEvents,
  players,
  tournamentMatches,
  tournamentParticipants,
  tournamentStages,
  users,
  visits,
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
  it("keeps group standings consistent and promotes the active player after a withdrawal", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Group Withdrawal Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T10:00:00.000Z"),
        format: "GROUPS_THEN_KNOCKOUT",
        startingScore: 501,
        doubleOut: true,
        bestOfLegs: 1,
        bestOfSets: 1,
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
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const groupMatch = dashboard.queue.find((entry) => entry.stageLabel.startsWith("Gruppe") && entry.participants.every((participant) => participant.playerId !== null));
    if (groupMatch === undefined || groupMatch.participants[0].playerId === null || groupMatch.participants[1].playerId === null) throw new Error("Expected a resolved group match.");

    dashboard = await service.withdrawParticipant({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: groupMatch.participants[0].playerId, reason: "Krankheit" },
      auth,
      audit,
    });

    const group = dashboard.groups.find((entry) => `Gruppe ${entry.groupLabel}` === groupMatch.stageLabel);
    expect(group?.rows.find((row) => row.playerId === groupMatch.participants[0].playerId)).toMatchObject({ withdrawn: true, qualified: false });
    expect(group?.rows.find((row) => row.playerId === groupMatch.participants[1].playerId)).toMatchObject({ won: 1, qualified: true });
    expect(dashboard.bracket[0]?.participantNames).toContain(groupMatch.participants[1].displayName);
  });

  it("withdraws a player, aborts the active scoring session and advances the opponent", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Withdrawal Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T12:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        doubleOut: true,
        bestOfLegs: 1,
        bestOfSets: 1,
        participantIds: playerIds,
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 4,
        seeding: "SEEDED",
        boardIds: [...boardIds],
      },
      auth,
      audit,
    });
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const ready = dashboard.queue.find((entry) => entry.readiness === "READY");
    if (ready === undefined || ready.participants[0].playerId === null || ready.participants[1].playerId === null) throw new Error("Expected a resolved first-round match.");
    dashboard = await service.assign({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: ready.matchId, boardId: boardIds[0] }, auth, audit });
    const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, ready.matchId));
    if (scheduled?.scoringMatchId === null || scheduled?.scoringMatchId === undefined) throw new Error("Expected active scoring match.");
    let scoring = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
    scoring = await matchesService.submitVisit({ organizationId, matchId: scoring.id, data: { commandId: randomUUID(), expectedVersion: scoring.version, playerId: ready.participants[0].playerId, points: 100, dartsThrown: 3 }, auth, audit });

    const commandId = randomUUID();
    const withdrawal = { organizationId, tournamentId: created.id, data: { commandId, expectedVersion: dashboard.tournament.version, playerId: ready.participants[0].playerId, reason: "Verletzung" }, auth, audit };
    const [firstWithdrawal, duplicate] = await Promise.all([
      service.withdrawParticipant(withdrawal),
      service.withdrawParticipant(withdrawal),
    ]);
    dashboard = firstWithdrawal;
    expect(duplicate.tournament.version).toBe(dashboard.tournament.version);
    expect(dashboard.participants.find((entry) => entry.playerId === ready.participants[0].playerId)).toMatchObject({ status: "WITHDRAWN", withdrawalReason: "Verletzung" });
    expect(dashboard.recentResults.find((entry) => entry.matchId === ready.matchId)?.resultType).toBe("WALKOVER");
    expect(dashboard.bracket.find((entry) => entry.matchId === ready.matchId)?.resultType).toBe("WALKOVER");

    const [withdrawn] = await databaseService.database.select().from(tournamentParticipants).where(and(eq(tournamentParticipants.tournamentId, created.id), eq(tournamentParticipants.playerId, ready.participants[0].playerId)));
    expect(withdrawn).toMatchObject({ status: "WITHDRAWN", withdrawalReason: "Verletzung" });
    const [walkover] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, ready.matchId));
    expect(walkover).toMatchObject({ status: "COMPLETED", resultType: "WALKOVER", winnerPlayerId: ready.participants[1].playerId, scoringMatchId: null, boardId: null });
    const [dependent] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.sourceOneMatchId, ready.matchId));
    expect([dependent?.participantOneId, dependent?.participantTwoId]).toContain(ready.participants[1].playerId);
    expect((await databaseService.database.select().from(matches).where(eq(matches.id, scoring.id)))[0]?.status).toBe("ABORTED");
    expect(await databaseService.database.select().from(visits).where(eq(visits.matchId, scoring.id))).toHaveLength(0);
    expect((await databaseService.database.select().from(boards).where(eq(boards.id, boardIds[0])))[0]?.status).toBe("AVAILABLE");

    const publicDashboard = await service.publicDashboard(created.id);
    const publicParticipant = publicDashboard.participants.find((entry) => entry.playerId === ready.participants[0].playerId);
    expect(publicParticipant).toMatchObject({ status: "WITHDRAWN" });
    expect(publicParticipant).not.toHaveProperty("withdrawnAt");
    expect(publicParticipant).not.toHaveProperty("withdrawalReason");
  });

  it("resolves vacant group qualification slots as byes and completes every stage", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Vacant Qualifier Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T14:00:00.000Z"),
        format: "GROUPS_THEN_KNOCKOUT",
        startingScore: 501,
        doubleOut: true,
        bestOfLegs: 1,
        bestOfSets: 1,
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
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const [emptyGroup, survivingGroup] = dashboard.groups;
    if (emptyGroup === undefined || survivingGroup === undefined) throw new Error("Expected two groups.");

    for (const playerId of emptyGroup.rows.map((row) => row.playerId)) {
      dashboard = await service.withdrawParticipant({
        organizationId,
        tournamentId: created.id,
        data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId, reason: "Nicht mehr spielfähig" },
        auth,
        audit,
      });
    }
    dashboard = await service.withdrawParticipant({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: survivingGroup.rows[0]?.playerId ?? "", reason: "Nicht mehr spielfähig" },
      auth,
      audit,
    });

    const survivorId = survivingGroup.rows[1]?.playerId;
    expect(survivorId).toBeDefined();
    expect(dashboard.tournament.status).toBe("COMPLETED");
    expect(dashboard.bracket).toContainEqual(expect.objectContaining({
      status: "BYE",
      resultType: "BYE",
      winnerDisplayName: survivingGroup.rows[1]?.displayName,
    }));
    const stages = await databaseService.database.select().from(tournamentStages).where(and(
      eq(tournamentStages.organizationId, organizationId),
      eq(tournamentStages.tournamentId, created.id),
    ));
    expect(stages.every((stage) => stage.status === "COMPLETED")).toBe(true);

    await expect(service.withdrawParticipant({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: survivorId ?? "", reason: "Nachträglicher Ausfall" },
      auth,
      audit,
    })).rejects.toMatchObject({ response: { code: "TOURNAMENT_ALREADY_COMPLETED" }, status: 409 });
  });

  it("closes a knockout stage when a withdrawal decides its final", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Final Walkover Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T15:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        doubleOut: true,
        bestOfLegs: 1,
        bestOfSets: 1,
        participantIds: playerIds.slice(0, 2),
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 2,
        seeding: "SEEDED",
        boardIds: [...boardIds],
      },
      auth,
      audit,
    });
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const finalist = dashboard.participants[0];
    if (finalist === undefined) throw new Error("Expected a finalist.");
    const completed = await service.withdrawParticipant({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: finalist.playerId, reason: "Verletzung" },
      auth,
      audit,
    });
    expect(completed.tournament.status).toBe("COMPLETED");
    const [stage] = await databaseService.database.select().from(tournamentStages).where(and(
      eq(tournamentStages.organizationId, organizationId),
      eq(tournamentStages.tournamentId, created.id),
    ));
    expect(stage?.status).toBe("COMPLETED");
  });

  it("applies a prior withdrawal when a later result resolves the dependent final", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Delayed Walkover Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T16:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        doubleOut: true,
        bestOfLegs: 1,
        bestOfSets: 1,
        participantIds: playerIds,
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 4,
        seeding: "SEEDED",
        boardIds: [...boardIds],
      },
      auth,
      audit,
    });
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const semifinals = dashboard.queue.filter((entry) => entry.readiness === "READY").slice(0, 2);
    const firstSemifinal = semifinals[0];
    const secondSemifinal = semifinals[1];
    if (firstSemifinal === undefined || secondSemifinal === undefined) throw new Error("Expected two semifinals.");
    dashboard = await service.assign({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: firstSemifinal.matchId, boardId: boardIds[0] },
      auth,
      audit,
    });
    dashboard = await service.assign({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: secondSemifinal.matchId, boardId: boardIds[1] },
      auth,
      audit,
    });

    const completeScoringMatch = async (tournamentMatchId: string): Promise<string> => {
      const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, tournamentMatchId));
      if (scheduled?.scoringMatchId === null || scheduled?.scoringMatchId === undefined) throw new Error("Expected linked scoring match.");
      let scoring = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
      const winnerPlayerId = scoring.currentPlayerId;
      if (winnerPlayerId === null) throw new Error("Expected starting player.");
      for (const points of [180, 0, 180, 0] as const) {
        if (scoring.currentPlayerId === null) throw new Error("Expected active player.");
        scoring = await matchesService.submitVisit({
          organizationId,
          matchId: scoring.id,
          data: { commandId: randomUUID(), expectedVersion: scoring.version, playerId: scoring.currentPlayerId, points, dartsThrown: 3 },
          auth,
          audit,
        });
      }
      scoring = await matchesService.submitVisit({
        organizationId,
        matchId: scoring.id,
        data: { commandId: randomUUID(), expectedVersion: scoring.version, playerId: winnerPlayerId, points: 141, dartsThrown: 3, checkoutDouble: 12 },
        auth,
        audit,
      });
      expect(scoring.status).toBe("COMPLETED");
      return winnerPlayerId;
    };

    const withdrawnWinnerId = await completeScoringMatch(firstSemifinal.matchId);
    dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    dashboard = await service.withdrawParticipant({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: withdrawnWinnerId, reason: "Verletzung nach dem Halbfinal" },
      auth,
      audit,
    });
    expect(dashboard.bracket.find((match) => match.round === 2)?.status).toBe("WAITING");

    const activeWinnerId = await completeScoringMatch(secondSemifinal.matchId);
    dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.bracket.find((match) => match.round === 2)).toMatchObject({
      status: "COMPLETED",
      resultType: "WALKOVER",
      winnerDisplayName: dashboard.participants.find((participant) => participant.playerId === activeWinnerId)?.displayName,
    });
    expect(dashboard.tournament.status).toBe("COMPLETED");
  });

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
        bestOfSets: 1,
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
