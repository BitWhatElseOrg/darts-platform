import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { memberships, organizations, players, users } from "@darts-platform/database";
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
const matches = new MatchesRepository(databaseService);
const service = new StatisticsService(repository, matches, access);
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const userId = randomUUID();
const playerOneId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `statistics-${userId}@example.test`, name: "Statistics Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database.insert(organizations).values({ id: organizationId, name: "Statistics Integration Club", slug: `statistics-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(players).values({ id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
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
});
