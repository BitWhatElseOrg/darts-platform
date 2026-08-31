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

import { lockTournamentScoringContext } from "./tournament-scoring-lock.js";

const environment = parseApplicationEnvironment(process.env);

async function createFixture(database: Database): Promise<{
  readonly organizationId: string;
  readonly scoringMatchId: string;
  readonly freeScoringMatchId: string;
  readonly tournamentId: string;
  readonly tournamentMatchId: string;
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
    },
    {
      id: freeScoringMatchId,
      organizationId,
      bestOfLegs: 1,
      startingPlayerId: playerId,
      currentPlayerId: playerId,
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

  return { organizationId, scoringMatchId, freeScoringMatchId, tournamentId, tournamentMatchId };
}

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
      heldTournamentLock = connectionA.database.transaction(async (transaction) => {
        await transaction.execute(sql`select id from tournaments where id = ${fixture.tournamentId} and organization_id = ${fixture.organizationId} for update`);
        tournamentLocked();
        await release;
      });
      await tournamentIsLocked;

      waitingContext = connectionB.database.transaction((transaction) =>
        lockTournamentScoringContext(transaction, fixture.organizationId, fixture.scoringMatchId),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
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
