import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  boardControllerLeases,
  boardDevices,
  boards,
  competitions,
  encounterSlots,
  encounters,
  legs,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  memberships,
  organizations,
  players,
  teams,
  tournamentMatches,
  users,
  visits,
} from "@darts-platform/database";
import { createBoardDeviceSecret, hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";

import type { AuthContext, DeviceAuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { createApiTestApplication } from "../testing/api-harness.js";
import { DisplayKeysRepository } from "../tournaments/display-keys.repository.js";
import { DisplayKeysService } from "../tournaments/display-keys.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const database = databaseService.database;
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const matchesRepository = new MatchesRepository(databaseService);
const matchesService = new MatchesService(matchesRepository, access);
const tournamentsRepository = new TournamentsRepository(databaseService);
const tournamentsService = new TournamentsService(
  tournamentsRepository,
  matchesRepository,
  access,
  new DisplayKeysService(new DisplayKeysRepository(databaseService), tournamentsRepository, access),
);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const ownerId = randomUUID();
/** Die Scheibe des Geraets. */
const boardId = randomUUID();
const otherBoardId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();
/** Person der Organisation, die an keinem Match der Geraetescheibe teilnimmt. */
const bystanderPlayerId = randomUUID();

const ownerAuth: AuthContext = {
  user: { id: ownerId, email: `device-scoring-${ownerId}@example.test`, name: "Device Scoring Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

let deviceId = "";
let deviceAuth: DeviceAuthContext;
let bearer: { readonly authorization: string };

function createFreeMatch(targetBoardId: string) {
  return matchesService.create({
    organizationId,
    data: { playerOneId, playerTwoId, boardId: targetBoardId, bestOfLegs: 1, bestOfSets: 1 },
    auth: ownerAuth,
    audit,
  });
}

/**
 * Baut einen laufenden Ligaslot auf der Scheibe des Geraets. Nachbildung dessen,
 * was `EncountersRepository.assignSlot` schreibt (Muster aus
 * `tournaments/board-occupancy.integration.spec.ts`, hier ergaenzt um
 * `legStartRule: "LEAGUE"` und die Zeile fuer Leg 1).
 */
async function startLeagueSlot(): Promise<string> {
  const competitionId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  const encounterId = randomUUID();
  await database.insert(competitions).values({
    id: competitionId,
    organizationId,
    type: "LEAGUE",
    name: `Device Liga ${competitionId}`,
    slug: `device-liga-${competitionId}`,
    status: "ACTIVE",
  });
  await database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId}` },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId}` },
  ]);
  await database.insert(encounters).values({
    id: encounterId,
    organizationId,
    competitionId,
    matchday: 1,
    homeTeamId,
    awayTeamId,
    scheduledAt: new Date("2026-09-30T19:00:00.000Z"),
    status: "RUNNING",
  });
  const [leagueMatch] = await database
    .insert(matches)
    .values({ organizationId, boardId, bestOfLegs: 1, startingSeat: 1, currentSeat: 1, legStartRule: "LEAGUE" })
    .returning();
  if (leagueMatch === undefined) throw new Error("Expected the league scoring match.");
  const participants = await database
    .insert(matchParticipants)
    .values([
      { organizationId, matchId: leagueMatch.id, seat: 1 },
      { organizationId, matchId: leagueMatch.id, seat: 2 },
    ])
    .returning();
  await database.insert(matchParticipantPlayers).values(
    participants.map((participant) => ({
      organizationId,
      matchId: leagueMatch.id,
      participantId: participant.id,
      playerId: participant.seat === 1 ? playerOneId : playerTwoId,
      position: 1,
    })),
  );
  await database.insert(legs).values({ organizationId, matchId: leagueMatch.id, legNumber: 1, startingSeat: 1 });
  await database.insert(encounterSlots).values({
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
    boardId,
    matchId: leagueMatch.id,
  });
  await database.update(boards).set({ status: "IN_USE" }).where(eq(boards.id, boardId));
  return leagueMatch.id;
}

/** Ein Turnier mit genau einer Paarung, gestartet auf der Scheibe des Geraets. */
async function startTournamentMatchOnDeviceBoard(): Promise<string> {
  const created = await tournamentsService.create({
    organizationId,
    data: {
      name: `Device Cup ${randomUUID()}`,
      startsAt: new Date("2026-09-30T10:00:00.000Z"),
      format: "SINGLE_ELIMINATION",
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      maxRounds: null,
      bestOfLegs: 1,
      bestOfSets: 1,
      participantIds: [playerOneId, playerTwoId],
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 2,
      seeding: "SEEDED",
      boardIds: [boardId],
    },
    auth: ownerAuth,
    audit,
  });
  const dashboard = await tournamentsService.dashboard({ organizationId, tournamentId: created.id, auth: ownerAuth });
  const ready = dashboard.queue[0];
  if (ready === undefined) throw new Error("Expected a queued tournament match.");
  await tournamentsService.assign({
    organizationId,
    tournamentId: created.id,
    data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: ready.matchId, boardId },
    auth: ownerAuth,
    audit,
  });
  // `assign` liefert das Dashboard; die Scoring-ID steht dort bewusst nicht
  // (`boardSlotMatchSchema`), sie wird aus der Turnierpaarung gelesen.
  const [scheduled] = await database
    .select({ scoringMatchId: tournamentMatches.scoringMatchId })
    .from(tournamentMatches)
    .where(eq(tournamentMatches.id, ready.matchId));
  if (scheduled?.scoringMatchId == null) throw new Error("Expected a scoring match for the tournament match.");
  return scheduled.scoringMatchId;
}

beforeAll(async () => {
  await database.insert(users).values({ id: ownerId, email: ownerAuth.user.email, displayName: ownerAuth.user.name });
  await database.insert(organizations).values({
    id: organizationId,
    name: "Device Scoring Club",
    slug: `device-scoring-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await database.insert(memberships).values({ organizationId, userId: ownerId, role: "OWNER", status: "ACTIVE" });
  await database.insert(boards).values([
    { id: boardId, organizationId, name: "Scheibe 1" },
    { id: otherBoardId, organizationId, name: "Scheibe 2" },
  ]);
  await database.insert(players).values([
    { id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" },
    { id: playerTwoId, organizationId, displayName: "Player Two", status: "ACTIVE" },
    { id: bystanderPlayerId, organizationId, displayName: "Bystander Player", status: "ACTIVE" },
  ]);
  const secret = createBoardDeviceSecret();
  const [device] = await database
    .insert(boardDevices)
    .values({ organizationId, boardId, secretHash: hashBoardDeviceSecret(secret), label: "iPad Scoring", createdBy: ownerId })
    .returning();
  if (device === undefined) throw new Error("Das Testgeraet wurde nicht angelegt.");
  deviceId = device.id;
  deviceAuth = { device: { id: deviceId, organizationId, boardId } };
  bearer = { authorization: `Bearer ${secret}` };
});

/**
 * Die Tests teilen sich die Scheibe des Geraets. Ein laufendes Match bliebe
 * dort stehen und blockierte den naechsten Test; deshalb bricht die Leitung
 * nach jedem Test alles ab, was noch laeuft. Die Leases fallen vorher weg,
 * damit der Abbruch nicht an der Steuerung des Geraets scheitert.
 */
afterEach(async () => {
  await database.delete(boardControllerLeases).where(eq(boardControllerLeases.organizationId, organizationId));
  const running = await database
    .select({ id: matches.id, version: matches.version })
    .from(matches)
    .where(and(eq(matches.organizationId, organizationId), eq(matches.status, "IN_PROGRESS")));
  for (const match of running) {
    await matchesService.abort({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, reason: "Testaufraeumen" },
      auth: ownerAuth,
      audit,
    });
  }
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await database.delete(users).where(eq(users.id, ownerId));
  await databaseService.onApplicationShutdown();
});

describe("Scoren durch ein Scheiben-Tablet", () => {
  it("scort, nimmt zurück und entscheidet den Anwurf im freien Match der eigenen Scheibe", async () => {
    const match = await createFreeMatch(boardId);
    const controllerId = randomUUID();
    const lease = await matchesService.acquireControllerLease({ organizationId, matchId: match.id, controllerId, force: false, auth: deviceAuth, audit });
    expect(lease.owned).toBe(true);
    // Ein freies Match beginnt mit BULL_FIRST_LEG: der Anwurf wird zuerst entschieden.
    expect(match.legStartPending).toBe(true);
    const started = await matchesService.decideLegStart({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, legNumber: 1, startingSeat: 1, controllerId },
      auth: deviceAuth,
      audit,
    });
    expect(started.legStartPending).toBe(false);
    const scored = await matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: started.version, playerId: playerOneId, points: 60, dartsThrown: 3, controllerId },
      auth: deviceAuth,
      audit,
    });
    expect(scored.version).toBe(started.version + 1);
    const undone = await matchesService.undo({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: scored.version, controllerId },
      auth: deviceAuth,
      audit,
    });
    expect(undone.version).toBe(scored.version + 1);

    const read = await matchesService.get({ organizationId, matchId: match.id, auth: deviceAuth });
    expect(read.version).toBe(undone.version);

    const recorded = await database.select().from(auditEvents).where(and(eq(auditEvents.entityId, match.id), eq(auditEvents.action, "SCORE_VISIT_RECORDED")));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ actorUserId: null, actorDeviceId: deviceId });
    const decided = await database.select().from(auditEvents).where(and(eq(auditEvents.entityId, match.id), eq(auditEvents.action, "DECIDE_LEG_START")));
    expect(decided[0]).toMatchObject({ actorUserId: null, actorDeviceId: deviceId });
    const acquired = await database.select().from(auditEvents).where(and(eq(auditEvents.entityId, match.id), eq(auditEvents.action, "BOARD_CONTROLLER_ACQUIRED")));
    expect(acquired[0]).toMatchObject({ actorUserId: null, actorDeviceId: deviceId });
    const [reverted] = await database.select().from(auditEvents).where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "SCORE_VISIT_REVERTED"), eq(auditEvents.actorDeviceId, deviceId)));
    expect(reverted).toMatchObject({ actorUserId: null, actorDeviceId: deviceId });
    const [leaseRow] = await database.select().from(boardControllerLeases).where(eq(boardControllerLeases.matchId, match.id));
    expect(leaseRow).toMatchObject({ userId: null, deviceId });
  }, 30_000);

  it("erzeugt mit gleicher commandId keinen zweiten Visit", async () => {
    const match = await createFreeMatch(boardId);
    const started = await matchesService.decideLegStart({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, legNumber: 1, startingSeat: 1 },
      auth: deviceAuth,
      audit,
    });
    const input = {
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: started.version, playerId: playerOneId, points: 45, dartsThrown: 3 as const },
      auth: deviceAuth,
      audit,
    };
    const first = await matchesService.submitVisit(input);
    const second = await matchesService.submitVisit(input);

    expect(second.version).toBe(first.version);
    const recorded = await database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, match.id)));
    expect(recorded).toHaveLength(1);
  }, 30_000);

  it("lehnt ein Match einer anderen Scheibe ab", async () => {
    const foreign = await createFreeMatch(otherBoardId);
    const mismatch = { status: 403, response: { code: "DEVICE_BOARD_MISMATCH" } };

    await expect(matchesService.get({ organizationId, matchId: foreign.id, auth: deviceAuth })).rejects.toMatchObject(mismatch);
    await expect(matchesService.submitVisit({
      organizationId,
      matchId: foreign.id,
      data: { commandId: randomUUID(), expectedVersion: foreign.version, playerId: playerOneId, points: 60, dartsThrown: 3 },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(mismatch);
    await expect(matchesService.undo({
      organizationId,
      matchId: foreign.id,
      data: { commandId: randomUUID(), expectedVersion: foreign.version },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(mismatch);
    await expect(matchesService.decideLegStart({
      organizationId,
      matchId: foreign.id,
      data: { commandId: randomUUID(), expectedVersion: foreign.version, legNumber: 1, startingSeat: 1 },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(mismatch);
    await expect(matchesService.decideLegByBull({
      organizationId,
      matchId: foreign.id,
      data: { commandId: randomUUID(), expectedVersion: foreign.version, winnerSeat: 1 },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(mismatch);
    await expect(matchesService.acquireControllerLease({
      organizationId,
      matchId: foreign.id,
      controllerId: randomUUID(),
      force: false,
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(mismatch);

    const [unchanged] = await database.select({ version: matches.version }).from(matches).where(eq(matches.id, foreign.id));
    expect(unchanged?.version).toBe(foreign.version);
    const leases = await database.select().from(boardControllerLeases).where(eq(boardControllerLeases.matchId, foreign.id));
    expect(leases).toHaveLength(0);
  }, 30_000);

  it("lehnt eine fremde Organisation mit 404 ab", async () => {
    const match = await createFreeMatch(boardId);

    await expect(matchesService.get({ organizationId: foreignOrganizationId, matchId: match.id, auth: deviceAuth })).rejects.toMatchObject({ status: 404 });
    await expect(matchesService.submitVisit({
      organizationId: foreignOrganizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, playerId: playerOneId, points: 60, dartsThrown: 3 },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  it("lehnt Scoren und Undo in einem beendeten Match mit DEVICE_MATCH_NOT_ACTIVE ab", async () => {
    const match = await createFreeMatch(boardId);
    // `startingScore` ist kein Feld von `CreateMatchInput`; das Aggregat liest
    // den Wert aus der Zeile (Check >= 2).
    await database.update(matches).set({ startingScore: 2 }).where(eq(matches.id, match.id));
    const started = await matchesService.decideLegStart({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: match.version, legNumber: 1, startingSeat: 1 },
      auth: deviceAuth,
      audit,
    });
    const finished = await matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: started.version, playerId: playerOneId, points: 2, dartsThrown: 1, checkoutDouble: 1 },
      auth: deviceAuth,
      audit,
    });
    expect(finished.status).toBe("COMPLETED");
    const notActive = { status: 409, response: { code: "DEVICE_MATCH_NOT_ACTIVE" } };

    await expect(matchesService.submitVisit({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: finished.version, playerId: playerTwoId, points: 2, dartsThrown: 1, checkoutDouble: 1 },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(notActive);
    await expect(matchesService.undo({
      organizationId,
      matchId: match.id,
      data: { commandId: randomUUID(), expectedVersion: finished.version },
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(notActive);
    await expect(matchesService.acquireControllerLease({
      organizationId,
      matchId: match.id,
      controllerId: randomUUID(),
      force: false,
      auth: deviceAuth,
      audit,
    })).rejects.toMatchObject(notActive);

    // Lesen bleibt erlaubt, und das Match steht weiter auf COMPLETED.
    const read = await matchesService.get({ organizationId, matchId: match.id, auth: deviceAuth });
    expect(read).toMatchObject({ status: "COMPLETED", version: finished.version });
  }, 30_000);

  it("gibt bei wiederholter commandId eines fremden Scheiben-Matches keinen Zustand heraus", async () => {
    const foreign = await createFreeMatch(otherBoardId);
    const started = await matchesService.decideLegStart({
      organizationId,
      matchId: foreign.id,
      data: { commandId: randomUUID(), expectedVersion: foreign.version, legNumber: 1, startingSeat: 1 },
      auth: ownerAuth,
      audit,
    });
    const commandId = randomUUID();
    const data = { commandId, expectedVersion: started.version, playerId: playerOneId, points: 60, dartsThrown: 3 as const };
    await matchesService.submitVisit({ organizationId, matchId: foreign.id, data, auth: ownerAuth, audit });

    await expect(matchesService.submitVisit({ organizationId, matchId: foreign.id, data, auth: deviceAuth, audit }))
      .rejects.toMatchObject({ status: 403, response: { code: "DEVICE_BOARD_MISMATCH" } });
  }, 30_000);

  it("scort ein Turniermatch auf der zugewiesenen Scheibe", async () => {
    const scoringMatchId = await startTournamentMatchOnDeviceBoard();
    const state = await matchesService.get({ organizationId, matchId: scoringMatchId, auth: deviceAuth });
    expect(state.legStartPending).toBe(true);

    const started = await matchesService.decideLegStart({
      organizationId,
      matchId: scoringMatchId,
      data: { commandId: randomUUID(), expectedVersion: state.version, legNumber: 1, startingSeat: 1 },
      auth: deviceAuth,
      audit,
    });
    const scored = await matchesService.submitVisit({
      organizationId,
      matchId: scoringMatchId,
      data: { commandId: randomUUID(), expectedVersion: started.version, playerId: playerOneId, points: 100, dartsThrown: 3 },
      auth: deviceAuth,
      audit,
    });

    expect(scored.version).toBe(started.version + 1);
  }, 30_000);

  it("scort einen Liga-Slot auf der zugewiesenen Scheibe", async () => {
    const leagueMatchId = await startLeagueSlot();
    const state = await matchesService.get({ organizationId, matchId: leagueMatchId, auth: deviceAuth });
    // Liga (LEAGUE) braucht in Leg 1 keinen Entscheid.
    expect(state.legStartPending).toBe(false);

    const scored = await matchesService.submitVisit({
      organizationId,
      matchId: leagueMatchId,
      data: { commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId, points: 81, dartsThrown: 3 },
      auth: deviceAuth,
      audit,
    });

    expect(scored.version).toBe(state.version + 1);
  }, 30_000);
});

describe("Match-Routen über HTTP mit Geräteschlüssel", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("verbietet dem Gerät Abbrechen und Anlegen", async () => {
    const match = await createFreeMatch(boardId);

    const abort = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/matches/${match.id}/abort`,
      headers: bearer,
      payload: { commandId: randomUUID(), expectedVersion: match.version, controllerId: randomUUID(), reason: "Geraet" },
    });
    expect(abort.statusCode).toBe(403);
    expect(abort.json().error.code).toBe("DEVICE_NOT_ALLOWED");

    const create = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/matches`,
      headers: bearer,
      payload: { playerOneId, playerTwoId, boardId, bestOfLegs: 1, bestOfSets: 1 },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe("DEVICE_NOT_ALLOWED");

    const [unchanged] = await database.select({ status: matches.status }).from(matches).where(eq(matches.id, match.id));
    expect(unchanged?.status).toBe("IN_PROGRESS");
  }, 30_000);

  it("liest das Match der eigenen Scheibe über HTTP", async () => {
    const match = await createFreeMatch(boardId);

    const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/matches/${match.id}`, headers: bearer });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(match.id);
  }, 30_000);

  it("lehnt das Match einer anderen Scheibe über HTTP mit DEVICE_BOARD_MISMATCH ab", async () => {
    const foreign = await createFreeMatch(otherBoardId);

    const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/matches/${foreign.id}`, headers: bearer });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_BOARD_MISMATCH");
  }, 30_000);
});

describe("Schnellwerte am Tablet", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiTestApplication();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("liefert Schnellwerte für eine Person im laufenden Match der Scheibe", async () => {
    await createFreeMatch(boardId);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/players/${playerOneId}/statistics/frequent-scores`,
      headers: bearer,
    });

    expect(response.statusCode).toBe(200);
  }, 30_000);

  it("verweigert Schnellwerte für eine Person, die nicht an der Scheibe spielt", async () => {
    await createFreeMatch(boardId);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/players/${bystanderPlayerId}/statistics/frequent-scores`,
      headers: bearer,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_BOARD_MISMATCH");
  }, 30_000);

  it("verweigert das Statistikprofil", async () => {
    await createFreeMatch(boardId);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/players/${playerOneId}/statistics`,
      headers: bearer,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_NOT_ALLOWED");
  }, 30_000);
});
