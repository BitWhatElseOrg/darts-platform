import { NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents,
  boards,
  memberships,
  organizations,
  outboxEvents,
  players,
  tournamentMatches,
  tournamentStages,
  tournaments,
  users,
} from "@darts-platform/database";
import type { CreateClubDuelTournamentInput } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { DisplayKeysRepository } from "./display-keys.repository.js";
import { DisplayKeysService } from "./display-keys.service.js";
import { TournamentsRepository } from "./tournaments.repository.js";
import { TournamentsService } from "./tournaments.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const matchesRepository = new MatchesRepository(databaseService);
const repository = new TournamentsRepository(databaseService);
const displayKeys = new DisplayKeysService(new DisplayKeysRepository(databaseService), repository, access);
const service = new TournamentsService(repository, matchesRepository, access, displayKeys);
const matchesService = new MatchesService(matchesRepository, access);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `club-duel-${userId}@example.test`, name: "Club Duel Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

const sideA: string[] = Array.from({ length: 13 }, () => randomUUID());
const sideB: string[] = Array.from({ length: 9 }, () => randomUUID());
const seedOf = new Map<string, number>([...sideA, ...sideB].map((id, index) => [id, index + 1]));
const boardIds = [randomUUID(), randomUUID(), randomUUID()] as const;
const foreignPlayerId = randomUUID();

function sideOf(id: string | null): "A" | "B" | null {
  if (id === null) return null;
  if (sideA.includes(id)) return "A";
  if (sideB.includes(id)) return "B";
  return null;
}

function clubDuelInput(options: {
  readonly qualifyingRounds: number;
  readonly finalRoundSize: number;
  readonly sideACount?: number;
  readonly sideBCount?: number;
}): CreateClubDuelTournamentInput {
  const { qualifyingRounds, finalRoundSize, sideACount = 13, sideBCount = 9 } = options;
  return {
    name: `Vereinsduell ${randomUUID()}`,
    startsAt: new Date("2026-10-10T18:00:00.000Z"),
    format: "CLUB_DUEL",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    bestOfSets: 1,
    boardIds: [...boardIds],
    sideAName: "VFC",
    sideBName: "DC Musterdorf",
    qualifyingRounds,
    finalRoundSize,
    thirdPlaceMatch: true,
    participants: [
      ...sideA.slice(0, sideACount).map((playerId) => ({ playerId, side: "A" as const })),
      ...sideB.slice(0, sideBCount).map((playerId) => ({ playerId, side: "B" as const })),
    ],
  };
}

beforeAll(async () => {
  const database = databaseService.database;
  await database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await database.insert(organizations).values([
    { id: organizationId, name: "Club Duel Club", slug: `club-duel-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Duel Club", slug: `foreign-duel-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await database.insert(players).values([
    ...sideA.map((id, index) => ({ id, organizationId, displayName: `Mitglied ${index + 1}`, status: "ACTIVE" })),
    ...sideB.map((id, index) => ({
      id,
      organizationId,
      displayName: `Gast ${index + 1}`,
      status: "ACTIVE",
      kind: "GUEST",
      guestClubName: "DC Musterdorf",
    })),
    { id: foreignPlayerId, organizationId: foreignOrganizationId, displayName: "Fremder Spieler", status: "ACTIVE" },
  ]);
  await database.insert(boards).values(boardIds.map((id, index) => ({ id, organizationId, name: `Duell Board ${index + 1}` })));
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("Vereinsduell anlegen", () => {
  it("legt 13 gegen 9 an: Runde 1 mit 9 Spielen und 4 Pausen, Finalrunde und Final als Platzhalter", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 }), auth, audit });
    expect(created.format).toBe("CLUB_DUEL");
    expect(created.status).toBe("GROUP_STAGE");
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const stages = await databaseService.database
      .select()
      .from(tournamentStages)
      .where(eq(tournamentStages.tournamentId, created.id))
      .orderBy(tournamentStages.sequence);
    expect(stages.map((stage) => [stage.key, stage.type, stage.status])).toEqual([
      ["qualifying", "CLUB_SWISS", "OPEN"],
      ["final-round", "CLUB_CROSS_ROUND_ROBIN", "WAITING"],
      ["final", "SINGLE_ELIMINATION", "WAITING"],
    ]);
    const matches = await databaseService.database
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, created.id));
    const qualifying = matches.filter((match) => match.stageId === stages[0]?.id);
    expect(qualifying).toHaveLength(9);
    expect(qualifying.every((match) => match.status === "READY" && match.round === 1 && match.stageLabel === "Quali · Runde 1")).toBe(true);
    for (const match of qualifying) {
      expect(sideOf(match.participantOneId)).toBe("A");
      expect(sideOf(match.participantTwoId)).toBe("B");
    }
    const paired = new Set(qualifying.flatMap((match) => [match.participantOneId, match.participantTwoId]));
    expect(sideA.filter((id) => !paired.has(id))).toHaveLength(4);
    const finalRound = matches.filter((match) => match.stageId === stages[1]?.id);
    expect(finalRound).toHaveLength(4);
    expect(finalRound.every((match) => match.status === "WAITING" && match.participantOneId === null)).toBe(true);
    expect(matches.filter((match) => match.stageId === stages[2]?.id).map((match) => match.stageLabel).sort()).toEqual(["Final", "Spiel um Platz 3"]);
    expect(dashboard.participants.filter((participant) => participant.side === "A")).toHaveLength(13);
    expect(dashboard.participants.filter((participant) => participant.side === "B")).toHaveLength(9);
    expect(dashboard.participants.every((participant) => participant.seed === seedOf.get(participant.playerId))).toBe(true);
    expect(dashboard.queue.some((entry) => entry.readiness === "READY")).toBe(true);
  });

  it("lehnt Spieler fremder Organisationen und zu kleine Seiten ab", async () => {
    const foreign = clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 });
    foreign.participants[0] = { playerId: foreignPlayerId, side: "A" };
    await expect(service.create({ organizationId, data: foreign, auth, audit })).rejects.toMatchObject({
      response: { code: "INVALID_TOURNAMENT_PARTICIPANTS" },
    });
    await expect(
      service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 6, sideBCount: 5 }), auth, audit }),
    ).rejects.toMatchObject({ response: { code: "CLUB_DUEL_SIDE_TOO_SMALL" } });
  });

  it("rechnet die Vorschau", async () => {
    const preview = await service.clubDuelPreview({
      organizationId,
      auth,
      data: { sideACount: 13, sideBCount: 9, qualifyingRounds: 4, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 8, bestOfLegs: 3 },
    });
    expect(preview.totalMatches).toBe(54);
    expect(preview.matchesPerPlayer.sideB).toEqual({ min: 4, max: 4 });
  });
});

/**
 * Spielt ein READY-Turniermatch auf `boardId` bis zum Sieg von `winnerPlayerId`
 * durch (501, Double Out, Best of 1). Turniermatches bullen den Anwurf von Leg
 * eins aus (`legStartPending`): Sitz 1 beginnt per `decideLegStart`, die
 * Reihenfolge folgt der Sitzbelegung aus dem Scoring-Zustand.
 */
async function playMatch(tournamentId: string, tournamentMatchId: string, winnerPlayerId: string, boardId: string): Promise<void> {
  let dashboard = await service.dashboard({ organizationId, tournamentId, auth });
  dashboard = await service.assign({ organizationId, tournamentId, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: tournamentMatchId, boardId }, auth, audit });
  const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, tournamentMatchId));
  if (!scheduled?.scoringMatchId) throw new Error("Expected an active scoring match.");
  let state = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
  if (state.legStartPending) {
    state = await matchesService.decideLegStart({ organizationId, matchId: state.id, auth, audit, data: { commandId: randomUUID(), expectedVersion: state.version, legNumber: 1, startingSeat: 1 } });
  }
  const order = [...state.participants].sort((left, right) => left.seat - right.seat).map((participant) => participant.playerId);
  const winnerVisits = [180, 180, 101];
  const script: { playerId: string; points: number; finish: boolean }[] = [];
  for (let turn = 0, winnerTurns = 0; winnerTurns <= 3; turn += 1) {
    const playerId = order[turn % 2];
    if (playerId === undefined) throw new Error("Turn order invariant violated.");
    if (playerId === winnerPlayerId) {
      script.push(winnerTurns < 3 ? { playerId, points: winnerVisits[winnerTurns] ?? 0, finish: false } : { playerId, points: 40, finish: true });
      winnerTurns += 1;
    } else {
      script.push({ playerId, points: 0, finish: false });
    }
  }
  for (const step of script) {
    state = await matchesService.submitVisit({
      organizationId, matchId: state.id, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: state.version, playerId: step.playerId, points: step.points,
        dartsThrown: step.finish ? 1 : 3,
        ...(step.finish ? { checkoutSegment: { segment: 20, multiplier: 2 } } : {}),
      },
    });
  }
  expect(state.status).toBe("COMPLETED");
}

/** Deterministische, aber durchmischte Siegerwahl: wer den kleineren Wert hat, gewinnt. */
function pickWinner(playerOneId: string, playerTwoId: string): string {
  const score = (id: string) => ((seedOf.get(id) ?? 0) * 7) % 11;
  return score(playerOneId) <= score(playerTwoId) ? playerOneId : playerTwoId;
}

/** Spielt alle READY-Matches, bis das Turnier COMPLETED ist; gibt die Anzahl gespielter Spiele zurueck. */
async function playOut(tournamentId: string): Promise<number> {
  let played = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const rows = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, tournamentId), eq(tournamentMatches.status, "READY")));
    const next = rows[0];
    if (next === undefined) {
      const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, tournamentId));
      if (tournament?.status === "COMPLETED") return played;
      throw new Error(`Keine READY-Spiele, Turnier aber ${tournament?.status ?? "unbekannt"}.`);
    }
    if (!next.participantOneId || !next.participantTwoId) throw new Error("READY match without participants.");
    await playMatch(tournamentId, next.id, pickWinner(next.participantOneId, next.participantTwoId), boardIds[0]);
    played += 1;
  }
  throw new Error("Durchlauf abgebrochen.");
}

describe("Vereinsduell Ablauf", () => {
  it("spielt 13 gegen 9 mit 2 Quali-Runden und Finalrunde 2 bis COMPLETED durch", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.round, 1), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    for (const match of roundOne.slice(0, 8)) {
      if (!match.participantOneId || !match.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, match.id, pickWinner(match.participantOneId, match.participantTwoId), boardIds[0]);
    }
    // Vor dem letzten Spiel der Runde gibt es noch keine Runde 2.
    expect(await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")))).toHaveLength(0);
    const last = roundOne[8];
    if (!last?.participantOneId || !last.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, last.id, pickWinner(last.participantOneId, last.participantTwoId), boardIds[0]);

    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(9);
    expect(roundTwo.every((match) => match.status === "READY")).toBe(true);
    const pausedRoundOne = new Set(sideA.filter((id) => !roundOne.some((match) => match.participantOneId === id)));
    const pausedRoundTwo = new Set(sideA.filter((id) => !roundTwo.some((match) => match.participantOneId === id)));
    expect(pausedRoundOne.size).toBe(4);
    expect(pausedRoundTwo.size).toBe(4);
    expect([...pausedRoundTwo].some((id) => pausedRoundOne.has(id))).toBe(false);
    for (const match of roundTwo) {
      expect(sideOf(match.participantOneId)).toBe("A");
      expect(sideOf(match.participantTwoId)).toBe("B");
      expect(roundOne.some((previous) => previous.participantOneId === match.participantOneId && previous.participantTwoId === match.participantTwoId)).toBe(false);
    }
    const pairedEvents = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_ROUND_PAIRED")));
    expect(pairedEvents).toHaveLength(1);
    const pairedAudits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_ROUND_PAIRED")));
    expect(pairedAudits).toHaveLength(1);

    const afterRoundOne = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const block = afterRoundOne.clubDuel;
    if (block === null) throw new Error("clubDuel block missing");
    expect(block.sideAName).toBe("VFC");
    expect(block.currentRound).toBe(2);
    expect(block.rounds.map((round) => [round.round, round.matchIds.length, round.pausedPlayerIds.length])).toEqual([[1, 9, 4], [2, 9, 4]]);
    expect(block.standings.overall).toHaveLength(22);
    expect(block.standings.sideA.filter((row) => row.qualified)).toHaveLength(2);
    expect(block.standings.sideB.filter((row) => row.qualified)).toHaveLength(2);
    expect(block.score.pointsA + block.score.pointsB).toBe(9);
    expect(block.finalRound.matches).toHaveLength(4);
    expect(block.finalRound.matches.every((match) => match.playerAId === null)).toBe(true);

    const total = 9 + await playOut(created.id);
    expect(total).toBe(18 + 4 + 2);
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.tournament.status).toBe("COMPLETED");
    const finalMatches = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Final")));
    expect(finalMatches[0]?.status).toBe("COMPLETED");
    expect(sideOf(finalMatches[0]?.participantOneId ?? null)).toBe("A");
    expect(sideOf(finalMatches[0]?.participantTwoId ?? null)).toBe("B");

    const finalBlock = dashboard.clubDuel;
    if (finalBlock === null) throw new Error("clubDuel block missing");
    expect(finalBlock.score.pointsA + finalBlock.score.pointsB).toBe(24);
    expect(finalBlock.finalRound.sideA.map((row) => row.position)).toEqual([1, 2]);
    expect(finalBlock.finalRound.matches.every((match) => match.status === "COMPLETED" && match.legs !== null)).toBe(true);
    // Öffentliche Sicht: erst nach Freigabe, dann mit demselben Block
    await expect(service.publicDashboard(dashboard.tournament.publicId)).rejects.toBeInstanceOf(NotFoundException);
    await service.setVisibility({ organizationId, tournamentId: created.id, data: { visibility: "PUBLIC" }, auth, audit });
    const publicView = await service.publicDashboard(dashboard.tournament.publicId);
    expect(publicView.clubDuel?.score).toEqual(finalBlock.score);
    expect(publicView.participants.every((participant) => participant.side === "A" || participant.side === "B")).toBe(true);
  }, 300_000);

  it("wechselt den Status: GROUP_STAGE → FINAL_ROUND → KNOCKOUT", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const statuses: string[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
      if (tournament === undefined) throw new Error("unexpected");
      if (statuses.at(-1) !== tournament.status) statuses.push(tournament.status);
      if (tournament.status === "COMPLETED") break;
      const [next] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.status, "READY")));
      if (!next?.participantOneId || !next.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, next.id, pickWinner(next.participantOneId, next.participantTwoId), boardIds[0]);
    }
    expect(statuses).toEqual(["GROUP_STAGE", "FINAL_ROUND", "KNOCKOUT", "COMPLETED"]);
  }, 120_000);

  it("paart die naechste Runde, wenn ein Rueckzug das letzte offene Spiel kampflos schliesst", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 3, sideBCount: 3 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.round, 1)));
    const [first, second, third] = roundOne.filter((match) => match.stageLabel === "Quali · Runde 1");
    if (!first?.participantOneId || !first.participantTwoId || !second?.participantOneId || !third?.participantOneId) throw new Error("unexpected");
    await playMatch(created.id, first.id, first.participantOneId, boardIds[0]);
    await playMatch(created.id, second.id, second.participantOneId, boardIds[0]);
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    await service.withdrawParticipant({ organizationId, tournamentId: created.id, auth, audit, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: third.participantOneId, reason: "Verletzung" } });
    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(2);
    expect(roundTwo.some((match) => match.participantOneId === third.participantOneId || match.participantTwoId === third.participantOneId)).toBe(false);
  }, 120_000);

  async function withdraw(tournamentId: string, playerId: string): Promise<void> {
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
    await service.withdrawParticipant({ organizationId, tournamentId, auth, audit, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId, reason: "Verletzung" } });
  }

  it("setzt einen in der Finalrunde zurueckgezogenen Finalisten nicht ins Final", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    for (let index = 0; index < 2; index += 1) {
      const [next] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1"), eq(tournamentMatches.status, "READY")));
      if (!next?.participantOneId || !next.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, next.id, next.participantOneId, boardIds[0]);
    }
    const finalRound = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.status, "READY")));
    expect(finalRound).toHaveLength(4);
    const finalist = sideA[0];
    if (finalist === undefined) throw new Error("unexpected");
    for (const match of finalRound.filter((entry) => entry.participantOneId === finalist)) {
      if (!match.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, match.id, finalist, boardIds[0]);
    }
    await withdraw(created.id, finalist);
    // Die Projektion folgt der besetzten Finalrunde: der Zurueckgezogene bleibt Finalrunden-Teilnehmer.
    const afterWithdrawal = (await service.dashboard({ organizationId, tournamentId: created.id, auth })).clubDuel;
    expect(afterWithdrawal?.finalRound.sideA.map((row) => row.playerId)).toContain(finalist);
    expect(afterWithdrawal?.standings.sideA.find((row) => row.playerId === finalist)?.qualified).toBe(true);
    expect(afterWithdrawal?.finalRound.sideA).toHaveLength(2);
    expect(await playOut(created.id)).toBe(3);
    const finalStage = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.round, 1), eq(tournamentMatches.status, "COMPLETED")));
    const finals = finalStage.filter((match) => match.stageLabel === "Final" || match.stageLabel === "Spiel um Platz 3");
    expect(finals).toHaveLength(2);
    expect(finals.some((match) => match.participantOneId === finalist || match.participantTwoId === finalist)).toBe(false);
    expect(finals.filter((match) => match.resultType === "WALKOVER")).toHaveLength(1);
  }, 120_000);

  it("beendet die Quali vorzeitig, wenn eine Seite keinen aktiven Spieler mehr hat, und besetzt alles kampflos", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const [bOne, bTwo] = sideB;
    if (bOne === undefined || bTwo === undefined) throw new Error("unexpected");
    await withdraw(created.id, bOne);
    await withdraw(created.id, bTwo);
    const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(tournament?.status).toBe("COMPLETED");
    const all = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, created.id));
    expect(all.filter((match) => match.stageLabel === "Quali · Runde 2")).toHaveLength(0);
    expect(all.some((match) => match.status === "WAITING" || match.status === "READY")).toBe(false);
    expect(all.filter((match) => match.stageLabel === "Final" || match.stageLabel === "Spiel um Platz 3").every((match) => match.status === "COMPLETED" && match.resultType === "WALKOVER")).toBe(true);
  }, 120_000);
});
