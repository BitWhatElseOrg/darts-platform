import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { organizations, players, users } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);

const firstOrganizationId = randomUUID();
const secondOrganizationId = randomUUID();
const userId = randomUUID();

function organizationValues(id: string, suffix: string) {
  return {
    id,
    name: `Testverein Verknuepfung ${suffix}`,
    slug: `verknuepfung-${id.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  } as const;
}

function playerValues(organizationId: string, displayName: string) {
  return {
    organizationId,
    displayName,
    status: "ACTIVE",
  } as const;
}

beforeAll(async () => {
  await database
    .insert(organizations)
    .values([
      organizationValues(firstOrganizationId, "A"),
      organizationValues(secondOrganizationId, "B"),
    ]);
  await database.insert(users).values({
    id: userId,
    email: `verknuepfung-${userId.slice(0, 8)}@example.invalid`,
    displayName: "Testkonto Verknuepfung",
    emailVerified: true,
  });
});

afterAll(async () => {
  await database
    .delete(organizations)
    .where(sql`${organizations.id} in (${firstOrganizationId}, ${secondOrganizationId})`);
  await database.delete(users).where(eq(users.id, userId));
  await close();
});

describe("players.user_id", () => {
  it("laesst beliebig viele Spieler ohne Konto zu", async () => {
    const inserted = await database
      .insert(players)
      .values([
        playerValues(firstOrganizationId, "Ohne Konto Eins"),
        playerValues(firstOrganizationId, "Ohne Konto Zwei"),
      ])
      .returning({ id: players.id, userId: players.userId });

    expect(inserted).toHaveLength(2);
    expect(inserted.every((player) => player.userId === null)).toBe(true);
  });

  it("verhindert zwei Spieler derselben Organisation mit demselben Konto", async () => {
    await database
      .insert(players)
      .values({ ...playerValues(firstOrganizationId, "Verknuepft"), userId });

    await expect(
      database
        .insert(players)
        .values({ ...playerValues(firstOrganizationId, "Doppelt verknuepft"), userId }),
    ).rejects.toMatchObject({
      // Drizzle verpackt den Postgres-Fehler; der Code steht in `cause`.
      cause: { code: "23505", constraint_name: "players_organization_user_unique" },
    });
  });

  it("erlaubt dasselbe Konto in einer anderen Organisation", async () => {
    const [player] = await database
      .insert(players)
      .values({ ...playerValues(secondOrganizationId, "Verknuepft anderswo"), userId })
      .returning({ userId: players.userId });

    expect(player?.userId).toBe(userId);
  });

  it("loest die Verknuepfung beim Loeschen des Kontos, ohne den Spieler zu entfernen", async () => {
    const throwawayUserId = randomUUID();
    await database.insert(users).values({
      id: throwawayUserId,
      email: `entfernt-${throwawayUserId.slice(0, 8)}@example.invalid`,
      displayName: "Zu loeschendes Konto",
      emailVerified: true,
    });
    const [player] = await database
      .insert(players)
      .values({
        ...playerValues(firstOrganizationId, "Bleibt bestehen"),
        userId: throwawayUserId,
      })
      .returning({ id: players.id });

    await database.delete(users).where(eq(users.id, throwawayUserId));

    const [remaining] = await database
      .select({ id: players.id, userId: players.userId, status: players.status })
      .from(players)
      .where(eq(players.id, player?.id ?? ""));

    expect(remaining).toMatchObject({ userId: null, status: "ACTIVE" });
  });
});
