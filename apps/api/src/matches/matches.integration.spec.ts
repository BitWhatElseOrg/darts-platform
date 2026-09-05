import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { auditEvents, boardControllerLeases, boards, legs, matches, matchParticipantPlayers, memberships, organizations, outboxEvents, players, scoreCommands, users, visitDarts, visits } from "@darts-platform/database";
import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { MatchesRepository } from "./matches.repository.js";
import { MatchesService } from "./matches.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const repository = new MatchesRepository(databaseService);
const service = new MatchesService(repository, access);
const organizationId = randomUUID();
const userId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();
const boardId = randomUUID();
const scorerUserId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `match-${userId}@example.test`, name: "Match Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;
const scorerAuth: AuthContext = {
  user: { id: scorerUserId, email: `scorer-${scorerUserId}@example.test`, name: "Match Scorer" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: scorerUserId, email: scorerAuth.user.email, displayName: scorerAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values({ id: organizationId, name: "Match Integration Club", slug: `match-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(memberships).values({ organizationId, userId: scorerUserId, role: "SCORER", status: "ACTIVE" });
  await databaseService.database.insert(players).values([
    { id: playerOneId, organizationId, displayName: "Player One", status: "ACTIVE" },
    { id: playerTwoId, organizationId, displayName: "Player Two", status: "ACTIVE" },
  ]);
  await databaseService.database.insert(boards).values({ id: boardId, organizationId, name: "Board 1" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, scorerUserId));
  await databaseService.onApplicationShutdown();
});

describe("persistent X01 match", () => {
  /**
   * Ohne In- und Out-Regel im Zustand kann das Scoreboard die Spielart nicht
   * nennen. Eine abgelehnte Eröffnungsaufnahme bliebe dann unerklärlich.
   */
  it("reports the variant of the match so the scoreboard can name it", async () => {
    const state = await service.create({
      organizationId,
      // Ohne Board, damit dieser Test das gemeinsame Board nicht belegt.
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId: null, bestOfLegs: 1, bestOfSets: 1 },
      auth,
      audit,
    });

    expect(state).toMatchObject({ startingScore: 501, inRule: "STRAIGHT", outRule: "DOUBLE" });
  }, 30_000);

  it("aborts an active scoring session transactionally and idempotently", async () => {
    let state = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId, bestOfLegs: 1, bestOfSets: 1 }, auth, audit });
    const controllerId = randomUUID();
    await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId, force: false, auth, audit });
    state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId, points: 100, dartsThrown: 3, controllerId }, auth, audit });

    await expect(service.abort({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, controllerId, reason: "Keine Berechtigung" }, auth: scorerAuth, audit })).rejects.toMatchObject({ status: 403 });
    await expect(service.abort({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version - 1, controllerId, reason: "Veraltete Version" }, auth, audit })).rejects.toMatchObject({ status: 409 });
    await expect(service.abort({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, controllerId: randomUUID(), reason: "Falsche Steuerung" }, auth, audit })).rejects.toMatchObject({ status: 409 });

    const commandId = randomUUID();
    const input = { organizationId, matchId: state.id, data: { commandId, expectedVersion: state.version, controllerId, reason: "Board neu starten" }, auth, audit };
    await expect(Promise.all(Array.from({ length: 4 }, () => service.abort(input)))).resolves.toEqual(
      Array.from({ length: 4 }, () => ({ matchId: state.id, status: "ABORTED", tournamentMatchId: null })),
    );

    expect(await service.list({ organizationId, auth })).not.toContainEqual(expect.objectContaining({ id: state.id }));
    expect(await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)))).toHaveLength(0);
    expect(await databaseService.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, state.id)))).toHaveLength(0);
    expect(await databaseService.database.select().from(boardControllerLeases).where(eq(boardControllerLeases.matchId, state.id))).toHaveLength(0);
    expect((await databaseService.database.select().from(matches).where(eq(matches.id, state.id)))[0]?.status).toBe("ABORTED");
    expect((await databaseService.database.select().from(boards).where(eq(boards.id, boardId)))[0]?.status).toBe("AVAILABLE");
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, commandId))).toHaveLength(1);
    expect((await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, state.id), eq(outboxEvents.eventType, "MATCH_ABORTED"))))).toHaveLength(1);
    const abortedAuditEvents = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, state.id), eq(auditEvents.action, "MATCH_ABORTED")));
    expect(abortedAuditEvents).toHaveLength(1);
    expect(abortedAuditEvents[0]?.newValue).toMatchObject({ discardedVisitCount: 1 });
  });

  it("is idempotent, rejects stale versions, supports undo and completes 501", async () => {
    let state = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId, bestOfLegs: 1, bestOfSets: 1 }, auth, audit });
    const firstControllerId = randomUUID();
    const controllerId = randomUUID();
    expect((await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId: firstControllerId, force: false, auth, audit })).owned).toBe(true);
    expect((await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId, force: false, auth, audit })).owned).toBe(false);
    expect((await service.acquireControllerLease({ organizationId, matchId: state.id, controllerId, force: true, auth, audit })).owned).toBe(true);
    await expect(service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3, controllerId: firstControllerId }, auth, audit })).rejects.toMatchObject({
      status: 409,
      response: { code: "BOARD_CONTROLLER_CONFLICT", details: { currentState: { version: 0 } } },
    });
    const firstCommandId = randomUUID();
    state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: firstCommandId, expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3, controllerId }, auth, audit });
    expect(state.version).toBe(1);
    const duplicate = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: firstCommandId, expectedVersion: 0, playerId: playerOneId, points: 180, dartsThrown: 3 }, auth, audit });
    expect(duplicate.version).toBe(1);
    expect(duplicate.visits.filter((visit) => !visit.reverted)).toHaveLength(1);

    await expect(service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 0, playerId: playerTwoId, points: 60, dartsThrown: 3 }, auth, audit })).rejects.toMatchObject({
      status: 409,
      response: { code: "MATCH_VERSION_CONFLICT", details: { currentState: { version: 1 } } },
    });
    state = await service.undo({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: 1, controllerId }, auth, audit });
    expect(state.participants[0].remaining).toBe(501);
    expect(state.currentPlayerId).toBe(playerOneId);

    const score = async (playerId: string, points: number, checkoutDouble?: number) => {
      state = await service.submitVisit({ organizationId, matchId: state.id, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3, controllerId, ...(checkoutDouble === undefined ? {} : { checkoutDouble }) }, auth, audit });
    };
    await score(playerOneId, 180);
    await score(playerTwoId, 60);
    await score(playerOneId, 180);
    await score(playerTwoId, 60);
    await score(playerOneId, 141, 12);
    expect(state.status).toBe("COMPLETED");
    expect(state.winnerPlayerId).toBe(playerOneId);
    expect(state.participants[0].remaining).toBe(0);

    const [board] = await databaseService.database.select().from(boards).where(and(eq(boards.organizationId, organizationId), eq(boards.id, boardId)));
    expect(board?.status).toBe("AVAILABLE");
    const persistedVisits = await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)));
    expect(persistedVisits).toHaveLength(6);
    const events = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId, organizationId), eq(outboxEvents.aggregateId, state.id)));
    expect(events.some((event) => event.eventType === "MATCH_COMPLETED")).toBe(true);
  });
  it("persists seats alongside the legacy player columns", async () => {
    const state = await service.create({
      organizationId,
      data: {
        playerOneId,
        playerTwoId,
        startingPlayerId: playerOneId,
        boardId: null,
        bestOfLegs: 1,
        bestOfSets: 1,
      },
      auth,
      audit,
    });

    const [row] = await databaseService.database
      .select().from(matches).where(eq(matches.id, state.id));
    expect(row?.startingSeat).toBe(1);
    expect(row?.currentSeat).toBe(1);

    const [legRow] = await databaseService.database
      .select().from(legs).where(eq(legs.matchId, state.id));
    expect(legRow?.startingSeat).toBe(1);

    const sideRows = await databaseService.database
      .select().from(matchParticipantPlayers)
      .where(eq(matchParticipantPlayers.matchId, state.id));
    expect(sideRows).toHaveLength(2);
    expect(sideRows.every((side) => side.position === 1)).toBe(true);
    expect(sideRows.map((side) => side.playerId).sort()).toEqual(
      [playerOneId, playerTwoId].sort(),
    );
  });

  it("persists the single darts of a visit and returns them", async () => {
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    const commandId = randomUUID();
    const state = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId, expectedVersion: 0, playerId: playerOneId,
        points: 100, dartsThrown: 3,
        darts: [{ segment: 20, multiplier: 3 }, { segment: 20, multiplier: 2 }, { segment: 0, multiplier: 1 }],
      },
    });

    expect(state.visits[0]?.darts).toEqual([
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 2 },
      { segment: 0, multiplier: 1 },
    ]);

    const stored = await databaseService.database
      .select()
      .from(visitDarts)
      .where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, state.visits[0]!.id)));
    expect(stored).toHaveLength(3);
    expect(stored.map((row) => row.value).reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("does not duplicate darts when the same command arrives twice", async () => {
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    const data = {
      commandId: randomUUID(), expectedVersion: 0, playerId: playerOneId,
      points: 60, dartsThrown: 3 as const,
      darts: [{ segment: 20, multiplier: 1 as const }, { segment: 20, multiplier: 1 as const }, { segment: 20, multiplier: 1 as const }],
    };
    const first = await service.submitVisit({ organizationId, matchId, auth, audit, data });
    await service.submitVisit({ organizationId, matchId, auth, audit, data });

    const stored = await databaseService.database
      .select()
      .from(visitDarts)
      .where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, first.visits[0]!.id)));
    expect(stored).toHaveLength(3);
  });

  it("replays a stored visit's darts through aggregate() before applying the next visit", async () => {
    // Reglement/Engine: bei Double In zählt eine Aufnahme erst ab dem ersten
    // Doppel. Fehlten die Einzelwürfe beim Nachrechnen über `aggregate()`
    // (z. B. weil `darts` aus dem gespeicherten Kommando entfernt würde),
    // zählte die Engine dort den vollen `points`-Wert statt der Teilwertung -
    // ein stiller Fehler im projizierten Reststand.
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    await databaseService.database
      .update(matches)
      .set({ inRule: "DOUBLE" })
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId)));

    // Eröffnungsaufnahme von Spieler eins: der Fehlwurf vor dem Doppel zählt
    // nicht mit. Gewertet werden dürfen nur 45 (40 + 5), nicht die vollen 46.
    const afterFirstVisit = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: 0, playerId: playerOneId,
        points: 46, dartsThrown: 3,
        darts: [{ segment: 1, multiplier: 1 }, { segment: 20, multiplier: 2 }, { segment: 5, multiplier: 1 }],
      },
    });
    expect(afterFirstVisit.participants[0].remaining).toBe(456);

    // Spieler zwei eröffnet nicht (kein Doppel getroffen); reine Turnwechsel-Aufnahme.
    const afterSecondVisit = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: { commandId: randomUUID(), expectedVersion: afterFirstVisit.version, playerId: playerTwoId, points: 0, dartsThrown: 3 },
    });

    // Die dritte Aufnahme (wieder Spieler eins) zwingt `aggregate()`, die
    // erste gespeicherte Aufnahme über `parseStoredCommand` erneut
    // durchzurechnen. Der `scoreBefore` dieser Aufnahme deckt auf, ob die
    // Würfe der ersten Aufnahme den Round-Trip überstanden haben.
    const afterThirdVisit = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: { commandId: randomUUID(), expectedVersion: afterSecondVisit.version, playerId: playerOneId, points: 0, dartsThrown: 3 },
    });

    const thirdVisit = afterThirdVisit.visits[0];
    expect(thirdVisit?.playerId).toBe(playerOneId);
    expect(thirdVisit?.scoreBefore).toBe(456);
  });
});
