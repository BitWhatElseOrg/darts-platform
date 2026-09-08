import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import {
  auditEvents,
  boards,
  legs,
  matches,
  matchParticipantPlayers,
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
  resolveTournamentWithdrawals,
  TournamentValidationError,
  type KnockoutParticipantReference,
  type PlannedMatch,
} from "@darts-platform/tournament-engine";
import type { TournamentVisibility } from "@darts-platform/domain";
import type {
  AssignMatchInput,
  CreateTournamentInput,
  ReleaseBoardInput,
  TournamentSummary,
  WithdrawTournamentParticipantInput,
} from "@darts-platform/schemas";
import { withdrawTournamentParticipantSchema } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import {
  isBoardInProgressConflict,
  isBoardOccupied,
  loadActivePlayerIds,
  loadOccupiedBoardIds,
  lockPlayers,
} from "../boards/board-occupancy.js";
import type { AuditContext } from "../common/audit-context.js";
import { retryOnDeadlock } from "../common/retry-on-deadlock.js";
import { DatabaseService } from "../database/database.service.js";
import { abortScoringMatch } from "../matches/abort-match.js";
import { resolveCompletedTournamentGroup } from "./resolve-completed-group.js";
import { updateTournamentProgress } from "./update-tournament-progress.js";
import { getWalkoverWithdrawnPlayerId } from "./walkover-provenance.js";

export type TournamentMutationResult =
  | "ok"
  | "not-found"
  | "version-conflict"
  | "match-not-ready"
  | "board-unavailable"
  | "player-busy"
  | "tournament-completed"
  | "participant-already-withdrawn";

interface ActorInput {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly auth: AuthContext;
  readonly audit: AuditContext;
}

/** Der Transaktionsrumpf, wie ihn Drizzle an den Callback uebergibt. */
type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

export interface TournamentDashboardData {
  readonly tournament: typeof tournaments.$inferSelect;
  readonly participants: readonly {
    readonly id: string;
    readonly playerId: string;
    readonly displayName: string;
    readonly seed: number;
    readonly status: string;
    readonly withdrawnAt: Date | null;
    readonly withdrawalReason: string | null;
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
  /**
   * Vereinsweit belegte Scheiben und beschaeftigte Personen. Die Anzeige muss
   * dieselbe Belegt-Menge sehen wie der Startpfad, sonst zeigt die
   * Warteschlange „bereit“, was `assign` ablehnt.
   */
  readonly occupiedBoardIds: ReadonlySet<string>;
  readonly activePlayerIds: ReadonlySet<string>;
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

function derivedCommandId(parentCommandId: string, aggregateId: string): string {
  const hex = createHash("sha256").update(`${parentCommandId}:${aggregateId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
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

  /**
   * Die eine Abfrage dieses Repositories ohne `organizationId` (AGENTS.md §14).
   * Das ist kein Versehen: die `public_id` IST der Schluessel einer oeffentlich
   * geteilten Adresse, und der Mandant faellt aus dem Treffer heraus. Jede
   * andere Abfrage bleibt mandantengebunden.
   */
  public async getPublicDashboardDataByPublicId(
    publicId: string,
  ): Promise<TournamentDashboardData | null> {
    const [tournament] = await this.databaseService.database
      .select({
        organizationId: tournaments.organizationId,
        id: tournaments.id,
        visibility: tournaments.visibility,
      })
      .from(tournaments)
      .where(eq(tournaments.publicId, publicId))
      .limit(1);
    if (tournament === undefined) return null;
    // Ein privates Turnier ist von aussen nicht von einem nicht existierenden
    // zu unterscheiden — der Aufrufer wirft in beiden Faellen 404.
    //
    // Diese Pruefung hier entscheidet nur ueber den fruehen Ausstieg bei
    // offensichtlich privaten Turnieren. Die autoritative Bedingung traegt
    // `getDashboardData` selbst ueber `requirePublic`: PostgreSQL fuehrt
    // unter READ COMMITTED jede Anweisung mit einer eigenen Momentaufnahme
    // aus, eine Transaktion allein schliesst das Zeitfenster zwischen dieser
    // Abfrage und der folgenden Datenabfrage also nicht. Wird die
    // Sichtbarkeit dazwischen zurueckgenommen, liefert erst die zweite
    // Abfrage die massgebliche Antwort.
    if (tournament.visibility !== "PUBLIC") return null;
    return this.getDashboardData(tournament.organizationId, tournament.id, {
      requirePublic: true,
    });
  }

  /**
   * Ebenfalls ohne `organizationId` (AGENTS.md §14) — dieselbe Ausnahme wie
   * `getPublicDashboardDataByPublicId`: die `public_id` IST der Schluessel.
   * Anders als jene Methode gilt hier absichtlich KEIN Sichtbarkeitsfilter:
   * ihr Zweck ist gerade, `visibility` an einen Aufrufer zu liefern, der
   * selbst entscheidet, ob ein zusaetzlicher Zugangsweg (Anzeige-Schluessel,
   * Kanal-Autorisierung in Plan 3) das private Turnier dennoch aufloest.
   */
  public async getAccessFactsByPublicId(publicId: string): Promise<{
    readonly id: string;
    readonly organizationId: string;
    readonly visibility: TournamentVisibility;
  } | null> {
    const [tournament] = await this.databaseService.database
      .select({
        organizationId: tournaments.organizationId,
        id: tournaments.id,
        visibility: tournaments.visibility,
      })
      .from(tournaments)
      .where(eq(tournaments.publicId, publicId))
      .limit(1);
    if (tournament === undefined) return null;
    return { id: tournament.id, organizationId: tournament.organizationId, visibility: tournament.visibility as TournamentVisibility };
  }

  /** Siehe `TournamentsService.publicAddress` — Uebergangsweg mit Frist. */
  public async getPublicAddress(
    tournamentId: string,
  ): Promise<{ readonly publicId: string } | null> {
    const [row] = await this.databaseService.database
      .select({ publicId: tournaments.publicId, visibility: tournaments.visibility })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);
    if (row === undefined || row.visibility !== "PUBLIC") return null;
    return { publicId: row.publicId };
  }

  public async getDashboardData(
    organizationId: string,
    tournamentId: string,
    options?: { readonly requirePublic?: boolean },
  ): Promise<TournamentDashboardData | null> {
    const [tournament] = await this.databaseService.database
      .select()
      .from(tournaments)
      .where(
        and(
          eq(tournaments.organizationId, organizationId),
          eq(tournaments.id, tournamentId),
          // Traegt die Sichtbarkeitsbedingung selbst, statt sich auf eine
          // vorher gestellte Frage des Aufrufers zu verlassen (PR-Review:
          // Zeitfenster zwischen Sichtbarkeitspruefung und Datenabfrage).
          // Der authentifizierte Weg ruft ohne `requirePublic` auf und
          // bleibt unveraendert.
          options?.requirePublic ? eq(tournaments.visibility, "PUBLIC") : undefined,
        ),
      )
      .limit(1);
    if (tournament === undefined) return null;

    // Keine dieser Abfragen haengt vom Ergebnis einer anderen ab; sie gehoeren
    // in EIN Promise.all. Die Belegtmengen liefen bis hierher als zweite
    // Rundreise hinterher -- auf dem heissesten Leseweg der Turnieransicht.
    const [
      participantRows,
      boardRows,
      groupRows,
      groupParticipantRows,
      matchRows,
      occupiedBoardIds,
      activePlayerIds,
    ] = await Promise.all([
        this.databaseService.database
          .select({
            id: tournamentParticipants.id,
            playerId: tournamentParticipants.playerId,
            displayName: players.displayName,
            seed: tournamentParticipants.seed,
            status: tournamentParticipants.status,
            withdrawnAt: tournamentParticipants.withdrawnAt,
            withdrawalReason: tournamentParticipants.withdrawalReason,
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
        loadOccupiedBoardIds(this.databaseService.database, organizationId),
        loadActivePlayerIds(this.databaseService.database, organizationId),
      ]);
    return {
      tournament,
      participants: participantRows,
      boards: boardRows,
      groups: groupRows,
      groupParticipants: groupParticipantRows,
      matches: matchRows,
      occupiedBoardIds,
      activePlayerIds,
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
          inRule: input.data.inRule,
          outRule: input.data.outRule,
          maxRounds: input.data.maxRounds,
          bestOfLegs: input.data.bestOfLegs,
          legsToWinSet: Math.floor(input.data.bestOfLegs / 2) + 1,
          setsToWin: Math.floor(input.data.bestOfSets / 2) + 1,
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
          resultType: match.state === "BYE" ? "BYE" : null,
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

  public async assign(input: ActorInput & { readonly data: AssignMatchInput }): Promise<TournamentMutationResult> {
    try {
      // Ruling 10: Sperrzyklus (40P01) hinterlaesst nichts, die Wiederholung
      // ist gefahrlos; bleibt es beim Zyklus, ist die Antwort ein
      // Versionskonflikt statt eines 500 (siehe retryOnDeadlock).
      return await retryOnDeadlock(() => this.assignInTransaction(input), "version-conflict");
    } catch (error) {
      // Der partielle Unique-Index auf `matches` faengt die Zuweisung ab, die
      // gleichzeitig mit einer zweiten durch die Anwendungspruefung kam. Der
      // Verstoss ist fachlich eine belegte Scheibe, nicht ein Serverfehler.
      if (isBoardInProgressConflict(error)) return "board-unavailable";
      throw error;
    }
  }

  private assignInTransaction(
    input: ActorInput & { readonly data: AssignMatchInput },
  ): Promise<TournamentMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      if (await this.findDuplicateCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)))
        .for("update")
        .limit(1);
      // Zweite Pruefung unter der Sperre — siehe `findDuplicateCommand`.
      if (await this.findDuplicateCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
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
      // Der Status der Scheibe allein genuegt nicht: die Liga belegt dieselbe
      // physische Scheibe ueber `encounter_slots`. Beide Quellen zaehlen.
      if (await isBoardOccupied(transaction, input.organizationId, input.data.boardId)) {
        return "board-unavailable";
      }
      // Erst sperren, dann lesen — sonst saehen zwei Zuweisungen in zwei
      // Turnieren desselben Vereins dieselbe Person beide als frei.
      const scheduledPlayerIds = [scheduled.participantOneId, scheduled.participantTwoId];
      await lockPlayers(transaction, input.organizationId, scheduledPlayerIds);
      const activePlayerIds = await loadActivePlayerIds(transaction, input.organizationId);
      const [busy] = await transaction
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, input.organizationId),
            eq(tournamentMatches.status, "IN_PROGRESS"),
            or(
              inArray(tournamentMatches.participantOneId, scheduledPlayerIds),
              inArray(tournamentMatches.participantTwoId, scheduledPlayerIds),
            ),
          ),
        )
        .limit(1);
      // Wer gerade einen Ligaslot oder eine freie Paarung spielt, steht in
      // `matches` — nicht in `tournament_matches`. Beide Wege sperren.
      if (busy !== undefined || scheduledPlayerIds.some((playerId) => activePlayerIds.has(playerId))) {
        return "player-busy";
      }

      const [scoringMatch] = await transaction
        .insert(matches)
        .values({
          organizationId: input.organizationId,
          boardId: input.data.boardId,
          startingScore: tournament.startingScore,
          inRule: tournament.inRule,
          outRule: tournament.outRule,
          maxRounds: tournament.maxRounds,
          bestOfLegs: tournament.bestOfLegs,
          legsToWinSet: tournament.legsToWinSet,
          setsToWin: tournament.setsToWin,
          startingSeat: 1,
          currentSeat: 1,
        })
        .returning();
      if (scoringMatch === undefined) throw new Error("Scoring match insert did not return a row.");
      const scoringParticipants = await transaction.insert(matchParticipants).values([
        { organizationId: input.organizationId, matchId: scoringMatch.id, seat: 1 },
        { organizationId: input.organizationId, matchId: scoringMatch.id, seat: 2 },
      ]).returning();
      const playerOfScoringSeat = new Map([[1, scheduled.participantOneId], [2, scheduled.participantTwoId]]);
      await transaction.insert(matchParticipantPlayers).values(scoringParticipants.map((participant) => {
        const playerId = playerOfScoringSeat.get(participant.seat);
        if (playerId === null || playerId === undefined) throw new Error("Scoring match seat invariant violated.");
        return {
          organizationId: input.organizationId,
          matchId: scoringMatch.id,
          participantId: participant.id,
          playerId,
          position: 1,
        };
      }));
      await transaction.insert(legs).values({
        organizationId: input.organizationId,
        matchId: scoringMatch.id,
        legNumber: 1,
        startingSeat: 1,
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

  public withdrawParticipant(input: ActorInput & { readonly data: WithdrawTournamentParticipantInput }): Promise<TournamentMutationResult> {
    // Ruling 10: siehe retryOnDeadlock — der Advisory Lock faellt mit der
    // abgebrochenen Transaktion, die Wiederholung erwirbt ihn neu.
    return retryOnDeadlock(() => this.withdrawParticipantInTransaction(input), "version-conflict");
  }

  private withdrawParticipantInTransaction(
    input: ActorInput & { readonly data: WithdrawTournamentParticipantInput },
  ): Promise<TournamentMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.data.commandId}, 0))`);
      const [duplicate] = await transaction.select({ organizationId: tournamentCommands.organizationId, tournamentId: tournamentCommands.tournamentId, type: tournamentCommands.type, payload: tournamentCommands.payload }).from(tournamentCommands).where(eq(tournamentCommands.commandId, input.data.commandId)).limit(1);
      if (duplicate !== undefined) {
        const payload = withdrawTournamentParticipantSchema.safeParse(duplicate.payload);
        if (
          duplicate.organizationId === input.organizationId &&
          duplicate.tournamentId === input.tournamentId &&
          duplicate.type === "WITHDRAW_PARTICIPANT" &&
          payload.success &&
          payload.data.expectedVersion === input.data.expectedVersion &&
          payload.data.playerId === input.data.playerId &&
          payload.data.reason === input.data.reason
        ) return "ok";
        throw new TournamentValidationError("COMMAND_ID_ALREADY_USED", "The command ID has already been used for another tournament.");
      }
      const [tournament] = await transaction.select().from(tournaments).where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId))).for("update").limit(1);
      if (tournament === undefined) return "not-found";
      if (tournament.version !== input.data.expectedVersion) return "version-conflict";
      if (tournament.status === "COMPLETED") return "tournament-completed";
      const [participant] = await transaction.select().from(tournamentParticipants).where(and(eq(tournamentParticipants.organizationId, input.organizationId), eq(tournamentParticipants.tournamentId, input.tournamentId), eq(tournamentParticipants.playerId, input.data.playerId))).for("update").limit(1);
      if (participant === undefined) return "not-found";
      if (participant.status === "WITHDRAWN") return "participant-already-withdrawn";
      const withdrawnAt = new Date();
      await transaction.update(tournamentParticipants).set({ status: "WITHDRAWN", withdrawnAt, withdrawalReason: input.data.reason }).where(and(eq(tournamentParticipants.organizationId, input.organizationId), eq(tournamentParticipants.id, participant.id)));

      // Global mutation lock order: Tournament → Participant → TournamentMatches → sorted Scoring Matches.
      const matchRows = await transaction.select().from(tournamentMatches).where(and(
        eq(tournamentMatches.organizationId, input.organizationId),
        eq(tournamentMatches.tournamentId, input.tournamentId),
      )).for("update");
      const scoringMatchIds = [...new Set(matchRows.flatMap((match) =>
        match.status === "IN_PROGRESS" && match.scoringMatchId !== null
          ? [match.scoringMatchId]
          : [],
      ))].sort();
      const lockedScoringRows = scoringMatchIds.length === 0 ? [] : await transaction.select().from(matches).where(and(
        eq(matches.organizationId, input.organizationId),
        inArray(matches.id, scoringMatchIds),
      )).orderBy(asc(matches.id)).for("update");
      const withdrawnRows = await transaction.select({ playerId: tournamentParticipants.playerId }).from(tournamentParticipants).where(and(eq(tournamentParticipants.organizationId, input.organizationId), eq(tournamentParticipants.tournamentId, input.tournamentId), eq(tournamentParticipants.status, "WITHDRAWN")));
      const withdrawnPlayerIds = withdrawnRows.map((row) => row.playerId);
      const withdrawnSet = new Set(withdrawnPlayerIds);
      const snapshots = (rows: typeof matchRows) => rows.map((match) => ({
        id: match.id,
        status: match.status as "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED",
        participantOneId: match.participantOneId,
        participantTwoId: match.participantTwoId,
        participantOneResolved: match.participantOneId !== null || match.participantOneRef === null,
        participantTwoResolved: match.participantTwoId !== null || match.participantTwoRef === null,
        sourceOneMatchId: match.sourceOneMatchId,
        sourceTwoMatchId: match.sourceTwoMatchId,
        winnerPlayerId: match.winnerPlayerId,
      }));
      let discardedVisitCount = 0;
      const applyDecisions = async (
        decisions: ReturnType<typeof resolveTournamentWithdrawals>,
        storedRows: typeof matchRows,
      ): Promise<Set<string>> => {
        const affectedGroupIds = new Set<string>();
        for (const decision of decisions) {
          const stored = storedRows.find((match) => match.id === decision.matchId);
          if (stored === undefined) throw new Error("Withdrawal match invariant violated.");
          if (stored.groupId !== null) affectedGroupIds.add(stored.groupId);
          if (stored.status === "IN_PROGRESS" && stored.scoringMatchId !== null) {
            const targetsWithdrawnPlayer =
              (stored.participantOneId !== null && withdrawnSet.has(stored.participantOneId)) ||
              (stored.participantTwoId !== null && withdrawnSet.has(stored.participantTwoId));
            if (!targetsWithdrawnPlayer || !["COMPLETED", "CANCELLED"].includes(decision.status)) {
              throw new Error("Withdrawal attempted to abort an unrelated scoring match.");
            }
            const scoring = lockedScoringRows.find((match) => match.id === stored.scoringMatchId);
            if (scoring === undefined) throw new Error("Withdrawal scoring match invariant violated.");
            const aborted = await abortScoringMatch(transaction, { organizationId: input.organizationId, match: scoring, commandId: derivedCommandId(input.data.commandId, stored.id), tournamentMatchId: stored.id, reason: input.data.reason, source: "TOURNAMENT_WITHDRAWAL" });
            discardedVisitCount += aborted.discardedVisitCount;
          }
          const completed = decision.status === "COMPLETED" || decision.status === "BYE";
          await transaction.update(tournamentMatches).set({
            status: decision.status,
            participantOneId: decision.participantOneId,
            participantTwoId: decision.participantTwoId,
            winnerPlayerId: decision.winnerPlayerId,
            resultType: decision.resultType,
            ...(stored.status === "IN_PROGRESS" ? { boardId: null, scoringMatchId: null } : {}),
            completedAt: completed ? withdrawnAt : null,
            version: stored.version + 1,
            updatedAt: withdrawnAt,
          }).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.id, stored.id)));
          if (decision.resultType === "WALKOVER") {
            const withdrawnPlayerId = getWalkoverWithdrawnPlayerId(decision, withdrawnSet);
            await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Tournament", aggregateId: input.tournamentId, eventType: "TOURNAMENT_MATCH_WALKOVER", payload: { tournamentId: input.tournamentId, tournamentMatchId: stored.id, winnerPlayerId: decision.winnerPlayerId, withdrawnPlayerId } });
          }
        }
        return affectedGroupIds;
      };
      const decisions = resolveTournamentWithdrawals({ withdrawnPlayerIds, matches: snapshots(matchRows) });
      const affectedGroupIds = await applyDecisions(decisions, matchRows);
      const withdrawnGroupRows = await transaction.select({ groupId: tournamentGroupParticipants.groupId }).from(tournamentGroupParticipants).where(and(
        eq(tournamentGroupParticipants.organizationId, input.organizationId),
        eq(tournamentGroupParticipants.tournamentId, input.tournamentId),
        eq(tournamentGroupParticipants.playerId, input.data.playerId),
      ));
      for (const row of withdrawnGroupRows) affectedGroupIds.add(row.groupId);
      for (const groupId of affectedGroupIds) {
        await resolveCompletedTournamentGroup(transaction, input.organizationId, input.tournamentId, groupId);
      }
      const refreshedMatchRows = await transaction.select().from(tournamentMatches).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.tournamentId, input.tournamentId))).for("update");
      const automaticDecisions = resolveTournamentWithdrawals({ withdrawnPlayerIds, matches: snapshots(refreshedMatchRows) });
      await applyDecisions(automaticDecisions, refreshedMatchRows);
      await updateTournamentProgress(transaction, input.organizationId, input.tournamentId, withdrawnAt);
      const nextVersion = tournament.version + 1;
      await transaction.update(tournaments).set({ version: nextVersion, updatedAt: withdrawnAt }).where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)));
      await transaction.insert(tournamentCommands).values({ commandId: input.data.commandId, organizationId: input.organizationId, tournamentId: input.tournamentId, type: "WITHDRAW_PARTICIPANT", payload: input.data, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Tournament", aggregateId: input.tournamentId, eventType: "TOURNAMENT_PARTICIPANT_WITHDRAWN", payload: { tournamentId: input.tournamentId, playerId: input.data.playerId, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "TOURNAMENT_PARTICIPANT_WITHDRAWN", entityType: "TournamentParticipant", entityId: participant.id, oldValue: participant, newValue: { status: "WITHDRAWN", withdrawnAt, withdrawalReason: input.data.reason, discardedVisitCount }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return "ok";
    });
  }

  public releaseBoard(
    input: ActorInput & { readonly data: ReleaseBoardInput },
  ): Promise<TournamentMutationResult> {
    // Ruling 10: siehe retryOnDeadlock — der Sperrzyklus hinterlaesst nichts,
    // die Wiederholung ist gefahrlos.
    return retryOnDeadlock(() => this.releaseBoardInTransaction(input), "version-conflict");
  }

  private releaseBoardInTransaction(
    input: ActorInput & { readonly data: ReleaseBoardInput },
  ): Promise<TournamentMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      if (await this.findDuplicateCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)))
        .for("update")
        .limit(1);
      // Zweite Pruefung unter der Sperre — siehe `findDuplicateCommand`.
      if (await this.findDuplicateCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
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
      // Freigeben darf nur, wer die Scheibe wirklich frei vorfindet. Ein
      // laufender Ligaslot steht nicht in `tournament_matches`; wer nur dort
      // nachsieht, stellt eine belegte Scheibe auf AVAILABLE und laesst die
      // naechste Zuweisung ein zweites Match darauf starten.
      if (await isBoardOccupied(transaction, input.organizationId, input.data.boardId)) {
        return "board-unavailable";
      }
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

  /**
   * Eine Freigabe nach aussen ist keine Score-/Match-Aktion mit
   * Wiederholungsrisiko (AGENTS.md 11) und traegt deshalb keine `commandId`
   * und keine `expectedVersion` — anders als `assign`, `releaseBoard` & Co.
   * Die Sperre auf der Turnierzeile dient hier nur dazu, den vorherigen Wert
   * fuer den Audit-Satz verlustfrei zu lesen.
   */
  public async updateVisibility(
    input: ActorInput & { readonly visibility: TournamentVisibility },
  ): Promise<TournamentMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
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
      await transaction
        .update(tournaments)
        .set({ visibility: input.visibility, updatedAt: new Date() })
        .where(
          and(
            eq(tournaments.organizationId, input.organizationId),
            eq(tournaments.id, input.tournamentId),
          ),
        );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "TOURNAMENT_VISIBILITY_CHANGED",
        entityType: "Tournament",
        entityId: input.tournamentId,
        oldValue: { visibility: tournament.visibility },
        newValue: { visibility: input.visibility },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  /**
   * Duplikatpruefung fuer den Turnierkommandostrom. Sie laeuft an jeder
   * Aufrufstelle ZWEIMAL: einmal vor der Sperre auf der Turnierzeile und
   * einmal darunter. Ohne die zweite verfehlen zwei gleichzeitige
   * Zustellungen desselben Kommandos die Kommandozeile beide, und die zweite
   * bekaeme einen Versionskonflikt fuer ihr eigenes, angekommenes Kommando
   * (AGENTS.md 11). `withdrawParticipant` loest dasselbe ueber einen
   * Advisory Lock auf die commandId; hier genuegt die zweite Pruefung.
   */
  private async findDuplicateCommand(
    transaction: DatabaseTransaction,
    organizationId: string,
    tournamentId: string,
    commandId: string,
  ): Promise<"ok" | null> {
    const [duplicate] = await transaction
      .select({
        organizationId: tournamentCommands.organizationId,
        tournamentId: tournamentCommands.tournamentId,
      })
      .from(tournamentCommands)
      .where(eq(tournamentCommands.commandId, commandId))
      .limit(1);
    if (duplicate === undefined) return null;
    if (duplicate.organizationId === organizationId && duplicate.tournamentId === tournamentId) {
      return "ok";
    }
    throw new TournamentValidationError(
      "COMMAND_ID_ALREADY_USED",
      "The command ID has already been used for another tournament.",
    );
  }
}
