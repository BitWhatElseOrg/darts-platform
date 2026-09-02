import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { validateEncounterTemplate, type TemplateSlot } from "@darts-platform/league-engine";
import {
  competitionDetailSchema,
  competitionListSchema,
  type CompetitionDetail,
  type CompetitionSlotInput,
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
