import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents, boardControllerLeases, boards, legs, matches, matchParticipants, outboxEvents, players, scoreCommands,
  tournamentCommands, tournamentGroups, tournamentMatches,
  tournaments, tournamentStages,
  visits,
} from "@darts-platform/database";
import { ScoringValidationError, createX01Match, executeX01Command, projectX01Match, type X01Command, type X01Match, type X01MatchState, type X01Side } from "@darts-platform/scoring-engine";
import type { AbortMatchInput, AbortMatchResponse, CorrectTournamentResultInput, CreateMatchInput, MatchStateResponse, SubmitVisitInput, UndoVisitInput } from "@darts-platform/schemas";
import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import { applyWithdrawalPropagation } from "../tournaments/apply-withdrawal-propagation.js";
import { resolveCompletedTournamentGroup } from "../tournaments/resolve-completed-group.js";
import { updateTournamentProgress } from "../tournaments/update-tournament-progress.js";
import { abortScoringMatch } from "./abort-match.js";
import { lockTournamentScoringContext } from "./tournament-scoring-lock.js";

export type MutationResult = "ok" | "not-found" | "version-conflict" | "controller-conflict";
export type AbortMutationResult = AbortMatchResponse | Exclude<MutationResult, "ok">;
export type TournamentCorrectionResult =
  | Exclude<MutationResult, "controller-conflict">
  | "result-not-correctable"
  | "downstream-started"
  | "board-unavailable";
type ActorInput = { readonly organizationId: string; readonly matchId: string; readonly auth: AuthContext; readonly audit: AuditContext };

const seatSchema = z.union([z.literal(1), z.literal(2)]);
// `playerId` stammt aus Kommandos, die vor dem Seitenmodell geschrieben wurden;
// `seat`/`throwerPlayerId` sind die neue Form. Beide müssen lesbar bleiben.
const storedSubmitSchema = z.object({
  type: z.literal("SUBMIT_VISIT"), commandId: z.uuid(), playerId: z.uuid().optional(),
  seat: seatSchema.optional(), throwerPlayerId: z.uuid().optional(), points: z.number().int(),
  dartsThrown: z.union([z.literal(1), z.literal(2), z.literal(3)]), checkoutDouble: z.number().int().optional(), checkoutAttempts: z.number().int().min(0).max(3).default(0),
});
const storedUndoSchema = z.object({ type: z.literal("UNDO_LAST_VISIT"), commandId: z.uuid(), targetCommandId: z.uuid() });
const storedAbortSchema = z.object({ type: z.literal("ABORT_MATCH"), commandId: z.uuid(), tournamentMatchId: z.uuid().nullable() });
const storedCommandSchema = z.discriminatedUnion("type", [storedSubmitSchema, storedUndoSchema]);
const groupRankReferenceSchema = z.object({
  type: z.literal("GROUP_RANK"),
  groupKey: z.string(),
  rank: z.number().int().positive(),
});

function parseStoredCommand(payload: unknown, seatOfPlayer: (playerId: string) => 1 | 2): X01Command {
  const parsed = storedCommandSchema.parse(payload);
  if (parsed.type === "UNDO_LAST_VISIT") return parsed;
  const throwerPlayerId = parsed.throwerPlayerId ?? parsed.playerId;
  if (throwerPlayerId === undefined) {
    throw new ScoringValidationError("INVALID_STORED_COMMAND", "A stored visit needs a thrower.");
  }
  const base = {
    type: parsed.type, commandId: parsed.commandId, seat: parsed.seat ?? seatOfPlayer(throwerPlayerId),
    throwerPlayerId, points: parsed.points, dartsThrown: parsed.dartsThrown,
  } as const;
  return { ...base, checkoutAttempts: parsed.checkoutAttempts, ...(parsed.checkoutDouble === undefined ? {} : { checkoutDouble: parsed.checkoutDouble }) };
}

/**
 * Löst einen Sitz auf die Person auf, die ihn belegt. In Phase 1 hat jeder Sitz
 * genau eine Person, weshalb die erste Position genügt.
 */
function playerOfSeat(state: X01MatchState, seat: 1 | 2 | null): string | null {
  if (seat === null) return null;
  return state.sides.find((side) => side.seat === seat)?.playerIds[0] ?? null;
}

@Injectable()
export class MatchesRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  public async list(organizationId: string): Promise<MatchStateResponse[]> {
    const rows = await this.databaseService.database.select({ id: matches.id }).from(matches).where(and(eq(matches.organizationId, organizationId), notInArray(matches.status, ["ABORTED"]))).orderBy(desc(matches.createdAt));
    const states = await Promise.all(rows.map((row) => this.getState(organizationId, row.id)));
    return states.filter((state): state is MatchStateResponse => state !== null);
  }

  public async getState(organizationId: string, matchId: string): Promise<MatchStateResponse | null> {
    const [matchRow] = await this.databaseService.database
      .select({ match: matches, boardName: boards.name })
      .from(matches).leftJoin(boards, and(eq(boards.id, matches.boardId), eq(boards.organizationId, organizationId)))
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId), notInArray(matches.status, ["ABORTED"]))).limit(1);
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

    const bySeat = new Map(projection.sides.map((side) => [side.seat, side]));
    const first = participantRows[0];
    const second = participantRows[1];
    const participantState = (row: typeof first) => {
      const projected = bySeat.get(row.participant.seat === 1 ? 1 : 2);
      if (projected === undefined) throw new Error("Scoring side invariant violated.");
      return { playerId: row.participant.playerId, displayName: row.displayName, remaining: projected.remaining, legsWon: projected.totalLegsWon, legsWonInSet: projected.legsWonInSet, setsWon: projected.setsWon, isActive: projection.activeThrowerPlayerId === row.participant.playerId };
    };
    return {
      id: matchRow.match.id, organizationId, boardId: matchRow.match.boardId, boardName: matchRow.boardName,
      status: projection.status, version: matchRow.match.version, startingScore: matchRow.match.startingScore,
      bestOfLegs: matchRow.match.bestOfLegs, legsToWin: Math.floor(matchRow.match.bestOfLegs / 2) + 1,
      bestOfSets: matchRow.match.setsToWin * 2 - 1, setsToWin: matchRow.match.setsToWin, currentSetNumber: projection.setNumber,
      currentLegNumber: projection.legNumber, currentLegVersion: legRow.version,
      currentPlayerId: projection.activeThrowerPlayerId, winnerPlayerId: playerOfSeat(projection, projection.winnerSeat),
      participants: [participantState(first), participantState(second)],
      visits: visitRows.map(({ visit, playerDisplayName, legNumber }) => ({
        id: visit.id, commandId: visit.commandId, playerId: visit.playerId, playerDisplayName,
        legNumber,
        points: visit.points, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown,
        scoreBefore: visit.scoreBefore, scoreAfter: visit.scoreAfter, checkoutDouble: visit.checkoutDouble,
        checkoutAttempts: visit.checkoutAttempts,
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
        legsToWinSet: Math.floor(input.data.bestOfLegs / 2) + 1, setsToWin: Math.floor(input.data.bestOfSets / 2) + 1,
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

  public acquireControllerLease(input: ActorInput & { readonly controllerId: string; readonly force: boolean }): Promise<{ readonly controllerId: string; readonly owned: boolean; readonly expiresAt: Date } | null> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [match] = await transaction.select({ id: matches.id, status: matches.status }).from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return null;
      const [current] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10_000);
      const mayOwn = match.status === "IN_PROGRESS" && (input.force || current === undefined || current.controllerId === input.controllerId || current.expiresAt <= now);
      if (!mayOwn && current !== undefined) return { controllerId: current.controllerId, owned: false, expiresAt: current.expiresAt };
      if (!mayOwn) return { controllerId: input.controllerId, owned: false, expiresAt: now };
      await transaction.insert(boardControllerLeases).values({ matchId: input.matchId, organizationId: input.organizationId, controllerId: input.controllerId, userId: input.auth.user.id, expiresAt })
        .onConflictDoUpdate({ target: boardControllerLeases.matchId, set: { controllerId: input.controllerId, userId: input.auth.user.id, expiresAt, updatedAt: now } });
      if (current === undefined || current.controllerId !== input.controllerId) {
        await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: current === undefined ? "BOARD_CONTROLLER_ACQUIRED" : "BOARD_CONTROLLER_TAKEN_OVER", entityType: "Match", entityId: input.matchId, oldValue: current ?? null, newValue: { controllerId: input.controllerId, expiresAt }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      }
      return { controllerId: input.controllerId, owned: true, expiresAt };
    });
  }

  public abort(input: ActorInput & { readonly data: AbortMatchInput }): Promise<AbortMutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<AbortMutationResult> => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.data.commandId}, 0))`);
      const [duplicate] = await transaction.select({ organizationId: scoreCommands.organizationId, matchId: scoreCommands.matchId, payload: scoreCommands.payload }).from(scoreCommands).where(eq(scoreCommands.commandId, input.data.commandId)).limit(1);
      if (duplicate !== undefined) {
        if (duplicate.organizationId !== input.organizationId || duplicate.matchId !== input.matchId) throw new ScoringValidationError("COMMAND_ID_ALREADY_USED", "The command ID has already been used for another match.");
        const payload = storedAbortSchema.safeParse(duplicate.payload);
        if (!payload.success) throw new ScoringValidationError("COMMAND_ID_ALREADY_USED", "The command ID has already been used for another score command.");
        return { matchId: input.matchId, status: "ABORTED", tournamentMatchId: payload.data.tournamentMatchId };
      }
      const tournamentContext = await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return "not-found";
      if (match.version !== input.data.expectedVersion) return "version-conflict";
      if (match.status !== "IN_PROGRESS") throw new ScoringValidationError("MATCH_NOT_ABORTABLE", "Only an active match can be aborted.");
      const [lease] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      if (lease !== undefined && lease.expiresAt > new Date() && lease.controllerId !== input.data.controllerId) return "controller-conflict";
      const scheduled = tournamentContext;
      const aborted = await abortScoringMatch(transaction, { organizationId: input.organizationId, match, commandId: input.data.commandId, tournamentMatchId: scheduled?.id ?? null, ...(input.data.reason === undefined ? {} : { reason: input.data.reason }), source: "DIRECT" });
      if (scheduled !== null) {
        await transaction.update(tournamentMatches).set({ status: "READY", boardId: null, scoringMatchId: null, winnerPlayerId: null, resultType: null, completedAt: null, version: scheduled.version + 1, updatedAt: new Date() }).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.id, scheduled.id)));
        await transaction.update(tournaments).set({ version: sql`${tournaments.version} + 1`, updatedAt: new Date() }).where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, scheduled.tournamentId)));
        await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Tournament", aggregateId: scheduled.tournamentId, eventType: "TOURNAMENT_MATCH_REOPENED", payload: { tournamentId: scheduled.tournamentId, tournamentMatchId: scheduled.id, scoringMatchId: input.matchId } });
      }
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: "MATCH_ABORTED", payload: { matchId: input.matchId, tournamentMatchId: scheduled?.id ?? null, commandId: input.data.commandId, discardedVisitCount: aborted.discardedVisitCount } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "MATCH_ABORTED", entityType: "Match", entityId: input.matchId, oldValue: match, newValue: { status: "ABORTED", reason: input.data.reason ?? null, tournamentMatchId: scheduled?.id ?? null, discardedVisitCount: aborted.discardedVisitCount }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return { matchId: input.matchId, status: "ABORTED", tournamentMatchId: scheduled?.id ?? null };
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
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return "not-found";
      if (match.version !== input.data.expectedVersion) return "version-conflict";
      const [lease] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      if (lease !== undefined && lease.expiresAt > new Date() && lease.controllerId !== input.data.controllerId) return "controller-conflict";
      if (match.status === "COMPLETED") {
        const [publishedTournamentResult] = await transaction
          .select({ id: tournamentMatches.id })
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, input.organizationId),
              eq(tournamentMatches.scoringMatchId, input.matchId),
              eq(tournamentMatches.status, "COMPLETED"),
            ),
          )
          .limit(1);
        if (publishedTournamentResult !== undefined) {
          throw new ScoringValidationError(
            "TOURNAMENT_RESULT_REQUIRES_CORRECTION",
            "Published tournament results must be reopened through result correction.",
          );
        }
      }
      const participantRows = await transaction.select().from(matchParticipants).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.matchId))).orderBy(asc(matchParticipants.seat));
      const commandRows = await transaction.select({ payload: scoreCommands.payload }).from(scoreCommands).where(and(eq(scoreCommands.organizationId, input.organizationId), eq(scoreCommands.matchId, input.matchId))).orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(match, participantRows, commandRows.map((row) => row.payload));
      const commandSide = aggregate.sides.find((side) => side.playerIds.includes(input.data.playerId));
      if (commandSide === undefined) {
        throw new ScoringValidationError("INVALID_MATCH_PARTICIPANTS", "The player does not belong to this match.");
      }
      const command: X01Command = { type: "SUBMIT_VISIT", commandId: input.data.commandId, seat: commandSide.seat, throwerPlayerId: input.data.playerId, points: input.data.points, dartsThrown: input.data.dartsThrown, checkoutAttempts: input.data.checkoutAttempts ?? 0, ...(input.data.checkoutDouble === undefined || input.data.checkoutDouble === null ? {} : { checkoutDouble: input.data.checkoutDouble }) };
      const result = executeX01Command(aggregate, command);
      const applied = result.state.visits.at(-1);
      if (applied === undefined) throw new Error("Visit projection did not return an applied visit.");
      const [leg] = await transaction.select().from(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, applied.legNumber))).for("update").limit(1);
      if (leg === undefined) throw new Error("Active leg invariant violated.");
      const nextVersion = match.version + 1;
      const [createdVisit] = await transaction.insert(visits).values({
        organizationId: input.organizationId, matchId: input.matchId, legId: leg.id, playerId: applied.throwerPlayerId,
        commandId: input.data.commandId, sequence: nextVersion, points: applied.points, appliedPoints: applied.appliedPoints,
        dartsThrown: applied.dartsThrown, scoreBefore: applied.scoreBefore, scoreAfter: applied.scoreAfter,
        checkoutDouble: applied.checkoutDouble, outcome: applied.outcome,
        checkoutAttempts: applied.checkoutAttempts,
      }).returning();
      if (createdVisit === undefined) throw new Error("Visit insert did not return a row.");
      const wonLeg = applied.outcome.endsWith("WON");
      await transaction.update(legs).set({ version: leg.version + 1, ...(wonLeg ? { status: "COMPLETED", winnerPlayerId: applied.throwerPlayerId, completedAt: new Date() } : {}), updatedAt: new Date() }).where(and(eq(legs.organizationId, input.organizationId), eq(legs.id, leg.id)));
      const legStartingPlayerId = playerOfSeat(result.state, result.state.legStartingSeat);
      if (legStartingPlayerId === null) throw new Error("Leg starting seat invariant violated.");
      if (wonLeg && result.state.status === "IN_PROGRESS") await transaction.insert(legs).values({ organizationId: input.organizationId, matchId: input.matchId, legNumber: result.state.legNumber, startingPlayerId: legStartingPlayerId });
      await this.syncProjection(transaction, input, match.boardId, nextVersion, result.state);
      const matchWinnerPlayerId = playerOfSeat(result.state, result.state.winnerSeat);
      if (result.state.status === "COMPLETED" && matchWinnerPlayerId !== null) {
        await this.syncTournamentProgress(
          transaction,
          input.organizationId,
          input.matchId,
          matchWinnerPlayerId,
        );
      }
      await transaction.insert(scoreCommands).values({ commandId: input.data.commandId, organizationId: input.organizationId, matchId: input.matchId, type: command.type, payload: command, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: result.state.status === "COMPLETED" ? "MATCH_COMPLETED" : "VISIT_RECORDED", payload: { matchId: input.matchId, commandId: input.data.commandId, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "SCORE_VISIT_RECORDED", entityType: "Match", entityId: input.matchId, newValue: createdVisit, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return "ok";
    });
  }

  public correctTournamentResult(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: CorrectTournamentResultInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentCorrectionResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [duplicate] = await transaction
        .select({
          organizationId: tournamentCommands.organizationId,
          tournamentId: tournamentCommands.tournamentId,
        })
        .from(tournamentCommands)
        .where(eq(tournamentCommands.commandId, input.data.commandId))
        .limit(1);
      if (duplicate !== undefined) {
        if (
          duplicate.organizationId === input.organizationId &&
          duplicate.tournamentId === input.tournamentId
        ) return "ok";
        throw new ScoringValidationError(
          "COMMAND_ID_ALREADY_USED",
          "The command ID has already been used for another tournament.",
        );
      }

      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(
          and(
            eq(tournaments.organizationId, input.organizationId),
            eq(tournaments.id, input.tournamentId),
          ),
        )
        .for("update")
        .limit(1);
      if (tournament === undefined) return "not-found";
      if (tournament.version !== input.data.expectedVersion) return "version-conflict";

      const [scheduled] = await transaction
        .select()
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, input.organizationId),
            eq(tournamentMatches.tournamentId, input.tournamentId),
            eq(tournamentMatches.id, input.data.matchId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        scheduled === undefined ||
        scheduled.status !== "COMPLETED" ||
        scheduled.scoringMatchId === null ||
        scheduled.winnerPlayerId === null
      ) return "result-not-correctable";

      const [scoringMatch] = await transaction
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.organizationId, input.organizationId),
            eq(matches.id, scheduled.scoringMatchId),
          ),
        )
        .for("update")
        .limit(1);
      if (scoringMatch === undefined || scoringMatch.status !== "COMPLETED") {
        return "result-not-correctable";
      }
      if (scoringMatch.boardId === null) return "board-unavailable";
      const [board] = await transaction
        .select()
        .from(boards)
        .where(
          and(
            eq(boards.organizationId, input.organizationId),
            eq(boards.id, scoringMatch.boardId),
          ),
        )
        .for("update")
        .limit(1);
      if (board === undefined || board.status !== "AVAILABLE") return "board-unavailable";

      if (scheduled.groupId !== null) {
        const [startedKnockout] = await transaction
          .select({ id: tournamentMatches.id })
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, input.organizationId),
              eq(tournamentMatches.tournamentId, input.tournamentId),
              isNull(tournamentMatches.groupId),
              inArray(tournamentMatches.status, ["IN_PROGRESS", "COMPLETED"]),
            ),
          )
          .limit(1);
        if (startedKnockout !== undefined) return "downstream-started";
      } else {
        const [startedDependent] = await transaction
          .select({ id: tournamentMatches.id })
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, input.organizationId),
              eq(tournamentMatches.tournamentId, input.tournamentId),
              or(
                eq(tournamentMatches.sourceOneMatchId, scheduled.id),
                eq(tournamentMatches.sourceTwoMatchId, scheduled.id),
              ),
              inArray(tournamentMatches.status, ["IN_PROGRESS", "COMPLETED"]),
            ),
          )
          .limit(1);
        if (startedDependent !== undefined) return "downstream-started";
      }

      const [latest] = await transaction
        .select()
        .from(visits)
        .where(
          and(
            eq(visits.organizationId, input.organizationId),
            eq(visits.matchId, scoringMatch.id),
            isNull(visits.revertedAt),
          ),
        )
        .orderBy(desc(visits.sequence))
        .limit(1);
      if (latest === undefined || !latest.outcome.endsWith("WON")) {
        return "result-not-correctable";
      }
      const participantRows = await transaction
        .select()
        .from(matchParticipants)
        .where(
          and(
            eq(matchParticipants.organizationId, input.organizationId),
            eq(matchParticipants.matchId, scoringMatch.id),
          ),
        )
        .orderBy(asc(matchParticipants.seat));
      const commandRows = await transaction
        .select({ payload: scoreCommands.payload })
        .from(scoreCommands)
        .where(
          and(
            eq(scoreCommands.organizationId, input.organizationId),
            eq(scoreCommands.matchId, scoringMatch.id),
          ),
        )
        .orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(
        scoringMatch,
        participantRows,
        commandRows.map((row) => row.payload),
      );
      const undoCommand: X01Command = {
        type: "UNDO_LAST_VISIT",
        commandId: input.data.commandId,
        targetCommandId: latest.commandId,
      };
      const result = executeX01Command(aggregate, undoCommand);
      if (result.state.status !== "IN_PROGRESS") return "result-not-correctable";
      const nextMatchVersion = scoringMatch.version + 1;
      const nextTournamentVersion = tournament.version + 1;

      await transaction
        .update(visits)
        .set({ revertedAt: new Date(), revertedByCommandId: input.data.commandId })
        .where(
          and(
            eq(visits.organizationId, input.organizationId),
            eq(visits.id, latest.id),
          ),
        );
      await transaction
        .delete(legs)
        .where(
          and(
            eq(legs.organizationId, input.organizationId),
            eq(legs.matchId, scoringMatch.id),
            eq(legs.legNumber, result.state.legNumber + 1),
          ),
        );
      const [currentLeg] = await transaction
        .select()
        .from(legs)
        .where(
          and(
            eq(legs.organizationId, input.organizationId),
            eq(legs.matchId, scoringMatch.id),
            eq(legs.legNumber, result.state.legNumber),
          ),
        )
        .for("update")
        .limit(1);
      if (currentLeg === undefined) throw new Error("Correction leg invariant violated.");
      await transaction
        .update(legs)
        .set({
          status: "IN_PROGRESS",
          winnerPlayerId: null,
          completedAt: null,
          version: currentLeg.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(legs.organizationId, input.organizationId), eq(legs.id, currentLeg.id)));
      await this.syncProjection(
        transaction,
        {
          organizationId: input.organizationId,
          matchId: scoringMatch.id,
          auth: input.auth,
          audit: input.audit,
        },
        scoringMatch.boardId,
        nextMatchVersion,
        result.state,
      );
      await transaction.insert(scoreCommands).values({
        commandId: input.data.commandId,
        organizationId: input.organizationId,
        matchId: scoringMatch.id,
        type: undoCommand.type,
        payload: undoCommand,
        resultingVersion: nextMatchVersion,
      });

      await transaction
        .update(tournamentMatches)
        .set({
          status: "IN_PROGRESS",
          winnerPlayerId: null,
          resultType: null,
          completedAt: null,
          version: scheduled.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tournamentMatches.organizationId, input.organizationId),
            eq(tournamentMatches.id, scheduled.id),
          ),
        );

      if (scheduled.groupId !== null) {
        await this.clearGroupQualification(
          transaction,
          input.organizationId,
          input.tournamentId,
          scheduled.groupId,
        );
      } else {
        const dependents = await transaction
          .select()
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, input.organizationId),
              eq(tournamentMatches.tournamentId, input.tournamentId),
              or(
                eq(tournamentMatches.sourceOneMatchId, scheduled.id),
                eq(tournamentMatches.sourceTwoMatchId, scheduled.id),
              ),
            ),
          )
          .for("update");
        for (const dependent of dependents) {
          await transaction
            .update(tournamentMatches)
            .set({
              participantOneId:
                dependent.sourceOneMatchId === scheduled.id
                  ? null
                  : dependent.participantOneId,
              participantTwoId:
                dependent.sourceTwoMatchId === scheduled.id
                  ? null
                  : dependent.participantTwoId,
              status: "WAITING",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(tournamentMatches.organizationId, input.organizationId),
                eq(tournamentMatches.id, dependent.id),
              ),
            );
        }
      }

      const reopenedStatus =
        scheduled.groupId !== null || tournament.format === "ROUND_ROBIN"
          ? "GROUP_STAGE"
          : "KNOCKOUT";
      await transaction
        .update(tournamentStages)
        .set({ status: "OPEN", updatedAt: new Date() })
        .where(
          and(
            eq(tournamentStages.organizationId, input.organizationId),
            eq(tournamentStages.id, scheduled.stageId),
          ),
        );
      await transaction
        .update(tournaments)
        .set({ status: reopenedStatus, version: nextTournamentVersion, updatedAt: new Date() })
        .where(
          and(
            eq(tournaments.organizationId, input.organizationId),
            eq(tournaments.id, input.tournamentId),
          ),
        );
      await transaction.insert(tournamentCommands).values({
        commandId: input.data.commandId,
        organizationId: input.organizationId,
        tournamentId: input.tournamentId,
        type: "RESULT_CORRECTION",
        payload: input.data,
        resultingVersion: nextTournamentVersion,
      });
      await transaction.insert(outboxEvents).values([
        {
          organizationId: input.organizationId,
          aggregateType: "Match",
          aggregateId: scoringMatch.id,
          eventType: "MATCH_RESULT_REOPENED",
          payload: {
            matchId: scoringMatch.id,
            tournamentMatchId: scheduled.id,
            commandId: input.data.commandId,
            version: nextMatchVersion,
          },
        },
        {
          organizationId: input.organizationId,
          aggregateType: "Tournament",
          aggregateId: input.tournamentId,
          eventType: "TOURNAMENT_RESULT_CORRECTED",
          payload: {
            tournamentId: input.tournamentId,
            tournamentMatchId: scheduled.id,
            commandId: input.data.commandId,
            version: nextTournamentVersion,
          },
        },
      ]);
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_RESULT_CORRECTED",
        entityType: "TournamentMatch",
        entityId: scheduled.id,
        oldValue: scheduled,
        newValue: {
          status: "IN_PROGRESS",
          scoringMatchVersion: nextMatchVersion,
          reason: input.data.reason,
        },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
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
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return "not-found";
      if (match.version !== input.data.expectedVersion) return "version-conflict";
      const [lease] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      if (lease !== undefined && lease.expiresAt > new Date() && lease.controllerId !== input.data.controllerId) return "controller-conflict";
      if (match.status === "COMPLETED") {
        const [publishedTournamentResult] = await transaction
          .select({ id: tournamentMatches.id })
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, input.organizationId),
              eq(tournamentMatches.scoringMatchId, input.matchId),
              eq(tournamentMatches.status, "COMPLETED"),
            ),
          )
          .limit(1);
        if (publishedTournamentResult !== undefined) {
          throw new ScoringValidationError(
            "TOURNAMENT_RESULT_REQUIRES_CORRECTION",
            "Published tournament results must be reopened through result correction.",
          );
        }
      }
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

  private async clearGroupQualification(
    transaction: Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0],
    organizationId: string,
    tournamentId: string,
    groupId: string,
  ): Promise<void> {
    const [group] = await transaction
      .select({ key: tournamentGroups.key })
      .from(tournamentGroups)
      .where(
        and(
          eq(tournamentGroups.organizationId, organizationId),
          eq(tournamentGroups.tournamentId, tournamentId),
          eq(tournamentGroups.id, groupId),
        ),
      )
      .limit(1);
    if (group === undefined) throw new Error("Correction group invariant violated.");
    const firstRound = await transaction
      .select()
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.tournamentId, tournamentId),
          isNull(tournamentMatches.groupId),
          eq(tournamentMatches.round, 1),
        ),
      )
      .for("update");
    for (const match of firstRound) {
      const firstReference = groupRankReferenceSchema.safeParse(match.participantOneRef);
      const secondReference = groupRankReferenceSchema.safeParse(match.participantTwoRef);
      const participantOneId =
        firstReference.success && firstReference.data.groupKey === group.key
          ? null
          : match.participantOneId;
      const participantTwoId =
        secondReference.success && secondReference.data.groupKey === group.key
          ? null
          : match.participantTwoId;
      if (
        participantOneId === match.participantOneId &&
        participantTwoId === match.participantTwoId
      ) continue;
      await transaction
        .update(tournamentMatches)
        .set({
          participantOneId,
          participantTwoId,
          status:
            participantOneId !== null && participantTwoId !== null ? "READY" : "WAITING",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tournamentMatches.organizationId, organizationId),
            eq(tournamentMatches.id, match.id),
          ),
        );
    }
    await transaction
      .update(tournamentStages)
      .set({ status: "WAITING", updatedAt: new Date() })
      .where(
        and(
          eq(tournamentStages.organizationId, organizationId),
          eq(tournamentStages.tournamentId, tournamentId),
          eq(tournamentStages.type, "SINGLE_ELIMINATION"),
        ),
      );
  }

  private aggregate(match: typeof matches.$inferSelect, participantRows: readonly (typeof matchParticipants.$inferSelect)[], payloads: readonly unknown[]): X01Match {
    const first = participantRows[0]; const second = participantRows[1];
    if (first === undefined || second === undefined) throw new Error("Match participant invariant violated.");
    const sides: readonly [X01Side, X01Side] = [
      { seat: 1, playerIds: [first.playerId] },
      { seat: 2, playerIds: [second.playerId] },
    ];
    const base = createX01Match({
      sides, startingSeat: match.startingPlayerId === first.playerId ? 1 : 2,
      rules: { startingScore: match.startingScore, doubleOut: match.doubleOut, legsToWinSet: match.legsToWinSet, setsToWin: match.setsToWin },
    });
    const seatOfPlayer = (playerId: string): 1 | 2 => (playerId === first.playerId ? 1 : 2);
    return { ...base, commands: payloads.map((payload) => parseStoredCommand(payload, seatOfPlayer)) };
  }

  private async syncProjection(
    transaction: Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0],
    input: ActorInput,
    boardId: string | null,
    version: number,
    state: ReturnType<typeof projectX01Match>,
  ): Promise<void> {
    await Promise.all(state.sides.map((side) => transaction.update(matchParticipants).set({ legsWon: side.totalLegsWon }).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.matchId), eq(matchParticipants.seat, side.seat)))));
    await transaction.update(matches).set({ status: state.status, currentPlayerId: state.activeThrowerPlayerId, winnerPlayerId: playerOfSeat(state, state.winnerSeat), version, completedAt: state.status === "COMPLETED" ? new Date() : null, updatedAt: new Date() }).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId)));
    if (boardId !== null) await transaction.update(boards).set({ status: state.status === "COMPLETED" ? "AVAILABLE" : "IN_USE", updatedAt: new Date() }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, boardId)));
  }

  private async syncTournamentProgress(
    transaction: Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0],
    organizationId: string,
    scoringMatchId: string,
    winnerPlayerId: string,
  ): Promise<void> {
    const [scheduled] = await transaction
      .select()
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.scoringMatchId, scoringMatchId),
        ),
      )
      .for("update")
      .limit(1);
    if (scheduled === undefined) return;

    await transaction
      .update(tournamentMatches)
      .set({
        status: "COMPLETED",
        resultType: "PLAYED",
        winnerPlayerId,
        completedAt: new Date(),
        version: scheduled.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.id, scheduled.id),
        ),
      );

    const dependents = await transaction
      .select()
      .from(tournamentMatches)
      .where(
        and(
          eq(tournamentMatches.organizationId, organizationId),
          eq(tournamentMatches.tournamentId, scheduled.tournamentId),
          or(
            eq(tournamentMatches.sourceOneMatchId, scheduled.id),
            eq(tournamentMatches.sourceTwoMatchId, scheduled.id),
          ),
        ),
      )
      .for("update");
    for (const dependent of dependents) {
      const participantOneId =
        dependent.sourceOneMatchId === scheduled.id
          ? winnerPlayerId
          : dependent.participantOneId;
      const participantTwoId =
        dependent.sourceTwoMatchId === scheduled.id
          ? winnerPlayerId
          : dependent.participantTwoId;
      await transaction
        .update(tournamentMatches)
        .set({
          participantOneId,
          participantTwoId,
          status:
            dependent.status === "WAITING" &&
            participantOneId !== null &&
            participantTwoId !== null
              ? "READY"
              : dependent.status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tournamentMatches.organizationId, organizationId),
            eq(tournamentMatches.id, dependent.id),
          ),
        );
    }

    if (scheduled.groupId !== null) {
      await resolveCompletedTournamentGroup(
        transaction,
        organizationId,
        scheduled.tournamentId,
        scheduled.groupId,
      );
    }

    const now = new Date();
    await applyWithdrawalPropagation(transaction, organizationId, scheduled.tournamentId, now);
    await updateTournamentProgress(transaction, organizationId, scheduled.tournamentId, now);
    await transaction
      .update(tournaments)
      .set({
        version: sql`${tournaments.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(tournaments.organizationId, organizationId),
          eq(tournaments.id, scheduled.tournamentId),
        ),
      );
    await transaction.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Tournament",
      aggregateId: scheduled.tournamentId,
      eventType: "TOURNAMENT_MATCH_COMPLETED",
      payload: {
        tournamentId: scheduled.tournamentId,
        tournamentMatchId: scheduled.id,
        scoringMatchId,
        winnerPlayerId,
      },
    });
  }
}
