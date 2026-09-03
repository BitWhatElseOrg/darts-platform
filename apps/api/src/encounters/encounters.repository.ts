import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { aliasedTable, and, asc, eq, gt, inArray, isNull, lte, notInArray, or } from "drizzle-orm";

import {
  auditEvents,
  boards,
  competitionSlots,
  competitions,
  encounterCommands,
  encounterLineupEntries,
  encounterNominations,
  encounterSlots,
  encounterSubstitutions,
  encounters,
  legs,
  matchParticipantPlayers,
  matchParticipants,
  matches,
  outboxEvents,
  players,
  teamPlayers,
  teams,
  tournamentMatches,
  visits,
} from "@darts-platform/database";
import { evaluateSlotReadiness } from "@darts-platform/scheduling-engine";
import {
  calculateEncounterResult,
  resolveSlotOccupancy,
  validateDoublesPairings,
  validateNominations,
  validateSubstitution,
  type NominationEntry,
  type Side,
  type SubstitutionRecord,
} from "@darts-platform/league-engine";
import type {
  AssignEncounterSlotInput,
  CancelEncounterInput,
  CreateEncounterInput,
  DeclareEncounterForfeitInput,
  DeclareSlotWalkoverInput,
  ReleaseEncounterSlotInput,
  StartEncounterInput,
  SubmitDoublesInput,
  SubmitNominationsInput,
  SubstitutePlayerInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";
import { abortScoringMatch } from "../matches/abort-match.js";
import { toResultInput, updateEncounterProgress } from "./update-encounter-progress.js";

export type EncounterMutationResult =
  | "ok"
  | "not-found"
  | "command-id-reused"
  | "version-conflict"
  | "encounter-closed"
  | "invalid-status"
  | "lineups-incomplete"
  | "slot-not-found"
  | "slot-not-ready"
  | "slot-running"
  | "board-unavailable"
  | "player-busy";

export type EncounterCreateResult =
  | { readonly status: "ok"; readonly encounterId: string }
  | { readonly status: "team-not-found" }
  | { readonly status: "competition-not-found" }
  | { readonly status: "template-empty" }
  | { readonly status: "team-already-scheduled" };

type EncounterRow = typeof encounters.$inferSelect;
type CompetitionRow = typeof competitions.$inferSelect;
type SlotRow = typeof encounterSlots.$inferSelect;
type SubstitutionRow = typeof encounterSubstitutions.$inferSelect;

export interface EncounterNominationRow {
  readonly side: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly position: number | null;
  readonly origin: string;
}

export interface EncounterSubstitutionRow extends SubstitutionRow {
  readonly outDisplayName: string;
  readonly inDisplayName: string;
}

export interface EncounterLineupRow {
  readonly slotId: string;
  readonly side: string;
  readonly position: number;
  readonly playerId: string;
  readonly displayName: string;
}

export interface EncounterData {
  readonly encounter: EncounterRow;
  readonly competition: CompetitionRow;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly slots: readonly (SlotRow & { readonly boardName: string | null })[];
  readonly nominations: readonly EncounterNominationRow[];
  readonly lineupEntries: readonly EncounterLineupRow[];
  readonly substitutions: readonly EncounterSubstitutionRow[];
}

interface ActorInput {
  readonly organizationId: string;
  readonly encounterId: string;
  readonly auth: AuthContext;
  readonly audit: AuditContext;
}

type DatabaseTransaction = Parameters<
  Parameters<DatabaseService["database"]["transaction"]>[0]
>[0];

function toNominationEntry(row: {
  readonly playerId: string;
  readonly position: number | null;
  readonly origin: string;
}): NominationEntry {
  return {
    playerId: row.playerId,
    position: row.position,
    origin: row.origin === "GUEST" ? "GUEST" : "SQUAD",
  };
}

function toSubstitutionRecord(row: SubstitutionRow): SubstitutionRecord {
  return {
    side: row.side === "AWAY" ? "AWAY" : "HOME",
    position: row.position,
    outPlayerId: row.outPlayerId,
    inPlayerId: row.inPlayerId,
    effectiveFromSequence: row.effectiveFromSequence,
  };
}

/**
 * Ein abgeleitetes Kommando trägt eine aus dem Elternkommando gebildete id.
 * Dieselbe Rücknahme erzeugt damit denselben Abbruch, auch bei Wiederholung.
 */
function derivedCommandId(parentCommandId: string, aggregateId: string): string {
  const hex = createHash("sha256").update(`${parentCommandId}:${aggregateId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/**
 * Die gespeicherte Nutzlast kommt als `jsonb` zurück: Postgres normalisiert
 * dabei die Schlüsselreihenfolge, die Wiederholung des Clients tut das nicht.
 * Verglichen wird deshalb über eine kanonische Form, nicht über
 * `JSON.stringify` der beiden Seiten.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function isSameCommandPayload(stored: unknown, incoming: unknown): boolean {
  return JSON.stringify(canonicalize(stored)) === JSON.stringify(canonicalize(incoming));
}

function walkoverLegs(slot: SlotRow): number {
  return slot.legsToWinSet * slot.setsToWin;
}

@Injectable()
export class EncountersRepository {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  public async listByCompetition(input: {
    readonly organizationId: string;
    readonly competitionId: string;
  }): Promise<(EncounterRow & { readonly homeTeamName: string; readonly awayTeamName: string })[]> {
    const homeTeams = aliasedTable(teams, "home_teams");
    const awayTeams = aliasedTable(teams, "away_teams");
    const rows = await this.databaseService.database
      .select({ encounter: encounters, homeTeamName: homeTeams.name, awayTeamName: awayTeams.name })
      .from(encounters)
      .innerJoin(homeTeams, eq(homeTeams.id, encounters.homeTeamId))
      .innerJoin(awayTeams, eq(awayTeams.id, encounters.awayTeamId))
      .where(
        and(
          eq(encounters.organizationId, input.organizationId),
          eq(encounters.competitionId, input.competitionId),
        ),
      )
      .orderBy(asc(encounters.matchday), asc(encounters.scheduledAt));
    return rows.map((row) => ({
      ...row.encounter,
      homeTeamName: row.homeTeamName,
      awayTeamName: row.awayTeamName,
    }));
  }

  public getData(input: {
    readonly organizationId: string;
    readonly encounterId: string;
  }): Promise<EncounterData | null> {
    return this.loadData(eq(encounters.id, input.encounterId), input.organizationId);
  }

  public getPublicData(publicId: string): Promise<EncounterData | null> {
    return this.loadData(eq(encounters.publicId, publicId), null);
  }

  public schedule(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly data: CreateEncounterInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<EncounterCreateResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [competition] = await transaction
        .select()
        .from(competitions)
        .where(
          and(
            eq(competitions.organizationId, input.organizationId),
            eq(competitions.id, input.competitionId),
          ),
        )
        .for("update")
        .limit(1);
      if (competition === undefined) return { status: "competition-not-found" };
      const teamRows = await transaction
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(
            eq(teams.organizationId, input.organizationId),
            inArray(teams.id, [input.data.homeTeamId, input.data.awayTeamId]),
          ),
        );
      if (teamRows.length !== 2) return { status: "team-not-found" };
      const template = await transaction
        .select()
        .from(competitionSlots)
        .where(
          and(
            eq(competitionSlots.organizationId, input.organizationId),
            eq(competitionSlots.competitionId, input.competitionId),
          ),
        )
        .orderBy(asc(competitionSlots.sequence));
      if (template.length === 0) return { status: "template-empty" };

      // Eine Mannschaft spielt an einem Spieltag eine Begegnung. Die beiden
      // Unique-Indexe fassen je eine Rolle und lassen deshalb `A gegen B`
      // neben `C gegen A` zu — dieselbe Mannschaft zweimal am selben Abend.
      // Die Sperre auf der Wettbewerbszeile serialisiert die Ansetzungen
      // dieses Wettbewerbs, damit die Pruefung nicht an zwei gleichzeitigen
      // Einfuegungen vorbeilaeuft.
      const teamIds = [input.data.homeTeamId, input.data.awayTeamId];
      const [clash] = await transaction
        .select({ id: encounters.id })
        .from(encounters)
        .where(
          and(
            eq(encounters.organizationId, input.organizationId),
            eq(encounters.competitionId, input.competitionId),
            eq(encounters.matchday, input.data.matchday),
            or(
              inArray(encounters.homeTeamId, teamIds),
              inArray(encounters.awayTeamId, teamIds),
            ),
          ),
        )
        .limit(1);
      if (clash !== undefined) return { status: "team-already-scheduled" };

      const [created] = await transaction
        .insert(encounters)
        .values({
          organizationId: input.organizationId,
          competitionId: input.competitionId,
          matchday: input.data.matchday,
          homeTeamId: input.data.homeTeamId,
          awayTeamId: input.data.awayTeamId,
          scheduledAt: input.data.scheduledAt,
          venue: input.data.venue,
          status: "DRAFT",
        })
        .returning();
      if (created === undefined) throw new Error("Encounter insert did not return a row.");

      // Die Slots sind eine Kopie der Vorlage zum Ansetzungszeitpunkt: eine
      // spätere Änderung der Vorlage lässt angesetzte Begegnungen unberührt.
      await transaction.insert(encounterSlots).values(
        template.map((slot) => ({
          organizationId: input.organizationId,
          encounterId: created.id,
          sequence: slot.sequence,
          role: slot.role,
          discipline: slot.discipline,
          label: slot.label,
          homePosition: slot.homePosition,
          awayPosition: slot.awayPosition,
          startingScore: slot.startingScore,
          inRule: slot.inRule,
          outRule: slot.outRule,
          maxRounds: slot.maxRounds,
          bestOfLegs: slot.bestOfLegs,
          legsToWinSet: slot.legsToWinSet,
          setsToWin: slot.setsToWin,
          status: "WAITING",
        })),
      );
      await transaction
        .update(encounters)
        .set({ status: "LINEUPS_OPEN", updatedAt: new Date() })
        .where(
          and(eq(encounters.organizationId, input.organizationId), eq(encounters.id, created.id)),
        );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "ENCOUNTER_SCHEDULED",
        entityType: "Encounter",
        entityId: created.id,
        newValue: created,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return { status: "ok", encounterId: created.id };
    });
  }

  public submitNominations(
    input: ActorInput & { readonly data: SubmitNominationsInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "SUBMIT_NOMINATIONS", async (context) => {
      const { transaction, encounter, competition } = context;
      if (encounter.status !== "LINEUPS_OPEN" && encounter.status !== "READY") {
        return "invalid-status";
      }
      const side: Side = input.data.side;
      const teamId = side === "HOME" ? encounter.homeTeamId : encounter.awayTeamId;
      const squad = await this.loadSquad(
        transaction,
        input.organizationId,
        teamId,
        encounter.scheduledAt,
      );
      validateNominations({
        side,
        nominations: input.data.nominations.map(toNominationEntry),
        squadPlayerIds: squad,
        rules: {
          lineupPositions: competition.lineupPositions,
          minNominations: competition.minNominations,
          minNominationsShorthanded: competition.minNominationsShorthanded,
        },
      });
      const known = await transaction
        .select({ id: players.id })
        .from(players)
        .where(
          and(
            eq(players.organizationId, input.organizationId),
            inArray(
              players.id,
              input.data.nominations.map((entry) => entry.playerId),
            ),
          ),
        );
      if (known.length !== new Set(input.data.nominations.map((e) => e.playerId)).size) {
        return "not-found";
      }

      await transaction
        .delete(encounterNominations)
        .where(
          and(
            eq(encounterNominations.organizationId, input.organizationId),
            eq(encounterNominations.encounterId, input.encounterId),
            eq(encounterNominations.side, side),
          ),
        );
      await transaction.insert(encounterNominations).values(
        input.data.nominations.map((entry) => ({
          organizationId: input.organizationId,
          encounterId: input.encounterId,
          side,
          playerId: entry.playerId,
          position: entry.position,
          origin: entry.origin,
        })),
      );

      await this.dropStalePairings(
        transaction,
        input.organizationId,
        input.encounterId,
        side,
        input.data.nominations.map((entry) => entry.playerId),
      );

      const otherSide: Side = side === "HOME" ? "AWAY" : "HOME";
      const [opponent] = await transaction
        .select({ playerId: encounterNominations.playerId })
        .from(encounterNominations)
        .where(
          and(
            eq(encounterNominations.organizationId, input.organizationId),
            eq(encounterNominations.encounterId, input.encounterId),
            eq(encounterNominations.side, otherSide),
          ),
        )
        .limit(1);
      context.statusAfter = opponent === undefined ? "LINEUPS_OPEN" : "READY";
      return "ok";
    });
  }

  public submitDoubles(
    input: ActorInput & { readonly data: SubmitDoublesInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "SUBMIT_DOUBLES", async (context) => {
      const { transaction, encounter, competition } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      const side: Side = input.data.side;
      const slots = await this.loadSlots(transaction, input.organizationId, input.encounterId, true);
      const bySequence = new Map(slots.map((slot) => [slot.sequence, slot]));
      const targeted = input.data.pairings.map((pairing) => bySequence.get(pairing.sequence));
      if (targeted.some((slot) => slot === undefined)) return "slot-not-found";
      const doublesSlots = targeted.filter((slot): slot is SlotRow => slot !== undefined);
      if (doublesSlots.some((slot) => slot.discipline !== "DOUBLES")) return "slot-not-found";
      if (doublesSlots.some((slot) => slot.status !== "WAITING")) return "slot-running";

      const nominations = await this.loadNominations(
        transaction,
        input.organizationId,
        input.encounterId,
        side,
      );
      const otherPairings = await this.loadDoublesPairings(
        transaction,
        input.organizationId,
        input.encounterId,
        side,
      );
      const replaced = new Set(doublesSlots.map((slot) => slot.id));
      const pairings = [
        ...otherPairings
          .filter((pairing) => !replaced.has(pairing.slotId))
          .map((pairing) => ({
            slotSequence: pairing.sequence,
            role: pairing.role === "DECIDER" ? ("DECIDER" as const) : ("REGULAR" as const),
            playerIds: pairing.playerIds,
          })),
        ...input.data.pairings.map((pairing) => {
          const slot = bySequence.get(pairing.sequence);
          return {
            slotSequence: pairing.sequence,
            role: slot?.role === "DECIDER" ? ("DECIDER" as const) : ("REGULAR" as const),
            playerIds: pairing.playerIds,
          };
        }),
      ];
      validateDoublesPairings({
        side,
        pairings,
        nominatedPlayerIds: nominations.map((entry) => entry.playerId),
        maxDoublesPerPlayer: competition.maxDoublesPerPlayer,
      });

      await transaction.delete(encounterLineupEntries).where(
        and(
          eq(encounterLineupEntries.organizationId, input.organizationId),
          eq(encounterLineupEntries.encounterId, input.encounterId),
          eq(encounterLineupEntries.side, side),
          inArray(encounterLineupEntries.slotId, [...replaced]),
        ),
      );
      await transaction.insert(encounterLineupEntries).values(
        input.data.pairings.flatMap((pairing) => {
          const slot = bySequence.get(pairing.sequence);
          if (slot === undefined) throw new Error("Doubles slot invariant violated.");
          return pairing.playerIds.map((playerId, index) => ({
            organizationId: input.organizationId,
            encounterId: input.encounterId,
            slotId: slot.id,
            side,
            position: index + 1,
            playerId,
          }));
        }),
      );
      return "ok";
    });
  }

  public substitute(
    input: ActorInput & { readonly data: SubstitutePlayerInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "SUBSTITUTE_PLAYER", async (context) => {
      const { transaction, encounter, competition } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      const side: Side = input.data.side;
      const [nominations, substitutions, slots] = await Promise.all([
        this.loadNominations(transaction, input.organizationId, input.encounterId, side),
        this.loadSubstitutions(transaction, input.organizationId, input.encounterId),
        this.loadSlots(transaction, input.organizationId, input.encounterId, false),
      ]);
      const startedSequences = slots
        .filter((slot) => slot.status !== "WAITING" && slot.status !== "READY")
        .map((slot) => slot.sequence);
      validateSubstitution({
        substitution: {
          side,
          position: input.data.position,
          outPlayerId: input.data.outPlayerId,
          inPlayerId: input.data.inPlayerId,
          effectiveFromSequence: input.data.effectiveFromSequence,
        },
        nominations: nominations.map(toNominationEntry),
        existingSubstitutions: substitutions.map(toSubstitutionRecord),
        startedSlotSequences: startedSequences,
        lineupPositions: competition.lineupPositions,
        maxSubstitutionsPerEncounter: competition.maxSubstitutionsPerEncounter,
      });
      await transaction.insert(encounterSubstitutions).values({
        organizationId: input.organizationId,
        encounterId: input.encounterId,
        side,
        position: input.data.position,
        outPlayerId: input.data.outPlayerId,
        inPlayerId: input.data.inPlayerId,
        effectiveFromSequence: input.data.effectiveFromSequence,
        reason: input.data.reason,
      });
      return "ok";
    });
  }

  /**
   * Beim Start entstehen keine Matches. Die Besetzung der Einzel steht fest,
   * die Doppel folgen am Abend; eine Zeile in `matches` bedeutet „läuft".
   *
   * Meldet eine Seite weniger als alle Aufstellungspositionen (Reglement
   * 2.2.5), gehen die Einzel der fehlenden Position und eines der beiden
   * regulären Doppel sofort kampflos an die Gegenseite.
   */
  public start(
    input: ActorInput & { readonly data: StartEncounterInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "START_ENCOUNTER", async (context) => {
      const { transaction, encounter, competition, now } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      if (encounter.status !== "READY") return "invalid-status";

      const [nominations, slots] = await Promise.all([
        this.loadNominations(transaction, input.organizationId, input.encounterId),
        this.loadSlots(transaction, input.organizationId, input.encounterId, true),
      ]);
      const positions = new Map<Side, Set<number>>([
        ["HOME", new Set()],
        ["AWAY", new Set()],
      ]);
      for (const entry of nominations) {
        if (entry.position === null) continue;
        positions.get(entry.side === "AWAY" ? "AWAY" : "HOME")?.add(entry.position);
      }
      for (const side of ["HOME", "AWAY"] as const) {
        const covered = positions.get(side)?.size ?? 0;
        if (covered < competition.minNominationsShorthanded) return "lineups-incomplete";
      }

      const walkovers: { readonly slot: SlotRow; readonly winner: Side | null }[] = [];
      for (const slot of slots) {
        if (slot.discipline !== "SINGLES") continue;
        const homeOk =
          slot.homePosition !== null && (positions.get("HOME")?.has(slot.homePosition) ?? false);
        const awayOk =
          slot.awayPosition !== null && (positions.get("AWAY")?.has(slot.awayPosition) ?? false);
        if (homeOk && awayOk) continue;
        walkovers.push({ slot, winner: homeOk ? "HOME" : awayOk ? "AWAY" : null });
      }

      // Je unvollständiger Seite verfällt zusätzlich ein reguläres Doppel.
      const openDoubles = slots
        .filter((slot) => slot.discipline === "DOUBLES" && slot.role === "REGULAR")
        .sort((first, second) => first.sequence - second.sequence);
      let nextDouble = 0;
      for (const side of ["HOME", "AWAY"] as const) {
        const covered = positions.get(side)?.size ?? 0;
        if (covered >= competition.lineupPositions) continue;
        const slot = openDoubles[nextDouble];
        if (slot === undefined) continue;
        nextDouble += 1;
        walkovers.push({ slot, winner: side === "HOME" ? "AWAY" : "HOME" });
      }

      for (const { slot, winner } of walkovers) {
        const legsForWinner = walkoverLegs(slot);
        await transaction
          .update(encounterSlots)
          .set(
            winner === null
              ? { status: "CANCELLED", version: slot.version + 1, updatedAt: now }
              : {
                  status: "WALKOVER",
                  resultType: "WALKOVER",
                  winnerSide: winner,
                  homeLegs: winner === "HOME" ? legsForWinner : 0,
                  awayLegs: winner === "AWAY" ? legsForWinner : 0,
                  completedAt: now,
                  version: slot.version + 1,
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(encounterSlots.organizationId, input.organizationId),
              eq(encounterSlots.id, slot.id),
            ),
          );
      }

      context.statusAfter = "RUNNING";
      context.outbox = {
        eventType: "ENCOUNTER_STARTED",
        payload: {
          encounterId: input.encounterId,
          competitionId: encounter.competitionId,
          walkoverSlotIds: walkovers.map((entry) => entry.slot.id),
        },
      };
      context.progress = true;
      return "ok";
    });
  }

  public assignSlot(
    input: ActorInput & { readonly slotId: string; readonly data: AssignEncounterSlotInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "ASSIGN_SLOT", async (context) => {
      const { transaction, encounter, now } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      const [slot] = await transaction
        .select()
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            eq(encounterSlots.id, input.slotId),
          ),
        )
        .for("update")
        .limit(1);
      if (slot === undefined) return "slot-not-found";

      const [board] = await transaction
        .select()
        .from(boards)
        .where(
          and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId)),
        )
        .for("update")
        .limit(1);
      if (board === undefined) return "not-found";

      // Kein Constraint greift über zwei Tabellen; beide Quellen zählen.
      const [tournamentUse] = await transaction
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.organizationId, input.organizationId),
            eq(tournamentMatches.boardId, input.data.boardId),
            eq(tournamentMatches.status, "IN_PROGRESS"),
          ),
        )
        .limit(1);
      const [encounterUse] = await transaction
        .select({ id: encounterSlots.id })
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.boardId, input.data.boardId),
            eq(encounterSlots.status, "IN_PROGRESS"),
          ),
        )
        .limit(1);
      if (board.status !== "AVAILABLE" || tournamentUse !== undefined || encounterUse !== undefined) {
        return "board-unavailable";
      }

      const occupancy = await this.resolveOccupancy(
        transaction,
        input.organizationId,
        input.encounterId,
        slot,
      );
      // Die Sperre auf der Begegnungszeile serialisiert nur diese Begegnung.
      // Eine Person kann aber in zwei Begegnungen desselben Vereins gemeldet
      // sein; ohne Sperre saehen zwei gleichzeitige Zuweisungen sie beide als
      // frei und stellten sie an zwei Scheiben. Gesperrt wird deshalb ueber
      // die beteiligten Personen, und zwar in fester Reihenfolge, damit sich
      // zwei Zuweisungen nicht gegenseitig blockieren.
      await this.lockPlayers(transaction, input.organizationId, [
        ...occupancy.home.playerIds,
        ...occupancy.away.playerIds,
      ]);
      const activePlayerIds = await this.loadActivePlayerIds(transaction, input.organizationId);
      const decision = evaluateSlotReadiness({
        sidePlayerIds: [occupancy.home.playerIds, occupancy.away.playerIds],
        requiredPlayersPerSide: slot.discipline === "DOUBLES" ? 2 : 1,
        activePlayerIds,
        boardAvailable: true,
        slotStatus: slot.status as "WAITING",
        encounterStatus: encounter.status as "RUNNING",
      });
      if (!decision.ready) {
        if (decision.code !== "BLOCKED_PLAYER_BUSY") return "slot-not-ready";
        return slot.status === "IN_PROGRESS" ? "slot-running" : "player-busy";
      }

      const [scoringMatch] = await transaction
        .insert(matches)
        .values({
          organizationId: input.organizationId,
          boardId: input.data.boardId,
          startingScore: slot.startingScore,
          inRule: slot.inRule,
          outRule: slot.outRule,
          maxRounds: slot.maxRounds,
          bestOfLegs: slot.bestOfLegs,
          legsToWinSet: slot.legsToWinSet,
          setsToWin: slot.setsToWin,
          startingSeat: 1,
          currentSeat: 1,
        })
        .returning();
      if (scoringMatch === undefined) throw new Error("Scoring match insert did not return a row.");
      const participants = await transaction
        .insert(matchParticipants)
        .values([
          { organizationId: input.organizationId, matchId: scoringMatch.id, seat: 1 },
          { organizationId: input.organizationId, matchId: scoringMatch.id, seat: 2 },
        ])
        .returning();
      // Sitz 1 ist stets die Heimseite, Sitz 2 die Gastseite.
      const playersOfSeat = new Map<number, readonly string[]>([
        [1, occupancy.home.playerIds],
        [2, occupancy.away.playerIds],
      ]);
      await transaction.insert(matchParticipantPlayers).values(
        participants.flatMap((participant) => {
          const playerIds = playersOfSeat.get(participant.seat) ?? [];
          return playerIds.map((playerId, index) => ({
            organizationId: input.organizationId,
            matchId: scoringMatch.id,
            participantId: participant.id,
            playerId,
            position: index + 1,
          }));
        }),
      );
      await transaction.insert(legs).values({
        organizationId: input.organizationId,
        matchId: scoringMatch.id,
        legNumber: 1,
        startingSeat: 1,
      });
      await transaction
        .update(boards)
        .set({ status: "IN_USE", updatedAt: now })
        .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, board.id)));
      await transaction
        .update(encounterSlots)
        .set({
          status: "IN_PROGRESS",
          boardId: board.id,
          matchId: scoringMatch.id,
          version: slot.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.id, slot.id),
          ),
        );

      context.outbox = {
        eventType: "ENCOUNTER_SLOT_ASSIGNED",
        payload: {
          encounterId: input.encounterId,
          slotId: slot.id,
          sequence: slot.sequence,
          boardId: board.id,
          matchId: scoringMatch.id,
        },
      };
      return "ok";
    });
  }

  public releaseSlot(
    input: ActorInput & { readonly slotId: string; readonly data: ReleaseEncounterSlotInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "RELEASE_BOARD", async (context) => {
      const { transaction, now } = context;
      const [slot] = await transaction
        .select()
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            eq(encounterSlots.id, input.slotId),
          ),
        )
        .for("update")
        .limit(1);
      if (slot === undefined) return "slot-not-found";
      if (slot.status !== "IN_PROGRESS") return "slot-not-ready";
      if (slot.matchId !== null) {
        const [scoringMatch] = await transaction
          .select()
          .from(matches)
          .where(
            and(
              eq(matches.organizationId, input.organizationId),
              eq(matches.id, slot.matchId),
            ),
          )
          .for("update")
          .limit(1);
        if (scoringMatch !== undefined && scoringMatch.status === "IN_PROGRESS") {
          const [thrown] = await transaction
            .select({ id: visits.id })
            .from(visits)
            .where(
              and(
                eq(visits.organizationId, input.organizationId),
                eq(visits.matchId, slot.matchId),
              ),
            )
            .limit(1);
          // Sobald geworfen wurde, ist `match:abort` der Weg, nicht die
          // Rücknahme einer Board-Zuweisung.
          if (thrown !== undefined) return "slot-running";
          await abortScoringMatch(transaction, {
            organizationId: input.organizationId,
            match: scoringMatch,
            commandId: derivedCommandId(input.data.commandId, slot.id),
            tournamentMatchId: null,
            reason: "Board-Zuweisung zurückgenommen.",
            source: "ENCOUNTER_BOARD_RELEASE",
          });
        }
      }
      await this.freeBoard(transaction, input.organizationId, slot.boardId, now);
      context.outbox = {
        eventType: "ENCOUNTER_SLOT_REOPENED",
        payload: {
          encounterId: input.encounterId,
          slotId: slot.id,
          sequence: slot.sequence,
          boardId: slot.boardId,
        },
      };
      await transaction
        .update(encounterSlots)
        .set({
          status: "WAITING",
          boardId: null,
          matchId: null,
          version: slot.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.id, slot.id),
          ),
        );
      return "ok";
    });
  }

  public declareSlotWalkover(
    input: ActorInput & { readonly slotId: string; readonly data: DeclareSlotWalkoverInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "DECLARE_WALKOVER", async (context) => {
      const { transaction, encounter, now } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      const [slot] = await transaction
        .select()
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            eq(encounterSlots.id, input.slotId),
          ),
        )
        .for("update")
        .limit(1);
      if (slot === undefined) return "slot-not-found";
      if (slot.matchId !== null || slot.status === "IN_PROGRESS") return "slot-running";
      if (slot.status !== "WAITING" && slot.status !== "READY") return "slot-not-ready";
      const legsForWinner = walkoverLegs(slot);
      await this.freeBoard(transaction, input.organizationId, slot.boardId, now);
      await transaction
        .update(encounterSlots)
        .set({
          status: "WALKOVER",
          resultType: "WALKOVER",
          winnerSide: input.data.winnerSide,
          homeLegs: input.data.winnerSide === "HOME" ? legsForWinner : 0,
          awayLegs: input.data.winnerSide === "AWAY" ? legsForWinner : 0,
          boardId: null,
          completedAt: now,
          version: slot.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.id, slot.id),
          ),
        );
      context.outbox = {
        eventType: "ENCOUNTER_SLOT_COMPLETED",
        payload: {
          encounterId: input.encounterId,
          slotId: slot.id,
          sequence: slot.sequence,
          winnerSide: input.data.winnerSide,
          resultType: "WALKOVER",
          reason: input.data.reason,
        },
      };
      context.progress = true;
      return "ok";
    });
  }

  /**
   * Der Nichtantritt einer ganzen Mannschaft (Reglement 2.1.1, 2.5.1) ist ein
   * einziger auditierter Vorgang, kein Stapel von achtzehn Einzelwalkovers.
   */
  public declareForfeit(
    input: ActorInput & { readonly data: DeclareEncounterForfeitInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "DECLARE_ENCOUNTER_FORFEIT", async (context) => {
      const { transaction, encounter, competition, now } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      const slots = await this.loadSlots(transaction, input.organizationId, input.encounterId, true);
      if (slots.some((slot) => slot.matchId !== null && slot.status === "IN_PROGRESS")) {
        return "slot-running";
      }
      // Nur Slots, die das Board gerade halten. Jeder Übergang aus
      // IN_PROGRESS setzt `boardId` in derselben Anweisung auf null, die
      // Schleife soll sich darauf aber nicht verlassen: behielte ein Slot je
      // seine historische Zuweisung, gäbe sie ein inzwischen weitervergebenes
      // Board frei.
      for (const slot of slots.filter((candidate) => candidate.status === "IN_PROGRESS")) {
        await this.freeBoard(transaction, input.organizationId, slot.boardId, now);
      }
      // Gespielte und kampflos gewertete Slots behalten ihren Ausgang: der
      // Check-Constraint bindet Status und `resultType` aneinander, und ein
      // Ergebnis, das auf der Scheibe zustande kam, gehört ins Protokoll.
      await transaction
        .update(encounterSlots)
        .set({ status: "CANCELLED", boardId: null, updatedAt: now })
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            notInArray(encounterSlots.status, ["COMPLETED", "WALKOVER"]),
          ),
        );
      const result = calculateForfeit(competition, slots, input.data.forfeitSide);
      await transaction
        .update(encounters)
        .set({
          homeGames: result.homeGames,
          awayGames: result.awayGames,
          homeLegs: result.homeLegs,
          awayLegs: result.awayLegs,
          homePoints: result.homePoints,
          awayPoints: result.awayPoints,
          result: result.result,
          resultType: result.resultType,
          // Status und Ergebnis müssen in einer Anweisung fallen: der
          // Check-Constraint bindet beide aneinander.
          status: "COMPLETED",
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(encounters.organizationId, input.organizationId),
            eq(encounters.id, input.encounterId),
          ),
        );
      context.statusAfter = "COMPLETED";
      context.outbox = {
        eventType: "ENCOUNTER_COMPLETED",
        payload: {
          encounterId: input.encounterId,
          result: result.result,
          resultType: result.resultType,
          homePoints: result.homePoints,
          awayPoints: result.awayPoints,
          homeGames: result.homeGames,
          awayGames: result.awayGames,
          homeLegs: result.homeLegs,
          awayLegs: result.awayLegs,
          forfeitSide: input.data.forfeitSide,
          reason: input.data.reason,
        },
      };
      return "ok";
    });
  }

  public cancel(
    input: ActorInput & { readonly data: CancelEncounterInput },
  ): Promise<EncounterMutationResult> {
    return this.mutate(input, input.data, "CANCEL_ENCOUNTER", async (context) => {
      const { transaction, encounter, now } = context;
      if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
        return "encounter-closed";
      }
      const slots = await this.loadSlots(transaction, input.organizationId, input.encounterId, true);
      if (slots.some((slot) => slot.status === "IN_PROGRESS")) return "slot-running";
      // Nur Slots, die das Board gerade halten. Jeder Übergang aus
      // IN_PROGRESS setzt `boardId` in derselben Anweisung auf null, die
      // Schleife soll sich darauf aber nicht verlassen: behielte ein Slot je
      // seine historische Zuweisung, gäbe sie ein inzwischen weitervergebenes
      // Board frei.
      for (const slot of slots.filter((candidate) => candidate.status === "IN_PROGRESS")) {
        await this.freeBoard(transaction, input.organizationId, slot.boardId, now);
      }
      await transaction
        .update(encounterSlots)
        .set({ status: "CANCELLED", boardId: null, updatedAt: now })
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            eq(encounterSlots.encounterId, input.encounterId),
            notInArray(encounterSlots.status, ["COMPLETED", "WALKOVER"]),
          ),
        );
      context.statusAfter = "CANCELLED";
      return "ok";
    });
  }

  private async mutate(
    input: ActorInput & { readonly slotId?: string },
    data: { readonly commandId: string; readonly expectedVersion: number },
    type: string,
    body: (context: MutationContext) => Promise<EncounterMutationResult>,
  ): Promise<EncounterMutationResult> {
    // Der Rumpf eines slotbezogenen Kommandos traegt den Slot nicht: er steht
    // neben `data` im Aufruf. Ohne ihn saehen zwei Zuweisungen an zwei Slots
    // mit gleichem Rumpf wie dasselbe Kommando aus. Gespeichert und verglichen
    // wird deshalb die Nutzlast samt Slot.
    const payload =
      input.slotId === undefined ? data : { ...data, slotId: input.slotId };
    return this.databaseService.database.transaction(async (transaction) => {
      const seen = await this.findDuplicateCommand(transaction, input, payload, type);
      if (seen !== null) return seen;
      const [encounter] = await transaction
        .select()
        .from(encounters)
        .where(
          and(
            eq(encounters.organizationId, input.organizationId),
            eq(encounters.id, input.encounterId),
          ),
        )
        .for("update")
        .limit(1);
      // Zweite Pruefung, jetzt unter der Sperre: die erste lief davor, und
      // zwei gleichzeitige Zustellungen desselben Kommandos verfehlen die
      // Kommandozeile beide. Ohne diese Wiederholung bekaeme die zweite einen
      // Versionskonflikt statt der idempotenten Bestaetigung — genau in dem
      // Fall, fuer den die commandId da ist.
      const seenUnderLock = await this.findDuplicateCommand(transaction, input, payload, type);
      if (seenUnderLock !== null) return seenUnderLock;
      if (encounter === undefined) return "not-found";
      if (encounter.version !== data.expectedVersion) return "version-conflict";
      const [competition] = await transaction
        .select()
        .from(competitions)
        .where(
          and(
            eq(competitions.organizationId, input.organizationId),
            eq(competitions.id, encounter.competitionId),
          ),
        )
        .limit(1);
      if (competition === undefined) return "not-found";

      const now = new Date();
      const context: MutationContext = {
        transaction,
        encounter,
        competition,
        now,
        statusAfter: null,
        outbox: null,
        progress: false,
      };
      const result = await body(context);
      if (result !== "ok") return result;

      const nextVersion = encounter.version + 1;
      await transaction
        .update(encounters)
        .set({
          version: nextVersion,
          ...(context.statusAfter === null ? {} : { status: context.statusAfter }),
          updatedAt: now,
        })
        .where(
          and(
            eq(encounters.organizationId, input.organizationId),
            eq(encounters.id, input.encounterId),
          ),
        );
      await transaction.insert(encounterCommands).values({
        commandId: data.commandId,
        organizationId: input.organizationId,
        encounterId: input.encounterId,
        type,
        payload,
        resultingVersion: nextVersion,
      });
      if (context.outbox !== null) {
        await transaction.insert(outboxEvents).values({
          organizationId: input.organizationId,
          aggregateType: "Encounter",
          aggregateId: input.encounterId,
          eventType: context.outbox.eventType,
          payload: { ...context.outbox.payload, version: nextVersion },
        });
      }
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: type,
        entityType: "Encounter",
        entityId: input.encounterId,
        oldValue: encounter,
        newValue: data,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      if (context.progress) {
        await updateEncounterProgress(transaction, input.organizationId, input.encounterId, now);
      }
      return "ok";
    });
  }

  /**
   * Eine Doppelpaarung darf nur gemeldete Personen tragen — `submitDoubles`
   * setzt das durch. Wird die Meldung danach ersetzt, muss dieselbe Regel auf
   * dem zweiten Schreibweg gelten: fällt eine gepaarte Person aus der Meldung,
   * verliert ihre Paarung die Grundlage. Gelöscht wird die ganze Paarung, nicht
   * nur die eine Zeile — ein halbes Doppel wäre schlechter als keines. Der Slot
   * bleibt damit ohne Besetzung und ist nicht zuweisbar, bis die Begegnungs-
   * leitung neu paart; der Ausfall ist sichtbar statt still.
   */
  /**
   * Sperrt die Personenzeilen einer Zuweisung. Die Reihenfolge ist sortiert:
   * zwei Zuweisungen mit ueberlappender Besetzung greifen damit in derselben
   * Reihenfolge zu und laufen nacheinander statt in einen Deadlock. Die
   * zweite sieht nach dem Commit der ersten deren laufendes Match und faellt
   * mit `player-busy` durch.
   */
  /**
   * Liefert die Antwort auf eine bereits vergebene `commandId`: `ok` fuer die
   * Wiederholung desselben Kommandos, `command-id-reused`, wenn Typ, Umfang
   * oder Nutzlast abweichen. Eine andere Mutation still als `ok` zu
   * quittieren hiesse, dem Aufrufer einen Vorgang zu bestaetigen, der nie
   * stattgefunden hat.
   */
  private async findDuplicateCommand(
    transaction: DatabaseTransaction,
    input: ActorInput,
    payload: { readonly commandId: string },
    type: string,
  ): Promise<EncounterMutationResult | null> {
    const [duplicate] = await transaction
      .select({
        organizationId: encounterCommands.organizationId,
        encounterId: encounterCommands.encounterId,
        type: encounterCommands.type,
        payload: encounterCommands.payload,
      })
      .from(encounterCommands)
      .where(eq(encounterCommands.commandId, payload.commandId))
      .limit(1);
    if (duplicate === undefined) return null;
    return duplicate.organizationId === input.organizationId &&
      duplicate.encounterId === input.encounterId &&
      duplicate.type === type &&
      isSameCommandPayload(duplicate.payload, payload)
      ? "ok"
      : "command-id-reused";
  }

  private async lockPlayers(
    transaction: DatabaseTransaction,
    organizationId: string,
    playerIds: readonly string[],
  ): Promise<void> {
    const ids = [...new Set(playerIds)].sort();
    if (ids.length === 0) return;
    await transaction
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.organizationId, organizationId), inArray(players.id, ids)))
      .orderBy(asc(players.id))
      .for("update");
  }

  private async dropStalePairings(
    transaction: DatabaseTransaction,
    organizationId: string,
    encounterId: string,
    side: Side,
    nominatedPlayerIds: readonly string[],
  ): Promise<void> {
    const stale = await transaction
      .select({ slotId: encounterLineupEntries.slotId })
      .from(encounterLineupEntries)
      .where(
        and(
          eq(encounterLineupEntries.organizationId, organizationId),
          eq(encounterLineupEntries.encounterId, encounterId),
          eq(encounterLineupEntries.side, side),
          notInArray(encounterLineupEntries.playerId, [...nominatedPlayerIds]),
        ),
      );
    const slotIds = [...new Set(stale.map((row) => row.slotId))];
    if (slotIds.length === 0) return;
    await transaction.delete(encounterLineupEntries).where(
      and(
        eq(encounterLineupEntries.organizationId, organizationId),
        eq(encounterLineupEntries.encounterId, encounterId),
        eq(encounterLineupEntries.side, side),
        inArray(encounterLineupEntries.slotId, slotIds),
      ),
    );
  }

  private async freeBoard(
    transaction: DatabaseTransaction,
    organizationId: string,
    boardId: string | null,
    now: Date,
  ): Promise<void> {
    if (boardId === null) return;
    await transaction
      .update(boards)
      .set({ status: "AVAILABLE", updatedAt: now })
      .where(and(eq(boards.organizationId, organizationId), eq(boards.id, boardId)));
  }

  private async loadSquad(
    transaction: DatabaseTransaction,
    organizationId: string,
    teamId: string,
    at: Date,
  ): Promise<string[]> {
    const rows = await transaction
      .select({ playerId: teamPlayers.playerId })
      .from(teamPlayers)
      .where(
        and(
          eq(teamPlayers.organizationId, organizationId),
          eq(teamPlayers.teamId, teamId),
          lte(teamPlayers.validFrom, at),
          or(isNull(teamPlayers.validTo), gt(teamPlayers.validTo, at)),
        ),
      );
    return rows.map((row) => row.playerId);
  }

  private async loadSlots(
    transaction: DatabaseTransaction,
    organizationId: string,
    encounterId: string,
    forUpdate: boolean,
  ): Promise<SlotRow[]> {
    const query = transaction
      .select()
      .from(encounterSlots)
      .where(
        and(
          eq(encounterSlots.organizationId, organizationId),
          eq(encounterSlots.encounterId, encounterId),
        ),
      )
      .orderBy(asc(encounterSlots.sequence));
    return forUpdate ? query.for("update") : query;
  }

  private async loadNominations(
    transaction: DatabaseTransaction,
    organizationId: string,
    encounterId: string,
    side?: Side,
  ): Promise<(typeof encounterNominations.$inferSelect)[]> {
    return transaction
      .select()
      .from(encounterNominations)
      .where(
        side === undefined
          ? and(
              eq(encounterNominations.organizationId, organizationId),
              eq(encounterNominations.encounterId, encounterId),
            )
          : and(
              eq(encounterNominations.organizationId, organizationId),
              eq(encounterNominations.encounterId, encounterId),
              eq(encounterNominations.side, side),
            ),
      );
  }

  private async loadSubstitutions(
    transaction: DatabaseTransaction,
    organizationId: string,
    encounterId: string,
  ): Promise<SubstitutionRow[]> {
    return transaction
      .select()
      .from(encounterSubstitutions)
      .where(
        and(
          eq(encounterSubstitutions.organizationId, organizationId),
          eq(encounterSubstitutions.encounterId, encounterId),
        ),
      )
      .orderBy(asc(encounterSubstitutions.effectiveFromSequence));
  }

  private async loadDoublesPairings(
    transaction: DatabaseTransaction,
    organizationId: string,
    encounterId: string,
    side: Side,
  ): Promise<
    { readonly slotId: string; readonly sequence: number; readonly role: string; readonly playerIds: string[] }[]
  > {
    const rows = await transaction
      .select({
        slotId: encounterLineupEntries.slotId,
        sequence: encounterSlots.sequence,
        role: encounterSlots.role,
        position: encounterLineupEntries.position,
        playerId: encounterLineupEntries.playerId,
      })
      .from(encounterLineupEntries)
      .innerJoin(encounterSlots, eq(encounterSlots.id, encounterLineupEntries.slotId))
      .where(
        and(
          eq(encounterLineupEntries.organizationId, organizationId),
          eq(encounterLineupEntries.encounterId, encounterId),
          eq(encounterLineupEntries.side, side),
        ),
      )
      .orderBy(asc(encounterSlots.sequence), asc(encounterLineupEntries.position));
    const bySlot = new Map<
      string,
      { slotId: string; sequence: number; role: string; playerIds: string[] }
    >();
    for (const row of rows) {
      const existing = bySlot.get(row.slotId) ?? {
        slotId: row.slotId,
        sequence: row.sequence,
        role: row.role,
        playerIds: [],
      };
      existing.playerIds.push(row.playerId);
      bySlot.set(row.slotId, existing);
    }
    return [...bySlot.values()];
  }

  private async loadActivePlayerIds(
    transaction: DatabaseTransaction,
    organizationId: string,
  ): Promise<Set<string>> {
    const rows = await transaction
      .select({ playerId: matchParticipantPlayers.playerId })
      .from(matchParticipantPlayers)
      .innerJoin(matches, eq(matches.id, matchParticipantPlayers.matchId))
      .where(
        and(
          eq(matchParticipantPlayers.organizationId, organizationId),
          eq(matches.status, "IN_PROGRESS"),
        ),
      );
    return new Set(rows.map((row) => row.playerId));
  }

  private async resolveOccupancy(
    transaction: DatabaseTransaction,
    organizationId: string,
    encounterId: string,
    slot: SlotRow,
  ): Promise<{
    readonly home: { readonly playerIds: readonly string[] };
    readonly away: { readonly playerIds: readonly string[] };
  }> {
    const [nominations, substitutions, homePairings, awayPairings] = await Promise.all([
      this.loadNominations(transaction, organizationId, encounterId),
      this.loadSubstitutions(transaction, organizationId, encounterId),
      this.loadDoublesPairings(transaction, organizationId, encounterId, "HOME"),
      this.loadDoublesPairings(transaction, organizationId, encounterId, "AWAY"),
    ]);
    return resolveSlotSides(slot, nominations, substitutions, homePairings, awayPairings);
  }

  private async loadData(
    encounterFilter: ReturnType<typeof eq>,
    organizationId: string | null,
  ): Promise<EncounterData | null> {
    const homeTeams = aliasedTable(teams, "home_teams");
    const awayTeams = aliasedTable(teams, "away_teams");
    const [row] = await this.databaseService.database
      .select({
        encounter: encounters,
        competition: competitions,
        homeTeamName: homeTeams.name,
        awayTeamName: awayTeams.name,
      })
      .from(encounters)
      .innerJoin(competitions, eq(competitions.id, encounters.competitionId))
      .innerJoin(homeTeams, eq(homeTeams.id, encounters.homeTeamId))
      .innerJoin(awayTeams, eq(awayTeams.id, encounters.awayTeamId))
      .where(
        organizationId === null
          ? encounterFilter
          : and(eq(encounters.organizationId, organizationId), encounterFilter),
      )
      .limit(1);
    if (row === undefined) return null;
    const tenantId = row.encounter.organizationId;
    const encounterId = row.encounter.id;
    const outPlayers = aliasedTable(players, "out_players");
    const inPlayers = aliasedTable(players, "in_players");
    const [slots, nominations, lineupEntries, substitutions] = await Promise.all([
      this.databaseService.database
        .select({ slot: encounterSlots, boardName: boards.name })
        .from(encounterSlots)
        .leftJoin(boards, eq(boards.id, encounterSlots.boardId))
        .where(
          and(
            eq(encounterSlots.organizationId, tenantId),
            eq(encounterSlots.encounterId, encounterId),
          ),
        )
        .orderBy(asc(encounterSlots.sequence)),
      this.databaseService.database
        .select({
          side: encounterNominations.side,
          playerId: encounterNominations.playerId,
          displayName: players.displayName,
          position: encounterNominations.position,
          origin: encounterNominations.origin,
        })
        .from(encounterNominations)
        .innerJoin(players, eq(players.id, encounterNominations.playerId))
        .where(
          and(
            eq(encounterNominations.organizationId, tenantId),
            eq(encounterNominations.encounterId, encounterId),
          ),
        )
        .orderBy(asc(encounterNominations.side), asc(encounterNominations.position)),
      this.databaseService.database
        .select({
          slotId: encounterLineupEntries.slotId,
          side: encounterLineupEntries.side,
          position: encounterLineupEntries.position,
          playerId: encounterLineupEntries.playerId,
          displayName: players.displayName,
        })
        .from(encounterLineupEntries)
        .innerJoin(players, eq(players.id, encounterLineupEntries.playerId))
        .where(
          and(
            eq(encounterLineupEntries.organizationId, tenantId),
            eq(encounterLineupEntries.encounterId, encounterId),
          ),
        )
        .orderBy(asc(encounterLineupEntries.position)),
      this.databaseService.database
        .select({
          substitution: encounterSubstitutions,
          outDisplayName: outPlayers.displayName,
          inDisplayName: inPlayers.displayName,
        })
        .from(encounterSubstitutions)
        .innerJoin(outPlayers, eq(outPlayers.id, encounterSubstitutions.outPlayerId))
        .innerJoin(inPlayers, eq(inPlayers.id, encounterSubstitutions.inPlayerId))
        .where(
          and(
            eq(encounterSubstitutions.organizationId, tenantId),
            eq(encounterSubstitutions.encounterId, encounterId),
          ),
        )
        .orderBy(asc(encounterSubstitutions.effectiveFromSequence)),
    ]);

    return {
      encounter: row.encounter,
      competition: row.competition,
      homeTeamName: row.homeTeamName,
      awayTeamName: row.awayTeamName,
      slots: slots.map((entry) => ({ ...entry.slot, boardName: entry.boardName })),
      nominations,
      lineupEntries,
      substitutions: substitutions.map((entry) => ({
        ...entry.substitution,
        outDisplayName: entry.outDisplayName,
        inDisplayName: entry.inDisplayName,
      })),
    };
  }
}

interface MutationContext {
  readonly transaction: DatabaseTransaction;
  readonly encounter: EncounterRow;
  readonly competition: CompetitionRow;
  readonly now: Date;
  statusAfter: string | null;
  outbox: { readonly eventType: string; readonly payload: Record<string, unknown> } | null;
  progress: boolean;
}

function calculateForfeit(
  competition: CompetitionRow,
  slots: readonly SlotRow[],
  forfeitSide: Side,
): {
  readonly homeGames: number;
  readonly awayGames: number;
  readonly homeLegs: number;
  readonly awayLegs: number;
  readonly homePoints: number;
  readonly awayPoints: number;
  readonly result: "HOME_WIN" | "AWAY_WIN";
  readonly resultType: "FORFEIT";
} {
  const result = calculateEncounterResult(toResultInput(competition, slots, forfeitSide));
  if (result.result === null || result.result === "DRAW" || result.resultType !== "FORFEIT") {
    throw new Error("Forfeit result invariant violated.");
  }
  return {
    homeGames: result.homeGames,
    awayGames: result.awayGames,
    homeLegs: result.homeLegs,
    awayLegs: result.awayLegs,
    homePoints: result.homePoints,
    awayPoints: result.awayPoints,
    result: result.result,
    resultType: result.resultType,
  };
}

interface SidePlayerIds {
  readonly home: { readonly playerIds: readonly string[] };
  readonly away: { readonly playerIds: readonly string[] };
}

/**
 * Die Besetzung eines Slots kommt aus der League-Engine, nie aus dem Client:
 * bei Einzeln aus Position und Auswechselhistorie, bei Doppeln aus der
 * gemeldeten Paarung.
 */
interface NominationSource {
  readonly side: string;
  readonly playerId: string;
  readonly position: number | null;
  readonly origin: string;
}

function resolveSlotSides(
  slot: SlotRow,
  nominations: readonly NominationSource[],
  substitutions: readonly SubstitutionRow[],
  homePairings: readonly { readonly slotId: string; readonly playerIds: readonly string[] }[],
  awayPairings: readonly { readonly slotId: string; readonly playerIds: readonly string[] }[],
): SidePlayerIds {
  const homeDoubles = homePairings.find((pairing) => pairing.slotId === slot.id)?.playerIds;
  const awayDoubles = awayPairings.find((pairing) => pairing.slotId === slot.id)?.playerIds;
  return resolveSlotOccupancy({
    slot: {
      sequence: slot.sequence,
      discipline: slot.discipline === "DOUBLES" ? "DOUBLES" : "SINGLES",
      homePosition: slot.homePosition,
      awayPosition: slot.awayPosition,
    },
    home: {
      nominations: nominations.filter((entry) => entry.side === "HOME").map(toNominationEntry),
      substitutions: substitutions.filter((entry) => entry.side === "HOME").map(toSubstitutionRecord),
      ...(homeDoubles === undefined ? {} : { doublesPlayerIds: homeDoubles }),
    },
    away: {
      nominations: nominations.filter((entry) => entry.side === "AWAY").map(toNominationEntry),
      substitutions: substitutions.filter((entry) => entry.side === "AWAY").map(toSubstitutionRecord),
      ...(awayDoubles === undefined ? {} : { doublesPlayerIds: awayDoubles }),
    },
  });
}

export { resolveSlotSides };
