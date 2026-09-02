import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  boards,
  players,
  tournamentMatches,
  tournaments,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import { BoardsService } from "../boards/boards.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { PlayersRepository } from "../players/players.repository.js";
import { PlayersService } from "../players/players.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";

export const SEED_BOARD_COUNT = 8;
export const SEED_PLAYER_COUNT = 32;

export interface SeedSummary {
  readonly organizationId: string;
  readonly players: number;
  readonly boards: number;
  readonly completedTournaments: number;
  readonly runningTournaments: number;
  readonly activeScoringMatches: number;
  readonly readyMatches: number;
}

export interface SeedFixtureNames {
  /** Exactly {@link SEED_PLAYER_COUNT} display names. */
  readonly playerNames: readonly string[];
  /** Knockout, league and running tournament name, in that order. */
  readonly tournamentNames: readonly [string, string, string];
  /** Distinguishes this fixture set's players from any other seed's. */
  readonly playerReferencePrefix: string;
  readonly boardNamePrefix: string;
}

const audit: AuditContext = {
  ip: "127.0.0.1",
  userAgent: "seed-fixtures",
  correlationId: randomUUID(),
};

function stableUuid(value: string): string {
  const hex = createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function services(databaseService: DatabaseService) {
  const organizationsRepository = new OrganizationsRepository(databaseService);
  const access = new OrganizationAccessService(organizationsRepository);
  const playersService = new PlayersService(
    new PlayersRepository(databaseService),
    access,
  );
  const boardsService = new BoardsService(databaseService, access);
  const matchesRepository = new MatchesRepository(databaseService);
  const matchesService = new MatchesService(matchesRepository, access);
  const tournamentsRepository = new TournamentsRepository(databaseService);
  const tournamentsService = new TournamentsService(
    tournamentsRepository,
    matchesRepository,
    access,
  );
  return { playersService, boardsService, matchesService, tournamentsService };
}

async function finishScoringMatch(input: {
  readonly organizationId: string;
  readonly scoringMatchId: string;
  readonly auth: AuthContext;
  readonly matchesService: MatchesService;
}): Promise<void> {
  let state = await input.matchesService.get({
    organizationId: input.organizationId,
    matchId: input.scoringMatchId,
    auth: input.auth,
  });
  const winnerId = state.participants[0].playerId;

  for (let guard = 0; state.status !== "COMPLETED" && guard < 10; guard += 1) {
    const currentPlayerId = state.currentPlayerId;
    if (currentPlayerId === null) {
      throw new Error("Active seed match has no current player.");
    }
    const playerVisits = state.visits.filter(
      (visit) => visit.playerId === currentPlayerId && !visit.reverted,
    ).length;
    const winnerTurn = currentPlayerId === winnerId;
    const points = winnerTurn ? ([180, 180, 141][playerVisits] ?? 0) : 60;
    const checkout = winnerTurn && points === 141;

    state = await input.matchesService.submitVisit({
      organizationId: input.organizationId,
      matchId: state.id,
      data: {
        commandId: stableUuid(
          `seed:visit:${state.id}:${currentPlayerId}:${playerVisits}`,
        ),
        expectedVersion: state.version,
        playerId: currentPlayerId,
        points,
        dartsThrown: 3,
        checkoutAttempts: checkout ? 1 : 0,
        ...(checkout ? { checkoutDouble: 12 } : {}),
      },
      auth: input.auth,
      audit,
    });
  }

  if (state.status !== "COMPLETED") {
    throw new Error("Seed match did not complete within the command guard.");
  }
}

async function scoringMatchId(
  databaseService: DatabaseService,
  organizationId: string,
  tournamentMatchId: string,
): Promise<string> {
  const [row] = await databaseService.database
    .select({ scoringMatchId: tournamentMatches.scoringMatchId })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.organizationId, organizationId),
        eq(tournamentMatches.id, tournamentMatchId),
      ),
    )
    .limit(1);

  if (row?.scoringMatchId === null || row?.scoringMatchId === undefined) {
    throw new Error("Assigned tournament match has no scoring match.");
  }
  return row.scoringMatchId;
}

async function completeTournament(input: {
  readonly databaseService: DatabaseService;
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly auth: AuthContext;
  readonly matchesService: MatchesService;
  readonly tournamentsService: TournamentsService;
}): Promise<void> {
  for (let guard = 0; guard < 128; guard += 1) {
    let dashboard = await input.tournamentsService.dashboard({
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      auth: input.auth,
    });
    if (dashboard.tournament.status === "COMPLETED") return;

    const playing = dashboard.boards.find(
      (board) => board.state === "PLAYING",
    )?.match;
    if (playing !== null && playing !== undefined) {
      await finishScoringMatch({
        organizationId: input.organizationId,
        scoringMatchId: await scoringMatchId(
          input.databaseService,
          input.organizationId,
          playing.matchId,
        ),
        auth: input.auth,
        matchesService: input.matchesService,
      });
      continue;
    }

    const ready = dashboard.queue.find((match) => match.readiness === "READY");
    const board = dashboard.boards.find(
      (candidate) => candidate.state === "FREE",
    );
    if (ready === undefined || board === undefined) {
      throw new Error("Seed tournament cannot make progress.");
    }

    dashboard = await input.tournamentsService.assign({
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      data: {
        commandId: stableUuid(`seed:assign:${ready.matchId}`),
        expectedVersion: dashboard.tournament.version,
        matchId: ready.matchId,
        boardId: board.boardId,
      },
      auth: input.auth,
      audit,
    });
    await finishScoringMatch({
      organizationId: input.organizationId,
      scoringMatchId: await scoringMatchId(
        input.databaseService,
        input.organizationId,
        ready.matchId,
      ),
      auth: input.auth,
      matchesService: input.matchesService,
    });
  }

  throw new Error("Seed tournament did not complete within the tournament guard.");
}

async function ensureTournament(input: {
  readonly organizationId: string;
  readonly name: string;
  readonly format: "SINGLE_ELIMINATION" | "ROUND_ROBIN" | "GROUPS_THEN_KNOCKOUT";
  readonly participantIds: readonly string[];
  readonly boardIds: readonly string[];
  readonly knockoutSize: 2 | 4 | 8 | 16 | 32 | 64;
  readonly groupCount: number;
  readonly qualifyPerGroup: number;
  readonly auth: AuthContext;
  readonly tournamentsService: TournamentsService;
}): Promise<string> {
  const existing = (
    await input.tournamentsService.list({
      organizationId: input.organizationId,
      auth: input.auth,
    })
  ).find((tournament) => tournament.name === input.name);
  if (existing !== undefined) return existing.id;

  const created = await input.tournamentsService.create({
    organizationId: input.organizationId,
    data: {
      name: input.name,
      startsAt: new Date("2026-08-29T12:00:00.000Z"),
      format: input.format,
      startingScore: 501,
      doubleOut: true,
      bestOfLegs: 1,
      bestOfSets: 1,
      participantIds: [...input.participantIds],
      groupCount: input.groupCount,
      qualifyPerGroup: input.qualifyPerGroup,
      knockoutSize: input.knockoutSize,
      seeding: "SEEDED",
      boardIds: [...input.boardIds],
    },
    auth: input.auth,
    audit,
  });
  return created.id;
}

async function prepareRunningTournament(input: {
  readonly databaseService: DatabaseService;
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly auth: AuthContext;
  readonly matchesService: MatchesService;
  readonly tournamentsService: TournamentsService;
}): Promise<void> {
  for (let guard = 0; guard < 16; guard += 1) {
    let dashboard = await input.tournamentsService.dashboard({
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      auth: input.auth,
    });
    const completedGroupMatches = await input.databaseService.database
      .select({ id: tournamentMatches.id })
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.organizationId, input.organizationId),
          eq(tournamentMatches.tournamentId, input.tournamentId),
          eq(tournamentMatches.status, "COMPLETED"),
        ),
      );
    const playing = dashboard.boards.find(
      (board) => board.state === "PLAYING",
    )?.match;

    if (completedGroupMatches.length < 4) {
      if (playing !== null && playing !== undefined) {
        await finishScoringMatch({
          organizationId: input.organizationId,
          scoringMatchId: await scoringMatchId(
            input.databaseService,
            input.organizationId,
            playing.matchId,
          ),
          auth: input.auth,
          matchesService: input.matchesService,
        });
        continue;
      }
      const ready = dashboard.queue.find((match) => match.readiness === "READY");
      const board = dashboard.boards.find(
        (candidate) => candidate.state === "FREE",
      );
      if (ready === undefined || board === undefined) {
        throw new Error("Running demo tournament cannot schedule a group match.");
      }
      await input.tournamentsService.assign({
        organizationId: input.organizationId,
        tournamentId: input.tournamentId,
        data: {
          commandId: stableUuid(`seed:running:assign:${ready.matchId}`),
          expectedVersion: dashboard.tournament.version,
          matchId: ready.matchId,
          boardId: board.boardId,
        },
        auth: input.auth,
        audit,
      });
      continue;
    }

    if (playing !== null && playing !== undefined) {
      const active = await input.matchesService.get({
        organizationId: input.organizationId,
        matchId: await scoringMatchId(
          input.databaseService,
          input.organizationId,
          playing.matchId,
        ),
        auth: input.auth,
      });
      if (active.visits.length === 0 && active.currentPlayerId !== null) {
        await input.matchesService.submitVisit({
          organizationId: input.organizationId,
          matchId: active.id,
          data: {
            commandId: stableUuid(`seed:running:opening:${active.id}`),
            expectedVersion: active.version,
            playerId: active.currentPlayerId,
            points: 100,
            dartsThrown: 3,
            checkoutAttempts: 0,
          },
          auth: input.auth,
          audit,
        });
      }
      return;
    }

    const ready = dashboard.queue.find((match) => match.readiness === "READY");
    const board = dashboard.boards.find(
      (candidate) => candidate.state === "FREE",
    );
    if (ready === undefined || board === undefined) {
      throw new Error("Running demo tournament has no fifth match.");
    }
    dashboard = await input.tournamentsService.assign({
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      data: {
        commandId: stableUuid(`seed:running:assign:${ready.matchId}`),
        expectedVersion: dashboard.tournament.version,
        matchId: ready.matchId,
        boardId: board.boardId,
      },
      auth: input.auth,
      audit,
    });
  }

  throw new Error("Running demo tournament did not reach its target state.");
}

/**
 * Creates players, boards and three tournaments inside an organization that
 * already exists. Every write goes through the domain services, so tenant
 * scoping and authorization apply. Re-running is a no-op for anything already
 * present.
 */
export async function applySeedFixtures(input: {
  readonly databaseService: DatabaseService;
  readonly organizationId: string;
  readonly auth: AuthContext;
  readonly names: SeedFixtureNames;
}): Promise<SeedSummary> {
  const { databaseService, organizationId, auth, names } = input;

  if (names.playerNames.length !== SEED_PLAYER_COUNT) {
    throw new Error(
      `Seed fixtures require exactly ${String(SEED_PLAYER_COUNT)} player names.`,
    );
  }

  const application = services(databaseService);
  const externalReferences = names.playerNames.map(
    (_, index) => `${names.playerReferencePrefix}${index + 1}`,
  );

  const existingPlayers = await application.playersService.list({
    organizationId,
    auth,
  });
  for (const [index, displayName] of names.playerNames.entries()) {
    const externalReference = externalReferences[index];
    if (
      existingPlayers.some(
        (player) => player.externalReference === externalReference,
      )
    ) {
      continue;
    }
    await application.playersService.create({
      organizationId,
      data: { displayName, status: "ACTIVE", externalReference },
      auth,
      audit,
    });
  }

  const playerRows = await databaseService.database
    .select()
    .from(players)
    .where(
      and(
        eq(players.organizationId, organizationId),
        inArray(players.externalReference, externalReferences),
      ),
    );
  const orderedPlayers = [...playerRows].sort((left, right) =>
    (left.externalReference ?? "").localeCompare(
      right.externalReference ?? "",
      undefined,
      { numeric: true },
    ),
  );

  const boardNames = Array.from(
    { length: SEED_BOARD_COUNT },
    (_, index) => `${names.boardNamePrefix}${index + 1}`,
  );
  const existingBoards = await application.boardsService.list({
    organizationId,
    auth,
  });
  for (const name of boardNames) {
    if (existingBoards.some((board) => board.name === name)) continue;
    await application.boardsService.create({
      organizationId,
      data: { name },
      auth,
      audit,
    });
  }

  const boardRows = await databaseService.database
    .select()
    .from(boards)
    .where(
      and(
        eq(boards.organizationId, organizationId),
        inArray(boards.name, boardNames),
      ),
    );
  const orderedBoards = [...boardRows].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true }),
  );

  const playerIds = orderedPlayers.map((player) => player.id);
  const boardIds = orderedBoards.map((board) => board.id);
  if (
    playerIds.length !== SEED_PLAYER_COUNT ||
    boardIds.length !== SEED_BOARD_COUNT
  ) {
    throw new Error("Seed players or boards are incomplete.");
  }

  const [knockoutName, leagueName, runningName] = names.tournamentNames;

  const knockoutId = await ensureTournament({
    organizationId,
    name: knockoutName,
    format: "SINGLE_ELIMINATION",
    participantIds: playerIds.slice(0, 8),
    boardIds,
    knockoutSize: 8,
    groupCount: 1,
    qualifyPerGroup: 1,
    auth,
    tournamentsService: application.tournamentsService,
  });
  await completeTournament({
    databaseService,
    organizationId,
    tournamentId: knockoutId,
    auth,
    matchesService: application.matchesService,
    tournamentsService: application.tournamentsService,
  });

  const leagueId = await ensureTournament({
    organizationId,
    name: leagueName,
    format: "ROUND_ROBIN",
    participantIds: playerIds.slice(8, 12),
    boardIds,
    knockoutSize: 4,
    groupCount: 1,
    qualifyPerGroup: 1,
    auth,
    tournamentsService: application.tournamentsService,
  });
  await completeTournament({
    databaseService,
    organizationId,
    tournamentId: leagueId,
    auth,
    matchesService: application.matchesService,
    tournamentsService: application.tournamentsService,
  });

  const runningId = await ensureTournament({
    organizationId,
    name: runningName,
    format: "GROUPS_THEN_KNOCKOUT",
    participantIds: playerIds,
    boardIds,
    knockoutSize: 16,
    groupCount: 8,
    qualifyPerGroup: 2,
    auth,
    tournamentsService: application.tournamentsService,
  });
  await prepareRunningTournament({
    databaseService,
    organizationId,
    tournamentId: runningId,
    auth,
    matchesService: application.matchesService,
    tournamentsService: application.tournamentsService,
  });

  const tournamentRows = await databaseService.database
    .select()
    .from(tournaments)
    .where(
      and(
        eq(tournaments.organizationId, organizationId),
        inArray(tournaments.name, [...names.tournamentNames]),
      ),
    );
  const dashboard = await application.tournamentsService.dashboard({
    organizationId,
    tournamentId: runningId,
    auth,
  });

  return {
    organizationId,
    players: playerIds.length,
    boards: boardIds.length,
    completedTournaments: tournamentRows.filter(
      (tournament) => tournament.status === "COMPLETED",
    ).length,
    runningTournaments: tournamentRows.filter(
      (tournament) => tournament.status !== "COMPLETED",
    ).length,
    activeScoringMatches: dashboard.boards.filter(
      (board) => board.state === "PLAYING",
    ).length,
    readyMatches: dashboard.queue.filter(
      (match) => match.readiness === "READY",
    ).length,
  };
}
