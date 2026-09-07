import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
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

    // Referenzwert vor dem Abbruch: diese Aufnahme wird ohne Einzelwuerfe
    // uebermittelt (nur points/dartsThrown), darum ist die Zahl hier 0 —
    // der Abbruch darf sie trotzdem nicht veraendern.
    const [visitBeforeAbort] = await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)));
    const dartsBeforeAbort = await databaseService.database.select().from(visitDarts).where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, visitBeforeAbort?.id ?? "")));

    const commandId = randomUUID();
    const input = { organizationId, matchId: state.id, data: { commandId, expectedVersion: state.version, controllerId, reason: "Board neu starten" }, auth, audit };
    await expect(Promise.all(Array.from({ length: 4 }, () => service.abort(input)))).resolves.toEqual(
      Array.from({ length: 4 }, () => ({ matchId: state.id, status: "ABORTED", tournamentMatchId: null })),
    );

    expect(await service.list({ organizationId, auth })).not.toContainEqual(expect.objectContaining({ id: state.id }));
    // Befund I9: der Abbruch loescht die Wurfhistorie nicht mehr, er
    // entwertet sie. Ein versehentlicher Abbruch bleibt damit nachvollziehbar
    // und die Aufnahmen bleiben fuer eine Reklamation lesbar.
    const abortedVisits = await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)));
    expect(abortedVisits).toHaveLength(1);
    expect(abortedVisits[0]?.revertedAt).not.toBeNull();
    expect(abortedVisits[0]?.revertedByCommandId).toBe(commandId);
    // Die Einzelwuerfe der Aufnahme muessen den Abbruch unveraendert
    // ueberstehen (Vergleich mit dem vor dem Abbruch beobachteten Stand).
    const abortedDarts = await databaseService.database.select().from(visitDarts).where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, abortedVisits[0]?.id ?? "")));
    expect(abortedDarts).toHaveLength(dartsBeforeAbort.length);
    const abortedLegs = await databaseService.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, state.id)));
    expect(abortedLegs).toHaveLength(1);
    // Die Aufnahme wird kein zweites Mal gestempelt, wenn dasselbe Kommando
    // erneut eintrifft — `reverted_at` bleibt beim ersten Zeitpunkt.
    expect(await databaseService.database.select().from(visits).where(and(eq(visits.matchId, state.id), isNull(visits.revertedAt)))).toHaveLength(0);
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

  it("replays a stored checkoutMissed command correctly under master out", async () => {
    // Ohne das Feld faellt Master Out ohne checkoutDouble auf die Heuristik
    // finishesOnMasterSegment zurueck, die bei Rest 40 faelschlich ein Finish
    // erkennen wuerde. checkoutMissed:true muss das explizit verhindern -
    // und muss das auch nach einem Rueckrechnen ueber aggregate() (der
    // naechste Visit zwingt dazu) noch tun, sonst waere das Match hier
    // faelschlich beendet statt weiterzulaufen.
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    await databaseService.database
      .update(matches)
      .set({ outRule: "MASTER" })
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId)));

    let state = created;
    const score = async (playerId: string, points: number) => {
      state = await service.submitVisit({ organizationId, matchId, auth, audit, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3 } });
    };
    await score(playerOneId, 180); // 501 -> 321
    await score(playerTwoId, 0);
    await score(playerOneId, 180); // 321 -> 141
    await score(playerTwoId, 0);
    await score(playerOneId, 101); // 141 -> 40
    await score(playerTwoId, 0);

    state = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: { commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId, points: 40, dartsThrown: 3, checkoutMissed: true },
    });
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(40);
    expect(state.visits[0]?.outcome).toBe("BUST");

    // Ein weiterer Visit zwingt `aggregate()`, den gespeicherten
    // checkoutMissed-Befehl erneut ueber `parseStoredCommand` zu lesen.
    state = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: { commandId: randomUUID(), expectedVersion: state.version, playerId: playerTwoId, points: 0, dartsThrown: 3 },
    });
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(40);
  });

  it("rejects a visit whose darts continue past the closing dart", async () => {
    // Befund des PR-Agenten: die Fläche beendet die Eingabe beim Checkout, ein
    // API-Client ist daran nicht gebunden. Rest 40 mit [D20, Fehlwurf] wurde
    // bisher als Bust verbucht, obwohl das Leg mit dem D20 gewonnen war. Der
    // Schreibpfad muss das ablehnen, ohne einen falschen Zustand zu schreiben.
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    let state = created;
    const score = async (playerId: string, points: number) => {
      state = await service.submitVisit({ organizationId, matchId, auth, audit, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3 } });
    };
    await score(playerOneId, 180); // 501 -> 321
    await score(playerTwoId, 0);
    await score(playerOneId, 180); // 321 -> 141
    await score(playerTwoId, 0);
    await score(playerOneId, 101); // 141 -> 40
    await score(playerTwoId, 0);

    const rejectedCommandId = randomUUID();
    await expect(service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: rejectedCommandId, expectedVersion: state.version, playerId: playerOneId,
        points: 40, dartsThrown: 2,
        darts: [{ segment: 20, multiplier: 2 }, { segment: 0, multiplier: 1 }],
      },
    })).rejects.toMatchObject({
      status: 400,
      response: { code: "DARTS_AFTER_LEG_CLOSED" },
    });

    const storedCommands = await databaseService.database
      .select()
      .from(scoreCommands)
      .where(and(eq(scoreCommands.organizationId, organizationId), eq(scoreCommands.commandId, rejectedCommandId)));
    expect(storedCommands).toHaveLength(0);
    const storedVisits = await databaseService.database
      .select()
      .from(visits)
      .where(and(eq(visits.organizationId, organizationId), eq(visits.commandId, rejectedCommandId)));
    expect(storedVisits).toHaveLength(0);

    const unchanged = await repository.getState(organizationId, matchId);
    expect(unchanged?.version).toBe(state.version);
    expect(unchanged?.status).toBe("IN_PROGRESS");
    expect(unchanged?.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(40);

    // Dieselbe Aufnahme ohne den Wurf nach dem Checkout gewinnt weiterhin.
    state = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId,
        points: 40, dartsThrown: 1, darts: [{ segment: 20, multiplier: 2 }],
      },
    });
    expect(state.status).toBe("COMPLETED");
    expect(state.visits[0]?.outcome).toBe("MATCH_WON");
  });

  it("rejects a round sum before the opening double under double in without writing", async () => {
    // Befund K2: Ohne Einzelwuerfe laesst sich unter Double In nicht sagen,
    // wie viele Punkte vor dem eroeffnenden Doppel fielen; die Engine rechnete
    // die ganze Summe an (501 mit S1/D20/S20 = 61 ergab Rest 440 statt 441).
    // Neue Kommandos muessen die Wuerfe deshalb mitliefern - als sauberer 400
    // und ohne jede Schreibwirkung.
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

    const rejectedCommandId = randomUUID();
    await expect(service.submitVisit({
      organizationId, matchId, auth, audit,
      data: { commandId: rejectedCommandId, expectedVersion: created.version, playerId: playerOneId, points: 61, dartsThrown: 3 },
    })).rejects.toMatchObject({
      status: 400,
      response: { code: "DARTS_REQUIRED_FOR_DOUBLE_IN" },
    });

    expect(await databaseService.database.select().from(scoreCommands)
      .where(and(eq(scoreCommands.organizationId, organizationId), eq(scoreCommands.commandId, rejectedCommandId)))).toHaveLength(0);
    expect(await databaseService.database.select().from(visits)
      .where(and(eq(visits.organizationId, organizationId), eq(visits.commandId, rejectedCommandId)))).toHaveLength(0);
    const unchanged = await repository.getState(organizationId, matchId);
    expect(unchanged?.version).toBe(created.version);
    expect(unchanged?.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(501);

    // Dieselbe Aufnahme mit Wuerfen zaehlt ab dem Doppel: 60 statt 61.
    const applied = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: created.version, playerId: playerOneId,
        points: 61, dartsThrown: 3,
        darts: [{ segment: 1, multiplier: 1 }, { segment: 20, multiplier: 2 }, { segment: 20, multiplier: 1 }],
      },
    });
    expect(applied.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(441);
    expect(applied.visits[0]?.appliedPoints).toBe(60);
  });

  it("rejects a master-out finish without a checkout detail without writing", async () => {
    // Befund D-I1: Ohne Beleg raet die Heuristik permissiv - Rest 60 mit drei
    // Darts galt ihr als Master-Finish, obwohl S20/S20/S20 keins ist. Neue
    // Kommandos muessen den Abschluss belegen.
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    await databaseService.database
      .update(matches)
      .set({ outRule: "MASTER" })
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId)));

    let state = created;
    const score = async (playerId: string, points: number) => {
      state = await service.submitVisit({ organizationId, matchId, auth, audit, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3 } });
    };
    await score(playerOneId, 180); // 501 -> 321
    await score(playerTwoId, 0);
    await score(playerOneId, 180); // 321 -> 141
    await score(playerTwoId, 0);
    await score(playerOneId, 81); // 141 -> 60
    await score(playerTwoId, 0);

    const rejectedCommandId = randomUUID();
    await expect(service.submitVisit({
      organizationId, matchId, auth, audit,
      data: { commandId: rejectedCommandId, expectedVersion: state.version, playerId: playerOneId, points: 60, dartsThrown: 3 },
    })).rejects.toMatchObject({
      status: 400,
      response: { code: "CHECKOUT_DETAIL_REQUIRED" },
    });

    expect(await databaseService.database.select().from(scoreCommands)
      .where(and(eq(scoreCommands.organizationId, organizationId), eq(scoreCommands.commandId, rejectedCommandId)))).toHaveLength(0);
    expect(await databaseService.database.select().from(visits)
      .where(and(eq(visits.organizationId, organizationId), eq(visits.commandId, rejectedCommandId)))).toHaveLength(0);
    const unchanged = await repository.getState(organizationId, matchId);
    expect(unchanged?.version).toBe(state.version);
    expect(unchanged?.status).toBe("IN_PROGRESS");
    expect(unchanged?.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(60);

    // Dieselben 60 Punkte als S20/S20/S20 sind kein Master-Finish, sondern ein Bust.
    state = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId,
        points: 60, dartsThrown: 3,
        darts: [{ segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }],
      },
    });
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.visits[0]?.outcome).toBe("BUST");
    expect(state.participants.find((participant) => participant.playerId === playerOneId)?.remaining).toBe(60);
  });

  it("accepts a master-out treble finish with a checkout segment", async () => {
    // Folge aus D-I1: `checkoutDouble` kann nur D1-D20 und Bull kodieren, ein
    // Triple-Finish war ohne Einzelwuerfe deshalb nicht belegbar. Das
    // verallgemeinerte `checkoutSegment` traegt Segment und Multiplikator und
    // laeuft ueber die volle Strecke: Schema -> Kommando -> Engine ->
    // gespeicherte Nutzlast -> Replay.
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const matchId = created.id;
    await databaseService.database
      .update(matches)
      .set({ outRule: "MASTER" })
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId)));

    let state = created;
    const score = async (playerId: string, points: number) => {
      state = await service.submitVisit({ organizationId, matchId, auth, audit, data: { commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3 } });
    };
    await score(playerOneId, 180); // 501 -> 321
    await score(playerTwoId, 0);
    await score(playerOneId, 180); // 321 -> 141
    await score(playerTwoId, 0);
    await score(playerOneId, 81); // 141 -> 60
    await score(playerTwoId, 0);

    const finished = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: state.version, playerId: playerOneId,
        points: 60, dartsThrown: 1, checkoutSegment: { segment: 20, multiplier: 3 },
        // `checkoutAttempts` wird bewusst NICHT mitgeschickt, wie ein
        // API-Client es tun koennte: die API muss den Versuch selbst ableiten
        // (`defaultCheckoutAttempts`), statt ihn stillschweigend auf 0 zu
        // normalisieren -- sonst zaehlt die Checkout-Quote diesen Checkout
        // nicht (PR-Agent-Runde 3, Befund B).
      },
    });
    expect(finished.status).toBe("COMPLETED");
    expect(finished.winnerPlayerId).toBe(playerOneId);
    // Ein Triple fuellt `checkoutDouble` nicht, der Versuch wird trotzdem
    // gezaehlt. `visits` kommt neueste zuerst, die Abschlussaufnahme steht
    // also vorn.
    expect(finished.visits[0]?.checkoutDouble).toBeNull();
    expect(finished.visits[0]?.checkoutAttempts).toBe(1);
    expect(finished.visits[0]?.outcome).toBe("MATCH_WON");

    // Replay aus der gespeicherten Nutzlast: derselbe Zustand, insbesondere
    // derselbe `checkoutAttempts`-Wert -- die API hat ihn beim Schreiben
    // materialisiert, der Replay liest also dieselbe explizite 1, nicht den
    // `.default(0)` von `storedSubmitSchema`.
    const reloaded = await repository.getState(organizationId, matchId);
    expect(reloaded?.status).toBe("COMPLETED");
    expect(reloaded?.winnerPlayerId).toBe(playerOneId);
    expect(reloaded?.visits[0]?.checkoutAttempts).toBe(1);
  });

  it("reports the opening state of each side under double in", async () => {
    // Die Flaeche schaltet unter Double In vor der Eroeffnung auf
    // Wurf-fuer-Wurf um und braucht dafuer `openedInLeg` aus der Projektion;
    // aus `remaining` ist der Stand nicht ablesbar.
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

    const before = await repository.getState(organizationId, matchId);
    expect(before?.participants.map((participant) => participant.openedInLeg)).toEqual([false, false]);

    const opened = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: before?.version ?? 0, playerId: playerOneId,
        points: 61, dartsThrown: 3,
        darts: [{ segment: 1, multiplier: 1 }, { segment: 20, multiplier: 2 }, { segment: 20, multiplier: 1 }],
      },
    });
    expect(opened.participants.find((participant) => participant.playerId === playerOneId)?.openedInLeg).toBe(true);
    expect(opened.participants.find((participant) => participant.playerId === playerTwoId)?.openedInLeg).toBe(false);
  });

  it("names no live target for a match without a competition", async () => {
    const created = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const state = await repository.getState(organizationId, created.id);
    expect(state?.liveTarget).toBeNull();
  });

  /**
   * Mit dem Ende gibt das Match seine Scheibe frei. Ein Undo eroeffnet es
   * wieder — steht dort inzwischen ein anderes Spiel, stuenden zwei laufende
   * Matches auf einer physischen Scheibe. Der Turnierpfad kannte diesen
   * Schutz, Ligaslots und freie Paarungen nicht.
   */
  it("eroeffnet ein beendetes Match nicht auf einer neu belegten Scheibe", async () => {
    const undoBoardId = randomUUID();
    await databaseService.database
      .insert(boards)
      .values({ id: undoBoardId, organizationId, name: `Undo Board ${undoBoardId}` });
    let state = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId: undoBoardId, bestOfLegs: 1, bestOfSets: 1 },
      auth,
      audit,
    });
    const score = async (playerId: string, points: number, checkoutDouble?: number): Promise<void> => {
      state = await service.submitVisit({
        organizationId,
        matchId: state.id,
        data: {
          commandId: randomUUID(), expectedVersion: state.version, playerId, points, dartsThrown: 3,
          ...(checkoutDouble === undefined ? {} : { checkoutDouble }),
        },
        auth,
        audit,
      });
    };
    await score(playerOneId, 180);
    await score(playerTwoId, 60);
    await score(playerOneId, 180);
    await score(playerTwoId, 60);
    await score(playerOneId, 141, 12);
    expect(state.status).toBe("COMPLETED");
    const completedMatchId = state.id;
    const completedVersion = state.version;

    // Die Scheibe gilt als frei; das naechste Paar startet dort.
    const followUp = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerTwoId, boardId: undoBoardId, bestOfLegs: 1, bestOfSets: 1 },
      auth,
      audit,
    });
    expect(followUp.status).toBe("IN_PROGRESS");

    await expect(
      service.undo({
        organizationId,
        matchId: completedMatchId,
        data: { commandId: randomUUID(), expectedVersion: completedVersion },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: "BOARD_NOT_AVAILABLE" } });

    const running = await databaseService.database
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.organizationId, organizationId), eq(matches.boardId, undoBoardId), eq(matches.status, "IN_PROGRESS")));
    expect(running).toHaveLength(1);
    const unchanged = await service.get({ organizationId, matchId: completedMatchId, auth });
    expect(unchanged).toMatchObject({ status: "COMPLETED", version: completedVersion });
  }, 30_000);

  /**
   * Reglement 2.2.9: das Scoreboard muss den Anwurf verlangen koennen, ohne
   * ihn aus Legnummer und Regelwerk selbst herzuleiten. Der Zustand nennt ihn
   * deshalb als `legStartPending`, und er faellt mit dem Entscheid.
   */
  it("nennt den ausstehenden Anwurf im Zustand und loescht ihn mit dem Entscheid", async () => {
    const created = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId: null, bestOfLegs: 5, bestOfSets: 1 }, auth, audit });
    const controllerId = randomUUID();
    await service.acquireControllerLease({ organizationId, matchId: created.id, controllerId, force: false, auth, audit });
    expect(created.legStartPending).toBe(false);
    expect(created.roundLimitReached).toBe(false);

    const throwVisit = async (
      playerId: string,
      points: number,
      version: number,
      checkout?: { readonly segment: number; readonly multiplier: 2 },
    ) =>
      service.submitVisit({
        organizationId,
        matchId: created.id,
        data: {
          commandId: randomUUID(),
          expectedVersion: version,
          playerId,
          points,
          dartsThrown: 3 as const,
          ...(checkout === undefined ? {} : { checkoutSegment: checkout }),
          controllerId,
        },
        auth,
        audit,
      });

    // 501 in drei Aufnahmen: 180, 180, 141 mit Doppel 12 als Finish (T20 T19
    // D12). Die
    // Gegenseite wirft dazwischen null, damit die Reihenfolge stimmt.
    const playLeg = async (winner: string, loser: string, version: number) => {
      let state = await throwVisit(winner, 180, version);
      state = await throwVisit(loser, 0, state.version);
      state = await throwVisit(winner, 180, state.version);
      state = await throwVisit(loser, 0, state.version);
      return throwVisit(winner, 141, state.version, { segment: 12, multiplier: 2 });
    };

    // Leg eins und zwei ausspielen: erst ab Leg drei entscheidet ein Wurf auf
    // Bull, wer beginnt.
    const afterLegOne = await playLeg(playerOneId, playerTwoId, created.version);
    expect(afterLegOne.currentLegNumber).toBe(2);
    expect(afterLegOne.legStartPending).toBe(false);

    const afterLegTwo = await playLeg(playerTwoId, playerOneId, afterLegOne.version);
    expect(afterLegTwo.currentLegNumber).toBe(3);
    expect(afterLegTwo.legStartPending).toBe(true);

    const decided = await service.decideLegStart({ organizationId, matchId: created.id, data: { commandId: randomUUID(), expectedVersion: afterLegTwo.version, legNumber: 3, startingSeat: 2 as const, controllerId }, auth, audit });
    expect(decided.legStartPending).toBe(false);
    expect(decided.participants.find((side) => side.seat === 2)?.isActive).toBe(true);
  }, 30_000);

  /**
   * Befund I1: Original und Client-Wiederholung treffen gleichzeitig ein. Beide
   * verfehlen die Kommandozeile in der Vorpruefung; ohne eine zweite Pruefung
   * unter der Aggregatsperre bekaeme die zweite einen Versionskonflikt fuer
   * eine Aufnahme, die angekommen ist. In der Offline-Wiedergabe landet das
   * als CONFLICT in der Warteschlange, und der Scorer sieht einen scheinbar
   * verlorenen Wurf.
   */
  it("beantwortet dieselbe commandId auch gleichzeitig idempotent", async () => {
    const created = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId: null, bestOfLegs: 3, bestOfSets: 1 }, auth, audit });
    const controllerId = randomUUID();
    await service.acquireControllerLease({ organizationId, matchId: created.id, controllerId, force: false, auth, audit });

    const visitCommandId = randomUUID();
    const visitInput = { organizationId, matchId: created.id, data: { commandId: visitCommandId, expectedVersion: created.version, playerId: playerOneId, points: 100, dartsThrown: 3 as const, controllerId }, auth, audit };
    const visitResults = await Promise.all(Array.from({ length: 4 }, () => service.submitVisit(visitInput)));
    expect(visitResults.map((state) => state.version)).toEqual([1, 1, 1, 1]);
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, visitCommandId))).toHaveLength(1);

    const undoCommandId = randomUUID();
    const undoInput = { organizationId, matchId: created.id, data: { commandId: undoCommandId, expectedVersion: 1, controllerId }, auth, audit };
    const undoResults = await Promise.all(Array.from({ length: 4 }, () => service.undo(undoInput)));
    expect(undoResults.map((state) => state.version)).toEqual([2, 2, 2, 2]);
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, undoCommandId))).toHaveLength(1);

    // legNumber muss >= 3 sein: Leg eins gehoert fix der Heim-, Leg zwei der
    // Gastseite (`LEG_START_FIXED` in x01.ts); erst ab Leg drei laesst sich
    // die Anwurfseite ueberhaupt per Kommando entscheiden. Fuer diesen Test
    // zaehlt nur, dass eine gleichzeitige Wiederholung idempotent bleibt, die
    // konkrete Legnummer ist dafuer beliebig, solange sie zulaessig ist.
    const legStartCommandId = randomUUID();
    const legStartInput = { organizationId, matchId: created.id, data: { commandId: legStartCommandId, expectedVersion: 2, legNumber: 3, startingSeat: 2 as const, controllerId }, auth, audit };
    const legStartResults = await Promise.all(Array.from({ length: 4 }, () => service.decideLegStart(legStartInput)));
    expect(legStartResults.map((state) => state.version)).toEqual([3, 3, 3, 3]);
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, legStartCommandId))).toHaveLength(1);
  }, 30_000);
});
