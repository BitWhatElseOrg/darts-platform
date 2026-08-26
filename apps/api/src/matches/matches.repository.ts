import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents, boards, legs, matches, matchParticipants, outboxEvents, players, scoreCommands, visits,
} from "@darts-platform/database";
import { ScoringValidationError, createX01Match, executeX01Command, projectX01Match, type X01Command, type X01Match } from "@darts-platform/scoring-engine";
import type { CreateMatchInput, MatchStateResponse, SubmitVisitInput, UndoVisitInput } from "@darts-platform/schemas";
import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

type MutationResult = "ok" | "not-found" | "version-conflict";
type ActorInput = { readonly organizationId: string; readonly matchId: string; readonly auth: AuthContext; readonly audit: AuditContext };

const storedSubmitSchema = z.object({
  type: z.literal("SUBMIT_VISIT"), commandId: z.uuid(), playerId: z.uuid(), points: z.number().int(),
  dartsThrown: z.union([z.literal(1), z.literal(2), z.literal(3)]), checkoutDouble: z.number().int().optional(),
});
const storedUndoSchema = z.object({ type: z.literal("UNDO_LAST_VISIT"), commandId: z.uuid(), targetCommandId: z.uuid() });
const storedCommandSchema = z.discriminatedUnion("type", [storedSubmitSchema, storedUndoSchema]);

function parseStoredCommand(payload: unknown): X01Command {
  const parsed = storedCommandSchema.parse(payload);
  if (parsed.type === "UNDO_LAST_VISIT") return parsed;
  const base = { type: parsed.type, commandId: parsed.commandId, playerId: parsed.playerId, points: parsed.points, dartsThrown: parsed.dartsThrown } as const;
  return parsed.checkoutDouble === undefined ? base : { ...base, checkoutDouble: parsed.checkoutDouble };
}

@Injectable()
export class MatchesRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  public async list(organizationId: string): Promise<MatchStateResponse[]> {
    const rows = await this.databaseService.database.select({ id: matches.id }).from(matches).where(eq(matches.organizationId, organizationId)).orderBy(desc(matches.createdAt));
    const states = await Promise.all(rows.map((row) => this.getState(organizationId, row.id)));
    return states.filter((state): state is MatchStateResponse => state !== null);
  }

  public async getState(organizationId: string, matchId: string): Promise<MatchStateResponse | null> {
    const [matchRow] = await this.databaseService.database
      .select({ match: matches, boardName: boards.name })
      .from(matches).leftJoin(boards, and(eq(boards.id, matches.boardId), eq(boards.organizationId, organizationId)))
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId))).limit(1);
    if (matchRow === undefined) return null;

    const participantRows = await this.databaseService.database
      .select({ participant: matchParticipants, displayName: players.displayName })
      .from(matchParticipants).innerJoin(players, and(eq(players.id, matchParticipants.playerId), eq(players.organizationId, organizationId)))
      .where(and(eq(matchParticipants.organizationId, organizationId), eq(matchParticipants.matchId, matchId)))
      .orderBy(asc(matchParticipants.seat));
    if (participantRows.length !== 2 || participantRows[0] === undefined || participantRows[1] === undefined) throw new Error("Match participant invariant violated.");

    const commandRows = await this.databaseService.database.select().from(scoreCommands)
      .where(and(eq(scoreCommands.organizationId, organizationId), eq(scoreCommands.matchId, matchId)))
      .orderBy(asc(scoreCommands.resultingVersion));
    const aggregate = this.aggregate(matchRow.match, participantRows.map((row) => row.participant), commandRows.map((row) => row.payload));
    const projection = projectX01Match(aggregate);
    const [legRow] = await this.databaseService.database.select().from(legs)
      .where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, matchId), eq(legs.legNumber, projection.legNumber))).limit(1);
    if (legRow === undefined) throw new Error("Current leg invariant violated.");

    const visitRows = await this.databaseService.database
      .select({ visit: visits, playerDisplayName: players.displayName, legNumber: legs.legNumber })
      .from(visits).innerJoin(players, and(eq(players.id, visits.playerId), eq(players.organizationId, organizationId)))
      .innerJoin(legs, and(eq(legs.id, visits.legId), eq(legs.organizationId, organizationId)))
      .where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, matchId)))
      .orderBy(desc(visits.sequence));

    const byId = new Map(projection.players.map((player) => [player.id, player]));
    const first = participantRows[0];
    const second = participantRows[1];
    const participantState = (row: typeof first) => {
      const projected = byId.get(row.participant.playerId);
      if (projected === undefined) throw new Error("Scoring player invariant violated.");
      return { playerId: row.participant.playerId, displayName: row.displayName, remaining: projected.remaining, legsWon: projected.totalLegsWon, isActive: projection.activePlayerId === row.participant.playerId };
    };
    return {
      id: matchRow.match.id, organizationId, boardId: matchRow.match.boardId, boardName: matchRow.boardName,
      status: projection.status, version: matchRow.match.version, startingScore: matchRow.match.startingScore,
      bestOfLegs: matchRow.match.bestOfLegs, legsToWin: Math.floor(matchRow.match.bestOfLegs / 2) + 1,
      currentLegNumber: projection.legNumber, currentLegVersion: legRow.version,
      currentPlayerId: projection.activePlayerId, winnerPlayerId: projection.winnerPlayerId,
      participants: [participantState(first), participantState(second)],
      visits: visitRows.map(({ visit, playerDisplayName, legNumber }) => ({
        id: visit.id, commandId: visit.commandId, playerId: visit.playerId, playerDisplayName,
        legNumber,
        points: visit.points, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown,
        scoreBefore: visit.scoreBefore, scoreAfter: visit.scoreAfter, checkoutDouble: visit.checkoutDouble,
        outcome: visit.outcome as "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON",
        reverted: visit.revertedAt !== null, createdAt: visit.createdAt,
      })),
      createdAt: matchRow.match.createdAt, updatedAt: matchRow.match.updatedAt,
    };
  }

  public async create(input: { readonly organizationId: string; readonly data: CreateMatchInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<string> {
    return this.databaseService.database.transaction(async (transaction) => {
      const playerRows = await transaction.select({ id: players.id, status: players.status }).from(players)
        .where(and(eq(players.organizationId, input.organizationId), inArray(players.id, [input.data.playerOneId, input.data.playerTwoId])));
      if (playerRows.length !== 2 || playerRows.some((player) => player.status !== "ACTIVE")) throw new ScoringValidationError("INVALID_MATCH_PARTICIPANTS", "Both match players must be active members of the organization.");
      if (input.data.boardId !== undefined && input.data.boardId !== null) {
        const [board] = await transaction.select().from(boards).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId))).for("update").limit(1);
        if (board === undefined || board.status !== "AVAILABLE") throw new ScoringValidationError("BOARD_NOT_AVAILABLE", "Selected board is not available.");
      }
      const [created] = await transaction.insert(matches).values({
        organizationId: input.organizationId, boardId: input.data.boardId ?? null, bestOfLegs: input.data.bestOfLegs,
        startingPlayerId: input.data.startingPlayerId, currentPlayerId: input.data.startingPlayerId,
      }).returning();
      if (created === undefined) throw new Error("Match insert did not return a row.");
      await transaction.insert(matchParticipants).values([
        { organizationId: input.organizationId, matchId: created.id, playerId: input.data.playerOneId, seat: 1 },
        { organizationId: input.organizationId, matchId: created.id, playerId: input.data.playerTwoId, seat: 2 },
      ]);
      await transaction.insert(legs).values({ organizationId: input.organizationId, matchId: created.id, legNumber: 1, startingPlayerId: input.data.startingPlayerId });
      if (input.data.boardId !== undefined && input.data.boardId !== null) await transaction.update(boards).set({ status: "IN_USE", updatedAt: new Date() }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId)));
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: created.id, eventType: "MATCH_STARTED", payload: { matchId: created.id } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "MATCH_CREATED", entityType: "Match", entityId: created.id, newValue: created, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return created.id;
    });
  }

  public submitVisit(input: ActorInput & { readonly data: SubmitVisitInput }): Promise<MutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<MutationResult> => {
      const [duplicate] = await transaction.select({ organizationId: scoreCommands.organizationId, matchId: scoreCommands.matchId }).from(scoreCommands)
        .where(eq(scoreCommands.commandId, input.data.commandId)).limit(1);
      if (duplicate !== undefined) {
        if (duplicate.organizationId === input.organizationId && duplicate.matchId === input.matchId) return "ok";
        throw new ScoringValidationError("COMMAND_ID_ALREADY_USED", "The command ID has already been used for another match.");
      }
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return "not-found";
      if (match.version !== input.data.expectedVersion) return "version-conflict";
      const participantRows = await transaction.select().from(matchParticipants).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.matchId))).orderBy(asc(matchParticipants.seat));
      const commandRows = await transaction.select({ payload: scoreCommands.payload }).from(scoreCommands).where(and(eq(scoreCommands.organizationId, input.organizationId), eq(scoreCommands.matchId, input.matchId))).orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(match, participantRows, commandRows.map((row) => row.payload));
      const command: X01Command = { type: "SUBMIT_VISIT", commandId: input.data.commandId, playerId: input.data.playerId, points: input.data.points, dartsThrown: input.data.dartsThrown, ...(input.data.checkoutDouble === undefined || input.data.checkoutDouble === null ? {} : { checkoutDouble: input.data.checkoutDouble }) };
      const result = executeX01Command(aggregate, command);
      const applied = result.state.visits.at(-1);
      if (applied === undefined) throw new Error("Visit projection did not return an applied visit.");
      const [leg] = await transaction.select().from(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, applied.legNumber))).for("update").limit(1);
      if (leg === undefined) throw new Error("Active leg invariant violated.");
      const nextVersion = match.version + 1;
      const [createdVisit] = await transaction.insert(visits).values({
        organizationId: input.organizationId, matchId: input.matchId, legId: leg.id, playerId: applied.playerId,
        commandId: input.data.commandId, sequence: nextVersion, points: applied.points, appliedPoints: applied.appliedPoints,
        dartsThrown: applied.dartsThrown, scoreBefore: applied.scoreBefore, scoreAfter: applied.scoreAfter,
        checkoutDouble: applied.checkoutDouble, outcome: applied.outcome,
      }).returning();
      if (createdVisit === undefined) throw new Error("Visit insert did not return a row.");
      const wonLeg = applied.outcome.endsWith("WON");
      await transaction.update(legs).set({ version: leg.version + 1, ...(wonLeg ? { status: "COMPLETED", winnerPlayerId: applied.playerId, completedAt: new Date() } : {}), updatedAt: new Date() }).where(and(eq(legs.organizationId, input.organizationId), eq(legs.id, leg.id)));
      if (wonLeg && result.state.status === "IN_PROGRESS") await transaction.insert(legs).values({ organizationId: input.organizationId, matchId: input.matchId, legNumber: result.state.legNumber, startingPlayerId: result.state.legStartingPlayerId });
      await this.syncProjection(transaction, input, match.boardId, nextVersion, result.state);
      await transaction.insert(scoreCommands).values({ commandId: input.data.commandId, organizationId: input.organizationId, matchId: input.matchId, type: command.type, payload: command, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: result.state.status === "COMPLETED" ? "MATCH_COMPLETED" : "VISIT_RECORDED", payload: { matchId: input.matchId, commandId: input.data.commandId, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "SCORE_VISIT_RECORDED", entityType: "Match", entityId: input.matchId, newValue: createdVisit, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return "ok";
    });
  }

  public undo(input: ActorInput & { readonly data: UndoVisitInput }): Promise<MutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<MutationResult> => {
      const [duplicate] = await transaction.select({ organizationId: scoreCommands.organizationId, matchId: scoreCommands.matchId }).from(scoreCommands).where(eq(scoreCommands.commandId, input.data.commandId)).limit(1);
      if (duplicate !== undefined) {
        if (duplicate.organizationId === input.organizationId && duplicate.matchId === input.matchId) return "ok";
        throw new ScoringValidationError("COMMAND_ID_ALREADY_USED", "The command ID has already been used for another match.");
      }
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return "not-found";
      if (match.version !== input.data.expectedVersion) return "version-conflict";
      const [latest] = await transaction.select().from(visits).where(and(eq(visits.organizationId, input.organizationId), eq(visits.matchId, input.matchId), isNull(visits.revertedAt))).orderBy(desc(visits.sequence)).limit(1);
      if (latest === undefined) throw new ScoringValidationError("NOTHING_TO_UNDO", "There is no visit to undo.");
      const participantRows = await transaction.select().from(matchParticipants).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.matchId))).orderBy(asc(matchParticipants.seat));
      const commandRows = await transaction.select({ payload: scoreCommands.payload }).from(scoreCommands).where(and(eq(scoreCommands.organizationId, input.organizationId), eq(scoreCommands.matchId, input.matchId))).orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(match, participantRows, commandRows.map((row) => row.payload));
      const command: X01Command = { type: "UNDO_LAST_VISIT", commandId: input.data.commandId, targetCommandId: latest.commandId };
      const result = executeX01Command(aggregate, command);
      const nextVersion = match.version + 1;
      await transaction.update(visits).set({ revertedAt: new Date(), revertedByCommandId: input.data.commandId }).where(and(eq(visits.organizationId, input.organizationId), eq(visits.id, latest.id)));
      await transaction.delete(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, result.state.legNumber + 1)));
      const [currentLeg] = await transaction.select().from(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, result.state.legNumber))).for("update").limit(1);
      if (currentLeg === undefined) throw new Error("Undo leg invariant violated.");
      await transaction.update(legs).set({ status: "IN_PROGRESS", winnerPlayerId: null, completedAt: null, version: currentLeg.version + 1, updatedAt: new Date() }).where(eq(legs.id, currentLeg.id));
      await this.syncProjection(transaction, input, match.boardId, nextVersion, result.state);
      await transaction.insert(scoreCommands).values({ commandId: input.data.commandId, organizationId: input.organizationId, matchId: input.matchId, type: command.type, payload: command, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: "VISIT_REVERTED", payload: { matchId: input.matchId, visitId: latest.id, commandId: input.data.commandId, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "SCORE_VISIT_REVERTED", entityType: "Visit", entityId: latest.id, oldValue: latest, newValue: { revertedByCommandId: input.data.commandId }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return "ok";
    });
  }

  private aggregate(match: typeof matches.$inferSelect, participantRows: readonly (typeof matchParticipants.$inferSelect)[], payloads: readonly unknown[]): X01Match {
    const first = participantRows[0]; const second = participantRows[1];
    if (first === undefined || second === undefined) throw new Error("Match participant invariant violated.");
    const base = createX01Match({
      playerIds: [first.playerId, second.playerId], startingPlayerIndex: match.startingPlayerId === first.playerId ? 0 : 1,
      rules: { startingScore: match.startingScore, doubleOut: true, legsToWinSet: Math.floor(match.bestOfLegs / 2) + 1, setsToWin: 1 },
    });
    return { ...base, commands: payloads.map(parseStoredCommand) };
  }

  private async syncProjection(
    transaction: Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0],
    input: ActorInput,
    boardId: string | null,
    version: number,
    state: ReturnType<typeof projectX01Match>,
  ): Promise<void> {
    await Promise.all(state.players.map((player) => transaction.update(matchParticipants).set({ legsWon: player.totalLegsWon }).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.matchId), eq(matchParticipants.playerId, player.id)))));
    await transaction.update(matches).set({ status: state.status, currentPlayerId: state.activePlayerId, winnerPlayerId: state.winnerPlayerId, version, completedAt: state.status === "COMPLETED" ? new Date() : null, updatedAt: new Date() }).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId)));
    if (boardId !== null) await transaction.update(boards).set({ status: state.status === "COMPLETED" ? "AVAILABLE" : "IN_USE", updatedAt: new Date() }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, boardId)));
  }
}
