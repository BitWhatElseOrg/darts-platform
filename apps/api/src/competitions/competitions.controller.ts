import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import {
  createCompetitionSchema,
  updateCompetitionSchema,
  type CompetitionDetail,
  type CompetitionPlayerRanking,
  type CompetitionStandings,
  type CompetitionSummary,
  type CreateCompetitionInput,
  type UpdateCompetitionInput,
} from "@darts-platform/schemas";

import { CurrentAuth } from "../auth/current-auth.decorator.js";
import type { AuthContext } from "../auth/auth.types.js";
import { getAuditContext } from "../common/audit-context.js";
import { parseBody } from "../common/parse-body.js";
import { CompetitionsService } from "./competitions.service.js";

@Controller("organizations/:organizationId/competitions")
export class CompetitionsController {
  public constructor(@Inject(CompetitionsService) private readonly service: CompetitionsService) {}

  @Get()
  public list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CompetitionSummary[]> {
    return this.service.list({ organizationId, auth });
  }

  @Get(":competitionId")
  public get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("competitionId", ParseUUIDPipe) competitionId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CompetitionDetail> {
    return this.service.get({ organizationId, competitionId, auth });
  }

  @Get(":competitionId/standings")
  public standings(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("competitionId", ParseUUIDPipe) competitionId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CompetitionStandings> {
    return this.service.standings({ organizationId, competitionId, auth });
  }

  @Get(":competitionId/player-ranking")
  public playerRanking(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("competitionId", ParseUUIDPipe) competitionId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CompetitionPlayerRanking> {
    return this.service.playerRanking({ organizationId, competitionId, auth });
  }

  @Post()
  public create(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CompetitionDetail> {
    const data: CreateCompetitionInput = parseBody(createCompetitionSchema, body);
    return this.service.create({ organizationId, data, auth, audit: getAuditContext(request) });
  }

  @Patch(":competitionId")
  public update(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("competitionId", ParseUUIDPipe) competitionId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CompetitionDetail> {
    const data: UpdateCompetitionInput = parseBody(updateCompetitionSchema, body);
    return this.service.update({
      organizationId,
      competitionId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }
}
