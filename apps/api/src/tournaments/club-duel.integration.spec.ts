import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  boards,
  memberships,
  organizations,
  players,
  tournamentMatches,
  tournamentStages,
  users,
} from "@darts-platform/database";
import type { CreateClubDuelTournamentInput } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { DisplayKeysRepository } from "./display-keys.repository.js";
import { DisplayKeysService } from "./display-keys.service.js";
import { TournamentsRepository } from "./tournaments.repository.js";
import { TournamentsService } from "./tournaments.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const matchesRepository = new MatchesRepository(databaseService);
const repository = new TournamentsRepository(databaseService);
const displayKeys = new DisplayKeysService(new DisplayKeysRepository(databaseService), repository, access);
const service = new TournamentsService(repository, matchesRepository, access, displayKeys);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `club-duel-${userId}@example.test`, name: "Club Duel Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

const sideA: string[] = Array.from({ length: 13 }, () => randomUUID());
const sideB: string[] = Array.from({ length: 9 }, () => randomUUID());
const seedOf = new Map<string, number>([...sideA, ...sideB].map((id, index) => [id, index + 1]));
const boardIds = [randomUUID(), randomUUID(), randomUUID()] as const;
const foreignPlayerId = randomUUID();

function sideOf(id: string | null): "A" | "B" | null {
  if (id === null) return null;
  if (sideA.includes(id)) return "A";
  if (sideB.includes(id)) return "B";
  return null;
}

function clubDuelInput(options: {
  readonly qualifyingRounds: number;
  readonly finalRoundSize: number;
  readonly sideACount?: number;
  readonly sideBCount?: number;
}): CreateClubDuelTournamentInput {
  const { qualifyingRounds, finalRoundSize, sideACount = 13, sideBCount = 9 } = options;
  return {
    name: `Vereinsduell ${randomUUID()}`,
    startsAt: new Date("2026-10-10T18:00:00.000Z"),
    format: "CLUB_DUEL",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    bestOfSets: 1,
    boardIds: [...boardIds],
    sideAName: "VFC",
    sideBName: "DC Musterdorf",
    qualifyingRounds,
    finalRoundSize,
    thirdPlaceMatch: true,
    participants: [
      ...sideA.slice(0, sideACount).map((playerId) => ({ playerId, side: "A" as const })),
      ...sideB.slice(0, sideBCount).map((playerId) => ({ playerId, side: "B" as const })),
    ],
  };
}

beforeAll(async () => {
  const database = databaseService.database;
  await database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await database.insert(organizations).values([
    { id: organizationId, name: "Club Duel Club", slug: `club-duel-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Duel Club", slug: `foreign-duel-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await database.insert(players).values([
    ...sideA.map((id, index) => ({ id, organizationId, displayName: `Mitglied ${index + 1}`, status: "ACTIVE" })),
    ...sideB.map((id, index) => ({
      id,
      organizationId,
      displayName: `Gast ${index + 1}`,
      status: "ACTIVE",
      kind: "GUEST",
      guestClubName: "DC Musterdorf",
    })),
    { id: foreignPlayerId, organizationId: foreignOrganizationId, displayName: "Fremder Spieler", status: "ACTIVE" },
  ]);
  await database.insert(boards).values(boardIds.map((id, index) => ({ id, organizationId, name: `Duell Board ${index + 1}` })));
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("Vereinsduell anlegen", () => {
  it("legt 13 gegen 9 an: Runde 1 mit 9 Spielen und 4 Pausen, Finalrunde und Final als Platzhalter", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 }), auth, audit });
    expect(created.format).toBe("CLUB_DUEL");
    expect(created.status).toBe("GROUP_STAGE");
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const stages = await databaseService.database
      .select()
      .from(tournamentStages)
      .where(eq(tournamentStages.tournamentId, created.id))
      .orderBy(tournamentStages.sequence);
    expect(stages.map((stage) => [stage.key, stage.type, stage.status])).toEqual([
      ["qualifying", "CLUB_SWISS", "OPEN"],
      ["final-round", "CLUB_CROSS_ROUND_ROBIN", "WAITING"],
      ["final", "SINGLE_ELIMINATION", "WAITING"],
    ]);
    const matches = await databaseService.database
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, created.id));
    const qualifying = matches.filter((match) => match.stageId === stages[0]?.id);
    expect(qualifying).toHaveLength(9);
    expect(qualifying.every((match) => match.status === "READY" && match.round === 1 && match.stageLabel === "Quali · Runde 1")).toBe(true);
    for (const match of qualifying) {
      expect(sideOf(match.participantOneId)).toBe("A");
      expect(sideOf(match.participantTwoId)).toBe("B");
    }
    const paired = new Set(qualifying.flatMap((match) => [match.participantOneId, match.participantTwoId]));
    expect(sideA.filter((id) => !paired.has(id))).toHaveLength(4);
    const finalRound = matches.filter((match) => match.stageId === stages[1]?.id);
    expect(finalRound).toHaveLength(4);
    expect(finalRound.every((match) => match.status === "WAITING" && match.participantOneId === null)).toBe(true);
    expect(matches.filter((match) => match.stageId === stages[2]?.id).map((match) => match.stageLabel).sort()).toEqual(["Final", "Spiel um Platz 3"]);
    expect(dashboard.participants.filter((participant) => participant.side === "A")).toHaveLength(13);
    expect(dashboard.participants.filter((participant) => participant.side === "B")).toHaveLength(9);
    expect(dashboard.queue.some((entry) => entry.readiness === "READY")).toBe(true);
  });

  it("lehnt Spieler fremder Organisationen und zu kleine Seiten ab", async () => {
    const foreign = clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 });
    foreign.participants[0] = { playerId: foreignPlayerId, side: "A" };
    await expect(service.create({ organizationId, data: foreign, auth, audit })).rejects.toMatchObject({
      response: { code: "INVALID_TOURNAMENT_PARTICIPANTS" },
    });
    await expect(
      service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 6, sideBCount: 5 }), auth, audit }),
    ).rejects.toMatchObject({ response: { code: "CLUB_DUEL_SIDE_TOO_SMALL" } });
  });

  it("rechnet die Vorschau", async () => {
    const preview = await service.clubDuelPreview({
      organizationId,
      auth,
      data: { sideACount: 13, sideBCount: 9, qualifyingRounds: 4, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 8, bestOfLegs: 3 },
    });
    expect(preview.totalMatches).toBe(54);
    expect(preview.matchesPerPlayer.sideB).toEqual({ min: 4, max: 4 });
  });
});
