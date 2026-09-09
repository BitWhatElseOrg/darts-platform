import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { boards, competitions, encounters, encounterSlots, organizations, teams } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);
const organizationId = randomUUID();
let competitionId = "";
let homeTeamId = "";
let awayTeamId = "";
let encounterId = "";
let boardId = "";

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Testverein Slot-Constraint",
    slug: `slot-constraint-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });

  const [competition] = await database
    .insert(competitions)
    .values({ organizationId, type: "LEAGUE", name: "Testliga", slug: `testliga-${organizationId.slice(0, 8)}`, status: "ACTIVE" })
    .returning();
  competitionId = competition!.id;

  const [home] = await database
    .insert(teams)
    .values({ organizationId, name: `Heim ${organizationId.slice(0, 8)}` })
    .returning();
  homeTeamId = home!.id;

  const [away] = await database
    .insert(teams)
    .values({ organizationId, name: `Gast ${organizationId.slice(0, 8)}` })
    .returning();
  awayTeamId = away!.id;

  const [encounter] = await database
    .insert(encounters)
    .values({
      organizationId,
      competitionId,
      matchday: 1,
      homeTeamId,
      awayTeamId,
      scheduledAt: new Date(),
    })
    .returning();
  encounterId = encounter!.id;

  const [board] = await database
    .insert(boards)
    .values({ organizationId, name: `Board Slot-Constraint ${organizationId.slice(0, 8)}` })
    .returning();
  boardId = board!.id;
});

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await close();
});

describe("encounter_slots_board_status_check", () => {
  it("verweigert ein belegtes Board ausserhalb von IN_PROGRESS", async () => {
    try {
      await database.insert(encounterSlots).values({
        organizationId,
        encounterId,
        sequence: 1,
        role: "REGULAR",
        discipline: "SINGLES",
        label: "Slot 1",
        homePosition: 1,
        awayPosition: 1,
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        bestOfLegs: 3,
        legsToWinSet: 2,
        setsToWin: 1,
        status: "WAITING",
        boardId,
      });
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("encounter_slots_board_status_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });

  it("erlaubt ein belegtes Board waehrend IN_PROGRESS", async () => {
    const [slot] = await database
      .insert(encounterSlots)
      .values({
        organizationId,
        encounterId,
        sequence: 2,
        role: "REGULAR",
        discipline: "SINGLES",
        label: "Slot 2",
        homePosition: 2,
        awayPosition: 2,
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        bestOfLegs: 3,
        legsToWinSet: 2,
        setsToWin: 1,
        status: "IN_PROGRESS",
        boardId,
      })
      .returning();

    expect(slot?.boardId).toBe(boardId);
  });
});
