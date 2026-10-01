import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { organizations, players, tournaments, users } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Constraint-Integrationstests. Lokale Infrastruktur starten und .env laden.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);

const organizationId = randomUUID();
const userId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Testverein Vereinsduell",
    slug: `club-duel-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await database.insert(users).values({
    id: userId,
    email: `club-duel-${userId}@example.test`,
    displayName: "Konto",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await database.delete(users).where(eq(users.id, userId));
  await close();
});

/** Drizzle verpackt den Postgres-Fehler; der Constraint-Name steht in der Ursache. */
async function rejectionText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    return `${error instanceof Error ? error.message : String(error)} ${cause}`;
  }
  throw new Error("Einfuegen haette scheitern muessen.");
}

describe("Vereinsduell-Constraints", () => {
  it("ein Gast braucht einen Vereinsnamen und darf kein Konto tragen", async () => {
    expect(
      await rejectionText(
        database.insert(players).values({ organizationId, displayName: "Gast ohne Verein", status: "ACTIVE", kind: "GUEST" }),
      ),
    ).toMatch(/players_guest_club_name_check/);
    expect(
      await rejectionText(
        database.insert(players).values({ organizationId, displayName: "Gast mit Konto", status: "ACTIVE", kind: "GUEST", guestClubName: "DC Musterdorf", userId }),
      ),
    ).toMatch(/players_guest_no_account_check/);
    expect(
      await rejectionText(
        database.insert(players).values({ organizationId, displayName: "Mitglied mit Gastverein", status: "ACTIVE", kind: "MEMBER", guestClubName: "DC Musterdorf" }),
      ),
    ).toMatch(/players_guest_club_name_check/);
  });

  it("ein Vereinsduell braucht Vereinsnamen, Runden und Finalrunde; andere Formate duerfen sie nicht tragen", async () => {
    const base = {
      organizationId,
      name: "Duell",
      format: "CLUB_DUEL",
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 2,
      seeding: "SEEDED",
      startsAt: new Date(),
    } as const;
    expect(await rejectionText(database.insert(tournaments).values({ ...base }))).toMatch(
      /tournaments_club_duel_settings_check/,
    );
    expect(
      await rejectionText(
        database.insert(tournaments).values({ ...base, sideAName: "VFC", sideBName: "DC", qualifyingRounds: 16, finalRoundSize: 4 }),
      ),
    ).toMatch(/tournaments_qualifying_rounds_check/);
    expect(
      await rejectionText(
        database.insert(tournaments).values({ ...base, format: "ROUND_ROBIN", sideAName: "VFC", sideBName: "DC", qualifyingRounds: 4, finalRoundSize: 4 }),
      ),
    ).toMatch(/tournaments_club_duel_settings_check/);
    const [created] = await database
      .insert(tournaments)
      .values({ ...base, sideAName: "VFC", sideBName: "DC", qualifyingRounds: 4, finalRoundSize: 4 })
      .returning();
    expect(created?.thirdPlaceMatch).toBe(true);
    expect(created?.status).toBe("READY");
  });
});
