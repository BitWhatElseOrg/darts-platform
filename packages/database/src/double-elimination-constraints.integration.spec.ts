import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { organizations, tournamentMatches, tournamentStages, tournaments } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for die Constraint-Integrationstests. Lokale Infrastruktur starten und .env laden.");
}
const { database, close } = createDatabaseConnection(databaseUrl);
const organizationId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId, name: "Testverein Doppel-KO", slug: `double-ko-${organizationId.slice(0, 8)}`, timezone: "Europe/Zurich", locale: "de-CH",
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await close();
});

async function rejectionText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    return `${error instanceof Error ? error.message : String(error)} ${cause}`;
  }
  throw new Error("Einfuegen haette scheitern muessen.");
}

async function createTournamentWithStage() {
  const [tournament] = await database.insert(tournaments).values({
    organizationId, name: `Doppel-KO ${randomUUID()}`, status: "KNOCKOUT", format: "DOUBLE_ELIMINATION",
    groupCount: 1, qualifyPerGroup: 1, knockoutSize: 8, seeding: "SEEDED", startsAt: new Date(),
  }).returning();
  if (tournament === undefined) throw new Error("no tournament");
  const [stage] = await database.insert(tournamentStages).values({
    organizationId, tournamentId: tournament.id, key: "lower", sequence: 2, name: "Verliererrunde", type: "DOUBLE_ELIMINATION_LOWER", status: "OPEN",
  }).returning();
  if (stage === undefined) throw new Error("no stage");
  return { tournament, stage };
}

describe("Doppel-K.-o.-Constraints", () => {
  it("akzeptiert Format und Stage-Typen", async () => {
    const { stage } = await createTournamentWithStage();
    expect(stage.type).toBe("DOUBLE_ELIMINATION_LOWER");
  });

  it("verlangt die Quellen-Art genau dann, wenn eine Quelle gesetzt ist", async () => {
    const { tournament, stage } = await createTournamentWithStage();
    const [source] = await database.insert(tournamentMatches).values({
      organizationId, tournamentId: tournament.id, stageId: stage.id, key: "lower:r1:m1", stageLabel: "Verliererrunde · Runde 1", round: 1, position: 1, status: "WAITING",
    }).returning();
    if (source === undefined) throw new Error("no source");
    expect(await rejectionText(database.insert(tournamentMatches).values({
      organizationId, tournamentId: tournament.id, stageId: stage.id, key: "lower:r2:m1", stageLabel: "x", round: 2, position: 1, status: "WAITING",
      sourceOneMatchId: source.id,
    }))).toMatch(/tournament_matches_source_one_kind_check/);
    expect(await rejectionText(database.insert(tournamentMatches).values({
      organizationId, tournamentId: tournament.id, stageId: stage.id, key: "lower:r2:m2", stageLabel: "x", round: 2, position: 2, status: "WAITING",
      sourceTwoKind: "LOSER",
    }))).toMatch(/tournament_matches_source_two_kind_check/);
    expect(await rejectionText(database.insert(tournamentMatches).values({
      organizationId, tournamentId: tournament.id, stageId: stage.id, key: "lower:r2:m3", stageLabel: "x", round: 2, position: 3, status: "WAITING",
      sourceOneMatchId: source.id, sourceOneKind: "DRAW",
    }))).toMatch(/tournament_matches_source_one_kind_check/);
    const [valid] = await database.insert(tournamentMatches).values({
      organizationId, tournamentId: tournament.id, stageId: stage.id, key: "lower:r2:m4", stageLabel: "x", round: 2, position: 4, status: "WAITING",
      sourceOneMatchId: source.id, sourceOneKind: "LOSER",
    }).returning();
    expect(valid?.sourceOneKind).toBe("LOSER");
  });
});
