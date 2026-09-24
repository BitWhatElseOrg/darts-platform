import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { buildEncounterTemplate } from "@darts-platform/league-engine";
import {
  auditEvents,
  organizations,
  playerAvatars,
  playerStatisticAggregates,
  users,
  memberships,
} from "@darts-platform/database";

import type { CompetitionSlotInput } from "@darts-platform/schemas";

import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { BoardsService } from "../boards/boards.service.js";
import { CompetitionsRepository } from "../competitions/competitions.repository.js";
import { CompetitionsService } from "../competitions/competitions.service.js";
import { DatabaseService } from "../database/database.service.js";
import { EncountersRepository } from "../encounters/encounters.repository.js";
import { EncountersService } from "../encounters/encounters.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { PlayersRepository } from "../players/players.repository.js";
import { PlayersService } from "../players/players.service.js";
import { TeamsRepository } from "../teams/teams.repository.js";
import { TeamsService } from "../teams/teams.service.js";
import { createApiTestApplication } from "../testing/api-harness.js";
import { DisplayKeysRepository } from "../tournaments/display-keys.repository.js";
import { DisplayKeysService } from "../tournaments/display-keys.service.js";
import { TournamentsRepository } from "../tournaments/tournaments.repository.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";
import { OrganizationAccessService } from "./organization-access.service.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { OrganizationsService } from "./organizations.service.js";

/**
 * Deckt Task 7 ab (Spec 2026-09-24-bearbeiten-loeschen): endgueltiges
 * Loeschen einer Organisation mit Namensbestaetigung. Organisation A wird
 * vollstaendig befuellt — ueber die bestehenden Services, damit die Daten
 * so entstehen wie im echten Betrieb — und am Ende restlos geloescht,
 * Organisation B bleibt unberuehrt.
 */
const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
const db = databaseService.database;

const organizationsRepository = new OrganizationsRepository(databaseService);
const access = new OrganizationAccessService(organizationsRepository);
const organizationsService = new OrganizationsService(
  organizationsRepository,
  access,
  environment,
);
const playersRepository = new PlayersRepository(databaseService);
const playersService = new PlayersService(playersRepository, access);
const boardsService = new BoardsService(databaseService, access);
const matchesRepository = new MatchesRepository(databaseService);
const matchesService = new MatchesService(matchesRepository, access);
const teamsRepository = new TeamsRepository(databaseService);
const teamsService = new TeamsService(teamsRepository, access);
const competitionsRepository = new CompetitionsRepository(databaseService);
const competitionsService = new CompetitionsService(competitionsRepository, access);
const encountersRepository = new EncountersRepository(databaseService);
const encountersService = new EncountersService(encountersRepository, access);
const tournamentsRepository = new TournamentsRepository(databaseService);
const displayKeysRepository = new DisplayKeysRepository(databaseService);
const displayKeysService = new DisplayKeysService(
  displayKeysRepository,
  tournamentsRepository,
  access,
);
const tournamentsService = new TournamentsService(
  tournamentsRepository,
  matchesRepository,
  access,
  displayKeysService,
);

const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

const orgA = randomUUID();
const orgASlug = `verein-a-${orgA}`;
const orgB = randomUUID();
const orgBSlug = `verein-b-${orgB}`;
const ownerA = randomUUID();
const adminA = randomUUID();
const ownerB = randomUUID();

const ownerAAuth: AuthContext = {
  user: { id: ownerA, email: `owner-a-${ownerA}@example.test`, name: "Owner A" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const adminAAuth: AuthContext = {
  user: { id: adminA, email: `admin-a-${adminA}@example.test`, name: "Admin A" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const ownerBAuth: AuthContext = {
  user: { id: ownerB, email: `owner-b-${ownerB}@example.test`, name: "Owner B" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

let app: NestFastifyApplication;

/** Jede Tabelle mit `organization_id`, ausser `audit_events` (dort SET NULL). */
async function organizationScopedTables(): Promise<readonly string[]> {
  const rows = (await db.execute(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id' and table_name <> 'audit_events'
    order by table_name
  `)) as unknown as readonly { readonly table_name: string }[];
  return rows.map((row) => row.table_name);
}

async function countsFor(
  organizationId: string,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const [row] = (await db.execute(
      sql`select count(*)::int as count from ${sql.raw(`"${table}"`)} where organization_id = ${organizationId}`,
    )) as unknown as readonly { readonly count: number }[];
    result[table] = row?.count ?? -1;
  }
  return result;
}

interface SeededOrganizationA {
  readonly playerIds: readonly string[];
  readonly matchId: string;
}

/**
 * Befuellt Organisation A ueber die echten Services: Spieler mit Avatar und
 * Statistik-Aggregat, Board, Match mit einer Aufnahme, Turnier mit Gruppen-
 * und KO-Matches, zwei Teams mit Kader, Wettbewerb mit Begegnung und
 * Aufstellung sowie eine offene Einladung (erzeugt `email_deliveries`).
 */
async function seedOrganizationA(): Promise<SeededOrganizationA> {
  const playerIds: string[] = [];
  for (let index = 0; index < 16; index += 1) {
    const player = await playersService.create({
      organizationId: orgA,
      data: { displayName: `A-Spieler ${index + 1}`, status: "ACTIVE" },
      auth: ownerAAuth,
      audit,
    });
    playerIds.push(player.id);
  }

  await db.insert(playerAvatars).values({
    organizationId: orgA,
    playerId: playerIds[0]!,
    contentType: "image/webp",
    bytes: Buffer.from([1, 2, 3]),
    byteSize: 3,
    checksum: "a-avatar",
  });

  await db.insert(playerStatisticAggregates).values({
    playerId: playerIds[0]!,
    organizationId: orgA,
    payload: {},
    sourceUpdatedAt: new Date(),
  });

  const board = await boardsService.create({
    organizationId: orgA,
    data: { name: "A-Scheibe" },
    auth: ownerAAuth,
    audit,
  });

  const match = await matchesService.create({
    organizationId: orgA,
    data: {
      playerOneId: playerIds[0]!,
      playerTwoId: playerIds[1]!,
      boardId: null,
      bestOfLegs: 1,
      bestOfSets: 1,
    },
    auth: ownerAAuth,
    audit,
  });
  await matchesService.submitVisit({
    organizationId: orgA,
    matchId: match.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: match.version,
      playerId: playerIds[0]!,
      points: 60,
      dartsThrown: 3,
    },
    auth: ownerAAuth,
    audit,
  });

  await tournamentsService.create({
    organizationId: orgA,
    data: {
      name: "A-Turnier",
      startsAt: new Date(Date.now() + 86_400_000),
      format: "GROUPS_THEN_KNOCKOUT",
      startingScore: 501,
      inRule: "STRAIGHT",
      outRule: "DOUBLE",
      maxRounds: null,
      bestOfLegs: 1,
      bestOfSets: 1,
      participantIds: playerIds.slice(0, 4),
      groupCount: 2,
      qualifyPerGroup: 1,
      knockoutSize: 2,
      seeding: "RANDOM",
      boardIds: [board.id],
    },
    auth: ownerAAuth,
    audit,
  });

  const homeTeam = await teamsService.create({
    organizationId: orgA,
    data: { name: "A-Heim", shortName: null },
    auth: ownerAAuth,
    audit,
  });
  const awayTeam = await teamsService.create({
    organizationId: orgA,
    data: { name: "A-Gast", shortName: null },
    auth: ownerAAuth,
    audit,
  });

  const squadValidFrom = new Date(Date.now() - 30 * 86_400_000);
  for (const playerId of playerIds.slice(4, 10)) {
    await teamsService.addMember({
      organizationId: orgA,
      teamId: homeTeam.id,
      data: { playerId, role: "PLAYER", validFrom: squadValidFrom },
      auth: ownerAAuth,
      audit,
    });
  }
  for (const playerId of playerIds.slice(10, 16)) {
    await teamsService.addMember({
      organizationId: orgA,
      teamId: awayTeam.id,
      data: { playerId, role: "PLAYER", validFrom: squadValidFrom },
      auth: ownerAAuth,
      audit,
    });
  }

  const competition = await competitionsService.create({
    organizationId: orgA,
    data: {
      type: "LEAGUE",
      name: "A-Liga",
      slug: `a-liga-${randomUUID()}`,
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
      slots: buildEncounterTemplate({
        lineupPositions: 4,
        singlesStartingScore: 301,
        doublesStartingScore: 301,
        inRule: "STRAIGHT",
        outRule: "SINGLE",
        bestOfLegs: 1,
        maxRounds: null,
        regularDoubles: 2,
        withDecider: true,
      }) as CompetitionSlotInput[],
    },
    auth: ownerAAuth,
    audit,
  });

  let encounter = await encountersService.schedule({
    organizationId: orgA,
    competitionId: competition.id,
    data: {
      matchday: 1,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      scheduledAt: new Date(Date.now() + 2 * 86_400_000),
      venue: "Clublokal",
    },
    auth: ownerAAuth,
    audit,
  });
  encounter = await encountersService.submitNominations({
    organizationId: orgA,
    encounterId: encounter.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: encounter.version,
      side: "HOME",
      nominations: [
        ...playerIds
          .slice(4, 8)
          .map((playerId, index) => ({ position: index + 1, playerId, origin: "SQUAD" as const })),
        { position: null, playerId: playerIds[8]!, origin: "SQUAD" as const },
      ],
    },
    auth: ownerAAuth,
    audit,
  });
  await encountersService.submitNominations({
    organizationId: orgA,
    encounterId: encounter.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: encounter.version,
      side: "AWAY",
      nominations: [
        ...playerIds
          .slice(10, 14)
          .map((playerId, index) => ({ position: index + 1, playerId, origin: "SQUAD" as const })),
        { position: null, playerId: playerIds[14]!, origin: "SQUAD" as const },
      ],
    },
    auth: ownerAAuth,
    audit,
  });

  await organizationsService.invite({
    organizationId: orgA,
    data: { email: `einladung-${randomUUID()}@example.test`, role: "MEMBER" },
    auth: ownerAAuth,
    audit,
  });

  return { playerIds, matchId: match.id };
}

beforeAll(async () => {
  await db.insert(users).values([
    { id: ownerA, email: ownerAAuth.user.email, displayName: "Owner A" },
    { id: adminA, email: adminAAuth.user.email, displayName: "Admin A" },
    { id: ownerB, email: ownerBAuth.user.email, displayName: "Owner B" },
  ]);
  await db.insert(organizations).values([
    { id: orgA, name: "Verein A", slug: orgASlug, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: orgB, name: "Verein B", slug: orgBSlug, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await db.insert(memberships).values([
    { organizationId: orgA, userId: ownerA, role: "OWNER", status: "ACTIVE" },
    { organizationId: orgA, userId: adminA, role: "ADMIN", status: "ACTIVE" },
    { organizationId: orgB, userId: ownerB, role: "OWNER", status: "ACTIVE" },
  ]);

  // Organisation B bleibt bewusst schlank: mindestens ein Spieler und ein
  // Match, um zu belegen, dass ein fremder Bestand unangetastet bleibt.
  const playerOneB = await playersService.create({
    organizationId: orgB,
    data: { displayName: "B-Spieler 1", status: "ACTIVE" },
    auth: ownerBAuth,
    audit,
  });
  const playerTwoB = await playersService.create({
    organizationId: orgB,
    data: { displayName: "B-Spieler 2", status: "ACTIVE" },
    auth: ownerBAuth,
    audit,
  });
  await matchesService.create({
    organizationId: orgB,
    data: {
      playerOneId: playerOneB.id,
      playerTwoId: playerTwoB.id,
      boardId: null,
      bestOfLegs: 1,
      bestOfSets: 1,
    },
    auth: ownerBAuth,
    audit,
  });

  app = await createApiTestApplication({
    RATE_LIMIT_MAX_PER_MINUTE: 100_000,
    RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 100_000,
  });
  vi.spyOn(app.get(AuthService), "getSession").mockResolvedValue(ownerAAuth);
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
  await db.delete(users).where(eq(users.id, ownerA));
  await db.delete(users).where(eq(users.id, adminA));
  await db.delete(users).where(eq(users.id, ownerB));
  await databaseService.onApplicationShutdown();
});

describe("Organisation endgueltig loeschen", () => {
  it("verweigert ADMIN mit 403 und loescht nichts", async () => {
    await expect(
      organizationsService.deleteOrganization({
        organizationId: orgA,
        data: { confirmName: "Verein A" },
        auth: adminAAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(await db.select().from(organizations).where(eq(organizations.id, orgA))).toHaveLength(1);
  });

  it("verweigert ein Mitglied von B mit 403", async () => {
    await expect(
      organizationsService.deleteOrganization({
        organizationId: orgA,
        data: { confirmName: "Verein A" },
        auth: ownerBAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(await db.select().from(organizations).where(eq(organizations.id, orgA))).toHaveLength(1);
  });

  it("antwortet mit 403 bei einer unbekannten Organisation", async () => {
    await expect(
      organizationsService.deleteOrganization({
        organizationId: randomUUID(),
        data: { confirmName: "Irrelevant" },
        auth: ownerAAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("verweigert einen falschen Namen mit 400 ORGANIZATION_NAME_MISMATCH und loescht nichts", async () => {
    await expect(
      organizationsService.deleteOrganization({
        organizationId: orgA,
        data: { confirmName: "Falscher Name" },
        auth: ownerAAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "ORGANIZATION_NAME_MISMATCH" } });

    // Andere Gross-/Kleinschreibung ist ebenfalls ein Fehltreffer.
    await expect(
      organizationsService.deleteOrganization({
        organizationId: orgA,
        data: { confirmName: "verein a" },
        auth: ownerAAuth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "ORGANIZATION_NAME_MISMATCH" } });

    expect(await db.select().from(organizations).where(eq(organizations.id, orgA))).toHaveLength(1);
  });

  it(
    "loescht Organisation A vollstaendig (Name mit Leerzeichen aussen, getrimmt) und laesst B unberuehrt",
    async () => {
      const seeded = await seedOrganizationA();
      const tables = await organizationScopedTables();

      const beforeA = await countsFor(orgA, tables);
      expect(beforeA.players).toBe(16);
      expect(beforeA.matches).toBeGreaterThan(0);
      expect(beforeA.boards).toBeGreaterThan(0);
      expect(beforeA.tournaments).toBeGreaterThan(0);
      expect(beforeA.tournament_matches).toBeGreaterThan(0);
      expect(beforeA.tournament_groups).toBeGreaterThan(0);
      expect(beforeA.teams).toBe(2);
      expect(beforeA.team_players).toBe(12);
      expect(beforeA.competitions).toBeGreaterThan(0);
      expect(beforeA.encounters).toBeGreaterThan(0);
      expect(beforeA.encounter_nominations).toBeGreaterThan(0);
      expect(beforeA.organization_invitations).toBeGreaterThan(0);
      expect(beforeA.email_deliveries).toBeGreaterThan(0);
      expect(beforeA.player_avatars).toBe(1);
      expect(beforeA.player_statistic_aggregates).toBe(1);
      expect(beforeA.visits).toBeGreaterThan(0);
      expect(beforeA.memberships).toBeGreaterThan(0);

      const beforeB = await countsFor(orgB, tables);
      expect(beforeB.players).toBeGreaterThan(0);
      expect(beforeB.matches).toBeGreaterThan(0);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/organizations/${orgA}`,
        payload: { confirmName: "  Verein A  " },
        headers: { "content-type": "application/json" },
      });
      expect(response.statusCode).toBe(204);

      const afterA = await countsFor(orgA, tables);
      const leftovers = tables.filter((table) => afterA[table] !== 0);
      expect(leftovers, `Nicht geleerte Tabellen fuer A: ${leftovers.join(", ")}`).toEqual([]);

      const afterB = await countsFor(orgB, tables);
      expect(afterB).toEqual(beforeB);

      const [event] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, orgA), eq(auditEvents.action, "ORGANIZATION_DELETED")));
      expect(event?.organizationId).toBeNull();
      expect(event?.actorUserId).toBe(ownerA);
      const oldValue = event?.oldValue as { readonly name?: string; readonly slug?: string } | null;
      expect(oldValue?.name).toBe("Verein A");
      expect(oldValue?.slug).toBe(orgASlug);

      expect(await db.select().from(users).where(eq(users.id, ownerA))).toHaveLength(1);
      expect(await db.select().from(organizations).where(eq(organizations.id, orgA))).toEqual([]);
      // Referenziert im Deletionslauf, damit die Fixture nicht als toter Code auffaellt.
      expect(seeded.playerIds).toHaveLength(16);
      expect(seeded.matchId).toBeTruthy();
    },
    60_000,
  );
});
