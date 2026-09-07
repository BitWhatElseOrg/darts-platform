import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, organizations, players, tournaments, users } from "@darts-platform/database";

import { DEMO_PLAYER_NAMES, assertDevelopmentSeedAllowed, seedDevelopmentData } from "./seed-development.js";

describe("development seed guard", () => {
  it("rejects production and remote databases without the explicit override", () => {
    expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "production", databaseUrl: "postgresql://localhost/darts" }, false)).toThrow(/production/iu);
    expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "development", databaseUrl: "postgresql://db.example.test/darts" }, false)).toThrow(/non-local/iu);
  });

  it("allows local development databases", () => {
    expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "development", databaseUrl: "postgresql://127.0.0.1:5432/darts" }, false)).not.toThrow();
    expect(() => assertDevelopmentSeedAllowed({ nodeEnv: "test", databaseUrl: "postgresql://[::1]:5432/darts" }, false)).not.toThrow();
  });

  it("provides exactly 32 unique fictional players", () => {
    expect(DEMO_PLAYER_NAMES).toHaveLength(32);
    expect(new Set(DEMO_PLAYER_NAMES)).toHaveLength(32);
  });
});

describe("development demo seed", () => {
  const suffix = randomUUID();
  const profile = {
    email: `seed-${suffix}@example.test`,
    password: "SeedIntegration2026!",
    organizationName: `Seed Integration ${suffix}`,
    organizationSlug: `seed-integration-${suffix}`,
    tournamentPrefix: `Seed ${suffix}`,
  };
  const markerSlug = `seed-preserve-${suffix}`;
  const environment = parseApplicationEnvironment(process.env);
  const connection = createDatabaseConnection(environment.DATABASE_URL);

  beforeAll(async () => {
    await connection.database.insert(organizations).values({ name: "Seed preservation marker", slug: markerSlug, timezone: "Europe/Zurich", locale: "de-CH" });
  });

  afterAll(async () => {
    await connection.database.delete(organizations).where(inArray(organizations.slug, [profile.organizationSlug, markerSlug]));
    await connection.database.delete(users).where(eq(users.email, profile.email));
    await connection.close();
  });

  it("creates the complete profile twice without duplicates or deleting existing data", { timeout: 120_000 }, async () => {
    const first = await seedDevelopmentData({ environment, profile, allowRemote: true });
    const second = await seedDevelopmentData({ environment, profile, allowRemote: true });
    expect(first).toMatchObject({ players: 32, boards: 8, completedTournaments: 2, runningTournaments: 1 });
    expect(second).toEqual(first);

    const [organization] = await connection.database.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, profile.organizationSlug));
    if (organization === undefined) throw new Error("Seed organization missing.");
    expect(await connection.database.select().from(players).where(eq(players.organizationId, organization.id))).toHaveLength(32);
    const tournamentRows = await connection.database.select({ status: tournaments.status }).from(tournaments).where(and(eq(tournaments.organizationId, organization.id), inArray(tournaments.name, [`${profile.tournamentPrefix} Herbst-Cup`, `${profile.tournamentPrefix} Vereinsliga`, `${profile.tournamentPrefix} Open`])));
    expect(tournamentRows.filter((tournament) => tournament.status === "COMPLETED")).toHaveLength(2);
    expect(tournamentRows.filter((tournament) => tournament.status !== "COMPLETED")).toHaveLength(1);
    expect(await connection.database.select().from(organizations).where(eq(organizations.slug, markerSlug))).toHaveLength(1);
  });
});
