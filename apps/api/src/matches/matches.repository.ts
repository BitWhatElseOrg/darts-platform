import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents, boardControllerLeases, boards, encounterCommands, encounters, encounterSlots, legs, matches, matchParticipantPlayers, matchParticipants, outboxEvents, players, scoreCommands,
  tournamentCommands, tournamentGroups, tournamentMatches, tournamentParticipants,
  tournaments, tournamentStages,
  visitDarts, visits,
} from "@darts-platform/database";
import { clubAbbreviation, decideDeviceMatchAccess, matchTargets, type DeviceMatchAction } from "@darts-platform/domain";
import { CLUB_DUEL_STAGE_KEYS, GRAND_FINAL_KEY, GRAND_FINAL_RESET_KEY } from "@darts-platform/tournament-engine";
import { ScoringValidationError, createX01Match, defaultCheckoutAttempts, executeX01Command, projectX01Match, type InRule, type LegStartRule, type OutRule, type X01Command, type X01Match, type X01MatchState, type X01Side } from "@darts-platform/scoring-engine";
import type { AbortMatchInput, AbortMatchResponse, CorrectEncounterResultInput, CorrectTournamentResultInput, CreateMatchInput, DecideLegByBullInput, DecideLegStartInput, MatchStateResponse, SubmitVisitInput, UndoVisitInput } from "@darts-platform/schemas";
import { isDevicePrincipal, type AuthContext, type Principal } from "../auth/auth.types.js";
import { isBoardInProgressConflict, isBoardOccupied, loadActivePlayerIds, lockPlayers } from "../boards/board-occupancy.js";
import { auditActor, leaseActor } from "../common/audit-actor.js";
import type { AuditContext } from "../common/audit-context.js";
import { retryOnDeadlock } from "../common/retry-on-deadlock.js";
import { DatabaseService } from "../database/database.service.js";
import { isClubDuelResultLocked } from "../tournaments/club-duel-correction-lock.js";
import { advanceClubDuel } from "../tournaments/advance-club-duel.js";
import { advanceDoubleElimination } from "../tournaments/advance-double-elimination.js";
import { applyWithdrawalPropagation } from "../tournaments/apply-withdrawal-propagation.js";
import { resolveCompletedTournamentGroup } from "../tournaments/resolve-completed-group.js";
import { updateTournamentProgress } from "../tournaments/update-tournament-progress.js";
import {
  findDuplicateEncounterCommand,
  isDuplicateEncounterCommandIdError,
} from "../encounters/encounter-command-log.js";
import type { EncounterMutationResult } from "../encounters/encounters.repository.js";
import {
  completeEncounterSlotForMatch,
  reopenEncounterSlotForMatch,
  reopenPlayedEncounterSlot,
  resetEncounterSlotForMatch,
} from "../encounters/sync-encounter-slot.js";
import { updateEncounterProgress } from "../encounters/update-encounter-progress.js";
import { abortScoringMatch } from "./abort-match.js";
import { lockEncounterScoringContext } from "./encounter-scoring-lock.js";
import { lockTournamentScoringContext } from "./tournament-scoring-lock.js";

/** Ein Scheiben-Tablet schreibt nur in das laufende Match seiner Scheibe. */
export type DeviceDenial = "device-board-mismatch" | "device-match-not-active";
export type MutationResult = "ok" | "not-found" | "version-conflict" | "controller-conflict" | DeviceDenial;
/**
 * Ein Undo eroeffnet ein beendetes Match wieder. Steht auf seiner Scheibe
 * inzwischen ein anderes Spiel, ist das keine ungueltige Eingabe, sondern ein
 * Zustand — er wird wie ueberall als belegte Scheibe beantwortet. Spielt eine
 * beteiligte Person schon an einer anderen Scheibe, gilt dasselbe als
 * `player-busy`.
 */
export type UndoMutationResult = MutationResult | "board-unavailable" | "player-busy";
export type AbortMutationResult = AbortMatchResponse | Exclude<MutationResult, "ok" | DeviceDenial>;
export type TournamentCorrectionResult =
  | Exclude<MutationResult, "controller-conflict" | DeviceDenial>
  | "result-not-correctable"
  | "downstream-started"
  | "club-duel-round-paired"
  | "board-unavailable";
/**
 * Die Ergebnisse der Resultatkorrektur einer Liga-Begegnung tragen die Namen
 * aus `EncounterMutationResult`; der `EncountersService` bildet sie dort ab.
 */
export type EncounterCorrectionResult = Extract<
  EncounterMutationResult,
  | "ok"
  | "not-found"
  | "slot-not-found"
  | "version-conflict"
  | "command-id-reused"
  | "encounter-not-correctable"
  | "slot-not-correctable"
  | "decider-correction-required"
  | "board-unavailable"
  | "player-busy"
>;
/** Der Befehlstyp in `encounter_commands` (Check `encounter_commands_type_check`). */
const ENCOUNTER_RESULT_CORRECTION_TYPE = "CORRECT_ENCOUNTER_RESULT";
type UndoLastVisitCommand = Extract<X01Command, { readonly type: "UNDO_LAST_VISIT" }>;
/** Was `planResultReopen` liest und `applyResultReopen` schreibt. */
interface ResultReopenPlan {
  readonly latestVisitId: string;
  readonly undoCommand: UndoLastVisitCommand;
  readonly state: ReturnType<typeof projectX01Match>;
}
type ActorInput = { readonly organizationId: string; readonly matchId: string; readonly auth: Principal; readonly audit: AuditContext };
/** Nur fuer Personen: das Geraet darf nicht abbrechen (devicePermissions). */
type UserActorInput = Omit<ActorInput, "auth"> & { readonly auth: AuthContext };
/** Der Transaktionsrumpf, wie ihn Drizzle an den Callback uebergibt. */
type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
/** Der Live-Bezug eines Matches ohne den Fall "kein Bezug" (das traegt `null`). */
type LiveTarget = NonNullable<MatchStateResponse["liveTarget"]>;
/** Turnierangaben fuer die Vereinskuerzel; nur intern, nicht Teil von `LiveTarget`. */
interface TournamentLabelInfo { readonly format: string; readonly sideAName: string | null; readonly sideBName: string | null }
/** Turnier -> (Person -> Vereinskuerzel). */
type ClubLabelsByTournament = Map<string, Map<string, string>>;
const noClubLabels: ReadonlyMap<string, string> = new Map();
/** Kuerzel fuer das Turnier des Matches; ausserhalb eines Vereinsduells leer. */
function clubLabelsOf(labels: ClubLabelsByTournament, liveTarget: LiveTarget | null): ReadonlyMap<string, string> {
  return liveTarget?.kind === "TOURNAMENT" ? labels.get(liveTarget.tournamentId) ?? noClubLabels : noClubLabels;
}

/**
 * Bindung eines Scheiben-Tablets an das Match seiner Scheibe. Laeuft in der
 * schreibenden Transaktion, nachdem das Match gesperrt ist: eine Freigabe der
 * Scheibe zwischen Pruefung und Schreibzugriff rutscht so nicht durch
 * (Spec 2026-09-30-scheiben-tablet, Abschnitt 3).
 */
function deviceDenial(auth: Principal, action: DeviceMatchAction, match: { readonly boardId: string | null; readonly status: string }): DeviceDenial | null {
  if (!isDevicePrincipal(auth)) return null;
  const decision = decideDeviceMatchAccess({ action, deviceBoardId: auth.device.boardId, matchBoardId: match.boardId, matchStatus: match.status });
  switch (decision) {
    case "ALLOWED":
      return null;
    case "BOARD_MISMATCH":
      return "device-board-mismatch";
    case "MATCH_NOT_ACTIVE":
      return "device-match-not-active";
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

const seatSchema = z.union([z.literal(1), z.literal(2)]);
// `playerId` stammt aus Kommandos, die vor dem Seitenmodell geschrieben wurden;
// `seat`/`throwerPlayerId` sind die neue Form. Beide müssen lesbar bleiben.
const storedDartSchema = z.object({
  segment: z.number().int().min(0).max(25),
  multiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const storedSubmitSchema = z.object({
  type: z.literal("SUBMIT_VISIT"), commandId: z.uuid(), playerId: z.uuid().optional(),
  seat: seatSchema.optional(), throwerPlayerId: z.uuid().optional(), points: z.number().int(),
  dartsThrown: z.union([z.literal(1), z.literal(2), z.literal(3)]), checkoutDouble: z.number().int().optional(), checkoutAttempts: z.number().int().min(0).max(3).default(0),
  darts: z.array(storedDartSchema).min(1).max(3).optional(),
  // Das abschliessende Segment mit Multiplikator (x01.ts,
  // `SubmitVisitCommand.checkoutSegment`). Optional: gespeicherte Kommandos
  // ohne das Feld werden unveraendert gewertet.
  checkoutSegment: storedDartSchema.optional(),
  checkoutMissed: z.boolean().optional(),
});
const storedUndoSchema = z.object({ type: z.literal("UNDO_LAST_VISIT"), commandId: z.uuid(), targetCommandId: z.uuid() });
const storedAbortSchema = z.object({ type: z.literal("ABORT_MATCH"), commandId: z.uuid(), tournamentMatchId: z.uuid().nullable() });
const storedLegStartSchema = z.object({
  type: z.literal("DECIDE_LEG_START"), commandId: z.uuid(),
  legNumber: z.number().int().positive(), startingSeat: seatSchema,
});
const storedLegByBullSchema = z.object({
  type: z.literal("DECIDE_LEG_BY_BULL"), commandId: z.uuid(), winnerSeat: seatSchema,
});
const storedCommandSchema = z.discriminatedUnion("type", [
  storedSubmitSchema, storedUndoSchema, storedLegStartSchema, storedLegByBullSchema,
]);
const groupRankReferenceSchema = z.object({
  type: z.literal("GROUP_RANK"),
  groupKey: z.string(),
  rank: z.number().int().positive(),
});

function parseStoredCommand(payload: unknown, seatOfPlayer: (playerId: string) => 1 | 2): X01Command {
  const parsed = storedCommandSchema.parse(payload);
  if (
    parsed.type === "UNDO_LAST_VISIT" ||
    parsed.type === "DECIDE_LEG_START" ||
    parsed.type === "DECIDE_LEG_BY_BULL"
  ) {
    return parsed;
  }
  const throwerPlayerId = parsed.throwerPlayerId ?? parsed.playerId;
  if (throwerPlayerId === undefined) {
    throw new ScoringValidationError("INVALID_STORED_COMMAND", "A stored visit needs a thrower.");
  }
  const base = {
    type: parsed.type, commandId: parsed.commandId, seat: parsed.seat ?? seatOfPlayer(throwerPlayerId),
    throwerPlayerId, points: parsed.points, dartsThrown: parsed.dartsThrown,
  } as const;
  return {
    ...base,
    checkoutAttempts: parsed.checkoutAttempts,
    ...(parsed.checkoutDouble === undefined ? {} : { checkoutDouble: parsed.checkoutDouble }),
    ...(parsed.darts === undefined ? {} : { darts: parsed.darts }),
    ...(parsed.checkoutSegment === undefined ? {} : { checkoutSegment: parsed.checkoutSegment }),
    ...(parsed.checkoutMissed === undefined ? {} : { checkoutMissed: parsed.checkoutMissed }),
  };
}

interface LoadedSide {
  readonly seat: 1 | 2;
  readonly participantId: string;
  readonly playerIds: readonly string[];
}

/**
 * Löst einen Sitz auf die Person auf, die ihn belegt. In Phase 1 hat jeder Sitz
 * genau eine Person, weshalb die erste Position genügt.
 */
function playerOfSeat(state: X01MatchState, seat: 1 | 2 | null): string | null {
  if (seat === null) return null;
  return state.sides.find((side) => side.seat === seat)?.playerIds[0] ?? null;
}

/** Die Regelspalten sind varchar; hier werden sie auf die Union der Engine verengt. */
function toInRule(value: string): InRule {
  return value === "DOUBLE" ? "DOUBLE" : "STRAIGHT";
}

function toOutRule(value: string): OutRule {
  return value === "SINGLE" ? "SINGLE" : value === "MASTER" ? "MASTER" : "DOUBLE";
}

/**
 * Anders als bei In- und Out-Regel gibt es hier keinen unverfaenglichen
 * Rueckfall: jede der drei Auspraegungen entscheidet, welche Legs ihren Anwurf
 * ausbullen. Der Check-Constraint `matches_leg_start_rule_check` schliesst
 * andere Werte aus; trifft doch einer ein, ist der Zustand nicht lesbar.
 */
function toLegStartRule(value: string): LegStartRule {
  if (value === "LEAGUE" || value === "BULL_EVERY_LEG" || value === "BULL_FIRST_LEG") return value;
  throw new ScoringValidationError("INVALID_LEG_START_RULE", "The stored leg start rule is unknown.");
}

/** Lebensdauer einer Board-Steuerungs-Lease; der Client erneuert alle 3 s. */
const LEASE_TTL_MS = 10_000;
/** Karenz nach Ablauf, in der nur derselbe Controller oder `force` uebernimmt. */
export const LEASE_GRACE_MS = 5 * 60_000;

@Injectable()
export class MatchesRepository {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  public async list(organizationId: string): Promise<MatchStateResponse[]> {
    const rows = await this.databaseService.database.select({ id: matches.id }).from(matches).where(and(eq(matches.organizationId, organizationId), notInArray(matches.status, ["ABORTED"]))).orderBy(desc(matches.createdAt));
    const states = await this.getStates(organizationId, rows.map((row) => row.id));
    return [...states.values()];
  }

  /**
   * Zustand mehrerer Matches auf einmal. Der Live-Bezug (`liveTarget`) wird
   * fuer alle angefragten Matches in zwei Abfragen geladen statt in zwei je
   * Match -- eine Turnier-Uebersicht mit 32 Paarungen, die das Command Centre
   * alle fuenf Sekunden neu holt, sparte sich damit rund 64 Abfragen je Lauf.
   * Die Reihenfolge der Rueckgabe folgt `matchIds`; nicht gefundene oder
   * abgebrochene Matches fehlen in der Map.
   */
  public async getStates(organizationId: string, matchIds: readonly string[]): Promise<Map<string, MatchStateResponse>> {
    const { liveTargets, clubLabels } = await this.loadStateContext(organizationId, matchIds);
    const entries = await Promise.all(matchIds.map(async (matchId) => {
      const liveTarget = liveTargets.get(matchId) ?? null;
      return [matchId, await this.buildState(organizationId, matchId, liveTarget, clubLabelsOf(clubLabels, liveTarget))] as const;
    }));
    return new Map(entries.filter((entry): entry is readonly [string, MatchStateResponse] => entry[1] !== null));
  }

  public async getState(organizationId: string, matchId: string): Promise<MatchStateResponse | null> {
    const { liveTargets, clubLabels } = await this.loadStateContext(organizationId, [matchId]);
    const liveTarget = liveTargets.get(matchId) ?? null;
    return this.buildState(organizationId, matchId, liveTarget, clubLabelsOf(clubLabels, liveTarget));
  }

  /**
   * Live-Bezug und Vereinskuerzel fuer alle angefragten Matches auf einmal:
   * die Live-Abfragen wie bisher, dazu hoechstens eine Abfrage fuer die
   * Seiten aller beteiligten Personen in Vereinsduellen -- unabhaengig von
   * der Zahl der Matches.
   */
  private async loadStateContext(organizationId: string, matchIds: readonly string[]): Promise<{
    readonly liveTargets: Map<string, LiveTarget>;
    readonly clubLabels: ClubLabelsByTournament;
  }> {
    const { targets, tournamentInfo } = await this.loadLiveTargets(organizationId, matchIds);
    const clubLabels = await this.loadClubLabels(organizationId, matchIds, tournamentInfo);
    return { liveTargets: targets, clubLabels };
  }

  /**
   * Vereinsduell: Kuerzel je Person aus Seite und Vereinsnamen des Turniers,
   * gruppiert nach Turnier (eine Person kann in mehreren Turnieren stehen).
   * Nur Vereinsduelle mit beiden Seitennamen tragen Kuerzel.
   */
  private async loadClubLabels(organizationId: string, matchIds: readonly string[], tournamentInfo: ReadonlyMap<string, TournamentLabelInfo>): Promise<ClubLabelsByTournament> {
    const sideNames = new Map<string, { readonly A: string; readonly B: string }>();
    for (const [tournamentId, info] of tournamentInfo) {
      if (info.format !== "CLUB_DUEL" || info.sideAName === null || info.sideBName === null) continue;
      sideNames.set(tournamentId, { A: clubAbbreviation(info.sideAName), B: clubAbbreviation(info.sideBName) });
    }
    const labels: ClubLabelsByTournament = new Map();
    if (sideNames.size === 0 || matchIds.length === 0) return labels;
    const matchPlayers = this.databaseService.database
      .select({ playerId: matchParticipantPlayers.playerId })
      .from(matchParticipantPlayers)
      .where(and(eq(matchParticipantPlayers.organizationId, organizationId), inArray(matchParticipantPlayers.matchId, [...matchIds])));
    const rows = await this.databaseService.database
      .select({ tournamentId: tournamentParticipants.tournamentId, playerId: tournamentParticipants.playerId, side: tournamentParticipants.side })
      .from(tournamentParticipants)
      .where(and(
        eq(tournamentParticipants.organizationId, organizationId),
        inArray(tournamentParticipants.tournamentId, [...sideNames.keys()]),
        inArray(tournamentParticipants.playerId, matchPlayers),
      ));
    for (const row of rows) {
      const names = sideNames.get(row.tournamentId);
      if (names === undefined || (row.side !== "A" && row.side !== "B")) continue;
      const perTournament = labels.get(row.tournamentId) ?? new Map<string, string>();
      perTournament.set(row.playerId, names[row.side]);
      labels.set(row.tournamentId, perTournament);
    }
    return labels;
  }

  /**
   * Woher die angefragten Matches ihre oeffentliche Live-Ansicht beziehen:
   * Turnier oder Team-Begegnung. Ein Match ohne Wettbewerbsbezug taucht in
   * der Map nicht auf. Der Turnierbezug hat Vorrang, deshalb wird die
   * Begegnungsabfrage nur noch fuer die verbleibenden Matches gestellt --
   * und gar nicht, wenn keins uebrig bleibt.
   */
  private async loadLiveTargets(organizationId: string, matchIds: readonly string[]): Promise<{
    readonly targets: Map<string, LiveTarget>;
    readonly tournamentInfo: Map<string, TournamentLabelInfo>;
  }> {
    const targets = new Map<string, LiveTarget>();
    // Intern fuer die Vereinskuerzel; bleibt ausserhalb des LiveTarget-Vertrags.
    const tournamentInfo = new Map<string, TournamentLabelInfo>();
    if (matchIds.length === 0) return { targets, tournamentInfo };
    const ids = [...matchIds];
    const tournamentRows = await this.databaseService.database
      .select({
        matchId: tournamentMatches.scoringMatchId, tournamentId: tournamentMatches.tournamentId, publicId: tournaments.publicId,
        format: tournaments.format, sideAName: tournaments.sideAName, sideBName: tournaments.sideBName,
      })
      .from(tournamentMatches)
      .innerJoin(tournaments, and(eq(tournaments.id, tournamentMatches.tournamentId), eq(tournaments.organizationId, organizationId)))
      .where(and(eq(tournamentMatches.organizationId, organizationId), inArray(tournamentMatches.scoringMatchId, ids)));
    for (const row of tournamentRows) {
      if (row.matchId === null || targets.has(row.matchId)) continue;
      targets.set(row.matchId, { kind: "TOURNAMENT", tournamentId: row.tournamentId, publicId: row.publicId });
      tournamentInfo.set(row.tournamentId, { format: row.format, sideAName: row.sideAName, sideBName: row.sideBName });
    }
    const remaining = ids.filter((id) => !targets.has(id));
    if (remaining.length === 0) return { targets, tournamentInfo };
    const encounterRows = await this.databaseService.database
      .select({ matchId: encounterSlots.matchId, publicId: encounters.publicId })
      .from(encounterSlots)
      .innerJoin(encounters, and(eq(encounters.id, encounterSlots.encounterId), eq(encounters.organizationId, organizationId)))
      .where(and(eq(encounterSlots.organizationId, organizationId), inArray(encounterSlots.matchId, remaining)));
    for (const row of encounterRows) {
      if (row.matchId === null || targets.has(row.matchId)) continue;
      targets.set(row.matchId, { kind: "ENCOUNTER", publicId: row.publicId });
    }
    return { targets, tournamentInfo };
  }

  private async buildState(organizationId: string, matchId: string, liveTarget: LiveTarget | null, clubLabels: ReadonlyMap<string, string>): Promise<MatchStateResponse | null> {
    const [matchRow] = await this.databaseService.database
      .select({ match: matches, boardName: boards.name })
      .from(matches).leftJoin(boards, and(eq(boards.id, matches.boardId), eq(boards.organizationId, organizationId)))
      .where(and(eq(matches.organizationId, organizationId), eq(matches.id, matchId), notInArray(matches.status, ["ABORTED"]))).limit(1);
    if (matchRow === undefined) return null;

    const participantRows = await this.databaseService.database
      .select({ seat: matchParticipants.seat, legsWon: matchParticipants.legsWon, playerId: matchParticipantPlayers.playerId, displayName: players.displayName })
      .from(matchParticipants)
      .innerJoin(matchParticipantPlayers, and(eq(matchParticipantPlayers.participantId, matchParticipants.id), eq(matchParticipantPlayers.organizationId, organizationId)))
      .innerJoin(players, and(eq(players.id, matchParticipantPlayers.playerId), eq(players.organizationId, organizationId)))
      .where(and(eq(matchParticipants.organizationId, organizationId), eq(matchParticipants.matchId, matchId)))
      .orderBy(asc(matchParticipants.seat), asc(matchParticipantPlayers.position));
    if (participantRows.length < 2) throw new Error("Match participant invariant violated.");

    const commandRows = await this.databaseService.database.select().from(scoreCommands)
      .where(and(eq(scoreCommands.organizationId, organizationId), eq(scoreCommands.matchId, matchId)))
      .orderBy(asc(scoreCommands.resultingVersion));
    const loadedSides = await this.loadSides(this.databaseService.database, organizationId, matchId);
    const aggregate = this.aggregate(matchRow.match, loadedSides, commandRows.map((row) => row.payload));
    const projection = projectX01Match(aggregate);
    const [legRow] = await this.databaseService.database.select().from(legs)
      .where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, matchId), eq(legs.legNumber, projection.legNumber))).limit(1);
    if (legRow === undefined) throw new Error("Current leg invariant violated.");

    const visitRows = await this.databaseService.database
      .select({ visit: visits, playerDisplayName: players.displayName, legNumber: legs.legNumber })
      .from(visits).innerJoin(players, and(eq(players.id, visits.throwerPlayerId), eq(players.organizationId, organizationId)))
      .innerJoin(legs, and(eq(legs.id, visits.legId), eq(legs.organizationId, organizationId)))
      .where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, matchId)))
      .orderBy(desc(visits.sequence));

    const visitIds = visitRows.map(({ visit }) => visit.id);
    const dartRows = visitIds.length === 0 ? [] : await this.databaseService.database
      .select()
      .from(visitDarts)
      .where(and(eq(visitDarts.organizationId, organizationId), inArray(visitDarts.visitId, visitIds)))
      .orderBy(asc(visitDarts.visitId), asc(visitDarts.dartIndex));
    const dartsByVisit = new Map<string, { readonly segment: number; readonly multiplier: 1 | 2 | 3 }[]>();
    for (const row of dartRows) {
      const list = dartsByVisit.get(row.visitId) ?? [];
      list.push({ segment: row.segment, multiplier: row.multiplier as 1 | 2 | 3 });
      dartsByVisit.set(row.visitId, list);
    }

    const bySeat = new Map(projection.sides.map((side) => [side.seat, side]));
    // Im Doppel trägt ein Sitz zwei Zeilen; die Seite ist die Einheit, nicht die Zeile.
    const participantState = (seat: 1 | 2) => {
      const rows = participantRows.filter((row) => row.seat === seat);
      const lead = rows[0];
      const projected = bySeat.get(seat);
      if (lead === undefined || projected === undefined) throw new Error("Scoring side invariant violated.");
      return {
        seat,
        players: rows.map((row) => ({ playerId: row.playerId, displayName: row.displayName, isThrowing: projection.activeThrowerPlayerId === row.playerId, clubLabel: clubLabels.get(row.playerId) ?? null })),
        playerId: lead.playerId, displayName: lead.displayName, remaining: projected.remaining, legsWon: projected.totalLegsWon, legsWonInSet: projected.legsWonInSet, setsWon: projected.setsWon,
        isActive: rows.some((row) => projection.activeThrowerPlayerId === row.playerId),
        // Direkt aus der Projektion: die Flaeche verlangt unter Double In vor
        // der Eroeffnung Wurfdaten (x01.ts, `assertWritableVisit`) und darf
        // den Eroeffnungsstand nicht aus `remaining` raten.
        openedInLeg: projected.openedInLeg,
      };
    };
    return {
      id: matchRow.match.id, organizationId, boardId: matchRow.match.boardId, boardName: matchRow.boardName,
      status: projection.status, version: matchRow.match.version, startingScore: matchRow.match.startingScore,
      inRule: matchRow.match.inRule as "STRAIGHT" | "DOUBLE", outRule: matchRow.match.outRule as "SINGLE" | "DOUBLE" | "MASTER",
      legStartRule: toLegStartRule(matchRow.match.legStartRule),
      legStartPending: projection.legStartPending, roundLimitReached: projection.roundLimitReached,
      bestOfLegs: matchRow.match.bestOfLegs, legsToWin: Math.floor(matchRow.match.bestOfLegs / 2) + 1,
      bestOfSets: matchRow.match.setsToWin * 2 - 1, setsToWin: matchRow.match.setsToWin, currentSetNumber: projection.setNumber,
      currentLegNumber: projection.legNumber, currentLegVersion: legRow.version,
      currentPlayerId: projection.activeThrowerPlayerId, winnerPlayerId: playerOfSeat(projection, projection.winnerSeat),
      participants: [participantState(1), participantState(2)],
      visits: visitRows.map(({ visit, playerDisplayName, legNumber }) => ({
        id: visit.id, commandId: visit.commandId, playerId: visit.throwerPlayerId, playerDisplayName,
        legNumber,
        points: visit.points, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown,
        scoreBefore: visit.scoreBefore, scoreAfter: visit.scoreAfter, checkoutDouble: visit.checkoutDouble,
        checkoutAttempts: visit.checkoutAttempts,
        // Die Einzelwuerfe kommen aus `visit_darts`; Aufnahmen ohne
        // gespeicherte Wuerfe (z. B. vor Einfuehrung des Felds) tragen eine
        // leere Liste.
        darts: dartsByVisit.get(visit.id) ?? [],
        outcome: visit.outcome as "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON",
        reverted: visit.revertedAt !== null, createdAt: visit.createdAt,
      })),
      createdAt: matchRow.match.createdAt, updatedAt: matchRow.match.updatedAt,
      liveTarget,
    };
  }

  public async create(input: { readonly organizationId: string; readonly data: CreateMatchInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<string> {
    try {
      return await this.createInTransaction(input);
    } catch (error) {
      // Der Status der Scheibe wird gesperrt gelesen; kommt trotzdem eine
      // zweite Zuweisung gleichzeitig durch, meldet der partielle Unique auf
      // `matches` den Verstoss. Er wird zur selben Fachantwort wie die
      // Vorpruefung — die Postgres-Meldung erreicht den Client nie.
      if (isBoardInProgressConflict(error)) {
        throw new ScoringValidationError("BOARD_NOT_AVAILABLE", "Selected board is not available.");
      }
      throw error;
    }
  }

  private createInTransaction(input: { readonly organizationId: string; readonly data: CreateMatchInput; readonly auth: AuthContext; readonly audit: AuditContext }): Promise<string> {
    return this.databaseService.database.transaction(async (transaction) => {
      const playerRows = await transaction.select({ id: players.id, status: players.status }).from(players)
        .where(and(eq(players.organizationId, input.organizationId), inArray(players.id, [input.data.playerOneId, input.data.playerTwoId])));
      if (playerRows.length !== 2 || playerRows.some((player) => player.status !== "ACTIVE")) throw new ScoringValidationError("INVALID_MATCH_PARTICIPANTS", "Both match players must be active members of the organization.");
      if (input.data.boardId !== undefined && input.data.boardId !== null) {
        const [board] = await transaction.select().from(boards).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId))).for("update").limit(1);
        // Der Status der Scheibe allein genuegt nicht: Turnier und Liga
        // belegen dieselbe physische Scheibe ueber `tournament_matches` und
        // `encounter_slots`. Beide Quellen zaehlen -- dieselbe Pruefung nutzen
        // `tournaments.assign`, `tournaments.releaseBoard` und
        // `encounters.assignSlot`. Der partielle Unique auf `matches` bleibt
        // die letzte Klammer, nicht die Pruefung.
        if (
          board === undefined ||
          board.status !== "AVAILABLE" ||
          (await isBoardOccupied(transaction, input.organizationId, input.data.boardId))
        ) {
          throw new ScoringValidationError("BOARD_NOT_AVAILABLE", "Selected board is not available.");
        }
      }
      // Ob Matchplay oder Set-Modus, sagt `bestOfSets`; die Siegziele leitet
      // die Domaene daraus ab (`matchTargets`).
      const winTargets = matchTargets(input.data);
      // Ein freies Match kennt keine Heimseite: der Anwurf von Leg eins wird
      // ausgebullt (`BULL_FIRST_LEG`). Sitz 1 ist bis dahin nur Vorbelegung,
      // die das `DECIDE_LEG_START` ueberschreibt.
      const startingSeat = 1;
      const [created] = await transaction.insert(matches).values({
        organizationId: input.organizationId, boardId: input.data.boardId ?? null, bestOfLegs: input.data.bestOfLegs,
        legsToWinSet: winTargets.legsToWin, setsToWin: winTargets.setsToWin,
        startingSeat, currentSeat: startingSeat, legStartRule: "BULL_FIRST_LEG",
      }).returning();
      if (created === undefined) throw new Error("Match insert did not return a row.");
      const participantRows = await transaction.insert(matchParticipants).values([
        { organizationId: input.organizationId, matchId: created.id, seat: 1 },
        { organizationId: input.organizationId, matchId: created.id, seat: 2 },
      ]).returning();
      const playerOfNewSeat = new Map([[1, input.data.playerOneId], [2, input.data.playerTwoId]]);
      await transaction.insert(matchParticipantPlayers).values(participantRows.map((participant) => {
        const playerId = playerOfNewSeat.get(participant.seat);
        if (playerId === undefined) throw new Error("Match seat invariant violated.");
        return { organizationId: input.organizationId, matchId: created.id, participantId: participant.id, playerId, position: 1 };
      }));
      await transaction.insert(legs).values({ organizationId: input.organizationId, matchId: created.id, legNumber: 1, startingSeat });
      if (input.data.boardId !== undefined && input.data.boardId !== null) await transaction.update(boards).set({ status: "IN_USE", updatedAt: new Date() }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId)));
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: created.id, eventType: "MATCH_STARTED", payload: { matchId: created.id } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "MATCH_CREATED", entityType: "Match", entityId: created.id, newValue: created, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return created.id;
    });
  }

  public acquireControllerLease(input: ActorInput & { readonly controllerId: string; readonly force: boolean }): Promise<{ readonly controllerId: string; readonly owned: boolean; readonly expiresAt: Date } | null | DeviceDenial> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [match] = await transaction.select({ id: matches.id, status: matches.status, boardId: matches.boardId }).from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return null;
      const denied = deviceDenial(input.auth, "write", match);
      if (denied !== null) return denied;
      const [current] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
      // Eine abgelaufene Lease eines ANDEREN Geraets gilt LEASE_GRACE_MS lang
      // als "kurz verlassen" (Sperrbildschirm, Tab im Hintergrund) und faellt
      // ohne force nicht an ein Geraet, das die Flaeche nur oeffnet; danach
      // gilt das Board als verlassen (Spec 2026-09-25, Befund 5).
      const abandoned = current !== undefined && current.expiresAt.getTime() + LEASE_GRACE_MS <= now.getTime();
      const mayOwn = match.status === "IN_PROGRESS" && (input.force || current === undefined || current.controllerId === input.controllerId || abandoned);
      if (!mayOwn && current !== undefined) return { controllerId: current.controllerId, owned: false, expiresAt: current.expiresAt };
      if (!mayOwn) return { controllerId: input.controllerId, owned: false, expiresAt: now };
      await transaction.insert(boardControllerLeases).values({ matchId: input.matchId, organizationId: input.organizationId, controllerId: input.controllerId, ...leaseActor(input.auth), expiresAt })
        .onConflictDoUpdate({ target: boardControllerLeases.matchId, set: { controllerId: input.controllerId, ...leaseActor(input.auth), expiresAt, updatedAt: now } });
      if (current === undefined || current.controllerId !== input.controllerId) {
        await transaction.insert(auditEvents).values({ organizationId: input.organizationId, ...auditActor(input.auth), action: current === undefined ? "BOARD_CONTROLLER_ACQUIRED" : "BOARD_CONTROLLER_TAKEN_OVER", entityType: "Match", entityId: input.matchId, oldValue: current ?? null, newValue: { controllerId: input.controllerId, expiresAt }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      }
      return { controllerId: input.controllerId, owned: true, expiresAt };
    });
  }

  public abort(input: UserActorInput & { readonly data: AbortMatchInput }): Promise<AbortMutationResult> {
    return retryOnDeadlock<AbortMutationResult>(() => this.abortInTransaction(input), "version-conflict");
  }

  private abortInTransaction(input: UserActorInput & { readonly data: AbortMatchInput }): Promise<AbortMutationResult> {
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
      // Globale Sperrreihenfolge Encounter -> EncounterSlot -> Match. Ohne
      // dieses Vorziehen liefe der Scoringpfad gegenlaeufig zum
      // Begegnungspfad und beide in einen Sperrzyklus (Befund I6).
      await lockEncounterScoringContext(transaction, input.organizationId, input.matchId);
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
      const reopenedSlot = await resetEncounterSlotForMatch(transaction, { organizationId: input.organizationId, matchId: input.matchId });
      if (reopenedSlot !== null) {
        await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Encounter", aggregateId: reopenedSlot.encounterId, eventType: "ENCOUNTER_SLOT_REOPENED", payload: { encounterId: reopenedSlot.encounterId, slotId: reopenedSlot.slotId, sequence: reopenedSlot.sequence, matchId: input.matchId } });
      }
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: "MATCH_ABORTED", payload: { matchId: input.matchId, tournamentMatchId: scheduled?.id ?? null, commandId: input.data.commandId, discardedVisitCount: aborted.discardedVisitCount } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "MATCH_ABORTED", entityType: "Match", entityId: input.matchId, oldValue: match, newValue: { status: "ABORTED", reason: input.data.reason ?? null, tournamentMatchId: scheduled?.id ?? null, discardedVisitCount: aborted.discardedVisitCount }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return { matchId: input.matchId, status: "ABORTED", tournamentMatchId: scheduled?.id ?? null };
    });
  }

  public submitVisit(input: ActorInput & { readonly data: SubmitVisitInput }): Promise<MutationResult> {
    return retryOnDeadlock(() => this.submitVisitInTransaction(input), "version-conflict");
  }

  private submitVisitInTransaction(input: ActorInput & { readonly data: SubmitVisitInput }): Promise<MutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<MutationResult> => {
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, input.data.commandId) !== null) return "ok";
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      // Globale Sperrreihenfolge Encounter -> EncounterSlot -> Match. Ohne
      // dieses Vorziehen liefe der Scoringpfad gegenlaeufig zum
      // Begegnungspfad und beide in einen Sperrzyklus (Befund I6).
      await lockEncounterScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      // Zweite Pruefung, jetzt unter der Sperre. Sie steht vor der
      // Versionspruefung, damit eine gleichzeitige Wiederholung die
      // Bestaetigung bekommt und nicht den Konflikt.
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, input.data.commandId) !== null) return "ok";
      if (match === undefined) return "not-found";
      // Vor der Versionspruefung: ein Geraet erfaehrt ueber einen Konflikt
      // nichts ueber ein Match einer anderen Scheibe. Beim Undo steht die
      // Pruefung vor dem Zweig, der ein beendetes Match wieder eroeffnet.
      const denied = deviceDenial(input.auth, "write", match);
      if (denied !== null) return denied;
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
      const loadedSides = await this.loadSides(transaction, input.organizationId, input.matchId);
      const commandRows = await transaction.select({ payload: scoreCommands.payload }).from(scoreCommands).where(and(eq(scoreCommands.organizationId, input.organizationId), eq(scoreCommands.matchId, input.matchId))).orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(match, loadedSides, commandRows.map((row) => row.payload));
      const commandSide = aggregate.sides.find((side) => side.playerIds.includes(input.data.playerId));
      if (commandSide === undefined) {
        throw new ScoringValidationError("INVALID_MATCH_PARTICIPANTS", "The player does not belong to this match.");
      }
      // `checkoutAttempts` wird HIER materialisiert (nicht dem `?? 0` in
      // `storedSubmitSchema` ueberlassen), damit ein Replay denselben Wert
      // sieht wie die Schreibzeit: die gespeicherte Nutzlast (`payload:
      // command` unten) traegt das Feld dann immer explizit. Dieselbe
      // Ableitung wie die Engine selbst (`defaultCheckoutAttempts`), damit ein
      // API-Client, der z.B. `checkoutSegment` ohne `checkoutAttempts`
      // schickt, nicht als Checkout mit null Versuchen gezaehlt wird
      // (PR-Agent-Runde 3, Befund B).
      const normalizedCheckoutDouble = input.data.checkoutDouble === undefined || input.data.checkoutDouble === null ? undefined : input.data.checkoutDouble;
      const checkoutAttempts = input.data.checkoutAttempts ?? defaultCheckoutAttempts({
        ...(normalizedCheckoutDouble === undefined ? {} : { checkoutDouble: normalizedCheckoutDouble }),
        ...(input.data.checkoutSegment === undefined ? {} : { checkoutSegment: input.data.checkoutSegment }),
        ...(input.data.checkoutMissed === undefined ? {} : { checkoutMissed: input.data.checkoutMissed }),
      });
      const command: X01Command = {
        type: "SUBMIT_VISIT", commandId: input.data.commandId, seat: commandSide.seat,
        throwerPlayerId: input.data.playerId, points: input.data.points, dartsThrown: input.data.dartsThrown,
        checkoutAttempts,
        ...(normalizedCheckoutDouble === undefined ? {} : { checkoutDouble: normalizedCheckoutDouble }),
        ...(input.data.darts === undefined ? {} : { darts: input.data.darts }),
        ...(input.data.checkoutSegment === undefined ? {} : { checkoutSegment: input.data.checkoutSegment }),
        ...(input.data.checkoutMissed === true ? { checkoutMissed: true } : {}),
      };
      const result = executeX01Command(aggregate, command);
      const applied = result.state.visits.at(-1);
      if (applied === undefined) throw new Error("Visit projection did not return an applied visit.");
      const [leg] = await transaction.select().from(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, applied.legNumber))).for("update").limit(1);
      if (leg === undefined) throw new Error("Active leg invariant violated.");
      const nextVersion = match.version + 1;
      const [createdVisit] = await transaction.insert(visits).values({
        organizationId: input.organizationId, matchId: input.matchId, legId: leg.id, throwerPlayerId: applied.throwerPlayerId, seat: applied.seat,
        commandId: input.data.commandId, sequence: nextVersion, points: applied.points, appliedPoints: applied.appliedPoints,
        dartsThrown: applied.dartsThrown, scoreBefore: applied.scoreBefore, scoreAfter: applied.scoreAfter,
        checkoutDouble: applied.checkoutDouble, outcome: applied.outcome,
        checkoutAttempts: applied.checkoutAttempts,
      }).returning();
      if (createdVisit === undefined) throw new Error("Visit insert did not return a row.");
      if (applied.darts.length > 0) {
        await transaction.insert(visitDarts).values(
          applied.darts.map((dart, index) => ({
            organizationId: input.organizationId,
            visitId: createdVisit.id,
            dartIndex: index + 1,
            segment: dart.segment,
            multiplier: dart.multiplier,
            value: dart.segment * dart.multiplier,
          })),
        );
      }
      const wonLeg = applied.outcome.endsWith("WON");
      await transaction.update(legs).set({ version: leg.version + 1, ...(wonLeg ? { status: "COMPLETED", winnerSeat: applied.seat, completedAt: new Date() } : {}), updatedAt: new Date() }).where(and(eq(legs.organizationId, input.organizationId), eq(legs.id, leg.id)));
      if (wonLeg && result.state.status === "IN_PROGRESS") await transaction.insert(legs).values({ organizationId: input.organizationId, matchId: input.matchId, legNumber: result.state.legNumber, startingSeat: result.state.legStartingSeat });
      await this.syncProjection(transaction, input, match.boardId, nextVersion, result.state);
      const matchWinnerPlayerId = playerOfSeat(result.state, result.state.winnerSeat);
      if (result.state.status === "COMPLETED" && matchWinnerPlayerId !== null) {
        await this.syncTournamentProgress(
          transaction,
          input.organizationId,
          input.matchId,
          matchWinnerPlayerId,
          { principal: input.auth, audit: input.audit },
        );
      }
      if (result.state.status === "COMPLETED" && result.state.winnerSeat !== null) {
        await completeEncounterSlotForMatch(transaction, {
          organizationId: input.organizationId,
          matchId: input.matchId,
          winnerSeat: result.state.winnerSeat,
          homeLegs: result.state.sides.find((side) => side.seat === 1)?.totalLegsWon ?? 0,
          awayLegs: result.state.sides.find((side) => side.seat === 2)?.totalLegsWon ?? 0,
        });
      }
      await transaction.insert(scoreCommands).values({ commandId: input.data.commandId, organizationId: input.organizationId, matchId: input.matchId, type: command.type, payload: command, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: result.state.status === "COMPLETED" ? "MATCH_COMPLETED" : "VISIT_RECORDED", payload: { matchId: input.matchId, commandId: input.data.commandId, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, ...auditActor(input.auth), action: "SCORE_VISIT_RECORDED", entityType: "Match", entityId: input.matchId, newValue: createdVisit, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
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
      if (await this.findDuplicateTournamentCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";

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
      // Zweite Pruefung unter der Sperre — siehe `findDuplicateTournamentCommand`.
      if (await this.findDuplicateTournamentCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
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
      // Vereinsduell: nach der Paarung der Folgephase steht das Resultat fest.
      if (await isClubDuelResultLocked(transaction, input.organizationId, input.tournamentId, scheduled)) return "club-duel-round-paired";

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

      // Doppel-K.-o.: Das Rückspiel hat keine Quelle (es entsteht aus dem Ausgang
      // des ersten Finals), deshalb prüft der Quellen-Block oben es nicht.
      const resetRow =
        tournament.format === "DOUBLE_ELIMINATION" && scheduled.key === GRAND_FINAL_KEY
          ? (await transaction
              .select()
              .from(tournamentMatches)
              .where(and(
                eq(tournamentMatches.organizationId, input.organizationId),
                eq(tournamentMatches.tournamentId, input.tournamentId),
                eq(tournamentMatches.key, GRAND_FINAL_RESET_KEY),
              ))
              .for("update")
              .limit(1))[0]
          : undefined;
      if (resetRow !== undefined && (resetRow.status === "IN_PROGRESS" || resetRow.status === "COMPLETED")) {
        return "downstream-started";
      }

      const plan = await this.planResultReopen(transaction, input.organizationId, scoringMatch, input.data.commandId);
      if (plan === null) return "result-not-correctable";
      if (resetRow !== undefined) {
        await transaction.delete(tournamentMatches).where(and(
          eq(tournamentMatches.organizationId, input.organizationId),
          eq(tournamentMatches.id, resetRow.id),
        ));
      }
      const nextTournamentVersion = tournament.version + 1;
      const nextMatchVersion = await this.applyResultReopen(
        transaction,
        { organizationId: input.organizationId, match: scoringMatch, auth: input.auth, audit: input.audit },
        plan,
      );

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
        tournament.format === "CLUB_DUEL"
          ? await this.clubDuelStatusForStage(transaction, input.organizationId, scheduled.stageId)
          : scheduled.groupId !== null || tournament.format === "ROUND_ROBIN"
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

  /** Turnierstatus eines Vereinsduells, dessen Spiel in `stageId` wieder geoeffnet wird. */
  private async clubDuelStatusForStage(
    transaction: Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0],
    organizationId: string,
    stageId: string,
  ): Promise<"GROUP_STAGE" | "FINAL_ROUND" | "KNOCKOUT"> {
    const [stage] = await transaction
      .select({ key: tournamentStages.key })
      .from(tournamentStages)
      .where(and(eq(tournamentStages.organizationId, organizationId), eq(tournamentStages.id, stageId)))
      .limit(1);
    if (stage?.key === CLUB_DUEL_STAGE_KEYS.qualifying) return "GROUP_STAGE";
    if (stage?.key === CLUB_DUEL_STAGE_KEYS.finalRound) return "FINAL_ROUND";
    return "KNOCKOUT";
  }

  /**
   * Resultatkorrektur einer abgeschlossenen Liga-Begegnung (Spec
   * 2026-10-01-liga-resultatkorrektur): das gespielte Spiel eines Slots wird
   * wieder geoeffnet und neu gescort. Laeuft als Begegnungskommando —
   * Idempotenz ueber `encounter_commands`, Versionspruefung auf der Begegnung
   * —, liegt aber hier, weil es das Match genau wie `correctTournamentResult`
   * wieder eroeffnet (`planResultReopen`/`applyResultReopen`).
   */
  public async correctEncounterResult(input: {
    readonly organizationId: string;
    readonly encounterId: string;
    readonly data: CorrectEncounterResultInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<EncounterCorrectionResult> {
    try {
      return await retryOnDeadlock(() => this.correctEncounterResultInTransaction(input), "version-conflict");
    } catch (error) {
      // Wie in `EncountersRepository.mutate`: dieselbe commandId gleichzeitig
      // an zwei Begegnungen faengt erst der Primaerschluessel ab.
      if (isDuplicateEncounterCommandIdError(error)) return "command-id-reused";
      // Zweites Netz zur Scheibenpruefung, wie beim Undo.
      if (isBoardInProgressConflict(error)) return "board-unavailable";
      throw error;
    }
  }

  private correctEncounterResultInTransaction(input: {
    readonly organizationId: string;
    readonly encounterId: string;
    readonly data: CorrectEncounterResultInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<EncounterCorrectionResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<EncounterCorrectionResult> => {
      const type = ENCOUNTER_RESULT_CORRECTION_TYPE;
      const seen = await findDuplicateEncounterCommand(transaction, input, input.data, type);
      if (seen !== null) return seen;

      // Sperrreihenfolge Encounter -> EncounterSlot -> Match -> Board ->
      // Players, wie Undo und `assignSlot`. Alle Pruefungen stehen vor dem
      // ersten Schreibzugriff.
      const [encounter] = await transaction
        .select()
        .from(encounters)
        .where(and(eq(encounters.organizationId, input.organizationId), eq(encounters.id, input.encounterId)))
        .for("update")
        .limit(1);
      // Zweite Pruefung unter der Sperre — siehe `EncountersRepository.runMutation`.
      const seenUnderLock = await findDuplicateEncounterCommand(transaction, input, input.data, type);
      if (seenUnderLock !== null) return seenUnderLock;
      if (encounter === undefined) return "not-found";
      if (encounter.version !== input.data.expectedVersion) return "version-conflict";
      // Ein Forfait ist ein Entscheid am gruenen Tisch, kein Spielresultat;
      // korrigierbar sind nur gespielte Begegnungen (mit oder ohne Decider).
      if (
        encounter.status !== "COMPLETED" ||
        (encounter.resultType !== "PLAYED" && encounter.resultType !== "DECIDER")
      ) {
        return "encounter-not-correctable";
      }

      const [slot] = await transaction
        .select()
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            eq(encounterSlots.id, input.data.slotId),
          ),
        )
        .for("update")
        .limit(1);
      if (slot === undefined) return "slot-not-found";
      if (slot.status !== "COMPLETED" || slot.resultType !== "PLAYED" || slot.matchId === null) {
        return "slot-not-correctable";
      }
      const deciders = await transaction
        .select()
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            eq(encounterSlots.role, "DECIDER"),
          ),
        )
        .for("update");
      // Reglement 2.2.2 und A1.4: das Entscheidungsdoppel (sudden death) baut
      // auf dem Stand der regulaeren Spiele auf. Ist es angesetzt, gespielt
      // oder kampflos gewertet, wird zuerst das Doppel korrigiert. Ein als
      // nicht gebraucht gestrichenes Doppel (CANCELLED) geht unten zurueck
      // auf WAITING.
      if (
        slot.role !== "DECIDER" &&
        deciders.some((decider) => ["IN_PROGRESS", "COMPLETED", "WALKOVER"].includes(decider.status))
      ) {
        return "decider-correction-required";
      }

      const [match] = await transaction
        .select()
        .from(matches)
        .where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, slot.matchId)))
        .for("update")
        .limit(1);
      if (match === undefined || match.status !== "COMPLETED") return "slot-not-correctable";

      // Die Korrektur traegt ihre commandId auch in den Scoringstrom
      // (`score_commands`, global eindeutig). Diese Pruefung muss vor
      // `planResultReopen` laufen: eine commandId, die fuer DIESES Match schon
      // als Visit verwendet wurde, waere der Scoring Engine sonst ein
      // Duplikat und ergaebe ueber deren projizierten (abgeschlossenen)
      // Zustand faelschlich SLOT_NOT_CORRECTABLE statt COMMAND_ID_ALREADY_USED.
      const [usedForScoring] = await transaction
        .select({ commandId: scoreCommands.commandId })
        .from(scoreCommands)
        .where(eq(scoreCommands.commandId, input.data.commandId))
        .limit(1);
      if (usedForScoring !== undefined) return "command-id-reused";

      const plan = await this.planResultReopen(transaction, input.organizationId, match, input.data.commandId);
      if (plan === null) return "slot-not-correctable";

      if (match.boardId === null) return "board-unavailable";
      const [board] = await transaction
        .select()
        .from(boards)
        .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, match.boardId)))
        .for("update")
        .limit(1);
      if (board === undefined || board.status !== "AVAILABLE") return "board-unavailable";
      if (await isBoardOccupied(transaction, input.organizationId, match.boardId)) return "board-unavailable";

      // Dieselbe Personenpruefung wie beim Undo nach Match-Ende (AGENTS.md 9).
      const participantRows = await transaction
        .select({ playerId: matchParticipantPlayers.playerId })
        .from(matchParticipantPlayers)
        .where(and(eq(matchParticipantPlayers.organizationId, input.organizationId), eq(matchParticipantPlayers.matchId, match.id)));
      const participantIds = participantRows.map((row) => row.playerId);
      await lockPlayers(transaction, input.organizationId, participantIds);
      const activePlayerIds = await loadActivePlayerIds(transaction, input.organizationId);
      if (participantIds.some((playerId) => activePlayerIds.has(playerId))) return "player-busy";

      const now = new Date();
      const nextEncounterVersion = encounter.version + 1;
      // Status und Resultat fallen in einer Anweisung:
      // `encounters_completed_result_check` und `encounters_result_pair_check`
      // binden beide aneinander. Die Punkte sind NOT NULL und gehen auf 0;
      // Spiele und Legs rechnet `updateEncounterProgress` unten neu.
      await transaction
        .update(encounters)
        .set({
          status: "RUNNING",
          result: null,
          resultType: null,
          homePoints: 0,
          awayPoints: 0,
          completedAt: null,
          version: nextEncounterVersion,
          updatedAt: now,
        })
        .where(and(eq(encounters.organizationId, input.organizationId), eq(encounters.id, input.encounterId)));
      const reopenedDeciderSlotIds: string[] = [];
      if (slot.role !== "DECIDER") {
        // Ergibt die Korrektur wieder kein Unentschieden, streicht
        // `updateEncounterProgress` das Doppel beim Abschluss erneut.
        for (const decider of deciders.filter((candidate) => candidate.status === "CANCELLED")) {
          await transaction
            .update(encounterSlots)
            .set({ status: "WAITING", version: decider.version + 1, updatedAt: now })
            .where(and(eq(encounterSlots.organizationId, input.organizationId), eq(encounterSlots.id, decider.id)));
          reopenedDeciderSlotIds.push(decider.id);
        }
      }
      await reopenPlayedEncounterSlot(transaction, {
        organizationId: input.organizationId,
        slot,
        matchId: match.id,
        boardId: match.boardId,
        auth: input.auth,
        audit: input.audit,
        now,
      });
      await this.applyResultReopen(
        transaction,
        { organizationId: input.organizationId, match, auth: input.auth, audit: input.audit, now },
        plan,
      );
      await updateEncounterProgress(transaction, input.organizationId, input.encounterId, now);
      await transaction.insert(encounterCommands).values({
        commandId: input.data.commandId,
        organizationId: input.organizationId,
        encounterId: input.encounterId,
        type,
        payload: input.data,
        resultingVersion: nextEncounterVersion,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "Encounter",
        aggregateId: input.encounterId,
        eventType: "ENCOUNTER_RESULT_CORRECTED",
        payload: {
          encounterId: input.encounterId,
          slotId: slot.id,
          matchId: match.id,
          commandId: input.data.commandId,
          version: nextEncounterVersion,
        },
      });
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        ...auditActor(input.auth),
        action: "ENCOUNTER_RESULT_CORRECTED",
        entityType: "Encounter",
        entityId: input.encounterId,
        oldValue: {
          encounter: {
            status: encounter.status,
            result: encounter.result,
            resultType: encounter.resultType,
            homePoints: encounter.homePoints,
            awayPoints: encounter.awayPoints,
            homeGames: encounter.homeGames,
            awayGames: encounter.awayGames,
            homeLegs: encounter.homeLegs,
            awayLegs: encounter.awayLegs,
            completedAt: encounter.completedAt,
            version: encounter.version,
          },
          slot,
        },
        newValue: {
          status: "RUNNING",
          slotId: slot.id,
          matchId: match.id,
          reason: input.data.reason,
          reopenedDeciderSlotIds,
        },
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }

  /**
   * Lesender Teil der Wiedereroeffnung eines beendeten Matches: die letzte
   * Aufnahme muss ein Leg gewonnen haben, und ihre Ruecknahme muss das Match
   * wieder laufen lassen. Sonst `null` — der Aufrufer lehnt ab, ohne dass
   * etwas geschrieben wurde. Gemeinsam fuer Turnier- und Ligakorrektur.
   */
  private async planResultReopen(
    transaction: DatabaseTransaction,
    organizationId: string,
    match: typeof matches.$inferSelect,
    commandId: string,
  ): Promise<ResultReopenPlan | null> {
    const [latest] = await transaction
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.organizationId, organizationId),
          eq(visits.matchId, match.id),
          isNull(visits.revertedAt),
        ),
      )
      .orderBy(desc(visits.sequence))
      .limit(1);
    if (latest === undefined || !latest.outcome.endsWith("WON")) return null;
    const loadedSides = await this.loadSides(transaction, organizationId, match.id);
    const commandRows = await transaction
      .select({ payload: scoreCommands.payload })
      .from(scoreCommands)
      .where(
        and(
          eq(scoreCommands.organizationId, organizationId),
          eq(scoreCommands.matchId, match.id),
        ),
      )
      .orderBy(asc(scoreCommands.resultingVersion));
    const aggregate = this.aggregate(
      match,
      loadedSides,
      commandRows.map((row) => row.payload),
    );
    const undoCommand: UndoLastVisitCommand = {
      type: "UNDO_LAST_VISIT",
      commandId,
      targetCommandId: latest.commandId,
    };
    const result = executeX01Command(aggregate, undoCommand);
    if (result.state.status !== "IN_PROGRESS") return null;
    return { latestVisitId: latest.id, undoCommand, state: result.state };
  }

  /**
   * Schreibender Teil: Aufnahme zuruecknehmen, Folgeleg loeschen, aktuelles
   * Leg wieder oeffnen, Projektion (Match IN_PROGRESS, Scheibe IN_USE) und
   * `score_commands`-Eintrag. Liefert die neue Matchversion.
   */
  private async applyResultReopen(
    transaction: DatabaseTransaction,
    input: {
      readonly organizationId: string;
      readonly match: typeof matches.$inferSelect;
      readonly auth: Principal;
      readonly audit: AuditContext;
      /** Teilt sich den Zeitstempel mit dem Aufrufer, sofern er einen fuehrt
       * (die Liga-Korrektur hat bereits ein `now`); ohne Angabe — wie bei der
       * Turnier-Korrektur — erzeugt die Funktion ihr eigenes. */
      readonly now?: Date;
    },
    plan: ResultReopenPlan,
  ): Promise<number> {
    const { organizationId, match } = input;
    const now = input.now ?? new Date();
    const commandId = plan.undoCommand.commandId;
    const nextMatchVersion = match.version + 1;
    await transaction
      .update(visits)
      .set({ revertedAt: now, revertedByCommandId: commandId })
      .where(
        and(
          eq(visits.organizationId, organizationId),
          eq(visits.id, plan.latestVisitId),
        ),
      );
    await transaction
      .delete(legs)
      .where(
        and(
          eq(legs.organizationId, organizationId),
          eq(legs.matchId, match.id),
          eq(legs.legNumber, plan.state.legNumber + 1),
        ),
      );
    const [currentLeg] = await transaction
      .select()
      .from(legs)
      .where(
        and(
          eq(legs.organizationId, organizationId),
          eq(legs.matchId, match.id),
          eq(legs.legNumber, plan.state.legNumber),
        ),
      )
      .for("update")
      .limit(1);
    if (currentLeg === undefined) throw new Error("Correction leg invariant violated.");
    await transaction
      .update(legs)
      .set({
        status: "IN_PROGRESS",
        winnerSeat: null,
        completedAt: null,
        version: currentLeg.version + 1,
        updatedAt: now,
      })
      .where(and(eq(legs.organizationId, organizationId), eq(legs.id, currentLeg.id)));
    await this.syncProjection(
      transaction,
      {
        organizationId,
        matchId: match.id,
        auth: input.auth,
        audit: input.audit,
      },
      match.boardId,
      nextMatchVersion,
      plan.state,
    );
    await transaction.insert(scoreCommands).values({
      commandId,
      organizationId,
      matchId: match.id,
      type: plan.undoCommand.type,
      payload: plan.undoCommand,
      resultingVersion: nextMatchVersion,
    });
    return nextMatchVersion;
  }

  public async undo(input: ActorInput & { readonly data: UndoVisitInput }): Promise<UndoMutationResult> {
    return retryOnDeadlock(async () => {
      try {
        return await this.undoInTransaction(input);
      } catch (error) {
        // Zweites Netz: faellt die Pruefung durch ein Rennen hindurch, meldet
        // der partielle Unique auf `matches` die Doppelbelegung. Fachlich ist
        // das dieselbe Antwort, kein Serverfehler.
        if (isBoardInProgressConflict(error)) return "board-unavailable";
        throw error;
      }
    }, "version-conflict");
  }

  private undoInTransaction(input: ActorInput & { readonly data: UndoVisitInput }): Promise<UndoMutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<UndoMutationResult> => {
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, input.data.commandId) !== null) return "ok";
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      // Globale Sperrreihenfolge Encounter -> EncounterSlot -> Match. Ohne
      // dieses Vorziehen liefe der Scoringpfad gegenlaeufig zum
      // Begegnungspfad und beide in einen Sperrzyklus (Befund I6).
      await lockEncounterScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      // Zweite Pruefung, jetzt unter der Sperre. Sie steht vor der
      // Versionspruefung, damit eine gleichzeitige Wiederholung die
      // Bestaetigung bekommt und nicht den Konflikt.
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, input.data.commandId) !== null) return "ok";
      if (match === undefined) return "not-found";
      // Vor der Versionspruefung: ein Geraet erfaehrt ueber einen Konflikt
      // nichts ueber ein Match einer anderen Scheibe. Beim Undo steht die
      // Pruefung vor dem Zweig, der ein beendetes Match wieder eroeffnet.
      const denied = deviceDenial(input.auth, "write", match);
      if (denied !== null) return denied;
      if (match.version !== input.data.expectedVersion) return "version-conflict";
      const [lease] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      if (lease !== undefined && lease.expiresAt > new Date() && lease.controllerId !== input.data.controllerId) return "controller-conflict";
      let slotReopened = false;
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
        // Mit dem Ende gibt `syncProjection` die Scheibe frei; das naechste
        // Paar kann dort laengst stehen. Ein Undo setzt das Match zurueck auf
        // IN_PROGRESS und stellte damit ein zweites laufendes Spiel auf
        // dieselbe physische Scheibe. Der Turnierpfad kennt diesen Schutz seit
        // je (`correctTournamentResult`); Ligaslots und freie Paarungen hatten
        // ihn nicht.
        if (match.boardId !== null) {
          const [board] = await transaction
            .select()
            .from(boards)
            .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, match.boardId)))
            .for("update")
            .limit(1);
          if (board === undefined || board.status !== "AVAILABLE") return "board-unavailable";
          if (await isBoardOccupied(transaction, input.organizationId, match.boardId)) {
            return "board-unavailable";
          }
        }
        // Dasselbe fuer die Personen: wer das Match beendet hat, kann laengst
        // an einer anderen Scheibe stehen; ein Undo stellte ihn doppelt an
        // die Scheibe (AGENTS.md 9). Gleiche Sperre und Pruefung wie
        // `assignSlot`, Reihenfolge Encounter -> Slot -> Match -> Board ->
        // Players. Das Match selbst ist COMPLETED und zaehlt nicht mit.
        const participantRows = await transaction
          .select({ playerId: matchParticipantPlayers.playerId })
          .from(matchParticipantPlayers)
          .where(and(eq(matchParticipantPlayers.organizationId, input.organizationId), eq(matchParticipantPlayers.matchId, input.matchId)));
        const participantIds = participantRows.map((row) => row.playerId);
        await lockPlayers(transaction, input.organizationId, participantIds);
        const activePlayerIds = await loadActivePlayerIds(transaction, input.organizationId);
        if (participantIds.some((playerId) => activePlayerIds.has(playerId))) return "player-busy";
        // Liga: der Slot geht mit dem Match zurueck auf IN_PROGRESS, sonst
        // erreichte das korrigierte Resultat ihn beim naechsten Checkout nicht
        // mehr. Eine abgeschlossene Begegnung oder ein schon angesetztes
        // Entscheidungsdoppel lehnt das ab, ebenso ein Slot, der nicht als
        // gespielt abgeschlossen ist (Regel in `sync-encounter-slot.ts`).
        // Die Sperren auf Begegnung und Slot haelt bereits
        // `lockEncounterScoringContext` oben; Reihenfolge bleibt
        // Encounter -> EncounterSlot -> Match.
        const reopened = await reopenEncounterSlotForMatch(transaction, {
          organizationId: input.organizationId,
          matchId: input.matchId,
          boardId: match.boardId,
          auth: input.auth,
          audit: input.audit,
        });
        if (reopened === "encounter-closed" || reopened === "slot-not-completed") {
          throw new ScoringValidationError(
            "ENCOUNTER_RESULT_REQUIRES_CORRECTION",
            "Completed encounter results cannot be reopened by undo.",
          );
        }
        slotReopened = reopened === "reopened";
      }
      const [latest] = await transaction.select().from(visits).where(and(eq(visits.organizationId, input.organizationId), eq(visits.matchId, input.matchId), isNull(visits.revertedAt))).orderBy(desc(visits.sequence)).limit(1);
      if (latest === undefined) throw new ScoringValidationError("NOTHING_TO_UNDO", "There is no visit to undo.");
      const loadedSides = await this.loadSides(transaction, input.organizationId, input.matchId);
      const commandRows = await transaction.select({ payload: scoreCommands.payload }).from(scoreCommands).where(and(eq(scoreCommands.organizationId, input.organizationId), eq(scoreCommands.matchId, input.matchId))).orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(match, loadedSides, commandRows.map((row) => row.payload));
      const command: X01Command = { type: "UNDO_LAST_VISIT", commandId: input.data.commandId, targetCommandId: latest.commandId };
      const result = executeX01Command(aggregate, command);
      // Ein geoeffneter Slot setzt ein wieder laufendes Match voraus; sonst
      // stuenden Slot und Match auseinander. Der Fehler rollt alles zurueck.
      if (slotReopened && result.state.status !== "IN_PROGRESS") {
        throw new Error("Undo reopened an encounter slot without reopening its match.");
      }
      const nextVersion = match.version + 1;
      await transaction.update(visits).set({ revertedAt: new Date(), revertedByCommandId: input.data.commandId }).where(and(eq(visits.organizationId, input.organizationId), eq(visits.id, latest.id)));
      await transaction.delete(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, result.state.legNumber + 1)));
      const [currentLeg] = await transaction.select().from(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, result.state.legNumber))).for("update").limit(1);
      if (currentLeg === undefined) throw new Error("Undo leg invariant violated.");
      await transaction.update(legs).set({ status: "IN_PROGRESS", winnerSeat: null, completedAt: null, version: currentLeg.version + 1, updatedAt: new Date() }).where(eq(legs.id, currentLeg.id));
      await this.syncProjection(transaction, input, match.boardId, nextVersion, result.state);
      await transaction.insert(scoreCommands).values({ commandId: input.data.commandId, organizationId: input.organizationId, matchId: input.matchId, type: command.type, payload: command, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: "VISIT_REVERTED", payload: { matchId: input.matchId, visitId: latest.id, commandId: input.data.commandId, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, ...auditActor(input.auth), action: "SCORE_VISIT_REVERTED", entityType: "Visit", entityId: latest.id, oldValue: latest, newValue: { revertedByCommandId: input.data.commandId }, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
      return "ok";
    });
  }

  /**
   * Die beiden Kommandos aus dem Reglement, die kein Visit erzeugen: der ab
   * Leg drei ausgebullte Legbeginn (2.2.9) und das durch Ausbullen
   * entschiedene Leg an der Rundengrenze (Anhang 2). Sie laufen über
   * denselben Weg wie ein Visit, nur ohne Zeile in `visits`; die
   * Kommandoliste in `score_commands` trägt sie.
   */
  public decideLegStart(input: ActorInput & { readonly data: DecideLegStartInput }): Promise<MutationResult> {
    return this.decideLeg(input, input.data, {
      type: "DECIDE_LEG_START",
      commandId: input.data.commandId,
      legNumber: input.data.legNumber,
      startingSeat: input.data.startingSeat,
    });
  }

  public decideLegByBull(input: ActorInput & { readonly data: DecideLegByBullInput }): Promise<MutationResult> {
    return this.decideLeg(input, input.data, {
      type: "DECIDE_LEG_BY_BULL",
      commandId: input.data.commandId,
      winnerSeat: input.data.winnerSeat,
    });
  }

  private decideLeg(
    input: ActorInput,
    envelope: { readonly commandId: string; readonly expectedVersion: number; readonly controllerId?: string | undefined },
    command: X01Command,
  ): Promise<MutationResult> {
    return retryOnDeadlock(() => this.decideLegInTransaction(input, envelope, command), "version-conflict");
  }

  private decideLegInTransaction(
    input: ActorInput,
    envelope: { readonly commandId: string; readonly expectedVersion: number; readonly controllerId?: string | undefined },
    command: X01Command,
  ): Promise<MutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<MutationResult> => {
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, envelope.commandId) !== null) return "ok";
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      // Globale Sperrreihenfolge Encounter -> EncounterSlot -> Match. Ohne
      // dieses Vorziehen liefe der Scoringpfad gegenlaeufig zum
      // Begegnungspfad und beide in einen Sperrzyklus (Befund I6).
      await lockEncounterScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      // Zweite Pruefung, jetzt unter der Sperre. Sie steht vor der
      // Versionspruefung, damit eine gleichzeitige Wiederholung die
      // Bestaetigung bekommt und nicht den Konflikt.
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, envelope.commandId) !== null) return "ok";
      if (match === undefined) return "not-found";
      const denied = deviceDenial(input.auth, "write", match);
      if (denied !== null) return denied;
      if (match.version !== envelope.expectedVersion) return "version-conflict";
      const [lease] = await transaction.select().from(boardControllerLeases).where(and(eq(boardControllerLeases.organizationId, input.organizationId), eq(boardControllerLeases.matchId, input.matchId))).for("update").limit(1);
      if (lease !== undefined && lease.expiresAt > new Date() && lease.controllerId !== envelope.controllerId) return "controller-conflict";

      const loadedSides = await this.loadSides(transaction, input.organizationId, input.matchId);
      const commandRows = await transaction.select({ payload: scoreCommands.payload }).from(scoreCommands).where(and(eq(scoreCommands.organizationId, input.organizationId), eq(scoreCommands.matchId, input.matchId))).orderBy(asc(scoreCommands.resultingVersion));
      const aggregate = this.aggregate(match, loadedSides, commandRows.map((row) => row.payload));
      const result = executeX01Command(aggregate, command);
      const nextVersion = match.version + 1;
      const now = new Date();

      if (command.type === "DECIDE_LEG_START") {
        await transaction.update(legs).set({ startingSeat: command.startingSeat, updatedAt: now }).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, command.legNumber)));
      } else {
        const decision = result.state.legDecisions.at(-1);
        if (decision === undefined) throw new Error("Leg decision projection invariant violated.");
        const [decided] = await transaction.select().from(legs).where(and(eq(legs.organizationId, input.organizationId), eq(legs.matchId, input.matchId), eq(legs.legNumber, decision.legNumber))).for("update").limit(1);
        if (decided === undefined) throw new Error("Decided leg invariant violated.");
        await transaction.update(legs).set({ status: "COMPLETED", winnerSeat: decision.winnerSeat, completedAt: now, version: decided.version + 1, updatedAt: now }).where(eq(legs.id, decided.id));
        if (result.state.status === "IN_PROGRESS") {
          await transaction.insert(legs).values({ organizationId: input.organizationId, matchId: input.matchId, legNumber: result.state.legNumber, startingSeat: result.state.legStartingSeat });
        }
      }

      await this.syncProjection(transaction, input, match.boardId, nextVersion, result.state);
      const matchWinnerPlayerId = playerOfSeat(result.state, result.state.winnerSeat);
      if (result.state.status === "COMPLETED" && matchWinnerPlayerId !== null) {
        await this.syncTournamentProgress(transaction, input.organizationId, input.matchId, matchWinnerPlayerId, { principal: input.auth, audit: input.audit });
      }
      if (result.state.status === "COMPLETED" && result.state.winnerSeat !== null) {
        await completeEncounterSlotForMatch(transaction, {
          organizationId: input.organizationId,
          matchId: input.matchId,
          winnerSeat: result.state.winnerSeat,
          homeLegs: result.state.sides.find((side) => side.seat === 1)?.totalLegsWon ?? 0,
          awayLegs: result.state.sides.find((side) => side.seat === 2)?.totalLegsWon ?? 0,
        });
      }
      await transaction.insert(scoreCommands).values({ commandId: envelope.commandId, organizationId: input.organizationId, matchId: input.matchId, type: command.type, payload: command, resultingVersion: nextVersion });
      await transaction.insert(outboxEvents).values({ organizationId: input.organizationId, aggregateType: "Match", aggregateId: input.matchId, eventType: result.state.status === "COMPLETED" ? "MATCH_COMPLETED" : "LEG_DECIDED", payload: { matchId: input.matchId, commandId: envelope.commandId, type: command.type, version: nextVersion } });
      await transaction.insert(auditEvents).values({ organizationId: input.organizationId, ...auditActor(input.auth), action: command.type, entityType: "Match", entityId: input.matchId, oldValue: match, newValue: command, ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId });
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

  /**
   * Laedt die beiden Seiten eines Matches samt ihrer Besetzung, nach Sitz und
   * innerhalb der Seite nach Position sortiert.
   */
  private async loadSides(
    transaction:
      | Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0]
      | typeof this.databaseService.database,
    organizationId: string,
    matchId: string,
  ): Promise<readonly [LoadedSide, LoadedSide]> {
    const rows = await transaction
      .select({
        seat: matchParticipants.seat,
        participantId: matchParticipants.id,
        playerId: matchParticipantPlayers.playerId,
        position: matchParticipantPlayers.position,
      })
      .from(matchParticipants)
      .innerJoin(
        matchParticipantPlayers,
        and(
          eq(matchParticipantPlayers.participantId, matchParticipants.id),
          eq(matchParticipantPlayers.organizationId, organizationId),
        ),
      )
      .where(and(eq(matchParticipants.organizationId, organizationId), eq(matchParticipants.matchId, matchId)))
      .orderBy(asc(matchParticipants.seat), asc(matchParticipantPlayers.position));

    const bySeat = new Map<1 | 2, { participantId: string; playerIds: string[] }>();
    for (const row of rows) {
      if (row.seat !== 1 && row.seat !== 2) throw new Error("Match seat invariant violated.");
      const existing = bySeat.get(row.seat);
      if (existing === undefined) bySeat.set(row.seat, { participantId: row.participantId, playerIds: [row.playerId] });
      else existing.playerIds.push(row.playerId);
    }
    const first = bySeat.get(1);
    const second = bySeat.get(2);
    if (first === undefined || second === undefined) throw new Error("Match participant invariant violated.");
    return [
      { seat: 1, participantId: first.participantId, playerIds: first.playerIds },
      { seat: 2, participantId: second.participantId, playerIds: second.playerIds },
    ];
  }

  private aggregate(match: typeof matches.$inferSelect, loadedSides: readonly [LoadedSide, LoadedSide], payloads: readonly unknown[]): X01Match {
    const sides: readonly [X01Side, X01Side] = [
      { seat: loadedSides[0].seat, playerIds: loadedSides[0].playerIds },
      { seat: loadedSides[1].seat, playerIds: loadedSides[1].playerIds },
    ];
    const startingSeat = match.startingSeat === 2 ? 2 : 1;
    const base = createX01Match({
      sides, startingSeat,
      rules: {
        startingScore: match.startingScore,
        inRule: toInRule(match.inRule),
        outRule: toOutRule(match.outRule),
        maxRounds: match.maxRounds,
        legsToWinSet: match.legsToWinSet,
        setsToWin: match.setsToWin,
        legStartRule: toLegStartRule(match.legStartRule),
      },
    });
    const seatOfPlayer = (playerId: string): 1 | 2 => (sides[0].playerIds.includes(playerId) ? 1 : 2);
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
    await transaction.update(matches).set({ status: state.status, currentSeat: state.activeSeat, winnerSeat: state.winnerSeat, version, completedAt: state.status === "COMPLETED" ? new Date() : null, updatedAt: new Date() }).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId)));
    if (boardId !== null) await transaction.update(boards).set({ status: state.status === "COMPLETED" ? "AVAILABLE" : "IN_USE", updatedAt: new Date() }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, boardId)));
  }

  private async syncTournamentProgress(
    transaction: Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0],
    organizationId: string,
    scoringMatchId: string,
    winnerPlayerId: string,
    actor: { readonly principal: Principal; readonly audit: AuditContext },
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
    const loserPlayerId =
      scheduled.participantOneId === winnerPlayerId ? scheduled.participantTwoId : scheduled.participantOneId;
    const advancing = (kind: string | null): string | null => (kind === "LOSER" ? loserPlayerId : winnerPlayerId);
    for (const dependent of dependents) {
      const participantOneId =
        dependent.sourceOneMatchId === scheduled.id
          ? advancing(dependent.sourceOneKind)
          : dependent.participantOneId;
      const participantTwoId =
        dependent.sourceTwoMatchId === scheduled.id
          ? advancing(dependent.sourceTwoKind)
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
    await advanceClubDuel(transaction, { organizationId, tournamentId: scheduled.tournamentId, now, actor });
    await advanceDoubleElimination(transaction, { organizationId, tournamentId: scheduled.tournamentId, now, actor });
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

  /**
   * Duplikatpruefung fuer den Kommandostrom eines Matches. Sie laeuft an jeder
   * Aufrufstelle ZWEIMAL: einmal vor der Aggregatsperre (billig, deckt die
   * Wiederholung nach Sekunden ab) und einmal darunter. Ohne die zweite
   * Pruefung verfehlen zwei gleichzeitige Zustellungen desselben Kommandos die
   * Kommandozeile beide, und die zweite bekaeme nach dem Commit der ersten
   * einen Versionskonflikt statt der idempotenten Bestaetigung — genau der
   * Fall, fuer den die commandId da ist (AGENTS.md 11). Vorbild:
   * `encounters.repository.ts`, `runMutation`. Die zweite Pruefung verlaesst
   * sich auf READ COMMITTED (jede Anweisung sieht einen frischen Snapshot):
   * unter REPEATABLE READ saehe sie noch den Stand vor der Sperre und liefe
   * damit ins Leere.
   */
  private async findDuplicateScoreCommand(
    transaction: DatabaseTransaction,
    organizationId: string,
    matchId: string,
    commandId: string,
  ): Promise<"ok" | null> {
    const [duplicate] = await transaction
      .select({ organizationId: scoreCommands.organizationId, matchId: scoreCommands.matchId })
      .from(scoreCommands)
      .where(eq(scoreCommands.commandId, commandId))
      .limit(1);
    if (duplicate === undefined) return null;
    if (duplicate.organizationId === organizationId && duplicate.matchId === matchId) return "ok";
    throw new ScoringValidationError(
      "COMMAND_ID_ALREADY_USED",
      "The command ID has already been used for another match.",
    );
  }

  /**
   * Dasselbe fuer den Turnierkommandostrom, den `correctTournamentResult`
   * beschreibt. Getrennt vom Scoringstrom, weil Fehlertext und Tabelle andere
   * sind.
   */
  private async findDuplicateTournamentCommand(
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
    throw new ScoringValidationError(
      "COMMAND_ID_ALREADY_USED",
      "The command ID has already been used for another tournament.",
    );
  }
}
