import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import {
  organizations,
  players,
  tournamentGroups,
  tournamentMatches,
  tournamentParticipants,
  tournamentStages,
  tournaments,
  users,
} from "./schema.js";

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

  async function newTournament() {
    const [tournament] = await database
      .insert(tournaments)
      .values({
        organizationId, name: "Rundenindex", format: "CLUB_DUEL", groupCount: 1, qualifyPerGroup: 1, knockoutSize: 2,
        seeding: "SEEDED", startsAt: new Date(), sideAName: "VFC", sideBName: "DC", qualifyingRounds: 2, finalRoundSize: 2,
      })
      .returning();
    const [stage] = await database
      .insert(tournamentStages)
      .values({ organizationId, tournamentId: tournament?.id ?? "", key: "qualifying", sequence: 1, name: "Quali", type: "CLUB_SWISS", status: "OPEN" })
      .returning();
    const created = await database
      .insert(players)
      .values(["Eins", "Zwei", "Drei"].map((displayName) => ({ organizationId, displayName, status: "ACTIVE" })))
      .returning();
    if (tournament === undefined || stage === undefined) throw new Error("Setup fehlgeschlagen.");
    return { tournament, stage, playerIds: created.map((player) => player.id) };
  }

  function matchValues(setup: Awaited<ReturnType<typeof newTournament>>, key: string, extra: Partial<typeof tournamentMatches.$inferInsert>) {
    return {
      organizationId,
      tournamentId: setup.tournament.id,
      stageId: setup.stage.id,
      key,
      stageLabel: "Quali · Runde 1",
      round: 1,
      position: 1,
      status: "READY",
      ...extra,
    };
  }

  it("ein Spieler steht je Stage und Runde nur einmal als participant_one", async () => {
    const setup = await newTournament();
    const [one, two, three] = setup.playerIds;
    await database.insert(tournamentMatches).values(matchValues(setup, "m1", { participantOneId: one ?? null, participantTwoId: two ?? null }));
    expect(
      await rejectionText(database.insert(tournamentMatches).values(matchValues(setup, "m2", { position: 2, participantOneId: one ?? null, participantTwoId: three ?? null }))),
    ).toMatch(/tournament_matches_stage_round_participant_one_unique/);
    // andere Runde: erlaubt
    await database.insert(tournamentMatches).values(matchValues(setup, "m3", { round: 2, participantOneId: one ?? null, participantTwoId: three ?? null }));
  });

  it("ein Spieler steht je Stage und Runde nur einmal als participant_two", async () => {
    const setup = await newTournament();
    const [one, two, three] = setup.playerIds;
    await database.insert(tournamentMatches).values(matchValues(setup, "m1", { participantOneId: one ?? null, participantTwoId: two ?? null }));
    expect(
      await rejectionText(database.insert(tournamentMatches).values(matchValues(setup, "m2", { position: 2, participantOneId: three ?? null, participantTwoId: two ?? null }))),
    ).toMatch(/tournament_matches_stage_round_participant_two_unique/);
  });

  it("abgesagte Matches blockieren den Spieler in der Runde nicht", async () => {
    const setup = await newTournament();
    const [one, two, three] = setup.playerIds;
    await database.insert(tournamentMatches).values(matchValues(setup, "m1", { status: "CANCELLED", participantOneId: one ?? null, participantTwoId: two ?? null }));
    await database.insert(tournamentMatches).values(matchValues(setup, "m2", { position: 2, participantOneId: one ?? null, participantTwoId: three ?? null }));
    // und umgekehrt: ein abgesagtes Match darf neben einem aktiven stehen
    await database.insert(tournamentMatches).values(matchValues(setup, "m3", { position: 3, status: "CANCELLED", participantOneId: one ?? null, participantTwoId: three ?? null }));
  });

  it("in Gruppen darf derselbe Spieler je Runde mehrfach stehen (group_id gesetzt)", async () => {
    const setup = await newTournament();
    const [one, two, three] = setup.playerIds;
    const [group] = await database
      .insert(tournamentGroups)
      .values({ organizationId, tournamentId: setup.tournament.id, stageId: setup.stage.id, key: "g1", label: "A", sequence: 1, qualifyCount: 1 })
      .returning();
    const groupId = group?.id ?? null;
    await database.insert(tournamentMatches).values(matchValues(setup, "g1:m1", { groupId, participantOneId: one ?? null, participantTwoId: two ?? null }));
    await database.insert(tournamentMatches).values(matchValues(setup, "g1:m2", { groupId, position: 2, participantOneId: one ?? null, participantTwoId: three ?? null }));
  });

  it("die Seite eines Teilnehmers ist A, B oder leer", async () => {
    const setup = await newTournament();
    const [one, two, three] = setup.playerIds;
    const base = { organizationId, tournamentId: setup.tournament.id };
    await database.insert(tournamentParticipants).values({ ...base, playerId: one ?? "", seed: 1, side: "A" });
    await database.insert(tournamentParticipants).values({ ...base, playerId: two ?? "", seed: 2, side: null });
    expect(
      await rejectionText(database.insert(tournamentParticipants).values({ ...base, playerId: three ?? "", seed: 3, side: "C" })),
    ).toMatch(/tournament_participants_side_check/);
  });
});
