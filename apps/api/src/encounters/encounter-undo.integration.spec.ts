import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { buildEncounterTemplate } from "@darts-platform/league-engine";
import {
  auditEvents,
  boards,
  encounterLineupEntries,
  encounterSlots,
  encounters,
  matches as matchesTable,
  memberships,
  organizations,
  outboxEvents,
  players,
  teamPlayers,
  teams,
  users,
} from "@darts-platform/database";
import type { CompetitionSlotInput, EncounterDetail, EncounterSide } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { CompetitionsRepository } from "../competitions/competitions.repository.js";
import { CompetitionsService } from "../competitions/competitions.service.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { EncountersRepository } from "./encounters.repository.js";
import { EncountersService } from "./encounters.service.js";

/**
 * Undo auf ein beendetes Liga-Match. Bis hierher öffnete es nur das Match
 * wieder; der Slot blieb COMPLETED mit dem alten Resultat, und der nächste
 * Checkout erreichte ihn nicht mehr. Jetzt öffnet das Undo den Slot mit,
 * solange die Begegnung läuft und kein Entscheidungsdoppel angesetzt ist.
 */

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const competitionsService = new CompetitionsService(new CompetitionsRepository(databaseService), access);
const encountersService = new EncountersService(new EncountersRepository(databaseService), access);
const matchesService = new MatchesService(new MatchesRepository(databaseService), access);

const organizationId = randomUUID();
const userId = randomUUID();
const homePlayerIds = Array.from({ length: 5 }, () => randomUUID());
const awayPlayerIds = Array.from({ length: 5 }, () => randomUUID());
const boardIds = [randomUUID(), randomUUID()];
const homeTeamId = randomUUID();
const awayTeamId = randomUUID();

const auth: AuthContext = {
  user: { id: userId, email: `undo-${userId}@example.test`, name: "Undo Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

async function createCompetition(): Promise<string> {
  const competition = await competitionsService.create({
    organizationId,
    data: {
      type: "LEAGUE",
      name: `Undo-Liga ${randomUUID().slice(0, 8)}`,
      slug: `undo-liga-${randomUUID()}`,
      status: "ACTIVE",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsDeciderBonus: 1,
      deciderRule: "EXTRA_SLOT",
      lineupPositions: 4,
      minNominations: 4,
      minNominationsShorthanded: 3,
      maxSubstitutionsPerEncounter: 4,
      maxDoublesPerPlayer: 1,
      slots: buildEncounterTemplate({
        lineupPositions: 4,
        singlesStartingScore: 301,
        doublesStartingScore: 301,
        inRule: "STRAIGHT",
        outRule: "SINGLE",
        bestOfLegs: 1,
        maxRounds: null,
        regularDoubles: 2,
        withDecider: true,
      }) as CompetitionSlotInput[],
    },
    auth,
    audit,
  });
  return competition.id;
}

async function openEncounter(): Promise<EncounterDetail> {
  const competitionId = await createCompetition();
  let encounter = await encountersService.schedule({
    organizationId,
    competitionId,
    data: {
      matchday: 1,
      homeTeamId,
      awayTeamId,
      scheduledAt: new Date("2026-09-11T19:30:00.000Z"),
      venue: "Clublokal",
    },
    auth,
    audit,
  });
  for (const [side, ids] of [
    ["HOME", homePlayerIds],
    ["AWAY", awayPlayerIds],
  ] as const) {
    encounter = await encountersService.submitNominations({
      organizationId,
      encounterId: encounter.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: encounter.version,
        side,
        nominations: ids.slice(0, 4).map((playerId, index) => ({
          position: index + 1,
          playerId,
          origin: "SQUAD" as const,
        })),
      },
      auth,
      audit,
    });
  }
  return encountersService.start({
    organizationId,
    encounterId: encounter.id,
    data: { commandId: randomUUID(), expectedVersion: encounter.version },
    auth,
    audit,
  });
}

async function walkover(
  encounter: EncounterDetail,
  sequence: number,
  winnerSide: EncounterSide,
): Promise<EncounterDetail> {
  const slot = encounter.slots.find((entry) => entry.sequence === sequence);
  if (slot === undefined) throw new Error(`Slot ${sequence} is missing.`);
  return encountersService.declareSlotWalkover({
    organizationId,
    encounterId: encounter.id,
    slotId: slot.id,
    data: {
      commandId: randomUUID(),
      expectedVersion: encounter.version,
      winnerSide,
      reason: "Nicht an der Abwurflinie erschienen.",
    },
    auth,
    audit,
  });
}

async function submitDoubles(
  encounter: EncounterDetail,
  sequence: number,
  home: readonly [string, string],
  away: readonly [string, string],
): Promise<EncounterDetail> {
  let current = encounter;
  for (const [side, playerIds] of [
    ["HOME", home],
    ["AWAY", away],
  ] as const) {
    current = await encountersService.submitDoubles({
      organizationId,
      encounterId: current.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: current.version,
        side,
        pairings: [{ sequence, playerIds: [...playerIds] }],
      },
      auth,
      audit,
    });
  }
  return current;
}

async function assign(encounter: EncounterDetail, sequence: number, boardId: string): Promise<string> {
  const slot = encounter.slots.find((entry) => entry.sequence === sequence);
  if (slot === undefined) throw new Error(`Slot ${sequence} is missing.`);
  const assigned = await encountersService.assignSlot({
    organizationId,
    encounterId: encounter.id,
    slotId: slot.id,
    data: { commandId: randomUUID(), expectedVersion: encounter.version, boardId },
    auth,
    audit,
  });
  const matchId = assigned.slots.find((entry) => entry.sequence === sequence)?.matchId;
  if (matchId === null || matchId === undefined) throw new Error("Expected a scoring match.");
  return matchId;
}

/** Spielt ein Match bis zum Sieg der gewünschten Seite aus. */
async function playOut(matchId: string, winnerSide: EncounterSide): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const state = await matchesService.get({ organizationId, matchId, auth });
    if (state.status === "COMPLETED") return;
    const active = state.participants.find((participant) => participant.isActive);
    const thrower = active?.players.find((player) => player.isThrowing);
    if (active === undefined || thrower === undefined) throw new Error("Expected an active thrower.");
    const winnerIsThrowing = (active.seat === 1) === (winnerSide === "HOME");
    const points = winnerIsThrowing
      ? Math.min(active.remaining, 180)
      : active.remaining <= 180
        ? 1
        : 180;
    await matchesService.submitVisit({
      organizationId,
      matchId,
      data: { commandId: randomUUID(), expectedVersion: state.version, playerId: thrower.playerId, points, dartsThrown: 3 },
      auth,
      audit,
    });
  }
  throw new Error("The match did not finish within the expected number of visits.");
}

async function undo(matchId: string): Promise<unknown> {
  const state = await matchesService.get({ organizationId, matchId, auth });
  return matchesService.undo({
    organizationId,
    matchId,
    data: { commandId: randomUUID(), expectedVersion: state.version },
    auth,
    audit,
  });
}

async function slotRow(slotId: string): Promise<typeof encounterSlots.$inferSelect> {
  const [row] = await databaseService.database
    .select()
    .from(encounterSlots)
    .where(and(eq(encounterSlots.organizationId, organizationId), eq(encounterSlots.id, slotId)));
  if (row === undefined) throw new Error("Slot row is missing.");
  return row;
}

async function encounterRow(encounterId: string): Promise<typeof encounters.$inferSelect> {
  const [row] = await databaseService.database
    .select()
    .from(encounters)
    .where(and(eq(encounters.organizationId, organizationId), eq(encounters.id, encounterId)));
  if (row === undefined) throw new Error("Encounter row is missing.");
  return row;
}

async function matchRow(matchId: string): Promise<typeof matchesTable.$inferSelect> {
  const [row] = await databaseService.database
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.organizationId, organizationId), eq(matchesTable.id, matchId)));
  if (row === undefined) throw new Error("Match row is missing.");
  return row;
}

async function reopenedEvents(encounterId: string): Promise<readonly unknown[]> {
  const rows = await databaseService.database
    .select({ payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.organizationId, organizationId),
        eq(outboxEvents.aggregateId, encounterId),
        eq(outboxEvents.eventType, "ENCOUNTER_SLOT_REOPENED"),
      ),
    );
  return rows.map((row) => row.payload);
}

function slotIdOf(encounter: EncounterDetail, sequence: number): string {
  const slot = encounter.slots.find((entry) => entry.sequence === sequence);
  if (slot === undefined) throw new Error(`Slot ${sequence} is missing.`);
  return slot.id;
}

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database
    .insert(organizations)
    .values({ id: organizationId, name: "Undo Club", slug: `undo-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(players).values([
    ...homePlayerIds.map((id, index) => ({ id, organizationId, displayName: `Heim ${index + 1}`, status: "ACTIVE" })),
    ...awayPlayerIds.map((id, index) => ({ id, organizationId, displayName: `Gast ${index + 1}`, status: "ACTIVE" })),
  ]);
  await databaseService.database
    .insert(boards)
    .values(boardIds.map((id, index) => ({ id, organizationId, name: `Undo Board ${index + 1}` })));
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId.slice(0, 8)}`, status: "ACTIVE" },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId.slice(0, 8)}`, status: "ACTIVE" },
  ]);
  const validFrom = new Date("2020-01-01T00:00:00.000Z");
  await databaseService.database.insert(teamPlayers).values([
    ...homePlayerIds.map((playerId) => ({ organizationId, teamId: homeTeamId, playerId, role: "PLAYER", validFrom })),
    ...awayPlayerIds.map((playerId) => ({ organizationId, teamId: awayTeamId, playerId, role: "PLAYER", validFrom })),
  ]);
});

/** Laufende Spiele eines Tests dürfen den nächsten nicht blockieren. */
afterEach(async () => {
  await databaseService.database
    .update(encounterSlots)
    .set({ status: "CANCELLED", boardId: null, matchId: null })
    .where(and(eq(encounterSlots.organizationId, organizationId), eq(encounterSlots.status, "IN_PROGRESS")));
  await databaseService.database
    .update(matchesTable)
    .set({ status: "ABORTED", boardId: null, currentSeat: null })
    .where(and(eq(matchesTable.organizationId, organizationId), eq(matchesTable.status, "IN_PROGRESS")));
  await databaseService.database.update(boards).set({ status: "AVAILABLE" }).where(eq(boards.organizationId, organizationId));
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("undo of a completed league match", () => {
  it("reopens the slot while the encounter is running and takes the corrected result", async () => {
    let encounter = await openEncounter();
    const slotId = slotIdOf(encounter, 1);
    const matchId = await assign(encounter, 1, boardIds[0]!);
    await playOut(matchId, "HOME");

    const completedSlot = await slotRow(slotId);
    expect(completedSlot).toMatchObject({ status: "COMPLETED", winnerSide: "HOME", homeLegs: 1, awayLegs: 0, boardId: null });
    expect(await encounterRow(encounter.id)).toMatchObject({ status: "RUNNING", homeGames: 1, homeLegs: 1 });

    await undo(matchId);

    expect(await matchRow(matchId)).toMatchObject({ status: "IN_PROGRESS", boardId: boardIds[0] });
    const reopened = await slotRow(slotId);
    expect(reopened).toMatchObject({
      status: "IN_PROGRESS",
      boardId: boardIds[0],
      matchId,
      winnerSide: null,
      resultType: null,
      completedAt: null,
      homeLegs: 0,
      awayLegs: 0,
      version: completedSlot.version + 1,
    });
    expect(await encounterRow(encounter.id)).toMatchObject({
      status: "RUNNING",
      homeGames: 0,
      awayGames: 0,
      homeLegs: 0,
      awayLegs: 0,
    });
    expect(await reopenedEvents(encounter.id)).toEqual([
      { encounterId: encounter.id, slotId, sequence: 1, matchId },
    ]);
    const audits = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, slotId),
          eq(auditEvents.action, "ENCOUNTER_SLOT_REOPENED"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: userId,
      actorDeviceId: null,
      entityType: "EncounterSlot",
      correlationId: audit.correlationId,
      ip: audit.ip,
      userAgent: audit.userAgent,
      oldValue: { id: slotId, status: "COMPLETED", winnerSide: "HOME", resultType: "PLAYED", homeLegs: 1 },
      newValue: { id: slotId, status: "IN_PROGRESS", boardId: boardIds[0], winnerSide: null, resultType: null, homeLegs: 0 },
    });

    // Das korrigierte Resultat erreicht den Slot.
    await playOut(matchId, "AWAY");
    expect(await slotRow(slotId)).toMatchObject({
      status: "COMPLETED",
      resultType: "PLAYED",
      winnerSide: "AWAY",
      homeLegs: 0,
      awayLegs: 1,
      boardId: null,
    });
    encounter = await encountersService.get({ organizationId, encounterId: encounter.id, auth });
    expect(encounter).toMatchObject({ status: "RUNNING", homeGames: 0, awayGames: 1, awayLegs: 1 });
  });

  it("rejects the undo once the encounter is completed and changes nothing", async () => {
    let encounter = await openEncounter();
    for (let sequence = 1; sequence <= 17; sequence += 1) {
      encounter = await walkover(encounter, sequence, "HOME");
    }
    const slotId = slotIdOf(encounter, 18);
    const matchId = await assign(encounter, 18, boardIds[0]!);
    await playOut(matchId, "HOME");
    expect(await encounterRow(encounter.id)).toMatchObject({ status: "COMPLETED" });

    const matchBefore = await matchRow(matchId);
    const slotBefore = await slotRow(slotId);
    const encounterBefore = await encounterRow(encounter.id);

    await expect(undo(matchId)).rejects.toMatchObject({
      status: 400,
      response: { code: "ENCOUNTER_RESULT_REQUIRES_CORRECTION" },
    });

    expect(await matchRow(matchId)).toEqual(matchBefore);
    expect(await slotRow(slotId)).toEqual(slotBefore);
    expect(await encounterRow(encounter.id)).toEqual(encounterBefore);
    expect(await reopenedEvents(encounter.id)).toEqual([]);
  });

  it("rejects the undo of a regular slot once the decider is under way", async () => {
    let encounter = await openEncounter();
    // 8 + 1 gespieltes Doppel für Heim, 9 für Gast: das Entscheidungsdoppel wird nötig.
    for (let sequence = 1; sequence <= 8; sequence += 1) {
      encounter = await walkover(encounter, sequence, "HOME");
    }
    for (let sequence = 10; sequence <= 18; sequence += 1) {
      encounter = await walkover(encounter, sequence, "AWAY");
    }
    encounter = await submitDoubles(encounter, 9, [homePlayerIds[0]!, homePlayerIds[1]!], [awayPlayerIds[0]!, awayPlayerIds[1]!]);
    const regularSlotId = slotIdOf(encounter, 9);
    const regularMatchId = await assign(encounter, 9, boardIds[0]!);
    await playOut(regularMatchId, "HOME");

    encounter = await encountersService.get({ organizationId, encounterId: encounter.id, auth });
    expect(encounter).toMatchObject({ status: "RUNNING", homeGames: 9, awayGames: 9 });
    expect(encounter.decider.required).toBe(true);
    encounter = await submitDoubles(encounter, 19, [homePlayerIds[2]!, homePlayerIds[3]!], [awayPlayerIds[2]!, awayPlayerIds[3]!]);
    await assign(encounter, 19, boardIds[1]!);

    const matchBefore = await matchRow(regularMatchId);
    const slotBefore = await slotRow(regularSlotId);
    const encounterBefore = await encounterRow(encounter.id);

    await expect(undo(regularMatchId)).rejects.toMatchObject({
      status: 400,
      response: { code: "ENCOUNTER_RESULT_REQUIRES_CORRECTION" },
    });

    expect(await matchRow(regularMatchId)).toEqual(matchBefore);
    expect(await slotRow(regularSlotId)).toEqual(slotBefore);
    expect(await encounterRow(encounter.id)).toEqual(encounterBefore);
    expect(await reopenedEvents(encounter.id)).toEqual([]);
  });

  it("reopens a regular slot while the required decider still waits, keeping its pairing", async () => {
    let encounter = await openEncounter();
    for (let sequence = 1; sequence <= 8; sequence += 1) {
      encounter = await walkover(encounter, sequence, "HOME");
    }
    for (let sequence = 10; sequence <= 18; sequence += 1) {
      encounter = await walkover(encounter, sequence, "AWAY");
    }
    encounter = await submitDoubles(encounter, 9, [homePlayerIds[0]!, homePlayerIds[1]!], [awayPlayerIds[0]!, awayPlayerIds[1]!]);
    const regularSlotId = slotIdOf(encounter, 9);
    const regularMatchId = await assign(encounter, 9, boardIds[0]!);
    await playOut(regularMatchId, "HOME");
    encounter = await encountersService.get({ organizationId, encounterId: encounter.id, auth });
    expect(encounter.decider.required).toBe(true);
    // Doppel gemeldet, aber nicht angesetzt: der Decider steht im Ausgangszustand.
    encounter = await submitDoubles(encounter, 19, [homePlayerIds[2]!, homePlayerIds[3]!], [awayPlayerIds[2]!, awayPlayerIds[3]!]);
    const deciderSlotId = slotIdOf(encounter, 19);
    const lineupOfDecider = async (): Promise<readonly string[]> =>
      (
        await databaseService.database
          .select({ playerId: encounterLineupEntries.playerId })
          .from(encounterLineupEntries)
          .where(
            and(
              eq(encounterLineupEntries.organizationId, organizationId),
              eq(encounterLineupEntries.slotId, deciderSlotId),
            ),
          )
      ).map((row) => row.playerId).sort();
    const pairingBefore = await lineupOfDecider();
    expect(pairingBefore).toHaveLength(4);

    await undo(regularMatchId);

    expect(await slotRow(regularSlotId)).toMatchObject({ status: "IN_PROGRESS", winnerSide: null });
    expect(await slotRow(deciderSlotId)).toMatchObject({ status: "WAITING" });
    expect(await lineupOfDecider()).toEqual(pairingBefore);
    expect(await encounterRow(encounter.id)).toMatchObject({ status: "RUNNING", homeGames: 8, awayGames: 9 });

    // Ohne Gleichstand braucht es den Decider nicht mehr.
    await playOut(regularMatchId, "AWAY");
    expect(await slotRow(deciderSlotId)).toMatchObject({ status: "CANCELLED" });
    expect(await encounterRow(encounter.id)).toMatchObject({
      status: "COMPLETED",
      result: "AWAY_WIN",
      homeGames: 8,
      awayGames: 10,
    });
  });

  it("rejects the undo while a player of the match already plays on another board", async () => {
    let encounter = await openEncounter();
    const slotId = slotIdOf(encounter, 1);
    const matchId = await assign(encounter, 1, boardIds[0]!);
    await playOut(matchId, "HOME");
    encounter = await encountersService.get({ organizationId, encounterId: encounter.id, auth });

    // Das nächste Einzel derselben Heimposition läuft schon an Scheibe 2.
    const first = await slotRow(slotId);
    const [nextOfSamePlayer] = await databaseService.database
      .select()
      .from(encounterSlots)
      .where(
        and(
          eq(encounterSlots.organizationId, organizationId),
          eq(encounterSlots.encounterId, encounter.id),
          eq(encounterSlots.discipline, "SINGLES"),
          eq(encounterSlots.homePosition, first.homePosition ?? 0),
          ne(encounterSlots.id, slotId),
        ),
      )
      .orderBy(asc(encounterSlots.sequence))
      .limit(1);
    if (nextOfSamePlayer === undefined) throw new Error("Expected a second singles slot of the same position.");
    await assign(encounter, nextOfSamePlayer.sequence, boardIds[1]!);

    const matchBefore = await matchRow(matchId);
    const slotBefore = await slotRow(slotId);
    const encounterBefore = await encounterRow(encounter.id);

    await expect(undo(matchId)).rejects.toMatchObject({
      status: 409,
      response: { code: "PLAYER_BUSY" },
    });

    expect(await matchRow(matchId)).toEqual(matchBefore);
    expect(await slotRow(slotId)).toEqual(slotBefore);
    expect(await encounterRow(encounter.id)).toEqual(encounterBefore);
    expect(await reopenedEvents(encounter.id)).toEqual([]);
  });

  // B3-Ergaenzung (Nacharbeit-Brief Paket B, aus Review Paket A): der
  // Spielerbelegt-Einwand oben greift unabhaengig von einem Encounter-Slot --
  // dieselbe Pruefung lehnt auch das Undo eines FREIEN, slotlosen Matches ab,
  // wenn eine beteiligte Person laengst an einer anderen Scheibe steht.
  it("rejects the undo of a free match while one of its players already plays on another board", async () => {
    const created = await matchesService.create({
      organizationId,
      data: { playerOneId: homePlayerIds[4]!, playerTwoId: awayPlayerIds[4]!, boardId: boardIds[0]!, bestOfLegs: 1, bestOfSets: 1 },
      auth,
      audit,
    });
    // Freie Paarungen laufen 501 Double Out; derselbe Spielverlauf wie im
    // Fall "keeps reopening a free match without a slot as before" unten.
    let state = created;
    const scoring: readonly (readonly [string, number, number?])[] = [
      [homePlayerIds[4]!, 180],
      [awayPlayerIds[4]!, 60],
      [homePlayerIds[4]!, 180],
      [awayPlayerIds[4]!, 60],
      [homePlayerIds[4]!, 141, 12],
    ];
    for (const [playerId, points, checkoutDouble] of scoring) {
      state = await matchesService.submitVisit({
        organizationId,
        matchId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: state.version,
          playerId,
          points,
          dartsThrown: 3,
          ...(checkoutDouble === undefined ? {} : { checkoutDouble }),
        },
        auth,
        audit,
      });
    }
    expect(await matchRow(created.id)).toMatchObject({ status: "COMPLETED" });

    // Dieselbe Heimperson steht inzwischen an einer anderen Scheibe.
    await matchesService.create({
      organizationId,
      data: { playerOneId: homePlayerIds[4]!, playerTwoId: awayPlayerIds[3]!, boardId: boardIds[1]!, bestOfLegs: 1, bestOfSets: 1 },
      auth,
      audit,
    });

    const matchBefore = await matchRow(created.id);

    await expect(undo(created.id)).rejects.toMatchObject({
      status: 409,
      response: { code: "PLAYER_BUSY" },
    });

    expect(await matchRow(created.id)).toEqual(matchBefore);
  }, 30_000);

  // B3-Ergaenzung (Nacharbeit-Brief Paket B, aus Review Paket A): ein
  // inkonsistenter Stand -- Match COMPLETED, zugehoeriger Slot aber (noch)
  // nicht als gespielt abgeschlossen -- darf das Undo nicht still
  // durchlassen. Herbeigefuehrt per direktem Update in der Fixture, weil kein
  // regulaerer Ablauf diesen Zwischenstand erzeugt.
  it("rejects the undo with ENCOUNTER_RESULT_REQUIRES_CORRECTION when the matching slot is not completed as played", async () => {
    const encounter = await openEncounter();
    const slotId = slotIdOf(encounter, 1);
    const matchId = await assign(encounter, 1, boardIds[0]!);
    await playOut(matchId, "HOME");
    expect(await slotRow(slotId)).toMatchObject({ status: "COMPLETED", resultType: "PLAYED" });

    await databaseService.database
      .update(encounterSlots)
      .set({ status: "IN_PROGRESS", resultType: null, winnerSide: null, completedAt: null })
      .where(and(eq(encounterSlots.organizationId, organizationId), eq(encounterSlots.id, slotId)));

    const matchBefore = await matchRow(matchId);
    const slotBefore = await slotRow(slotId);
    const encounterBefore = await encounterRow(encounter.id);

    await expect(undo(matchId)).rejects.toMatchObject({
      status: 400,
      response: { code: "ENCOUNTER_RESULT_REQUIRES_CORRECTION" },
    });

    expect(await matchRow(matchId)).toEqual(matchBefore);
    expect(await slotRow(slotId)).toEqual(slotBefore);
    expect(await encounterRow(encounter.id)).toEqual(encounterBefore);
    expect(await reopenedEvents(encounter.id)).toEqual([]);
  });

  it("keeps reopening a free match without a slot as before", async () => {
    const created = await matchesService.create({
      organizationId,
      data: { playerOneId: homePlayerIds[4]!, playerTwoId: awayPlayerIds[4]!, boardId: boardIds[0]!, bestOfLegs: 1, bestOfSets: 1 },
      auth,
      audit,
    });
    // Freie Paarungen laufen 501 Double Out; der Abschluss braucht das Doppel.
    let state = created;
    const visits: readonly (readonly [string, number, number?])[] = [
      [homePlayerIds[4]!, 180],
      [awayPlayerIds[4]!, 60],
      [homePlayerIds[4]!, 180],
      [awayPlayerIds[4]!, 60],
      [homePlayerIds[4]!, 141, 12],
    ];
    for (const [playerId, points, checkoutDouble] of visits) {
      state = await matchesService.submitVisit({
        organizationId,
        matchId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: state.version,
          playerId,
          points,
          dartsThrown: 3,
          ...(checkoutDouble === undefined ? {} : { checkoutDouble }),
        },
        auth,
        audit,
      });
    }
    expect(await matchRow(created.id)).toMatchObject({ status: "COMPLETED" });

    await undo(created.id);

    expect(await matchRow(created.id)).toMatchObject({ status: "IN_PROGRESS", boardId: boardIds[0] });
  });
});
