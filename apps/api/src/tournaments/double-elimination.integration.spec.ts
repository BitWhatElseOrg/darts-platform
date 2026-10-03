import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  boards, matches, memberships, organizations, players,
  tournamentMatches, tournamentStages, users,
} from "@darts-platform/database";
import type { CreateClassicTournamentInput } from "@darts-platform/schemas";

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
// Helfer für die folgenden Tests (Task 6–8).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
// Helfer für die folgenden Tests (Task 6–8).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
