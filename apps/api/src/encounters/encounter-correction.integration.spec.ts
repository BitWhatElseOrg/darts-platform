import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { buildEncounterTemplate } from "@darts-platform/league-engine";
import {
  auditEvents,
  boards,
  encounterSlots,
  encounters,
  legs,
  matchParticipantPlayers,
  matches as matchesTable,
  memberships,
  organizations,
  outboxEvents,
  players,
  teamPlayers,
  teams,
  users,
  visits,
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
 * Korrektur von Liga-Resultaten (Spec 2026-10-01-liga-resultatkorrektur):
 * die Leitung oeffnet ein gespieltes Spiel einer abgeschlossenen Begegnung
 * wieder, die letzte Aufnahme wird zurueckgenommen, und der naechste Checkout
 * schliesst Slot und Begegnung wieder ab.
 */

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const competitionsService = new CompetitionsService(new CompetitionsRepository(databaseService), access);
const matchesRepository = new MatchesRepository(databaseService);
const encountersService = new EncountersService(
  new EncountersRepository(databaseService),
  matchesRepository,
  access,
);
const matchesService = new MatchesService(matchesRepository, access);

const organizationId = randomUUID();
const userId = randomUUID();
const memberUserId = randomUUID();
const scorerUserId = randomUUID();
const homePlayerIds: string[] = Array.from({ length: 5 }, () => randomUUID());
const awayPlayerIds: string[] = Array.from({ length: 5 }, () => randomUUID());
const boardIds = [randomUUID(), randomUUID()];
const homeTeamId = randomUUID();
const awayTeamId = randomUUID();

function authOf(id: string, name: string): AuthContext {
  return {
    user: { id, email: `correction-${id}@example.test`, name },
    session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

const auth = authOf(userId, "Korrektur Owner");
const memberAuth = authOf(memberUserId, "Korrektur Mitglied");
const scorerAuth = authOf(scorerUserId, "Korrektur Schreiber");
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

type DeciderRule = "NONE" | "EXTRA_SLOT";

async function createCompetition(deciderRule: DeciderRule): Promise<string> {
  const competition = await competitionsService.create({
    organizationId,
    data: {
      type: "LEAGUE",
      name: `Korrektur-Liga ${randomUUID().slice(0, 8)}`,
      slug: `korrektur-liga-${randomUUID()}`,
      status: "ACTIVE",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      // Ohne Entscheidungsdoppel gibt es keinen Bonus (competitions_decider_bonus_rule_check).
      pointsDeciderBonus: deciderRule === "EXTRA_SLOT" ? 1 : 0,
      deciderRule,
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
        withDecider: deciderRule === "EXTRA_SLOT",
      }) as CompetitionSlotInput[],
    },
    auth,
    audit,
  });
  return competition.id;
}

async function openEncounter(deciderRule: DeciderRule = "NONE"): Promise<EncounterDetail> {
  const competitionId = await createCompetition(deciderRule);
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

async function reload(encounter: EncounterDetail): Promise<EncounterDetail> {
  return encountersService.get({ organizationId, encounterId: encounter.id, auth });
}

async function walkover(
  encounter: EncounterDetail,
  sequence: number,
  winnerSide: EncounterSide,
): Promise<EncounterDetail> {
  return encountersService.declareSlotWalkover({
    organizationId,
    encounterId: encounter.id,
    slotId: slotIdOf(encounter, sequence),
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

async function walkovers(
  encounter: EncounterDetail,
  sequences: readonly number[],
  winnerSide: EncounterSide,
): Promise<EncounterDetail> {
  let current = encounter;
  for (const sequence of sequences) current = await walkover(current, sequence, winnerSide);
  return current;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
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
  const assigned = await encountersService.assignSlot({
    organizationId,
    encounterId: encounter.id,
    slotId: slotIdOf(encounter, sequence),
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

function correct(
  encounter: EncounterDetail,
  slotId: string,
  overrides: { readonly commandId?: string; readonly expectedVersion?: number; readonly auth?: AuthContext } = {},
): Promise<EncounterDetail> {
  return encountersService.correctResult({
    organizationId,
    encounterId: encounter.id,
    data: {
      commandId: overrides.commandId ?? randomUUID(),
      expectedVersion: overrides.expectedVersion ?? encounter.version,
      slotId,
      reason: "Checkout falsch eingetragen.",
    },
    auth: overrides.auth ?? auth,
    audit,
  });
}

function slotIdOf(encounter: EncounterDetail, sequence: number): string {
  const slot = encounter.slots.find((entry) => entry.sequence === sequence);
  if (slot === undefined) throw new Error(`Slot ${sequence} is missing.`);
  return slot.id;
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

/** Das wieder geoeffnete Leg eines korrigierten Matches (genau eines ist `IN_PROGRESS`). */
async function reopenedLegRow(matchId: string): Promise<typeof legs.$inferSelect> {
  const [row] = await databaseService.database
    .select()
    .from(legs)
    .where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, matchId), eq(legs.status, "IN_PROGRESS")));
  if (row === undefined) throw new Error("Expected a reopened leg.");
  return row;
}

async function visitRows(matchId: string): Promise<(typeof visits.$inferSelect)[]> {
  return databaseService.database
    .select()
    .from(visits)
    .where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, matchId)))
    .orderBy(asc(visits.sequence));
}

async function eventsOf(aggregateId: string, eventType: string): Promise<unknown[]> {
  const rows = await databaseService.database
    .select({ payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.organizationId, organizationId),
        eq(outboxEvents.aggregateId, aggregateId),
        eq(outboxEvents.eventType, eventType),
      ),
    );
  return rows.map((row) => row.payload);
}

async function tableCount(table: typeof outboxEvents | typeof auditEvents): Promise<number> {
  const [row] = await databaseService.database
    .select({ value: count() })
    .from(table)
    .where(eq(table.organizationId, organizationId));
  return row?.value ?? 0;
}

/** Der gesamte Zustand, den eine abgelehnte Korrektur nicht berühren darf. */
async function snapshot(encounterId: string, matchId: string): Promise<unknown> {
  const slots = await databaseService.database
    .select()
    .from(encounterSlots)
    .where(and(eq(encounterSlots.organizationId, organizationId), eq(encounterSlots.encounterId, encounterId)))
    .orderBy(asc(encounterSlots.sequence));
  return {
    encounter: await encounterRow(encounterId),
    slots,
    match: await matchRow(matchId),
    visits: await visitRows(matchId),
    outbox: await tableCount(outboxEvents),
    audit: await tableCount(auditEvents),
  };
}

async function standingOf(encounter: EncounterDetail, teamId: string): Promise<{ played: number; won: number; drawn: number; lost: number; points: number }> {
  const standings = await competitionsService.standings({
    organizationId,
    competitionId: encounter.competitionId,
    auth,
  });
  const row = standings.rows.find((entry) => entry.teamId === teamId);
  if (row === undefined) throw new Error("Standings row is missing.");
  return { played: row.played, won: row.won, drawn: row.drawn, lost: row.lost, points: row.points };
}

/**
 * Begegnung ohne Entscheidungsdoppel: 9 kampflose Siege für Heim, 8 für Gast,
 * das letzte Einzel (18) wird gespielt und geht an Heim — 10:8.
 */
async function completedEncounter(): Promise<{
  readonly encounter: EncounterDetail;
  readonly slotId: string;
  readonly matchId: string;
}> {
  let encounter = await openEncounter("NONE");
  encounter = await walkovers(encounter, range(1, 9), "HOME");
  encounter = await walkovers(encounter, range(10, 17), "AWAY");
  const slotId = slotIdOf(encounter, 18);
  const matchId = await assign(encounter, 18, boardIds[0]!);
  await playOut(matchId, "HOME");
  encounter = await reload(encounter);
  expect(encounter).toMatchObject({ status: "COMPLETED", result: "HOME_WIN", homeGames: 10, awayGames: 8 });
  return { encounter, slotId, matchId };
}

/**
 * Gleichstand 9:9 nach den regulären Spielen, das letzte reguläre Einzel (18)
 * gespielt für Gast, danach das Entscheidungsdoppel (19) gespielt für Heim.
 */
async function deciderEncounter(): Promise<{
  readonly encounter: EncounterDetail;
  readonly regularSlotId: string;
  readonly regularMatchId: string;
  readonly deciderSlotId: string;
  readonly deciderMatchId: string;
}> {
  let encounter = await openEncounter("EXTRA_SLOT");
  encounter = await walkovers(encounter, range(1, 9), "HOME");
  encounter = await walkovers(encounter, range(10, 17), "AWAY");
  const regularSlotId = slotIdOf(encounter, 18);
  const regularMatchId = await assign(encounter, 18, boardIds[0]!);
  await playOut(regularMatchId, "AWAY");
  encounter = await reload(encounter);
  expect(encounter.decider.required).toBe(true);
  encounter = await submitDoubles(encounter, 19, [homePlayerIds[2]!, homePlayerIds[3]!], [awayPlayerIds[2]!, awayPlayerIds[3]!]);
  const deciderSlotId = slotIdOf(encounter, 19);
  const deciderMatchId = await assign(encounter, 19, boardIds[1]!);
  await playOut(deciderMatchId, "HOME");
  encounter = await reload(encounter);
  expect(encounter).toMatchObject({ status: "COMPLETED", result: "HOME_WIN", resultType: "DECIDER" });
  return { encounter, regularSlotId, regularMatchId, deciderSlotId, deciderMatchId };
}

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: memberUserId, email: memberAuth.user.email, displayName: memberAuth.user.name },
    { id: scorerUserId, email: scorerAuth.user.email, displayName: scorerAuth.user.name },
  ]);
  await databaseService.database
    .insert(organizations)
    .values({ id: organizationId, name: "Korrektur Club", slug: `korrektur-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
    { organizationId, userId: scorerUserId, role: "SCORER", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(players).values([
    ...homePlayerIds.map((id, index) => ({ id, organizationId, displayName: `Heim ${index + 1}`, status: "ACTIVE" })),
    ...awayPlayerIds.map((id, index) => ({ id, organizationId, displayName: `Gast ${index + 1}`, status: "ACTIVE" })),
  ]);
  await databaseService.database
    .insert(boards)
    .values(boardIds.map((id, index) => ({ id, organizationId, name: `Korrektur Board ${index + 1}` })));
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
  await databaseService.database.delete(users).where(inArray(users.id, [userId, memberUserId, scorerUserId]));
  await databaseService.onApplicationShutdown();
});

describe("result correction of a completed league encounter", () => {
  it("corrects the last game of a completed encounter and takes the new result", async () => {
    const { encounter, slotId, matchId } = await completedEncounter();
    const encounterBefore = await encounterRow(encounter.id);
    const slotBefore = await slotRow(slotId);
    const checkout = (await visitRows(matchId)).at(-1);
    if (checkout === undefined) throw new Error("Expected a checkout visit.");
    expect(await standingOf(encounter, homeTeamId)).toMatchObject({ played: 1, won: 1, points: 3 });

    const commandId = randomUUID();
    const corrected = await correct(encounter, slotId, { commandId });

    expect(corrected).toMatchObject({ status: "RUNNING", version: encounter.version + 1 });
    expect(corrected.slots.find((slot) => slot.id === slotId)).toMatchObject({
      status: "IN_PROGRESS",
      matchId,
      boardId: boardIds[0],
    });
    const encounterAfter = await encounterRow(encounter.id);
    expect(encounterAfter).toMatchObject({
      status: "RUNNING",
      result: null,
      resultType: null,
      homePoints: 0,
      awayPoints: 0,
      completedAt: null,
      homeGames: 9,
      awayGames: 8,
      version: encounterBefore.version + 1,
    });
    expect(await slotRow(slotId)).toMatchObject({
      status: "IN_PROGRESS",
      boardId: boardIds[0],
      winnerSide: null,
      resultType: null,
      homeLegs: 0,
      awayLegs: 0,
      completedAt: null,
      version: slotBefore.version + 1,
    });
    expect(await matchRow(matchId)).toMatchObject({ status: "IN_PROGRESS", winnerSeat: null, boardId: boardIds[0] });
    const [board] = await databaseService.database.select().from(boards).where(eq(boards.id, boardIds[0]!));
    expect(board?.status).toBe("IN_USE");
    const reverted = (await visitRows(matchId)).find((visit) => visit.id === checkout.id);
    expect(reverted?.revertedAt).not.toBeNull();
    expect(reverted?.revertedByCommandId).toBe(commandId);
    // `applyResultReopen` teilt sich denselben Zeitstempel mit der uebrigen
    // Korrektur (Befund 7): Visit-Ruecknahme und Leg-Wiedereroeffnung tragen
    // dasselbe `now` wie die Begegnung.
    expect(reverted?.revertedAt?.getTime()).toBe(encounterAfter.updatedAt.getTime());
    expect((await reopenedLegRow(matchId)).updatedAt.getTime()).toBe(encounterAfter.updatedAt.getTime());
    expect(await standingOf(encounter, homeTeamId)).toMatchObject({ played: 0, points: 0 });

    expect(await eventsOf(encounter.id, "ENCOUNTER_RESULT_CORRECTED")).toEqual([
      { encounterId: encounter.id, slotId, matchId, commandId, version: encounter.version + 1 },
    ]);
    expect(await eventsOf(encounter.id, "ENCOUNTER_SLOT_REOPENED")).toEqual([
      { encounterId: encounter.id, slotId, sequence: 18, matchId },
    ]);
    const audits = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, encounter.id),
          eq(auditEvents.action, "ENCOUNTER_RESULT_CORRECTED"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: userId,
      entityType: "Encounter",
      correlationId: audit.correlationId,
      oldValue: {
        encounter: { status: "COMPLETED", result: "HOME_WIN", resultType: "PLAYED", homePoints: 3, awayPoints: 0 },
        slot: { id: slotId, status: "COMPLETED", winnerSide: "HOME", resultType: "PLAYED", homeLegs: 1, awayLegs: 0 },
      },
      newValue: { status: "RUNNING", slotId, matchId, reason: "Checkout falsch eingetragen.", reopenedDeciderSlotIds: [] },
    });
    const slotAudits = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, slotId),
          eq(auditEvents.action, "ENCOUNTER_SLOT_REOPENED"),
        ),
      );
    expect(slotAudits).toHaveLength(1);

    // Neu gescort: diesmal gewinnt Gast — 9:9, Unentschieden ohne Decider.
    await playOut(matchId, "AWAY");
    expect(await encounterRow(encounter.id)).toMatchObject({
      status: "COMPLETED",
      result: "DRAW",
      resultType: "PLAYED",
      homeGames: 9,
      awayGames: 9,
      homePoints: 1,
      awayPoints: 1,
    });
    expect(await slotRow(slotId)).toMatchObject({ status: "COMPLETED", winnerSide: "AWAY", boardId: null });
    expect(await standingOf(encounter, homeTeamId)).toMatchObject({ played: 1, won: 0, drawn: 1, points: 1 });
    expect(await standingOf(encounter, awayTeamId)).toMatchObject({ played: 1, drawn: 1, points: 1 });
  });

  it("corrects an earlier game, not the one that completed the encounter", async () => {
    let encounter = await openEncounter("NONE");
    const slotId = slotIdOf(encounter, 1);
    const matchId = await assign(encounter, 1, boardIds[0]!);
    await playOut(matchId, "HOME");
    encounter = await reload(encounter);
    encounter = await walkovers(encounter, range(2, 9), "HOME");
    encounter = await walkovers(encounter, range(10, 18), "AWAY");
    expect(encounter).toMatchObject({ status: "COMPLETED", result: "DRAW", homeGames: 9, awayGames: 9 });

    const corrected = await correct(encounter, slotId);
    expect(corrected).toMatchObject({ status: "RUNNING", result: null, homeGames: 8, awayGames: 9 });
    expect(await matchRow(matchId)).toMatchObject({ status: "IN_PROGRESS" });

    await playOut(matchId, "AWAY");
    expect(await encounterRow(encounter.id)).toMatchObject({
      status: "COMPLETED",
      result: "AWAY_WIN",
      homeGames: 8,
      awayGames: 10,
    });
  });

  it("corrects the decider", async () => {
    const { encounter, deciderSlotId, deciderMatchId } = await deciderEncounter();

    const corrected = await correct(encounter, deciderSlotId);
    expect(corrected).toMatchObject({ status: "RUNNING", result: null, resultType: null, homeGames: 9, awayGames: 9 });
    expect(await slotRow(deciderSlotId)).toMatchObject({ status: "IN_PROGRESS", boardId: boardIds[1] });

    await playOut(deciderMatchId, "AWAY");
    expect(await encounterRow(encounter.id)).toMatchObject({
      status: "COMPLETED",
      result: "AWAY_WIN",
      resultType: "DECIDER",
    });
  });

  it("rejects a regular game once the decider was played and changes nothing", async () => {
    const { encounter, regularSlotId, regularMatchId } = await deciderEncounter();
    const before = await snapshot(encounter.id, regularMatchId);

    await expect(correct(encounter, regularSlotId)).rejects.toMatchObject({
      status: 409,
      response: { code: "DECIDER_CORRECTION_REQUIRED" },
    });
    expect(await snapshot(encounter.id, regularMatchId)).toEqual(before);
  });

  it("puts a decider that was not needed back to WAITING and cancels it again without a tie", async () => {
    let encounter = await openEncounter("EXTRA_SLOT");
    encounter = await walkovers(encounter, range(1, 9), "HOME");
    encounter = await walkovers(encounter, range(10, 17), "AWAY");
    const slotId = slotIdOf(encounter, 18);
    const deciderSlotId = slotIdOf(encounter, 19);
    const matchId = await assign(encounter, 18, boardIds[0]!);
    await playOut(matchId, "HOME");
    encounter = await reload(encounter);
    expect(encounter).toMatchObject({ status: "COMPLETED", result: "HOME_WIN" });
    expect(await slotRow(deciderSlotId)).toMatchObject({ status: "CANCELLED" });

    await correct(encounter, slotId);
    expect(await slotRow(deciderSlotId)).toMatchObject({ status: "WAITING" });
    const audits = await databaseService.database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.entityId, encounter.id),
          eq(auditEvents.action, "ENCOUNTER_RESULT_CORRECTED"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.newValue).toMatchObject({ reopenedDeciderSlotIds: [deciderSlotId] });

    await playOut(matchId, "HOME");
    expect(await slotRow(deciderSlotId)).toMatchObject({ status: "CANCELLED" });
    expect(await encounterRow(encounter.id)).toMatchObject({ status: "COMPLETED", result: "HOME_WIN" });
  });

  describe("rejections change nothing", () => {
    it("rejects a running encounter", async () => {
      let encounter = await openEncounter("NONE");
      const slotId = slotIdOf(encounter, 1);
      const matchId = await assign(encounter, 1, boardIds[0]!);
      await playOut(matchId, "HOME");
      encounter = await reload(encounter);
      expect(encounter.status).toBe("RUNNING");
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotId)).rejects.toMatchObject({
        status: 409,
        response: { code: "ENCOUNTER_NOT_CORRECTABLE" },
      });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });

    it("rejects an encounter decided by forfeit", async () => {
      let encounter = await openEncounter("NONE");
      const slotId = slotIdOf(encounter, 1);
      const matchId = await assign(encounter, 1, boardIds[0]!);
      await playOut(matchId, "HOME");
      encounter = await reload(encounter);
      encounter = await encountersService.declareForfeit({
        organizationId,
        encounterId: encounter.id,
        data: { commandId: randomUUID(), expectedVersion: encounter.version, forfeitSide: "AWAY", reason: "Nicht angetreten." },
        auth,
        audit,
      });
      expect(encounter).toMatchObject({ status: "COMPLETED", resultType: "FORFEIT" });
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotId)).rejects.toMatchObject({
        status: 409,
        response: { code: "ENCOUNTER_NOT_CORRECTABLE" },
      });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });

    it("rejects a walkover slot", async () => {
      const { encounter, matchId } = await completedEncounter();
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotIdOf(encounter, 1))).rejects.toMatchObject({
        status: 409,
        response: { code: "SLOT_NOT_CORRECTABLE" },
      });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });

    it("rejects while the board of the match is in use", async () => {
      const { encounter, slotId, matchId } = await completedEncounter();
      await matchesService.create({
        organizationId,
        data: { playerOneId: homePlayerIds[4]!, playerTwoId: awayPlayerIds[4]!, boardId: boardIds[0]!, bestOfLegs: 1, bestOfSets: 1 },
        auth,
        audit,
      });
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotId)).rejects.toMatchObject({
        status: 409,
        response: { code: "BOARD_UNAVAILABLE" },
      });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });

    it("rejects while a player of the match plays on another board", async () => {
      const { encounter, slotId, matchId } = await completedEncounter();
      const [homeParticipant] = await databaseService.database
        .select({ playerId: matchParticipantPlayers.playerId })
        .from(matchParticipantPlayers)
        .where(and(eq(matchParticipantPlayers.organizationId, organizationId), eq(matchParticipantPlayers.matchId, matchId)))
        .limit(1);
      if (homeParticipant === undefined) throw new Error("Expected a participant.");
      const opponent = homePlayerIds.includes(homeParticipant.playerId) ? awayPlayerIds[4]! : homePlayerIds[4]!;
      await matchesService.create({
        organizationId,
        data: { playerOneId: homeParticipant.playerId, playerTwoId: opponent, boardId: boardIds[1]!, bestOfLegs: 1, bestOfSets: 1 },
        auth,
        audit,
      });
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotId)).rejects.toMatchObject({
        status: 409,
        response: { code: "PLAYER_BUSY" },
      });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });

    it("rejects a stale version", async () => {
      const { encounter, slotId, matchId } = await completedEncounter();
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotId, { expectedVersion: encounter.version - 1 })).rejects.toMatchObject({
        status: 409,
        response: { code: "ENCOUNTER_VERSION_CONFLICT" },
      });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });

    it("answers 404 for a slot of another encounter", async () => {
      const { encounter, matchId } = await completedEncounter();
      const other = await openEncounter("NONE");
      const before = await snapshot(encounter.id, matchId);

      await expect(correct(encounter, slotIdOf(other, 18))).rejects.toMatchObject({ status: 404 });
      expect(await snapshot(encounter.id, matchId)).toEqual(before);
    });
  });

  it("is idempotent for a repeated commandId", async () => {
    const { encounter, slotId, matchId } = await completedEncounter();
    const commandId = randomUUID();

    const first = await correct(encounter, slotId, { commandId });
    const second = await correct(encounter, slotId, { commandId });

    expect(second).toMatchObject({ status: "RUNNING", version: first.version });
    const reverted = (await visitRows(matchId)).filter((visit) => visit.revertedByCommandId === commandId);
    expect(reverted).toHaveLength(1);
    expect(await eventsOf(encounter.id, "ENCOUNTER_RESULT_CORRECTED")).toHaveLength(1);
    expect(await matchRow(matchId)).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("rejects a commandId already used as a visit on the same match, regardless of which match it belongs to", async () => {
    const { encounter, slotId, matchId } = await completedEncounter();
    const checkout = (await visitRows(matchId)).at(-1);
    if (checkout === undefined) throw new Error("Expected a checkout visit.");
    const before = await snapshot(encounter.id, matchId);

    await expect(correct(encounter, slotId, { commandId: checkout.commandId })).rejects.toMatchObject({
      status: 409,
      response: { code: "COMMAND_ID_ALREADY_USED" },
    });
    expect(await snapshot(encounter.id, matchId)).toEqual(before);
  });

  it("requires encounter:manage", async () => {
    const { encounter, slotId, matchId } = await completedEncounter();
    const before = await snapshot(encounter.id, matchId);

    for (const denied of [memberAuth, scorerAuth]) {
      await expect(correct(encounter, slotId, { auth: denied })).rejects.toMatchObject({ status: 403 });
    }
    expect(await snapshot(encounter.id, matchId)).toEqual(before);
  });
});
