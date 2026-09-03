import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  boards,
  encounterCommands,
  encounterNominations,
  encounterSlots,
  memberships,
  organizations,
  outboxEvents,
  players,
  teamPlayers,
  teams,
  users,
} from "@darts-platform/database";
import type {
  CompetitionSlotInput,
  EncounterDetail,
  EncounterSide,
} from "@darts-platform/schemas";
import {
  legs as legsTable,
  matches as matchesTable,
  scoreCommands,
  tournamentMatches,
  tournaments as tournamentsTable,
} from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { CompetitionsRepository } from "../competitions/competitions.repository.js";
import { CompetitionsService } from "../competitions/competitions.service.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { TeamsRepository } from "../teams/teams.repository.js";
import { TeamsService } from "../teams/teams.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";
import { publishOutboxBatch } from "../realtime/publish-outbox.js";
import { EncountersRepository } from "./encounters.repository.js";
import { EncountersService } from "./encounters.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const competitionsService = new CompetitionsService(
  new CompetitionsRepository(databaseService),
  access,
);
const encountersService = new EncountersService(new EncountersRepository(databaseService), access);
const teamsService = new TeamsService(new TeamsRepository(databaseService), access);
const matchesRepository = new MatchesRepository(databaseService);
const matchesService = new MatchesService(matchesRepository, access);
const tournamentsService = new TournamentsService(
  new TournamentsRepository(databaseService),
  matchesRepository,
  access,
);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const foreignUserId = randomUUID();
const homePlayerIds = Array.from({ length: 6 }, () => randomUUID());
const awayPlayerIds = Array.from({ length: 6 }, () => randomUUID());
const guestPlayerId = randomUUID();
const boardIds = [randomUUID(), randomUUID()];
const homeTeamId = randomUUID();
const awayTeamId = randomUUID();
const squadValidFrom = new Date("2020-01-01T00:00:00.000Z");

const auth: AuthContext = {
  user: { id: userId, email: `league-${userId}@example.test`, name: "League Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const foreignAuth: AuthContext = {
  user: { id: foreignUserId, email: `foreign-${foreignUserId}@example.test`, name: "Foreign Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

/**
 * Die Vorlage des Reglements: sechzehn Einzel als vollständiges Rundenturnier
 * über vier Aufstellungspositionen, zwei Doppel und ein Entscheidungsdoppel.
 * Die Distanz ist auf ein Leg gekürzt, damit ein vollständiger Spielabend im
 * Test in vertretbarer Zeit läuft; die Wertungslogik ist davon unberührt.
 */
function template(
  legsToWinSet: number,
  overrides: { readonly outRule?: "SINGLE" | "DOUBLE"; readonly maxRounds?: number | null } = {},
): CompetitionSlotInput[] {
  const slots: CompetitionSlotInput[] = [];
  const distance = {
    startingScore: 301 as const,
    inRule: "STRAIGHT" as const,
    outRule: overrides.outRule ?? ("SINGLE" as const),
    maxRounds: overrides.maxRounds ?? null,
    bestOfLegs: legsToWinSet * 2 - 1,
    legsToWinSet,
    setsToWin: 1,
  };
  let sequence = 1;
  for (let home = 1; home <= 4; home += 1) {
    for (let away = 1; away <= 4; away += 1) {
      slots.push({
        sequence,
        role: "REGULAR",
        discipline: "SINGLES",
        label: `Einzel ${home} gegen ${away}`,
        homePosition: home,
        awayPosition: away,
        ...distance,
      });
      sequence += 1;
    }
  }
  for (const label of ["Doppel 1", "Doppel 2"]) {
    slots.push({
      sequence,
      role: "REGULAR",
      discipline: "DOUBLES",
      label,
      homePosition: null,
      awayPosition: null,
      ...distance,
    });
    sequence += 1;
  }
  slots.push({
    sequence,
    role: "DECIDER",
    discipline: "DOUBLES",
    label: "Entscheidungsdoppel",
    homePosition: null,
    awayPosition: null,
    ...distance,
  });
  return slots;
}

async function createCompetition(
  legsToWinSet = 1,
  overrides: { readonly outRule?: "SINGLE" | "DOUBLE"; readonly maxRounds?: number | null } = {},
): Promise<string> {
  const competition = await competitionsService.create({
    organizationId,
    data: {
      type: "LEAGUE",
      name: `Nationalliga ${randomUUID().slice(0, 8)}`,
      slug: `liga-${randomUUID()}`,
      status: "ACTIVE",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsDeciderBonus: 1,
      deciderRule: "EXTRA_SLOT",
      lineupPositions: 4,
      minNominations: 4,
      minNominationsShorthanded: 3,
      maxSubstitutionsPerEncounter: 4,
      maxDoublesPerPlayer: 1,
      slots: template(legsToWinSet, overrides),
    },
    auth,
    audit,
  });
  return competition.id;
}

async function scheduleEncounter(competitionId: string): Promise<EncounterDetail> {
  return encountersService.schedule({
    organizationId,
    competitionId,
    data: {
      matchday: 1,
      homeTeamId,
      awayTeamId,
      scheduledAt: new Date("2026-09-11T19:30:00.000Z"),
      venue: "Clublokal",
    },
    auth,
    audit,
  });
}

async function nominate(
  encounter: EncounterDetail,
  side: EncounterSide,
  positions: readonly string[],
  substitutes: readonly string[] = [],
): Promise<EncounterDetail> {
  return encountersService.submitNominations({
    organizationId,
    encounterId: encounter.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: encounter.version,
      side,
      nominations: [
        ...positions.map((playerId, index) => ({
          position: index + 1,
          playerId,
          origin: "SQUAD" as const,
        })),
        ...substitutes.map((playerId) => ({
          position: null,
          playerId,
          origin: "SQUAD" as const,
        })),
      ],
    },
    auth,
    audit,
  });
}

async function submitDoubles(
  encounter: EncounterDetail,
  side: EncounterSide,
  pairings: readonly { readonly sequence: number; readonly playerIds: readonly [string, string] }[],
): Promise<EncounterDetail> {
  return encountersService.submitDoubles({
    organizationId,
    encounterId: encounter.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: encounter.version,
      side,
      pairings: pairings.map((pairing) => ({
        sequence: pairing.sequence,
        playerIds: [...pairing.playerIds],
      })),
    },
    auth,
    audit,
  });
}

/** Spielt einen zugewiesenen Slot bis zum Sieg der gewünschten Seite aus. */
async function playAssignedSlot(matchId: string, winnerSide: EncounterSide): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const state = await matchesService.get({ organizationId, matchId, auth });
    if (state.status === "COMPLETED") return;
    const active = state.participants.find((participant) => participant.isActive);
    const thrower = active?.players.find((player) => player.isThrowing);
    if (active === undefined || thrower === undefined) throw new Error("Expected an active thrower.");
    const winnerIsThrowing = (active.seat === 1) === (winnerSide === "HOME");
    const points = winnerIsThrowing
      ? Math.min(active.remaining, 180)
      : active.remaining <= 180
        ? 1
        : 180;
    await matchesService.submitVisit({
      organizationId,
      matchId,
      data: {
        commandId: randomUUID(),
        expectedVersion: state.version,
        playerId: thrower.playerId,
        points,
        dartsThrown: 3,
      },
      auth,
      audit,
    });
  }
  throw new Error("The slot did not finish within the expected number of visits.");
}

async function playSlot(
  encounter: EncounterDetail,
  sequence: number,
  boardId: string,
  winnerSide: EncounterSide,
): Promise<EncounterDetail> {
  const slot = encounter.slots.find((entry) => entry.sequence === sequence);
  if (slot === undefined) throw new Error(`Slot ${sequence} is missing.`);
  const assigned = await encountersService.assignSlot({
    organizationId,
    encounterId: encounter.id,
    slotId: slot.id,
    data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId },
    auth,
    audit,
  });
  const matchId = assigned.slots.find((entry) => entry.sequence === sequence)?.matchId;
  if (matchId === null || matchId === undefined) throw new Error("Expected a scoring match.");
  await playAssignedSlot(matchId, winnerSide);
  return encountersService.get({ organizationId, encounterId: encounter.id, auth });
}

async function walkover(
  encounter: EncounterDetail,
  sequence: number,
  winnerSide: EncounterSide,
): Promise<EncounterDetail> {
  const slot = encounter.slots.find((entry) => entry.sequence === sequence);
  if (slot === undefined) throw new Error(`Slot ${sequence} is missing.`);
  return encountersService.declareSlotWalkover({
    organizationId,
    encounterId: encounter.id,
    slotId: slot.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: encounter.version,
      winnerSide,
      reason: "Nicht an der Abwurflinie erschienen.",
    },
    auth,
    audit,
  });
}

async function openEncounter(competitionId: string): Promise<EncounterDetail> {
  let encounter = await scheduleEncounter(competitionId);
  encounter = await nominate(encounter, "HOME", homePlayerIds.slice(0, 4), [homePlayerIds[4]!]);
  encounter = await nominate(encounter, "AWAY", awayPlayerIds.slice(0, 4), [awayPlayerIds[4]!]);
  return encountersService.start({
    organizationId,
    encounterId: encounter.id,
    data: { commandId: randomUUID(), expectedVersion: encounter.version },
    auth,
    audit,
  });
}

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: foreignUserId, email: foreignAuth.user.email, displayName: foreignAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "League Club", slug: `league-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign League Club", slug: `foreign-league-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId: foreignOrganizationId, userId: foreignUserId, role: "OWNER", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(players).values([
    ...homePlayerIds.map((id, index) => ({ id, organizationId, displayName: `Heim ${index + 1}`, status: "ACTIVE" })),
    ...awayPlayerIds.map((id, index) => ({ id, organizationId, displayName: `Gast ${index + 1}`, status: "ACTIVE" })),
    { id: guestPlayerId, organizationId, displayName: "Aushilfe", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(boards).values(
    boardIds.map((id, index) => ({ id, organizationId, name: `League Board ${index + 1}` })),
  );
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId.slice(0, 8)}`, status: "ACTIVE" },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId.slice(0, 8)}`, status: "ACTIVE" },
  ]);
  await databaseService.database.insert(teamPlayers).values([
    ...homePlayerIds.map((playerId) => ({ organizationId, teamId: homeTeamId, playerId, role: "PLAYER", validFrom: squadValidFrom })),
    ...awayPlayerIds.map((playerId) => ({ organizationId, teamId: awayTeamId, playerId, role: "PLAYER", validFrom: squadValidFrom })),
  ]);
});

/**
 * Die Tests teilen sich Boards und Personen. Was ein Test laufen lässt, darf
 * den nächsten nicht als „spielt bereits" blockieren.
 */
afterEach(async () => {
  await databaseService.database
    .update(encounterSlots)
    .set({ status: "CANCELLED", boardId: null, matchId: null })
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.status, "IN_PROGRESS"),
      ),
    );
  await databaseService.database
    .update(tournamentMatches)
    .set({ status: "CANCELLED", boardId: null, scoringMatchId: null })
    .where(
      and(
        eq(tournamentMatches.organizationId, organizationId),
        eq(tournamentMatches.status, "IN_PROGRESS"),
      ),
    );
  await databaseService.database
    .update(matchesTable)
    .set({ status: "ABORTED", boardId: null, currentSeat: null })
    .where(
      and(eq(matchesTable.organizationId, organizationId), eq(matchesTable.status, "IN_PROGRESS")),
    );
  await databaseService.database
    .update(boards)
    .set({ status: "AVAILABLE" })
    .where(eq(boards.organizationId, organizationId));
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, foreignUserId));
  await databaseService.onApplicationShutdown();
});

describe("team encounter persistence", () => {
  it("plays a whole encounter over eighteen slots to a result", async () => {
    const competitionId = await createCompetition();
    let encounter = await openEncounter(competitionId);
    expect(encounter.status).toBe("RUNNING");
    expect(encounter.slots).toHaveLength(19);
    expect(encounter.slots.filter((slot) => slot.status === "WAITING")).toHaveLength(19);

    // Die Doppelpaarungen entstehen erst am Abend (Reglement 2.2.1).
    encounter = await submitDoubles(encounter, "HOME", [
      { sequence: 17, playerIds: [homePlayerIds[0]!, homePlayerIds[1]!] },
      { sequence: 18, playerIds: [homePlayerIds[2]!, homePlayerIds[3]!] },
    ]);
    encounter = await submitDoubles(encounter, "AWAY", [
      { sequence: 17, playerIds: [awayPlayerIds[0]!, awayPlayerIds[1]!] },
      { sequence: 18, playerIds: [awayPlayerIds[2]!, awayPlayerIds[3]!] },
    ]);

    for (let sequence = 1; sequence <= 18; sequence += 1) {
      encounter = await playSlot(encounter, sequence, boardIds[sequence % 2]!, "HOME");
    }

    expect(encounter.status).toBe("COMPLETED");
    expect(encounter.result).toBe("HOME_WIN");
    expect(encounter.resultType).toBe("PLAYED");
    expect(encounter.homeGames).toBe(18);
    expect(encounter.awayGames).toBe(0);
    expect(encounter.homeLegs).toBe(18);
    expect(encounter.homePoints).toBe(3);
    expect(encounter.awayPoints).toBe(0);
    // Ein nicht gebrauchtes Entscheidungsdoppel zählt in keiner Wertung mit.
    expect(encounter.slots.find((slot) => slot.role === "DECIDER")?.status).toBe("CANCELLED");
    expect(encounter.decider.required).toBe(false);

    const events = await databaseService.database
      .select({ eventType: outboxEvents.eventType })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, organizationId),
          eq(outboxEvents.aggregateId, encounter.id),
        ),
      );
    const types = events.map((event) => event.eventType);
    expect(types).toContain("ENCOUNTER_STARTED");
    expect(types).toContain("ENCOUNTER_SLOT_ASSIGNED");
    expect(types).toContain("ENCOUNTER_SLOT_COMPLETED");
    expect(types).toContain("ENCOUNTER_COMPLETED");
    expect(events.filter((event) => event.eventType === "ENCOUNTER_COMPLETED")).toHaveLength(1);

    const freed = await databaseService.database
      .select({ status: boards.status })
      .from(boards)
      .where(eq(boards.organizationId, organizationId));
    expect(freed.every((board) => board.status === "AVAILABLE")).toBe(true);

    // Die öffentliche Ansicht trägt den Stand, aber keine Meldungen.
    const live = await encountersService.publicView(encounter.publicId);
    expect(live).toMatchObject({
      status: "COMPLETED",
      result: "HOME_WIN",
      homeGames: 18,
      awayGames: 0,
    });
    expect(live.slots).toHaveLength(19);
    expect(Object.keys(live)).not.toContain("home");
  }, 180_000);

  it("awards the decider bonus after nine games each", async () => {
    const competitionId = await createCompetition();
    let encounter = await openEncounter(competitionId);
    for (let sequence = 1; sequence <= 9; sequence += 1) {
      encounter = await walkover(encounter, sequence, "HOME");
    }
    for (let sequence = 10; sequence <= 18; sequence += 1) {
      encounter = await walkover(encounter, sequence, "AWAY");
    }
    expect(encounter.status).toBe("RUNNING");
    expect(encounter.homeGames).toBe(9);
    expect(encounter.awayGames).toBe(9);
    expect(encounter.decider).toMatchObject({ status: "REQUIRED", required: true, slotSequence: 19 });

    encounter = await submitDoubles(encounter, "HOME", [
      { sequence: 19, playerIds: [homePlayerIds[0]!, homePlayerIds[1]!] },
    ]);
    encounter = await submitDoubles(encounter, "AWAY", [
      { sequence: 19, playerIds: [awayPlayerIds[0]!, awayPlayerIds[1]!] },
    ]);
    encounter = await playSlot(encounter, 19, boardIds[0]!, "HOME");

    expect(encounter.status).toBe("COMPLETED");
    expect(encounter.result).toBe("HOME_WIN");
    expect(encounter.resultType).toBe("DECIDER");
    expect(encounter.homeGames).toBe(10);
    expect(encounter.awayGames).toBe(9);
    expect(encounter.homePoints).toBe(2);
    expect(encounter.awayPoints).toBe(1);
  }, 60_000);

  it("rejects a stale nomination and keeps the stored one", async () => {
    const competitionId = await createCompetition();
    const encounter = await scheduleEncounter(competitionId);
    const stale = encounter.version;
    const updated = await nominate(encounter, "HOME", homePlayerIds.slice(0, 4));
    expect(updated.version).toBe(stale + 1);

    await expect(
      encountersService.submitNominations({
        organizationId,
        encounterId: encounter.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: stale,
          side: "AWAY",
          nominations: awayPlayerIds.slice(0, 4).map((playerId, index) => ({
            position: index + 1,
            playerId,
            origin: "SQUAD" as const,
          })),
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "ENCOUNTER_VERSION_CONFLICT" } });

    const stored = await databaseService.database
      .select({ side: encounterNominations.side })
      .from(encounterNominations)
      .where(eq(encounterNominations.encounterId, encounter.id));
    expect(stored.every((row) => row.side === "HOME")).toBe(true);
  }, 30_000);

  it("ignores a repeated commandId instead of applying it twice", async () => {
    const competitionId = await createCompetition();
    const encounter = await scheduleEncounter(competitionId);
    const commandId = randomUUID();
    const payload = {
      commandId,
      expectedVersion: encounter.version,
      side: "HOME" as const,
      nominations: homePlayerIds.slice(0, 4).map((playerId, index) => ({
        position: index + 1,
        playerId,
        origin: "SQUAD" as const,
      })),
    };
    const first = await encountersService.submitNominations({
      organizationId,
      encounterId: encounter.id,
      data: payload,
      auth,
      audit,
    });
    const second = await encountersService.submitNominations({
      organizationId,
      encounterId: encounter.id,
      data: payload,
      auth,
      audit,
    });
    expect(second.version).toBe(first.version);
    const commands = await databaseService.database
      .select({ commandId: encounterCommands.commandId })
      .from(encounterCommands)
      .where(eq(encounterCommands.encounterId, encounter.id));
    expect(commands).toHaveLength(1);
  }, 30_000);

  it("refuses a commandId that already belongs to a different command", async () => {
    const competitionId = await createCompetition();
    const encounter = await scheduleEncounter(competitionId);
    const commandId = randomUUID();
    await encountersService.submitNominations({
      organizationId,
      encounterId: encounter.id,
      data: {
        commandId,
        expectedVersion: encounter.version,
        side: "HOME",
        nominations: homePlayerIds.slice(0, 4).map((playerId, index) => ({
          position: index + 1,
          playerId,
          origin: "SQUAD" as const,
        })),
      },
      auth,
      audit,
    });
    const stored = await encountersService.get({ organizationId, encounterId: encounter.id, auth });

    // Andere Mutation, dieselbe commandId: still "ok" zu quittieren hiesse,
    // dem Aufrufer einen Abbruch zu bestaetigen, der nie stattgefunden hat.
    await expect(
      encountersService.cancel({
        organizationId,
        encounterId: encounter.id,
        data: {
          commandId,
          expectedVersion: stored.version,
          reason: "Halle nicht verfuegbar.",
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "COMMAND_ID_ALREADY_USED" } });

    // Dieselbe Mutation mit anderer Nutzlast faellt genauso durch.
    await expect(
      encountersService.submitNominations({
        organizationId,
        encounterId: encounter.id,
        data: {
          commandId,
          expectedVersion: stored.version,
          side: "HOME",
          nominations: homePlayerIds.slice(0, 3).map((playerId, index) => ({
            position: index + 1,
            playerId,
            origin: "SQUAD" as const,
          })),
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "COMMAND_ID_ALREADY_USED" } });

    const after = await encountersService.get({ organizationId, encounterId: encounter.id, auth });
    expect(after.status).toBe(stored.status);
    expect(after.version).toBe(stored.version);
  }, 30_000);

  it("scores a slot walkover and a whole forfeit by the book", async () => {
    const walkoverCompetition = await createCompetition();
    let encounter = await openEncounter(walkoverCompetition);
    encounter = await walkover(encounter, 3, "AWAY");
    const slot = encounter.slots.find((entry) => entry.sequence === 3);
    expect(slot).toMatchObject({ status: "WALKOVER", winnerSide: "AWAY", resultType: "WALKOVER", homeLegs: 0, awayLegs: 1 });
    expect(encounter.awayGames).toBe(1);

    // Nichtantritt: 0:3 Punkte, 0:18 Spiele, 0:36 Legs bei zwei Gewinnlegs.
    const forfeitCompetition = await createCompetition(2);
    const scheduled = await scheduleEncounter(forfeitCompetition);
    const forfeited = await encountersService.declareForfeit({
      organizationId,
      encounterId: scheduled.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: scheduled.version,
        forfeitSide: "AWAY",
        reason: "Mannschaft nicht angetreten.",
      },
      auth,
      audit,
    });
    expect(forfeited.status).toBe("COMPLETED");
    expect(forfeited.resultType).toBe("FORFEIT");
    expect(forfeited.result).toBe("HOME_WIN");
    expect(forfeited.homePoints).toBe(3);
    expect(forfeited.awayPoints).toBe(0);
    expect(forfeited.homeGames).toBe(18);
    expect(forfeited.awayGames).toBe(0);
    expect(forfeited.homeLegs).toBe(36);
    expect(forfeited.awayLegs).toBe(0);
    expect(forfeited.slots.every((entry) => entry.status === "CANCELLED")).toBe(true);
  }, 60_000);

  it("keeps a played slot untouched when a later position is substituted", async () => {
    const competitionId = await createCompetition();
    let encounter = await openEncounter(competitionId);
    encounter = await playSlot(encounter, 1, boardIds[0]!, "HOME");
    const playedBefore = encounter.slots.find((entry) => entry.sequence === 1)?.home.players[0]?.playerId;
    expect(playedBefore).toBe(homePlayerIds[0]);

    encounter = await encountersService.substitute({
      organizationId,
      encounterId: encounter.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: encounter.version,
        side: "HOME",
        position: 1,
        outPlayerId: homePlayerIds[0]!,
        inPlayerId: homePlayerIds[4]!,
        effectiveFromSequence: 2,
        reason: "Verletzung",
      },
      auth,
      audit,
    });
    expect(encounter.slots.find((entry) => entry.sequence === 1)?.home.players[0]?.playerId).toBe(
      homePlayerIds[0],
    );
    expect(encounter.slots.find((entry) => entry.sequence === 2)?.home.players[0]?.playerId).toBe(
      homePlayerIds[4],
    );

    await expect(
      encountersService.substitute({
        organizationId,
        encounterId: encounter.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: encounter.version,
          side: "HOME",
          position: 2,
          outPlayerId: homePlayerIds[1]!,
          inPlayerId: homePlayerIds[5]!,
          effectiveFromSequence: 1,
          reason: "Zu spät",
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "SUBSTITUTION_SLOT_RUNNING" } });
  }, 60_000);

  it("refuses a board that another encounter slot already uses", async () => {
    const competitionId = await createCompetition();
    let encounter = await openEncounter(competitionId);
    const first = encounter.slots.find((entry) => entry.sequence === 1);
    const second = encounter.slots.find((entry) => entry.sequence === 6);
    if (first === undefined || second === undefined) throw new Error("Expected two singles slots.");
    encounter = await encountersService.assignSlot({
      organizationId,
      encounterId: encounter.id,
      slotId: first.id,
      data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[0]! },
      auth,
      audit,
    });
    await expect(
      encountersService.assignSlot({
        organizationId,
        encounterId: encounter.id,
        slotId: second.id,
        data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[0]! },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "BOARD_UNAVAILABLE" } });

    const inProgress = await databaseService.database
      .select({ id: encounterSlots.id })
      .from(encounterSlots)
      .where(
        and(
          eq(encounterSlots.organizationId, organizationId),
          eq(encounterSlots.encounterId, encounter.id),
          eq(encounterSlots.status, "IN_PROGRESS"),
        ),
      );
    expect(inProgress).toHaveLength(1);

    // Ein technischer Abbruch gibt Slot und Board wieder frei.
    const running = encounter.slots.find((entry) => entry.sequence === 1);
    if (running?.matchId === null || running?.matchId === undefined) {
      throw new Error("Expected a running scoring match.");
    }
    const state = await matchesService.get({ organizationId, matchId: running.matchId, auth });
    await matchesService.abort({
      organizationId,
      matchId: running.matchId,
      data: {
        commandId: randomUUID(),
        expectedVersion: state.version,
        reason: "Automat ausgefallen",
      },
      auth,
      audit,
    });
    const reopened = await encountersService.get({
      organizationId,
      encounterId: encounter.id,
      auth,
    });
    expect(reopened.slots.find((entry) => entry.sequence === 1)).toMatchObject({
      status: "WAITING",
      matchId: null,
      boardId: null,
    });
    const board = await databaseService.database
      .select({ status: boards.status })
      .from(boards)
      .where(eq(boards.id, boardIds[0]!));
    expect(board[0]?.status).toBe("AVAILABLE");
  }, 60_000);

  it("refuses a board that a running tournament match already uses", async () => {
    const tournament = await tournamentsService.create({
      organizationId,
      data: {
        name: `Board Clash Cup ${randomUUID().slice(0, 8)}`,
        startsAt: new Date("2026-09-11T18:00:00.000Z"),
        format: "ROUND_ROBIN",
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        maxRounds: null,
        bestOfLegs: 1,
        bestOfSets: 1,
        participantIds: awayPlayerIds.slice(0, 4),
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 2,
        seeding: "SEEDED",
        boardIds: [boardIds[0]!],
      },
      auth,
      audit,
    });
    const dashboard = await tournamentsService.dashboard({
      organizationId,
      tournamentId: tournament.id,
      auth,
    });
    const ready = dashboard.queue.find((entry) => entry.readiness === "READY");
    if (ready === undefined) throw new Error("Expected a ready tournament match.");
    await tournamentsService.assign({
      organizationId,
      tournamentId: tournament.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: dashboard.tournament.version,
        matchId: ready.matchId,
        boardId: boardIds[0]!,
      },
      auth,
      audit,
    });

    const competitionId = await createCompetition();
    const encounter = await openEncounter(competitionId);
    const slot = encounter.slots[0];
    if (slot === undefined) throw new Error("Expected a slot.");
    await expect(
      encountersService.assignSlot({
        organizationId,
        encounterId: encounter.id,
        slotId: slot.id,
        data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[0]! },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "BOARD_UNAVAILABLE" } });

    await databaseService.database
      .delete(tournamentsTable)
      .where(eq(tournamentsTable.id, tournament.id));
  }, 60_000);

  it("stores the reglement commands that decide a leg without a visit", async () => {
    const competitionId = await createCompetition(3, { outRule: "DOUBLE", maxRounds: 2 });
    let encounter = await openEncounter(competitionId);
    const slot = encounter.slots.find((entry) => entry.sequence === 1);
    if (slot === undefined) throw new Error("Expected the first slot.");
    encounter = await encountersService.assignSlot({
      organizationId,
      encounterId: encounter.id,
      slotId: slot.id,
      data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[1]! },
      auth,
      audit,
    });
    const matchId = encounter.slots.find((entry) => entry.sequence === 1)?.matchId;
    if (matchId === null || matchId === undefined) throw new Error("Expected a scoring match.");

    // Vor der Rundengrenze ist ein Ausbullen kein Eingabefehler, sondern ein
    // Zustand: die Grenze ist schlicht noch nicht erreicht.
    const early = await matchesService.get({ organizationId, matchId, auth });
    await expect(
      matchesService.decideLegByBull({
        organizationId,
        matchId,
        data: { commandId: randomUUID(), expectedVersion: early.version, winnerSeat: 1 },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "ROUND_LIMIT_NOT_REACHED" } });

    const throwRounds = async (rounds: number): Promise<void> => {
      for (let visit = 0; visit < rounds * 2; visit += 1) {
        const state = await matchesService.get({ organizationId, matchId, auth });
        const active = state.participants.find((participant) => participant.isActive);
        const thrower = active?.players.find((player) => player.isThrowing);
        if (thrower === undefined) throw new Error("Expected an active thrower.");
        await matchesService.submitVisit({
          organizationId,
          matchId,
          data: {
            commandId: randomUUID(),
            expectedVersion: state.version,
            playerId: thrower.playerId,
            points: 26,
            dartsThrown: 3,
          },
          auth,
          audit,
        });
      }
    };
    const decideByBull = async (winnerSeat: 1 | 2): Promise<void> => {
      const state = await matchesService.get({ organizationId, matchId, auth });
      await matchesService.decideLegByBull({
        organizationId,
        matchId,
        data: { commandId: randomUUID(), expectedVersion: state.version, winnerSeat },
        auth,
        audit,
      });
    };

    await throwRounds(2);
    await decideByBull(1);
    await throwRounds(2);
    await decideByBull(1);

    // Ab Leg drei entscheidet ein Wurf auf Bull, wer beginnt (2.2.9).
    const beforeThirdLeg = await matchesService.get({ organizationId, matchId, auth });
    await matchesService.decideLegStart({
      organizationId,
      matchId,
      data: {
        commandId: randomUUID(),
        expectedVersion: beforeThirdLeg.version,
        legNumber: 3,
        startingSeat: 2,
      },
      auth,
      audit,
    });
    await throwRounds(2);
    await decideByBull(1);

    const storedCommands = await databaseService.database
      .select({ type: scoreCommands.type })
      .from(scoreCommands)
      .where(eq(scoreCommands.matchId, matchId));
    const types = storedCommands.map((row) => row.type);
    expect(types.filter((type) => type === "DECIDE_LEG_BY_BULL")).toHaveLength(3);
    expect(types.filter((type) => type === "DECIDE_LEG_START")).toHaveLength(1);

    const storedLegs = await databaseService.database
      .select({ legNumber: legsTable.legNumber, startingSeat: legsTable.startingSeat, winnerSeat: legsTable.winnerSeat })
      .from(legsTable)
      .where(eq(legsTable.matchId, matchId));
    expect(storedLegs.find((leg) => leg.legNumber === 3)?.startingSeat).toBe(2);
    expect(storedLegs.filter((leg) => leg.winnerSeat === 1)).toHaveLength(3);

    const finished = await encountersService.get({
      organizationId,
      encounterId: encounter.id,
      auth,
    });
    expect(finished.slots.find((entry) => entry.sequence === 1)).toMatchObject({
      status: "COMPLETED",
      winnerSide: "HOME",
      resultType: "PLAYED",
      homeLegs: 3,
      awayLegs: 0,
    });
  }, 60_000);

  /** Reglement 2.1.1: der Heim-Captain darf verdeckt melden. */
  it("hides the opposing lineup until both sides have submitted", async () => {
    const competitionId = await createCompetition();
    let encounter = await scheduleEncounter(competitionId);
    encounter = await nominate(encounter, "HOME", homePlayerIds.slice(0, 4));
    expect(encounter.status).toBe("LINEUPS_OPEN");
    expect(encounter.home).toMatchObject({ submitted: true, revealed: false, nominations: [] });
    expect(encounter.away).toMatchObject({ submitted: false, revealed: false, nominations: [] });

    encounter = await nominate(encounter, "AWAY", awayPlayerIds.slice(0, 4));
    expect(encounter.status).toBe("READY");
    expect(encounter.home.revealed).toBe(true);
    expect(encounter.home.nominations).toHaveLength(4);
    expect(encounter.away.nominations).toHaveLength(4);
  }, 30_000);

  it("accepts a guest but refuses a stranger claimed as squad", async () => {
    const competitionId = await createCompetition();
    const encounter = await scheduleEncounter(competitionId);
    await expect(
      encountersService.submitNominations({
        organizationId,
        encounterId: encounter.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: encounter.version,
          side: "HOME",
          nominations: [
            ...homePlayerIds.slice(0, 3).map((playerId, index) => ({
              position: index + 1,
              playerId,
              origin: "SQUAD" as const,
            })),
            { position: 4, playerId: guestPlayerId, origin: "SQUAD" as const },
          ],
        },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({
      response: { code: "NOMINATION_PLAYER_NOT_IN_SQUAD" },
      status: 422,
    });

    // Dieselbe Person als Aushilfe nach Reglement 1.2.3 ist zulässig.
    const withGuest = await encountersService.submitNominations({
      organizationId,
      encounterId: encounter.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: encounter.version,
        side: "HOME",
        nominations: [
          ...homePlayerIds.slice(0, 3).map((playerId, index) => ({
            position: index + 1,
            playerId,
            origin: "SQUAD" as const,
          })),
          { position: 4, playerId: guestPlayerId, origin: "GUEST" as const },
        ],
      },
      auth,
      audit,
    });
    // Sichtbar wird die Meldung erst, wenn beide Seiten gemeldet haben.
    expect(withGuest.home).toMatchObject({ submitted: true, revealed: false });
    const complete = await nominate(withGuest, "AWAY", awayPlayerIds.slice(0, 4));
    expect(
      complete.home.nominations.find((entry) => entry.playerId === guestPlayerId),
    ).toMatchObject({ origin: "GUEST", position: 4 });
  }, 30_000);

  /**
   * Reglement 2.2.5: eine Mannschaft darf ausnahmsweise zu dritt antreten. Die
   * Einzel der fehlenden Position und eines der beiden Doppel gehen dann
   * kampflos an die Gegenseite.
   */
  it("scores the missing position and one double against a three-person side", async () => {
    const competitionId = await createCompetition();
    let encounter = await scheduleEncounter(competitionId);
    encounter = await nominate(encounter, "HOME", homePlayerIds.slice(0, 3));
    encounter = await nominate(encounter, "AWAY", awayPlayerIds.slice(0, 4));
    encounter = await encountersService.start({
      organizationId,
      encounterId: encounter.id,
      data: { commandId: randomUUID(), expectedVersion: encounter.version },
      auth,
      audit,
    });

    expect(encounter.status).toBe("RUNNING");
    const walkovers = encounter.slots.filter((slot) => slot.status === "WALKOVER");
    // Vier Einzel der vierten Heimposition plus ein reguläres Doppel.
    expect(walkovers).toHaveLength(5);
    expect(walkovers.every((slot) => slot.winnerSide === "AWAY")).toBe(true);
    expect(
      walkovers.filter((slot) => slot.discipline === "SINGLES").map((slot) => slot.homePosition),
    ).toEqual([4, 4, 4, 4]);
    expect(walkovers.filter((slot) => slot.discipline === "DOUBLES")).toHaveLength(1);
    expect(encounter.awayGames).toBe(5);
    expect(encounter.homeGames).toBe(0);
    expect(encounter.awayLegs).toBe(5);
    expect(encounter.status).toBe("RUNNING");
  }, 30_000);

  it("refuses a person in both regular doubles", async () => {
    const competitionId = await createCompetition();
    const encounter = await openEncounter(competitionId);
    await expect(
      submitDoubles(encounter, "HOME", [
        { sequence: 17, playerIds: [homePlayerIds[0]!, homePlayerIds[1]!] },
        { sequence: 18, playerIds: [homePlayerIds[0]!, homePlayerIds[2]!] },
      ]),
    ).rejects.toMatchObject({
      response: { code: "DOUBLES_PLAYER_LIMIT_EXCEEDED" },
      status: 422,
    });
  }, 30_000);

  it("takes back a board assignment as long as nobody has thrown", async () => {
    const competitionId = await createCompetition();
    let encounter = await openEncounter(competitionId);
    const slot = encounter.slots.find((entry) => entry.sequence === 1);
    if (slot === undefined) throw new Error("Expected the first slot.");
    encounter = await encountersService.assignSlot({
      organizationId,
      encounterId: encounter.id,
      slotId: slot.id,
      data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[0]! },
      auth,
      audit,
    });
    encounter = await encountersService.releaseSlot({
      organizationId,
      encounterId: encounter.id,
      slotId: slot.id,
      data: { commandId: randomUUID(), expectedVersion: encounter.version },
      auth,
      audit,
    });
    expect(encounter.slots.find((entry) => entry.sequence === 1)).toMatchObject({
      status: "WAITING",
      boardId: null,
      matchId: null,
    });
    const board = await databaseService.database
      .select({ status: boards.status })
      .from(boards)
      .where(eq(boards.id, boardIds[0]!));
    expect(board[0]?.status).toBe("AVAILABLE");
    const reopened = await databaseService.database
      .select({ eventType: outboxEvents.eventType })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, encounter.id),
          eq(outboxEvents.eventType, "ENCOUNTER_SLOT_REOPENED"),
        ),
      );
    expect(reopened).toHaveLength(1);

    // Nach dem ersten Wurf ist die Rücknahme kein Weg mehr.
    encounter = await encountersService.assignSlot({
      organizationId,
      encounterId: encounter.id,
      slotId: slot.id,
      data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[0]! },
      auth,
      audit,
    });
    const matchId = encounter.slots.find((entry) => entry.sequence === 1)?.matchId;
    if (matchId === null || matchId === undefined) throw new Error("Expected a scoring match.");
    const state = await matchesService.get({ organizationId, matchId, auth });
    const thrower = state.participants
      .find((participant) => participant.isActive)
      ?.players.find((player) => player.isThrowing);
    if (thrower === undefined) throw new Error("Expected an active thrower.");
    await matchesService.submitVisit({
      organizationId,
      matchId,
      data: {
        commandId: randomUUID(),
        expectedVersion: state.version,
        playerId: thrower.playerId,
        points: 60,
        dartsThrown: 3,
      },
      auth,
      audit,
    });
    const current = await encountersService.get({
      organizationId,
      encounterId: encounter.id,
      auth,
    });
    await expect(
      encountersService.releaseSlot({
        organizationId,
        encounterId: encounter.id,
        slotId: slot.id,
        data: { commandId: randomUUID(), expectedVersion: current.version },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "ENCOUNTER_SLOT_RUNNING" } });
  }, 60_000);

  it("cancels an encounter that has not started a slot", async () => {
    const competitionId = await createCompetition();
    const encounter = await openEncounter(competitionId);
    const cancelled = await encountersService.cancel({
      organizationId,
      encounterId: encounter.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: encounter.version,
        reason: "Spielabend abgesagt.",
      },
      auth,
      audit,
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.slots.every((slot) => slot.status === "CANCELLED")).toBe(true);
    await expect(
      encountersService.start({
        organizationId,
        encounterId: encounter.id,
        data: { commandId: randomUUID(), expectedVersion: cancelled.version },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "ENCOUNTER_CLOSED" } });
  }, 30_000);

  it("verteilt die Ereignisse eines gespielten Slots in den Begegnungsraum", async () => {
    const competitionId = await createCompetition();
    let encounter = await openEncounter(competitionId);
    encounter = await playSlot(encounter, 1, boardIds[0]!, "HOME");

    const sent: { readonly room: string; readonly event: string }[] = [];
    const broadcaster = {
      emit(room: string, event: string) {
        sent.push({ room, event });
      },
    };
    // Die Outbox traegt die Ereignisse der vorherigen Tests dieser Datei; der
    // echte Poller arbeitet sie in Stapeln ab, also hier bis zum Ende leeren.
    while ((await publishOutboxBatch(databaseService.database, broadcaster)) > 0) {
      // weiterleeren
    }

    // Der Poller arbeitet global; geprueft wird nur der eigene Raum.
    const ownRoom = sent.filter((entry) => entry.room === `encounter:${encounter.id}`);
    expect(ownRoom.length).toBeGreaterThan(0);
    expect(ownRoom.every((entry) => entry.event === "encounter:changed")).toBe(true);

    const unpublished = await databaseService.database
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, organizationId),
          eq(outboxEvents.aggregateId, encounter.id),
          isNull(outboxEvents.publishedAt),
        ),
      );
    expect(unpublished).toEqual([]);
  }, 60_000);

  it("answers a foreign organization with 404 for teams, competitions and encounters", async () => {
    const competitionId = await createCompetition();
    const encounter = await openEncounter(competitionId);
    const slot = encounter.slots[0];
    if (slot === undefined) throw new Error("Expected a slot.");

    await expect(
      teamsService.get({ organizationId: foreignOrganizationId, teamId: homeTeamId, auth: foreignAuth }),
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
    await expect(
      competitionsService.get({ organizationId: foreignOrganizationId, competitionId, auth: foreignAuth }),
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
    await expect(
      encountersService.get({ organizationId: foreignOrganizationId, encounterId: encounter.id, auth: foreignAuth }),
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
    await expect(
      encountersService.assignSlot({
        organizationId: foreignOrganizationId,
        encounterId: encounter.id,
        slotId: slot.id,
        data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId: boardIds[0]! },
        auth: foreignAuth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
  }, 60_000);
});
