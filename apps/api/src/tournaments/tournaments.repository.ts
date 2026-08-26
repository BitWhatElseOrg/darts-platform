import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, or } from "drizzle-orm";

import {
  auditEvents,
  boards,
  legs,
  matches,
  matchParticipants,
  outboxEvents,
  players,
  tournamentBoards,
  tournamentCommands,
  tournamentGroupParticipants,
  tournamentGroups,
  tournamentMatches,
  tournamentParticipants,
  tournaments,
  tournamentStages,
} from "@darts-platform/database";
import {
  createTournamentPlan,
  TournamentValidationError,
  type KnockoutParticipantReference,
  type PlannedMatch,
} from "@darts-platform/tournament-engine";
import type {
  AssignMatchInput,
  CreateTournamentInput,
  ReleaseBoardInput,
  TournamentSummary,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

export type TournamentMutationResult =
  | "ok"
  | "not-found"
  | "version-conflict"
  | "match-not-ready"
  | "board-unavailable"
  | "player-busy";

interface ActorInput {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly auth: AuthContext;
  readonly audit: AuditContext;
}

export interface TournamentDashboardData {
  readonly tournament: typeof tournaments.$inferSelect;
  readonly participants: readonly {
    readonly id: string;
    readonly playerId: string;
    readonly displayName: string;
    readonly seed: number;
  }[];
  readonly boards: readonly {
    readonly boardId: string;
    readonly boardName: string;
    readonly boardStatus: string;
    readonly ringNumber: number;
  }[];
  readonly groups: readonly (typeof tournamentGroups.$inferSelect)[];
  readonly groupParticipants: readonly (typeof tournamentGroupParticipants.$inferSelect)[];
  readonly matches: readonly (typeof tournamentMatches.$inferSelect)[];
}

function playerIdFrom(reference: KnockoutParticipantReference | null): string | null {
  return reference?.type === "PLAYER" ? reference.playerId : null;
}

function stageLabel(match: PlannedMatch, groupLabels: ReadonlyMap<string, string>): string {
  if (match.stageType === "GROUP" && match.groupKey !== null) {
    return `Gruppe ${groupLabels.get(match.groupKey) ?? match.groupKey}`;
  }
  if (match.stageType === "ROUND_ROBIN") return "Jeder gegen jeden";
  return `K.-o. · Runde ${match.round}`;
}

@Injectable()
export class TournamentsRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  public async list(organizationId: string): Promise<TournamentSummary[]> {
    const rows = await this.databaseService.database
      .select()
      .from(tournaments)
      .where(eq(tournaments.organizationId, organizationId))
      .orderBy(asc(tournaments.startsAt));
    return Promise.all(
      rows.map(async (tournament) => {
        const [participantRows, boardRows, matchRows] = await Promise.all([
          this.databaseService.database
            .select({ id: tournamentParticipants.id })
            .from(tournamentParticipants)
            .where(
              and(
                eq(tournamentParticipants.organizationId, organizationId),
                eq(tournamentParticipants.tournamentId, tournament.id),
              ),
            ),
          this.databaseService.database
            .select({ id: tournamentBoards.id })
            .from(tournamentBoards)
            .where(
              and(
                eq(tournamentBoards.organizationId, organizationId),
                eq(tournamentBoards.tournamentId, tournament.id),
              ),
            ),
          this.databaseService.database
            .select({ status: tournamentMatches.status })
            .from(tournamentMatches)
            .where(
              and(
                eq(tournamentMatches.organizationId, organizationId),
                eq(tournamentMatches.tournamentId, tournament.id),
              ),
            ),
        ]);
        return {
          id: tournament.id,
          organizationId,
          name: tournament.name,
          status: tournament.status as TournamentSummary["status"],
          format: tournament.format as TournamentSummary["format"],
          participantCount: participantRows.length,
          boardCount: boardRows.length,
          playedMatches: matchRows.filter((match) =>
            ["COMPLETED", "BYE"].includes(match.status),
          ).length,
          totalMatches: matchRows.length,
          startsAt: tournament.startsAt,
          updatedAt: tournament.updatedAt,
        };
      }),
    );
  }

  public async getPublicDashboardData(tournamentId: string): Promise<TournamentDashboardData | null> {
    const [tournament] = await this.databaseService.database
      .select({ organizationId: tournaments.organizationId })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);
    if (tournament === undefined) return null;
    return this.getDashboardData(tournament.organizationId, tournamentId);
  }

  public async getDashboardData(
    organizationId: string,
    tournamentId: string,
  ): Promise<TournamentDashboardData | null> {
    const [tournament] = await this.databaseService.database
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, tournamentId)))
      .limit(1);
    if (tournament === undefined) return null;

    const [participantRows, boardRows, groupRows, groupParticipantRows, matchRows] =
      await Promise.all([
        this.databaseService.database
          .select({
            id: tournamentParticipants.id,
            playerId: tournamentParticipants.playerId,
            displayName: players.displayName,
            seed: tournamentParticipants.seed,
          })
          .from(tournamentParticipants)
          .innerJoin(
            players,
            and(
              eq(players.id, tournamentParticipants.playerId),
              eq(players.organizationId, organizationId),
            ),
          )
          .where(
            and(
              eq(tournamentParticipants.organizationId, organizationId),
              eq(tournamentParticipants.tournamentId, tournamentId),
            ),
          )
          .orderBy(asc(tournamentParticipants.seed)),
        this.databaseService.database
          .select({
            boardId: tournamentBoards.boardId,
            boardName: boards.name,
            boardStatus: boards.status,
            ringNumber: tournamentBoards.ringNumber,
          })
          .from(tournamentBoards)
          .innerJoin(
            boards,
            and(eq(boards.id, tournamentBoards.boardId), eq(boards.organizationId, organizationId)),
          )
          .where(
            and(
              eq(tournamentBoards.organizationId, organizationId),
              eq(tournamentBoards.tournamentId, tournamentId),
            ),
          )
          .orderBy(asc(tournamentBoards.ringNumber)),
        this.databaseService.database
          .select()
          .from(tournamentGroups)
          .where(
            and(
              eq(tournamentGroups.organizationId, organizationId),
              eq(tournamentGroups.tournamentId, tournamentId),
            ),
          )
          .orderBy(asc(tournamentGroups.sequence)),
        this.databaseService.database
          .select()
          .from(tournamentGroupParticipants)
          .where(
            and(
              eq(tournamentGroupParticipants.organizationId, organizationId),
              eq(tournamentGroupParticipants.tournamentId, tournamentId),
            ),
          ),
        this.databaseService.database
          .select()
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, organizationId),
              eq(tournamentMatches.tournamentId, tournamentId),
            ),
          )
          .orderBy(
            asc(tournamentMatches.stageId),
            asc(tournamentMatches.round),
            asc(tournamentMatches.position),
          ),
      ]);
    return {
      tournament,
      participants: participantRows,
      boards: boardRows,
      groups: groupRows,
      groupParticipants: groupParticipantRows,
      matches: matchRows,
    };
  }

  public async create(input: {
    readonly organizationId: string;
    readonly data: CreateTournamentInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<string> {
    const engineParticipants = input.data.participantIds.map((playerId, index) => ({
      playerId,
      seed: index + 1,
    }));
    const plan = createTournamentPlan({
      format: input.data.format,
      participants: engineParticipants,
      groupCount: input.data.groupCount,
      qualifyPerGroup: input.data.qualifyPerGroup,
      knockoutSize: input.data.knockoutSize,
      seeding: input.data.seeding,
      randomSeed: input.audit.correlationId
        .replaceAll("-", "")
        .slice(0, 8)
        .split("")
        .reduce((seed, character) => seed + character.charCodeAt(0), 0),
    });

    return this.databaseService.database.transaction(async (transaction) => {
      const [playerRows, boardRows] = await Promise.all([
        transaction
          .select({ id: players.id, status: players.status })
          .from(players)
          .where(
            and(
              eq(players.organizationId, input.organizationId),
              inArray(players.id, input.data.participantIds),
            ),
          ),
        transaction
          .select({ id: boards.id, status: boards.status })
          .from(boards)
          .where(
            and(
              eq(boards.organizationId, input.organizationId),
              inArray(boards.id, input.data.boardIds),
            ),
          ),
      ]);
      if (
        playerRows.length !== input.data.participantIds.length ||
        playerRows.some((player) => player.status !== "ACTIVE")
      ) {
        throw new TournamentValidationError(
          "INVALID_TOURNAMENT_PARTICIPANTS",
          "Every participant must be active and belong to the organization.",
        );
      }
      if (
        boardRows.length !== input.data.boardIds.length ||
        boardRows.some((board) => board.status !== "AVAILABLE")
      ) {
        throw new TournamentValidationError(
          "INVALID_TOURNAMENT_BOARDS",
          "Every board must be available and belong to the organization.",
        );
      }

      const initialStatus =
        input.data.format === "SINGLE_ELIMINATION" ? "KNOCKOUT" : "GROUP_STAGE";
      const [created] = await transaction
        .insert(tournaments)
        .values({
          organizationId: input.organizationId,
          name: input.data.name,
          status: initialStatus,
          format: input.data.format,
          startingScore: input.data.startingScore,
          doubleOut: input.data.doubleOut,
          bestOfLegs: input.data.bestOfLegs,
          groupCount: input.data.groupCount,
          qualifyPerGroup: input.data.qualifyPerGroup,
          knockoutSize: input.data.knockoutSize,
          seeding: input.data.seeding,
          startsAt: input.data.startsAt,
        })
        .returning();
      if (created === undefined) throw new Error("Tournament insert did not return a row.");

      await transaction.insert(tournamentParticipants).values(
        engineParticipants.map((participant) => ({
          organizationId: input.organizationId,
          tournamentId: created.id,
          playerId: participant.playerId,
          seed: participant.seed,
        })),
      );
      await transaction.insert(tournamentBoards).values(
        input.data.boardIds.map((boardId, index) => ({
          organizationId: input.organizationId,
          tournamentId: created.id,
          boardId,
          ringNumber: index + 1,
        })),
      );

      const stageDefinitions =
        input.data.format === "GROUPS_THEN_KNOCKOUT"
          ? [
              { key: "groups", sequence: 1, name: "Gruppenphase", type: "GROUP", status: "OPEN" },
              {
                key: "knockout",
                sequence: 2,
                name: "K.-o.-Runde",
                type: "SINGLE_ELIMINATION",
                status: "WAITING",
              },
            ]
          : input.data.format === "ROUND_ROBIN"
            ? [
                {
                  key: "round-robin",
                  sequence: 1,
                  name: "Jeder gegen jeden",
                  type: "ROUND_ROBIN",
                  status: "OPEN",
                },
              ]
            : [
                {
                  key: "knockout",
                  sequence: 1,
                  name: "K.-o.-Runde",
                  type: "SINGLE_ELIMINATION",
                  status: "OPEN",
                },
              ];
      const createdStages = await transaction
        .insert(tournamentStages)
        .values(
          stageDefinitions.map((stage) => ({
            ...stage,
            organizationId: input.organizationId,
            tournamentId: created.id,
          })),
        )
        .returning();
      const stageByType = new Map(createdStages.map((stage) => [stage.type, stage]));
      const groupStage = stageByType.get("GROUP");
      const createdGroups =
        plan.groups.length === 0
          ? []
          : await transaction
              .insert(tournamentGroups)
              .values(
                plan.groups.map((group) => {
                  if (groupStage === undefined) throw new Error("Group stage invariant violated.");
                  return {
                    organizationId: input.organizationId,
                    tournamentId: created.id,
                    stageId: groupStage.id,
                    key: group.key,
                    label: group.label,
                    sequence: group.sequence,
                    qualifyCount: input.data.qualifyPerGroup,
                  };
                }),
              )
              .returning();
      const groupByKey = new Map(createdGroups.map((group) => [group.key, group]));
      if (plan.groups.length > 0) {
        await transaction.insert(tournamentGroupParticipants).values(
          plan.groups.flatMap((group) => {
            const storedGroup = groupByKey.get(group.key);
            if (storedGroup === undefined) throw new Error("Stored group invariant violated.");
            return group.participants.map((participant) => ({
              organizationId: input.organizationId,
              tournamentId: created.id,
              groupId: storedGroup.id,
              playerId: participant.playerId,
              seed: participant.seed,
            }));
          }),
        );
      }

      const groupLabels = new Map(plan.groups.map((group) => [group.key, group.label]));
      const matchValues = plan.matches.map((match) => {
        const stage = stageByType.get(match.stageType);
        if (stage === undefined) throw new Error(`Stage ${match.stageType} was not stored.`);
        return {
          organizationId: input.organizationId,
          tournamentId: created.id,
          stageId: stage.id,
          groupId: match.groupKey === null ? null : (groupByKey.get(match.groupKey)?.id ?? null),
          key: match.key,
          stageLabel: stageLabel(match, groupLabels),
          round: match.round,
          position: match.position,
          status: match.state,
          participantOneId: playerIdFrom(match.participantOne),
          participantTwoId: playerIdFrom(match.participantTwo),
          participantOneRef: match.participantOne,
          participantTwoRef: match.participantTwo,
          winnerPlayerId: match.byeWinnerPlayerId,
        };
      });
      const createdMatches = await transaction.insert(tournamentMatches).values(matchValues).returning();
      const matchByKey = new Map(createdMatches.map((match) => [match.key, match]));
      const automaticWinners = new Map(
        createdMatches.flatMap((match) =>
          match.status === "BYE" && match.winnerPlayerId !== null
            ? [[match.key, match.winnerPlayerId] as const]
            : [],
        ),
      );
      for (const planned of plan.matches) {
        const stored = matchByKey.get(planned.key);
        if (stored === undefined) throw new Error("Stored match invariant violated.");
        const firstSource =
          planned.participantOne?.type === "MATCH_WINNER"
            ? matchByKey.get(planned.participantOne.matchKey)
            : undefined;
        const secondSource =
          planned.participantTwo?.type === "MATCH_WINNER"
            ? matchByKey.get(planned.participantTwo.matchKey)
            : undefined;
        const participantOneId =
          planned.participantOne?.type === "MATCH_WINNER"
            ? (automaticWinners.get(planned.participantOne.matchKey) ?? null)
            : playerIdFrom(planned.participantOne);
        const participantTwoId =
          planned.participantTwo?.type === "MATCH_WINNER"
            ? (automaticWinners.get(planned.participantTwo.matchKey) ?? null)
            : playerIdFrom(planned.participantTwo);
        await transaction
          .update(tournamentMatches)
          .set({
            sourceOneMatchId: firstSource?.id ?? null,
            sourceTwoMatchId: secondSource?.id ?? null,
            participantOneId,
            participantTwoId,
            status:
              stored.status === "WAITING" && participantOneId !== null && participantTwoId !== null
                ? "READY"
                : stored.status,
          })
          .where(
            and(
              eq(tournamentMatches.organizationId, input.organizationId),
              eq(tournamentMatches.id, stored.id),
            ),
          );
      }

      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "Tournament",
        aggregateId: created.id,
        eventType: "TOURNAMENT_CREATED",
        payload: { tournamentId: created.id, format: created.format },
      });
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_CREATED",
        entityType: "Tournament",
        entityId: created.id,
        newValue: created,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return created.id;
    });
  }

  public assign(input: ActorInput & { readonly data: AssignMatchInput }): Promise<TournamentMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [duplicate] = await transaction
        .select({ organizationId: tournamentCommands.organizationId, tournamentId: tournamentCommands.tournamentId })
        .from(tournamentCommands)
        .where(eq(tournamentCommands.commandId, input.data.commandId))
        .limit(1);
      if (duplicate !== undefined) {
        if (duplicate.organizationId === input.organizationId && duplicate.tournamentId === input.tournamentId) return "ok";
        throw new TournamentValidationError(
          "COMMAND_ID_ALREADY_USED",
          "The command ID has already been used for another tournament.",
        );
      }
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)))
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
        scheduled.status !== "READY" ||
        scheduled.participantOneId === null ||
        scheduled.participantTwoId === null
      ) {
        return "match-not-ready";
      }
      const [selectedBoard] = await transaction
        .select({ board: boards })
        .from(tournamentBoards)
        .innerJoin(
          boards,
          and(eq(boards.id, tournamentBoards.boardId), eq(boards.organizationId, input.organizationId)),
        )
        .where(
          and(
            eq(tournamentBoards.organizationId, input.organizationId),
            eq(tournamentBoards.tournamentId, input.tournamentId),
            eq(tournamentBoards.boardId, input.data.boardId),
          ),
        )
        .for("update")
        .limit(1);
      if (selectedBoard === undefined || selectedBoard.board.status !== "AVAILABLE") {
        return "board-unavailable";
      }
      const [busy] = await transaction
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, input.organizationId),
            eq(tournamentMatches.status, "IN_PROGRESS"),
            or(
              inArray(tournamentMatches.participantOneId, [scheduled.participantOneId, scheduled.participantTwoId]),
              inArray(tournamentMatches.participantTwoId, [scheduled.participantOneId, scheduled.participantTwoId]),
            ),
          ),
        )
        .limit(1);
      if (busy !== undefined) return "player-busy";

      const [scoringMatch] = await transaction
        .insert(matches)
        .values({
          organizationId: input.organizationId,
          boardId: input.data.boardId,
          startingScore: tournament.startingScore,
          doubleOut: tournament.doubleOut,
          bestOfLegs: tournament.bestOfLegs,
          startingPlayerId: scheduled.participantOneId,
          currentPlayerId: scheduled.participantOneId,
        })
        .returning();
      if (scoringMatch === undefined) throw new Error("Scoring match insert did not return a row.");
      await transaction.insert(matchParticipants).values([
        { organizationId: input.organizationId, matchId: scoringMatch.id, playerId: scheduled.participantOneId, seat: 1 },
        { organizationId: input.organizationId, matchId: scoringMatch.id, playerId: scheduled.participantTwoId, seat: 2 },
      ]);
      await transaction.insert(legs).values({
        organizationId: input.organizationId,
        matchId: scoringMatch.id,
        legNumber: 1,
        startingPlayerId: scheduled.participantOneId,
      });
      const nextVersion = tournament.version + 1;
      await transaction
        .update(boards)
        .set({ status: "IN_USE", updatedAt: new Date() })
        .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId)));
      await transaction
        .update(tournamentMatches)
        .set({
          status: "IN_PROGRESS",
          boardId: input.data.boardId,
          scoringMatchId: scoringMatch.id,
          version: scheduled.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.id, scheduled.id)));
      await transaction
        .update(tournaments)
        .set({ version: nextVersion, updatedAt: new Date() })
        .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)));
      await transaction.insert(tournamentCommands).values({
        commandId: input.data.commandId,
        organizationId: input.organizationId,
        tournamentId: input.tournamentId,
        type: "ASSIGN_MATCH",
        payload: input.data,
        resultingVersion: nextVersion,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "Tournament",
        aggregateId: input.tournamentId,
        eventType: "TOURNAMENT_MATCH_ASSIGNED",
        payload: { tournamentId: input.tournamentId, tournamentMatchId: scheduled.id, scoringMatchId: scoringMatch.id, boardId: input.data.boardId, version: nextVersion },
      });
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_MATCH_ASSIGNED",
        entityType: "TournamentMatch",
        entityId: scheduled.id,
        oldValue: scheduled,
        newValue: { status: "IN_PROGRESS", boardId: input.data.boardId, scoringMatchId: scoringMatch.id },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  public releaseBoard(
    input: ActorInput & { readonly data: ReleaseBoardInput },
  ): Promise<TournamentMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [duplicate] = await transaction
        .select({ organizationId: tournamentCommands.organizationId, tournamentId: tournamentCommands.tournamentId })
        .from(tournamentCommands)
        .where(eq(tournamentCommands.commandId, input.data.commandId))
        .limit(1);
      if (duplicate !== undefined) {
        if (duplicate.organizationId === input.organizationId && duplicate.tournamentId === input.tournamentId) return "ok";
        throw new TournamentValidationError(
          "COMMAND_ID_ALREADY_USED",
          "The command ID has already been used for another tournament.",
        );
      }
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)))
        .for("update")
        .limit(1);
      if (tournament === undefined) return "not-found";
      if (tournament.version !== input.data.expectedVersion) return "version-conflict";
      const [selected] = await transaction
        .select({ board: boards })
        .from(tournamentBoards)
        .innerJoin(boards, and(eq(boards.id, tournamentBoards.boardId), eq(boards.organizationId, input.organizationId)))
        .where(
          and(
            eq(tournamentBoards.organizationId, input.organizationId),
            eq(tournamentBoards.tournamentId, input.tournamentId),
            eq(tournamentBoards.boardId, input.data.boardId),
          ),
        )
        .for("update")
        .limit(1);
      if (selected === undefined) return "board-unavailable";
      const [active] = await transaction
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, input.organizationId),
            eq(tournamentMatches.tournamentId, input.tournamentId),
            eq(tournamentMatches.boardId, input.data.boardId),
            eq(tournamentMatches.status, "IN_PROGRESS"),
          ),
        )
        .limit(1);
      if (active !== undefined) return "board-unavailable";
      const nextVersion = tournament.version + 1;
      await transaction
        .update(boards)
        .set({ status: "AVAILABLE", updatedAt: new Date() })
        .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId)));
      await transaction
        .update(tournaments)
        .set({ version: nextVersion, updatedAt: new Date() })
        .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)));
      await transaction.insert(tournamentCommands).values({
        commandId: input.data.commandId,
        organizationId: input.organizationId,
        tournamentId: input.tournamentId,
        type: "RELEASE_BOARD",
        payload: input.data,
        resultingVersion: nextVersion,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "Tournament",
        aggregateId: input.tournamentId,
        eventType: "TOURNAMENT_BOARD_RELEASED",
        payload: { tournamentId: input.tournamentId, boardId: input.data.boardId, version: nextVersion },
      });
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_BOARD_RELEASED",
        entityType: "Board",
        entityId: input.data.boardId,
        oldValue: selected.board,
        newValue: { status: "AVAILABLE" },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }
}
