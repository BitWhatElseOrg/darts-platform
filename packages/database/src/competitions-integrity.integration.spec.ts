import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { competitions, organizations } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);
const organizationId = randomUUID();

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await close();
});

describe("competitions_min_nominations_shorthanded_lineup_check", () => {
  it("verweigert ein Unterbesetzungs-Minimum ueber der Kaderposition", async () => {
    await database.insert(organizations).values({
      id: organizationId,
      name: "Testverein Competition-Constraint",
      slug: `competition-constraint-${organizationId.slice(0, 8)}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });

    try {
      await database.insert(competitions).values({
        organizationId,
        type: "LEAGUE",
        name: "Testliga",
        slug: `testliga-${organizationId.slice(0, 8)}`,
        status: "ACTIVE",
        lineupPositions: 4,
        minNominations: 5,
        minNominationsShorthanded: 5,
      });
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("competitions_min_nominations_shorthanded_lineup_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });
});
