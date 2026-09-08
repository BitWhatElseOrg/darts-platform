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
  generateDoubleElimination,
  previewTournamentStructure,
  TournamentValidationError,
  validateStageComposition,
  type GroupMatchResult,
} from "@darts-platform/tournament-engine";
import {
  publicTournamentDashboardSchema,
  tournamentDashboardSchema,
  advancedFormatPreviewSchema,
  tournamentListSchema,
  tournamentStructurePreviewSchema,
  tournamentSummarySchema,
  type AssignMatchInput,
  type AdvancedFormatPreview,
  type AdvancedFormatPreviewInput,
  type CorrectTournamentResultInput,
  type CreateTournamentInput,
  type GroupStanding,
  type PublicTournamentDashboard,
  type ReleaseBoardInput,
  type SetTournamentVisibilityInput,
  type TournamentDashboard,
  type TournamentStructurePreview,
  type TournamentStructurePreviewInput,
  type TournamentSummary,
  type WithdrawTournamentParticipantInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { rethrowScoringError } from "../common/scoring-error.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import type { TournamentCorrectionResult } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { DisplayKeysService } from "./display-keys.service.js";
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
    @Inject(DisplayKeysService) private readonly displayKeys: DisplayKeysService,
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

  public async advancedPreview(input: {
    readonly organizationId: string;
    readonly data: AdvancedFormatPreviewInput;
    readonly auth: AuthContext;
  }): Promise<AdvancedFormatPreview> {
    await this.require(input, "tournament:read");
    const stages = input.data.stages.map((stage) => stage.type === "SWISS"
      ? { key: stage.key, type: stage.type, rounds: stage.rounds ?? 1, advance: stage.advance ?? input.data.participantCount }
      : stage.type === "PLACEMENT"
        ? { key: stage.key, type: stage.type, places: [3, 4] as const }
        : { key: stage.key, type: stage.type, advance: stage.advance ?? 1 });
    validateStageComposition(stages);
    let entrants = input.data.participantCount;
    const warnings: string[] = [];
    const projected = stages.map((stage) => {
      let matchCount: number;
      if (stage.type === "ROUND_ROBIN") matchCount = entrants * (entrants - 1) / 2;
      else if (stage.type === "SWISS") matchCount = Math.ceil(entrants / 2) * stage.rounds;
      else if (stage.type === "DOUBLE_ELIMINATION") {
        const size = 2 ** Math.ceil(Math.log2(entrants));
        if (![4, 8, 16, 32, 64].includes(size)) throw new TournamentValidationError("INVALID_DOUBLE_ELIMINATION_SIZE", "Double Elimination braucht 4 bis 64 Tableauplätze.");
        matchCount = generateDoubleElimination(size as 4 | 8 | 16 | 32 | 64).length;
        if (size !== entrants) warnings.push(`${stage.key}: ${size - entrants} Byes werden eingeplant.`);
      } else if (stage.type === "SINGLE_ELIMINATION") matchCount = Math.max(entrants - 1, 0);
      else matchCount = 1;
      const advancingCount = stage.type === "PLACEMENT" ? 2 : Math.min(stage.advance, entrants);
      const row = { key: stage.key, type: stage.type, entrantCount: entrants, advancingCount, matchCount };
      entrants = advancingCount;
      return row;
    });
    return advancedFormatPreviewSchema.parse({
      participantCount: input.data.participantCount,
      competitorKind: input.data.competitorKind,
      bestOfLegs: input.data.bestOfLegs,
      bestOfSets: input.data.bestOfSets,
      totalMatches: projected.reduce((sum, stage) => sum + stage.matchCount, 0),
      stages: projected,
      warnings,
    });
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

  /**
   * Nimmt die `public_id`, nicht die interne ID. Ein privates Turnier
   * antwortet mit 404 statt 403: ein 403 bestaetigte, dass es die Adresse gibt.
   *
   * Zwei Eintrittskarten: das Turnier ist oeffentlich, oder der Aufrufer
   * bringt einen gueltigen Anzeige-Schluessel mit. Beides scheitert nach
   * aussen gleich — 404 —, damit die Antwort nicht verraet, welche der beiden
   * Bedingungen gefehlt hat. Die Sitzungspruefung am Socket kommt in Plan 3 —
   * dann wandert die Entscheidung in eine reine Funktion.
   */
  public async publicDashboard(
    publicId: string,
    displayKeySecret?: string,
  ): Promise<PublicTournamentDashboard> {
    const data = await this.repository.getPublicDashboardDataByPublicId(publicId);
    const allowed =
      data !== null ||
      (displayKeySecret !== undefined &&
        (await this.displayKeys.resolve(publicId, displayKeySecret)) === "valid");
    if (!allowed) throw new NotFoundException("Turnier nicht gefunden.");
    const resolved = data ?? (await this.repository.getPrivateDashboardDataByPublicId(publicId));
    if (resolved === null) throw new NotFoundException("Turnier nicht gefunden.");
    const dashboard = await this.projectDashboard(resolved);
    // Die oeffentliche Sicht wird Feld fuer Feld gebaut, nicht aus der
    // internen durchgereicht: so faellt jedes neue interne Feld auf, statt
    // sich stillschweigend nach draussen zu vererben (Audit B, I-1).
    const { organizationId, id, visibility, ...tournament } = dashboard.tournament;
    void organizationId;
    void id;
    void visibility;
    return publicTournamentDashboardSchema.parse({
      tournament,
      participants: dashboard.participants.map((participant) => ({
        playerId: participant.playerId,
        displayName: participant.displayName,
        seed: participant.seed,
        status: participant.status,
      })),
      boards: dashboard.boards.map(({ blockedReason, ...board }) => {
        void blockedReason;
        return board;
      }),
      queue: dashboard.queue.map(({ blockedReason, ...entry }) => {
        void blockedReason;
        return entry;
      }),
      groups: dashboard.groups,
      bracket: dashboard.bracket,
      recentResults: dashboard.recentResults,
      generatedAt: dashboard.generatedAt,
    });
  }

  /** Siehe `PublicTournamentsController.address` — Uebergangsweg mit Frist. */
  public async publicAddress(tournamentId: string): Promise<{ readonly publicId: string }> {
    const address = await this.repository.getPublicAddress(tournamentId);
    if (address === null) throw new NotFoundException("Turnier nicht gefunden.");
    return address;
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

  public async withdrawParticipant(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: WithdrawTournamentParticipantInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDashboard> {
    await this.require(input, "tournament:update");
    return this.mutate(input, () => this.repository.withdrawParticipant(input));
  }

  /**
   * Eine Freigabe nach aussen ist eine kritische Benutzeraktion und wird
   * auditiert (AGENTS.md §4) — der Audit-Satz entsteht in derselben
   * Transaktion wie die Aenderung, in `repository.updateVisibility`, genau
   * wie bei den uebrigen Mutationen dieser Datei. Die Berechtigung ist
   * `tournament:update`: die Sichtbarkeit ist eine Eigenschaft des Turniers.
   * Das Verteilen von Anzeige-Schluesseln bekommt in Plan 2 eine eigene
   * Berechtigung, weil es eine andere Handlung ist.
   */
  public async setVisibility(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: SetTournamentVisibilityInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDashboard> {
    await this.require(input, "tournament:update");
    return this.mutate(input, () =>
      this.repository.updateVisibility({
        organizationId: input.organizationId,
        tournamentId: input.tournamentId,
        visibility: input.data.visibility,
        auth: input.auth,
        audit: input.audit,
      }),
    );
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
      if (result === "tournament-completed") {
        throw new ConflictException({ code: "TOURNAMENT_ALREADY_COMPLETED", message: "Aus einem abgeschlossenen Turnier kann kein Spieler zurückgezogen werden.", details: { currentState: current } });
      }
      if (result === "participant-already-withdrawn") {
        throw new ConflictException({ code: "TOURNAMENT_PARTICIPANT_ALREADY_WITHDRAWN", message: "Der Spieler wurde bereits aus diesem Turnier zurückgezogen.", details: { currentState: current } });
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
    // Eine Abfrage je Match statt eine je Match und Zusatzabfrage: `getStates`
    // laedt den Live-Bezug aller Paarungen gebuendelt (matches.repository.ts).
    // Das Command Centre holt dieses Dashboard alle fuenf Sekunden neu.
    const scoringById = await this.matchesRepository.getStates(
      data.tournament.organizationId,
      data.matches.flatMap((match) => (match.scoringMatchId === null ? [] : [match.scoringMatchId])),
    );
    const names = new Map(
      data.participants.map((participant) => [participant.playerId, participant.displayName]),
    );
    const withdrawnPlayerIds = data.participants
      .filter((participant) => participant.status === "WITHDRAWN")
      .map((participant) => participant.playerId);
    const activeMatches = data.matches.filter((match) => match.status === "IN_PROGRESS");
    // Die Warteschlange darf nichts als „bereit“ zeigen, was `assign` ablehnt.
    // Der Startpfad prueft vereinsweit — Turnier, Liga und freie Paarungen —,
    // die Anzeige tut hier dasselbe.
    const activePlayers = new Set([
      ...data.activePlayerIds,
      ...activeMatches.flatMap((match) =>
        [match.participantOneId, match.participantTwoId].filter(
          (playerId): playerId is string => playerId !== null,
        ),
      ),
    ]);
    const isBoardFree = (board: { readonly boardId: string; readonly boardStatus: string }): boolean =>
      board.boardStatus === "AVAILABLE" && !data.occupiedBoardIds.has(board.boardId);
    const availableBoardCount = data.boards.filter(isBoardFree).length;
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
            bestOfSets: scoring.bestOfSets,
            startedAt: scoring.createdAt,
            overrunning: false,
            participants: scoring.participants.map((participant) => ({
              playerId: participant.playerId,
              displayName: participant.displayName,
              remaining: participant.remaining,
              legsWon: participant.legsWon,
              setsWon: participant.setsWon,
              isActive: participant.isActive,
              onFinish: false,
              checkoutRoute: null,
            })) as [
              {
                playerId: string;
                displayName: string;
                remaining: number;
                legsWon: number;
                setsWon: number;
                isActive: boolean;
                onFinish: boolean;
                checkoutRoute: null;
              },
              {
                playerId: string;
                displayName: string;
                remaining: number;
                legsWon: number;
                setsWon: number;
                isActive: boolean;
                onFinish: boolean;
                checkoutRoute: null;
              },
            ],
          },
        };
      }
      const blocked = !isBoardFree(board);
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
      const results: GroupMatchResult[] = [];
      for (const match of groupMatches) {
        if (
          match.status !== "COMPLETED" ||
          match.participantOneId === null ||
          match.participantTwoId === null ||
          match.winnerPlayerId === null
        ) {
          continue;
        }
        if (match.resultType === "WALKOVER") {
          results.push({
            type: "WALKOVER" as const,
            playerOneId: match.participantOneId,
            playerTwoId: match.participantTwoId,
            playerOneLegs: 0 as const,
            playerTwoLegs: 0 as const,
            winnerPlayerId: match.winnerPlayerId,
          });
          continue;
        }
        if (match.scoringMatchId === null) continue;
        const scoring = scoringById.get(match.scoringMatchId);
        const first = scoring?.participants.find(
          (participant) => participant.playerId === match.participantOneId,
        );
        const second = scoring?.participants.find(
          (participant) => participant.playerId === match.participantTwoId,
        );
        if (first === undefined || second === undefined) continue;
        results.push({
          type: "PLAYED",
          playerOneId: first.playerId,
          playerTwoId: second.playerId,
          playerOneLegs: first.legsWon,
          playerTwoLegs: second.legsWon,
          winnerPlayerId: match.winnerPlayerId,
        });
      }
      const ranking = calculateGroupStandings({ participants: members, results, withdrawnPlayerIds });
      const complete = results.length === groupMatches.length;
      const qualifiedPlayerIds = new Set(
        ranking.filter((row) => !row.withdrawn).slice(0, group.qualifyCount).map((row) => row.playerId),
      );
      return {
        groupLabel: group.label,
        qualifyCount: group.qualifyCount,
        playedMatches: results.length,
        totalMatches: groupMatches.length,
        rows: ranking.map((row) => ({
          ...row,
          displayName: names.get(row.playerId) ?? "Unbekannter Teilnehmer",
          qualified: complete && qualifiedPlayerIds.has(row.playerId),
        })),
      };
    });

    const completedMatches = data.matches.filter((match) =>
      ["COMPLETED", "BYE"].includes(match.status),
    ).length;
    const conflicts = data.boards.flatMap((board) =>
      isBoardFree(board)
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
        publicId: data.tournament.publicId,
        visibility: data.tournament.visibility,
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
        inRule: data.tournament.inRule,
        outRule: data.tournament.outRule,
        playedMatches: completedMatches,
        totalMatches: data.matches.length,
        startsAt: data.tournament.startsAt,
      },
      participants: data.participants.map((participant) => ({
        playerId: participant.playerId,
        displayName: participant.displayName,
        seed: participant.seed,
        status: participant.status,
        withdrawnAt: participant.withdrawnAt,
        withdrawalReason: participant.withdrawalReason,
      })),
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
          resultType: match.resultType,
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
          resultType: match.resultType ?? "PLAYED",
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
    // `correctResult` laeuft ueber `MatchesRepository` und traegt damit auch
    // die Fehler der Scoring Engine — ohne diese Abbildung kaeme eine fremde
    // `commandId` als 500 heraus statt als 400.
    rethrowScoringError(error);
  }
}
