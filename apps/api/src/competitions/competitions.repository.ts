import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import {
  auditEvents,
  competitionSlots,
  competitions,
  encounterNominations,
  encounters,
  encounterSlots,
  encounterSubstitutions,
  players,
  teams,
} from "@darts-platform/database";
import type {
  CreateCompetitionInput,
  UpdateCompetitionInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { DatabaseService } from "../database/database.service.js";

export type CompetitionMutationResult =
  | "ok"
  | "not-found"
  | "version-conflict"
  | "slots-locked"
  | "slug-taken";

type CompetitionRow = typeof competitions.$inferSelect;
type CompetitionSlotRow = typeof competitionSlots.$inferSelect;

/** Was die Ligatabelle aus der Datenbank braucht: Begegnungsbilanzen und Teamnamen. */
export interface StandingsSource {
  readonly encounters: readonly {
    readonly homeTeamId: string;
    readonly awayTeamId: string;
    readonly status: string;
    readonly result: string | null;
    readonly homePoints: number;
    readonly awayPoints: number;
    readonly homeGames: number;
    readonly awayGames: number;
    readonly homeLegs: number;
    readonly awayLegs: number;
  }[];
  readonly teams: readonly {
    readonly id: string;
    readonly name: string;
    readonly shortName: string | null;
  }[];
}

/** Was die Einzelrangliste aus der Datenbank braucht: gewertete Einzelslots samt Besetzungsdaten. */
export interface PlayerRankingSource {
  readonly encounters: readonly {
    readonly id: string;
    readonly status: string;
    readonly matchday: number;
    readonly homeTeamId: string;
    readonly awayTeamId: string;
  }[];
  readonly slots: readonly {
    readonly encounterId: string;
    readonly discipline: string;
    readonly status: string;
    readonly legsToWinSet: number;
    readonly homePosition: number | null;
    readonly awayPosition: number | null;
    readonly homeLegs: number;
    readonly awayLegs: number;
    readonly sequence: number;
  }[];
  readonly nominations: readonly {
    readonly encounterId: string;
    readonly side: string;
    readonly playerId: string;
    readonly position: number | null;
    readonly origin: string;
  }[];
  readonly substitutions: readonly {
    readonly encounterId: string;
    readonly side: string;
    readonly position: number;
    readonly outPlayerId: string;
    readonly inPlayerId: string;
    readonly effectiveFromSequence: number;
  }[];
  readonly players: readonly { readonly id: string; readonly displayName: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string; readonly shortName: string | null }[];
}

export interface CompetitionData {
  readonly competition: CompetitionRow;
  readonly slots: readonly CompetitionSlotRow[];
  readonly encounterCount: number;
}

interface ActorInput {
  readonly organizationId: string;
  readonly auth: AuthContext;
  readonly audit: AuditContext;
}

@Injectable()
export class CompetitionsRepository {
  public constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Alle Begegnungen des Wettbewerbs samt der beteiligten Mannschaften. Auch
   * noch nicht gespielte Begegnungen zählen, damit angesetzte Teams mit null
   * Punkten in der Tabelle stehen statt zu fehlen.
   */
  public async standingsSource(input: {
    readonly organizationId: string;
    readonly competitionId: string;
  }): Promise<StandingsSource> {
    const rows = await this.databaseService.database
      .select({
        homeTeamId: encounters.homeTeamId,
        awayTeamId: encounters.awayTeamId,
        status: encounters.status,
        result: encounters.result,
        homePoints: encounters.homePoints,
        awayPoints: encounters.awayPoints,
        homeGames: encounters.homeGames,
        awayGames: encounters.awayGames,
        homeLegs: encounters.homeLegs,
        awayLegs: encounters.awayLegs,
      })
      .from(encounters)
      .where(
        and(
          eq(encounters.organizationId, input.organizationId),
          eq(encounters.competitionId, input.competitionId),
        ),
      );

    const teamIds = [...new Set(rows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
    if (teamIds.length === 0) return { encounters: rows, teams: [] };

    const teamRows = await this.databaseService.database
      .select({ id: teams.id, name: teams.name, shortName: teams.shortName })
      .from(teams)
      .where(and(eq(teams.organizationId, input.organizationId), inArray(teams.id, teamIds)));

    return { encounters: rows, teams: teamRows };
  }

  /**
   * Nur abgeschlossene Begegnungen; deren Einzelslots, Meldungen und
   * Auswechslungen lösen `resolveSlotOccupancy` im Service auf. Doppelslots
   * werden mitgeladen (für die Vollständigkeit der Begegnung), aber von der
   * Engine verworfen — sie zählen nicht für die Einzelrangliste.
   */
  public async playerRankingSource(input: {
    readonly organizationId: string;
    readonly competitionId: string;
  }): Promise<PlayerRankingSource> {
    const encounterRows = await this.databaseService.database
      .select({
        id: encounters.id,
        status: encounters.status,
        matchday: encounters.matchday,
        homeTeamId: encounters.homeTeamId,
        awayTeamId: encounters.awayTeamId,
      })
      .from(encounters)
      .where(
        and(
          eq(encounters.organizationId, input.organizationId),
          eq(encounters.competitionId, input.competitionId),
          eq(encounters.status, "COMPLETED"),
        ),
      );

    if (encounterRows.length === 0) {
      return { encounters: [], slots: [], nominations: [], substitutions: [], players: [], teams: [] };
    }
    const encounterIds = encounterRows.map((row) => row.id);

    const [slotRows, nominationRows, substitutionRows] = await Promise.all([
      this.databaseService.database
        .select({
          encounterId: encounterSlots.encounterId,
          discipline: encounterSlots.discipline,
          status: encounterSlots.status,
          legsToWinSet: encounterSlots.legsToWinSet,
          homePosition: encounterSlots.homePosition,
          awayPosition: encounterSlots.awayPosition,
          homeLegs: encounterSlots.homeLegs,
          awayLegs: encounterSlots.awayLegs,
          sequence: encounterSlots.sequence,
        })
        .from(encounterSlots)
        .where(
          and(
            eq(encounterSlots.organizationId, input.organizationId),
            inArray(encounterSlots.encounterId, encounterIds),
          ),
        ),
      this.databaseService.database
        .select({
          encounterId: encounterNominations.encounterId,
          side: encounterNominations.side,
          playerId: encounterNominations.playerId,
          position: encounterNominations.position,
          origin: encounterNominations.origin,
        })
        .from(encounterNominations)
        .where(
          and(
            eq(encounterNominations.organizationId, input.organizationId),
            inArray(encounterNominations.encounterId, encounterIds),
          ),
        ),
      this.databaseService.database
        .select({
          encounterId: encounterSubstitutions.encounterId,
          side: encounterSubstitutions.side,
          position: encounterSubstitutions.position,
          outPlayerId: encounterSubstitutions.outPlayerId,
          inPlayerId: encounterSubstitutions.inPlayerId,
          effectiveFromSequence: encounterSubstitutions.effectiveFromSequence,
        })
        .from(encounterSubstitutions)
        .where(
          and(
            eq(encounterSubstitutions.organizationId, input.organizationId),
            inArray(encounterSubstitutions.encounterId, encounterIds),
          ),
        ),
    ]);

    const playerIds = [...new Set(nominationRows.flatMap((row) => [row.playerId]))];
    const teamIds = [...new Set(encounterRows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];

    const [playerRows, teamRows] = await Promise.all([
      playerIds.length === 0
        ? Promise.resolve([])
        : this.databaseService.database
            .select({ id: players.id, displayName: players.displayName })
            .from(players)
            .where(and(eq(players.organizationId, input.organizationId), inArray(players.id, playerIds))),
      this.databaseService.database
        .select({ id: teams.id, name: teams.name, shortName: teams.shortName })
        .from(teams)
        .where(and(eq(teams.organizationId, input.organizationId), inArray(teams.id, teamIds))),
    ]);

    return {
      encounters: encounterRows,
      slots: slotRows,
      nominations: nominationRows,
      substitutions: substitutionRows,
      players: playerRows,
      teams: teamRows,
    };
  }

  public async list(organizationId: string): Promise<CompetitionData[]> {
    const rows = await this.databaseService.database
      .select()
      .from(competitions)
      .where(eq(competitions.organizationId, organizationId))
      .orderBy(asc(competitions.name));
    if (rows.length === 0) return [];
    const competitionIds = rows.map((row) => row.id);
    const [slots, encounterCounts] = await Promise.all([
      this.databaseService.database
        .select()
        .from(competitionSlots)
        .where(
          and(
            eq(competitionSlots.organizationId, organizationId),
            inArray(competitionSlots.competitionId, competitionIds),
          ),
        )
        .orderBy(asc(competitionSlots.sequence)),
      this.databaseService.database
        .select({ competitionId: encounters.competitionId, total: count() })
        .from(encounters)
        .where(
          and(
            eq(encounters.organizationId, organizationId),
            inArray(encounters.competitionId, competitionIds),
          ),
        )
        .groupBy(encounters.competitionId),
    ]);
    const totals = new Map(encounterCounts.map((row) => [row.competitionId, Number(row.total)]));
    return rows.map((competition) => ({
      competition,
      slots: slots.filter((slot) => slot.competitionId === competition.id),
      encounterCount: totals.get(competition.id) ?? 0,
    }));
  }

  public async get(input: {
    readonly organizationId: string;
    readonly competitionId: string;
  }): Promise<CompetitionData | null> {
    const [competition] = await this.databaseService.database
      .select()
      .from(competitions)
      .where(
        and(
          eq(competitions.organizationId, input.organizationId),
          eq(competitions.id, input.competitionId),
        ),
      )
      .limit(1);
    if (competition === undefined) return null;
    const [slots, [encounterCount]] = await Promise.all([
      this.databaseService.database
        .select()
        .from(competitionSlots)
        .where(
          and(
            eq(competitionSlots.organizationId, input.organizationId),
            eq(competitionSlots.competitionId, input.competitionId),
          ),
        )
        .orderBy(asc(competitionSlots.sequence)),
      this.databaseService.database
        .select({ total: count() })
        .from(encounters)
        .where(
          and(
            eq(encounters.organizationId, input.organizationId),
            eq(encounters.competitionId, input.competitionId),
          ),
        ),
    ]);
    return { competition, slots, encounterCount: Number(encounterCount?.total ?? 0) };
  }

  public create(
    input: ActorInput & { readonly data: CreateCompetitionInput },
  ): Promise<string | "slug-taken"> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: competitions.id })
        .from(competitions)
        .where(
          and(
            eq(competitions.organizationId, input.organizationId),
            eq(competitions.slug, input.data.slug),
          ),
        )
        .limit(1);
      if (existing !== undefined) return "slug-taken";
      const [created] = await transaction
        .insert(competitions)
        .values({
          organizationId: input.organizationId,
          type: input.data.type,
          name: input.data.name,
          slug: input.data.slug,
          status: input.data.status,
          pointsWin: input.data.pointsWin,
          pointsDraw: input.data.pointsDraw,
          pointsLoss: input.data.pointsLoss,
          pointsDeciderBonus: input.data.pointsDeciderBonus,
          deciderRule: input.data.deciderRule,
          lineupPositions: input.data.lineupPositions,
          minNominations: input.data.minNominations,
          minNominationsShorthanded: input.data.minNominationsShorthanded,
          maxSubstitutionsPerEncounter: input.data.maxSubstitutionsPerEncounter,
          maxDoublesPerPlayer: input.data.maxDoublesPerPlayer,
        })
        .returning();
      if (created === undefined) throw new Error("Competition insert did not return a row.");
      await transaction.insert(competitionSlots).values(
        input.data.slots.map((slot) => ({
          organizationId: input.organizationId,
          competitionId: created.id,
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
        })),
      );
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "COMPETITION_CREATED",
        entityType: "Competition",
        entityId: created.id,
        newValue: created,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return created.id;
    });
  }

  /**
   * Die Vorlage darf nicht mehr geändert werden, sobald eine Begegnung des
   * Wettbewerbs läuft oder gespielt ist. Die Kopie in `encounter_slots`
   * schützt angesetzte Begegnungen; diese Sperre verhindert, dass eine
   * laufende Saison ihre Vorlage unter sich wegzieht.
   */
  public update(
    input: ActorInput & {
      readonly competitionId: string;
      readonly data: UpdateCompetitionInput;
    },
  ): Promise<CompetitionMutationResult> {
    return this.databaseService.database.transaction(async (transaction) => {
      const [existing] = await transaction
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
      if (existing === undefined) return "not-found";
      if (existing.version !== input.data.expectedVersion) return "version-conflict";
      if (input.data.slots !== undefined) {
        const [started] = await transaction
          .select({ id: encounters.id })
          .from(encounters)
          .where(
            and(
              eq(encounters.organizationId, input.organizationId),
              eq(encounters.competitionId, input.competitionId),
              inArray(encounters.status, ["RUNNING", "COMPLETED"]),
            ),
          )
          .limit(1);
        if (started !== undefined) return "slots-locked";
        await transaction
          .delete(competitionSlots)
          .where(
            and(
              eq(competitionSlots.organizationId, input.organizationId),
              eq(competitionSlots.competitionId, input.competitionId),
            ),
          );
        await transaction.insert(competitionSlots).values(
          input.data.slots.map((slot) => ({
            organizationId: input.organizationId,
            competitionId: input.competitionId,
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
          })),
        );
      }
      const [updated] = await transaction
        .update(competitions)
        .set({
          ...(input.data.name === undefined ? {} : { name: input.data.name }),
          ...(input.data.status === undefined ? {} : { status: input.data.status }),
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(competitions.organizationId, input.organizationId),
            eq(competitions.id, input.competitionId),
          ),
        )
        .returning();
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        actorUserId: input.auth.user.id,
        action: "COMPETITION_UPDATED",
        entityType: "Competition",
        entityId: input.competitionId,
        oldValue: existing,
        newValue: updated ?? null,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        correlationId: input.audit.correlationId,
      });
      return "ok";
    });
  }
}
