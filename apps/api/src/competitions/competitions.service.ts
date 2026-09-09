import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  calculatePlayerRanking,
  calculateStandings,
  resolveSlotOccupancy,
  validateEncounterTemplate,
  type PlayerRankingSlot,
  type TemplateSlot,
} from "@darts-platform/league-engine";
import {
  competitionDetailSchema,
  competitionListSchema,
  competitionPlayerRankingSchema,
  competitionStandingsSchema,
  encounterResultSchema,
  encounterStatusSchema,
  type CompetitionDetail,
  type CompetitionPlayerRanking,
  type CompetitionSlotInput,
  type CompetitionStandings,
  type CompetitionSummary,
  type CreateCompetitionInput,
  type UpdateCompetitionInput,
} from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import type { AuditContext } from "../common/audit-context.js";
import { rethrowLeagueError } from "../common/league-error.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import {
  CompetitionsRepository,
  type CompetitionData,
  type CompetitionMutationResult,
} from "./competitions.repository.js";

export function toTemplateSlots(slots: readonly CompetitionSlotInput[]): TemplateSlot[] {
  return slots.map((slot) => ({
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
  }));
}

function toResponse(data: CompetitionData): unknown {
  return {
    id: data.competition.id,
    organizationId: data.competition.organizationId,
    type: data.competition.type,
    name: data.competition.name,
    slug: data.competition.slug,
    status: data.competition.status,
    version: data.competition.version,
    pointsWin: data.competition.pointsWin,
    pointsDraw: data.competition.pointsDraw,
    pointsLoss: data.competition.pointsLoss,
    pointsDeciderBonus: data.competition.pointsDeciderBonus,
    deciderRule: data.competition.deciderRule,
    lineupPositions: data.competition.lineupPositions,
    minNominations: data.competition.minNominations,
    minNominationsShorthanded: data.competition.minNominationsShorthanded,
    maxSubstitutionsPerEncounter: data.competition.maxSubstitutionsPerEncounter,
    maxDoublesPerPlayer: data.competition.maxDoublesPerPlayer,
    slotCount: data.slots.length,
    encounterCount: data.encounterCount,
    createdAt: data.competition.createdAt,
    updatedAt: data.competition.updatedAt,
    slots: data.slots.map((slot) => ({
      id: slot.id,
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
  };
}

@Injectable()
export class CompetitionsService {
  public constructor(
    @Inject(CompetitionsRepository) private readonly repository: CompetitionsRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async list(input: {
    readonly organizationId: string;
    readonly auth: AuthContext;
  }): Promise<CompetitionSummary[]> {
    await this.require(input, "competition:read");
    return competitionListSchema.parse(
      (await this.repository.list(input.organizationId)).map(toResponse),
    );
  }

  public async get(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly auth: AuthContext;
  }): Promise<CompetitionDetail> {
    await this.require(input, "competition:read");
    const data = await this.repository.get(input);
    if (data === null) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Competition not found." });
    }
    return competitionDetailSchema.parse(toResponse(data));
  }

  /**
   * Die Tabelle rechnet die League-Engine; der Service liefert ihr nur die
   * Zeilen und hängt die Mannschaftsnamen an (AGENTS.md §4).
   */
  public async standings(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly auth: AuthContext;
  }): Promise<CompetitionStandings> {
    await this.require(input, "competition:read");
    const data = await this.repository.get(input);
    if (data === null) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Competition not found." });
    }
    const source = await this.repository.standingsSource(input);
    const names = new Map(source.teams.map((team) => [team.id, team]));
    const rows = calculateStandings({
      teamIds: source.teams.map((team) => team.id),
      // Der Datenbanktyp ist `varchar`; die Enums gehören an die Domänengrenze.
      encounters: source.encounters.map((row) => ({
        ...row,
        status: encounterStatusSchema.parse(row.status),
        result: row.result === null ? null : encounterResultSchema.parse(row.result),
      })),
    });
    return competitionStandingsSchema.parse({
      competitionId: input.competitionId,
      rows: rows.map((row) => ({
        ...row,
        teamName: names.get(row.teamId)?.name ?? "",
        teamShortName: names.get(row.teamId)?.shortName ?? null,
      })),
    });
  }

  /**
   * Die Einzelrangliste rechnet die League-Engine (Reglement A1.6–A1.9); der
   * Service löst nur die Besetzung je Slot auf (dieselbe Funktion wie beim
   * Nichtantritt-Pfad in `encounters.repository.ts`) und hängt Namen an.
   */
  public async playerRanking(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly auth: AuthContext;
  }): Promise<CompetitionPlayerRanking> {
    await this.require(input, "competition:read");
    const data = await this.repository.get(input);
    if (data === null) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Competition not found." });
    }
    const source = await this.repository.playerRankingSource(input);
    const encountersById = new Map(source.encounters.map((row) => [row.id, row]));
    const playerNames = new Map(source.players.map((row) => [row.id, row.displayName]));
    const teamsById = new Map(source.teams.map((row) => [row.id, row]));

    const slots: PlayerRankingSlot[] = source.slots
      .map((slot) => {
        const encounter = encountersById.get(slot.encounterId);
        if (encounter === undefined) return null;

        const nominationsFor = (side: "HOME" | "AWAY") =>
          source.nominations
            .filter((row) => row.encounterId === slot.encounterId && row.side === side)
            .map((row) => ({
              playerId: row.playerId,
              position: row.position,
              origin: row.origin === "GUEST" ? ("GUEST" as const) : ("SQUAD" as const),
            }));
        const substitutionsFor = (side: "HOME" | "AWAY") =>
          source.substitutions
            .filter((row) => row.encounterId === slot.encounterId && row.side === side)
            .map((row) => ({
              side,
              position: row.position,
              outPlayerId: row.outPlayerId,
              inPlayerId: row.inPlayerId,
              effectiveFromSequence: row.effectiveFromSequence,
            }));

        const occupancy = resolveSlotOccupancy({
          slot: {
            sequence: slot.sequence,
            discipline: slot.discipline === "DOUBLES" ? "DOUBLES" : "SINGLES",
            homePosition: slot.homePosition,
            awayPosition: slot.awayPosition,
          },
          home: { nominations: nominationsFor("HOME"), substitutions: substitutionsFor("HOME") },
          away: { nominations: nominationsFor("AWAY"), substitutions: substitutionsFor("AWAY") },
        });

        return {
          encounterId: slot.encounterId,
          encounterStatus: encounter.status as PlayerRankingSlot["encounterStatus"],
          matchday: encounter.matchday,
          discipline: slot.discipline as PlayerRankingSlot["discipline"],
          status: slot.status as PlayerRankingSlot["status"],
          legsToWinSet: slot.legsToWinSet,
          homeTeamId: encounter.homeTeamId,
          awayTeamId: encounter.awayTeamId,
          homePlayerIds: occupancy.home.playerIds,
          awayPlayerIds: occupancy.away.playerIds,
          homeLegs: slot.homeLegs,
          awayLegs: slot.awayLegs,
        } satisfies PlayerRankingSlot;
      })
      .filter((slot): slot is PlayerRankingSlot => slot !== null);

    const rows = calculatePlayerRanking({ slots });
    return competitionPlayerRankingSchema.parse({
      competitionId: input.competitionId,
      rows: rows.map((row) => ({
        ...row,
        playerName: playerNames.get(row.playerId) ?? "",
        teamName: teamsById.get(row.teamId)?.name ?? "",
        teamShortName: teamsById.get(row.teamId)?.shortName ?? null,
      })),
    });
  }

  public async create(input: {
    readonly organizationId: string;
    readonly data: CreateCompetitionInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<CompetitionDetail> {
    await this.require(input, "competition:manage");
    try {
      validateEncounterTemplate(toTemplateSlots(input.data.slots));
    } catch (error) {
      rethrowLeagueError(error);
    }
    const created = await this.repository.create(input);
    if (created === "slug-taken") {
      throw new ConflictException({
        code: "COMPETITION_SLUG_TAKEN",
        message: "Für diesen Slug existiert bereits ein Wettbewerb.",
      });
    }
    return this.get({
      organizationId: input.organizationId,
      competitionId: created,
      auth: input.auth,
    });
  }

  public async update(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly data: UpdateCompetitionInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<CompetitionDetail> {
    await this.require(input, "competition:manage");
    if (input.data.slots !== undefined) {
      try {
        validateEncounterTemplate(toTemplateSlots(input.data.slots));
      } catch (error) {
        rethrowLeagueError(error);
      }
    }
    const result = await this.repository.update(input);
    if (result === "not-found") {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Competition not found." });
    }
    const current = await this.get(input);
    this.assert(result, current);
    return current;
  }

  private assert(result: CompetitionMutationResult, current: CompetitionDetail): void {
    if (result === "ok") return;
    if (result === "version-conflict") {
      throw new ConflictException({
        code: "COMPETITION_VERSION_CONFLICT",
        message: "Der Wettbewerb hat sich geändert. Synchronisiere mit dem Serverzustand.",
        details: { currentState: current },
      });
    }
    if (result === "slots-locked") {
      throw new ConflictException({
        code: "COMPETITION_TEMPLATE_LOCKED",
        message: "Die Vorlage lässt sich nicht mehr ändern, solange Begegnungen laufen.",
        details: { currentState: current },
      });
    }
    throw new ConflictException({
      code: "COMPETITION_SLUG_TAKEN",
      message: "Für diesen Slug existiert bereits ein Wettbewerb.",
      details: { currentState: current },
    });
  }

  private async require(
    input: { readonly organizationId: string; readonly auth: AuthContext },
    permission: "competition:read" | "competition:manage",
  ): Promise<void> {
    await this.access.requirePermission({
      organizationId: input.organizationId,
      userId: input.auth.user.id,
      permission,
    });
  }
}
