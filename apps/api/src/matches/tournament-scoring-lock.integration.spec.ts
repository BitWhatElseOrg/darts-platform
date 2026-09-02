import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  matches,
  organizations,
  players,
  tournamentMatches,
  tournaments,
  tournamentStages,
  type Database,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "./matches.repository.js";
import { lockTournamentScoringContext } from "./tournament-scoring-lock.js";

const environment = parseApplicationEnvironment(process.env);
const auth: AuthContext = {
  user: { id: randomUUID(), email: "lock-order@example.test", name: "Lock Order Tester" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit: AuditContext = {
  correlationId: randomUUID(),
  ip: "127.0.0.1",
  userAgent: "vitest",
};

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
  readonly relation: "tournaments";
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

function databaseServiceWithTransactionIdentity(
  database: Database,
  onTransactionStarted: (backendPid: number) => void,
): DatabaseService {
  const identifiedDatabase = Object.create(database) as Database;
  Object.defineProperty(identifiedDatabase, "transaction", {
    value: <T>(callback: Parameters<Database["transaction"]>[0]): Promise<T> =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '2s'`);
        onTransactionStarted(await currentBackendPid(transaction));
        return callback(transaction) as Promise<T>;
      }),
  });
  return { database: identifiedDatabase } as unknown as DatabaseService;
}

async function createFixture(database: Database): Promise<{
  readonly organizationId: string;
  readonly scoringMatchId: string;
  readonly freeScoringMatchId: string;
  readonly tournamentId: string;
  readonly tournamentMatchId: string;
  readonly playerId: string;
}> {
  const organizationId = randomUUID();
  const playerId = randomUUID();
  const scoringMatchId = randomUUID();
  const freeScoringMatchId = randomUUID();
  const tournamentId = randomUUID();
  const tournamentStageId = randomUUID();
  const tournamentMatchId = randomUUID();

  await database.insert(organizations).values({
    id: organizationId,
    name: "Tournament Scoring Lock Club",
    slug: `tournament-scoring-lock-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await database.insert(players).values({
    id: playerId,
    organizationId,
    displayName: "Tournament Scoring Lock Player",
    status: "ACTIVE",
  });
  await database.insert(matches).values([
    {
      id: scoringMatchId,
      organizationId,
      bestOfLegs: 1,
      startingPlayerId: playerId,
      currentPlayerId: playerId,
      startingSeat: 1,
      currentSeat: 1,
    },
    {
      id: freeScoringMatchId,
      organizationId,
      bestOfLegs: 1,
      startingPlayerId: playerId,
      currentPlayerId: playerId,
      startingSeat: 1,
      currentSeat: 1,
    },
  ]);
  await database.insert(tournaments).values({
    id: tournamentId,
    organizationId,
    name: "Tournament Scoring Lock Cup",
    format: "SINGLE_ELIMINATION",
    groupCount: 1,
    qualifyPerGroup: 1,
    knockoutSize: 2,
    seeding: "SEEDED",
    startsAt: new Date("2026-09-01T10:00:00.000Z"),
  });
  await database.insert(tournamentStages).values({
    id: tournamentStageId,
    organizationId,
    tournamentId,
    key: "knockout",
    sequence: 1,
    name: "Knockout",
    type: "SINGLE_ELIMINATION",
    status: "OPEN",
  });
  await database.insert(tournamentMatches).values({
    id: tournamentMatchId,
    organizationId,
    tournamentId,
    stageId: tournamentStageId,
    key: "R1-M1",
    stageLabel: "Final",
    round: 1,
    position: 1,
    status: "IN_PROGRESS",
    scoringMatchId,
  });

  return { organizationId, scoringMatchId, freeScoringMatchId, tournamentId, tournamentMatchId, playerId };
}

const repositoryCallers = [
  {
    name: "submit visit",
    run: (repository: MatchesRepository, fixture: Awaited<ReturnType<typeof createFixture>>) =>
      repository.submitVisit({
        organizationId: fixture.organizationId,
        matchId: fixture.scoringMatchId,
        data: {
          commandId: randomUUID(),
          expectedVersion: 1,
          playerId: fixture.playerId,
          points: 60,
          dartsThrown: 3,
        },
        auth,
        audit,
      }),
  },
  {
    name: "undo",
    run: (repository: MatchesRepository, fixture: Awaited<ReturnType<typeof createFixture>>) =>
      repository.undo({
        organizationId: fixture.organizationId,
        matchId: fixture.scoringMatchId,
        data: { commandId: randomUUID(), expectedVersion: 1 },
        auth,
        audit,
      }),
  },
  {
    name: "technical abort",
    run: (repository: MatchesRepository, fixture: Awaited<ReturnType<typeof createFixture>>) =>
      repository.abort({
        organizationId: fixture.organizationId,
        matchId: fixture.scoringMatchId,
        data: { commandId: randomUUID(), expectedVersion: 1, reason: "Lock-order test" },
        auth,
        audit,
      }),
  },
] as const;

describe("tournament scoring lock context", () => {
  it("locks the tournament before a tournament-linked scoring match", async () => {
    const connectionA = createDatabaseConnection(environment.DATABASE_URL);
    const connectionB = createDatabaseConnection(environment.DATABASE_URL);
    const connectionC = createDatabaseConnection(environment.DATABASE_URL);
    let releaseTournamentLock: (() => void) | undefined;
    let heldTournamentLock: Promise<void> | undefined;
    let waitingContext: Promise<unknown> | undefined;
    let organizationId: string | undefined;

    try {
      const fixture = await createFixture(connectionA.database);
      organizationId = fixture.organizationId;
      let tournamentLocked!: () => void;
      const tournamentIsLocked = new Promise<void>((resolve) => {
        tournamentLocked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseTournamentLock = resolve;
      });
      let holdingBackendPid!: number;
      heldTournamentLock = connectionA.database.transaction(async (transaction) => {
        holdingBackendPid = await currentBackendPid(transaction);
        await transaction.execute(sql`select id from tournaments where id = ${fixture.tournamentId} and organization_id = ${fixture.organizationId} for update`);
        tournamentLocked();
        await release;
      });
      await tournamentIsLocked;

      let waitingBackendStarted!: (backendPid: number) => void;
      const waitingBackendStartedPromise = new Promise<number>((resolve) => {
        waitingBackendStarted = resolve;
      });
      waitingContext = connectionB.database.transaction(async (transaction) => {
        waitingBackendStarted(await currentBackendPid(transaction));
        return lockTournamentScoringContext(transaction, fixture.organizationId, fixture.scoringMatchId);
      });
      await waitForBackendToBlockOnRelation({
        database: connectionC.database,
        backendPid: await waitingBackendStartedPromise,
        blockingBackendPid: holdingBackendPid,
        relation: "tournaments",
      });
      await expect(connectionC.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await transaction.execute(sql`select id from matches where id = ${fixture.scoringMatchId} and organization_id = ${fixture.organizationId} for update`);
      })).resolves.toBeUndefined();

      if (releaseTournamentLock === undefined) throw new Error("Tournament lock release was not initialized.");
      releaseTournamentLock();
      await heldTournamentLock;
      await expect(waitingContext).resolves.toMatchObject({ id: fixture.tournamentMatchId });
    } finally {
      releaseTournamentLock?.();
      await heldTournamentLock?.catch(() => undefined);
      await waitingContext?.catch(() => undefined);
      if (organizationId !== undefined) {
        await connectionA.database.delete(organizations).where(eq(organizations.id, organizationId));
      }
      await Promise.all([connectionA.close(), connectionB.close(), connectionC.close()]);
    }
  });

  it.each(repositoryCallers)("makes $name wait for the tournament before locking the scoring match", async ({ run }) => {
    const lockConnection = createDatabaseConnection(environment.DATABASE_URL);
    const callerConnection = createDatabaseConnection(environment.DATABASE_URL);
    const observerConnection = createDatabaseConnection(environment.DATABASE_URL);
    let releaseTournamentLock: (() => void) | undefined;
    let heldTournamentLock: Promise<void> | undefined;
    let callerOperation: Promise<unknown> | undefined;
    let organizationId: string | undefined;

    try {
      const fixture = await createFixture(lockConnection.database);
      organizationId = fixture.organizationId;
      let tournamentLocked!: () => void;
      const tournamentIsLocked = new Promise<void>((resolve) => {
        tournamentLocked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseTournamentLock = resolve;
      });
      let holdingBackendPid!: number;
      heldTournamentLock = lockConnection.database.transaction(async (transaction) => {
        holdingBackendPid = await currentBackendPid(transaction);
        await transaction.execute(sql`
          select id
          from tournaments
          where id = ${fixture.tournamentId} and organization_id = ${fixture.organizationId}
          for update
        `);
        tournamentLocked();
        await release;
      });
      await tournamentIsLocked;

      let callerBackendStarted!: (backendPid: number) => void;
      const callerBackendStartedPromise = new Promise<number>((resolve) => {
        callerBackendStarted = resolve;
      });
      const repository = new MatchesRepository(
        databaseServiceWithTransactionIdentity(callerConnection.database, callerBackendStarted),
      );
      callerOperation = run(repository, fixture);

      await waitForBackendToBlockOnRelation({
        database: observerConnection.database,
        backendPid: await callerBackendStartedPromise,
        blockingBackendPid: holdingBackendPid,
        relation: "tournaments",
      });
      await expect(observerConnection.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await transaction.execute(sql`
          select id
          from matches
          where id = ${fixture.scoringMatchId} and organization_id = ${fixture.organizationId}
          for update
        `);
      })).resolves.toBeUndefined();

      if (releaseTournamentLock === undefined) throw new Error("Tournament lock release was not initialized.");
      releaseTournamentLock();
      await heldTournamentLock;
      await expect(callerOperation).resolves.toBe("version-conflict");
    } finally {
      releaseTournamentLock?.();
      await heldTournamentLock?.catch(() => undefined);
      await callerOperation?.catch(() => undefined);
      if (organizationId !== undefined) {
        await lockConnection.database.delete(organizations).where(eq(organizations.id, organizationId));
      }
      await Promise.all([lockConnection.close(), callerConnection.close(), observerConnection.close()]);
    }
  });

  it("returns null for an unlinked scoring match", async () => {
    const connection = createDatabaseConnection(environment.DATABASE_URL);
    let organizationId: string | undefined;

    try {
      const fixture = await createFixture(connection.database);
      organizationId = fixture.organizationId;

      await expect(connection.database.transaction((transaction) =>
        lockTournamentScoringContext(transaction, fixture.organizationId, fixture.freeScoringMatchId),
      )).resolves.toBeNull();
    } finally {
      if (organizationId !== undefined) {
        await connection.database.delete(organizations).where(eq(organizations.id, organizationId));
      }
      await connection.close();
    }
  });
});
