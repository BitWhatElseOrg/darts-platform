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
  tournamentParticipants,
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
const foreignBoardId = randomUUID();
/** Eigene Personen und Scheibe fuer den getStates-Test: keine Kopplung ueber die vereinsweite Belegung. */
const labelSideA = [randomUUID(), randomUUID()] as const;
const labelSideB = [randomUUID(), randomUUID()] as const;
const labelBoardId = randomUUID();

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
    ...labelSideA.map((id, index) => ({ id, organizationId, displayName: `Kuerzel Mitglied ${index + 1}`, status: "ACTIVE" })),
    ...labelSideB.map((id, index) => ({ id, organizationId, displayName: `Kuerzel Gast ${index + 1}`, status: "ACTIVE", kind: "GUEST", guestClubName: "DC Musterdorf" })),
  ]);
  await database.insert(boards).values([
    ...boardIds.map((id, index) => ({ id, organizationId, name: `Duell Board ${index + 1}` })),
    { id: foreignBoardId, organizationId: foreignOrganizationId, name: "Fremde Scheibe" },
    { id: labelBoardId, organizationId, name: "Kuerzel Board" },
  ]);
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

  it("lehnt eine Scheibe einer fremden Organisation mit INVALID_TOURNAMENT_BOARDS ab und legt nichts an", async () => {
    const data = { ...clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), boardIds: [boardIds[0], foreignBoardId] };
    await expect(service.create({ organizationId, data, auth, audit })).rejects.toMatchObject({
      response: { code: "INVALID_TOURNAMENT_BOARDS" },
    });
    expect(await databaseService.database.select().from(tournaments).where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.name, data.name)))).toHaveLength(0);
  });

  it("schreibt bei der Anlage genau ein TOURNAMENT_CREATED-Ereignis und einen Audit-Eintrag", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const events = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_CREATED")));
    expect(events).toHaveLength(1);
    expect(events[0]?.organizationId).toBe(organizationId);
    expect(events[0]?.payload).toEqual({ tournamentId: created.id, format: "CLUB_DUEL" });
    const audits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_CREATED")));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ organizationId, actorUserId: userId, entityType: "Tournament", correlationId: audit.correlationId });
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

type ScoringState = Awaited<ReturnType<MatchesService["get"]>>;
interface VisitStep { readonly playerId: string; readonly points: number; readonly finish: boolean }

/**
 * Belegt ein READY-Turniermatch mit `boardId` und entscheidet den Anwurf von Leg
 * eins (Turniermatches bullen aus, `legStartPending`): Sitz 1 beginnt.
 */
async function startOnBoard(tournamentId: string, tournamentMatchId: string, boardId: string): Promise<ScoringState> {
  const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
  await service.assign({ organizationId, tournamentId, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: tournamentMatchId, boardId }, auth, audit });
  const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, tournamentMatchId));
  if (!scheduled?.scoringMatchId) throw new Error("Expected an active scoring match.");
  const state = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
  if (!state.legStartPending) return state;
  return matchesService.decideLegStart({ organizationId, matchId: state.id, auth, audit, data: { commandId: randomUUID(), expectedVersion: state.version, legNumber: 1, startingSeat: 1 } });
}

/**
 * Wuerfelt den Rest-Score des Gewinners herunter: Visits zu hoechstens 180,
 * zuletzt 40 per D20. Der Verlierer wirft jeweils 0; wer dran ist, folgt aus
 * `isActive`.
 */
function scriptToFinish(state: ScoringState, winnerPlayerId: string): VisitStep[] {
  const winner = state.participants.find((participant) => participant.playerId === winnerPlayerId);
  if (winner === undefined) throw new Error("Winner is not a participant.");
  const order = [...state.participants].sort((left, right) => left.seat - right.seat).map((participant) => participant.playerId);
  const active = state.participants.find((participant) => participant.isActive)?.playerId ?? order[0];
  let turn = Math.max(0, order.findIndex((playerId) => playerId === active));
  let remaining = winner.remaining;
  const script: VisitStep[] = [];
  for (;;) {
    const playerId = order[turn % 2];
    if (playerId === undefined) throw new Error("Turn order invariant violated.");
    if (playerId === winnerPlayerId) {
      if (remaining <= 40) {
        script.push({ playerId, points: remaining, finish: true });
        return script;
      }
      const points = Math.min(180, remaining - 40);
      script.push({ playerId, points, finish: false });
      remaining -= points;
    } else {
      script.push({ playerId, points: 0, finish: false });
    }
    turn += 1;
  }
}

async function submitSteps(initial: ScoringState, steps: readonly VisitStep[]): Promise<ScoringState> {
  let state = initial;
  for (const step of steps) {
    state = await matchesService.submitVisit({
      organizationId, matchId: state.id, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: state.version, playerId: step.playerId, points: step.points,
        dartsThrown: step.finish ? 1 : 3,
        ...(step.finish ? { checkoutSegment: { segment: 20, multiplier: 2 } } : {}),
      },
    });
  }
  return state;
}

/** Spielt ein READY-Turniermatch auf `boardId` bis zum Sieg von `winnerPlayerId` durch (501, Double Out, Best of 1). */
async function playMatch(tournamentId: string, tournamentMatchId: string, winnerPlayerId: string, boardId: string): Promise<void> {
  const state = await startOnBoard(tournamentId, tournamentMatchId, boardId);
  // Vereinsduell: jede Person trägt das Kürzel ihres Vereins (Seite A «VFC», Seite B «DC Musterdorf»).
  // Finalspiele können zwei Personen derselben Seite paaren, deshalb je Person gegen ihre Seite geprüft.
  for (const player of state.participants.flatMap((participant) => participant.players)) {
    expect(player.clubLabel).toBe(sideA.includes(player.playerId) ? "VFC" : "DM");
  }
  const final = await submitSteps(state, scriptToFinish(state, winnerPlayerId));
  expect(final.status).toBe("COMPLETED");
}

/** Spielt bis vor den letzten Wurf; die Rueckgabe schickt den Checkout. */
async function bringToCheckout(tournamentId: string, tournamentMatchId: string, winnerPlayerId: string, boardId: string): Promise<() => Promise<ScoringState>> {
  const state = await startOnBoard(tournamentId, tournamentMatchId, boardId);
  const script = scriptToFinish(state, winnerPlayerId);
  const last = script.at(-1);
  if (last === undefined) throw new Error("Empty script.");
  const before = await submitSteps(state, script.slice(0, -1));
  return () => submitSteps(before, [last]);
}

/** Spielt ein per Korrektur wieder geoeffnetes Match anhand des laufenden Zustands zu Ende. */
async function finishReopenedMatch(tournamentMatchId: string, winnerPlayerId: string): Promise<void> {
  const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, tournamentMatchId));
  if (!scheduled?.scoringMatchId) throw new Error("Expected a scoring match.");
  const state = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
  const final = await submitSteps(state, scriptToFinish(state, winnerPlayerId));
  expect(final.status).toBe("COMPLETED");
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
    expect(afterRoundOne.tournament.stageLabel).toBe("Qualifikation · Runde 2");
    expect(block.rounds.map((round) => [round.round, round.matchIds.length, round.pausedPlayerIds.length])).toEqual([[1, 9, 4], [2, 9, 4]]);
    const roundOneView = block.rounds[0];
    expect(roundOneView?.matches).toHaveLength(9);
    expect(roundOneView?.matches.map((match) => match.matchId).sort()).toEqual([...(roundOneView?.matchIds ?? [])].sort());
    for (const view of roundOneView?.matches ?? []) {
      expect(sideOf(view.playerAId)).toBe("A");
      expect(sideOf(view.playerBId)).toBe("B");
      expect(view.status).toBe("COMPLETED");
      expect(view.resultType).toBe("PLAYED");
      expect(view.winnerPlayerId === view.playerAId || view.winnerPlayerId === view.playerBId).toBe(true);
      expect(view.legs).not.toBeNull();
      const [legsA, legsB] = view.legs ?? [0, 0];
      expect(view.winnerPlayerId === view.playerAId ? legsA > legsB : legsB > legsA).toBe(true);
    }
    expect(block.rounds[1]?.matches.every((match) => match.status === "READY" && match.legs === null && match.resultType === null)).toBe(true);
    expect(block.finals).toEqual({ final: expect.objectContaining({ position: 1, status: "WAITING", playerAId: null, playerBId: null, legs: null }), thirdPlace: expect.objectContaining({ position: 2, status: "WAITING" }) });
    expect(block.standings.overall).toHaveLength(22);
    expect(block.standings.sideA.filter((row) => row.qualified)).toHaveLength(2);
    expect(block.standings.sideB.filter((row) => row.qualified)).toHaveLength(2);
    expect(block.score.pointsA + block.score.pointsB).toBe(9);
    expect(block.finalRound.matches).toHaveLength(4);
    expect(block.finalRound.matches.every((match) => match.playerAId === null)).toBe(true);

    const total = 9 + await playOut(created.id);
    expect(total).toBe(18 + 4 + 2);
    // Zwei Quali-Runden: genau eine Paarung über den ganzen Durchlauf; Finalrunde und Final je einmal besetzt.
    expect(await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_ROUND_PAIRED")))).toHaveLength(1);
    const phaseEvents = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_PHASE_RESOLVED")));
    expect(phaseEvents.map((event) => (event.payload as { stageKey: string }).stageKey).sort()).toEqual(["final", "final-round"]);
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
    for (const view of [finalBlock.finals.final, finalBlock.finals.thirdPlace]) {
      expect(view?.status).toBe("COMPLETED");
      expect(view?.resultType).toBe("PLAYED");
      expect(sideOf(view?.playerAId ?? null)).toBe("A");
      expect(sideOf(view?.playerBId ?? null)).toBe("B");
      expect(view?.legs).not.toBeNull();
    }
    expect(finalBlock.finals.final?.matchId).toBe(finalMatches[0]?.id);
    // Öffentliche Sicht: erst nach Freigabe, dann mit demselben Block
    await expect(service.publicDashboard(dashboard.tournament.publicId)).rejects.toBeInstanceOf(NotFoundException);
    await service.setVisibility({ organizationId, tournamentId: created.id, data: { visibility: "PUBLIC" }, auth, audit });
    const publicView = await service.publicDashboard(dashboard.tournament.publicId);
    expect(publicView.clubDuel?.score).toEqual(finalBlock.score);
    expect(publicView.participants.every((participant) => participant.side === "A" || participant.side === "B")).toBe(true);
  }, 300_000);

  it("liefert das Dashboard mit clubDuel null, wenn die Projektion scheitert", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const victim = sideA[0];
    if (victim === undefined) throw new Error("unexpected");
    await databaseService.database.update(tournamentParticipants).set({ side: null }).where(and(eq(tournamentParticipants.tournamentId, created.id), eq(tournamentParticipants.playerId, victim)));
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.clubDuel).toBeNull();
    expect(dashboard.tournament.stageLabel).toBe("Qualifikation");
    expect(dashboard.participants).toHaveLength(4);
  }, 60_000);

  it("wechselt den Status: GROUP_STAGE → FINAL_ROUND → KNOCKOUT", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const statuses: string[] = [];
    const stageLabels: string[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
      if (tournament === undefined) throw new Error("unexpected");
      if (statuses.at(-1) !== tournament.status) {
        statuses.push(tournament.status);
        stageLabels.push((await service.dashboard({ organizationId, tournamentId: created.id, auth })).tournament.stageLabel);
      }
      if (tournament.status === "COMPLETED") break;
      const [next] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.status, "READY")));
      if (!next?.participantOneId || !next.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, next.id, pickWinner(next.participantOneId, next.participantTwoId), boardIds[0]);
    }
    expect(statuses).toEqual(["GROUP_STAGE", "FINAL_ROUND", "KNOCKOUT", "COMPLETED"]);
    expect(stageLabels).toEqual(["Qualifikation · Runde 1", "Finalrunde", "Final", "Turnier beendet"]);
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

  it("liefert je Rundenspiel die Scheibe und behält Pausierende früherer Runden nach ihrem Rückzug", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 3, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    expect(roundOne).toHaveLength(2);
    const pausedInRoundOne = sideA.slice(0, 3).filter((id) => !roundOne.some((match) => match.participantOneId === id || match.participantTwoId === id));
    expect(pausedInRoundOne).toHaveLength(1);
    const boardNameOf = new Map<string, string>();
    for (const [index, match] of roundOne.entries()) {
      const boardId = boardIds[index] ?? boardIds[0];
      if (!match.participantOneId || !match.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, match.id, match.participantOneId, boardId);
      boardNameOf.set(match.id, `Duell Board ${boardIds.indexOf(boardId) + 1}`);
    }
    const before = (await service.dashboard({ organizationId, tournamentId: created.id, auth })).clubDuel;
    expect(before?.currentRound).toBe(2);
    expect(before?.rounds[0]?.pausedPlayerIds).toEqual(pausedInRoundOne);
    // Laufende, noch nicht gestartete Spiele haben keine Scheibe.
    expect(before?.rounds[1]?.matches.every((match) => match.boardName === null)).toBe(true);

    const [withdrawn] = pausedInRoundOne;
    if (withdrawn === undefined) throw new Error("unexpected");
    await withdraw(created.id, withdrawn);
    const after = (await service.dashboard({ organizationId, tournamentId: created.id, auth })).clubDuel;
    const roundOneView = after?.rounds[0];
    expect(roundOneView?.matches.map((match) => [match.matchId, match.boardName]).sort()).toEqual([...boardNameOf.entries()].sort());
    expect(roundOneView?.pausedPlayerIds).toEqual([withdrawn]);
    // Aktuelle Runde: Zurückgezogene pausieren nicht.
    expect(after?.rounds[1]?.pausedPlayerIds).not.toContain(withdrawn);

    // Letzte Quali-Runde: wer dort pausiert und sich erst in der Finalrunde zurückzieht, bleibt in der Pausenliste.
    const pausedInRoundTwo = after?.rounds[1]?.pausedPlayerIds ?? [];
    expect(pausedInRoundTwo).toHaveLength(1);
    const [lateWithdrawn] = pausedInRoundTwo;
    if (lateWithdrawn === undefined) throw new Error("unexpected");
    const openRoundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2"), eq(tournamentMatches.status, "READY")));
    for (const match of openRoundTwo) {
      if (!match.participantOneId || !match.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, match.id, match.participantOneId, boardIds[0]);
    }
    const occupied = (await service.dashboard({ organizationId, tournamentId: created.id, auth })).clubDuel;
    expect(occupied?.finalRound.matches.some((match) => match.playerAId !== null)).toBe(true);
    expect(occupied?.rounds[1]?.pausedPlayerIds).toEqual([lateWithdrawn]);
    await withdraw(created.id, lateWithdrawn);
    const afterLate = (await service.dashboard({ organizationId, tournamentId: created.id, auth })).clubDuel;
    expect(afterLate?.rounds[1]?.pausedPlayerIds).toEqual([lateWithdrawn]);
    expect(afterLate?.rounds[0]?.pausedPlayerIds).toEqual([withdrawn]);
  }, 180_000);

  it("fuehrt Pausierende, die sich noch waehrend ihrer Runde zurueckziehen, in deren Pausenliste (R7)", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 3, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [withdrawn, ...others] = sideA.slice(0, 3).filter((id) => !roundOne.some((match) => match.participantOneId === id || match.participantTwoId === id));
    if (withdrawn === undefined || others.length > 0) throw new Error("unexpected");
    // Rueckzug noch in Runde 1, bevor Runde 2 gepaart ist.
    await withdraw(created.id, withdrawn);
    for (const match of roundOne) {
      if (!match.participantOneId || !match.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, match.id, match.participantOneId, boardIds[0]);
    }
    const view = (await service.dashboard({ organizationId, tournamentId: created.id, auth })).clubDuel;
    expect(view?.currentRound).toBe(2);
    expect(view?.rounds[0]?.pausedPlayerIds).toEqual([withdrawn]);
    // In Runde 2 war er bei der Paarung schon zurueckgezogen.
    expect(view?.rounds[1]?.pausedPlayerIds).not.toContain(withdrawn);
  }, 120_000);

  it("schreibt beim Besetzen von Finalrunde und Final je genau ein Outbox- und ein Audit-Ereignis", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const resolvedEvents = () => databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_PHASE_RESOLVED")));
    const resolvedAudits = () => databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_PHASE_RESOLVED")));
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantOneId) throw new Error("unexpected");
    await playMatch(created.id, first.id, first.participantOneId, boardIds[0]);
    expect(await resolvedEvents()).toHaveLength(0);
    await playMatch(created.id, second.id, second.participantOneId, boardIds[0]);

    const [finalRoundStage] = await databaseService.database.select().from(tournamentStages).where(and(eq(tournamentStages.tournamentId, created.id), eq(tournamentStages.key, "final-round")));
    if (finalRoundStage === undefined) throw new Error("unexpected");
    const finalRoundIds = (await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.stageId, finalRoundStage.id)))
      .map((match) => match.id)
      .sort();
    expect(finalRoundIds).toHaveLength(4);
    const afterQualifying = await resolvedEvents();
    expect(afterQualifying).toHaveLength(1);
    expect(afterQualifying[0]?.payload).toEqual({ tournamentId: created.id, stageKey: "final-round", resolvedMatchIds: expect.any(Array) });
    expect([...((afterQualifying[0]?.payload as { resolvedMatchIds: string[] }).resolvedMatchIds)].sort()).toEqual(finalRoundIds);
    const auditsAfterQualifying = await resolvedAudits();
    expect(auditsAfterQualifying).toHaveLength(1);
    expect(auditsAfterQualifying[0]?.actorUserId).toBe(userId);

    await playOut(created.id);
    const all = await resolvedEvents();
    expect(all.map((event) => (event.payload as { stageKey: string }).stageKey).sort()).toEqual(["final", "final-round"]);
    expect(await resolvedAudits()).toHaveLength(2);
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

describe("Vereinsduell Scoring-Zustand", () => {
  it("liefert in getStates je Person das Vereinskuerzel ihrer Seite", async () => {
    const created = await service.create({
      organizationId,
      data: {
        ...clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2 }),
        boardIds: [labelBoardId],
        participants: [...labelSideA.map((playerId) => ({ playerId, side: "A" as const })), ...labelSideB.map((playerId) => ({ playerId, side: "B" as const }))],
      },
      auth,
      audit,
    });
    const [match] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    if (!match?.participantOneId || !match.participantTwoId) throw new Error("unexpected");
    expect(labelSideA).toContain(match.participantOneId);
    expect(labelSideB).toContain(match.participantTwoId);
    const state = await startOnBoard(created.id, match.id, labelBoardId);
    const states = await matchesRepository.getStates(organizationId, [state.id]);
    const labels = new Map(states.get(state.id)?.participants.flatMap((participant) => participant.players.map((player) => [player.playerId, player.clubLabel] as const)) ?? []);
    expect(labels).toEqual(new Map([[match.participantOneId, "VFC"], [match.participantTwoId, "DM"]]));
    // Fremder Mandant sieht den Zustand nicht.
    expect((await matchesRepository.getStates(foreignOrganizationId, [state.id])).size).toBe(0);
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.boards.find((board) => board.boardId === labelBoardId)?.match?.matchId).toBe(match.id);
  }, 60_000);
});

describe("Vereinsduell Korrektur und Rueckzug", () => {
  it("sperrt die Korrektur eines Quali-Resultats, sobald die Folgerunde gepaart ist", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantTwoId || !first.participantTwoId || !second.participantOneId) throw new Error("unexpected");
    await playMatch(created.id, first.id, first.participantOneId, boardIds[0]);
    // Runde noch offen: Korrektur erlaubt
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    dashboard = await service.correctResult({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: first.id, reason: "Falsch erfasst" }, auth, audit });
    expect(dashboard.boards.some((board) => board.match?.matchId === first.id)).toBe(true);
    expect(dashboard.tournament.status).toBe("GROUP_STAGE");
    await finishReopenedMatch(first.id, first.participantOneId);
    await playMatch(created.id, second.id, second.participantTwoId, boardIds[0]);
    // Runde 2 ist gepaart: gesperrt
    dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    await expect(service.correctResult({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: first.id, reason: "Zu spaet" }, auth, audit }))
      .rejects.toMatchObject({ response: { code: "CLUB_DUEL_ROUND_ALREADY_PAIRED" } });
  }, 60_000);

  async function correctionAttempt(tournamentId: string, matchId: string, reason: string) {
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
    return service.correctResult({ organizationId, tournamentId, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId, reason }, auth, audit });
  }

  it("sperrt die Korrektur der letzten Quali-Runde, sobald die Finalrunde besetzt ist", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantOneId) throw new Error("unexpected");
    await playMatch(created.id, first.id, first.participantOneId, boardIds[0]);
    // Finalrunde noch leer: Korrektur erlaubt
    await correctionAttempt(created.id, first.id, "Falsch erfasst");
    await finishReopenedMatch(first.id, first.participantOneId);
    await playMatch(created.id, second.id, second.participantOneId, boardIds[0]);
    const finalRoundMatches = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Finalrunde · Runde 1")));
    expect(finalRoundMatches.some((match) => match.participantOneId !== null)).toBe(true);
    await expect(correctionAttempt(created.id, first.id, "Zu spaet")).rejects.toMatchObject({ response: { code: "CLUB_DUEL_ROUND_ALREADY_PAIRED" } });
  }, 60_000);

  async function playUntilFinalsOccupied(tournamentId: string): Promise<void> {
    for (let guard = 0; guard < 20; guard += 1) {
      const finals = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, tournamentId), eq(tournamentMatches.stageLabel, "Final")));
      if (finals.some((match) => match.participantOneId !== null)) return;
      const [next] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, tournamentId), eq(tournamentMatches.status, "READY")));
      if (!next?.participantOneId || !next.participantTwoId) throw new Error("No READY match before the final is occupied.");
      await playMatch(tournamentId, next.id, pickWinner(next.participantOneId, next.participantTwoId), boardIds[0]);
    }
    throw new Error("Final wurde nicht besetzt.");
  }

  it("sperrt die Korrektur eines Finalrunden-Spiels, sobald das Final besetzt ist", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    await playUntilFinalsOccupied(created.id);
    const [finalRoundMatch] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Finalrunde · Runde 1"), eq(tournamentMatches.status, "COMPLETED"), eq(tournamentMatches.resultType, "PLAYED")));
    if (!finalRoundMatch) throw new Error("unexpected");
    await expect(correctionAttempt(created.id, finalRoundMatch.id, "Zu spaet")).rejects.toMatchObject({ response: { code: "CLUB_DUEL_ROUND_ALREADY_PAIRED" } });
  }, 90_000);

  it("erlaubt die Korrektur des Finals und setzt den Status danach auf KNOCKOUT zurueck", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    await playOut(created.id);
    const [finalMatch] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Final")));
    if (!finalMatch?.participantOneId || !finalMatch.participantTwoId) throw new Error("unexpected");
    const [before] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(before?.status).toBe("COMPLETED");
    const reopened = await correctionAttempt(created.id, finalMatch.id, "Falsch erfasst");
    expect(reopened.tournament.status).toBe("KNOCKOUT");
    const [afterReopen] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(afterReopen?.status).toBe("KNOCKOUT");
    await finishReopenedMatch(finalMatch.id, finalMatch.participantTwoId);
    const [afterFinish] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(afterFinish?.status).toBe("COMPLETED");
  }, 90_000);

  it("paart bei zwei gleichzeitig abgeschlossenen letzten Spielen genau eine Folgerunde", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantOneId) throw new Error("unexpected");
    const firstFinish = await bringToCheckout(created.id, first.id, first.participantOneId, boardIds[0]);
    const secondFinish = await bringToCheckout(created.id, second.id, second.participantOneId, boardIds[1]);
    const [firstResult, secondResult] = await Promise.all([firstFinish(), secondFinish()]);
    expect([firstResult.status, secondResult.status]).toEqual(["COMPLETED", "COMPLETED"]);
    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(2);
    const audits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_ROUND_PAIRED")));
    expect(audits).toHaveLength(1);
    const events = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_ROUND_PAIRED")));
    expect(events).toHaveLength(1);
  }, 60_000);

  it("schreibt bei einem abgelehnten letzten Wurf der Runde kein Ereignis und bei der Wiederholung des Checkouts kein zweites", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const pairedEvents = () => databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_ROUND_PAIRED")));
    const pairedAudits = () => databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_ROUND_PAIRED")));
    const roundTwo = () => databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantOneId) throw new Error("unexpected");
    await playMatch(created.id, first.id, first.participantOneId, boardIds[0]);

    const state = await startOnBoard(created.id, second.id, boardIds[1]);
    const script = scriptToFinish(state, second.participantOneId);
    const last = script.at(-1);
    if (last === undefined) throw new Error("Empty script.");
    const before = await submitSteps(state, script.slice(0, -1));
    const checkout = {
      commandId: randomUUID(), playerId: last.playerId, points: last.points, dartsThrown: 1 as const,
      checkoutSegment: { segment: 20, multiplier: 2 as const },
    };
    await expect(matchesService.submitVisit({ organizationId, matchId: before.id, auth, audit, data: { ...checkout, expectedVersion: before.version - 1 } }))
      .rejects.toMatchObject({ status: 409 });
    expect(await pairedEvents()).toHaveLength(0);
    expect(await pairedAudits()).toHaveLength(0);
    expect(await roundTwo()).toHaveLength(0);
    const [stillOpen] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, second.id));
    expect(stillOpen?.status).toBe("IN_PROGRESS");

    const finished = await matchesService.submitVisit({ organizationId, matchId: before.id, auth, audit, data: { ...checkout, expectedVersion: before.version } });
    expect(finished.status).toBe("COMPLETED");
    expect(await pairedEvents()).toHaveLength(1);
    expect(await roundTwo()).toHaveLength(2);
    // Dieselbe commandId noch einmal: idempotent, keine zweite Paarung.
    await matchesService.submitVisit({ organizationId, matchId: before.id, auth, audit, data: { ...checkout, expectedVersion: before.version } });
    expect(await pairedEvents()).toHaveLength(1);
    expect(await pairedAudits()).toHaveLength(1);
    expect(await roundTwo()).toHaveLength(2);
  }, 60_000);

  it("Rueckzug in der Quali: offenes Spiel wird Walkover, Spieler wird nicht mehr gepaart, fehlender Finalrunden-Platz wird Walkover", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 3, sideBCount: 2 }), auth, audit });
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const victimMatch = roundOne[0];
    const victim = victimMatch?.participantTwoId;
    if (!victimMatch || !victim) throw new Error("unexpected");
    await service.withdrawParticipant({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: victim, reason: "Verletzung" }, auth, audit });
    const [walkover] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, victimMatch.id));
    expect(walkover?.status).toBe("COMPLETED");
    expect(walkover?.resultType).toBe("WALKOVER");
    const other = roundOne[1];
    if (!other?.participantOneId || !other.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, other.id, other.participantOneId, boardIds[0]);
    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(1);
    expect(roundTwo.some((match) => match.participantTwoId === victim || match.participantOneId === victim)).toBe(false);
    await playOut(created.id);
    const finalRound = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Finalrunde · Runde 1")));
    expect(finalRound.filter((match) => match.resultType === "WALKOVER" && match.participantTwoId === null)).toHaveLength(1);
    const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(tournament?.status).toBe("COMPLETED");
  }, 90_000);
});
