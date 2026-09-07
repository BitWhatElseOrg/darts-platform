import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  boards,
  createDatabaseConnection,
  memberships,
  matches,
  organizations,
  outboxEvents,
  players,
  tournamentCommands,
  tournamentMatches,
  tournamentParticipants,
  tournamentStages,
  tournaments,
  users,
  visits,
  type Database,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService, MatchVersionConflictException } from "../matches/matches.service.js";
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

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function currentBackendPid(transaction: DatabaseTransaction): Promise<number> {
  const [row] = await transaction.execute(sql<{ readonly pid: number }>`select pg_backend_pid() as pid`);
  if (row === undefined || typeof row.pid !== "number") throw new Error("Expected PostgreSQL backend PID.");
  return row.pid;
}

async function waitForBackendToBlockOnRelation(input: {
  readonly database: Database;
  readonly backendPid: number;
  readonly blockingBackendPid: number;
  readonly relation: "tournament_matches" | "tournaments";
}): Promise<void> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const waiting = await input.database.execute(sql`
      select activity.pid
      from pg_stat_activity as activity
      where activity.pid = ${input.backendPid}
        and activity.wait_event_type = 'Lock'
        and ${input.blockingBackendPid} = any(pg_blocking_pids(activity.pid))
        and activity.query like ${`%${input.relation}%`}
      limit 1
    `);
    if (waiting.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend did not block on ${input.relation}.`);
}

async function expectLockTimeout(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
    expect(String(cause)).toContain("lock timeout");
    return;
  }
  throw new Error("Expected a PostgreSQL lock timeout.");
}

function databaseServiceWithLockTimeout(
  database: Database,
  onTransactionStarted?: (backendPid: number) => void,
): DatabaseService {
  const timedDatabase = Object.create(database) as Database;
  Object.defineProperty(timedDatabase, "transaction", {
    value: <T>(callback: Parameters<Database["transaction"]>[0]): Promise<T> =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '2s'`);
        onTransactionStarted?.(await currentBackendPid(transaction));
        return callback(transaction) as Promise<T>;
      }),
  });
  return { database: timedDatabase } as unknown as DatabaseService;
}

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
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    // Befund I9: der Rueckzug loest den Abbruch aus, der die Aufnahme
    // entwertet statt sie zu loeschen (siehe abort-match.ts).
    const abortedVisits = await databaseService.database.select().from(visits).where(eq(visits.matchId, scoring.id));
    expect(abortedVisits).toHaveLength(1);
    expect(abortedVisits[0]?.revertedAt).not.toBeNull();
    expect((await databaseService.database.select().from(boards).where(eq(boards.id, boardIds[0])))[0]?.status).toBe("AVAILABLE");

    const [visible] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PUBLIC" })
      .where(eq(tournaments.id, created.id))
      .returning();
    const publicDashboard = await service.publicDashboard(visible?.publicId ?? "");
    const publicParticipant = publicDashboard.participants.find((entry) => entry.playerId === ready.participants[0].playerId);
    expect(publicParticipant).toMatchObject({ status: "WITHDRAWN" });
    expect(publicParticipant).not.toHaveProperty("withdrawnAt");
    expect(publicParticipant).not.toHaveProperty("withdrawalReason");
  });

  it("serializes a withdrawal with a concurrent scoring visit without a deadlock", async () => {
    const withdrawalConnection = createDatabaseConnection(parseApplicationEnvironment(process.env).DATABASE_URL);
    const visitConnection = createDatabaseConnection(parseApplicationEnvironment(process.env).DATABASE_URL);
    const lockConnection = createDatabaseConnection(parseApplicationEnvironment(process.env).DATABASE_URL);
    const observerConnection = createDatabaseConnection(parseApplicationEnvironment(process.env).DATABASE_URL);
    let releaseTournamentMatchLock: (() => void) | undefined;
    let heldTournamentMatchLock: Promise<void> | undefined;
    let withdrawalPromise: Promise<unknown> | undefined;
    let visitPromise: Promise<unknown> | undefined;

    try {
      const created = await service.create({
        organizationId,
        data: {
          name: `Withdrawal Lock Order Cup ${randomUUID()}`,
          startsAt: new Date("2026-09-13T13:00:00.000Z"),
          format: "SINGLE_ELIMINATION",
          startingScore: 501,
          inRule: "STRAIGHT",
          outRule: "DOUBLE",
          maxRounds: null,
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
      if (ready === undefined || ready.participants[0].playerId === null) {
        throw new Error("Expected a resolved ready tournament match.");
      }
      dashboard = await service.assign({
        organizationId,
        tournamentId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: dashboard.tournament.version,
          matchId: ready.matchId,
          boardId: boardIds[0],
        },
        auth,
        audit,
      });
      const expectedTournamentVersion = dashboard.tournament.version;
      const [scheduled] = await databaseService.database
        .select()
        .from(tournamentMatches)
        .where(and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.id, ready.matchId),
        ));
      if (scheduled?.scoringMatchId === null || scheduled?.scoringMatchId === undefined) {
        throw new Error("Expected an assigned scoring match.");
      }
      const scoring = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
      if (scoring.currentPlayerId === null) throw new Error("Expected an active scoring player.");

      let tournamentMatchLocked!: () => void;
      const tournamentMatchIsLocked = new Promise<void>((resolve) => {
        tournamentMatchLocked = resolve;
      });
      let heldLockBackendPid!: number;
      const release = new Promise<void>((resolve) => {
        releaseTournamentMatchLock = resolve;
      });
      heldTournamentMatchLock = lockConnection.database.transaction(async (transaction) => {
        heldLockBackendPid = await currentBackendPid(transaction);
        await transaction.execute(sql`
          select id
          from tournament_matches
          where id = ${ready.matchId} and organization_id = ${organizationId}
          for update
        `);
        tournamentMatchLocked();
        await release;
      });
      await tournamentMatchIsLocked;

      let withdrawalTransactionStarted!: (backendPid: number) => void;
      const withdrawalTransactionStartedPromise = new Promise<number>((resolve) => {
        withdrawalTransactionStarted = resolve;
      });
      const withdrawalRepository = new TournamentsRepository(
        databaseServiceWithLockTimeout(withdrawalConnection.database, withdrawalTransactionStarted),
      );
      let visitTransactionStarted!: (backendPid: number) => void;
      const visitTransactionStartedPromise = new Promise<number>((resolve) => {
        visitTransactionStarted = resolve;
      });
      const visitRepository = new MatchesRepository(
        databaseServiceWithLockTimeout(visitConnection.database, visitTransactionStarted),
      );
      const visitService = new MatchesService(visitRepository, access);
      withdrawalPromise = withdrawalRepository.withdrawParticipant({
        organizationId,
        tournamentId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: expectedTournamentVersion,
          playerId: ready.participants[0].playerId,
          reason: "Verletzung",
        },
        auth,
        audit,
      }).then((result) => {
        if (result !== "ok") throw new Error(`Withdrawal returned ${result}.`);
        return result;
      });

      const withdrawalBackendPid = await withdrawalTransactionStartedPromise;
      await waitForBackendToBlockOnRelation({
        database: observerConnection.database,
        backendPid: withdrawalBackendPid,
        blockingBackendPid: heldLockBackendPid,
        relation: "tournament_matches",
      });
      await expectLockTimeout(observerConnection.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await transaction.execute(sql`
          select id
          from tournaments
          where id = ${created.id} and organization_id = ${organizationId}
          for update
        `);
      }));
      await expect(visitConnection.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '2s'`);
        await transaction.execute(sql`
          select id
          from matches
          where id = ${scoring.id} and organization_id = ${organizationId}
          for update
        `);
      })).resolves.toBeUndefined();
      visitPromise = visitService.submitVisit({
        organizationId,
        matchId: scoring.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: scoring.version,
          playerId: scoring.currentPlayerId,
          points: 100,
          dartsThrown: 3,
        },
        auth,
        audit,
      });
      await waitForBackendToBlockOnRelation({
        database: observerConnection.database,
        backendPid: await visitTransactionStartedPromise,
        blockingBackendPid: withdrawalBackendPid,
        relation: "tournaments",
      });

      if (releaseTournamentMatchLock === undefined) {
        throw new Error("Tournament-match lock release was not initialized.");
      }
      releaseTournamentMatchLock();
      const results = await Promise.allSettled([withdrawalPromise, visitPromise]);
      expect(results[0]).toMatchObject({ status: "fulfilled", value: "ok" });
      const visitResult = results[1];
      expect(visitResult).toMatchObject({ status: "rejected" });
      if (visitResult?.status !== "rejected") throw new Error("Expected the visit to lose with a version conflict.");
      expect(visitResult.reason).toBeInstanceOf(MatchVersionConflictException);
      expect(visitResult.reason).toMatchObject({
        status: 409,
        response: { code: "MATCH_VERSION_CONFLICT", details: { currentState: null } },
      });
      expect(String(visitResult.reason)).not.toContain("deadlock detected");
      expect(String(visitResult.reason)).not.toContain("lock timeout");
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

      const [tournament] = await databaseService.database
        .select()
        .from(tournaments)
        .where(and(
          eq(tournaments.organizationId, organizationId),
          eq(tournaments.id, created.id),
        ));
      const [tournamentMatch] = await databaseService.database
        .select()
        .from(tournamentMatches)
        .where(and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.id, ready.matchId),
        ));
      const [scoringMatch] = await databaseService.database
        .select()
        .from(matches)
        .where(and(
          eq(matches.organizationId, organizationId),
          eq(matches.id, scoring.id),
        ));
      const persistedVisits = await databaseService.database
        .select()
        .from(visits)
        .where(and(
          eq(visits.organizationId, organizationId),
          eq(visits.matchId, scoring.id),
        ));
      expect(tournament?.version).toBe(expectedTournamentVersion + 1);
      expect(tournamentMatch).toMatchObject({
        status: "COMPLETED",
        resultType: "WALKOVER",
        scoringMatchId: null,
      });
      expect(scoringMatch?.status).toBe("ABORTED");
      expect(persistedVisits).toHaveLength(0);
    } finally {
      releaseTournamentMatchLock?.();
      await heldTournamentMatchLock?.catch(() => undefined);
      await withdrawalPromise?.catch(() => undefined);
      await visitPromise?.catch(() => undefined);
      await Promise.all([
        withdrawalConnection.close(),
        visitConnection.close(),
        lockConnection.close(),
        observerConnection.close(),
      ]);
    }
  });

  it("resolves vacant group qualification slots as byes and completes every stage", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Vacant Qualifier Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T14:00:00.000Z"),
        format: "GROUPS_THEN_KNOCKOUT",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    const finalMatchId = dashboard.bracket.find((match) => match.round === 2)?.matchId;
    if (firstSemifinal === undefined || secondSemifinal === undefined || finalMatchId === undefined) throw new Error("Expected two semifinals and a final.");
    const laterWithdrawnPlayerId = secondSemifinal.participants[0]?.playerId;
    const activeWinnerId = secondSemifinal.participants[1]?.playerId;
    if (laterWithdrawnPlayerId === null || laterWithdrawnPlayerId === undefined || activeWinnerId === null || activeWinnerId === undefined) throw new Error("Expected resolved semifinal participants.");
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

    dashboard = await service.withdrawParticipant({
      organizationId,
      tournamentId: created.id,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: laterWithdrawnPlayerId, reason: "Verletzung im anderen Halbfinal" },
      auth,
      audit,
    });
    expect(dashboard.bracket.find((match) => match.round === 2)).toMatchObject({
      status: "COMPLETED",
      resultType: "WALKOVER",
      winnerDisplayName: dashboard.participants.find((participant) => participant.playerId === activeWinnerId)?.displayName,
    });
    const walkoverEvents = await databaseService.database
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(and(
        eq(outboxEvents.organizationId, organizationId),
        eq(outboxEvents.aggregateId, created.id),
        eq(outboxEvents.eventType, "TOURNAMENT_MATCH_WALKOVER"),
      ))
      .orderBy(desc(outboxEvents.occurredAt));
    const walkoverEvent = walkoverEvents.find((event) =>
      typeof event.payload === "object" &&
      event.payload !== null &&
      "tournamentMatchId" in event.payload &&
      event.payload.tournamentMatchId === finalMatchId,
    );

    expect(walkoverEvent?.payload).toMatchObject({
      tournamentMatchId: finalMatchId,
      withdrawnPlayerId: withdrawnWinnerId,
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
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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

  it("nennt in der oeffentlichen Live-Sicht weder Mandant noch Betriebsinterna", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Public Projection Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T14:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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

    // Neue Turniere sind standardmaessig PRIVATE (Task 1); fuer die
    // oeffentliche Sicht braucht dieser Test die publicId eines sichtbaren
    // Turniers.
    const [visible] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PUBLIC" })
      .where(eq(tournaments.id, created.id))
      .returning();

    const dashboard = await service.publicDashboard(visible?.publicId ?? "");
    const serialized: unknown = JSON.parse(JSON.stringify(dashboard));

    expect(dashboard.tournament).not.toHaveProperty("organizationId");
    expect(dashboard).not.toHaveProperty("conflicts");
    for (const board of dashboard.boards) {
      expect(board).not.toHaveProperty("blockedReason");
    }
    for (const entry of dashboard.queue) {
      expect(entry).not.toHaveProperty("blockedReason");
    }
    // Sicherheitsnetz gegen ein spaeter wieder durchgereichtes Feld: die
    // Mandanten-UUID darf im gesamten Antwortkoerper nicht vorkommen.
    expect(JSON.stringify(serialized)).not.toContain(organizationId);

    // Was die Live-Ansicht braucht, bleibt.
    expect(dashboard.tournament.name.length).toBeGreaterThan(0);
    expect(dashboard.participants.length).toBeGreaterThan(0);
  }, 30_000);
  it("maps a command ID used by another tournament to 400 instead of 500", async () => {
    const createInput = (name: string) => ({
      organizationId,
      data: {
        name: `${name} ${randomUUID()}`,
        startsAt: new Date("2026-09-13T15:00:00.000Z"),
        format: "SINGLE_ELIMINATION" as const,
        startingScore: 501 as const,
        inRule: "STRAIGHT" as const,
        outRule: "DOUBLE" as const,
        maxRounds: null,
        bestOfLegs: 1,
        bestOfSets: 1,
        participantIds: playerIds,
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 4 as const,
        seeding: "SEEDED" as const,
        boardIds: [...boardIds],
      },
      auth,
      audit,
    });
    const target = await service.create(createInput("Foreign Command Cup"));
    const other = await service.create(createInput("Foreign Command Reference Cup"));

    // Dieselbe `commandId` ist bereits im anderen Turnier verbucht — genau die
    // Kollision, die `findDuplicateTournamentCommand` mit
    // `COMMAND_ID_ALREADY_USED` beantwortet. Das ist ein Eingabefehler des
    // Clients und muss als 400 herauskommen, nicht als 500.
    const foreignCommandId = randomUUID();
    await databaseService.database.insert(tournamentCommands).values({
      commandId: foreignCommandId,
      organizationId,
      tournamentId: other.id,
      type: "ASSIGN_MATCH",
      payload: {},
      resultingVersion: 99,
    });

    await expect(
      service.correctResult({
        organizationId,
        tournamentId: target.id,
        data: {
          commandId: foreignCommandId,
          // Die Duplikatpruefung laeuft vor der Versionspruefung; der Wert ist
          // hier deshalb ohne Bedeutung.
          expectedVersion: 0,
          matchId: randomUUID(),
          reason: "Die Korrektur traegt eine fremde Kommando-Id.",
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: "COMMAND_ID_ALREADY_USED" },
    });
  }, 30_000);

  it("liefert ein oeffentliches Turnier ueber die publicId ohne interne ID", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Public Id Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T16:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    const [row] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PUBLIC" })
      .where(eq(tournaments.id, created.id))
      .returning();
    const publicId = row?.publicId ?? "";

    const dashboard = await service.publicDashboard(publicId);

    expect(dashboard.tournament.publicId).toBe(publicId);
    expect(Object.keys(dashboard.tournament)).not.toContain("id");
    expect(Object.keys(dashboard.tournament)).not.toContain("organizationId");
  }, 30_000);

  it("antwortet fuer ein privates Turnier mit 404, nicht mit 403", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Private Id Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T17:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    // Turniere sind standardmaessig PRIVATE (Task 1); die Zuweisung ist hier
    // nur explizit, damit der Test nicht stillschweigend von der Vorgabe lebt.
    const [row] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PRIVATE" })
      .where(eq(tournaments.id, created.id))
      .returning();

    await expect(service.publicDashboard(row?.publicId ?? "")).rejects.toThrow(NotFoundException);
  }, 30_000);

  it("verraet ueber die interne ID nichts mehr", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Internal Id Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T18:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    await databaseService.database
      .update(tournaments)
      .set({ visibility: "PUBLIC" })
      .where(eq(tournaments.id, created.id));

    await expect(service.publicDashboard(created.id)).rejects.toThrow(NotFoundException);
  }, 30_000);

  it("liefert ueber den Uebergangsweg die publicId eines oeffentlichen Turniers", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Public Address Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T19:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    const [row] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PUBLIC" })
      .where(eq(tournaments.id, created.id))
      .returning();

    const address = await service.publicAddress(created.id);

    expect(address.publicId).toBe(row?.publicId);
  }, 30_000);

  it("bestaetigt ueber den Uebergangsweg kein privates Turnier", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Private Address Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T20:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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
    // Turniere sind standardmaessig PRIVATE (Task 1); die Zuweisung ist hier
    // nur explizit, damit der Test nicht stillschweigend von der Vorgabe lebt.
    await databaseService.database
      .update(tournaments)
      .set({ visibility: "PRIVATE" })
      .where(eq(tournaments.id, created.id));

    // Der Kern dieser Zusicherung: der Uebergangsweg darf ein privates
    // Turnier weder auflosen noch dessen Existenz bestaetigen.
    await expect(service.publicAddress(created.id)).rejects.toThrow(NotFoundException);
  }, 30_000);

  it("meldet fuer eine unbekannte interne ID ebenfalls 404", async () => {
    await expect(service.publicAddress(randomUUID())).rejects.toThrow(NotFoundException);
  }, 30_000);

  it("schaltet die Sichtbarkeit um und auditiert das", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Visibility Toggle Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T18:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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

    const dashboard = await service.setVisibility({
      organizationId,
      tournamentId: created.id,
      data: { visibility: "PUBLIC" },
      auth,
      audit,
    });

    expect(dashboard.tournament.visibility).toBe("PUBLIC");

    const [row] = await databaseService.database
      .select({ visibility: tournaments.visibility })
      .from(tournaments)
      .where(eq(tournaments.id, created.id))
      .limit(1);
    expect(row?.visibility).toBe("PUBLIC");

    const [event] = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, "Tournament"),
          eq(auditEvents.entityId, created.id),
          eq(auditEvents.action, "TOURNAMENT_VISIBILITY_CHANGED"),
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    expect(event).toMatchObject({
      organizationId,
      actorUserId: userId,
      newValue: { visibility: "PUBLIC" },
    });
  }, 30_000);

  it("laesst eine Freigabe ohne tournament:update nicht zu", async () => {
    const created = await service.create({
      organizationId,
      data: {
        name: `Visibility Forbidden Cup ${randomUUID()}`,
        startsAt: new Date("2026-09-13T19:00:00.000Z"),
        format: "SINGLE_ELIMINATION",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
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

    await expect(
      service.setVisibility({
        organizationId,
        tournamentId: created.id,
        data: { visibility: "PUBLIC" },
        auth: foreignAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }, 30_000);
});
