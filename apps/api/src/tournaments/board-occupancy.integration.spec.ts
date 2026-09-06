import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  boards,
  competitions,
  encounterSlots,
  encounters,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  memberships,
  organizations,
  players,
  teams,
  users,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { TournamentsRepository } from "./tournaments.repository.js";
import { TournamentsService } from "./tournaments.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const repository = new TournamentsRepository(databaseService);
const service = new TournamentsService(repository, new MatchesRepository(databaseService), access);

const organizationId = randomUUID();
const userId = randomUUID();
/** Vier Personen: zwei stehen am Ligaabend, zwei sind frei. */
const playerIds = Array.from({ length: 4 }, () => randomUUID());
/** Scheibe 1 traegt den Ligaslot, Scheibe 2 und 3 sind frei. */
const boardIds = Array.from({ length: 3 }, () => randomUUID());
const leagueBoardId = boardIds[0] as string;
const leaguePlayerId = playerIds[0] as string;
const freePlayerIds = [playerIds[2] as string, playerIds[3] as string] as const;
const auth: AuthContext = {
  user: { id: userId, email: `occupancy-${userId}@example.test`, name: "Occupancy Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;
/** Scheiben, die kein Ligaslot belegt. */
const freeBoardIds = [boardIds[1] as string, boardIds[2] as string] as const;
let leagueBoardTournamentId = "";

/**
 * Baut den Ligaabend, den die Turnierleitung nicht sieht: ein laufender
 * Ligaslot auf einer registrierten Scheibe, mit zwei beschaeftigten Personen.
 */
async function startLeagueSlot(): Promise<void> {
  const competitionId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  const encounterId = randomUUID();
  await databaseService.database.insert(competitions).values({
    id: competitionId,
    organizationId,
    type: "LEAGUE",
    name: `Occupancy Liga ${competitionId}`,
    slug: `occupancy-${competitionId}`,
    status: "ACTIVE",
  });
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId}` },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId}` },
  ]);
  await databaseService.database.insert(encounters).values({
    id: encounterId,
    organizationId,
    competitionId,
    matchday: 1,
    homeTeamId,
    awayTeamId,
    scheduledAt: new Date("2026-09-06T19:00:00.000Z"),
    status: "RUNNING",
  });
  const [leagueMatch] = await databaseService.database
    .insert(matches)
    .values({
      organizationId,
      boardId: leagueBoardId,
      bestOfLegs: 1,
      startingSeat: 1,
      currentSeat: 1,
    })
    .returning();
  if (leagueMatch === undefined) throw new Error("Expected the league scoring match.");
  const participants = await databaseService.database
    .insert(matchParticipants)
    .values([
      { organizationId, matchId: leagueMatch.id, seat: 1 },
      { organizationId, matchId: leagueMatch.id, seat: 2 },
    ])
    .returning();
  await databaseService.database.insert(matchParticipantPlayers).values(
    participants.map((participant, index) => ({
      organizationId,
      matchId: leagueMatch.id,
      participantId: participant.id,
      playerId: playerIds[index] as string,
      position: 1,
    })),
  );
  await databaseService.database.insert(encounterSlots).values({
    organizationId,
    encounterId,
    sequence: 1,
    role: "REGULAR",
    discipline: "SINGLES",
    label: "Einzel 1",
    homePosition: 1,
    awayPosition: 1,
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    legsToWinSet: 1,
    setsToWin: 1,
    status: "IN_PROGRESS",
    boardId: leagueBoardId,
    matchId: leagueMatch.id,
  });
  await databaseService.database
    .update(boards)
    .set({ status: "IN_USE" })
    .where(eq(boards.id, leagueBoardId));
}

/** Jedes Turnier hier traegt genau eine Paarung. */
async function createTournament(
  participants: readonly [string, string],
  registeredBoardIds: readonly string[],
): Promise<string> {
  const created = await service.create({
    organizationId,
    data: {
      name: `Occupancy Cup ${randomUUID()}`,
      startsAt: new Date("2026-09-06T10:00:00.000Z"),
      format: "SINGLE_ELIMINATION",
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      maxRounds: null,
      bestOfLegs: 1,
      bestOfSets: 1,
      participantIds: [...participants],
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 2,
      seeding: "SEEDED",
      boardIds: [...registeredBoardIds],
    },
    auth,
    audit,
  });
  return created.id;
}

beforeAll(async () => {
  await databaseService.database
    .insert(users)
    .values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Occupancy Club",
    slug: `occupancy-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database
    .insert(memberships)
    .values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(players).values(
    playerIds.map((id, index) => ({
      id,
      organizationId,
      displayName: `Occupancy Player ${index + 1}`,
      status: "ACTIVE",
    })),
  );
  await databaseService.database.insert(boards).values(
    boardIds.map((id, index) => ({ id, organizationId, name: `Occupancy Board ${index + 1}` })),
  );
  // Das Turnier muss die Ligascheibe registriert haben, bevor die Liga sie
  // belegt — `create` nimmt nur freie Scheiben an.
  leagueBoardTournamentId = await createTournament(freePlayerIds, boardIds);
  await startLeagueSlot();
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("Boardbelegung zwischen Turnier und Liga", () => {
  it("gibt eine Scheibe nicht frei, auf der ein Ligaslot laeuft", async () => {
    const tournamentId = leagueBoardTournamentId;
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });

    await expect(
      service.releaseBoard({
        organizationId,
        tournamentId,
        data: {
          commandId: randomUUID(),
          expectedVersion: dashboard.tournament.version,
          boardId: leagueBoardId,
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "BOARD_NOT_AVAILABLE" } });

    const [board] = await databaseService.database
      .select({ status: boards.status })
      .from(boards)
      .where(eq(boards.id, leagueBoardId));
    expect(board?.status).toBe("IN_USE");
  });

  it("lehnt eine Zuweisung auf eine Scheibe ab, auf der ein Ligaslot laeuft", async () => {
    // Der Status der Scheibe steht auf AVAILABLE — genau der Zustand, den eine
    // fruehere Freigabe hinterlassen hat. Nur die zweite Quelle deckt ihn auf.
    await databaseService.database
      .update(boards)
      .set({ status: "AVAILABLE" })
      .where(eq(boards.id, leagueBoardId));
    try {
      const tournamentId = leagueBoardTournamentId;
      const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
      const ready = dashboard.queue[0];
      if (ready === undefined) throw new Error("Expected a queued match.");

      await expect(
        service.assign({
          organizationId,
          tournamentId,
          data: {
            commandId: randomUUID(),
            expectedVersion: dashboard.tournament.version,
            matchId: ready.matchId,
            boardId: leagueBoardId,
          },
          auth,
          audit,
        }),
      ).rejects.toMatchObject({ response: { code: "BOARD_NOT_AVAILABLE" } });
    } finally {
      await databaseService.database
        .update(boards)
        .set({ status: "IN_USE" })
        .where(eq(boards.id, leagueBoardId));
    }
  });

  it("lehnt eine Person ab, die gerade einen Ligaslot spielt", async () => {
    const tournamentId = await createTournament([leaguePlayerId, freePlayerIds[0]], freeBoardIds);
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
    const queued = dashboard.queue[0];
    if (queued === undefined) throw new Error("Expected a queued match.");
    // Anzeige und Startpfad sehen dieselbe Belegt-Menge.
    expect(queued.readiness).toBe("BLOCKED_PLAYER_BUSY");

    await expect(
      service.assign({
        organizationId,
        tournamentId,
        data: {
          commandId: randomUUID(),
          expectedVersion: dashboard.tournament.version,
          matchId: queued.matchId,
          boardId: freeBoardIds[0],
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "TOURNAMENT_PLAYER_BUSY" } });
  });

  it("laesst dieselbe Person nicht in zwei Turnieren gleichzeitig starten", async () => {
    const pair = [freePlayerIds[0], freePlayerIds[1]] as const;
    const [firstTournamentId, secondTournamentId] = await Promise.all([
      createTournament(pair, freeBoardIds),
      createTournament(pair, freeBoardIds),
    ]);
    const [firstDashboard, secondDashboard] = await Promise.all([
      service.dashboard({ organizationId, tournamentId: firstTournamentId, auth }),
      service.dashboard({ organizationId, tournamentId: secondTournamentId, auth }),
    ]);
    const firstMatch = firstDashboard.queue[0];
    const secondMatch = secondDashboard.queue[0];
    if (firstMatch === undefined || secondMatch === undefined) {
      throw new Error("Expected a queued match in both tournaments.");
    }

    // Zwei Scheiben, zwei Turniere, dieselbe Paarung: nur die Personensperre
    // verhindert, dass beide Zuweisungen durchgehen.
    const outcomes = await Promise.allSettled([
      service.assign({
        organizationId,
        tournamentId: firstTournamentId,
        data: {
          commandId: randomUUID(),
          expectedVersion: firstDashboard.tournament.version,
          matchId: firstMatch.matchId,
          boardId: freeBoardIds[0],
        },
        auth,
        audit,
      }),
      service.assign({
        organizationId,
        tournamentId: secondTournamentId,
        data: {
          commandId: randomUUID(),
          expectedVersion: secondDashboard.tournament.version,
          matchId: secondMatch.matchId,
          boardId: freeBoardIds[1],
        },
        auth,
        audit,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({
      response: { code: "TOURNAMENT_PLAYER_BUSY" },
    });
  });

  /**
   * Befund I1: Zuweisung und Board-Freigabe pruefen das Duplikat nur vor der
   * Sperre. Zwei gleichzeitige Zustellungen desselben Kommandos verfehlen die
   * Kommandozeile beide; ohne zweite Pruefung unter der Sperre bekaeme die
   * zweite einen Versionskonflikt fuer ihr eigenes, angekommenes Kommando.
   */
  it("beantwortet dieselbe commandId auch gleichzeitig idempotent", async () => {
    // Eigene, frische Scheiben und Personen statt `freeBoardIds`/`freePlayerIds`:
    // die vorige Probe belegt genau eine Scheibe und eine Person dauerhaft
    // (die gewinnende Zuweisung wird nie freigegeben), und `assign` prueft
    // echte Belegung ueber `tournament_matches`, nicht nur `boards.status` —
    // ein blosses Zuruecksetzen des Status waere hier irrefuehrend.
    const idempotencyBoardIds = [randomUUID(), randomUUID()] as const;
    await databaseService.database.insert(boards).values(
      idempotencyBoardIds.map((id, index) => ({
        id,
        organizationId,
        name: `Idempotency Board ${index + 1}`,
      })),
    );
    const idempotencyPlayerIds = [randomUUID(), randomUUID()] as const;
    await databaseService.database.insert(players).values(
      idempotencyPlayerIds.map((id, index) => ({
        id,
        organizationId,
        displayName: `Idempotency Player ${index + 1}`,
        status: "ACTIVE",
      })),
    );

    const tournamentId = await createTournament(idempotencyPlayerIds, [...idempotencyBoardIds]);
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
    const ready = dashboard.queue[0];
    if (ready === undefined) throw new Error("Expected a queued match.");

    const assignCommandId = randomUUID();
    const assignInput = {
      organizationId,
      tournamentId,
      data: { commandId: assignCommandId, expectedVersion: dashboard.tournament.version, matchId: ready.matchId, boardId: idempotencyBoardIds[0] },
      auth,
      audit,
    } as const;
    const assigned = await Promise.all(Array.from({ length: 4 }, () => service.assign(assignInput)));
    expect(assigned.map((result) => result.tournament.version)).toEqual([
      dashboard.tournament.version + 1,
      dashboard.tournament.version + 1,
      dashboard.tournament.version + 1,
      dashboard.tournament.version + 1,
    ]);

    const releaseCommandId = randomUUID();
    const releaseInput = {
      organizationId,
      tournamentId,
      data: { commandId: releaseCommandId, expectedVersion: dashboard.tournament.version + 1, boardId: idempotencyBoardIds[1] },
      auth,
      audit,
    } as const;
    const released = await Promise.all(Array.from({ length: 4 }, () => service.releaseBoard(releaseInput)));
    expect(released.map((result) => result.tournament.version)).toEqual([
      dashboard.tournament.version + 2,
      dashboard.tournament.version + 2,
      dashboard.tournament.version + 2,
      dashboard.tournament.version + 2,
    ]);
  }, 30_000);
});
