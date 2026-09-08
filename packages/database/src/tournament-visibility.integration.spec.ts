import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { organizations, tournaments } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);

const organizationId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Testverein Migration",
    slug: `migration-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await close();
});

function tournamentValues() {
  return {
    organizationId,
    name: "Migrationsturnier",
    format: "GROUPS_THEN_KNOCKOUT",
    groupCount: 1,
    qualifyPerGroup: 2,
    knockoutSize: 2,
    seeding: "RANDOM",
    startsAt: new Date(),
  } as const;
}

describe("tournaments.public_id und visibility", () => {
  it("vergibt jeder Zeile eine eigene public_id", async () => {
    const [first] = await database.insert(tournaments).values(tournamentValues()).returning();
    const [second] = await database.insert(tournaments).values(tournamentValues()).returning();

    expect(first?.publicId).toBeDefined();
    expect(second?.publicId).toBeDefined();
    expect(first?.publicId).not.toBe(second?.publicId);
    expect(first?.publicId).not.toBe(first?.id);
  });

  it("legt ein neues Turnier privat an", async () => {
    const [created] = await database.insert(tournaments).values(tournamentValues()).returning();

    expect(created?.visibility).toBe("PRIVATE");
  });

  it("laesst keine andere Sichtbarkeit als PRIVATE oder PUBLIC zu", async () => {
    try {
      await database.insert(tournaments).values({ ...tournamentValues(), visibility: "UNLISTED" });
    } catch (error) {
      // Drizzle/postgres-js legen die Postgres-Fehlermeldung in `error.cause`
      // ab, waehrend `error.message` nur "Failed query: …" enthaelt — dem
      // Muster aus tournaments.integration.spec.ts (expectLockTimeout) folgend
      // wird auf der Ursache geprueft.
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("tournaments_visibility_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });
});
