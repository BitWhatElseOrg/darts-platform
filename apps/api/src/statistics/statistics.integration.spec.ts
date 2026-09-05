import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { legs, matches as matchesTable, memberships, organizations, players, users, visits } from "@darts-platform/database";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { StatisticsRepository } from "./statistics.repository.js";
import { StatisticsService } from "./statistics.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const repository = new StatisticsRepository(databaseService);
const matchesRepository = new MatchesRepository(databaseService);
const service = new StatisticsService(repository, matchesRepository, access);

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const secondOrganizationId = randomUUID();
const userId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();
const playerThreeId = randomUUID();
const playerFourId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `statistics-${userId}@example.test`, name: "Statistics Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

interface MatchFixture {
  readonly matchId: string;
  readonly legId: string;
  readonly nextSequence: () => number;
}

/**
 * Legt ein Match samt einem Leg an, rein als Ablagestruktur fuer die Visits
 * unten - kein tatsaechlicher Spielverlauf noetig, da die Aggregations-Tests
 * nur die `points`-Verteilung pruefen. `nextSequence` liefert bei jedem
 * Aufruf eine neue, im Match eindeutige Sequenznummer.
 */
async function createMatchFixture(targetOrganizationId: string): Promise<MatchFixture> {
  const matchId = randomUUID();
  const legId = randomUUID();
  await databaseService.database.insert(matchesTable).values({ id: matchId, organizationId: targetOrganizationId, bestOfLegs: 1, startingSeat: 1 });
  await databaseService.database.insert(legs).values({ id: legId, organizationId: targetOrganizationId, matchId, legNumber: 1, startingSeat: 1 });
  let sequence = 0;
  return { matchId, legId, nextSequence: () => (sequence += 1) };
}

/**
 * Fuegt fuer eine Person Visits nach einer vorgegebenen Haeufigkeitsverteilung
 * ein (`Aufnahmesumme -> Anzahl`), damit `frequentScores` eine bekannte
 * Grundgesamtheit vorfindet.
 */
async function insertVisits(fixture: MatchFixture, targetOrganizationId: string, playerId: string, distribution: Readonly<Record<number, number>>): Promise<void> {
  const rows = Object.entries(distribution).flatMap(([points, times]) =>
    Array.from({ length: times }, () => ({
      organizationId: targetOrganizationId,
      matchId: fixture.matchId,
      legId: fixture.legId,
      throwerPlayerId: playerId,
      seat: 1,
      commandId: randomUUID(),
      sequence: fixture.nextSequence(),
      points: Number(points),
      appliedPoints: Number(points),
      dartsThrown: 3,
      scoreBefore: 501,
      scoreAfter: Math.max(0, 501 - Number(points)),
      outcome: "SCORED",
    })),
  );
  await databaseService.database.insert(visits).values(rows);
}

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Statistics Integration Club", slug: `statistics-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: secondOrganizationId, name: "Statistics Integration Club II", slug: `statistics-2-${secondOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId: secondOrganizationId, userId, role: "OWNER", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(players).values([
    { id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" },
    { id: playerTwoId, organizationId, displayName: "Player Two", status: "ACTIVE" },
    { id: playerThreeId, organizationId: secondOrganizationId, displayName: "Player Three", status: "ACTIVE" },
    { id: playerFourId, organizationId: secondOrganizationId, displayName: "Player Four", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, secondOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("frequent scores", () => {
  it("falls back to the default set for a player without visits", async () => {
    const result = await service.frequentScores({ organizationId, playerId: playerOneId, auth });
    expect(result.source).toBe("DEFAULT");
    expect(result.scores).toEqual([26, 41, 45, 60, 81, 85]);
  });

  it("rejects a player of another organization", async () => {
    await expect(
      service.frequentScores({ organizationId: otherOrganizationId, playerId: playerOneId, auth }),
    ).rejects.toThrow();
  });

  /**
   * 140/120/100/60 sind eindeutig haeufiger als der Rest, aber 45, 41 und 26
   * teilen sich mit Haeufigkeit 2 die letzten Plaetze vor `limit(6)`: drei
   * gleich haeufige Summen fuer nur zwei freie Plaetze. Ohne den Tie-Break
   * `asc(visits.points)` in der Repository-Query waere unbestimmt, welche
   * zwei davon den Schnitt schaffen - mit ihm muessen es 26 und 41 sein,
   * 45 faellt heraus.
   */
  it("prefers the player's own frequent scores once enough visits exist", async () => {
    const fixture = await createMatchFixture(organizationId);
    await insertVisits(fixture, organizationId, playerTwoId, { 140: 10, 120: 8, 100: 6, 60: 4, 45: 2, 41: 2, 26: 2 });

    const result = await service.frequentScores({ organizationId, playerId: playerTwoId, auth });

    expect(result.source).toBe("PLAYER");
    expect(result.scores).toEqual([26, 41, 60, 100, 120, 140]);
  });

  /**
   * Player Three wirft selbst zu wenige Aufnahmen (< 30 Visits insgesamt),
   * Player Four in derselben Organisation liefert die Masse. `frequentScores`
   * muss ueber beide Personen hinweg aggregieren - und dabei denselben
   * Gleichstand an der Auswahlgrenze (45/41/26, siehe Test oben) korrekt
   * aufloesen.
   */
  it("falls back to the organization's frequent scores when the player has too few visits", async () => {
    const fixture = await createMatchFixture(secondOrganizationId);
    await insertVisits(fixture, secondOrganizationId, playerFourId, { 140: 10, 120: 8, 100: 6, 60: 4 });
    await insertVisits(fixture, secondOrganizationId, playerThreeId, { 45: 2, 41: 2, 26: 2 });

    const result = await service.frequentScores({ organizationId: secondOrganizationId, playerId: playerThreeId, auth });

    expect(result.source).toBe("ORGANIZATION");
    expect(result.scores).toEqual([26, 41, 60, 100, 120, 140]);
  });
});
