import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  boards,
  memberships,
  organizations,
  outboxEvents,
  players,
  tournamentMatches,
  tournamentStages,
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
const tournamentsRepository = new TournamentsRepository(databaseService);
const tournamentsService = new TournamentsService(tournamentsRepository, matchesRepository, access);
const organizationId = randomUUID();
const userId = randomUUID();
const playerIds = Array.from({ length: 32 }, () => randomUUID());
const boardIds = Array.from({ length: 8 }, () => randomUUID());
const auth: AuthContext = {
  user: { id: userId, email: `reference-${userId}@example.test`, name: "Reference Director" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 120_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values({
    id: userId,
    email: auth.user.email,
    displayName: auth.user.name,
  });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Reference Championship Club",
    slug: `reference-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(memberships).values({
    organizationId,
    userId,
    role: "OWNER",
    status: "ACTIVE",
  });
  await databaseService.database.insert(players).values(
    playerIds.map((id, index) => ({
      id,
      organizationId,
      displayName: `Reference Player ${String(index + 1).padStart(2, "0")}`,
      status: "ACTIVE",
    })),
  );
  await databaseService.database.insert(boards).values(
    boardIds.map((id, index) => ({
      id,
      organizationId,
      name: `Reference Board ${index + 1}`,
    })),
  );
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("32/8/2/16 reference tournament", () => {
  it("runs all 48 group and 15 knockout matches to a consistent champion", async () => {
    const created = await tournamentsService.create({
      organizationId,
      data: {
        name: "32 Player Reference Championship",
        startsAt: new Date("2026-09-12T12:00:00.000Z"),
        format: "GROUPS_THEN_KNOCKOUT",
        startingScore: 301,
        doubleOut: false,
        bestOfLegs: 1,
        participantIds: playerIds,
        groupCount: 8,
        qualifyPerGroup: 2,
        knockoutSize: 16,
        seeding: "SEEDED",
        boardIds,
      },
      auth,
      audit,
    });
    expect(created.totalMatches).toBe(63);

    let dashboard = await tournamentsService.dashboard({
      organizationId,
      tournamentId: created.id,
      auth,
    });
    let completed = 0;
    while (dashboard.tournament.status !== "COMPLETED") {
      const ready = dashboard.queue.find((entry) => entry.readiness === "READY");
      const board = dashboard.boards.find((entry) => entry.state === "FREE");
      if (ready === undefined || board === undefined) {
        throw new Error(`Reference tournament stalled after ${completed} matches.`);
      }
      dashboard = await tournamentsService.assign({
        organizationId,
        tournamentId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: dashboard.tournament.version,
          matchId: ready.matchId,
          boardId: board.boardId,
        },
        auth,
        audit,
      });
      const [scheduled] = await databaseService.database
        .select({ scoringMatchId: tournamentMatches.scoringMatchId })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, organizationId),
            eq(tournamentMatches.id, ready.matchId),
          ),
        )
        .limit(1);
      if (scheduled?.scoringMatchId === null || scheduled?.scoringMatchId === undefined) {
        throw new Error("Assigned reference match has no scoring aggregate.");
      }
      let match = await matchesService.get({
        organizationId,
        matchId: scheduled.scoringMatchId,
        auth,
      });
      const [winner, opponent] = match.participants;
      for (const visit of [
        { playerId: winner.playerId, points: 180 },
        { playerId: opponent.playerId, points: 0 },
        { playerId: winner.playerId, points: 121 },
      ]) {
        match = await matchesService.submitVisit({
          organizationId,
          matchId: match.id,
          data: {
            commandId: randomUUID(),
            expectedVersion: match.version,
            playerId: visit.playerId,
            points: visit.points,
            dartsThrown: 3,
          },
          auth,
          audit,
        });
      }
      expect(match.status).toBe("COMPLETED");
      completed += 1;
      dashboard = await tournamentsService.dashboard({
        organizationId,
        tournamentId: created.id,
        auth,
      });
    }

    expect(completed).toBe(63);
    expect(dashboard.tournament).toMatchObject({
      status: "COMPLETED",
      playedMatches: 63,
      totalMatches: 63,
    });
    expect(dashboard.queue).toHaveLength(0);
    expect(dashboard.boards.every((board) => board.state === "FREE")).toBe(true);
    expect(dashboard.groups).toHaveLength(8);
    expect(dashboard.groups.every((group) => group.playedMatches === 6)).toBe(true);
    expect(dashboard.groups.flatMap((group) => group.rows).filter((row) => row.qualified)).toHaveLength(16);

    const [storedMatches, storedStages, tournamentEvents] = await Promise.all([
      databaseService.database
        .select()
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, organizationId),
            eq(tournamentMatches.tournamentId, created.id),
          ),
        ),
      databaseService.database
        .select()
        .from(tournamentStages)
        .where(
          and(
            eq(tournamentStages.organizationId, organizationId),
            eq(tournamentStages.tournamentId, created.id),
          ),
        ),
      databaseService.database
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.organizationId, organizationId),
            eq(outboxEvents.aggregateId, created.id),
          ),
        ),
    ]);
    expect(storedMatches).toHaveLength(63);
    expect(storedMatches.every((match) => match.status === "COMPLETED")).toBe(true);
    expect(new Set(storedMatches.map((match) => match.key)).size).toBe(63);
    expect(storedStages.every((stage) => stage.status === "COMPLETED")).toBe(true);
    expect(tournamentEvents.filter((event) => event.eventType === "TOURNAMENT_MATCH_COMPLETED")).toHaveLength(63);
    const completedGroupMatch = storedMatches.find((match) => match.groupId !== null);
    if (completedGroupMatch === undefined) throw new Error("Reference group match missing.");
    await expect(
      tournamentsService.correctResult({
        organizationId,
        tournamentId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: dashboard.tournament.version,
          matchId: completedGroupMatch.id,
          reason: "Safety check after the knockout stage started.",
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "TOURNAMENT_DEPENDENT_MATCH_STARTED" },
    });
  }, 120_000);
});
