import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { evaluateMatchReadiness } from "@darts-platform/scheduling-engine";
import {
  calculateGroupStandings,
  previewTournamentStructure,
  TournamentValidationError,
} from "@darts-platform/tournament-engine";
import {
  tournamentDashboardSchema,
  tournamentListSchema,
  tournamentStructurePreviewSchema,
  tournamentSummarySchema,
  type AssignMatchInput,
  type CorrectTournamentResultInput,
  type CreateTournamentInput,
  type GroupStanding,
  type MatchStateResponse,
  type ReleaseBoardInput,
  type TournamentDashboard,
  type TournamentStructurePreview,
  type TournamentStructurePreviewInput,
  type TournamentSummary,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import type { TournamentCorrectionResult } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import {
  TournamentsRepository,
  type TournamentDashboardData,
  type TournamentMutationResult,
} from "./tournaments.repository.js";

export class TournamentVersionConflictException extends ConflictException {
  public constructor(currentState: TournamentDashboard) {
    super({
      code: "TOURNAMENT_VERSION_CONFLICT",
      message: "Der Turnierzustand hat sich geändert. Synchronisiere mit dem Serverzustand.",
      details: { currentState },
    });
  }
}

@Injectable()
export class TournamentsService {
  public constructor(
    @Inject(TournamentsRepository) private readonly repository: TournamentsRepository,
    @Inject(MatchesRepository) private readonly matchesRepository: MatchesRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async list(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<TournamentSummary[]> {
    await this.require(input, "tournament:read");
    return tournamentListSchema.parse(await this.repository.list(input.organizationId));
  }

  public async preview(input: {
    readonly organizationId: string;
    readonly data: TournamentStructurePreviewInput;
    readonly auth: AuthContext;
  }): Promise<TournamentStructurePreview> {
    await this.require(input, "tournament:read");
    return tournamentStructurePreviewSchema.parse(previewTournamentStructure(input.data));
  }

  public async create(input: {
    readonly organizationId: string;
    readonly data: CreateTournamentInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentSummary> {
    await this.require(input, "tournament:create");
    try {
      const tournamentId = await this.repository.create(input);
      const created = (await this.repository.list(input.organizationId)).find(
        (tournament) => tournament.id === tournamentId,
      );
      if (created === undefined) throw new Error("Created tournament could not be loaded.");
      return tournamentSummarySchema.parse(created);
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }

  public async dashboard(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly auth: AuthContext;
  }): Promise<TournamentDashboard> {
    await this.require(input, "tournament:read");
    const data = await this.repository.getDashboardData(
      input.organizationId,
      input.tournamentId,
    );
    if (data === null) throw new NotFoundException("Tournament not found.");
    return this.projectDashboard(data);
  }

  public async publicDashboard(tournamentId: string): Promise<TournamentDashboard> {
    const data = await this.repository.getPublicDashboardData(tournamentId);
    if (data === null) throw new NotFoundException("Turnier nicht gefunden.");
    return this.projectDashboard(data);
  }

  public async assign(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: AssignMatchInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDashboard> {
    await this.require(input, "board:assign");
    return this.mutate(input, () => this.repository.assign(input));
  }

  public async releaseBoard(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: ReleaseBoardInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDashboard> {
    await this.require(input, "board:assign");
    return this.mutate(input, () => this.repository.releaseBoard(input));
  }

  public async correctResult(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: CorrectTournamentResultInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDashboard> {
    await this.require(input, "tournament:update");
    return this.mutate(input, () => this.matchesRepository.correctTournamentResult(input));
  }

  private async mutate(
    input: {
      readonly organizationId: string;
      readonly tournamentId: string;
      readonly auth: AuthContext;
    },
    mutation: () => Promise<TournamentMutationResult | TournamentCorrectionResult>,
  ): Promise<TournamentDashboard> {
    try {
      const result = await mutation();
      if (result === "not-found") throw new NotFoundException("Tournament not found.");
      const current = await this.dashboard(input);
      if (result === "version-conflict") throw new TournamentVersionConflictException(current);
      if (result === "match-not-ready") {
        throw new ConflictException({
          code: "TOURNAMENT_MATCH_NOT_READY",
          message: "Das Match ist noch nicht startbereit.",
          details: { currentState: current },
        });
      }
      if (result === "board-unavailable") {
        throw new ConflictException({
          code: "BOARD_NOT_AVAILABLE",
          message: "Das Board ist nicht verfügbar.",
          details: { currentState: current },
        });
      }
      if (result === "player-busy") {
        throw new ConflictException({
          code: "TOURNAMENT_PLAYER_BUSY",
          message: "Mindestens ein Teilnehmer spielt bereits.",
          details: { currentState: current },
        });
      }
      if (result === "result-not-correctable") {
        throw new ConflictException({
          code: "TOURNAMENT_RESULT_NOT_CORRECTABLE",
          message: "Dieses Ergebnis kann nicht mehr korrigiert werden.",
          details: { currentState: current },
        });
      }
      if (result === "downstream-started") {
        throw new ConflictException({
          code: "TOURNAMENT_DEPENDENT_MATCH_STARTED",
          message: "Ein abhängiges Match wurde bereits gestartet. Korrigiere zuerst dessen Ergebnis.",
          details: { currentState: current },
        });
      }
      return current;
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }

  private async projectDashboard(data: TournamentDashboardData): Promise<TournamentDashboard> {
    const scoringPairs = await Promise.all(
      data.matches.flatMap((match) =>
        match.scoringMatchId === null
          ? []
          : [
              this.matchesRepository
                .getState(data.tournament.organizationId, match.scoringMatchId)
                .then((state) => [match.scoringMatchId, state] as const),
            ],
      ),
    );
    const scoringById = new Map(
      scoringPairs.filter(
        (entry): entry is readonly [string, MatchStateResponse] => entry[1] !== null,
      ),
    );
    const names = new Map(
      data.participants.map((participant) => [participant.playerId, participant.displayName]),
    );
    const activeMatches = data.matches.filter((match) => match.status === "IN_PROGRESS");
    const activePlayers = new Set(
      activeMatches.flatMap((match) =>
        [match.participantOneId, match.participantTwoId].filter(
          (playerId): playerId is string => playerId !== null,
        ),
      ),
    );
    const availableBoardCount = data.boards.filter(
      (board) => board.boardStatus === "AVAILABLE",
    ).length;
    const generatedAt = new Date();
    const boards = data.boards.map((board) => {
      const scheduled = activeMatches.find((match) => match.boardId === board.boardId);
      const scoring =
        scheduled?.scoringMatchId === null || scheduled?.scoringMatchId === undefined
          ? undefined
          : scoringById.get(scheduled.scoringMatchId);
      if (scheduled !== undefined && scoring !== undefined) {
        return {
          boardId: board.boardId,
          boardName: board.boardName,
          ringNumber: board.ringNumber,
          state: "PLAYING" as const,
          blockedReason: null,
          match: {
            matchId: scheduled.id,
            version: scoring.version,
            stageLabel: scheduled.stageLabel,
            legNumber: scoring.currentLegNumber,
            bestOfLegs: scoring.bestOfLegs,
            startedAt: scoring.createdAt,
            overrunning: false,
            participants: scoring.participants.map((participant) => ({
              playerId: participant.playerId,
              displayName: participant.displayName,
              remaining: participant.remaining,
              legsWon: participant.legsWon,
              isActive: participant.isActive,
              onFinish: false,
              checkoutRoute: null,
            })) as [
              {
                playerId: string;
                displayName: string;
                remaining: number;
                legsWon: number;
                isActive: boolean;
                onFinish: boolean;
                checkoutRoute: null;
              },
              {
                playerId: string;
                displayName: string;
                remaining: number;
                legsWon: number;
                isActive: boolean;
                onFinish: boolean;
                checkoutRoute: null;
              },
            ],
          },
        };
      }
      const blocked = board.boardStatus !== "AVAILABLE";
      return {
        boardId: board.boardId,
        boardName: board.boardName,
        ringNumber: board.ringNumber,
        state: blocked ? ("BLOCKED" as const) : ("FREE" as const),
        blockedReason: blocked ? "Board ist ausser Betrieb oder durch ein anderes Match belegt." : null,
        match: null,
      };
    });

    const queueMatches = data.matches.filter((match) =>
      ["READY", "WAITING"].includes(match.status),
    );
    const queue = queueMatches.map((match, index) => {
      const decision = evaluateMatchReadiness({
        participantIds: [match.participantOneId, match.participantTwoId],
        activePlayerIds: activePlayers,
        availableBoardCount,
        matchStatus: match.status as "WAITING" | "READY",
        tournamentStatus: data.tournament.status as
          | "READY"
          | "GROUP_STAGE"
          | "KNOCKOUT"
          | "COMPLETED",
      });
      const readiness = decision.ready
        ? "READY"
        : decision.code === "BLOCKED_MATCH_FINISHED"
          ? "BLOCKED_STAGE_NOT_OPEN"
          : decision.code;
      return {
        matchId: match.id,
        position: index + 1,
        stageLabel: match.stageLabel,
        readiness,
        blockedReason: decision.ready ? null : decision.reason,
        participants: [
          {
            playerId: match.participantOneId,
            displayName:
              match.participantOneId === null
                ? "Teilnehmer noch offen"
                : (names.get(match.participantOneId) ?? "Unbekannter Teilnehmer"),
          },
          {
            playerId: match.participantTwoId,
            displayName:
              match.participantTwoId === null
                ? "Teilnehmer noch offen"
                : (names.get(match.participantTwoId) ?? "Unbekannter Teilnehmer"),
          },
        ] as const,
      };
    });

    const groups: GroupStanding[] = data.groups.map((group) => {
      const members = data.groupParticipants
        .filter((participant) => participant.groupId === group.id)
        .map((participant) => ({ playerId: participant.playerId, seed: participant.seed }));
      const groupMatches = data.matches.filter((match) => match.groupId === group.id);
      const results = groupMatches.flatMap((match) => {
        if (
          match.status !== "COMPLETED" ||
          match.scoringMatchId === null ||
          match.participantOneId === null ||
          match.participantTwoId === null ||
          match.winnerPlayerId === null
        ) {
          return [];
        }
        const scoring = scoringById.get(match.scoringMatchId);
        const first = scoring?.participants.find(
          (participant) => participant.playerId === match.participantOneId,
        );
        const second = scoring?.participants.find(
          (participant) => participant.playerId === match.participantTwoId,
        );
        return first === undefined || second === undefined
          ? []
          : [
              {
                playerOneId: first.playerId,
                playerTwoId: second.playerId,
                playerOneLegs: first.legsWon,
                playerTwoLegs: second.legsWon,
                winnerPlayerId: match.winnerPlayerId,
              },
            ];
      });
      const ranking = calculateGroupStandings({ participants: members, results });
      const complete = results.length === groupMatches.length;
      return {
        groupLabel: group.label,
        qualifyCount: group.qualifyCount,
        playedMatches: results.length,
        totalMatches: groupMatches.length,
        rows: ranking.map((row) => ({
          ...row,
          displayName: names.get(row.playerId) ?? "Unbekannter Teilnehmer",
          qualified: complete && row.position <= group.qualifyCount,
        })),
      };
    });

    const completedMatches = data.matches.filter((match) =>
      ["COMPLETED", "BYE"].includes(match.status),
    ).length;
    const conflicts = data.boards.flatMap((board) =>
      board.boardStatus === "AVAILABLE"
        ? []
        : [
            {
              id: board.boardId,
              severity: "WARNING" as const,
              code: "BOARD_BLOCKED",
              message: `${board.boardName} ist nicht verfügbar.`,
              subject: board.boardName,
              detectedAt: generatedAt,
            },
          ],
    );
    return tournamentDashboardSchema.parse({
      tournament: {
        id: data.tournament.id,
        organizationId: data.tournament.organizationId,
        name: data.tournament.name,
        status: data.tournament.status,
        format: data.tournament.format,
        version: data.tournament.version,
        stageLabel:
          data.tournament.status === "GROUP_STAGE"
            ? "Gruppenphase"
            : data.tournament.status === "KNOCKOUT"
              ? "K.-o.-Runde"
              : data.tournament.status === "COMPLETED"
                ? "Turnier beendet"
                : "Startbereit",
        startingScore: data.tournament.startingScore,
        doubleOut: data.tournament.doubleOut,
        playedMatches: completedMatches,
        totalMatches: data.matches.length,
        startsAt: data.tournament.startsAt,
      },
      boards,
      queue,
      conflicts,
      groups,
      bracket: data.matches
        .filter((match) => match.stageLabel.startsWith("K.-o."))
        .sort((left, right) => left.round - right.round || left.position - right.position)
        .map((match) => ({
          matchId: match.id,
          stageLabel: match.stageLabel,
          round: match.round,
          position: match.position,
          status: match.status,
          participantNames: [
            match.participantOneId === null
              ? "Noch offen"
              : (names.get(match.participantOneId) ?? "Unbekannter Teilnehmer"),
            match.participantTwoId === null
              ? "Noch offen"
              : (names.get(match.participantTwoId) ?? "Unbekannter Teilnehmer"),
          ],
          winnerDisplayName:
            match.winnerPlayerId === null ? null : (names.get(match.winnerPlayerId) ?? null),
        })),
      recentResults: data.matches
        .filter(
          (match) =>
            match.status === "COMPLETED" &&
            match.participantOneId !== null &&
            match.participantTwoId !== null &&
            match.winnerPlayerId !== null &&
            match.completedAt !== null,
        )
        .sort(
          (left, right) =>
            (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0),
        )
        .slice(0, 10)
        .map((match) => ({
          matchId: match.id,
          stageLabel: match.stageLabel,
          participantNames: [
            names.get(match.participantOneId ?? "") ?? "Unbekannter Teilnehmer",
            names.get(match.participantTwoId ?? "") ?? "Unbekannter Teilnehmer",
          ],
          winnerPlayerId: match.winnerPlayerId,
          winnerDisplayName: names.get(match.winnerPlayerId ?? "") ?? "Unbekannter Teilnehmer",
          completedAt: match.completedAt,
        })),
      generatedAt,
    });
  }

  private async require(
    input: { readonly organizationId: string; readonly auth: AuthContext },
    permission: "tournament:read" | "tournament:create" | "tournament:update" | "board:assign",
  ): Promise<void> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission,
    });
  }

  private rethrowDomainError(error: unknown): never {
    if (error instanceof TournamentValidationError) {
      throw new BadRequestException({ code: error.code, message: error.message });
    }
    throw error;
  }
}
