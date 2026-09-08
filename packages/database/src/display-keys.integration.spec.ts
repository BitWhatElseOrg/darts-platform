import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { organizations, tournamentDisplayKeys, tournaments, users } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);

const organizationId = randomUUID();
const userId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Testverein Anzeige-Schluessel",
    slug: `anzeige-schluessel-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });

  await database.insert(users).values({
    id: userId,
    email: `anzeige-schluessel-${userId.slice(0, 8)}@example.test`,
    displayName: "Test Turnierleitung",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await database.delete(users).where(sql`${users.id} = ${userId}`);
  await close();
});

function tournamentValues() {
  return {
    organizationId,
    name: "Anzeige-Schluessel-Turnier",
    format: "GROUPS_THEN_KNOCKOUT",
    groupCount: 1,
    qualifyPerGroup: 2,
    knockoutSize: 2,
    seeding: "RANDOM",
    startsAt: new Date(),
  } as const;
}

function secretHash(seed: string) {
  return seed.padEnd(64, "0").slice(0, 64);
}

function displayKeyValues(tournamentId: string, secretHash_: string) {
  return {
    organizationId,
    tournamentId,
    secretHash: secretHash_,
    label: "Board 1",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdBy: userId,
  } as const;
}

describe("tournament_display_keys", () => {
  it("legt eine Zeile fuer ein Turnier an", async () => {
    const [tournament] = await database.insert(tournaments).values(tournamentValues()).returning();
    if (tournament === undefined) {
      throw new Error("Turnier wurde nicht angelegt.");
    }

    const [created] = await database
      .insert(tournamentDisplayKeys)
      .values(displayKeyValues(tournament.id, secretHash("row-created")))
      .returning();

    expect(created?.id).toBeDefined();
    expect(created?.tournamentId).toBe(tournament.id);
    expect(created?.organizationId).toBe(organizationId);
    expect(created?.label).toBe("Board 1");
    expect(created?.revokedAt).toBeNull();
  });

  it("weist einen zweiten Schluessel mit gleichem secret_hash ab", async () => {
    const [tournament] = await database.insert(tournaments).values(tournamentValues()).returning();
    if (tournament === undefined) {
      throw new Error("Turnier wurde nicht angelegt.");
    }
    const duplicateHash = secretHash("duplicate-hash");

    await database
      .insert(tournamentDisplayKeys)
      .values(displayKeyValues(tournament.id, duplicateHash))
      .returning();

    try {
      await database
        .insert(tournamentDisplayKeys)
        .values(displayKeyValues(tournament.id, duplicateHash));
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("tournament_display_keys_secret_hash_unique");
      return;
    }
    throw new Error("Erwartete eine verletzte Unique-Constraint.");
  });

  it("raeumt Schluessel beim Loeschen des Turniers mit (ON DELETE CASCADE)", async () => {
    const [tournament] = await database.insert(tournaments).values(tournamentValues()).returning();
    if (tournament === undefined) {
      throw new Error("Turnier wurde nicht angelegt.");
    }

    const [created] = await database
      .insert(tournamentDisplayKeys)
      .values(displayKeyValues(tournament.id, secretHash("cascade-delete")))
      .returning();
    if (created === undefined) {
      throw new Error("Anzeige-Schluessel wurde nicht angelegt.");
    }

    await database.delete(tournaments).where(sql`${tournaments.id} = ${tournament.id}`);

    const remaining = await database
      .select()
      .from(tournamentDisplayKeys)
      .where(sql`${tournamentDisplayKeys.id} = ${created.id}`);

    expect(remaining).toHaveLength(0);
  });
});
