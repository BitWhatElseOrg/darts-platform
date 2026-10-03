import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  auditEvents, boards, matches, memberships, outboxEvents, organizations, players,
  tournamentMatches, tournamentParticipants, tournamentStages, tournaments, users,
} from "@darts-platform/database";
import type { CreateClassicTournamentInput } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { MatchesService } from "../matches/matches.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { advanceDoubleElimination } from "./advance-double-elimination.js";
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
  user: { id: userId, email: `double-ko-${userId}@example.test`, name: "Doppel-KO Leitung" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;
const playerIds: string[] = Array.from({ length: 13 }, () => randomUUID());
const seedOf = new Map(playerIds.map((id, index) => [id, index + 1]));
const boardIds = [randomUUID(), randomUUID(), randomUUID()] as const;

beforeAll(async () => {
  const database = databaseService.database;
  await database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await database.insert(organizations).values([
    { id: organizationId, name: "Doppel-KO Club", slug: `double-ko-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Fremder Club", slug: `double-ko-foreign-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await database.insert(players).values(playerIds.map((id, index) => ({ id, organizationId, displayName: `Spieler ${index + 1}`, status: "ACTIVE" })));
  await database.insert(boards).values(boardIds.map((id, index) => ({ id, organizationId, name: `DKO Board ${index + 1}` })));
});

/** Laufende Spiele eines Tests dürfen den nächsten nicht blockieren («spielt bereits»). */
afterEach(async () => {
  const database = databaseService.database;
  await database.update(tournamentMatches).set({ status: "CANCELLED", boardId: null, scoringMatchId: null }).where(and(eq(tournamentMatches.organizationId, organizationId), eq(tournamentMatches.status, "IN_PROGRESS")));
  await database.update(matches).set({ status: "ABORTED" }).where(and(eq(matches.organizationId, organizationId), inArray(matches.status, ["IN_PROGRESS"])));
  await database.update(boards).set({ status: "AVAILABLE" }).where(eq(boards.organizationId, organizationId));
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

function doubleEliminationInput(count: number, knockoutSize: 4 | 8 | 16): CreateClassicTournamentInput {
  return {
    name: `Doppel-KO ${randomUUID()}`,
    startsAt: new Date("2026-10-10T18:00:00.000Z"),
    format: "DOUBLE_ELIMINATION",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    bestOfSets: 1,
    boardIds: [...boardIds],
    participantIds: playerIds.slice(0, count),
    groupCount: 1,
    qualifyPerGroup: 1,
    knockoutSize,
    seeding: "SEEDED",
  };
}

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

/** Spielt ein per Korrektur wieder geoeffnetes Match anhand des laufenden Zustands zu Ende. */
async function finishReopenedMatch(tournamentMatchId: string, winnerPlayerId: string): Promise<void> {
  const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, tournamentMatchId));
  if (!scheduled?.scoringMatchId) throw new Error("Expected a scoring match.");
  const state = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
  const final = await submitSteps(state, scriptToFinish(state, winnerPlayerId));
  expect(final.status).toBe("COMPLETED");
}

/** Spielt ein READY-Turniermatch auf `boardId` bis zum Sieg von `winnerPlayerId` durch (501, Double Out, Best of 1). */
async function playMatch(tournamentId: string, tournamentMatchId: string, winnerPlayerId: string, boardId: string = boardIds[0]): Promise<void> {
  const state = await startOnBoard(tournamentId, tournamentMatchId, boardId);
  const final = await submitSteps(state, scriptToFinish(state, winnerPlayerId));
  expect(final.status).toBe("COMPLETED");
}

/** Bessere Setzung gewinnt; deterministisch. */
function favourite(playerOneId: string, playerTwoId: string): string {
  return (seedOf.get(playerOneId) ?? 0) <= (seedOf.get(playerTwoId) ?? 0) ? playerOneId : playerTwoId;
}

async function rows(tournamentId: string) {
  return databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, tournamentId));
}

/** Spielt READY-Spiele, bis keines mehr bereit ist oder `stopKey` als nächstes bereit wäre. */
async function playUntil(tournamentId: string, stopKey: string | null, pick = favourite): Promise<number> {
  let played = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const ready = (await rows(tournamentId)).filter((row) => row.status === "READY" && row.key !== stopKey);
    const next = ready.sort((left, right) => left.key.localeCompare(right.key))[0];
    if (next === undefined) return played;
    if (!next.participantOneId || !next.participantTwoId) throw new Error("READY match without participants.");
    await playMatch(tournamentId, next.id, pick(next.participantOneId, next.participantTwoId));
    played += 1;
  }
  throw new Error("Durchlauf abgebrochen.");
}

describe("Doppel-K.-o. anlegen", () => {
  it("legt 13 Teilnehmer im 16er-Tableau mit drei Stages, Verlierer-Quellen und Final an", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(13, 16), auth, audit });
    expect(created).toMatchObject({ format: "DOUBLE_ELIMINATION", status: "KNOCKOUT" });
    const stages = await databaseService.database.select().from(tournamentStages).where(eq(tournamentStages.tournamentId, created.id));
    expect(stages.map((stage) => [stage.key, stage.type]).sort()).toEqual([
      ["grand-final", "GRAND_FINAL"],
      ["lower", "DOUBLE_ELIMINATION_LOWER"],
      ["upper", "DOUBLE_ELIMINATION_UPPER"],
    ]);
    const stored = await rows(created.id);
    const playable = stored.filter((row) => row.status !== "BYE");
    expect(playable).toHaveLength(24);
    const lowerWithLoserSource = stored.filter((row) => row.sourceOneKind === "LOSER" || row.sourceTwoKind === "LOSER");
    expect(lowerWithLoserSource.length).toBeGreaterThan(0);
    expect(lowerWithLoserSource.every((row) => row.stageLabel.startsWith("Verliererrunde · Runde "))).toBe(true);
    expect(stored.find((row) => row.key === "grand-final:r1:m1")?.stageLabel).toBe("Final");
    expect(stored.find((row) => row.key === "upper:r1:m1")?.stageLabel).toBe("Gewinnerrunde · Runde 1");
  });

  it("rechnet die Vorschau", async () => {
    const preview = await service.preview({ organizationId, auth, data: { format: "DOUBLE_ELIMINATION", participantCount: 13, groupCount: 1, qualifyPerGroup: 1, knockoutSize: 16 } });
    expect(preview).toMatchObject({ knockoutMatchCount: 24, byes: 3, totalMatches: 24 });
  });

  it("verweigert einer fremden Organisation den Zugriff", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(4, 4), auth, audit });
    await expect(service.dashboard({ organizationId: foreignOrganizationId, tournamentId: created.id, auth })).rejects.toThrow();
  });
});

describe("Doppel-K.-o. Ablauf", () => {
  it("spielt 13 Teilnehmer ohne Rückspiel durch: 24 Spiele, Verlierer wandern ins Verlierer-Tableau", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(13, 16), auth, audit });
    const firstUpper = (await rows(created.id)).find((row) => row.key === "upper:r1:m2");
    if (!firstUpper?.participantOneId || !firstUpper.participantTwoId) throw new Error("unexpected");
    const loser = favourite(firstUpper.participantOneId, firstUpper.participantTwoId) === firstUpper.participantOneId
      ? firstUpper.participantTwoId : firstUpper.participantOneId;
    await playMatch(created.id, firstUpper.id, favourite(firstUpper.participantOneId, firstUpper.participantTwoId));
    const lowerSlots = (await rows(created.id)).filter((row) => row.stageLabel.startsWith("Verliererrunde") && (row.participantOneId === loser || row.participantTwoId === loser));
    expect(lowerSlots).toHaveLength(1);

    const played = 1 + (await playUntil(created.id, null));
    expect(played).toBe(24);
    const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(tournament?.status).toBe("COMPLETED");
    expect((await rows(created.id)).some((row) => row.key === "grand-final:r2:m1")).toBe(false);

    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(new Set(dashboard.bracket.map((match) => match.section))).toEqual(new Set(["UPPER", "LOWER", "GRAND_FINAL"]));
    expect(dashboard.doubleElimination?.resetPossible).toBe(false);
    expect(dashboard.doubleElimination?.placements[0]?.rank).toBe(1);
    expect(dashboard.doubleElimination?.placements).toHaveLength(13);
    const [published] = await databaseService.database.update(tournaments).set({ visibility: "PUBLIC" }).where(eq(tournaments.id, created.id)).returning();
    const publicView = await service.publicDashboard(published?.publicId ?? "");
    expect(publicView.doubleElimination).toEqual(dashboard.doubleElimination);
  }, 30_000);

  it("legt das Rückspiel an, wenn der Sieger der Verliererrunde das Final gewinnt, und schliesst danach ab", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(8, 8), auth, audit });
    await playUntil(created.id, "grand-final:r1:m1");
    const final = (await rows(created.id)).find((row) => row.key === "grand-final:r1:m1");
    if (final?.status !== "READY" || !final.participantTwoId || !final.participantOneId) throw new Error("Final nicht bereit");
    await playMatch(created.id, final.id, final.participantTwoId);
    const reset = (await rows(created.id)).find((row) => row.key === "grand-final:r2:m1");
    expect(reset).toMatchObject({ status: "READY", stageLabel: "Final-Rückspiel", participantOneId: final.participantOneId, participantTwoId: final.participantTwoId });
    const [running] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(running?.status).toBe("KNOCKOUT");
    const outbox = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_GRAND_FINAL_RESET")));
    expect(outbox).toHaveLength(1);
    const audits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_GRAND_FINAL_RESET")));
    expect(audits[0]).toMatchObject({ organizationId, actorUserId: userId, correlationId: audit.correlationId });

    if (reset === undefined) throw new Error("unreachable");
    await playMatch(created.id, reset.id, final.participantOneId);
    const [done] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(done?.status).toBe("COMPLETED");
  }, 30_000);

  it("legt das Rückspiel nur einmal an, auch wenn der Fortschritt zweimal läuft", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(4, 4), auth, audit });
    await playUntil(created.id, "grand-final:r1:m1");
    const final = (await rows(created.id)).find((row) => row.key === "grand-final:r1:m1");
    if (!final?.participantTwoId) throw new Error("Final nicht bereit");
    await playMatch(created.id, final.id, final.participantTwoId);
    await databaseService.database.transaction((transaction) =>
      advanceDoubleElimination(transaction, { organizationId, tournamentId: created.id, now: new Date(), actor: { principal: auth, audit } }),
    );
    expect((await rows(created.id)).filter((row) => row.key === "grand-final:r2:m1")).toHaveLength(1);
  }, 30_000);

  it("gibt Walkover im Verlierer-Tableau, wenn ein Zurückgezogener hineinfällt", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(8, 8), auth, audit });
    const upper = (await rows(created.id)).find((row) => row.key === "upper:r1:m1");
    if (!upper?.participantOneId || !upper.participantTwoId) throw new Error("unexpected");
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    await service.withdrawParticipant({
      organizationId, tournamentId: created.id, auth, audit,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: upper.participantTwoId, reason: "Verletzung" },
    });
    const lower = (await rows(created.id)).find((row) => row.key === "lower:r1:m1");
    expect(lower?.participantOneId === upper.participantTwoId || lower?.participantTwoId === upper.participantTwoId).toBe(true);
    // Gegner im Verlierer-Tableau steht erst nach upper:r1:m2 fest; danach Walkover.
    const second = (await rows(created.id)).find((row) => row.key === "upper:r1:m2");
    if (!second?.participantOneId || !second.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, second.id, favourite(second.participantOneId, second.participantTwoId));
    expect((await rows(created.id)).find((row) => row.key === "lower:r1:m1")).toMatchObject({ status: "COMPLETED", resultType: "WALKOVER" });
  });
});

describe("Doppel-K.-o. Korrektur", () => {
  async function toResetPending() {
    const created = await service.create({ organizationId, data: doubleEliminationInput(4, 4), auth, audit });
    await playUntil(created.id, "grand-final:r1:m1");
    const final = (await rows(created.id)).find((row) => row.key === "grand-final:r1:m1");
    if (!final?.participantOneId || !final.participantTwoId) throw new Error("Final nicht bereit");
    await playMatch(created.id, final.id, final.participantTwoId);
    return { created, final };
  }

  async function correct(tournamentId: string, matchId: string) {
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
    return service.correctResult({
      organizationId, tournamentId, auth, audit,
      data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId, reason: "Falsch erfasst" },
    });
  }

  it("löscht ein noch nicht gestartetes Rückspiel, wenn das erste Final korrigiert wird", async () => {
    const { created, final } = await toResetPending();
    await correct(created.id, final.id);
    expect((await rows(created.id)).some((row) => row.key === "grand-final:r2:m1")).toBe(false);
    const removed = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_GRAND_FINAL_RESET_REMOVED")));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ organizationId, correlationId: audit.correlationId });
    if (!final.participantOneId) throw new Error("unexpected");
    await finishReopenedMatch(final.id, final.participantOneId);
    const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
    expect(tournament?.status).toBe("COMPLETED");
  });

  it("verweigert die Korrektur des ersten Finals, wenn das Rückspiel läuft", async () => {
    const { created, final } = await toResetPending();
    const reset = (await rows(created.id)).find((row) => row.key === "grand-final:r2:m1");
    if (reset === undefined) throw new Error("kein Rückspiel");
    await startOnBoard(created.id, reset.id, boardIds[1]);
    await expect(correct(created.id, final.id)).rejects.toMatchObject({ status: 409 });
    expect((await rows(created.id)).some((row) => row.key === "grand-final:r2:m1")).toBe(true);
  });

  it("verweigert die Korrektur eines Gewinnerrunden-Spiels, wenn das davon gespeiste Verlierer-Spiel läuft", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(4, 4), auth, audit });
    const all = await rows(created.id);
    const upperOne = all.find((row) => row.key === "upper:r1:m1");
    const upperTwo = all.find((row) => row.key === "upper:r1:m2");
    if (!upperOne?.participantOneId || !upperTwo?.participantOneId) throw new Error("unexpected");
    await playMatch(created.id, upperOne.id, upperOne.participantOneId);
    await playMatch(created.id, upperTwo.id, upperTwo.participantOneId);
    const lower = (await rows(created.id)).find((row) => row.key === "lower:r1:m1");
    if (lower === undefined) throw new Error("kein Verlierer-Spiel");
    await startOnBoard(created.id, lower.id, boardIds[1]);
    const before = (await rows(created.id)).find((row) => row.id === lower.id);
    await expect(correct(created.id, upperOne.id)).rejects.toMatchObject({ status: 409 });
    const after = (await rows(created.id)).find((row) => row.id === lower.id);
    expect(after).toEqual(before);
    expect(after?.status).toBe("IN_PROGRESS");
  });

  it("leert den Verlierer-Platz, wenn ein Gewinnerrunden-Spiel korrigiert wird", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(4, 4), auth, audit });
    const upper = (await rows(created.id)).find((row) => row.key === "upper:r1:m1");
    if (!upper?.participantOneId || !upper.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, upper.id, upper.participantOneId);
    await correct(created.id, upper.id);
    const lower = (await rows(created.id)).find((row) => row.key === "lower:r1:m1");
    expect(lower?.participantOneId).toBeNull();
    await finishReopenedMatch(upper.id, upper.participantTwoId);
    expect((await rows(created.id)).find((row) => row.key === "lower:r1:m1")?.participantOneId).toBe(upper.participantOneId);
  });

  it("öffnet Byes, die aus dem korrigierten Spiel entstanden sind, und lässt keinen veralteten Teilnehmer stehen", async () => {
    // Seltener Zustand, direkt hergestellt: Beide Spieler von upper:r1:m2 sind
    // zurückgezogen, das Spiel ist abgesagt. Damit werden upper:r2:m1 und
    // lower:r1:m1 nach upper:r1:m1 zu Byes und reichen ihren Sieger weiter.
    const created = await service.create({ organizationId, data: doubleEliminationInput(8, 8), auth, audit });
    const cancelled = (await rows(created.id)).find((row) => row.key === "upper:r1:m2");
    if (!cancelled?.participantOneId || !cancelled.participantTwoId) throw new Error("unexpected");
    await databaseService.database.update(tournamentMatches).set({ status: "CANCELLED" }).where(eq(tournamentMatches.id, cancelled.id));
    await databaseService.database.update(tournamentParticipants)
      .set({ status: "WITHDRAWN", withdrawnAt: new Date(), withdrawalReason: "Testaufbau" })
      .where(and(eq(tournamentParticipants.tournamentId, created.id), inArray(tournamentParticipants.playerId, [cancelled.participantOneId, cancelled.participantTwoId])));

    const upper = (await rows(created.id)).find((row) => row.key === "upper:r1:m1");
    if (!upper?.participantOneId || !upper.participantTwoId) throw new Error("unexpected");
    const [first, second] = [upper.participantOneId, upper.participantTwoId];
    await playMatch(created.id, upper.id, first);
    const before = await rows(created.id);
    expect(before.find((row) => row.key === "upper:r2:m1")).toMatchObject({ status: "BYE", winnerPlayerId: first });
    expect(before.find((row) => row.key === "lower:r1:m1")).toMatchObject({ status: "BYE", winnerPlayerId: second });

    await correct(created.id, upper.id);
    await finishReopenedMatch(upper.id, second);

    const after = await rows(created.id);
    const holds = (row: (typeof after)[number], playerId: string) => row.participantOneId === playerId || row.participantTwoId === playerId;
    expect(after.find((row) => row.key === "upper:r2:m1")).toMatchObject({ status: "BYE", winnerPlayerId: second });
    const upperFinal = after.find((row) => row.key === "upper:r3:m1");
    if (upperFinal === undefined) throw new Error("kein Gewinnerrunden-Final");
    expect(holds(upperFinal, second)).toBe(true);
    expect(holds(upperFinal, first)).toBe(false);
    const lowerRoundTwo = after.filter((row) => row.key.startsWith("lower:r2:"));
    expect(lowerRoundTwo.some((row) => holds(row, first))).toBe(true);
    expect(lowerRoundTwo.some((row) => holds(row, second))).toBe(false);
  }, 30_000);
});

describe("Doppel-K.-o. Warteschlange", () => {
  it("ordnet die Warteschlange nach Stage-Reihenfolge, Runde und Position (Gewinner- vor Verliererrunde)", async () => {
    const created = await service.create({ organizationId, data: doubleEliminationInput(8, 8), auth, audit });
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const stageRows = await databaseService.database.select().from(tournamentStages).where(eq(tournamentStages.tournamentId, created.id));
    const sequenceOf = new Map(stageRows.map((stage) => [stage.id, stage.sequence]));
    const byId = new Map((await rows(created.id)).map((row) => [row.id, row]));
    const queued = dashboard.queue.map((entry) => {
      const row = byId.get(entry.matchId);
      if (row === undefined) throw new Error("unbekanntes Match");
      return row;
    });
    const expected = [...queued].sort((left, right) =>
      (sequenceOf.get(left.stageId) ?? 0) - (sequenceOf.get(right.stageId) ?? 0) || left.round - right.round || left.position - right.position);
    expect(queued.map((row) => row.key)).toEqual(expected.map((row) => row.key));
    const keys = queued.map((row) => row.key);
    expect(keys.indexOf("upper:r1:m1")).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf("upper:r1:m1")).toBeLessThan(keys.indexOf("lower:r1:m1"));
  });
});
